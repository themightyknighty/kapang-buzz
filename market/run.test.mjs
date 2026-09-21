import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runMarket, selectForRun } from './run.mjs'
import { createStore, memoryBlobs, snapshotSlot, dayKey } from './store.mjs'
import { makeCelebrity, shardOf } from './celebrities.mjs'
import { INGEST, GDELT } from './config.mjs'
import { gdeltFetch, createBreaker, timelinePoints, parseGdeltDate, collect as collectNews } from './adapters/news.mjs'
import { readViews, pageviewsUrl } from './adapters/wikipedia.mjs'

const roster = [
  makeCelebrity({ name: 'Ava Lumen', cat: 'music', page: 'Ava_Lumen' }),
  makeCelebrity({ name: 'Leo Marsh', cat: 'film', page: 'Leo_Marsh' }),
  makeCelebrity({ name: 'Nina Park', cat: 'tv', page: 'Nina_Park' }),
]

const NOW = Date.parse('2026-09-17T14:00:00Z')

/** A news adapter that answers instantly, with no network anywhere near it. */
const fakeNews = (byId, { throws = false } = {}) => ({
  meta: { key: 'news' },
  async collect(celebs, { now }) {
    if (throws) throw new Error('GDELT is down')
    const signals = celebs.filter((c) => byId[c.id]).map((c) => ({
      source: 'news', celebrityId: c.id, timestamp: new Date(now).toISOString(),
      raw: byId[c.id].mentions,
      series: Array.from({ length: 24 }, (_, i) => ({ t: now - (23 - i) * 3600000, v: byId[c.id].curve?.[i] ?? byId[c.id].mentions / 24 })),
      confidence: 0.9, freshnessSeconds: 0,
      meta: {
        mentions: byId[c.id].mentions, weightedMentions: byId[c.id].mentions,
        uniqueSources: byId[c.id].sources ?? 10, uniqueCountries: 3, prominence: 4,
        rawArticles: byId[c.id].mentions, largestCluster: 2, matchRate: 0.9,
        drivers: [{ title: `${c.displayName} does something`, url: 'https://apnews.com/x', publishers: 12, firstSeen: new Date(now).toISOString() }],
      },
    }))
    return { signals, calls: signals.length * 2 }
  },
})

const fakeWiki = (byId) => ({
  meta: { key: 'wikipedia' },
  async collect(celebs, { now }) {
    const signals = celebs.filter((c) => byId[c.id]).map((c) => ({
      source: 'wikipedia', celebrityId: c.id, timestamp: new Date(now).toISOString(),
      raw: byId[c.id], confidence: 0.9, freshnessSeconds: 90000,
      meta: { daily: Array.from({ length: 30 }, () => byId[c.id] * 0.9) },
    }))
    return { signals, calls: signals.length }
  },
})

/* ---------------- sharding ---------------- */

test('shards are stable and cover the whole roster exactly once', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']
  const first = ids.map((i) => shardOf(i, 4))
  const again = ids.map((i) => shardOf(i, 4))
  assert.deepEqual(first, again, 'sharding must not move between runs')
  const seen = new Set()
  for (let s = 0; s < 4; s++) for (const i of ids) if (shardOf(i, 4) === s) seen.add(i)
  assert.equal(seen.size, ids.length, 'every id lands in exactly one shard')
})

test('a run takes its shard plus the hot list, without duplicating anyone', () => {
  const big = Array.from({ length: 40 }, (_, i) => makeCelebrity({ name: `Person ${i}`, cat: 'film', page: `P${i}` }))
  const hot = [big[0].id, big[1].id, big[2].id]
  const due = selectForRun(big, 0, hot)
  assert.equal(new Set(due.map((c) => c.id)).size, due.length, 'no duplicates')
  for (const id of hot) assert.ok(due.some((c) => c.id === id), `${id} should be re-checked`)
  assert.ok(due.length < big.length, 'a shard is not the whole roster')
})

/* ---------------- a full run ---------------- */

