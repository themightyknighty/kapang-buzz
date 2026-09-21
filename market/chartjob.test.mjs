import test from 'node:test'
import assert from 'node:assert/strict'
import { memoryBlobs, createStore, KEYS } from './store.mjs'
import { publishChart, backfillCharts } from './chartjob.mjs'
import { weekRange, nextWeekId } from './chart.mjs'

const DAY = 86400000

const row = (id, name) => ({
  id, slug: id, displayName: name, primaryCategory: 'music',
  drivers: [], mentions: 100, imageUrl: null,
})

/** A world where `scores` is `{ id: { weekId: score } }`. */
function world(scores, { now = Date.parse('2026-09-21T13:00:00Z') } = {}) {
  const ids = Object.keys(scores)
  const blobs = memoryBlobs({
    'market/current.json': {
      generatedAt: new Date(now).toISOString(),
      rows: ids.map((id) => row(id, id.toUpperCase())),
    },
  })
  const store = createStore(blobs)
  const seed = (async () => {
    for (const [id, weeks] of Object.entries(scores)) {
      const days = []
      for (const [weekId, score] of Object.entries(weeks)) {
        const { startsAt } = weekRange(weekId)
        for (let i = 0; i < 7; i++) {
          days.push({
            day: new Date(startsAt + i * DAY).toISOString().slice(0, 10),
            open: score, high: score, low: score, close: score, bestRank: 5, samples: 96,
          })
        }
      }
      days.sort((a, b) => a.day.localeCompare(b.day))
      await blobs.setJSON(KEYS.rollup(id), { id, days })
    }
  })()
  return { blobs, store, now, ready: seed }
}

/* ------------------------------------------------------------------ *
 * Publishing
 * ------------------------------------------------------------------ */

test('a week is built from the rollups and written once', async () => {
  const w = world({ a: { '2026-W38': 80 }, b: { '2026-W38': 40 } })
  await w.ready
  const log = []
  const out = await publishChart({ blobs: w.blobs, now: w.now, log })

  assert.equal(out.id, '2026-W38')
  assert.equal(out.published, true)
  assert.equal(out.edition.summary.numberOne.id, 'a')
  assert.match(log[0], /number one A/)

  const stored = await w.store.readChart('2026-W38')
  assert.equal(stored.entries.length, 2)
  assert.deepEqual((await w.store.readLatestChart()).id, '2026-W38')
  assert.deepEqual((await w.store.readChartIndex()).latest, '2026-W38')
})

test('running it again on the same Monday changes nothing', async () => {
  const w = world({ a: { '2026-W38': 80 } })
  await w.ready
  const first = await publishChart({ blobs: w.blobs, now: w.now })
  const again = await publishChart({ blobs: w.blobs, now: w.now })

  assert.equal(again.published, false)
  assert.equal(again.reason, 'already published')
  assert.equal(again.edition.publishedAt, first.edition.publishedAt, 'the edition was not rewritten')
  assert.equal((await w.store.readChartRecords()).a.weeksOn, 1, 'and nobody gained a week')
})

test('republishing a week on purpose does not double-count its history', async () => {
  // The trap: records already contain this week's run, so applying them again
  // would quietly add a second week-on-chart to every name on it.
  const w = world({ a: { '2026-W38': 80, '2026-W39': 80 } })
  await w.ready
  const monday = Date.parse('2026-09-21T13:00:00Z')
  await publishChart({ blobs: w.blobs, weekId: '2026-W38', now: monday })
  await publishChart({ blobs: w.blobs, weekId: '2026-W39', now: monday + 7 * DAY })
  assert.equal((await w.store.readChartRecords()).a.weeksOn, 2)

  const redone = await publishChart({ blobs: w.blobs, weekId: '2026-W39', now: monday + 7 * DAY, replace: true })
  assert.equal(redone.published, true)
  assert.equal(redone.replaced, true)
  assert.equal(redone.edition.entries[0].weeksOn, 2, 'still the second week, not the third')
  assert.equal((await w.store.readChartRecords()).a.weeksOn, 2)
})

