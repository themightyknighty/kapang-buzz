import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isoWeek, weekIdAt, weekRange, mondayOf, nextWeekId, previousWeekId,
  chartWeekFor, publishAt, weekLabel,
  dayLevel, weekScore, buildChart, nextRecords,
  moveLabel, numberOneLine, ordinal, headline,
  partialDay, buildLiveChart, freezeAt,
} from './chart.mjs'
import { CHART } from './config.mjs'

const DAY = 86400000
const at = (s) => Date.parse(s)

/* ------------------------------------------------------------------ *
 * Weeks
 * ------------------------------------------------------------------ */

test('a week starts on Monday, wherever in it you look', () => {
  const monday = at('2026-09-14T00:00:00Z')
  for (const t of [monday, monday + DAY * 3 + 7 * 3600000, monday + 6 * DAY + 23 * 3600000]) {
    assert.equal(mondayOf(t), monday, new Date(t).toISOString())
  }
})

test('Sunday belongs to the week that is ending, not the one starting', () => {
  // The single most common off-by-one in week code, and it would put a
  // Sunday's news in next week's chart.
  assert.equal(weekIdAt(at('2026-09-20T23:59:59Z')), weekIdAt(at('2026-09-14T00:00:00Z')))
  assert.notEqual(weekIdAt(at('2026-09-21T00:00:00Z')), weekIdAt(at('2026-09-20T23:59:59Z')))
})

test('ISO week numbering is used, so January behaves', () => {
  // 1 January 2027 is a Friday, so it sits in the last week of 2026.
  assert.equal(weekIdAt(at('2027-01-01T12:00:00Z')), '2026-W53')
  // 4 January is always in week 1, by definition.
  assert.equal(isoWeek(at('2026-01-04T12:00:00Z')).week, 1)
  assert.equal(weekIdAt(at('2026-01-01T12:00:00Z')), '2026-W01')
})

test('a week id and a week range are inverses', () => {
  let id = '2026-W01'
  for (let i = 0; i < 120; i++) {
    const r = weekRange(id)
    assert.ok(r, id)
    assert.equal(weekIdAt(r.startsAt), id)
    assert.equal(weekIdAt(r.endsAt), id)
    assert.equal(r.endsAt - r.startsAt, 7 * DAY - 1)
    id = nextWeekId(id)
  }
})

test('stepping back and forward returns where it started', () => {
  for (const id of ['2026-W01', '2026-W38', '2026-W52', '2026-W53', '2027-W01']) {
    if (!weekRange(id)) continue
    assert.equal(nextWeekId(previousWeekId(id)), id, id)
  }
})

test('a week that does not exist is refused rather than rounded', () => {
  assert.equal(weekRange('2025-W53'), null, '2025 has 52 ISO weeks')
  assert.equal(weekRange('2026-W54'), null)
  assert.equal(weekRange('2026-W00'), null)
  assert.equal(weekRange('nonsense'), null)
  assert.equal(weekRange(null), null)
})

test('the chart on the wall is the last week that finished', () => {
  const hour = CHART.publishHourUtc * 3600000
  const monday = at('2026-09-21T00:00:00Z')

  // Monday, after publication: last week is out.
  assert.equal(chartWeekFor(monday + hour), '2026-W38')
  // Monday, an hour before: still last week's chart on the wall.
  assert.equal(chartWeekFor(monday + hour - 3600000), '2026-W37')
  // Midweek: the week just gone.
  assert.equal(chartWeekFor(at('2026-09-24T12:00:00Z')), '2026-W38')
  // Sunday night, before the week has closed: still the previous one.
  assert.equal(chartWeekFor(at('2026-09-27T23:00:00Z')), '2026-W38')
})

test('an edition is due the Monday after its week closes', () => {
  const due = publishAt('2026-W38')
  assert.equal(new Date(due).toISOString(), `2026-09-21T${String(CHART.publishHourUtc).padStart(2, '0')}:00:00.000Z`)
})

test('a week reads as a person would say it', () => {
  assert.equal(weekLabel('2026-W38'), '14–20 September 2026')
  // ...including when it straddles two months.
  assert.equal(weekLabel('2026-W40'), '28 September – 4 October 2026')
})

/* ------------------------------------------------------------------ *
 * A week's score
 * ------------------------------------------------------------------ */

const day = (d, over = {}) => ({ day: d, open: 50, high: 60, low: 40, close: 50, bestRank: 9, ...over })