test('a run scores, ranks and persists without touching the network', async () => {
  const blobs = memoryBlobs()
  const market = await runMarket({
    blobs, shard: null, now: NOW, roster,
    adapters: {
      news: fakeNews({ 'ava-lumen': { mentions: 900, sources: 40 }, 'leo-marsh': { mentions: 120 }, 'nina-park': { mentions: 30 } }),
      wikipedia: fakeWiki({ 'ava-lumen': 50000, 'leo-marsh': 9000, 'nina-park': 2000 }),
    },
    runWikipedia: true,
  })

  assert.equal(market.mock, false, 'a real run is never flagged as mock')
  assert.equal(market.rows.length, 3)
  assert.deepEqual(market.rows.map((r) => r.rank), [1, 2, 3])
  assert.ok(market.rows.every((r) => r.gossipScore >= 0 && r.gossipScore <= 100))
  assert.ok(market.rows.every((r) => r.status), 'every row is classified')
  assert.ok(market.summary.tracked === 3)

  // The raw adapter payload must not leak into the public market file.
  for (const r of market.rows) {
    assert.equal(r.sources.news.value, undefined, 'raw source payloads stay out of the market file')
      assert.ok(r.sources.news.freshnessSeconds === null || Number.isFinite(r.sources.news.freshnessSeconds))
  }

  const store = createStore(blobs)
  const saved = await store.readMarket()
  assert.equal(saved.rows.length, 3)
  const series = await store.readSeries('ava-lumen', NOW - 3600000, NOW + 3600000)
  assert.equal(series.length, 1, 'one snapshot was stored')
  assert.equal(series[0].timestamp, snapshotSlot(NOW))
})

test('re-running the same slot replaces the snapshot instead of duplicating it', async () => {
  const blobs = memoryBlobs()
  const adapters = {
    news: fakeNews({ 'ava-lumen': { mentions: 500 }, 'leo-marsh': { mentions: 90 }, 'nina-park': { mentions: 20 } }),
    wikipedia: fakeWiki({}),
  }
  await runMarket({ blobs, shard: null, now: NOW, roster, adapters })
  await runMarket({ blobs, shard: null, now: NOW + 60000, roster, adapters })
  const series = await createStore(blobs).readSeries('ava-lumen', NOW - 3600000, NOW + 3600000)
  assert.equal(series.length, 1, 'the same 15-minute slot must hold one snapshot')
})

test('one source failing never stops the market updating', async () => {
  const blobs = memoryBlobs()
  const market = await runMarket({
    blobs, shard: null, now: NOW, roster,
    adapters: { news: fakeNews({}, { throws: true }), wikipedia: fakeWiki({ 'ava-lumen': 50000 }) },
    runWikipedia: true,
  })
  assert.equal(market.rows.length, 3, 'the market still publishes every celebrity')
  const health = await createStore(blobs).readHealth()
  assert.equal(health.news.ok, false)
  assert.ok(health.news.errors.length > 0, 'the failure is recorded, not swallowed')
})

test('a source that was not refreshed carries forward and ages, rather than scoring zero', async () => {
  const blobs = memoryBlobs()
  const adapters = {
    news: fakeNews({ 'ava-lumen': { mentions: 800 }, 'leo-marsh': { mentions: 100 }, 'nina-park': { mentions: 40 } }),
    wikipedia: fakeWiki({}),
  }
  const first = await runMarket({ blobs, shard: null, now: NOW, roster, adapters })
  const scoreBefore = first.rows.find((r) => r.id === 'ava-lumen').gossipScore

  // Nobody is measured this tick.
  const second = await runMarket({
    blobs, shard: null, now: NOW + 900000, roster,
    adapters: { news: fakeNews({}), wikipedia: fakeWiki({}) },
  })
  const row = second.rows.find((r) => r.id === 'ava-lumen')
  assert.equal(row.mentions, 800, 'the previous measurement carries forward')
  assert.ok(row.sources.news.freshnessSeconds >= 900, 'and its freshness clock is running')
  assert.ok(row.gossipScore > 0, `carried-forward data must not collapse the score (was ${scoreBefore}, now ${row.gossipScore})`)
})

