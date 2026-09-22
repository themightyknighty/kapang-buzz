/**
 * One ingestion shard, end to end.
 *
 *   pick the shard + hot list → adapters → score → rank → persist
 *
 * The roster is swept in shards on a 15-minute tick, so every celebrity is
 * fully refreshed hourly while the top movers are re-checked every tick. That
 * shape exists because a full 100-celebrity GDELT sweep at an 8-second gap
 * would overrun Netlify's 15-minute function ceiling.
 *
 * One rule governs failure: the market always updates. An adapter that throws,
 * times out or trips its breaker contributes nothing this run; the celebrity's
 * previous values carry forward with their freshness clock still running, and
 * the failure is recorded in health.
 */
import { INGEST, WEIGHTS, SNAPSHOT_INTERVAL_MINUTES, GKG, WIKIPEDIA, PORTRAITS } from './config.mjs'
import { activeRoster } from './roster.mjs'
import { shardOf } from './celebrities.mjs'
import { newsComponent, wikipediaComponent, breadthComponent, gossipScore } from './score.mjs'
import { momentumOf, classify } from './momentum.mjs'
import { rankMarket, marketCards, marketSummary, hotList } from './rank.mjs'
import { percentileOf, buildBaselines, median } from './normalize.mjs'
import { createStore, snapshotSlot, dayKey } from './store.mjs'
// The news source is GDELT's Global Knowledge Graph. The DOC API refuses us
// at any pace, and the ngram files are 42 MB per minute of news. adapters/
// news.mjs and adapters/ngrams.mjs are kept for reference, unwired.
import * as newsAdapter from './adapters/gkg.mjs'
import * as wikipediaAdapter from './adapters/wikipedia.mjs'
import * as portraitAdapter from './adapters/portrait.mjs'
import { pool } from './pool.mjs'
import { buildLiveChart, partialDay, dayLevel } from './chart.mjs'
import { settle, quote } from './price.mjs'

/**
 * Which celebrities need a Wikipedia reading now.
 *
 * Anyone with no reading at all comes first — that is the cold start, and it
 * is the difference between the market carrying its Wikipedia component and
 * silently scoring without it. After that, whoever has been waiting longest,
 * so the daily refresh spreads itself evenly rather than landing in one lump.
 */
export function wikipediaDue(roster, prevById, { now = Date.now(), limit = WIKIPEDIA.perRun, refreshHours = WIKIPEDIA.refreshHours } = {}) {
  const staleAfter = refreshHours * 3600000
  const ageOf = (c) => {
    const prev = prevById.get(c.id)
    const at = prev?.sources?.wikipedia?.at
    const has = prev?.contributions?.wikipedia?.value != null
    // No reading is infinitely stale: it is the case that matters most.
    return has && at ? now - Date.parse(at) : Infinity
  }
  return roster
    .map((c) => ({ c, age: ageOf(c) }))
    .filter((x) => x.age >= staleAfter)
    .sort((a, b) => b.age - a.age)
    .slice(0, Math.max(0, limit))
    .map((x) => x.c)
}

/**
 * Which celebrities this tick refreshes: one shard, plus the current hot list.
 * A null shard means the whole roster — what the daily job and a local run want.
 */
export function selectForRun(roster, shard, hotIds, { shards = INGEST.shards, hotListSize = INGEST.hotListSize } = {}) {
  if (shard == null) return roster.slice()
  const inShard = roster.filter((c) => shardOf(c.id, shards) === shard)
  const hot = roster.filter((c) => hotIds.includes(c.id) && !inShard.some((s) => s.id === c.id))
  return [...inShard, ...hot.slice(0, hotListSize)]
}

/**
 * Merge a celebrity's previous stored state with whatever this run measured.
 * A source that was not refreshed this tick keeps its last value and ages.
 */
function carryForward(previousRow, signal, source, now) {
  if (signal) return { value: signal, ageSeconds: 0, meta: signal.meta }
  const prev = previousRow?.sources?.[source]
  if (!prev?.at) return { value: null, ageSeconds: null, meta: null }
  return {
    value: prev.value ?? null,
    ageSeconds: Math.round((now - Date.parse(prev.at)) / 1000),
    meta: prev.meta ?? null,
    carried: true,
  }
}

