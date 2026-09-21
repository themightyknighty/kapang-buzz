/**
 * The market's storage layer.
 *
 * Netlify Blobs is a key-value store with no querying, so the rule is: every
 * screen reads exactly ONE file. Anything a screen needs is assembled here at
 * write time rather than queried at read time.
 *
 * Nothing above this file knows a blob key exists. That is deliberate: if the
 * market outgrows Blobs, this one file is rewritten and the scoring engine,
 * the adapters and the UI are untouched.
 */
import { RETENTION, SNAPSHOT_INTERVAL_MINUTES } from './config.mjs'

export const KEYS = {
  celebrities: 'celebrities.json',
  current: 'market/current.json',
  previous: 'market/previous.json',
  hotlist: 'hotlist.json',
  portraits: 'portraits.json',
  records: 'records.json',
  health: 'health.json',
  series: (id, day) => `series/${id}/${day}.json`,
  rollup: (id) => `series/${id}/rollup.json`,
  history: (day) => `history/${day}.json`,
  source: (adapter, id) => `sources/${adapter}/${id}.json`,

  /* The Genie 100. An edition is written once and never again, so its key is
     the week it covers; `latest` is a copy so the front page is one read, and
     `index` is the list of everything published. */
  chart: (weekId) => `charts/${weekId}.json`,
  chartLatest: 'charts/latest.json',
  /* The week in progress. Rewritten every run and never part of the record —
     a separate key so nothing can confuse a running order with an edition. */
  chartLive: 'charts/live.json',
  chartIndex: 'charts/index.json',
  chartRecords: 'charts/records.json',
}

export const dayKey = (t) => new Date(t).toISOString().slice(0, 10)

/**
 * @param {{getJSON(k):Promise<any>, setJSON(k,v):Promise<void>, delete?(k):Promise<void>}} blobs
 */