test('the hot list is written for the next tick', async () => {
  const blobs = memoryBlobs()
  await runMarket({
    blobs, shard: null, now: NOW, roster,
    adapters: { news: fakeNews({ 'ava-lumen': { mentions: 900 }, 'leo-marsh': { mentions: 120 }, 'nina-park': { mentions: 30 } }), wikipedia: fakeWiki({}) },
  })
  const hot = await createStore(blobs).readHotList()
  assert.ok(hot.ids.length > 0)
  assert.ok(hot.ids.includes('ava-lumen'))
  assert.equal(hot.shard, 1 % INGEST.shards, 'the next shard is queued')
})

/* ---------------- storage ---------------- */

test('the rollup collapses a day into one point', async () => {
  const store = createStore(memoryBlobs())
  const day = '2026-09-16'
  const points = [30, 55, 44, 61].map((v, i) => ({
    celebrityId: 'x', timestamp: `${day}T0${i}:00:00.000Z`, gossipScore: v, mentionCount: v * 3, rank: 5 - i,
  }))
  const entry = await store.writeRollupDay('x', day, points)
  assert.equal(entry.open, 30)
  assert.equal(entry.close, 61)
  assert.equal(entry.high, 61)
  assert.equal(entry.low, 30)
  assert.equal(entry.bestRank, 2)
  const back = await store.readRollup('x')
  assert.equal(back.days.length, 1)
})

test('records accumulate highest score and best rank', async () => {
  const store = createStore(memoryBlobs())
  await store.updateRecords([{ id: 'x', gossipScore: 40, rank: 6 }], NOW)
  await store.updateRecords([{ id: 'x', gossipScore: 91, rank: 1 }], NOW + 900000)
  await store.updateRecords([{ id: 'x', gossipScore: 20, rank: 9 }], NOW + 1800000)
  const r = await store.readRecords()
  assert.equal(r.celebrities.x.highestScore, 91)
  assert.equal(r.celebrities.x.bestRank, 1)
  assert.equal(r.celebrities.x.daysAtOne, 1)
})

test('day keys and snapshot slots land on the grid', () => {
  assert.equal(dayKey(Date.parse('2026-09-17T23:59:00Z')), '2026-09-17')
  assert.equal(snapshotSlot(Date.parse('2026-09-17T14:07:33Z')), '2026-09-17T14:00:00.000Z')
  assert.equal(snapshotSlot(Date.parse('2026-09-17T14:16:00Z')), '2026-09-17T14:15:00.000Z')
})

/* ---------------- adapter internals, no network ---------------- */

test('GDELT rate limits are detected in the body as well as the status', async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls++
    return { ok: true, status: 200, text: async () => 'Your query rate limit has been exceeded. Please wait.' }
  }
  const r = await gdeltFetch('https://example.test', { fetchImpl, retries: 1, backoffMs: 1 })
  assert.equal(r.ok, false)
  assert.equal(r.rateLimited, true)
  assert.equal(calls, 2, 'it retried once, then gave up rather than hammering')
})

test('a non-JSON or error response fails softly', async () => {
  const notJson = await gdeltFetch('https://example.test', { fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<html>' }), retries: 0 })
  assert.equal(notJson.ok, false)
  const http500 = await gdeltFetch('https://example.test', { fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'boom' }), retries: 0 })
  assert.equal(http500.ok, false)
  assert.match(http500.error, /500/)
})

test('the circuit breaker opens after repeated rate limits and then stops asking', () => {
  const b = createBreaker({ trips: 3, cooldownMs: 60000 })
  assert.equal(b.open, false)
  b.hit(); b.hit()
  assert.equal(b.open, false)
  b.hit()
  assert.equal(b.open, true, 'three strikes and it stops')
  b.clear()
  assert.equal(b.open, false, 'a success closes it again')
})

test('GDELT timestamps and timelines parse into usable points', () => {
  assert.equal(parseGdeltDate('20260917T140000Z'), Date.parse('2026-09-17T14:00:00Z'))
  const pts = timelinePoints({ timeline: [{ data: [
    { date: '20260917T130000Z', value: 4 },
    { date: '20260917T140000Z', value: 9 },
  ] }] })
  assert.equal(pts.length, 2)
  assert.ok(pts[1].t > pts[0].t, 'points come back in time order')
  assert.equal(pts[1].v, 9)
  assert.deepEqual(timelinePoints({}), [])
})

