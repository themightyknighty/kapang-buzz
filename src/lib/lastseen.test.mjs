import test from 'node:test'
import assert from 'node:assert/strict'
import { movesSince, rememberIfStale, saveSeen } from './lastseen.js'
import { remaining } from './countdown.js'

const NOW = Date.parse('2026-09-23T18:00:00Z')
const MIN = 60000

const chart = (order, id = '2026-W39') => ({
  id,
  entries: order.map((name, i) => ({ id: name, rank: i + 1 })),
})

/* ------------------------------------------------------------------ *
 * What moved since last time
 * ------------------------------------------------------------------ */

test('a first visit reports nothing, because nothing has happened yet', () => {
  assert.deepEqual(movesSince(chart(['a', 'b']), null, { now: NOW }), { since: null, moves: {}, count: 0 })
})

test('a name that climbed since last time is reported as a climb', () => {
  const before = { id: '2026-W39', at: NOW - 30 * MIN, ranks: { a: 1, b: 2, c: 3 } }
  const out = movesSince(chart(['c', 'a', 'b']), before, { now: NOW })
  assert.equal(out.count, 3)
  assert.equal(out.moves.c, 2, 'up two')
  assert.equal(out.moves.a, -1)
  assert.equal(out.moves.b, -1)
})

test('names that have not moved are not mentioned', () => {
  const before = { id: '2026-W39', at: NOW - 30 * MIN, ranks: { a: 1, b: 2, c: 3 } }
  const out = movesSince(chart(['a', 'c', 'b']), before, { now: NOW })
  assert.deepEqual(Object.keys(out.moves).sort(), ['b', 'c'])
})

test('a refresh seconds later reports nothing, rather than flashing', () => {
  const before = { id: '2026-W39', at: NOW - 5000, ranks: { a: 2, b: 1 } }
  assert.equal(movesSince(chart(['a', 'b']), before, { now: NOW }).count, 0)
})

test('last week"s snapshot is not compared against this week', () => {
  const before = { id: '2026-W38', at: NOW - 3 * 86400000, ranks: { a: 9 } }
  assert.equal(movesSince(chart(['a', 'b']), before, { now: NOW }).count, 0)
})

test('a name that was not there before is not a move', () => {
  const before = { id: '2026-W39', at: NOW - 30 * MIN, ranks: { a: 1 } }
  const out = movesSince(chart(['a', 'newcomer']), before, { now: NOW })
  assert.deepEqual(out.moves, {})
})

/* ------------------------------------------------------------------ *
 * When the snapshot is replaced
 * ------------------------------------------------------------------ */

test('a recent snapshot stands, so the marks survive a refresh', () => {
  const seen = { id: '2026-W39', at: NOW - 10 * MIN, ranks: { a: 3 } }
  assert.equal(rememberIfStale(chart(['a']), seen, { now: NOW }), seen)
})

test('an old snapshot is replaced, so coming back after lunch measures from lunch', () => {
  const seen = { id: '2026-W39', at: NOW - 90 * MIN, ranks: { a: 3 } }
  const next = rememberIfStale(chart(['a', 'b']), seen, { now: NOW })
  assert.notEqual(next, seen)
  assert.equal(next.at, NOW)
  assert.deepEqual(next.ranks, { a: 1, b: 2 })
})

test('a different week always replaces, however recent', () => {
  const seen = { id: '2026-W38', at: NOW - MIN, ranks: { a: 3 } }
  assert.equal(rememberIfStale(chart(['a'], '2026-W39'), seen, { now: NOW }).id, '2026-W39')
})

test('an empty chart never replaces a good snapshot', () => {
  const seen = { id: '2026-W39', at: NOW - 90 * MIN, ranks: { a: 3 } }
  assert.equal(rememberIfStale({ id: '2026-W39', entries: [] }, seen, { now: NOW }), seen)
})

test('storage being switched off is not an error', () => {
  // Under node there is no localStorage at all, which is the same shape as a
  // browser refusing it: the write is swallowed and the value still returns.
  const snap = saveSeen(chart(['a', 'b']), NOW)
  assert.equal(snap.at, NOW)
  assert.deepEqual(snap.ranks, { a: 1, b: 2 })
})

/* ------------------------------------------------------------------ *
 * The countdown
 * ------------------------------------------------------------------ */

test('the countdown reads like somebody would say it', () => {
  assert.equal(remaining(4 * 86400000 + 6 * 3600000), '4 days 6 hrs')
  assert.equal(remaining(86400000), '1 day')
  assert.equal(remaining(6 * 3600000 + 20 * MIN), '6 hrs 20 min')
  assert.equal(remaining(3600000), '1 hr')
  assert.equal(remaining(18 * MIN), '18 min')
})

test('the last minute still says a minute rather than zero', () => {
  assert.equal(remaining(20000), '1 min')
})