const WEEK38 = weekRange('2026-W38')

test('a day is its open, high, low and close averaged', () => {
  assert.equal(dayLevel({ open: 10, high: 30, low: 10, close: 30 }), 20)
  assert.equal(dayLevel({ close: 42 }), 42)
  assert.equal(dayLevel({}), null)
})

const level = (d, v) => day(d, { open: v, high: v, low: v, close: v })

test('a week is the average of its days, not Sunday night', () => {
  const days = [
    level('2026-09-14', 10), level('2026-09-15', 10),
    level('2026-09-16', 10), level('2026-09-20', 90),
  ]
  const figure = weekScore(days, { ...WEEK38, minDays: 4 })
  // Seven days, not four. This name has no history, so their absent days sit
  // at the population floor (zero here, nobody else being present) — one
  // enormous Sunday lifts the week without owning it.
  assert.equal(figure.score, 17.1)
  assert.equal(figure.days, 4, 'and it still reports how many were real')
  assert.equal(figure.span, 7)
})

test('a name who turns up for four loud days does not beat one who turns up all week', () => {
  /*
   * The whole complaint, as a test. Averaging only the days that had a
   * reading meant 62/58/70/55 across four days scored 61.3 and beat a
   * steady 48 across seven — the spiky name won because the three days
   * they were absent cost them nothing.
   */
  const spiky = [level('2026-09-16', 62), level('2026-09-17', 58), level('2026-09-18', 70), level('2026-09-19', 55)]
  const steady = Array.from({ length: 7 }, (_, i) => level(`2026-09-${14 + i}`, 48))

  const a = weekScore(spiky, { ...WEEK38, minDays: 4 })
  const b = weekScore(steady, { ...WEEK38, minDays: 4 })
  assert.ok(b.score > a.score, `steady ${b.score} must beat spiky ${a.score}`)
  assert.equal(b.days, 7)
})

test('a day nobody was measured on is an outage, not an absence', () => {
  // Thursday is missing for everyone: the pipeline did not run. Leaving it
  // in the week would mark the whole chart down for a server's bad morning.
  const ran = new Set(['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-18', '2026-09-19', '2026-09-20'])
  const days = ['14', '15', '16', '18', '19', '20'].map((d) => level(`2026-09-${d}`, 40))
  const figure = weekScore(days, { ...WEEK38, minDays: 4, daysRan: ran })
  assert.equal(figure.score, 40, 'every day they were measurable, they were at 40')
  assert.equal(figure.span, 6)
})

test('an absent day is worth their own quiet level, not yesterday and not zero', () => {
  // Thirty quiet days at 20 before the week, then three loud days in it.
  const before = Array.from({ length: 10 }, (_, i) => level(`2026-09-${String(4 + i).padStart(2, '0')}`, 20))
  const inWeek = [level('2026-09-14', 80), level('2026-09-15', 80), level('2026-09-16', 80),
    level('2026-09-17', 80), level('2026-09-18', 80)]
  const figure = weekScore([...before, ...inWeek], { ...WEEK38, minDays: 5 })
  assert.equal(figure.quietLevel, 20)
  // Five days at 80 and two carried at 20 × 0.8 = 16.
  assert.equal(figure.score, Number(((80 * 5 + 16 * 2) / 7).toFixed(1)))
})

test('five measured days is the bar, and four is not', () => {
  const four = ['14', '15', '16', '17'].map((d) => level(`2026-09-${d}`, 70))
  assert.equal(weekScore(four, WEEK38), null, 'four days does not chart')
  assert.ok(weekScore([...four, level('2026-09-18', 70)], WEEK38), 'five does')
})

test('days outside the week do not count', () => {
  const days = [
    day('2026-09-13'), day('2026-09-14'), day('2026-09-15'),
    day('2026-09-16'), day('2026-09-17'), day('2026-09-21'),
  ]
  assert.equal(weekScore(days, { ...WEEK38, minDays: 4 }).days, 4)
})

test('too little data is not a low score, it is no entry', () => {
  // A name added on Friday must not chart on two loud days.
  const days = [day('2026-09-19', { close: 99, open: 99, high: 99, low: 99 }), day('2026-09-20')]
  assert.equal(weekScore(days, { ...WEEK38, minDays: 4 }), null)
  assert.ok(weekScore(days, { ...WEEK38, minDays: 2 }))
})

