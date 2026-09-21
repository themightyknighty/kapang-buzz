import { test } from 'node:test'
import assert from 'node:assert/strict'
import { milestonesIn, nextBests, bestsBefore, weeksBetween } from './milestones.mjs'

const entry = (over = {}) => ({
  id: 'a', slug: 'a', displayName: 'A', rank: 1, score: 60, lastWeek: 2, move: 1,
  status: 'up', weeksOn: 3, weeksAtOne: 1, peak: 1, ...over,
})
const edition = (entries, id = '2026-W38') => ({ id, entries })

const kinds = (out) => out.records.map((r) => r.kind)
const marks = (out) => out.milestones.map((m) => m.kind)

/* ================================================================== *
 * The first edition
 * ================================================================== */

test('with nothing to beat, every best is a first rather than a record', () => {
  /*
   * The launch case. "The biggest climb we have ever recorded" said of a
   * three-week-old archive is true and ridiculous; the copy has to be able
   * to tell the difference, so the flag is set here rather than guessed at
   * later.
   */
  const out = milestonesIn({
    edition: edition([
      entry({ id: 'a', rank: 1, status: 'up', move: 12, lastWeek: 13, weeksAtOne: 1 }),
      entry({ id: 'b', displayName: 'B', rank: 2, status: 'new', move: null, lastWeek: null, weeksOn: 1, weeksAtOne: 0 }),
    ]),
  })
  assert.ok(out.records.every((r) => r.firstEver), 'nothing existed to beat')
  assert.ok(out.records.every((r) => r.young), 'and the archive is too young to boast')
  assert.ok(kinds(out).includes('climb'))
  assert.ok(kinds(out).includes('newEntry'))
})

/* ================================================================== *
 * Beating a record
 * ================================================================== */

const withBests = (bests) => ({ __bests: { editions: 40, ...bests } })

test('a bigger climb than any before it is a record, and names what it beat', () => {
  const out = milestonesIn({
    edition: edition([entry({ status: 'up', move: 44, lastWeek: 45, rank: 1 })]),
    records: withBests({ climb: { places: 22, name: 'Old', weekId: '2026-W12' } }),
  })
  const climb = out.records.find((r) => r.kind === 'climb')
  assert.equal(climb.places, 44)
  assert.equal(climb.firstEver, false)
  assert.equal(climb.young, false)
  assert.deepEqual(climb.previous, { places: 22, name: 'Old', weekId: '2026-W12' })
})

test('a climb that does not beat the record is not reported as one', () => {
  const out = milestonesIn({
    edition: edition([entry({ status: 'up', move: 9, lastWeek: 10, rank: 1 })]),
    records: withBests({ climb: { places: 22, name: 'Old', weekId: '2026-W12' } }),
  })
  assert.ok(!kinds(out).includes('climb'))
})

test('the highest new entry is the lowest rank number, not the highest', () => {
  const out = milestonesIn({
    edition: edition([
      entry({ id: 'x', rank: 4, status: 'new', move: null, lastWeek: null }),
      entry({ id: 'y', displayName: 'Y', rank: 30, status: 'new', move: null, lastWeek: null }),
    ]),
    records: withBests({ newEntry: { rank: 9, name: 'Old', weekId: '2026-W12' } }),
  })
  const ne = out.records.find((r) => r.kind === 'newEntry')
  assert.equal(ne.rank, 4)
  assert.equal(ne.entry.id, 'x')
})

test('a longer reign than any before it is a record', () => {
  const out = milestonesIn({
    edition: edition([entry({ rank: 1, weeksAtOne: 7, status: 'same', move: 0, lastWeek: 1 })]),
    records: withBests({ reign: { weeks: 5, name: 'Old', weekId: '2026-W20' } }),
  })
  assert.equal(out.records.find((r) => r.kind === 'reign').weeks, 7)
})

/* ================================================================== *
 * Milestones that beat nothing but are still worth saying
 * ================================================================== */

test('a reign passing a marked week is a milestone even with a record still standing', () => {
  const out = milestonesIn({
    edition: edition([entry({ rank: 1, weeksAtOne: 4, status: 'same', move: 0, lastWeek: 1 })]),
    records: withBests({ reign: { weeks: 30, name: 'Old', weekId: '2026-W02' } }),
  })
  assert.ok(!kinds(out).includes('reign'), 'four weeks beats nothing')
  const mark = out.milestones.find((m) => m.kind === 'reignMark')
  assert.equal(mark.weeks, 4)
})

test('an unmarked week passes quietly', () => {
  const out = milestonesIn({
    edition: edition([entry({ rank: 1, weeksAtOne: 5, status: 'same', move: 0, lastWeek: 1 })]),
    records: withBests({ reign: { weeks: 30, name: 'Old', weekId: '2026-W02' } }),
  })
  assert.ok(!marks(out).includes('reignMark'), 'five is not a number anybody marks')
})

