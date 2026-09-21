import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  attentionShare, concentration, interestGap, halfLife, halfLives,
  volatility, volatilities, globalSpread, categoryShare, churn, rivalries, snapshot,
} from './insights.mjs'

const row = (id, over = {}) => ({
  id, slug: id, displayName: id.replace(/(^|-)(\w)/g, (m, a, b) => a + b.toUpperCase()),
  primaryCategory: 'music', gossipScore: 20, newsScore: 20, wikipediaScore: 20,
  uniqueSources: 10, uniqueCountries: 4, ...over,
})

const day = (d, v, over = {}) => ({ day: d, open: v, high: v, low: v, close: v, ...over })
const run = (from, levels) => levels.map((v, i) =>
  day(new Date(Date.parse(`${from}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10), v))

/* ================================================================== *
 * Attention share
 * ================================================================== */

test('a share is a share of what was measured, and says so', () => {
  const s = attentionShare([row('a', { gossipScore: 50 }), row('b', { gossipScore: 30 }), row('c', { gossipScore: 20 })])
  assert.equal(s.total, 100)
  assert.equal(s.shares[0].share, 50)
  assert.equal(s.roster, 3)
  assert.match(s.basis, /3 names measured/)
})

test('names with no score are not counted as zero-attention names', () => {
  // A celebrity the run could not measure is absent from the denominator,
  // not sitting in it at nothing — otherwise every outage inflates everyone.
  const s = attentionShare([row('a', { gossipScore: 50 }), row('b', { gossipScore: null }), row('c', { gossipScore: 50 })])
  assert.equal(s.roster, 2)
  assert.equal(s.shares[0].share, 50)
})

test('nothing measured is not a divide by zero', () => {
  assert.deepEqual(attentionShare([]).shares, [])
  assert.equal(attentionShare([row('a', { gossipScore: 0 })]).total, 0)
})

/* ================================================================== *
 * Concentration
 * ================================================================== */

test('concentration says how few names hold half the attention', () => {
  // Two names at 40 hold 80% between them: half is reached at the second.
  const c = concentration([row('a', { gossipScore: 40 }), row('b', { gossipScore: 40 }), ...['c', 'd', 'e', 'f'].map((id) => row(id, { gossipScore: 5 }))])
  assert.equal(c.halfCount, 2)
  assert.ok(c.halfShare >= 50)
  assert.equal(c.leader, 'A')
})

test('a flat roster is less concentrated than a top-heavy one', () => {
  const flat = concentration(Array.from({ length: 20 }, (_, i) => row(`n${i}`, { gossipScore: 20 })))
  const heavy = concentration([row('big', { gossipScore: 400 }), ...Array.from({ length: 19 }, (_, i) => row(`n${i}`, { gossipScore: 5 }))])
  assert.ok(heavy.halfCount < flat.halfCount, `${heavy.halfCount} vs ${flat.halfCount}`)
  assert.ok(heavy.gini > flat.gini)
  assert.ok(flat.gini < 0.05, 'everybody equal is a gini of nearly nothing')
})

/* ================================================================== *
 * The Gap
 * ================================================================== */

test('the gap finds who the public is ahead on, and who the press is', () => {
  /*
   * `wanted` is written about least and searched for most; `pushed` is the
   * reverse. Those are the two lists the report is made of.
   */
  const rows = [
    ...Array.from({ length: 14 }, (_, i) => row(`n${i}`, { newsScore: 50 - i, wikipediaScore: 50 - i })),
    row('wanted', { newsScore: 5, wikipediaScore: 95 }),
    row('pushed', { newsScore: 95, wikipediaScore: 5 }),
  ]
  const g = interestGap(rows)
  assert.equal(g.publicAhead[0].displayName, 'Wanted')
  assert.equal(g.pressAhead[0].displayName, 'Pushed')
  assert.ok(g.publicAhead[0].gap > 0)
  assert.ok(g.pressAhead[0].gap < 0)
  assert.equal(g.widest.id, 'wanted')
})

test('a name measured on only one of the two is left out entirely', () => {
  // Half a reading is not a disagreement between two readings.
  const rows = [
    ...Array.from({ length: 14 }, (_, i) => row(`n${i}`, { newsScore: 50 - i, wikipediaScore: 50 - i })),
    row('half', { newsScore: 90, wikipediaScore: null }),
  ]
  const g = interestGap(rows)
  assert.ok(!g.pairs.some((p) => p.id === 'half'))
  assert.equal(g.measured, 14)
})

test('too small a roster reports no gap rather than a meaningless one', () => {
  const g = interestGap([row('a'), row('b')])
  assert.deepEqual(g.publicAhead, [])
  assert.match(g.basis, /too few/)
})

/* ================================================================== *
 * The Half-Life
 * ================================================================== */

test('a spike that decays is timed from its peak', () => {
  // Normal is 10; the peak is 50; half way back is 30, reached three days later.
  const life = halfLife(run('2026-09-01', [10, 10, 10, 10, 50, 44, 36, 28, 12, 10, 10, 10]))
  assert.equal(life.peakDay, '2026-09-05')
  assert.equal(life.peak, 50)
  assert.equal(life.baseline, 10)
  assert.equal(life.days, 3)
  assert.equal(life.stillBurning, false)
  assert.equal(life.lift, 5)
})

test('a quiet month has no half-life, which is not the same as a fast one', () => {
  /*
   * The distinction every average built on this depends on. Reporting a
   * quiet name as "decayed in one day" would drag the whole figure down
   * with data about nothing happening.
   */
  assert.equal(halfLife(run('2026-09-01', [20, 21, 20, 19, 20, 21, 20, 20, 19, 21])), null)
  assert.equal(halfLife(run('2026-09-01', [10, 10, 10])), null, 'and too short a series has none either')
})

test('a spike still burning at the end of the window says so', () => {
  const life = halfLife(run('2026-09-01', [10, 10, 10, 10, 60, 58, 57, 56, 55, 54]))
  assert.equal(life.days, null)
  assert.equal(life.stillBurning, true)
})

test('the aggregate averages only the spikes that actually resolved', () => {
  const rollups = {
    fast: { days: run('2026-09-01', [10, 10, 10, 10, 50, 20, 10, 10, 10, 10]) },
    slow: { days: run('2026-09-01', [10, 10, 10, 10, 50, 48, 44, 40, 34, 28, 22, 12]) },
    quiet: { days: run('2026-09-01', [20, 20, 21, 20, 19, 20, 20, 20, 21, 20]) },
    burning: { days: run('2026-09-01', [10, 10, 10, 10, 60, 59, 58, 57, 56, 55]) },
  }
  const rows = [row('fast'), row('slow'), row('quiet'), row('burning', { primaryCategory: 'sport' })]
  const h = halfLives(rollups, rows)
  assert.equal(h.measured, 3, 'the quiet name had no spike at all')
  assert.equal(h.resolved, 2, 'and the one still burning has not finished')
  assert.ok(h.average > 1 && h.average < 8, `average ${h.average}`)
  assert.equal(h.stillBurning.length, 1)
})

test('an average built on a handful of spikes is labelled as early', () => {
  const thin = halfLives({ a: { days: run('2026-09-01', [10, 10, 10, 10, 50, 20, 10, 10, 10, 10]) } }, [row('a')])
  assert.equal(thin.basis, 'too little')
  assert.equal(halfLives({}, []).basis, 'too little')
})

/* ================================================================== *
 * Volatility, spread, categories
 * ================================================================== */

test('volatility is measured against a name’s own average, so sizes compare', () => {
  const small = volatility(run('2026-09-01', [2, 8, 2, 8, 2, 8, 2]))
  const big = volatility(run('2026-09-01', [20, 80, 20, 80, 20, 80, 20]))
  assert.ok(Math.abs(small.cv - big.cv) < 0.01, 'the same swing at two scales reads the same')
  const steady = volatility(run('2026-09-01', [40, 40, 41, 40, 39, 40, 40]))
  assert.ok(steady.cv < small.cv)
})

test('the roster ranks from most unpredictable to steadiest', () => {
  const v = volatilities({
    wild: { days: run('2026-09-01', [5, 60, 5, 60, 5, 60, 5]) },
    calm: { days: run('2026-09-01', [30, 30, 31, 30, 29, 30, 30]) },
  }, [row('wild'), row('calm')])
  assert.equal(v.mostVolatile[0].displayName, 'Wild')
  assert.equal(v.steadiest[0].displayName, 'Calm')
})

test('big but local is a different kind of fame from widely covered', () => {
  const g = globalSpread([
    row('global', { uniqueSources: 30, uniqueCountries: 14 }),
    row('local', { uniqueSources: 40, uniqueCountries: 1 }),
    row('minor', { uniqueSources: 3, uniqueCountries: 1 }),
  ])
  assert.equal(g.mostGlobal[0].displayName, 'Global')
  assert.equal(g.bigButLocal[0].displayName, 'Local')
  assert.ok(!g.bigButLocal.some((x) => x.displayName === 'Minor'), 'three outlets is not big')
  assert.equal(g.bigButLocal[0].density, 40)
})

test('category share adds to a hundred and names its leader', () => {
  const c = categoryShare([
    row('a', { gossipScore: 60, primaryCategory: 'music' }),
    row('b', { gossipScore: 30, primaryCategory: 'sport' }),
    row('c', { gossipScore: 10, primaryCategory: 'sport' }),
  ])
  assert.equal(c.leader.category, 'music')
  assert.equal(c.leader.label, 'Music')
  assert.equal(Math.round(c.shares.reduce((a, s) => a + s.share, 0)), 100)
  assert.equal(c.shares.find((s) => s.category === 'sport').names, 2)
})

/* ================================================================== *
 * Movement over the archive
 * ================================================================== */

test('churn counts who arrived and who left', () => {
  const ed = { entries: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] }
  const prev = { entries: [{ id: 'a' }, { id: 'b' }, { id: 'x' }, { id: 'y' }] }
  const c = churn(ed, prev)
  assert.equal(c.arrived, 2)
  assert.equal(c.left, 2)
  assert.equal(c.held, 2)
  assert.equal(c.rate, 50)
})

test('with no previous edition there is no churn to report', () => {
  assert.equal(churn({ entries: [{ id: 'a' }] }, null).arrived, null)
})

test('two names trading places near each other is a rivalry', () => {
  const ed = (pairs) => ({ entries: pairs.map(([id, rank]) => ({ id, rank, displayName: id, slug: id })) })
  const found = rivalries([
    ed([['a', 1], ['b', 2], ['z', 40]]),
    ed([['b', 1], ['a', 2], ['z', 40]]),
    ed([['a', 1], ['b', 2], ['z', 40]]),
    ed([['b', 1], ['a', 2], ['z', 40]]),
  ])
  assert.equal(found.length, 1)
  assert.equal(found[0].swaps, 3)
  assert.equal(found[0].closest, 1)
})

test('two names that never come near each other are not a rivalry', () => {
  const ed = (pairs) => ({ entries: pairs.map(([id, rank]) => ({ id, rank, displayName: id, slug: id })) })
  const found = rivalries([
    ed([['a', 1], ['b', 60]]),
    ed([['b', 1], ['a', 60]]),
    ed([['a', 1], ['b', 60]]),
  ])
  assert.deepEqual(found, [], 'swapping the top and the bottom is not a duel')
})

/* ================================================================== *
 * Everything at once
 * ================================================================== */

test('a snapshot computes every measure in one pass and never throws on nothing', () => {
  const empty = snapshot({})
  for (const key of ['share', 'concentration', 'gap', 'halfLives', 'volatility', 'spread', 'categories', 'churn', 'rivalries']) {
    assert.ok(key in empty, `missing ${key}`)
  }
  const full = snapshot({
    rows: Array.from({ length: 20 }, (_, i) => row(`n${i}`, { gossipScore: 50 - i, newsScore: 50 - i, wikipediaScore: 30 + i })),
    rollups: { n0: { days: run('2026-09-01', [10, 10, 10, 10, 50, 30, 20, 10, 10, 10]) } },
  })
  assert.ok(full.share.roster === 20)
  assert.ok(full.gap.pairs.length === 20)
  assert.ok(full.concentration.halfCount > 0)
})