export async function runMarket({
  blobs, shard = 0, now = Date.now(), fetchImpl = fetch, env = process.env,
  roster = activeRoster(), adapters = { news: newsAdapter, wikipedia: wikipediaAdapter, portrait: portraitAdapter },
  runWikipedia = false, log = [], onProgress = null,
} = {}) {
  const store = createStore(blobs)
  const startedAt = Date.now()
  const deadline = startedAt + INGEST.maxRunSeconds * 1000
  const slot = snapshotSlot(now, SNAPSHOT_INTERVAL_MINUTES)

  /*
   * A mock market must never seed a real one.
   *
   * Values carry forward from the previous snapshot when a source is quiet,
   * so a stored mock would launder invented figures into production data one
   * tick at a time. On Netlify this cannot arise — mock is never written to
   * Blobs — but a local `--mock` run leaves a file in the same place, and
   * that is enough.
   */
  const stored = await store.readMarket()
  const previous = stored?.mock ? null : stored
  if (stored?.mock) log.push('ignoring a stored mock market — real runs never build on invented data')
  const prevById = new Map((previous?.rows || []).map((r) => [r.id, r]))
  const { ids: hotIds = [] } = (await store.readHotList()) || {}
  const due = selectForRun(roster, shard, hotIds)
  log.push(`shard ${shard}: ${due.length} celebrities due (${hotIds.length} from the hot list)`)

  /* ---------------- adapters ---------------- */
  const collected = { news: new Map(), wikipedia: new Map() }
  let calls = 0

  /*
   * Whether this tick got a look at the news at all, as opposed to whether a
   * particular celebrity turned up in it. The two are different and conflating
   * them is what put zeros on the board: a celebrity who is simply absent from
   * one 15-minute window has a known count for it (none), while a window we
   * could not read tells us nothing about anybody.
   */
  const newsRun = { ok: false, repeat: false, file: previous?.newsWindowFile ?? null, error: 'not run' }

  try {
    // Every celebrity is measured from the same files, so the whole roster
    // goes in regardless of which shard this tick nominally owns.
    const r = await adapters.news.collect(roster, {
      now, fetchImpl, log, deadline, onProgress,
      alreadyIngested: previous?.newsWindowFile ?? null,
    })
    for (const s of r.signals) collected.news.set(s.celebrityId, s)
    calls += r.calls
    newsRun.ok = r.ok !== false
    newsRun.repeat = r.repeat === true
    newsRun.file = r.file ?? newsRun.file
    newsRun.error = r.error ?? (r.breakerOpen ? 'circuit breaker open' : null)
    await store.recordHealth('news', { ok: newsRun.ok, now, calls: r.calls, error: newsRun.error })
  } catch (err) {
    log.push(`news adapter failed: ${err.message}`)
    newsRun.error = err.message
    await store.recordHealth('news', { ok: false, error: err.message, now })
  }

  // The daily job takes the whole roster; an ordinary run tops up whoever is
  // missing or a day old, so the component is never simply absent.
  const wikiTargets = runWikipedia ? roster : wikipediaDue(roster, prevById, { now })
  if (wikiTargets.length) {
    try {
      const r = await adapters.wikipedia.collect(wikiTargets, { now, fetchImpl, log, deadline })
      for (const s of r.signals) collected.wikipedia.set(s.celebrityId, s)
      calls += r.calls
      log.push(`wikipedia: read ${r.signals.length}/${wikiTargets.length} of the ${runWikipedia ? 'full roster' : 'names that were missing or a day old'}`)
      await store.recordHealth('wikipedia', { ok: r.signals.length > 0, now, calls: r.calls, error: r.signals.length ? null : 'no articles returned views' })
    } catch (err) {
      log.push(`wikipedia adapter failed: ${err.message}`)
      await store.recordHealth('wikipedia', { ok: false, error: err.message, now })
    }
  }

  /*
   * Portraits. A handful a run, and once the roster is filled almost every run
   * finds nobody due and does nothing. It sits outside the try/catch pattern
   * above in one respect: a failure here must not cost the market a tick, so
   * the whole thing is wrapped and a failure only means the avatars stay as
   * initials for another fifteen minutes.
   */
  let portraits = await store.readPortraits()
  const portraitTargets = adapters.portrait
    ? adapters.portrait.portraitsDue(roster, portraits, {
      now, limit: PORTRAITS.perRun, refreshDays: PORTRAITS.refreshDays,
      // Passed explicitly so that relaxing the rule puts every celebrity it
      // used to refuse back at the front of the queue, rather than leaving
      // them remembered as pictureless until the monthly refresh comes round.
      allowPersonalityRights: PORTRAITS.allowPersonalityRights,
    })
    : []
  if (portraitTargets.length) {
    try {
      const r = await adapters.portrait.collect(portraitTargets, {
        now, fetchImpl, log, deadline, gapMs: PORTRAITS.gapMs, width: PORTRAITS.width,
        allowPersonalityRights: PORTRAITS.allowPersonalityRights,
      })
      calls += r.calls
      const merged = await store.mergePortraits(r.found)
      if (merged) portraits = merged
      log.push(`portraits: looked up ${Object.keys(r.found).length}/${portraitTargets.length} due — ${r.kept} usable, ${r.refused} refused on licence or rights`)
      await store.recordHealth('portrait', { ok: Object.keys(r.found).length > 0, now, calls: r.calls, error: null })
    } catch (err) {
      log.push(`portrait adapter failed: ${err.message}`)
      await store.recordHealth('portrait', { ok: false, error: err.message, now })
    }
  }

  /* ---------------- score ---------------- */
  // Cross-market context, so the small absolute-volume term means something.
  const mentionsByCelebrity = new Map()
  for (const c of roster) {
    const s = collected.news.get(c.id)
    mentionsByCelebrity.set(c.id, s ? s.raw : prevById.get(c.id)?.mentions ?? 0)
  }
  const marketMentions = [...mentionsByCelebrity.values()].sort((a, b) => a - b)

  const categoryMedians = {}
  for (const c of roster) {
    (categoryMedians[c.primaryCategory] ||= []).push(mentionsByCelebrity.get(c.id) || 0)
  }
  for (const k of Object.keys(categoryMedians)) categoryMedians[k] = median(categoryMedians[k])

  /*
   * Every celebrity's stored history, loaded once and concurrently.
   *
   * This used to be four sequential reads per celebrity inside the scoring
   * loop — 420 round trips for a 105-name roster. Against local files that
   * cost 47 seconds; against Netlify Blobs, where each read is an HTTP
   * request, it would have been minutes.
   */
  const histories = new Map()
  await pool(roster, 12, async (c) => {
    const [rollup, intraday] = await Promise.all([
      store.readRollup(c.id),
      store.readSeries(c.id, now - 48 * 3600000, now),
    ])
    histories.set(c.id, { rollup, intraday })
  })

  const rows = []
  for (const c of roster) {
    const prev = prevById.get(c.id)
    const news = carryForward(prev, collected.news.get(c.id), 'news', now)
    const wiki = carryForward(prev, collected.wikipedia.get(c.id), 'wikipedia', now)

    const { rollup, intraday } = histories.get(c.id)
    // mentionCount is already the rolling 24h total at each snapshot, so the
    // baseline windows compare like with like.
    const baselines = buildBaselines(
      intraday.map((p) => ({ mentions: p.mentionCount })),
      rollup.days.map((d) => ({ mentions: d.mentions })),
    )

    const m = news.meta || {}

    /*
     * One 15-minute window is a tick, not a measurement: it holds ~1,400
     * articles, so most celebrities appear in none of them. Attention is the
     * rolling sum of the last day of windows, which is why the market fills
     * in over its first 24 hours rather than arriving complete.
     */
    const windowMentions = newsRun.ok ? news.value?.raw ?? 0 : 0
    const priorWindows = intraday
      .filter((p) => Date.parse(p.timestamp) > now - 24 * 3600000)
      .slice(-(GKG.rollingWindows - 1))
      .reduce((a, p) => a + (p.windowMentions || 0), 0)
    /*
     * Rebuild the rolling total whenever the window was READ — not only when
     * this celebrity appeared in it. Keyed on the celebrity instead, a quiet
     * tick froze their total at its old value rather than ageing the oldest
     * window out of it, so a name that had stopped being covered stayed on
     * the board at yesterday's number indefinitely.
     */
    const mentions = newsRun.ok ? priorWindows + windowMentions : prev?.mentions ?? 0

    const newsPart = newsRun.ok
      ? newsComponent({
        mentions,
        weightedMentions: m.weightedMentions ?? mentions,
        baselines,
        marketMentions,
        categoryMedian: categoryMedians[c.primaryCategory],
      })
      : prev?.contributions?.news?.value != null ? { score: prev.contributions.news.value, z: prev.deviationZ ?? 0, basis: 'carried', provisional: false } : null

    const wikiPart = wiki.value
      ? wikipediaComponent({
        views: wiki.value.raw,
        baselines: buildBaselines([], (wiki.meta?.daily || []).map((v) => ({ mentions: v }))),
        categoryMedian: categoryMedians[c.primaryCategory],
      })
      : prev?.contributions?.wikipedia?.value != null ? { score: prev.contributions.wikipedia.value } : null

    const breadthPart = news.value
      ? breadthComponent({ uniqueSources: m.uniqueSources, uniqueCountries: m.uniqueCountries, prominence: m.prominence })
      : prev?.contributions?.breadth?.value != null ? { score: prev.contributions.breadth.value } : null

    /*
     * Momentum is the change in the RATE of coverage, not in the running
     * total.
     *
     * `mentionCount` is the cumulative rolling day, which only ever climbs
     * while history is filling in — measured against that, every celebrity
     * looks identically "rising rapidly" during warm-up. The rate is what
     * moves: mentions per hour, taken as a trailing hour of window counts so
     * a single quiet 15 minutes does not read as a collapse.
     */
    const perHour = 60 / SNAPSHOT_INTERVAL_MINUTES
    const rateAt = (t, upTo, extra = null) => {
      const win = upTo.filter((q) => { const qt = Date.parse(q.timestamp); return qt > t - 3600000 && qt <= t })
      const counts = [...win.map((q) => q.windowMentions || 0), ...(extra == null ? [] : [extra])]
      if (!counts.length) return 0
      // The AVERAGE window, scaled to an hour — not the sum. A sum climbs
      // while the trailing hour is still filling up, which would read as
      // acceleration when coverage is in fact perfectly steady.
      return (counts.reduce((a, b) => a + b, 0) / counts.length) * perHour
    }

    const points = news.value?.series?.length
      ? news.value.series
      : [
        ...intraday.map((p) => ({ t: Date.parse(p.timestamp), v: rateAt(Date.parse(p.timestamp), intraday) })),
        // This tick is not stored yet, so its own count is passed in — unless
        // the window could not be read, where a 0 would read as a collapse in
        // coverage rather than as an absence of evidence.
        { t: now, v: rateAt(now, intraday, newsRun.ok ? windowMentions : null) },
      ]
    const momentumHistory = intraday.slice(-3).map((p) => p.momentumScore).filter(Number.isFinite)
    const mom = momentumOf(points, now, { history: momentumHistory })

    const scored = gossipScore({
      news: newsPart, wikipedia: wikiPart, breadth: breadthPart, momentum: mom.momentum,
      mentions, ages: { news: news.ageSeconds, wikipedia: wiki.ageSeconds },
    })

    /*
     * A resolved portrait beats whatever the roster file happens to carry: it
     * came from this person's own Wikidata entity and its licence was checked
     * on the way through. `null` is a real answer — "we looked and there is
     * nothing we may publish" — and it leaves the screen on initials.
     */
    const portrait = portraits[c.id]?.portrait || null

    rows.push({
      id: c.id, displayName: c.displayName, slug: c.slug,
      primaryCategory: c.primaryCategory, secondaryCategories: c.secondaryCategories,
      wikipediaUrl: c.wikipediaUrl,
      imageUrl: portrait?.url ?? c.imageUrl ?? null,
      imageCredit: portrait?.credit ?? c.imageCredit ?? null,
      imageLicence: portrait?.licence ?? c.imageLicence ?? null,
      imageLicenceUrl: portrait?.licenceUrl ?? null,
      imageSourceUrl: portrait?.sourceUrl ?? null,
      imageProvider: portrait?.provider ?? null,

      gossipScore: scored.score, raw: scored.raw, confidence: scored.confidence,
      contributions: scored.contributions, droppedSources: scored.droppedSources,
      newsScore: newsPart?.score ?? null, wikipediaScore: wikiPart?.score ?? null, breadthScore: breadthPart?.score ?? null,
      momentum: mom.momentum, velocity1h: mom.velocityRecent, acceleration: mom.acceleration,

      mentions, windowMentions,
      uniqueSources: m.uniqueSources ?? prev?.uniqueSources ?? 0,
      uniqueCountries: m.uniqueCountries ?? prev?.uniqueCountries ?? 0,
      rawArticles: m.rawArticles ?? null, largestCluster: m.largestCluster ?? null, matchRate: m.matchRate ?? null,
      deviationZ: newsPart?.z ?? null,
      baselines: { '7d': baselines['7d'], '30d': baselines['30d'], daysOfHistory: baselines.daysOfHistory },
      newEntry: baselines.daysOfHistory < 7,
      drivers: m.drivers ?? prev?.drivers ?? [],

      change24h: null, change7d: null,
      sources: {
        news: { at: news.carried ? prev?.sources?.news?.at : new Date(now).toISOString(), freshnessSeconds: news.ageSeconds, confidence: news.value?.confidence ?? null, ok: Boolean(news.value), value: news.value, meta: undefined },
        // `ok` says whether the score HAS a Wikipedia reading behind it, not
        // whether one arrived in this particular fifteen minutes — otherwise
        // the screen reads "unavailable" for a figure that is contributing.
        wikipedia: { at: wiki.carried ? prev?.sources?.wikipedia?.at : new Date(now).toISOString(), freshnessSeconds: wiki.ageSeconds, confidence: wiki.value?.confidence ?? null, ok: Boolean(wiki.value) || wikiPart != null, value: wiki.value },
      },
    })
  }

  /* ---------------- status, rank, changes ---------------- */
  const zs = rows.map((r) => r.deviationZ).filter(Number.isFinite)
  for (const r of rows) {
    r.status = classify({
      score: r.gossipScore, momentum: r.momentum, confidence: r.confidence,
      deviationPercentile: percentileOf(r.deviationZ ?? 0, zs), newEntry: r.newEntry,
    })
  }

  const ranked = rankMarket(rows, previous, { now })

  // 24-hour and 7-day change come from stored history, not from guesswork —
  // and from the history already loaded above rather than reading it again.
  for (const r of ranked) {
    const { rollup, intraday } = histories.get(r.id) || { rollup: { days: [] }, intraday: [] }
    const dayOld = intraday.filter((p) => {
      const t = Date.parse(p.timestamp)
      return t >= now - 25 * 3600000 && t <= now - 23 * 3600000
    })
    if (dayOld.length) r.change24h = Number((r.gossipScore - dayOld.at(-1).gossipScore).toFixed(2))
    const weekOld = rollup.days.at(-7)
    if (weekOld) r.change7d = Number((r.gossipScore - weekOld.close).toFixed(2))
  }

  /* ---------------- persist ---------------- */
  /*
   * A run that could not read the news has nothing to say. With a previous
   * market it says it by carrying every value forward with its freshness
   * clock running, which is the normal path. With no previous market there is
   * nothing to carry, and if no other source measured anything either then
   * every row above is a placeholder zero — so publishing would put a board
   * of zeros in front of everyone and, worse, seed the next tick's history
   * with them. This is what happened at 22:00 on the first day: one GDELT
   * window announced but not yet on the CDN, and the market read zero.
   *
   * A window that was READ and simply contained nobody is a different thing:
   * those zeros are measurements, and they publish.
   */
  if (!newsRun.ok && !previous && collected.wikipedia.size === 0) {
    log.push(`not publishing: the news window could not be read (${newsRun.error}) and there is no previous market to carry forward`)
    return {
      mock: false, published: false, reason: 'no news and no history',
      generatedAt: new Date(now).toISOString(), shard, rows: [], cards: null, summary: null,
      health: await store.readHealth(),
      run: { calls, seconds: Math.round((Date.now() - startedAt) / 1000), log },
    }
  }

  await pool(ranked, 12, async (r) => {
    await store.appendSnapshot(r.id, {
      celebrityId: r.id, timestamp: slot,
      gossipScore: r.gossipScore, newsScore: r.newsScore, wikipediaScore: r.wikipediaScore,
      breadthScore: r.breadthScore, momentumScore: r.momentum, confidence: r.confidence,
      mentionCount: r.mentions, windowMentions: r.windowMentions, measured: newsRun.ok,
      uniqueSourceCount: r.uniqueSources, uniqueCountryCount: r.uniqueCountries,
      wikipediaViews: r.sources?.wikipedia?.value?.raw ?? null,
      rank: r.rank, rankChange: r.rankChange,
      velocity1h: r.velocity1h, acceleration: r.acceleration,
      baseline7d: r.baselines['7d']?.at(-1) ?? null, baseline30d: r.baselines['30d']?.at(-1) ?? null,
      status: r.status,
      freshness: { news: r.sources.news.freshnessSeconds, wikipedia: r.sources.wikipedia.freshnessSeconds },
    })
  })

  const market = {
    mock: false,
    published: true,
    // Which GKG window these numbers came from, so the next tick can tell a
    // new window from one it has already counted.
    newsWindowFile: newsRun.file,
    newsWindowMeasured: newsRun.ok && !newsRun.repeat,
    generatedAt: new Date(now).toISOString(),
    nextUpdateAt: new Date(now + SNAPSHOT_INTERVAL_MINUTES * 60000).toISOString(),
    shard, weights: WEIGHTS,
    rows: ranked.map(({ sources, ...r }) => ({
      ...r,
      // The raw adapter payload stays out of the public market file; the
      // admin endpoint reads it from the per-source cache instead.
      sources: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, { at: v.at, freshnessSeconds: v.freshnessSeconds, confidence: v.confidence, ok: v.ok }])),
    })),
    cards: marketCards(ranked),
    summary: marketSummary(ranked),
    /*
     * How the picture supply is doing, in one glance.
     *
     * `looked` counts the celebrities we have asked about at all, so a low
     * `withPicture` early on reads as "still filling in" rather than as a
     * fault. `refused` is the interesting number: it is almost entirely the
     * personality-rights flag, and if it ever climbs it is worth knowing
     * before every avatar quietly turns back into initials.
     */
    portraits: (() => {
      const looked = Object.values(portraits)
      return {
        roster: roster.length,
        looked: looked.length,
        withPicture: ranked.filter((r) => r.imageUrl).length,
        refused: looked.filter((v) => !v.portrait).length,
        personalityRightsAllowed: PORTRAITS.allowPersonalityRights,
      }
    })(),
    health: await store.readHealth(),
    run: { calls, seconds: Math.round((Date.now() - startedAt) / 1000), log },
  }

  await store.writeMarket(market)
  await store.writeHotList(hotList(ranked, INGEST.hotListSize), (shard + 1) % INGEST.shards)

  /*
   * The week in progress, ranked the same way the published chart is.
   *
   * This is what makes the front page move: the same ranking a reader learns
   * on Monday, in its other state, changing every quarter of an hour until it
   * freezes. It costs nothing extra — every rollup and every snapshot it needs
   * is already in `histories`, loaded once at the top of this run.
   */
  try {
    await writeLiveChart(store, { rows: ranked, histories, now, log })
  } catch (err) {
    // A provisional standing is the least important thing this run produces.
    log.push(`live chart skipped: ${err.message}`)
  }

  log.push(`published ${ranked.length} rows in ${market.run.seconds}s using ${calls} API calls`)
  return market
}