test('the highest point of the week is reported but never ranked on', () => {
  const figure = weekScore(
    [day('2026-09-14'), day('2026-09-15'), day('2026-09-16'), day('2026-09-17', { high: 95, bestRank: 2 })],
    { ...WEEK38, minDays: 4 },
  )
  assert.equal(figure.highest, 95)
  assert.equal(figure.bestRank, 2)
  // The spike lifts the average a little, because it was part of the week —
  // but nothing like as far as ranking on the peak would have lifted it, and
  // the three days they were not measured sit at their floor rather than
  // vanishing from the arithmetic.
  assert.ok(figure.score < 52.2 && figure.score > 20, `week scored ${figure.score}`)
})

/* ------------------------------------------------------------------ *
 * Building an edition
 * ------------------------------------------------------------------ */

const row = (id, name, over = {}) => ({
  id, slug: id, displayName: name, primaryCategory: 'music',
  drivers: [], mentions: 100, imageUrl: null, ...over,
})

/** Seven flat days at `score`, inside whichever week is being built. */
const flat = (score, weekId = '2026-W38') => {
  const { startsAt } = weekRange(weekId)
  return Array.from({ length: 7 }, (_, i) => day(
    new Date(startsAt + i * DAY).toISOString().slice(0, 10),
    { open: score, high: score, low: score, close: score },
  ))
}

const world = (scores, weekId = '2026-W38') => ({
  rows: Object.keys(scores).map((id) => row(id, id.replace(/(^|-)(\w)/g, (m, a, b) => a + b.toUpperCase()))),
  rollups: Object.fromEntries(Object.entries(scores).map(([id, s]) => [id, { id, days: flat(s, weekId) }])),
})

test('an edition is ranked, numbered from one, and capped', () => {
  const { rows, rollups } = world({ a: 80, b: 60, c: 40, d: 20 })
  const chart = buildChart({ weekId: '2026-W38', rows, rollups, size: 3 })
  assert.deepEqual(chart.entries.map((e) => [e.rank, e.id]), [[1, 'a'], [2, 'b'], [3, 'c']])
  assert.equal(chart.summary.charted, 3)
  assert.equal(chart.summary.eligible, 4)
  assert.equal(chart.id, '2026-W38')
  assert.equal(chart.label, '14–20 September 2026')
})

test('the first edition is all new entries', () => {
  const { rows, rollups } = world({ a: 80, b: 60 })
  const chart = buildChart({ weekId: '2026-W38', rows, rollups })
  assert.ok(chart.entries.every((e) => e.status === 'new'))
  assert.ok(chart.entries.every((e) => e.lastWeek === null && e.move === null))
  assert.ok(chart.entries.every((e) => e.weeksOn === 1))
  assert.equal(chart.summary.newEntries, 2)
  assert.equal(chart.summary.numberOne.displayName, 'A')
})

test('a second edition knows what moved', () => {
  const { rows, rollups } = world({ a: 80, b: 60, c: 40 })
  const first = buildChart({ weekId: '2026-W38', rows, rollups })
  const records = nextRecords({}, first)

  const second = buildChart({
    weekId: '2026-W39', records, previous: first,
    ...world({ a: 30, b: 90, c: 40 }, '2026-W39'),
  })
  const [one, two, three] = second.entries
  assert.equal(one.id, 'b')
  assert.equal(one.status, 'up')
  assert.equal(one.move, 1)
  assert.equal(one.lastWeek, 2)
  assert.equal(two.id, 'c')
  assert.equal(two.move, 1)
  assert.equal(three.id, 'a')
  assert.equal(three.status, 'down')
  assert.equal(three.move, -2)
  assert.equal(second.summary.climbers, 2)
  assert.equal(second.summary.fallers, 1)
  assert.equal(second.summary.biggestClimb.id, 'b')
  assert.equal(second.summary.biggestFall.id, 'a')
})

test('weeks on chart accumulate and a peak is never lost', () => {
  let records = {}
  let previous = null
  let weekId = '2026-W38'
  for (const scores of [{ a: 80, b: 60 }, { a: 20, b: 90 }, { a: 50, b: 70 }]) {
    previous = buildChart({ weekId, records, previous, ...world(scores, weekId) })
    records = nextRecords(records, previous)
    weekId = nextWeekId(weekId)
  }
  const a = previous.entries.find((e) => e.id === 'a')
  assert.equal(a.weeksOn, 3)
  assert.equal(a.peak, 1, 'A was number one in week one and keeps that peak')
  assert.equal(a.rank, 2)
  assert.equal(records.a.peakAt, '2026-W38')
  assert.equal(records.b.weeksAtOne, 2)
})

