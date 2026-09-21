import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WEIGHTS, NEWS_MIX } from './config.mjs'
import { median, mad, robustZ, squash, confidenceFor, buildBaselines, deviation, isNewEntry, percentileOf } from './normalize.mjs'
import { newsComponent, gossipScore, breadthComponent, freshnessFactor, sourceUsable, attentionBand, momentumFactor } from './score.mjs'
import { velocity, acceleration, momentumOf, classify, trendArrow, momentumBand } from './momentum.mjs'
import { rankMarket, marketCards, hotList, filterTab, marketSummary } from './rank.mjs'

/* ---------------- normalization ---------------- */

test('weights sum to 1', () => {
  const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0)
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum to ${sum}`)
  assert.ok(Math.abs(NEWS_MIX.deviation + NEWS_MIX.absolute - 1) < 1e-9)
})

test('median and MAD are robust to a single past spike', () => {
  assert.equal(median([1, 2, 3, 4, 5]), 3)
  assert.equal(median([1, 2, 3, 4]), 2.5)
  const calm = [10, 11, 10, 12, 9, 10, 11]
  const spiked = [10, 11, 10, 9000, 9, 10, 11]
  // The spike moves the median barely at all — a mean would be wrecked.
  assert.equal(median(calm), median(spiked))
  assert.ok(mad(spiked) < 5)
})

test('THE product principle: a small celebrity surging beats a big one drifting', () => {
  // Straight from the brief. A normally gets 10,000 and today gets 11,000;
  // B normally gets 200 and suddenly gets 5,000. B must win.
  const aBaseline = Array.from({ length: 7 }, () => 10000)
  const bBaseline = Array.from({ length: 7 }, () => 200)
  const marketMentions = [200, 400, 1200, 5000, 10000, 11000]

  const a = newsComponent({ mentions: 11000, weightedMentions: 11000, baselines: { '7d': aBaseline, daysOfHistory: 7 }, marketMentions })
  const b = newsComponent({ mentions: 5000, weightedMentions: 5000, baselines: { '7d': bBaseline, daysOfHistory: 7 }, marketMentions })

  assert.ok(b.z > a.z, `B deviation ${b.z} should beat A ${a.z}`)
  assert.ok(b.score > a.score, `B news score ${b.score} should beat A ${a.score}`)
})

test('a flat baseline does not divide by zero', () => {
  const z = robustZ(500, [10, 10, 10, 10, 10, 10, 10])
  assert.ok(Number.isFinite(z) && z > 0, `z was ${z}`)
})

test('squash flattens at the top so nobody runs away with first place', () => {
  const a = squash(6), b = squash(12)
  assert.ok(a < 1 && b < 1)
  assert.ok(b - a < 0.1, 'doubling an already-huge z should barely move the score')
  assert.ok(Math.abs(squash(0) - 0.5) < 1e-9)
})

test('the confidence floor stops six articles crowning a nobody', () => {
  assert.equal(confidenceFor(0), 0)
  assert.ok(confidenceFor(3) <= 0.3, 'thin evidence is heavily damped')
  assert.ok(confidenceFor(25) === 1, 'full evidence is undamped')
  assert.ok(confidenceFor(10) > confidenceFor(6))

  // A nobody with a colossal z-score still cannot top the table.
  const nobody = gossipScore({
    news: { score: 99 }, wikipedia: { score: 90 }, breadth: { score: 80 },
    momentum: 95, mentions: 4, ages: { news: 60, wikipedia: 3600 },
  })
  assert.ok(nobody.score < 35, `a 4-mention celebrity scored ${nobody.score}`)
})

test('percentiles place a value against the rest of the market', () => {
  assert.equal(percentileOf(50, [10, 20, 30, 40]), 1)
  assert.equal(percentileOf(5, [10, 20, 30, 40]), 0)
  assert.equal(percentileOf(25, [10, 20, 30, 40]), 0.5)
})

test('a new celebrity is marked provisional rather than given invented history', () => {
  const baselines = buildBaselines([], [12, 14], () => 0)
  const thin = { '7d': [12, 14], daysOfHistory: 2 }
  assert.ok(isNewEntry(thin))
  const d = deviation(500, thin, { categoryMedian: 20 })
  assert.ok(d.provisional)
  assert.ok(Number.isFinite(d.z))
  assert.equal(deviation(500, { '7d': [], daysOfHistory: 0 }).basis, 'none')
  assert.ok(Array.isArray(baselines['7d']))
})

/* ---------------- score composition ---------------- */

test('a missing source redistributes its weight instead of scoring zero', () => {
  // Momentum off, so the three components really are equal — with it on, the
  // news value is lifted and dropping a source would legitimately move the
  // total, which would make this test about the wrong thing.
  const withWiki = gossipScore({ news: { score: 80 }, wikipedia: { score: 80 }, breadth: { score: 80 }, momentum: 0, mentions: 50 })
  const withoutWiki = gossipScore({ news: { score: 80 }, wikipedia: null, breadth: { score: 80 }, momentum: 0, mentions: 50 })
  // All components equal, so dropping one must not move the total.
  assert.ok(Math.abs(withWiki.score - withoutWiki.score) < 0.5,
    `${withWiki.score} vs ${withoutWiki.score} — a dropped source should not be scored as zero`)
  assert.deepEqual(withoutWiki.droppedSources, ['wikipedia'])
})

test('the score is always within 0-100 and reports its own derivation', () => {
  for (const mentions of [0, 1, 10, 500]) {
    for (const m of [-100, 0, 100]) {
      const r = gossipScore({ news: { score: 100 }, wikipedia: { score: 100 }, breadth: { score: 100 }, momentum: m, mentions })
      assert.ok(r.score >= 0 && r.score <= 100, `score ${r.score}`)
    }
  }
  const r = gossipScore({ news: { score: 90 }, wikipedia: { score: 60 }, breadth: { score: 70 }, momentum: 50, mentions: 40 })
  const sum = Object.values(r.contributions).reduce((a, c) => a + c.contribution, 0)
  assert.ok(Math.abs(sum - r.raw) < 0.1, 'contributions must add up to the raw total')
  for (const k of ['news', 'wikipedia', 'breadth']) assert.ok(r.contributions[k], `missing ${k}`)
})

/* ---------------- momentum as a modifier ---------------- */

test('nothing accelerating contributes nothing', () => {
  /*
   * The fault this replaced: momentum was folded from -100..+100 into
   * 0..100 and weighted at a quarter, so a celebrity with NOTHING happening
   * scored 50 on it and collected 12.5 points for being alive — two thirds
   * of the whole score of a quiet name.
   */
  assert.equal(momentumFactor(0), 1)
  const still = gossipScore({ news: { score: 40 }, wikipedia: { score: 40 }, breadth: { score: 40 }, momentum: 0, mentions: 40 })
  const noMomentumAtAll = gossipScore({ news: { score: 40 }, wikipedia: { score: 40 }, breadth: { score: 40 }, momentum: null, mentions: 40 })
  assert.equal(still.score, noMomentumAtAll.score, 'zero momentum must be the same as no momentum')
  assert.ok(Math.abs(still.score - 40) < 0.5, `a flat 40 across the board should score 40, got ${still.score}`)
})

test('momentum amplifies coverage but cannot manufacture it', () => {
  const none = (m) => gossipScore({ news: { score: 0 }, wikipedia: { score: 0 }, breadth: { score: 0 }, momentum: m, mentions: 40 })
  assert.equal(none(100).score, 0, 'no coverage plus huge acceleration is still no coverage')
  assert.equal(none(-100).score, 0)

  const real = (m) => gossipScore({ news: { score: 60 }, wikipedia: { score: 60 }, breadth: { score: 60 }, momentum: m, mentions: 40 }).score
  assert.ok(real(100) > real(0), 'accelerating coverage outscores steady coverage')
  assert.ok(real(0) > real(-100), 'fading coverage is damped')
  // Bounded: acceleration is a modifier, not a second score.
  assert.ok(real(100) / real(0) <= 1.2, `momentum moved the score by ${real(100) / real(0)}x`)
})

test('the modifier is bounded at both ends', () => {
  assert.equal(momentumFactor(100), 1.25)
  assert.equal(momentumFactor(-100), 0.75)
  assert.equal(momentumFactor(9999), 1.25, 'clamped')
  assert.equal(momentumFactor(undefined), 1)
})

test('stale sources lose influence and then drop out', () => {
  assert.equal(freshnessFactor('news', 60), 1)
  assert.ok(freshnessFactor('news', 10000) < 1)
  assert.equal(freshnessFactor('news', 999999), 0)
  assert.ok(sourceUsable('wikipedia', 86400))
  assert.ok(!sourceUsable('wikipedia', 99999999))
})

test('breadth rewards independent pickup, not cloning', () => {
  const wide = breadthComponent({ uniqueSources: 40, uniqueCountries: 12, prominence: 9 })
  const cloned = breadthComponent({ uniqueSources: 40, uniqueCountries: 1, prominence: 1 })
  assert.ok(wide.score > cloned.score)
  assert.ok(wide.score <= 100 && cloned.score >= 0)
})

test('attention bands cover the whole range', () => {
  for (const s of [0, 14, 20, 40, 60, 80, 95, 100]) assert.ok(typeof attentionBand(s) === 'string')
  assert.equal(attentionBand(95), 'Extreme')
  assert.equal(attentionBand(0), 'Minimal')
})

/* ---------------- momentum ---------------- */

const series = (values, now, stepMs = 900000) =>
  values.map((v, i) => ({ t: now - (values.length - 1 - i) * stepMs, v }))

test('momentum measures acceleration, not level', () => {
  const now = Date.parse('2026-09-17T12:00:00Z')
  // Flat but enormous: no momentum.
  const flat = momentumOf(series(Array(48).fill(9000), now), now)
  assert.ok(Math.abs(flat.momentum) < 5, `flat series gave ${flat.momentum}`)

  // Small but accelerating hard: big momentum.
  const rising = momentumOf(series([...Array(36).fill(10), 40, 90, 200, 420, 700, 1100, 1600, 2200, 2900, 3700, 4600, 5600], now), now)
  assert.ok(rising.momentum > 40, `accelerating series gave ${rising.momentum}`)

  const falling = momentumOf(series([...Array(36).fill(4000), 3000, 2200, 1500, 900, 500, 250, 120, 60, 30, 15, 8, 4], now), now)
  assert.ok(falling.momentum < -30, `collapsing series gave ${falling.momentum}`)
})

test('momentum is bounded and smoothing suppresses a single noisy sample', () => {
  const now = Date.parse('2026-09-17T12:00:00Z')
  const spike = series([...Array(44).fill(10), 10, 10, 10, 9000], now)
  const unsmoothed = momentumOf(spike, now, { smoothing: 1 })
  const smoothed = momentumOf(spike, now, { history: [2, -1], smoothing: 3 })
  assert.ok(smoothed.momentum < unsmoothed.momentum, 'smoothing should damp the spike')
  assert.ok(unsmoothed.momentum <= 100 && unsmoothed.momentum >= -100)
})

test('velocity handles too little data without throwing', () => {
  const now = Date.now()
  assert.equal(velocity([], 3, now), 0)
  assert.equal(velocity([{ t: now, v: 5 }], 3, now), 0)
  assert.ok(Number.isFinite(acceleration([], now).value))
})

test('trend arrows and momentum bands agree with each other', () => {
  assert.equal(trendArrow(80), '↑↑')
  assert.equal(trendArrow(20), '↑')
  assert.equal(trendArrow(0), '→')
  assert.equal(trendArrow(-20), '↓')
  assert.equal(trendArrow(-80), '↓↓')
  assert.equal(momentumBand(85), 'Exploding')
  assert.equal(momentumBand(0), 'Stable')
  assert.equal(momentumBand(-70), 'Collapsing')
})

/* ---------------- status ---------------- */

test('every status rule is reachable and BREAKING needs all three conditions', () => {
  const base = { score: 70, momentum: 0, confidence: 0.9, deviationPercentile: 0.5, newEntry: false }
  assert.equal(classify({ ...base, newEntry: true }), 'NEW ENTRY')
  assert.equal(classify({ ...base, momentum: 70, deviationPercentile: 0.995 }), 'BREAKING')
  // Each missing condition demotes it, rather than still shouting BREAKING.
  assert.equal(classify({ ...base, momentum: 70, deviationPercentile: 0.5 }), 'SURGING')
  assert.equal(classify({ ...base, momentum: 70, deviationPercentile: 0.995, confidence: 0.4 }), 'SURGING')
  assert.equal(classify({ ...base, momentum: 45 }), 'SURGING')
  assert.equal(classify({ ...base, momentum: 20 }), 'RISING')
  assert.equal(classify({ ...base, score: 80, momentum: -30 }), 'COOLING')
  assert.equal(classify({ ...base, score: 20, momentum: -30 }), 'FALLING')
  assert.equal(classify({ ...base, score: 5, momentum: 0 }), 'DORMANT')
  assert.equal(classify({ ...base, score: 80, momentum: 0 }), 'ACTIVE')
  assert.equal(classify({ ...base, score: 30, momentum: 0 }), 'STABLE')
})

/* ---------------- ranking ---------------- */

const row = (id, gossipScore, momentum, extra = {}) => ({
  id, displayName: id, slug: id, primaryCategory: 'music', secondaryCategories: [],
  gossipScore, momentum, mentions: 30, status: 'STABLE', change24h: 0, ...extra,
})

test('ranking is deterministic and reports movement honestly', () => {
  const now = Date.parse('2026-09-17T12:00:00Z')
  const first = rankMarket([row('a', 50, 0), row('b', 80, 0), row('c', 60, 0)], null, { now })
  assert.deepEqual(first.map((r) => r.id), ['b', 'c', 'a'])
  // Nobody has a previous rank on the first run, so movement is null, not 0.
  assert.deepEqual(first.map((r) => r.rankChange), [null, null, null])
  assert.ok(first.every((r) => r.isNew))

  const second = rankMarket([row('a', 90, 0), row('b', 80, 0), row('c', 60, 0)], { rows: first }, { now })
  assert.deepEqual(second.map((r) => r.id), ['a', 'b', 'c'])
  assert.equal(second[0].rankChange, 2, 'a climbed from 3rd to 1st')
  assert.equal(second[1].rankChange, -1, 'b slipped from 1st to 2nd')
  assert.equal(second[2].rankChange, -1, 'c slipped from 2nd to 3rd')
  assert.ok(second.every((r) => !r.isNew))
})

test('ties break the same way every time', () => {
  const rows = [row('zed', 50, 10), row('amy', 50, 10), row('bob', 50, 10)]
  const a = rankMarket(rows, null).map((r) => r.id)
  const b = rankMarket(rows.slice().reverse(), null).map((r) => r.id)
  assert.deepEqual(a, b)
  assert.deepEqual(a, ['amy', 'bob', 'zed'])
})

test('dashboard cards come from data and never invent an entry', () => {
  const now = Date.parse('2026-09-17T12:00:00Z')
  const ranked = rankMarket([
    row('a', 90, 50, { change24h: 12, mentions: 100 }),
    row('b', 70, -30, { change24h: -8, mentions: 400 }),
  ], null, { now })
  const cards = marketCards(ranked)
  assert.equal(cards.hottest.celebrity.id, 'a')
  assert.equal(cards.riser.celebrity.id, 'a')
  assert.equal(cards.faller.celebrity.id, 'b')
  assert.equal(cards.mostCovered.celebrity.id, 'b')
  assert.equal(cards.breaking.celebrity, null)
  assert.ok(cards.breaking.empty && cards.breaking.reason)

  const empty = marketCards([])
  assert.ok(Object.values(empty).every((c) => c.empty && c.celebrity === null))
})

test('the hot list favours movers and always includes anything breaking', () => {
  const ranked = rankMarket([
    ...Array.from({ length: 30 }, (_, i) => row(`c${i}`, 90 - i, 1)),
    row('breaker', 12, 95, { status: 'BREAKING' }),
  ], null)
  const hot = hotList(ranked, 20)
  assert.ok(hot.includes('breaker'), 'a breaking celebrity must be re-checked even at rank 31')
  assert.ok(hot.length <= 20)
  assert.equal(new Set(hot).size, hot.length, 'no duplicates')
})

test('tab filters select from data, not from the UI', () => {
  const ranked = rankMarket([
    row('up', 80, 50, { primaryCategory: 'music' }),
    row('down', 70, -50, { primaryCategory: 'film' }),
    row('brk', 60, 80, { primaryCategory: 'sport', status: 'BREAKING' }),
  ], null)
  assert.deepEqual(filterTab(ranked, 'rising').map((r) => r.id).sort(), ['brk', 'up'])
  assert.deepEqual(filterTab(ranked, 'falling').map((r) => r.id), ['down'])
  assert.deepEqual(filterTab(ranked, 'breaking').map((r) => r.id), ['brk'])
  assert.deepEqual(filterTab(ranked, 'film').map((r) => r.id), ['down'])
  assert.equal(filterTab(ranked, 'top').length, 3)
  assert.equal(marketSummary(ranked).tracked, 3)
})