/**
 * Build and store the provisional chart for the week in progress.
 *
 * Today is not in the rollup yet — it is written at 03:00 for the day before —
 * so it is reconstructed from the snapshots taken since midnight. Without that
 * the live chart is permanently a day behind, which on a Monday means it shows
 * nothing at all.
 */
async function writeLiveChart(store, { rows, histories, now, log }) {
  const today = dayKey(now)
  const rollups = {}
  for (const row of rows) {
    const h = histories.get(row.id)
    if (!h) continue
    const days = (h.rollup?.days || []).filter((d) => d.day !== today)
    const partial = partialDay(h.intraday || [], today)
    rollups[row.id] = { days: partial ? [...days, partial] : days }
  }

  const [previous, records] = await Promise.all([
    store.readLatestChart(),
    store.readChartRecords(),
  ])
  const live = buildLiveChart({ rows, rollups, previous, records, now })
  if (!live.entries.length) { log.push('live chart: nobody measured yet'); return null }

  await store.writeLiveChart(live)
  log.push(`live chart: ${live.entries.length} names, ${live.daysCounted} days in, leader ${live.entries[0].displayName}`)
  return live
}

/**
 * The once-a-day job: refresh Wikipedia for everyone, roll yesterday up,
 * write the day's history, update records and prune expired intraday files.
 */