test('a name that drops out and comes back is a re-entry, not a new entry', () => {
  const first = buildChart({ weekId: '2026-W38', ...world({ a: 80, b: 60 }) })
  let records = nextRecords({}, first)

  // B has a quiet week and is not eligible at all.
  const gone = buildChart({
    weekId: '2026-W39', records, previous: first,
    rows: world({ a: 80, b: 60 }).rows,
    rollups: { a: { days: flat(80, '2026-W39') }, b: { days: [day('2026-09-21')] } },
  })
  assert.equal(gone.entries.length, 1)
  assert.equal(gone.dropped.length, 1)
  assert.equal(gone.dropped[0].displayName, 'B')
  assert.equal(gone.summary.dropped, 1)
  records = nextRecords(records, gone)

  const back = buildChart({
    weekId: '2026-W40', records, previous: gone,
    ...world({ a: 80, b: 99 }, '2026-W40'),
  })
  const b = back.entries.find((e) => e.id === 'b')
  assert.equal(b.status, 'reentry')
  assert.equal(b.lastWeek, null)
  assert.equal(b.weeksOn, 2, 'the week it missed does not count')
  assert.equal(b.peak, 1)
  assert.equal(back.summary.reEntries, 1)
})

test('a tie is broken the same way every time', () => {
  const { rows, rollups } = world({ zara: 50, adam: 50 })
  const a = buildChart({ weekId: '2026-W38', rows, rollups })
  const b = buildChart({ weekId: '2026-W38', rows: [...rows].reverse(), rollups })
  assert.deepEqual(a.entries.map((e) => e.id), b.entries.map((e) => e.id))
  assert.equal(a.entries[0].id, 'adam', 'alphabetical, once everything else is equal')
})

test('a fuller week beats a thinner one at the same score', () => {
  const chart = buildChart({
    weekId: '2026-W38',
    rows: [row('thin', 'Thin'), row('full', 'Full')],
    rollups: {
      thin: { days: flat(50).slice(0, 4) },
      full: { days: flat(50) },
    },
  })
  assert.equal(chart.entries[0].id, 'full')
})

test('an edition built on a looser bar admits it', () => {
  const chart = buildChart({
    weekId: '2026-W38', minDays: 2,
    rows: [row('a', 'A')], rollups: { a: { days: flat(50).slice(0, 2) } },
  })
  assert.equal(chart.provisional, true)
  assert.equal(chart.minDays, 2)
  assert.equal(buildChart({ weekId: '2026-W38', ...world({ a: 50 }) }).provisional, false)
})

test('every name carries the record that explains its own rank', () => {
  const chart = buildChart({
    weekId: '2026-W38',
    ...world({ zendaya: 80 }),
    stories: [{
      id: 's1', headline: 'Zendaya announces a world tour', caption: 'Forty dates.',
      people: ['Zendaya'], publishedAt: '2026-09-20T10:00:00Z', outlets: 30,
    }],
  })
  const m = chart.entries[0].movement
  assert.equal(m.move.to, 1)
  assert.equal(m.week.score, chart.entries[0].score, 'the record explains the number it was ranked on')
  assert.equal(m.week.series.length, 7)
  assert.ok(Array.isArray(m.drivers) && m.drivers.length === 3)
})

test('a story is supporting evidence inside the record, not the explanation', () => {
  const chart = buildChart({
    weekId: '2026-W38',
    ...world({ zendaya: 80 }),
    stories: [{
      id: 's1', headline: 'Zendaya announces a world tour', caption: 'Forty dates.',
      people: ['Zendaya'], publishedAt: '2026-09-20T10:00:00Z', outlets: 30,
    }],
  })
  assert.equal(chart.entries[0].movement.evidence.story.headline, 'Zendaya announces a world tour')
  assert.equal(chart.entries[0].movement.evidence.story.href, '/story/s1')
})

