import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildEvidence, weekShape, driversOf, changeRatio, topTierCount } from './evidence.mjs'
import { weekRange } from './chart.mjs'

const WEEK = weekRange('2026-W38')          // 14–20 September 2026
const DAY = 86400000

/** A rollup day at a flat level, with the breadth and volume behind it. */
const d = (day, level, over = {}) => ({
  day, open: level, high: level, low: level, close: level,
  mentions: level, sources: 6, countries: 3, wikipediaViews: level * 100, bestRank: 20, ...over,
})

const week = (levels, from = WEEK.startsAt, over = () => ({})) =>
  levels.map((v, i) => (v == null ? null : d(new Date(from + i * DAY).toISOString().slice(0, 10), v, over(i))))
    .filter(Boolean)

/* ------------------------------------------------------------------ *
 * The arithmetic
 * ------------------------------------------------------------------ */

test('a rise from nothing is a real number, not infinity', () => {
  assert.equal(changeRatio(4, 0), 3, 'a base below one is treated as one')
  assert.equal(changeRatio(20, 10), 1)
  assert.equal(changeRatio(5, 10), -0.5)
  assert.equal(changeRatio(null, 10), null)
})

test('top-tier publishers are counted once each', () => {
  assert.equal(topTierCount([{ domain: 'apnews.com' }, { domain: 'apnews.com' }, { domain: 'variety.com' }]), 2)
  assert.equal(topTierCount([{ domain: 'somebodysblog.example' }]), 0)
  assert.equal(topTierCount(), 0)
})

/* ------------------------------------------------------------------ *
 * The shape of a week
 * ------------------------------------------------------------------ */

test('one day carrying the week is a spike, whatever the trend says', () => {
  assert.equal(weekShape({ levels: [5, 5, 5, 90, 5, 5, 5], quiet: 5 }), 'spike')
})

test('a week held above their own normal is sustained', () => {
  assert.equal(weekShape({ levels: [40, 42, 38, 41, 44, 40, 43], quiet: 12 }), 'sustained')
})

test('climbing through the week is building, falling through it is fading', () => {
  assert.equal(weekShape({ levels: [10, 12, 14, 20, 28, 34, 40], quiet: 10 }), 'building')
  assert.equal(weekShape({ levels: [40, 34, 28, 20, 14, 12, 10], quiet: 10 }), 'fading')
})

test('an ordinary week says so rather than inventing a story', () => {
  assert.equal(weekShape({ levels: [20, 21, 20, 19, 20, 21, 20], quiet: 19 }), 'steady')
  assert.equal(weekShape({ levels: [20] }), 'steady', 'too little to have a shape')
})

/* ------------------------------------------------------------------ *
 * What moved
 * ------------------------------------------------------------------ */

test('a signal with no reading last week is reported but never counted as moved', () => {
  // Breadth is in exactly this position for every edition built before the
  // rollup started keeping it.
  const now = week([30, 30, 30, 30, 30, 30, 30])
  const before = now.map((x) => ({ ...x, sources: undefined }))
  const drivers = driversOf(now, before)
  const breadth = drivers.find((x) => x.key === 'breadth')
  assert.equal(breadth.before, null)
  assert.equal(breadth.moved, false, 'we cannot say a number rose without the old one')
  assert.equal(breadth.now, 6, 'but we still say what it is now')
})

test('the drivers that moved share out the movement between them', () => {
  const before = week([10, 10, 10, 10, 10, 10, 10], WEEK.startsAt - 7 * DAY, () => ({ sources: 2, countries: 1 }))
  const now = week([40, 40, 40, 40, 40, 40, 40], WEEK.startsAt, () => ({ sources: 20, countries: 8 }))
  const drivers = driversOf(now, before)
  for (const x of drivers) assert.ok(x.moved, `${x.key} should have moved`)
  const shares = drivers.map((x) => x.share)
  assert.ok(shares.every((s) => s === 0), 'driversOf does not compute shares; buildEvidence does')
})

/* ------------------------------------------------------------------ *
 * The record
 * ------------------------------------------------------------------ */

const record = (over = {}) => buildEvidence({
  rank: 8,
  lastWeek: 23,
  status: 'up',
  figure: { score: 41.2, days: 7, span: 7, quietLevel: 12, highest: 52, bestRank: 6 },
  row: { uniqueSources: 22, uniqueCountries: 7, mentions: 130, drivers: [{ domain: 'apnews.com' }, { domain: 'variety.com' }, { domain: 'someblog.example' }] },
  days: [
    ...week([10, 10, 10, 10, 10, 10, 10], WEEK.startsAt - 7 * DAY, () => ({ sources: 3, countries: 1 })),
    ...week([30, 34, 40, 46, 44, 48, 46], WEEK.startsAt, () => ({ sources: 22, countries: 7 })),
  ],
  range: WEEK,
  previousEntry: { score: 12.4, rank: 23 },
  story: { id: 'x', headline: 'Something happened', outlets: 9 },
  ...over,
})

test('the record says where they moved from and to', () => {
  const r = record()
  assert.deepEqual(r.move, { direction: 'up', from: 23, to: 8, places: 15 })
  assert.equal(r.week.change, 28.8)
})