export async function runDaily({ blobs, now = Date.now(), fetchImpl = fetch, roster = activeRoster(), log = [] } = {}) {
  const store = createStore(blobs)
  const yesterday = dayKey(now - 86400000)

  const market = await runMarket({ blobs, shard: null, now, fetchImpl, roster, runWikipedia: true, log })
  // Nothing was published, so there is nothing to roll up and no day to record.
  if (market.published === false) { log.push('daily: skipped — the run published nothing'); return market }

  await pool(roster, 12, async (c) => {
    const points = await store.readSeries(c.id, Date.parse(`${yesterday}T00:00:00Z`), Date.parse(`${yesterday}T23:59:59Z`))
    if (points.length) await store.writeRollupDay(c.id, yesterday, points)
  })

  await store.writeHistoryDay(dayKey(now), market.rows.map((r) => ({
    id: r.id, rank: r.rank, gossipScore: r.gossipScore, momentum: r.momentum, status: r.status, mentions: r.mentions,
  })))
  await store.updateRecords(market.rows, now)
  await settlePrices(store, { rows: market.rows, upTo: yesterday, log })
  const pruned = await store.pruneIntraday(roster.map((c) => c.id), now)
  log.push(`daily: rolled up ${yesterday}, pruned ${pruned.removed} old day files`)
  return market
}

