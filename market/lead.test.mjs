import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickLead, candidates, THIN_PENALTY } from './lead.mjs'

const entry = (over = {}) => ({
  id: 'a', slug: 'a', displayName: 'A', rank: 40, score: 40, lastWeek: 40, move: 0,
  status: 'same', weeksOn: 3, weeksAtOne: 0, peak: 40, ...over,
})
const edition = (entries, id = '2026-W38') => ({ id, label: '14–20 September 2026', entries })

/** A chart where nothing at all is happening, so one rule can be added at a time. */
const quiet = (extra = []) => edition([
  entry({ id: 'top', displayName: 'Top', rank: 1, lastWeek: 1, weeksAtOne: 3 }),
  ...Array.from({ length: 8 }, (_, i) => entry({ id: `n${i}`, displayName: `N${i}`, rank: i + 2, lastWeek: i + 2 })),
  ...extra,
])

const mature = { __bests: { editions: 40, climb: { places: 30, name: 'Old', weekId: '2026-W10' }, newEntry: { rank: 3, name: 'Old', weekId: '2026-W10' }, reign: { weeks: 20, name: 'Old', weekId: '2026-W10' }, tenure: { weeks: 40, name: 'Old', weekId: '2026-W10' }, score: { score: 99, name: 'Old', weekId: '2026-W10' }, fall: { places: 40, name: 'Old', weekId: '2026-W10' } } }

const kindOf = (out) => out.lead.kind

/* ================================================================== *
 * There is always a lead
 * ================================================================== */

test('a week where nothing happened still has a story', () => {
  /*
   * The property that matters most. A chart that publishes fifty-two times a
   * year will have quiet weeks, and "no lead this week" is not something a
   * scheduled job can hand to a reader.
   */
  const out = pickLead({ edition: quiet(), records: mature })
  assert.ok(out.lead)
  assert.ok(out.lead.strength > 0)
  assert.equal(kindOf(out), 'numberOne', 'and it falls back to who is on top')
})

test('an empty edition has no lead rather than a broken one', () => {
  assert.equal(pickLead({ edition: null }), null)
  assert.deepEqual(candidates({ edition: { entries: [] } }), [])
})

/* ================================================================== *
 * The order of importance
 * ================================================================== */

test('a record beats a crown, a crown beats a climb, a climb beats a fall', () => {
  const withClimb = quiet([entry({ id: 'c', displayName: 'C', rank: 12, lastWeek: 30, move: 18, status: 'up' })])
  const climb = pickLead({ edition: withClimb, records: mature })
  assert.equal(kindOf(climb), 'climb')

  const withCrown = edition([
    entry({ id: 'new', displayName: 'New', rank: 1, lastWeek: 4, move: 3, status: 'up', weeksAtOne: 1 }),
    entry({ id: 'old', displayName: 'Old', rank: 2, lastWeek: 1, move: -1, status: 'down' }),
    ...withClimb.entries.slice(1),
  ])
  const crown = pickLead({
    edition: withCrown, records: mature,
    previous: edition([{ id: 'old', slug: 'old', displayName: 'Old', rank: 1, weeksAtOne: 9 }], '2026-W37'),
  })
  assert.equal(kindOf(crown), 'crown', 'a change at the top outranks a big climb')

  const withRecord = edition([entry({ id: 'r', displayName: 'R', rank: 2, lastWeek: 48, move: 46, status: 'up' }), ...withCrown.entries])
  const record = pickLead({
    edition: withRecord, records: mature,
    previous: edition([{ id: 'old', slug: 'old', displayName: 'Old', rank: 1, weeksAtOne: 9 }], '2026-W37'),
  })
  assert.equal(kindOf(record), 'record', 'and an all-time record beats everything')
  assert.ok(record.lead.strength > crown.lead.strength)
})

test('a fall never outranks the same-sized climb', () => {
  const up = pickLead({ edition: quiet([entry({ id: 'c', rank: 12, lastWeek: 32, move: 20, status: 'up' })]), records: mature })
  const down = pickLead({ edition: quiet([entry({ id: 'f', rank: 32, lastWeek: 12, move: -20, status: 'down' })]), records: mature })
  assert.ok(up.lead.strength > down.lead.strength,
    'a chart that leads on who is finished every week is not one anybody enjoys')
})

test('the same climb into the top ten is worth more than into the fifties', () => {
  const high = candidates({ edition: quiet([entry({ id: 'h', rank: 6, lastWeek: 26, move: 20, status: 'up' })]), records: mature })
  const low = candidates({ edition: quiet([entry({ id: 'l', rank: 56, lastWeek: 76, move: 20, status: 'up' })]), records: mature })
  const s = (c) => c.find((x) => x.kind === 'climb').strength
  assert.ok(s(high) > s(low))
})

/* ================================================================== *
 * A young archive does not boast
 * ================================================================== */

test('a record set in the first month is not led on as a record', () => {
  const fresh = pickLead({
    edition: quiet([entry({ id: 'c', rank: 2, lastWeek: 48, move: 46, status: 'up' })]),
    records: { __bests: { editions: 2 } },
  })
  assert.notEqual(kindOf(fresh), 'record', '"our biggest ever" in week two is a joke')
  assert.equal(kindOf(fresh), 'climb', 'it is still the biggest climb of the week')
})

/* ================================================================== *
 * Thin evidence never carries a week
 * ================================================================== */