test('a name with no story behind it still explains itself', () => {
  const chart = buildChart({ weekId: '2026-W38', ...world({ a: 80 }) })
  const m = chart.entries[0].movement
  assert.equal(m.evidence.story, null)
  // The point of the rewrite: the explanation does not depend on a story
  // existing, because it was never made of stories.
  assert.ok(Number.isFinite(m.week.score))
  assert.ok(m.week.shape)
})

test('an empty roster is an empty chart, not a crash', () => {
  const chart = buildChart({ weekId: '2026-W38', rows: [], rollups: {} })
  assert.deepEqual(chart.entries, [])
  assert.equal(chart.summary.numberOne, null)
  assert.equal(chart.summary.biggestClimb, null)
})

test('a week that does not exist is refused', () => {
  assert.throws(() => buildChart({ weekId: '2026-W99', rows: [], rollups: {} }), /not a chart week/)
})

/* ------------------------------------------------------------------ *
 * The week in progress
 * ------------------------------------------------------------------ */

test("today's snapshots become today's day, so the live chart is not a day behind", () => {
  const points = [
    { timestamp: '2026-09-23T00:00:00Z', gossipScore: 40 },
    { timestamp: '2026-09-23T12:00:00Z', gossipScore: 70 },
    { timestamp: '2026-09-23T18:00:00Z', gossipScore: 55 },
    { timestamp: '2026-09-22T18:00:00Z', gossipScore: 99 },
  ]
  const d = partialDay(points, '2026-09-23')
  assert.equal(d.open, 40)
  assert.equal(d.close, 55)
  assert.equal(d.high, 70)
  assert.equal(d.low, 40)
  assert.equal(d.samples, 3)
  assert.equal(d.partial, true)
})

test('a day with no snapshots yet is no day, not a zero', () => {
  assert.equal(partialDay([], '2026-09-23'), null)
  assert.equal(partialDay([{ timestamp: '2026-09-22T12:00:00Z', gossipScore: 5 }], '2026-09-23'), null)
})

test("today's day carries what the explanation is made of, not just the score", () => {
  /*
   * The whole reason the live chart could not say why anybody had moved.
   * Every day of the week in progress is a partial day, the evidence record
   * reads mentions, sources and wikipediaViews off each day, and this used to
   * return OHLC alone — so every driver was `now: null`, nothing could have
   * "moved", corroboration was always zero and everyone was flagged thin. A
   * chart that announces a fourteen-place climb and explains nothing.
   */
  const points = [
    { timestamp: '2026-09-23T00:00:00Z', gossipScore: 40, mentionCount: 10, uniqueSourceCount: 3, uniqueCountryCount: 2, wikipediaViews: 900, rank: 12 },
    { timestamp: '2026-09-23T12:00:00Z', gossipScore: 70, mentionCount: 30, uniqueSourceCount: 9, uniqueCountryCount: 5, wikipediaViews: 1400, rank: 4 },
    { timestamp: '2026-09-23T18:00:00Z', gossipScore: 55, mentionCount: 20, uniqueSourceCount: 6, uniqueCountryCount: 3, wikipediaViews: 1100, rank: 7 },
  ]
  const d = partialDay(points, '2026-09-23')
  assert.equal(d.mentions, 20, 'the average across the day, as a finished day does it')
  assert.equal(d.sources, 9, 'the widest it got, not the average')
  assert.equal(d.countries, 5)
  assert.equal(d.wikipediaViews, 1100, 'the latest reading, not a mean of a cumulative counter')
  assert.equal(d.bestRank, 4)
})

test('a partial day is shaped like a finished one, field for field', () => {
  // Read identically downstream, or the evidence record silently sees holes.
  const points = [{ timestamp: '2026-09-23T09:00:00Z', gossipScore: 50, mentionCount: 8, uniqueSourceCount: 4, uniqueCountryCount: 1, wikipediaViews: 700, rank: 9 }]
  const d = partialDay(points, '2026-09-23')
  for (const k of ['day', 'open', 'close', 'high', 'low', 'mentions', 'wikipediaViews', 'sources', 'countries', 'bestRank', 'samples']) {
    assert.ok(k in d, `a finished day has ${k}; a partial one must too`)
  }
})

test('snapshots with nothing but a score still make a usable day', () => {
  // Older intraday files predate these fields. A hole is a null, not a crash.
  const d = partialDay([{ timestamp: '2026-09-23T09:00:00Z', gossipScore: 50 }], '2026-09-23')
  assert.equal(d.close, 50)
  assert.equal(d.mentions, 0)
  assert.equal(d.wikipediaViews, null)
  assert.equal(d.bestRank, null, 'no rank is null, never Infinity')
})