test('the GDELT query encodes spaces as %20, never as +', async () => {
  // URLSearchParams uses form encoding, which turns a space into "+". GDELT
  // then searches for the literal string "Timothee+Chalamet", matches nothing,
  // and answers 200 with `{}` — a silent zero that looks like real data.
  let seen = null
  const fetchImpl = async (url) => { seen = url; return { ok: true, status: 200, text: async () => '{"timeline":[{"data":[]}]}' } }
  const celeb = makeCelebrity({ name: 'Ava Lumen', cat: 'music', page: 'Ava_Lumen', aliases: [['Lumen', 'strong']] })
  await collectNews([celeb], { fetchImpl, gapMs: 0, now: NOW })
  assert.ok(seen, 'a request was made')
  assert.ok(!/query=[^&]*\+/.test(seen), `spaces must be %20, got: ${seen}`)
  assert.ok(seen.includes('Ava%20Lumen'), seen)
})

test('a 200 with an empty body is a failure, not zero coverage', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => '{}' })
  const r = await gdeltFetch('https://example.test', { fetchImpl, retries: 0 })
  assert.equal(r.ok, false, 'an empty result must not be scored as real data')
  assert.equal(r.empty, true)
})

test('the backoff never retries faster than GDELT allows', () => {
  // GDELT: "Please limit requests to one every 5 seconds". A 4-second first
  // retry earns another 429 by itself.
  assert.ok(GDELT.backoffMs >= 5000, `backoff starts at ${GDELT.backoffMs}ms`)
  assert.ok(GDELT.gapMs >= 5000, `gap is ${GDELT.gapMs}ms`)
})

test('GDELT\'s own rate-limit wording is recognised', async () => {
  const body = 'Please limit requests to one every 5 seconds or contact kalev.leetaru5@gmail.com for larger queries.'
  const r = await gdeltFetch('https://example.test', { retries: 0, fetchImpl: async () => ({ ok: true, status: 200, text: async () => body }) })
  assert.equal(r.rateLimited, true, 'a 200 carrying the rate-limit notice still counts as rate limited')
  assert.match(r.error, /limit requests/i, 'the error carries what the server said')
})

test('Wikipedia views report their own age honestly', () => {
  const payload = { items: [
    { timestamp: '2026091400', views: 900 },
    { timestamp: '2026091500', views: 1200 },
    { timestamp: '2026091600', views: 4000 },
  ] }
  const v = readViews(payload, Date.parse('2026-09-17T14:00:00Z'))
  assert.equal(v.latest, 4000)
  assert.equal(v.latestDay, '2026-09-16')
  assert.ok(v.ageSeconds > 3600, 'the newest complete day is already hours old — say so')
  assert.equal(v.daily.length, 3)
  assert.equal(readViews({ items: [] }), null)
  assert.match(pageviewsUrl('Taylor Swift', Date.parse('2026-08-01'), Date.parse('2026-09-01')), /Taylor_Swift\/daily\/20260801\/20260901$/)
})

test('attention accumulates across windows rather than resetting each tick', async () => {
  // A 15-minute GKG window holds ~1,400 articles, so a celebrity appearing in
  // 2 of them is not "2 mentions today" — it is one tick of a rolling day.
  const blobs = memoryBlobs()
  const windowAdapter = (perWindow) => ({
    meta: { key: 'news' },
    async collect(celebs, { now }) {
      return {
        signals: celebs.filter((c) => perWindow[c.id]).map((c) => ({
          source: 'news', celebrityId: c.id, timestamp: new Date(now).toISOString(),
          raw: perWindow[c.id], series: null, confidence: 0.95, freshnessSeconds: 0,
          meta: { windowMentions: perWindow[c.id], uniqueSources: 5, uniqueCountries: 0, prominence: 2, matchRate: 1, drivers: [] },
        })),
        calls: 2, files: 1,
      }
    },
  })
  const quiet = { meta: { key: 'wikipedia' }, async collect() { return { signals: [], calls: 0 } } }

  let mentions = []
  for (let i = 0; i < 4; i++) {
    const m = await runMarket({
      blobs, shard: null, now: NOW + i * 900000, roster,
      adapters: { news: windowAdapter({ 'ava-lumen': 3 }), wikipedia: quiet },
    })
    mentions.push(m.rows.find((r) => r.id === 'ava-lumen').mentions)
  }
  assert.deepEqual(mentions, [3, 6, 9, 12], `windows must add up, got ${mentions.join(',')}`)

  // A window where nobody is mentioned must not wipe out the day's total.
  const after = await runMarket({
    blobs, shard: null, now: NOW + 4 * 900000, roster,
    adapters: { news: windowAdapter({}), wikipedia: quiet },
  })
  assert.equal(after.rows.find((r) => r.id === 'ava-lumen').mentions, 12,
    'a quiet window carries the total forward rather than resetting it')
})