export function createStore(blobs) {
  const read = async (k, fallback = null) => {
    try { return (await blobs.getJSON(k)) ?? fallback } catch { return fallback }
  }
  const write = (k, v) => blobs.setJSON(k, v)

  return {
    /* ---------------- roster ---------------- */
    readRoster: () => read(KEYS.celebrities, null),
    writeRoster: (roster) => write(KEYS.celebrities, roster),

    /* ---------------- the market table ---------------- */
    readMarket: () => read(KEYS.current, null),
    async writeMarket(market) {
      const prev = await read(KEYS.current, null)
      if (prev) await write(KEYS.previous, prev)
      await write(KEYS.current, market)
    },
    readPreviousMarket: () => read(KEYS.previous, null),

    /* ---------------- intraday series ---------------- */
    /**
     * Append one snapshot to a celebrity's day file. One file per celebrity
     * per day keeps each write small and each read bounded — a 30-day chart
     * reads the rollup instead of 30 day files.
     */
    async appendSnapshot(id, snapshot) {
      const day = dayKey(snapshot.timestamp)
      const key = KEYS.series(id, day)
      const file = await read(key, { id, day, points: [] })
      // Idempotent: a re-run at the same slot replaces rather than duplicates.
      const at = file.points.findIndex((p) => p.timestamp === snapshot.timestamp)
      if (at >= 0) file.points[at] = snapshot
      else file.points.push(snapshot)
      file.points.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
      await write(key, file)
      return file
    },

    /** Snapshots across a window, reading only the day files it needs. */
    async readSeries(id, fromMs, toMs = Date.now()) {
      const days = []
      for (let t = fromMs; t <= toMs + 86400000; t += 86400000) days.push(dayKey(t))
      const uniq = [...new Set(days)]
      const files = await Promise.all(uniq.map((d) => read(KEYS.series(id, d), null)))
      return files.filter(Boolean).flatMap((f) => f.points)
        .filter((p) => { const t = Date.parse(p.timestamp); return t >= fromMs && t <= toMs })
        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    },

    /* ---------------- daily rollup ---------------- */
    readRollup: (id) => read(KEYS.rollup(id), { id, days: [] }),

    /**
     * Collapse one day of snapshots into a single point. Open/high/low/close
     * plus the day's volume and best rank — enough for every long-range chart
     * and every record feature, in one small file per celebrity.
     */
    async writeRollupDay(id, day, points) {
      if (!points.length) return null
      const scores = points.map((p) => p.gossipScore)
      const entry = {
        day,
        open: scores[0], close: scores.at(-1),
        high: Math.max(...scores), low: Math.min(...scores),
        mentions: Math.round(points.reduce((a, p) => a + (p.mentionCount || 0), 0) / points.length),
        wikipediaViews: points.at(-1).wikipediaViews ?? null,
        /*
         * The widest the day got, not the average of it.
         *
         * Breadth is the one signal that told us nothing historical: the
         * snapshots carried it and the rollup threw it away, so "were they
         * covered more widely this week than last?" — the question that
         * separates a real story from one outlet repeating itself — had no
         * answer at all. Kept from here on; editions before this simply
         * have nulls, which the evidence record handles.
         */
        sources: Math.max(0, ...points.map((p) => p.uniqueSourceCount || 0)),
        countries: Math.max(0, ...points.map((p) => p.uniqueCountryCount || 0)),
        bestRank: Math.min(...points.map((p) => p.rank ?? Infinity)),
        samples: points.length,
      }
      const file = await read(KEYS.rollup(id), { id, days: [] })
      const at = file.days.findIndex((d) => d.day === day)
      if (at >= 0) file.days[at] = entry
      else file.days.push(entry)
      file.days.sort((a, b) => a.day.localeCompare(b.day))
      file.days = file.days.slice(-RETENTION.rollupDays)
      await write(KEYS.rollup(id), file)
      return entry
    },

    /* ---------------- history and records ---------------- */
    writeHistoryDay: (day, rows) => write(KEYS.history(day), { day, rows }),
    readHistoryDay: (day) => read(KEYS.history(day), null),

    /**
     * Running records, updated incrementally so this stays cheap as history
     * grows. The features that use them are not built yet; the data is.
     */
    async updateRecords(ranked, now) {
      const r = await read(KEYS.records, { celebrities: {}, market: {} })
      for (const row of ranked) {
        const c = r.celebrities[row.id] || { highestScore: 0, bestRank: Infinity, daysAtOne: 0 }
        if (row.gossipScore > c.highestScore) { c.highestScore = row.gossipScore; c.highestAt = new Date(now).toISOString() }
        if (row.rank < c.bestRank) { c.bestRank = row.rank; c.bestRankAt = new Date(now).toISOString() }
        if (row.rank === 1) c.daysAtOne = (c.daysAtOne || 0) + 1
        c.lastSeen = new Date(now).toISOString()
        r.celebrities[row.id] = c
      }
      await write(KEYS.records, r)
      return r
    },
    readRecords: () => read(KEYS.records, { celebrities: {}, market: {} }),

    /* ---------------- hot list ---------------- */
    readHotList: () => read(KEYS.hotlist, { ids: [], shard: 0 }),
    writeHotList: (ids, shard) => write(KEYS.hotlist, { ids, shard, at: new Date().toISOString() }),

    /* ---------------- celebrity portraits ---------------- */
    /**
     * One small file for the whole roster rather than one per celebrity: it is
     * read on every run to decide who is due, and 105 reads to answer "who has
     * no picture yet" would cost more than the lookups it saves. Misses are
     * stored too — `{ at, portrait: null }` — so a celebrity Wikidata has no
     * usable photograph for is left alone for a month instead of being asked
     * about every quarter of an hour.
     */
    readPortraits: () => read(KEYS.portraits, {}),
    async mergePortraits(found) {
      if (!found || !Object.keys(found).length) return null
      const all = await read(KEYS.portraits, {})
      Object.assign(all, found)
      await write(KEYS.portraits, all)
      return all
    },

    /* ---------------- per-source cache and health ---------------- */
    readSource: (adapter, id) => read(KEYS.source(adapter, id), null),
    writeSource: (adapter, id, payload) => write(KEYS.source(adapter, id), payload),

    readHealth: () => read(KEYS.health, {}),
    async recordHealth(adapter, { ok, error = null, now = Date.now(), calls = 0 }) {
      const h = await read(KEYS.health, {})
      const cur = h[adapter] || { errors: [] }
      cur.ok = ok
      cur.calls = (cur.calls || 0) + calls
      cur.runs = (cur.runs || 0) + 1
      if (ok) cur.lastSuccess = new Date(now).toISOString()
      else {
        cur.lastFailure = new Date(now).toISOString()
        // A failure with no message is still a failure, but it is not the
        // string "null" — which is what the health page showed for the first
        // real outage, because the reason was never passed down to it.
        cur.errors = [
          { at: new Date(now).toISOString(), error: error == null ? 'failed without a reason' : String(error) },
          ...(cur.errors || []),
        ].slice(0, 25)
      }
      h[adapter] = cur
      await write(KEYS.health, h)
      return h
    },

    /* ---------------- the Genie 100 ---------------- */
    readChart: (weekId) => read(KEYS.chart(weekId), null),
    readLatestChart: () => read(KEYS.chartLatest, null),
    readLiveChart: () => read(KEYS.chartLive, null),
    writeLiveChart: (chart) => write(KEYS.chartLive, chart),
    readChartIndex: () => read(KEYS.chartIndex, { latest: null, editions: [] }),
    readChartRecords: () => read(KEYS.chartRecords, {}),

    /**
     * Publish one edition.
     *
     * A chart that quietly changes after publication is not a chart, so an
     * edition that already exists is left alone unless a human explicitly
     * asks to replace it. The records file and the index move with it, and
     * `latest` only advances — republishing an old week for a backfill must
     * not put last March on the front page.
     */
    async publishChart(edition, records, { replace = false } = {}) {
      const existing = await read(KEYS.chart(edition.id), null)
      if (existing && !replace) {
        return { written: false, reason: 'already published', publishedAt: existing.publishedAt }
      }

      await write(KEYS.chart(edition.id), edition)
      if (records) await write(KEYS.chartRecords, records)

      const latest = await read(KEYS.chartLatest, null)
      if (!latest || edition.id >= latest.id) await write(KEYS.chartLatest, edition)

      const index = await read(KEYS.chartIndex, { latest: null, editions: [] })
      const entry = {
        id: edition.id,
        label: edition.label,
        publishedAt: edition.publishedAt,
        charted: edition.summary.charted,
        provisional: Boolean(edition.provisional),
        numberOne: edition.summary.numberOne
          ? {
            slug: edition.summary.numberOne.slug,
            displayName: edition.summary.numberOne.displayName,
            score: edition.summary.numberOne.score,
          }
          : null,
      }
      const editions = [...index.editions.filter((e) => e.id !== edition.id), entry]
        .sort((a, b) => b.id.localeCompare(a.id))
      await write(KEYS.chartIndex, { latest: editions[0]?.id || null, editions })

      return { written: true, replaced: Boolean(existing) }
    },

    /* ---------------- retention ---------------- */
    /**
     * Blobs has no bulk delete here, so pruning is best-effort: it overwrites
     * expired day files with an empty marker when delete is unavailable.
     */
    async pruneIntraday(ids, now = Date.now()) {
      const cutoff = now - RETENTION.intradayDays * 86400000
      const stale = dayKey(cutoff - 86400000)
      let removed = 0
      for (const id of ids) {
        const key = KEYS.series(id, stale)
        const file = await read(key, null)
        if (!file) continue
        if (blobs.delete) await blobs.delete(key)
        else await write(key, { id, day: stale, points: [], pruned: true })
        removed++
      }
      return { removed, day: stale }
    },
  }
}

/** Snapshots land on a fixed grid, so re-runs overwrite rather than duplicate. */
export function snapshotSlot(now = Date.now(), minutes = SNAPSHOT_INTERVAL_MINUTES) {
  const ms = minutes * 60000
  return new Date(Math.floor(now / ms) * ms).toISOString()
}

/** A file-backed store, so the whole market can be run and tuned on a laptop. */
export function memoryBlobs(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getJSON: async (k) => (data.has(k) ? JSON.parse(JSON.stringify(data.get(k))) : null),
    setJSON: async (k, v) => { data.set(k, JSON.parse(JSON.stringify(v))) },
    delete: async (k) => { data.delete(k) },
    _dump: () => Object.fromEntries(data),
    _keys: () => [...data.keys()],
  }
}