test('a thin climb is damped, so a solid smaller story beats it', () => {
  const thinBig = entry({ id: 'thin', displayName: 'Thin', rank: 8, lastWeek: 44, move: 36, status: 'up', movement: { thin: true } })
  const solidCrown = [
    entry({ id: 'new', displayName: 'New', rank: 1, lastWeek: 3, move: 2, status: 'up', weeksAtOne: 1 }),
    entry({ id: 'old', displayName: 'Old', rank: 3, lastWeek: 1, move: -2, status: 'down' }),
  ]
  const out = pickLead({
    edition: edition([...solidCrown, thinBig]),
    previous: edition([{ id: 'old', slug: 'old', displayName: 'Old', rank: 1, weeksAtOne: 4 }], '2026-W37'),
    records: mature,
  })
  assert.equal(kindOf(out), 'crown', 'thirty-six places on one outlet does not lead the week')
  const climb = out.also.find((c) => c.kind === 'climb')
  assert.equal(climb.thin, true)
})

test('a thin story can still lead a week where nothing else happened', () => {
  // Damped, not silenced. The score is the score and the name did move.
  const out = pickLead({
    edition: quiet([entry({ id: 'thin', displayName: 'Thin', rank: 9, lastWeek: 30, move: 21, status: 'up', movement: { thin: true } })]),
    records: mature,
  })
  assert.equal(kindOf(out), 'climb')
  assert.equal(out.lead.thin, true)
})

test('a thin move never gets into the record book', () => {
  /*
   * A damped lead is a judgement about one Monday. A record is a claim that
   * stands forever and that every later superlative is measured against, so
   * a climb we ourselves could not corroborate must not be able to set one.
   */
  const bigThin = entry({ id: 'thin', displayName: 'Thin', rank: 2, lastWeek: 90, move: 88, status: 'up', movement: { thin: true } })
  const out = candidates({ edition: quiet([bigThin]), records: mature })
  assert.ok(!out.some((c) => c.kind === 'record'), 'eighty-eight places on one outlet is not a record')
  assert.ok(out.some((c) => c.kind === 'climb'), 'but it is still the week\u2019s biggest climb')
})

test('the damping is applied to the strength, not by dropping the candidate', () => {
  const solid = candidates({ edition: quiet([entry({ id: 'c', rank: 9, lastWeek: 40, move: 31, status: 'up' })]), records: mature })
  const thin = candidates({ edition: quiet([entry({ id: 'c', rank: 9, lastWeek: 40, move: 31, status: 'up', movement: { thin: true } })]), records: mature })
  const s = (c) => c.find((x) => x.kind === 'climb').strength
  assert.equal(s(thin), Math.round(s(solid) * THIN_PENALTY))
})

/* ================================================================== *
 * The measures that need history
 * ================================================================== */

const snapshot = (over = {}) => ({
  concentration: { halfCount: 20, top10Share: 30, leader: 'Top' },
  categories: { shares: [{ category: 'music', label: 'Music', share: 30 }, { category: 'sport', label: 'Sport', share: 10 }] },
  gap: { measured: 60, widest: { displayName: 'Wanted', gap: 40, slug: 'wanted' } },
  rivalries: [],
  churn: { rate: 8, arrived: 8, left: 8 },
  ...over,
})

test('concentration leads only when it is a high or low across real history', () => {
  const history = Array.from({ length: 8 }, () => ({ concentration: { halfCount: 30 } }))
  const record = candidates({ edition: quiet(), records: mature, snapshot: snapshot(), history })
  assert.ok(record.some((c) => c.kind === 'concentration'), '20 is narrower than any of the eight weeks before')

  const ordinary = candidates({
    edition: quiet(), records: mature,
    snapshot: snapshot({ concentration: { halfCount: 30 } }), history,
  })
  assert.ok(!ordinary.some((c) => c.kind === 'concentration'), 'matching the past is not news')
})

test('nothing that needs history fires before there is any', () => {
  const cold = candidates({ edition: quiet(), records: mature, snapshot: snapshot(), history: [] })
  for (const kind of ['concentration', 'category', 'churn']) {
    assert.ok(!cold.some((c) => c.kind === kind), `${kind} fired with no history behind it`)
  }
  assert.ok(cold.length > 0, 'and the week still has a lead')
})

test('the gap leads only on a real disagreement, not on noise', () => {
  const big = candidates({ edition: quiet(), records: mature, snapshot: snapshot() })
  assert.ok(big.some((c) => c.kind === 'gap'))

  const small = candidates({
    edition: quiet(), records: mature,
    snapshot: snapshot({ gap: { measured: 60, widest: { displayName: 'Meh', gap: 6 } } }),
  })
  assert.ok(!small.some((c) => c.kind === 'gap'), 'six places apart out of sixty is nothing')
})

/* ================================================================== *
 * The sidebars
 * ================================================================== */

test('the stories under the lead are about other people', () => {
  const out = pickLead({
    edition: quiet([entry({ id: 'star', displayName: 'Star', rank: 2, lastWeek: 44, move: 42, status: 'up' })]),
    records: mature,
    snapshot: snapshot(),
  })
  assert.ok(out.also.length > 0)
  for (const c of out.also) {
    if (c.entry) assert.notEqual(c.entry.id, out.lead.entry.id, 'three items about one person is one item')
  }
})

test('the pick is deterministic when two rules tie', () => {
  const input = { edition: quiet([entry({ id: 'c', rank: 12, lastWeek: 30, move: 18, status: 'up' })]), records: mature, snapshot: snapshot() }
  const a = pickLead(input)
  const b = pickLead(input)
  assert.deepEqual(a.lead.rule, b.lead.rule)
  assert.deepEqual(a.also.map((x) => x.rule), b.also.map((x) => x.rule))
})

test('the pick carries the week it is about', () => {
  const out = pickLead({ edition: quiet(), records: mature })
  assert.equal(out.weekId, '2026-W38')
  assert.equal(out.label, '14–20 September 2026')
  assert.ok(out.considered >= 1)
})
