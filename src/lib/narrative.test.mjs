import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sizeOf, ordinal, num, moveLine, whyLine, shapeLine, thinLine,
  confidenceLabel, explain, shareLine, rowLine, weekCaption, basisLine,
} from './narrative.js'

/** A record in the shape market/evidence.mjs produces. */
const record = (over = {}) => ({
  move: { direction: 'up', from: 23, to: 8, places: 15 },
  week: { score: 41.2, previousScore: 12.4, change: 28.8, days: 7, span: 7, shape: 'sustained', quietLevel: 12,
    series: [], peak: { day: '2026-09-19', level: 48 } },
  drivers: [
    { key: 'coverage', label: 'Coverage', now: 130, before: 42, change: 2.095, moved: true, share: 0.5 },
    { key: 'breadth', label: 'Outlets', now: 22, before: 3, change: 6.333, moved: true, share: 0.4 },
    { key: 'search', label: 'Search', now: 18400, before: 15200, change: 0.21, moved: false, share: 0 },
  ],
  corroboration: 2,
  thin: false,
  evidence: { outlets: 22, countries: 7, topTier: 3, mentions: 130, story: null },
  ...over,
})

/* ------------------------------------------------------------------ *
 * The numbers, said out loud
 * ------------------------------------------------------------------ */

test('a change is a percentage below a doubling and a multiple above it', () => {
  assert.equal(sizeOf(0.34), 'up 34%')
  assert.equal(sizeOf(0.99), 'up 99%')
  assert.equal(sizeOf(1), '2× last week')
  assert.equal(sizeOf(2.1), '3.1× last week')
  assert.equal(sizeOf(-0.4), 'down 40%')
  assert.equal(sizeOf(null), null)
})

test('numbers are grouped, and never given more precision than they have', () => {
  assert.equal(num(18400), '18,400')
  assert.equal(num(41.24), '41.2')
  assert.equal(num(130.6), '131', 'past a hundred the decimal is noise')
  assert.equal(num(null), null)
})

test('ordinals', () => {
  assert.equal(ordinal(1), '1st')
  assert.equal(ordinal(2), '2nd')
  assert.equal(ordinal(11), '11th')
  assert.equal(ordinal(23), '23rd')
})

/* ------------------------------------------------------------------ *
 * The lines
 * ------------------------------------------------------------------ */

test('the move reads the way somebody would say it', () => {
  assert.equal(moveLine(record()), 'up 15 to number 8')
  assert.equal(moveLine(record(), { name: 'Zendaya' }), 'Zendaya is up 15 to number 8')
  assert.equal(moveLine(record({ move: { direction: 'down', from: 8, to: 30, places: 22 } })), 'down 22 to number 30')
  assert.equal(moveLine(record({ move: { direction: 'flat', from: 8, to: 8, places: 0 } })), 'holding at 8')
  assert.equal(moveLine(record({ move: { direction: 'new', from: null, to: 12, places: null } })), 'new entry at 12')
  assert.equal(moveLine(record({ move: { direction: 'reentry', from: null, to: 40, places: null } }), { name: 'Rihanna' }),
    'Rihanna is back on the chart at 40')
})

test('the why leads with the biggest mover and corroborates it with the second', () => {
  const line = whyLine(record())
  assert.equal(line, 'Coverage 3.1× last week — 130 mentions a day against 42, across 22 newsrooms against 3.')
})

test('a single moving signal gets one clause, not an invented second', () => {
  const one = whyLine(record({
    drivers: [
      { key: 'breadth', label: 'Outlets', now: 22, before: 3, change: 6.3, moved: true, share: 1 },
      { key: 'coverage', label: 'Coverage', now: 40, before: 38, change: 0.05, moved: false, share: 0 },
    ],
  }))
  assert.equal(one, 'Picked up by 22 newsrooms, 7.3× last week.')
})

test('a week where nothing moved says nothing rather than reaching for a story', () => {
  const quiet = record({ drivers: [{ key: 'coverage', now: 40, before: 39, change: 0.03, moved: false, share: 0 }] })
  assert.equal(whyLine(quiet), null)
  assert.ok(!explain(quiet).some((l) => /coverage/i.test(l)))
})

test('the shape says whether it lasted', () => {
  assert.equal(shapeLine(record()), 'Held there all week — a level, not a moment.')
  assert.equal(shapeLine(record({ week: { shape: 'spike' } })), 'One big day carried the week.')
  assert.equal(shapeLine(record({ week: { shape: 'fading' } })), 'Already coming off the peak.')
  assert.equal(shapeLine(record({ week: {} })), null)
})

/* ------------------------------------------------------------------ *
 * Saying when the evidence is thin
 * ------------------------------------------------------------------ */

