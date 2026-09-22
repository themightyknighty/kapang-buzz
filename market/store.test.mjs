import test from 'node:test'
import assert from 'node:assert/strict'
import { createStore, memoryBlobs, snapshotSlot, dayKey, KEYS } from './store.mjs'
import { RETENTION } from './config.mjs'

const point = (t, score, over = {}) => ({
  timestamp: new Date(t).toISOString(), gossipScore: score,
  mentionCount: 10, rank: 5, wikipediaViews: 1000, ...over,
})

const DAY = 86400000

/* ------------------------------------------------------------------ *
 * The archive
 * ------------------------------------------------------------------ */

test('the daily rollup is kept for longer than anyone will be here', () => {
  // This is a decision, not a tuning knob. GDELT and Wikipedia will answer
  // about today and will not answer about a Tuesday nobody recorded, so a
  // pruned rollup is gone for good. A hundred years of one celebrity is a
  // few megabytes; there is nothing to save by lowering this.
  assert.ok(RETENTION.rollupDays >= 36500, `rollupDays is ${RETENTION.rollupDays} — the archive would be pruned`)
})

test('a decade of days survives a write', async () => {
  const store = createStore(memoryBlobs())
  const start = Date.parse('2026-01-01T00:00:00Z')
  // Writing 4,000 days one at a time is slow, so the file is seeded and one
  // more day written through the real path — which is where the slice lives.
  const days = Array.from({ length: 4000 }, (_, i) => ({ day: dayKey(start + i * DAY), close: 50 }))
  const blobs = memoryBlobs({ [KEYS.rollup('x')]: { id: 'x', days } })
  const seeded = createStore(blobs)
  await seeded.writeRollupDay('x', dayKey(start + 4000 * DAY), [point(start + 4000 * DAY, 60)])
  const rollup = await seeded.readRollup('x')
  assert.equal(rollup.days.length, 4001)
  assert.equal(rollup.days[0].day, dayKey(start), 'the oldest day was dropped')
  assert.ok(store)
})

test('only intraday snapshots expire', async () => {
  const blobs = memoryBlobs()
  const store = createStore(blobs)
  const now = Date.parse('2026-09-20T12:00:00Z')
  const old = now - (RETENTION.intradayDays + 1) * DAY

  await store.appendSnapshot('x', point(old, 40))
  await store.writeRollupDay('x', dayKey(old), [point(old, 40)])
  await store.writeHistoryDay(dayKey(old), [{ id: 'x', rank: 1 }])

  await store.pruneIntraday(['x'], now)

  assert.equal(await blobs.getJSON(KEYS.series('x', dayKey(old))), null, 'the snapshots should be gone')
  assert.equal((await store.readRollup('x')).days.length, 1, 'the rollup should not be')
  assert.ok(await store.readHistoryDay(dayKey(old)), 'nor the day of market history')
})

/* ------------------------------------------------------------------ *
 * Snapshots
 * ------------------------------------------------------------------ */

test('a re-run at the same slot replaces rather than duplicates', async () => {
  const store = createStore(memoryBlobs())
  const t = Date.parse('2026-09-20T12:00:00Z')
  await store.appendSnapshot('x', point(t, 40))
  await store.appendSnapshot('x', point(t, 44))
  const series = await store.readSeries('x', t - DAY, t + DAY)
  assert.equal(series.length, 1)
  assert.equal(series[0].gossipScore, 44)
})

test('snapshots land on the quarter hour, so re-runs line up', () => {
  assert.equal(snapshotSlot(Date.parse('2026-09-20T12:07:31Z')), '2026-09-20T12:00:00.000Z')
  assert.equal(snapshotSlot(Date.parse('2026-09-20T12:59:59Z')), '2026-09-20T12:45:00.000Z')
})

test('a window reads across the days it spans and nothing else', async () => {
  const store = createStore(memoryBlobs())
  const t = Date.parse('2026-09-20T12:00:00Z')
  for (const offset of [-2 * DAY, -DAY, 0]) await store.appendSnapshot('x', point(t + offset, 50))
  const series = await store.readSeries('x', t - DAY - 3600_000, t + 1000)
  assert.equal(series.length, 2)
})

/* ------------------------------------------------------------------ *
 * Rollups
 * ------------------------------------------------------------------ */

test('a day collapses to open, close, high, low and the best rank reached', async () => {
  const store = createStore(memoryBlobs())
  const t = Date.parse('2026-09-20T00:00:00Z')
  const entry = await store.writeRollupDay('x', '2026-09-20', [
    point(t, 30, { rank: 9 }),
    point(t + 3600_000, 61, { rank: 3 }),
    point(t + 7200_000, 45, { rank: 6 }),
  ])
  assert.equal(entry.open, 30)
  assert.equal(entry.close, 45)
  assert.equal(entry.high, 61)
  assert.equal(entry.low, 30)
  assert.equal(entry.bestRank, 3)
  assert.equal(entry.samples, 3)
})

test('rolling the same day twice leaves one entry, corrected', async () => {
  const store = createStore(memoryBlobs())
  const t = Date.parse('2026-09-20T00:00:00Z')
  await store.writeRollupDay('x', '2026-09-20', [point(t, 30)])
  await store.writeRollupDay('x', '2026-09-20', [point(t, 30), point(t + 3600_000, 70)])
  const rollup = await store.readRollup('x')
  assert.equal(rollup.days.length, 1)
  assert.equal(rollup.days[0].close, 70)
})

test('a day with no snapshots writes nothing rather than a zero', async () => {
  const store = createStore(memoryBlobs())
  assert.equal(await store.writeRollupDay('x', '2026-09-20', []), null)
  assert.equal((await store.readRollup('x')).days.length, 0)
})

test('days come back in order however they were written', async () => {
  const store = createStore(memoryBlobs())
  const t = Date.parse('2026-09-20T00:00:00Z')
  for (const day of ['2026-09-22', '2026-09-20', '2026-09-21']) {
    await store.writeRollupDay('x', day, [point(t, 50)])
  }
  const rollup = await store.readRollup('x')
  assert.deepEqual(rollup.days.map((d) => d.day), ['2026-09-20', '2026-09-21', '2026-09-22'])
})

/* ================================================================== *
 * The exchange
 * ================================================================== */

test('a price book round-trips, and the board is one read', async () => {
  const store = createStore(memoryBlobs())
  assert.equal(await store.readPrices('ava-lumen'), null, 'an unlisted name has no book')

  await store.writePrices('ava-lumen', {
    listedAt: 20, listedOn: '2026-09-01',
    days: [{ day: '2026-09-01', price: 20, change: 0 }, { day: '2026-09-02', price: 23.6, change: 18 }],
  })
  const book = await store.readPrices('ava-lumen')
  assert.equal(book.id, 'ava-lumen', 'the book knows whose it is')
  assert.equal(book.days.length, 2)
  assert.equal(book.days[1].price, 23.6)

  await store.writePriceBoard({ settledOn: '2026-09-02', names: [{ id: 'ava-lumen', price: 23.6 }] })
  const board = await store.readPriceBoard()
  assert.equal(board.names.length, 1)
  assert.equal(board.settledOn, '2026-09-02')
})

test('one name’s book cannot overwrite another’s', async () => {
  // They key off the celebrity id, which never changes once assigned.
  const store = createStore(memoryBlobs())
  await store.writePrices('a', { days: [{ day: '2026-09-01', price: 10 }] })
  await store.writePrices('b', { days: [{ day: '2026-09-01', price: 99 }] })
  assert.equal((await store.readPrices('a')).days[0].price, 10)
  assert.equal((await store.readPrices('b')).days[0].price, 99)
})
