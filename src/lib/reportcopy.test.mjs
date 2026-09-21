import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeLead, writeWeek, writeGap, writeHalfLife, writeAttention, words } from './reportcopy.js'

const entry = (over = {}) => ({
  id: 'a', slug: 'a', displayName: 'Zendaya', rank: 8, score: 61.3,
  lastWeek: 23, weeksOn: 9, weeksAtOne: 0, peak: 8, ...over,
})

const clean = (s) => {
  if (s == null) return
  assert.ok(!/null|undefined|NaN/.test(s), `printed a hole: ${s}`)
  assert.ok(!/\s{2,}/.test(s), `double space: ${s}`)
}

/* ================================================================== *
 * The voice
 * ================================================================== */

test('small numbers are words in a headline and numerals in a figure', () => {
  assert.equal(words(4), 'four')
  assert.equal(words(12), 'twelve')
  assert.equal(words(41), '41')
})

test('a record names what it beat', () => {
  const said = writeLead({
    kind: 'record', strength: 90,
    record: {
      kind: 'climb', entry: entry(), places: 44, from: 46, to: 2,
      firstEver: false, young: false,
      previous: { places: 30, name: 'Adele', weekId: '2026-W10' },
    },
  })
  assert.equal(said.tag, 'Record')
  assert.match(said.headline, /^44 places in a week$/)
  assert.match(said.standfirst, /Zendaya climbed from 46 to 2/)
  assert.match(said.standfirst, /beats Adele’s 30 places/)
})

test('a first on the board does not call itself a record', () => {
  /*
   * "The biggest climb the chart has ever recorded", said of a chart three
   * weeks old, is both true and ridiculous.
   */
  const said = writeLead({
    kind: 'record', strength: 80,
    record: { kind: 'climb', entry: entry(), places: 44, from: 46, to: 2, firstEver: true, young: true, previous: null },
  })
  assert.equal(said.tag, 'First on the board')
  assert.match(said.note, /Nothing to beat yet/)
  assert.ok(!said.standfirst.includes('beats'))
})

test('a deposed reign agrees with its own number', () => {
  const one = writeLead({ kind: 'crown', strength: 60, crown: { entry: entry({ displayName: 'New' }), deposed: entry({ displayName: 'Old' }), deposedReign: 1, deposedTo: 4 } })
  assert.match(one.standfirst, /held it for a week/)
  const many = writeLead({ kind: 'crown', strength: 70, crown: { entry: entry({ displayName: 'New' }), deposed: entry({ displayName: 'Old' }), deposedReign: 6, deposedTo: 4 } })
  assert.match(many.standfirst, /6 weeks at number one are over/)
  assert.ok(!/weeks .* is over/.test(many.standfirst))
})

test('a thin lead carries its caveat in the tag, where it will be read', () => {
  const said = writeLead({ kind: 'climb', strength: 30, thin: true, places: 21, entry: entry() })
  assert.match(said.tag, /thin/)
  assert.equal(said.thin, true)
})

test('the gap reads in the direction it actually points', () => {
  const pub = writeLead({
    kind: 'gap', strength: 60, direction: 'public', gap: 51, measured: 105,
    pair: { displayName: 'Amy Poehler', searchRank: 14, pressRank: 65, gap: 51 },
  })
  assert.match(pub.headline, /Everybody is looking for Amy Poehler/)

  const press = writeLead({
    kind: 'gap', strength: 60, direction: 'press', gap: 59, measured: 105,
    pair: { displayName: 'Beyoncé', searchRank: 65, pressRank: 6, gap: -59 },
  })
  assert.match(press.headline, /nobody opened/)
  assert.match(press.standfirst, /6 of 105 on coverage/)
})

test('every kind of lead produces a headline, and none of them print a hole', () => {
  const all = [
    { kind: 'record', record: { kind: 'reign', entry: entry(), weeks: 21, firstEver: false, young: false, previous: { weeks: 20, name: 'Old' } } },
    { kind: 'crown', crown: { entry: entry(), deposed: entry({ displayName: 'Old' }), deposedReign: 3, deposedTo: 2 } },
    { kind: 'reign', mark: { entry: entry(), weeks: 4 } },
    { kind: 'climb', places: 22, entry: entry() },
    { kind: 'newEntry', rank: 12, entry: entry() },
    { kind: 'comeback', comeback: { entry: entry(), away: 18, lastSeen: '2026-W20', peak: 3 } },
    { kind: 'collapse', places: 30, entry: entry() },
    { kind: 'concentration', direction: 'narrowest', halfCount: 7, previous: 12, weeks: 9, snapshot: {} },
    { kind: 'category', category: { label: 'Music', share: 31.2, was: 22.4, delta: 8.8 } },
    { kind: 'gap', direction: 'public', measured: 60, pair: { displayName: 'A', searchRank: 3, pressRank: 40, gap: 37 } },
    { kind: 'rivalry', rivalry: { a: { name: 'A' }, b: { name: 'B' }, swaps: 3, closest: 1 } },
    { kind: 'churn', churn: { arrived: 11, left: 11, rate: 11 }, weeks: 9 },
    { kind: 'numberOne', entry: entry({ rank: 1, weeksAtOne: 3 }) },
  ]
  for (const c of all) {
    const said = writeLead({ strength: 50, ...c })
    assert.ok(said, `${c.kind} produced nothing`)
    assert.ok(said.headline.length > 3, c.kind)
    clean(said.headline)
    clean(said.standfirst)
  }
})