/**
 * Close the exchange for the day.
 *
 * Runs after the rollups, because a price is priced from a finished day and
 * yesterday's only became one a few lines ago. Each name's book gains the
 * days that have closed since last time and keeps everything it already had
 * — see `settle`: once a day is on the board somebody may have traded on it,
 * so it is a fact rather than a derivation.
 *
 * The board is a single snapshot so the exchange page is one read rather
 * than a hundred, the same trick `charts/latest.json` plays for the chart.
 */
async function settlePrices(store, { rows = [], upTo, log = [] } = {}) {
  const board = []
  let added = 0

  await pool(rows, 12, async (row) => {
    const roll = await store.readRollup(row.id)
    const history = (roll?.days || [])
      .map((d) => ({ day: d.day, level: dayLevel(d) }))
      .filter((d) => d.day && Number.isFinite(d.level))
    if (!history.length) return

    const before = await store.readPrices(row.id)
    const book = settle(history, before, { upTo })
    if (!book.days.length) return
    if (book.added > 0 || !before) {
      await store.writePrices(row.id, book)
      added += book.added
    }

    const q = quote(book)
    if (q) board.push({ id: row.id, slug: row.slug, displayName: row.displayName, imageUrl: row.imageUrl ?? null, ...q })
  })

  board.sort((a, b) => b.price - a.price)
  await store.writePriceBoard({ settledOn: upTo, generatedAt: new Date().toISOString(), names: board })
  log.push(`exchange: ${board.length} names priced, ${added} new closes settled up to ${upTo}`)
  return board
}