test('replacing an old edition does not put it on the front page', async () => {
  const w = world({ a: { '2026-W38': 80, '2026-W39': 80 } })
  await w.ready
  const monday = Date.parse('2026-09-21T13:00:00Z')
  await publishChart({ blobs: w.blobs, weekId: '2026-W38', now: monday })
  await publishChart({ blobs: w.blobs, weekId: '2026-W39', now: monday + 7 * DAY })
  await publishChart({ blobs: w.blobs, weekId: '2026-W38', now: monday + 8 * DAY, replace: true })

  assert.equal((await w.store.readLatestChart()).id, '2026-W39')
})

test('a second week knows what moved in the first', async () => {
  const w = world({
    a: { '2026-W38': 80, '2026-W39': 20 },
    b: { '2026-W38': 40, '2026-W39': 90 },
  })
  await w.ready
  const monday = Date.parse('2026-09-21T13:00:00Z')
  await publishChart({ blobs: w.blobs, weekId: '2026-W38', now: monday })
  const second = await publishChart({ blobs: w.blobs, weekId: '2026-W39', now: monday + 7 * DAY })

  assert.equal(second.edition.entries[0].id, 'b')
  assert.equal(second.edition.entries[0].move, 1)
  assert.equal(second.edition.entries[1].move, -1)
  assert.equal(second.edition.previousId, '2026-W38')
})

test('no market means no chart, and says so', async () => {
  const out = await publishChart({ blobs: memoryBlobs(), now: Date.parse('2026-09-21T13:00:00Z') })
  assert.equal(out.published, false)
  assert.equal(out.reason, 'no market')
})

test('a week nobody has enough data for publishes nothing rather than an empty chart', async () => {
  const w = world({ a: { '2026-W38': 80 } })
  await w.ready
  const out = await publishChart({ blobs: w.blobs, weekId: '2026-W37', now: w.now })
  assert.equal(out.published, false)
  assert.equal(out.reason, 'no eligible entries')
  assert.equal(await w.store.readChart('2026-W37'), null)
})

test('a week that never existed is refused', async () => {
  const w = world({ a: { '2026-W38': 80 } })
  await w.ready
  await assert.rejects(
    () => publishChart({ blobs: w.blobs, weekId: '2025-W53', now: w.now }),
    /not a chart week/,
  )
})

test('the record beside a name is frozen into the edition', async () => {
  const w = world({ zendaya: { '2026-W38': 80 } })
  await w.ready
  const out = await publishChart({
    blobs: w.blobs, now: w.now,
    stories: [{
      id: 's1', headline: 'ZENDAYA announces a world tour', caption: 'Forty dates.',
      people: ['ZENDAYA'], publishedAt: '2026-09-20T10:00:00Z', outlets: 30,
    }],
  })
  assert.ok(out.edition.entries[0].movement.week.series.length, 'the week is frozen day by day')
  const stored = await w.store.readChart('2026-W38')
  assert.equal(stored.entries[0].movement.evidence.story.headline, 'ZENDAYA announces a world tour')
  assert.equal(stored.entries[0].movement.week.score, stored.entries[0].score)
})

/* ------------------------------------------------------------------ *
 * Backfill
 * ------------------------------------------------------------------ */

test('the backfill fills every week the data covers, oldest first', async () => {
  const w = world({
    a: { '2026-W36': 50, '2026-W37': 60, '2026-W38': 70 },
    b: { '2026-W36': 40, '2026-W37': 80, '2026-W38': 30 },
  })
  await w.ready
  const log = []
  const out = await backfillCharts({ blobs: w.blobs, now: w.now, log })

  assert.deepEqual(out.weeks.map((x) => x.id), ['2026-W36', '2026-W37', '2026-W38'])
  assert.ok(out.weeks.every((x) => x.published), JSON.stringify(out.weeks))
  assert.equal((await w.store.readChartIndex()).editions.length, 3)
  // Built in order, so week 37 knows about week 36.
  assert.equal((await w.store.readChart('2026-W37')).previousId, '2026-W36')
  assert.equal((await w.store.readChartRecords()).a.weeksOn, 3)
})