test('an unknown kind is silence rather than a broken sentence', () => {
  assert.equal(writeLead({ kind: 'something-new', strength: 40 }), null)
  assert.equal(writeLead(null), null)
  assert.equal(writeWeek(null), null)
})

/* ================================================================== *
 * The whole week
 * ================================================================== */

test('the week carries a lead and the stories under it', () => {
  const week = writeWeek({
    weekId: '2026-W38', label: '14–20 September 2026',
    lead: { kind: 'climb', strength: 60, places: 22, entry: entry() },
    also: [
      { kind: 'numberOne', strength: 12, entry: entry({ displayName: 'Top', rank: 1, weeksAtOne: 2 }) },
      { kind: 'something-new', strength: 5 },
    ],
  })
  assert.equal(week.weekId, '2026-W38')
  assert.match(week.lead.headline, /22 places/)
  assert.equal(week.also.length, 1, 'a kind with nothing to say is dropped, not printed empty')
})

/* ================================================================== *
 * The standing reports
 * ================================================================== */

test('the gap report leads on the widest disagreement and shows both lists', () => {
  const g = writeGap({
    measured: 105,
    pairs: [{}],
    publicAhead: [{ displayName: 'Amy', slug: 'amy', gap: 51, searchRank: 14, pressRank: 65 }],
    pressAhead: [{ displayName: 'Bey', slug: 'bey', gap: -59, searchRank: 65, pressRank: 6 }],
  }, { label: '7–13 September' })
  assert.match(g.headline, /public is 51 places ahead of the press on Amy/)
  assert.match(g.standfirst, /105 names measured on both/)
  assert.equal(g.sections.length, 2)
  assert.equal(g.sections[0].rows[0].figure, '+51')
  assert.equal(g.sections[1].rows[0].figure, '-59')
})

test('a half-life with too little behind it says so instead of printing an average', () => {
  const early = writeHalfLife({ basis: 'too little', measured: 3, resolved: 1, stillBurning: [], byCategory: {}, longest: [] })
  assert.equal(early.early, true)
  assert.match(early.headline, /Not enough spikes/)
  assert.deepEqual(early.sections, [])
  clean(early.standfirst)
})

test('a sound half-life leads with the average and says how many it timed', () => {
  const h = writeHalfLife({
    basis: 'sound', measured: 30, resolved: 24, average: 2.4, median: 2,
    stillBurning: [{ displayName: 'X' }],
    byCategory: { reality: { days: 1.8, spikes: 6 }, music: { days: 4.1, spikes: 8 } },
    longest: [{ displayName: 'Y', slug: 'y', peakDay: '2026-09-17', peak: 80, lift: 4.2, days: 6 }],
  })
  assert.match(h.headline, /half over in 2.4 days/)
  assert.match(h.standfirst, /24 spikes timed/)
  assert.ok(h.sections.some((s) => s.heading === 'By kind of fame'))
  clean(h.standfirst)
})

test('the attention report leads on how few people hold half of it', () => {
  const a = writeAttention({
    concentration: { halfCount: 7, top10Share: 41.2, leaderShare: 6.1, leader: 'Zendaya', roster: 105 },
    categories: { shares: [{ label: 'Music', share: 30, names: 20 }] },
    share: { shares: [{ displayName: 'Zendaya', slug: 'z', score: 80, share: 6.1 }] },
    spread: { bigButLocal: [{ displayName: 'Local', slug: 'l', outlets: 40, countries: 1, density: 40 }] },
  })
  assert.match(a.headline, /half of all celebrity attention goes to seven people/i)
  assert.match(a.standfirst, /top ten hold 41.2%/)
  assert.ok(a.sections.some((s) => s.heading === 'Big at home, invisible abroad'))
  assert.equal(a.sections.find((s) => s.heading.startsWith('Big at home')).rows[0].line, '40 outlets in 1 country')
})

test('a report with nothing measured is null rather than an empty page', () => {
  assert.equal(writeGap({ pairs: [] }), null)
  assert.equal(writeAttention({}), null)
})