test('windows older than a day fall out of the rolling total', async () => {
  const blobs = memoryBlobs()
  const news = {
    meta: { key: 'news' },
    async collect(celebs, { now }) {
      return { signals: [{ source: 'news', celebrityId: 'ava-lumen', timestamp: new Date(now).toISOString(),
        raw: 10, series: null, confidence: 0.95, freshnessSeconds: 0,
        meta: { windowMentions: 10, uniqueSources: 4, uniqueCountries: 0, prominence: 1, matchRate: 1, drivers: [] } }], calls: 2 }
    },
  }
  const quiet = { meta: { key: 'wikipedia' }, async collect() { return { signals: [], calls: 0 } } }
  await runMarket({ blobs, shard: null, now: NOW, roster, adapters: { news, wikipedia: quiet } })
  // A day and a half later, the first window is long out of the window.
  const later = await runMarket({ blobs, shard: null, now: NOW + 36 * 3600000, roster, adapters: { news, wikipedia: quiet } })
  assert.equal(later.rows.find((r) => r.id === 'ava-lumen').mentions, 10,
    'yesterday must not keep counting toward today')
})

test('a stored mock market never seeds a real run', async () => {
  // Values carry forward when a source is quiet, so a mock left in place by a
  // local `--mock` run would launder invented figures into real data.
  const blobs = memoryBlobs()
  await createStore(blobs).writeMarket({
    mock: true,
    generatedAt: new Date(NOW - 900000).toISOString(),
    rows: [{ id: 'ava-lumen', slug: 'ava-lumen', displayName: 'Ava Lumen', mentions: 999999, gossipScore: 98,
      contributions: { news: { value: 99 } }, sources: { news: { at: new Date(NOW - 900000).toISOString() } } }],
  })
  const quiet = { meta: { key: 'x' }, async collect() { return { signals: [], calls: 0 } } }
  const log = []
  const m = await runMarket({ blobs, shard: null, now: NOW, roster, log, adapters: { news: quiet, wikipedia: quiet } })
  const row = m.rows.find((r) => r.id === 'ava-lumen')
  assert.equal(row.mentions, 0, 'the invented figure must not carry forward')
  assert.equal(row.gossipScore, 0)
  assert.ok(log.some((l) => l.includes('mock')), 'and it says so rather than doing it silently')
})