test('every figure in the record is one that moved the rank', () => {
  const r = record()
  assert.equal(r.week.score, 41.2)
  assert.equal(r.week.days, 7)
  assert.equal(r.evidence.outlets, 22)
  assert.equal(r.evidence.countries, 7)
  assert.equal(r.evidence.topTier, 2, 'AP and Variety; the blog is not top tier')
  assert.equal(r.week.series.length, 7)
  assert.ok(r.week.series.every((p) => p.measured))
  assert.equal(r.week.peak.level, 48)
})

test('a climb visible in more than one signal is not thin', () => {
  const r = record()
  assert.ok(r.corroboration >= 2, `only ${r.corroboration} signals moved`)
  assert.equal(r.thin, false)
  const shares = r.drivers.filter((x) => x.moved).map((x) => x.share)
  assert.ok(Math.abs(shares.reduce((a, b) => a + b, 0) - 1) < 0.01, 'shares add to one')
})

test('a climb visible in one outlet and nowhere else is marked thin', () => {
  /*
   * The case the whole exercise is about. Coverage ticks up on a single
   * outlet, nothing else moves, and the chart must not present that the
   * same way it presents a name covered by thirty newsrooms.
   */
  const thin = record({
    days: [
      ...week([10, 10, 10, 10, 10, 10, 10], WEEK.startsAt - 7 * DAY, () => ({ sources: 1, countries: 1, wikipediaViews: 1000 })),
      ...week([14, 14, 14, 14, 14, 14, 14], WEEK.startsAt, () => ({ sources: 1, countries: 1, wikipediaViews: 1010 })),
    ],
    row: { uniqueSources: 1, uniqueCountries: 1, mentions: 14, drivers: [{ domain: 'someblog.example' }] },
  })
  assert.equal(thin.thin, true)
  assert.ok(thin.corroboration < 2)
  assert.equal(thin.evidence.outlets, 1)
})

test('falling needs no corroboration to be believed', () => {
  const down = record({ rank: 30, lastWeek: 8, status: 'down',
    row: { uniqueSources: 1, uniqueCountries: 1, mentions: 4, drivers: [] } })
  assert.equal(down.move.direction, 'down')
  assert.equal(down.thin, false, 'a fall is not a claim that needs propping up')
})

test('a new entry with real breadth behind it is not thin', () => {
  const fresh = record({ rank: 12, lastWeek: null, status: 'new' })
  assert.equal(fresh.move.direction, 'new')
  assert.equal(fresh.move.places, null)
  assert.equal(fresh.thin, false)
})

test('days nobody measured are shown as gaps, not as zeroes', () => {
  const patchy = record({
    days: week([30, null, 40, null, 44, 48, 46], WEEK.startsAt),
    figure: { score: 30, days: 5, span: 7, quietLevel: 12 },
  })
  assert.equal(patchy.week.series.length, 7)
  assert.equal(patchy.week.series.filter((p) => p.measured).length, 5)
  assert.equal(patchy.week.series[1].level, null)
  assert.equal(patchy.week.days, 5, 'and the record says how many were real')
})

test('the story is supporting evidence, not the explanation', () => {
  const r = record()
  assert.equal(r.evidence.story.headline, 'Something happened')
  assert.equal(r.evidence.story.href, '/story/x')
  const none = record({ story: null })
  assert.equal(none.evidence.story, null)
  assert.ok(none.drivers.some((x) => x.moved), 'the numbers stand without a story behind them')
})

/* ================================================================== *
 * What was actually written
 * ================================================================== */

test('the record carries the coverage the number was counted from', () => {
  /*
   * The gap that made the chart unexplainable: `story` is matched from our
   * own feed after the fact, and the live chart is built without a feed, so
   * it was always null. These are the articles themselves.
   */
  const rec = buildEvidence({
    rank: 1, lastWeek: 15, status: 'up',
    row: {
      mentions: 140,
      drivers: [
        { title: 'Mahomes named player of the week', domain: 'apnews.com', url: 'https://apnews.com/1', firstSeen: '2026-09-21T21:45:00.000Z' },
        { title: null, domain: 'nowhere.test', url: 'https://nowhere.test/2', firstSeen: '2026-09-21T22:00:00.000Z' },
        { title: 'Chiefs quarterback signs extension', domain: 'espn.com', url: 'https://espn.com/3', firstSeen: '2026-09-21T22:15:00.000Z' },
        { title: 'A fourth one', domain: 'bbc.co.uk', url: 'https://bbc.co.uk/4', firstSeen: '2026-09-21T22:30:00.000Z' },
      ],
    },
  })
  assert.equal(rec.evidence.coverage.length, 3, 'three is enough to explain a week')
  assert.equal(rec.evidence.coverage[0].title, 'Mahomes named player of the week')
  assert.equal(rec.evidence.coverage[0].domain, 'apnews.com')
  assert.equal(rec.evidence.coverage[0].at, '2026-09-21T21:45:00.000Z')
})

test('coverage with no drivers is an empty list, never null', () => {
  // The UI maps over it. A null here is a crash on a quiet name.
  for (const row of [{}, { drivers: null }, { drivers: [] }, { drivers: [{ title: 'no url' }] }]) {
    const rec = buildEvidence({ rank: 40, row })
    assert.ok(Array.isArray(rec.evidence.coverage), JSON.stringify(row))
  }
  assert.equal(buildEvidence({ rank: 40, row: { drivers: [{ title: 'no url' }] } }).evidence.coverage.length, 0,
    'an article with no link is not something a reader can be sent to')
})