test('a thin rise is labelled, in plain words', () => {
  const thin = record({ thin: true, corroboration: 1, evidence: { outlets: 1, countries: 1, topTier: 0 } })
  assert.equal(thinLine(thin), 'One outlet so far — no wider pickup yet.')
  assert.equal(confidenceLabel(thin), 'Thin')
})

test('one country is its own kind of thin', () => {
  const local = record({ thin: true, corroboration: 2, evidence: { outlets: 6, countries: 1, topTier: 1 } })
  assert.equal(thinLine(local), '6 outlets, all in one country.')
})

test('a solid week is not labelled at all', () => {
  assert.equal(thinLine(record()), null)
  assert.equal(confidenceLabel(record()), 'Corroborated')
  assert.equal(confidenceLabel(record({ corroboration: 3, evidence: { topTier: 2 } })), 'Strong')
})

/* ------------------------------------------------------------------ *
 * Assembled
 * ------------------------------------------------------------------ */

test('the explanation runs what, why, whether it lasted, what it rests on', () => {
  const lines = explain(record({ basis: 'full' }), { name: 'Zendaya' })
  assert.equal(lines.length, 3)
  assert.match(lines[0], /^Zendaya is up 15/)
  assert.match(lines[1], /^Coverage/)
  assert.match(lines[2], /level, not a moment/)
})

test('a share line is one sentence and starts like one', () => {
  const s = shareLine(record(), 'Zendaya')
  assert.match(s, /^Zendaya is up 15 to number 8\. Coverage/)
  assert.ok(!s.includes('undefined') && !s.includes('null'))
})

test('a row line leads with the evidence, not with a headline', () => {
  assert.equal(rowLine(record()), 'Coverage 3.1× last week · 22 outlets in 7 countries')
  const thin = rowLine(record({ thin: true, evidence: { outlets: 1, countries: 1 } }))
  assert.match(thin, /thin$/)
})

test('a row line for a week where nothing moved still says something true', () => {
  const quiet = rowLine(record({ drivers: [], evidence: { outlets: 0, countries: 0 } }))
  assert.equal(quiet, 'Score 41.2', 'they moved, so they are not "holding"')
  const held = rowLine(record({
    move: { direction: 'flat', from: 8, to: 8, places: 0 },
    drivers: [], evidence: { outlets: 0, countries: 0 },
  }))
  assert.equal(held, 'Holding at 41.2')
  // With breadth to report, that is the more useful clause.
  const broad = rowLine(record({ drivers: [], evidence: { outlets: 219, countries: 14 } }))
  assert.equal(broad, '219 outlets in 14 countries')
})

test('a rank that rose on nothing says what it is holding, then says thin', () => {
  // Rank is relative, so a name can climb because somebody above them
  // collapsed. The row must not imply anything happened to them.
  const drifted = rowLine(record({
    move: { direction: 'up', from: 2, to: 1, places: 1 },
    drivers: [{ key: 'coverage', now: 9, before: 40, change: -0.78, moved: false, share: 0 }],
    thin: true, corroboration: 0,
    evidence: { outlets: 1, countries: 1, topTier: 0 },
  }))
  assert.equal(drifted, 'Score 41.2 · thin')
})

test('a row line is cut at a word, never mid-word', () => {
  const long = rowLine(record(), { max: 20 })
  assert.ok(long.length <= 21, long)
  assert.ok(long.endsWith('…'))
  assert.ok(!/\s…$/.test(long))
})

test('the week caption is honest about gaps', () => {
  assert.equal(weekCaption(record()), '7 days measured')
  assert.equal(weekCaption(record({ week: { days: 5, span: 7 } })), '5 of 7 days measured')
})

test('no line ever prints a figure the record does not hold', () => {
  // Every field null: the generator must go quiet, not print "null" or "NaN".
  const empty = { move: null, week: {}, drivers: [], evidence: {}, corroboration: 0, thin: false, basis: 'full' }
  for (const line of [moveLine(empty), whyLine(empty), shapeLine(empty), thinLine(empty), rowLine(empty)]) {
    if (line == null) continue
    assert.ok(!/null|undefined|NaN/.test(line), line)
  }
  assert.deepEqual(explain(empty), [])
})

test('the first weeks say the comparison is partial rather than staying silent', () => {
  // "Coverage flat" and "we have nothing to compare this with" look the
  // same on a bar and are completely different claims.
  assert.equal(basisLine(record({ basis: 'none' })), 'First week of data — nothing to compare it with yet.')
  assert.equal(basisLine(record({ basis: 'partial', judgeable: 2 })),
    'Comparing 2 of 3 signals — the rest have no history yet.')
  assert.equal(basisLine(record({ basis: 'full' })), null)
  // A thin label outranks it: the sharper caveat is the one to show.
  const thinAndPartial = record({ basis: 'partial', judgeable: 2, thin: true, evidence: { outlets: 1, countries: 1 } })
  assert.match(explain(thinAndPartial).at(-1), /one outlet/i)
})