test('momentum measures the rate of coverage, not the running total', async () => {
  // The rolling 24h total climbs for everyone while history fills in. Measured
  // against that, every celebrity reads as "rising rapidly" at the same rate,
  // which is what a real warm-up run showed: momentum 59 for all twelve.
  const steady = { meta: { key: 'news' }, async collect(cs, { now }) {
    return { signals: cs.map((c) => ({ source: 'news', celebrityId: c.id, timestamp: new Date(now).toISOString(),
      raw: 4, series: null, confidence: 0.95, freshnessSeconds: 0,
      meta: { windowMentions: 4, uniqueSources: 3, uniqueCountries: 0, prominence: 1, matchRate: 1, drivers: [] } })), calls: 2 }
  } }
  const quiet = { meta: { key: 'wikipedia' }, async collect() { return { signals: [], calls: 0 } } }

  const blobs = memoryBlobs()
  let last
  for (let i = 0; i < 8; i++) {
    last = await runMarket({ blobs, shard: null, now: NOW + i * 900000, roster, adapters: { news: steady, wikipedia: quiet } })
  }
  const flat = last.rows.find((r) => r.id === 'ava-lumen')
  assert.ok(Math.abs(flat.momentum) < 20,
    `a constant rate of coverage is not momentum, got ${flat.momentum}`)
  assert.ok(last.rows.every((r) => r.mentions === 32), 'the running total still accumulates')

  // Now the rate genuinely accelerates for one celebrity only.
  const surging = { meta: { key: 'news' }, async collect(cs, { now }) {
    return { signals: cs.map((c) => {
      const w = c.id === 'ava-lumen' ? 40 : 4
      return { source: 'news', celebrityId: c.id, timestamp: new Date(now).toISOString(),
        raw: w, series: null, confidence: 0.95, freshnessSeconds: 0,
        meta: { windowMentions: w, uniqueSources: 8, uniqueCountries: 0, prominence: 2, matchRate: 1, drivers: [] } }
    }), calls: 2 }
  } }
  const after = await runMarket({ blobs, shard: null, now: NOW + 8 * 900000, roster, adapters: { news: surging, wikipedia: quiet } })
  const surged = after.rows.find((r) => r.id === 'ava-lumen')
  const others = after.rows.filter((r) => r.id !== 'ava-lumen')
  assert.ok(surged.momentum > 25, `a real surge must register, got ${surged.momentum}`)
  assert.ok(others.every((r) => r.momentum < surged.momentum),
    'and it must not lift everyone else with it')
})

/* ---------------- an unreadable news window ---------------- */

/** A news adapter that reports, honestly, that it could not read the window. */
const brokenNews = () => ({
  meta: { key: 'news' },
  async collect() {
    return { signals: [], calls: 2, files: 0, ok: false, error: 'no GKG window could be read', file: null }
  },
})

test('an unreadable news window never publishes a board of zeros', async () => {
  const blobs = memoryBlobs()
  const market = await runMarket({
    blobs, shard: null, now: NOW, roster,
    adapters: { news: brokenNews(), wikipedia: fakeWiki({}) },
  })
  assert.equal(market.published, false, 'a cold start with no news must not publish')
  assert.equal(market.rows.length, 0)
  const store = createStore(blobs)
  assert.equal(await store.readMarket(), null, 'nothing was written')
  assert.equal((await store.readSeries('ava-lumen', NOW - 3600000, NOW + 3600000)).length, 0, 'and no zero seeded the history')
  const health = await store.readHealth()
  assert.equal(health.news.ok, false)
  assert.match(health.news.errors[0].error, /GKG window/, 'the reason is recorded, not the string "null"')
})

test('an unreadable window leaves a healthy market exactly as it was', async () => {
  const blobs = memoryBlobs()
  const good = fakeNews({ 'ava-lumen': { mentions: 800 }, 'leo-marsh': { mentions: 100 }, 'nina-park': { mentions: 40 } })
  const first = await runMarket({ blobs, shard: null, now: NOW, roster, adapters: { news: good, wikipedia: fakeWiki({}) } })
  const before = first.rows.find((r) => r.id === 'ava-lumen')

  const second = await runMarket({
    blobs, shard: null, now: NOW + 900000, roster,
    adapters: { news: brokenNews(), wikipedia: fakeWiki({}) },
  })
  const after = second.rows.find((r) => r.id === 'ava-lumen')
  assert.equal(second.published, true, 'with history to carry, the market still updates')
  assert.equal(after.mentions, before.mentions, 'the rolling total carries rather than collapsing to zero')
  assert.ok(after.gossipScore > 0)
  assert.ok(after.sources.news.freshnessSeconds >= 900, 'and says how stale it is')
})