test('a new number one is the week’s news, and says who it took the crown from', () => {
  const out = milestonesIn({
    edition: edition([entry({ id: 'new', displayName: 'New', rank: 1, status: 'up', move: 2, lastWeek: 3, weeksAtOne: 1 }),
      entry({ id: 'old', displayName: 'Old', rank: 2, status: 'down', move: -1, lastWeek: 1, weeksAtOne: 0 })]),
    previous: edition([{ id: 'old', slug: 'old', displayName: 'Old', rank: 1, weeksAtOne: 6, score: 70 }], '2026-W37'),
    records: withBests({}),
  })
  const crown = out.milestones.find((m) => m.kind === 'crown')
  assert.equal(crown.entry.displayName, 'New')
  assert.equal(crown.deposed.displayName, 'Old')
  assert.equal(crown.deposedReign, 6)
  assert.equal(crown.deposedTo, 2, 'and where the deposed one landed')
})

test('the same name holding the top is not a change of crown', () => {
  const out = milestonesIn({
    edition: edition([entry({ id: 'a', rank: 1, weeksAtOne: 3, status: 'same', move: 0, lastWeek: 1 })]),
    previous: edition([{ id: 'a', slug: 'a', displayName: 'A', rank: 1, weeksAtOne: 2 }], '2026-W37'),
    records: withBests({}),
  })
  assert.ok(!marks(out).includes('crown'))
})

test('a long absence before a return is a comeback', () => {
  const out = milestonesIn({
    edition: edition([entry({ id: 'back', displayName: 'Back', rank: 12, status: 'reentry', move: null, lastWeek: null })], '2026-W38'),
    records: { back: { lastCharted: '2026-W20', peak: 3 }, __bests: { editions: 40 } },
  })
  const cb = out.milestones.find((m) => m.kind === 'comeback')
  assert.equal(cb.away, 18)
  assert.equal(cb.peak, 3)
})

test('a name back after one week off is not a comeback', () => {
  const out = milestonesIn({
    edition: edition([entry({ id: 'back', status: 'reentry', move: null, lastWeek: null, rank: 40 })], '2026-W38'),
    records: { back: { lastCharted: '2026-W37' }, __bests: { editions: 40 } },
  })
  assert.ok(!marks(out).includes('comeback'))
})

/* ================================================================== *
 * Keeping the bests
 * ================================================================== */

test('the bests block carries forward and only moves when beaten', () => {
  const ed = edition([entry({ status: 'up', move: 30, lastWeek: 31, rank: 1, score: 88, weeksAtOne: 2, weeksOn: 9 })])
  const first = nextBests({}, ed)
  assert.equal(first.__bests.climb.places, 30)
  assert.equal(first.__bests.editions, 1)

  const smaller = edition([entry({ status: 'up', move: 4, lastWeek: 5, rank: 1, score: 40, weeksAtOne: 1, weeksOn: 2 })], '2026-W39')
  const second = nextBests(first, smaller)
  assert.equal(second.__bests.climb.places, 30, 'a smaller climb does not overwrite the record')
  assert.equal(second.__bests.editions, 2)
  assert.equal(second.__bests.latest, '2026-W39')
})

test('the bests block never disturbs the per-celebrity records beside it', () => {
  const before = { zendaya: { peak: 3, weeksOn: 9 }, __bests: { editions: 5 } }
  const after = nextBests(before, edition([entry()]))
  assert.deepEqual(after.zendaya, before.zendaya)
})

test('weeks between two chart weeks, across a year boundary', () => {
  assert.equal(weeksBetween('2026-W20', '2026-W38'), 18)
  /*
   * Four, not five. 2025 is a 52-week ISO year — W50, W51, W52, then
   * 2026-W01 — and the only way to get that right is to resolve both ids
   * to real dates. Subtracting week numbers and adding 52 is wrong once
   * every five or six years, which is exactly often enough to embarrass
   * a chart that claims a record.
   */
  assert.equal(weeksBetween('2025-W50', '2026-W02'), 4)
  // 2020 was a 53-week year, so the same span across it is one longer.
  assert.equal(weeksBetween('2020-W50', '2021-W02'), 5)
  assert.equal(weeksBetween('nonsense', '2026-W02'), null)
})

test('an empty edition reports nothing rather than throwing', () => {
  const out = milestonesIn({ edition: null })
  assert.deepEqual(out.records, [])
  assert.deepEqual(out.milestones, [])
  assert.equal(bestsBefore({}).editions, 0)
})