test('the backfill stops at the last complete week', async () => {
  const w = world({ a: { '2026-W38': 50, '2026-W39': 50 } })
  await w.ready
  // Tuesday of week 39, so week 39 has not finished.
  const out = await backfillCharts({ blobs: w.blobs, now: Date.parse('2026-09-22T12:00:00Z') })
  assert.deepEqual(out.weeks.map((x) => x.id), ['2026-W38'])
  assert.equal(await w.store.readChart('2026-W39'), null)
})

test('running the backfill twice publishes nothing the second time', async () => {
  const w = world({ a: { '2026-W37': 50, '2026-W38': 50 } })
  await w.ready
  await backfillCharts({ blobs: w.blobs, now: w.now })
  const before = await w.store.readChart('2026-W38')

  const again = await backfillCharts({ blobs: w.blobs, now: w.now })
  assert.ok(again.weeks.every((x) => !x.published))
  assert.equal((await w.store.readChart('2026-W38')).publishedAt, before.publishedAt)
  assert.equal((await w.store.readChartRecords()).a.weeksOn, 2, 'not four')
})

test('a backfill with no rollups at all is a no-op, not a crash', async () => {
  const blobs = memoryBlobs({ 'market/current.json': { rows: [row('a', 'A')] } })
  const out = await backfillCharts({ blobs, now: Date.parse('2026-09-21T13:00:00Z') })
  assert.deepEqual(out.weeks, [])
})

/* ------------------------------------------------------------------ *
 * The soft launch
 * ------------------------------------------------------------------ */

test('a provisional edition is marked, and a full one is not', async () => {
  const w = world({ a: { '2026-W38': 80 } })
  await w.ready
  // Only three days of data in the week.
  const rollup = await w.store.readRollup('a')
  await w.blobs.setJSON(KEYS.rollup('a'), { ...rollup, days: rollup.days.slice(0, 3) })

  const thin = await publishChart({ blobs: w.blobs, now: w.now, minDays: 2 })
  assert.equal(thin.published, true)
  assert.equal(thin.edition.provisional, true)
  assert.equal((await w.store.readChartIndex()).editions[0].provisional, true)

  const full = world({ b: { '2026-W38': 80 } })
  await full.ready
  const proper = await publishChart({ blobs: full.blobs, now: full.now })
  assert.equal(proper.edition.provisional, false)
})

test('a name with a thin week does not chart beside names with a full one', async () => {
  const w = world({ full: { '2026-W38': 40 }, thin: { '2026-W38': 99 } })
  await w.ready
  const thin = await w.store.readRollup('thin')
  await w.blobs.setJSON(KEYS.rollup('thin'), { ...thin, days: thin.days.slice(0, 2) })

  const out = await publishChart({ blobs: w.blobs, now: w.now })
  assert.deepEqual(out.edition.entries.map((e) => e.id), ['full'])
})

test('the whole roster is read, whatever its size', async () => {
  const scores = Object.fromEntries(
    Array.from({ length: 40 }, (_, i) => [`c${String(i).padStart(2, '0')}`, { '2026-W38': i }]),
  )
  const w = world(scores)
  await w.ready
  const out = await publishChart({ blobs: w.blobs, now: w.now, size: 25 })
  assert.equal(out.edition.entries.length, 25)
  assert.equal(out.edition.summary.eligible, 40)
  assert.equal(out.edition.entries[0].id, 'c39')
})

test('the previous week is looked up even when it is not the one before in the index', async () => {
  const w = world({ a: { '2026-W38': 50, '2026-W40': 50 } })
  await w.ready
  const monday = Date.parse('2026-09-21T13:00:00Z')
  await publishChart({ blobs: w.blobs, weekId: '2026-W38', now: monday })
  // Week 39 has no data, so nothing publishes; week 40 must not think 38 was
  // last week and report a move against it.
  const skipped = await publishChart({ blobs: w.blobs, weekId: nextWeekId('2026-W38'), now: monday + 7 * DAY })
  assert.equal(skipped.published, false)

  const forty = await publishChart({ blobs: w.blobs, weekId: '2026-W40', now: monday + 14 * DAY })
  assert.equal(forty.edition.entries[0].status, 'reentry')
  assert.equal(forty.edition.entries[0].lastWeek, null)
  assert.equal(forty.edition.entries[0].weeksOn, 2)
})