test('a quiet window is a measurement, so the rolling total ages instead of freezing', async () => {
  const blobs = memoryBlobs()
  const store = createStore(blobs)
  await runMarket({
    blobs, shard: null, now: NOW, roster,
    adapters: { news: fakeNews({ 'ava-lumen': { mentions: 40 } }), wikipedia: fakeWiki({}) },
  })
  // The window is read; Ava simply is not in it. That is a known zero, not an
  // absence of evidence, so her total is the sum of stored windows and no more.
  const second = await runMarket({
    blobs, shard: null, now: NOW + 900000, roster,
    adapters: { news: fakeNews({}), wikipedia: fakeWiki({}) },
  })
  const row = second.rows.find((r) => r.id === 'ava-lumen')
  assert.equal(row.windowMentions, 0, 'nothing was found for her this window')
  assert.equal(row.mentions, 40, 'and her day still holds the window that did find her')
  const points = await store.readSeries('ava-lumen', NOW - 3600000, NOW + 3600000)
  assert.equal(points.length, 2)
  assert.deepEqual(points.map((p) => p.measured), [true, true])
})

test('the window a run counted is recorded, so the next run can tell it apart', async () => {
  const blobs = memoryBlobs()
  const seen = []
  const adapters = {
    news: {
      meta: { key: 'news' },
      async collect(celebs, { now, alreadyIngested }) {
        seen.push(alreadyIngested)
        return {
          signals: [{ source: 'news', celebrityId: 'ava-lumen', timestamp: new Date(now).toISOString(), raw: 12, series: null, confidence: 0.95, freshnessSeconds: 0, meta: { uniqueSources: 5, uniqueCountries: 0, prominence: 2, drivers: [] } }],
          calls: 2, ok: true, repeat: false, file: '20260917140000.gkg.csv.zip',
        }
      },
    },
    wikipedia: fakeWiki({}),
  }
  const first = await runMarket({ blobs, shard: null, now: NOW, roster, adapters })
  assert.equal(first.newsWindowFile, '20260917140000.gkg.csv.zip')
  await runMarket({ blobs, shard: null, now: NOW + 900000, roster, adapters })
  assert.deepEqual(seen, [null, '20260917140000.gkg.csv.zip'], 'the next run tells the adapter what it already counted')
})

test('a window counted twice is not counted twice', async () => {
  const blobs = memoryBlobs()
  const good = {
    meta: { key: 'news' },
    async collect(celebs, { now, alreadyIngested }) {
      if (alreadyIngested === 'w1.gkg.csv.zip') {
        return { signals: [], calls: 2, files: 0, ok: true, repeat: true, file: 'w1.gkg.csv.zip' }
      }
      return {
        signals: [{ source: 'news', celebrityId: 'ava-lumen', timestamp: new Date(now).toISOString(), raw: 30, series: null, confidence: 0.95, freshnessSeconds: 0, meta: { uniqueSources: 6, uniqueCountries: 0, prominence: 3, drivers: [] } }],
        calls: 2, ok: true, repeat: false, file: 'w1.gkg.csv.zip',
      }
    },
  }
  const adapters = { news: good, wikipedia: fakeWiki({}) }
  const first = await runMarket({ blobs, shard: null, now: NOW, roster, adapters })
  assert.equal(first.rows.find((r) => r.id === 'ava-lumen').mentions, 30)
  const second = await runMarket({ blobs, shard: null, now: NOW + 900000, roster, adapters })
  const row = second.rows.find((r) => r.id === 'ava-lumen')
  assert.equal(row.windowMentions, 0, 'a repeated window contributes nothing new')
  assert.equal(row.mentions, 30, 'so the rolling total does not double')
})

/* ---------------- Wikipedia is never simply absent ---------------- */

import { wikipediaDue } from './run.mjs'

const wikiRow = (id, { at = null, value = null } = {}) => ({
  id,
  contributions: { wikipedia: { value } },
  sources: { wikipedia: { at } },
})

test('a celebrity with no Wikipedia reading at all is first in the queue', () => {
  // The cold start: the market launched, the 03:00 job had not yet fired, and
  // 15% of every score was quietly missing.
  const prev = new Map()
  const due = wikipediaDue(roster, prev, { now: NOW, limit: 10 })
  assert.equal(due.length, roster.length, 'everyone is due when nobody has been read')
})