test('the live chart ranks the week in progress against last week', () => {
  // Wednesday of week 39. Week 38 is the published edition.
  const now = at('2026-09-23T18:00:00Z')
  const published = buildChart({ weekId: '2026-W38', ...world({ a: 80, b: 40 }) })

  const days = (score, upto) => flat(score, '2026-W39').slice(0, upto)
  const live = buildLiveChart({
    now,
    previous: published,
    records: nextRecords({}, published),
    rows: world({ a: 80, b: 40 }).rows,
    rollups: { a: { days: days(20, 3) }, b: { days: days(90, 3) } },
  })

  assert.equal(live.id, '2026-W39')
  assert.equal(live.live, true)
  assert.equal(live.provisional, true)
  assert.equal(live.daysCounted, 3)
  assert.equal(live.entries[0].id, 'b')
  assert.equal(live.entries[0].lastWeek, 2)
  assert.equal(live.entries[0].move, 1, 'up one on last week, so far')
})

test('three days of data is enough to be provisional and not enough to be published', () => {
  const now = at('2026-09-23T18:00:00Z')
  const rows = world({ a: 50 }).rows
  const rollups = { a: { days: flat(50, '2026-W39').slice(0, 2) } }

  assert.equal(buildLiveChart({ now, rows, rollups }).entries.length, 1)
  assert.equal(buildChart({ weekId: '2026-W39', rows, rollups }).entries.length, 0)
})

test('a live entry counts only the weeks it has banked', () => {
  const now = at('2026-09-23T18:00:00Z')
  const first = buildChart({ weekId: '2026-W38', ...world({ a: 80 }) })
  const records = nextRecords({}, first)
  assert.equal(records.a.weeksOn, 1)

  const live = buildLiveChart({
    now, previous: first, records,
    rows: world({ a: 80 }).rows,
    rollups: { a: { days: flat(80, '2026-W39').slice(0, 3) } },
  })
  // One banked week, not two — this week is not over and they could still
  // drop out of it.
  assert.equal(live.entries[0].weeksOn, 1)
})

test('the live chart says when it freezes', () => {
  const now = at('2026-09-23T18:00:00Z')
  const live = buildLiveChart({
    now, rows: world({ a: 50 }).rows,
    rollups: { a: { days: flat(50, '2026-W39').slice(0, 3) } },
  })
  assert.equal(live.freezesAt, '2026-09-28T13:00:00.000Z', 'the Monday after this week')
  assert.equal(freezeAt(now), publishAt('2026-W39'))
})

test('an empty week in progress is an empty live chart, not a crash', () => {
  const live = buildLiveChart({ now: at('2026-09-23T18:00:00Z'), rows: [], rollups: {} })
  assert.deepEqual(live.entries, [])
  assert.equal(live.daysCounted, 0)
})

/* ------------------------------------------------------------------ *
 * Reading it back
 * ------------------------------------------------------------------ */

test('the move column says what happened in three characters', () => {
  assert.equal(moveLabel({ status: 'new' }), 'NEW')
  assert.equal(moveLabel({ status: 'reentry' }), 'RE')
  assert.equal(moveLabel({ status: 'up', move: 14 }), '+14')
  assert.equal(moveLabel({ status: 'down', move: -3 }), '−3')
  assert.equal(moveLabel({ status: 'same', move: 0 }), '—')
  assert.equal(moveLabel(null), '')
})

test('the number one gets the right line', () => {
  assert.equal(numberOneLine({ status: 'new', weeksAtOne: 1 }), 'Straight in at number one')
  assert.equal(numberOneLine({ status: 'up', lastWeek: 4, weeksAtOne: 1 }), 'Up from 4th')
  assert.equal(numberOneLine({ status: 'same', lastWeek: 1, weeksAtOne: 3 }), '3rd week at number one')
  assert.equal(numberOneLine({ status: 'reentry', weeksAtOne: 1 }), 'New at number one')
})

test('ordinals do not say 11st', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal),
    ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '111th'])
})

test('the headline names the number one and the chart', () => {
  const chart = buildChart({ weekId: '2026-W38', ...world({ a: 80 }) })
  assert.equal(headline(chart), `A is number one on ${CHART.name}`)
  assert.equal(headline(null), CHART.name)
})