test('a fresh reading is left alone, a day-old one is refreshed', () => {
  const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString()
  const prev = new Map([
    ['ava-lumen', wikiRow('ava-lumen', { at: hoursAgo(1), value: 40 })],   // fresh
    ['leo-marsh', wikiRow('leo-marsh', { at: hoursAgo(21), value: 30 })],  // stale
    ['nina-park', wikiRow('nina-park', { at: hoursAgo(50), value: 20 })],  // staler
  ])
  const due = wikipediaDue(roster, prev, { now: NOW, refreshHours: 20, limit: 10 })
  assert.deepEqual(due.map((c) => c.id), ['nina-park', 'leo-marsh'], 'longest waiting first')
})

test('a reading whose value never landed counts as missing, not as fresh', () => {
  // `at` is stamped every run whether or not a reading arrived, so the
  // timestamp alone would say "just read" for a celebrity we have never read.
  const prev = new Map([['ava-lumen', wikiRow('ava-lumen', { at: new Date(NOW).toISOString(), value: null })]])
  assert.ok(wikipediaDue(roster, prev, { now: NOW, limit: 10 }).some((c) => c.id === 'ava-lumen'))
})

test('only a handful are read per run, so one tick cannot flood Wikimedia', () => {
  assert.equal(wikipediaDue(roster, new Map(), { now: NOW, limit: 2 }).length, 2)
  assert.equal(wikipediaDue(roster, new Map(), { now: NOW, limit: 0 }).length, 0)
})

test('an ordinary run tops Wikipedia up, and the daily run takes everyone', async () => {
  const asked = []
  const wiki = {
    meta: { key: 'wikipedia' },
    async collect(celebs, { now }) {
      asked.push(celebs.map((c) => c.id))
      return { signals: celebs.map((c) => ({ source: 'wikipedia', celebrityId: c.id, timestamp: new Date(now).toISOString(), raw: 1000, confidence: 0.9, freshnessSeconds: 90000, meta: { daily: Array.from({ length: 30 }, () => 900) } })), calls: celebs.length }
    },
  }
  const blobs = memoryBlobs()
  const adapters = { news: fakeNews({ 'ava-lumen': { mentions: 40 } }), wikipedia: wiki }

  // First ordinary run: nobody has a reading, so everyone is due.
  const first = await runMarket({ blobs, shard: null, now: NOW, roster, adapters })
  assert.deepEqual(asked[0].sort(), roster.map((c) => c.id).sort())
  const row = first.rows.find((r) => r.id === 'ava-lumen')
  assert.ok(row.wikipediaScore != null, 'and the component is no longer dropped')
  assert.ok(!row.droppedSources.includes('wikipedia'))
  assert.equal(row.sources.wikipedia.ok, true)

  // Second run fifteen minutes later: everyone is fresh, so nobody is asked.
  await runMarket({ blobs, shard: null, now: NOW + 900000, roster, adapters })
  assert.equal(asked.length, 1, 'no second sweep — the readings are hours old at most')
})

test('a carried Wikipedia reading still reads as available', async () => {
  const blobs = memoryBlobs()
  const wiki = fakeWiki({ 'ava-lumen': 50000 })
  const first = await runMarket({ blobs, shard: null, now: NOW, roster, adapters: { news: fakeNews({ 'ava-lumen': { mentions: 40 } }), wikipedia: wiki }, runWikipedia: true })
  assert.equal(first.rows.find((r) => r.id === 'ava-lumen').sources.wikipedia.ok, true)

  // A later run that reads nothing from Wikipedia: the score still has a
  // reading behind it, so the screen must not say "unavailable".
  const second = await runMarket({
    blobs, shard: null, now: NOW + 900000, roster,
    adapters: { news: fakeNews({ 'ava-lumen': { mentions: 40 } }), wikipedia: { meta: { key: 'wikipedia' }, collect: async () => ({ signals: [], calls: 0 }) } },
  })
  const row = second.rows.find((r) => r.id === 'ava-lumen')
  assert.equal(row.sources.wikipedia.ok, true, 'carried, not absent')
  assert.ok(row.sources.wikipedia.freshnessSeconds >= 900, 'and it says how old it is')
})
