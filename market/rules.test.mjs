/**
 * The rules, end to end.
 *
 * Each of the files under test has its own unit tests. This one exists to
 * answer the question that was actually asked — "just because someone gets a
 * story can't warrant them rising" — against the whole pipeline at once, so
 * that a future change which quietly reverts one of these rules fails here
 * with a sentence describing what it broke.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildChart, weekRange } from './chart.mjs'
import { gossipScore, newsComponent, breadthComponent, momentumFactor } from './score.mjs'
import { explain, rowLine, shareLine, whyLine } from '../src/lib/narrative.js'

const WEEK = weekRange('2026-W38')
const DAY = 86400000
const iso = (t) => new Date(t).toISOString().slice(0, 10)

/** A celebrity's rollup: `levels` inside the week, `before` in the fortnight prior. */
const rollup = (id, { levels = [], before = [], sources = 6, countries = 3, mentions = null } = {}) => ({
  id,
  days: [
    ...before.map((v, i) => ({
      day: iso(WEEK.startsAt - (before.length - i) * DAY),
      open: v, high: v, low: v, close: v,
      mentions: mentions ?? v, sources: 2, countries: 1, wikipediaViews: v * 100, bestRank: 60,
    })),
    ...levels.map((v, i) => (v == null ? null : {
      day: iso(WEEK.startsAt + i * DAY),
      open: v, high: v, low: v, close: v,
      mentions: mentions ?? v, sources, countries, wikipediaViews: v * 100, bestRank: 20,
    })).filter(Boolean),
  ],
})

const row = (id, over = {}) => ({
  id, slug: id, displayName: id.replace(/(^|-)(\w)/g, (m, a, b) => a + b.toUpperCase()),
  primaryCategory: 'music', drivers: [], mentions: 40, imageUrl: null,
  uniqueSources: 6, uniqueCountries: 3, ...over,
})

/* ================================================================== *
 * Rule 1 — a story does not buy a rise
 * ================================================================== */

test('a loud four days does not outrank a solid seven', () => {
  /*
   * The complaint, run through the whole chart builder. "Spiky" turns up
   * for four days and is enormous on all four; "steady" turns up every day
   * at a lower level. Before this rule, spiky charted at 61.3 and steady at
   * 48, and spiky won — because the three days spiky was absent cost
   * nothing at all.
   */
  const chart = buildChart({
    weekId: '2026-W38',
    rows: [row('spiky'), row('steady')],
    rollups: {
      spiky: rollup('spiky', { levels: [null, null, 62, 58, 70, 55, null], before: [8, 8, 8] }),
      steady: rollup('steady', { levels: [48, 48, 48, 48, 48, 48, 48], before: [40, 42, 41] }),
    },
  })
  const names = chart.entries.map((e) => e.displayName)
  assert.deepEqual(names, ['Steady'], 'four measured days does not even reach the chart')
})

test('five measured days charts, but is scored across the whole week', () => {
  const chart = buildChart({
    weekId: '2026-W38',
    rows: [row('spiky'), row('steady')],
    rollups: {
      spiky: rollup('spiky', { levels: [null, 62, 58, 70, 55, 64, null], before: [8, 8, 8, 8] }),
      steady: rollup('steady', { levels: [48, 48, 48, 48, 48, 48, 48], before: [40, 42, 41, 44] }),
    },
  })
  const by = Object.fromEntries(chart.entries.map((e) => [e.displayName, e]))
  assert.ok(by.Spiky, 'five days is enough to chart')
  assert.ok(by.Steady.rank < by.Spiky.rank,
    `steady (${by.Steady.score}) must outrank spiky (${by.Spiky.score})`)
  assert.equal(by.Spiky.movement.week.days, 5, 'and the record says how much of it was real')
  assert.equal(by.Spiky.movement.week.span, 7)
})

test('a single enormous day never carries a week', () => {
  const chart = buildChart({
    weekId: '2026-W38',
    rows: [row('oneday'), row('worker')],
    rollups: {
      oneday: rollup('oneday', { levels: [6, 6, 98, 6, 6, 6, 6], before: [6, 6, 6] }),
      worker: rollup('worker', { levels: [26, 26, 26, 26, 26, 26, 26], before: [24, 25, 26] }),
    },
  })
  const by = Object.fromEntries(chart.entries.map((e) => [e.displayName, e]))
  assert.ok(by.Worker.rank < by.Oneday.rank, `worker ${by.Worker.score} vs one-day ${by.Oneday.score}`)
  assert.equal(by.Oneday.movement.week.shape, 'spike', 'and the record calls it what it is')
})

/* ================================================================== *
 * Rule 2 — a rise has to be visible in more than one place
 * ================================================================== */

test('a climb nobody else noticed is charted, and labelled thin', () => {
  const chart = buildChart({
    weekId: '2026-W38',
    rows: [row('quiet', { uniqueSources: 1, uniqueCountries: 1 })],
    rollups: {
      quiet: rollup('quiet', {
        levels: [22, 22, 22, 22, 22, 22, 22], before: [10, 10, 10, 10, 10, 10, 10],
        sources: 1, countries: 1,
      }),
    },
    previous: { entries: [{ id: 'quiet', slug: 'quiet', displayName: 'Quiet', rank: 40, score: 10 }] },
    records: { quiet: { peak: 40, weeksOn: 1 } },
  })
  const m = chart.entries[0].movement
  assert.equal(m.move.direction, 'up')
  assert.equal(m.thin, true, 'one outlet in one country is thin')
  // Charted, not hidden — the score is the score.
  assert.equal(chart.entries.length, 1)
  assert.match(explain(m).join(' '), /one outlet/i)
})

test('a climb across many newsrooms in many countries is not thin', () => {
  const chart = buildChart({
    weekId: '2026-W38',
    rows: [row('broad', { uniqueSources: 30, uniqueCountries: 9 })],
    rollups: {
      broad: rollup('broad', {
        levels: [40, 44, 48, 52, 50, 54, 56], before: [10, 10, 10, 10, 10, 10, 10],
        sources: 30, countries: 9,
      }),
    },
    previous: { entries: [{ id: 'broad', slug: 'broad', displayName: 'Broad', rank: 40, score: 10 }] },
    records: { broad: { peak: 40, weeksOn: 1 } },
  })
  const m = chart.entries[0].movement
  assert.equal(m.thin, false)
  assert.ok(m.corroboration >= 2, `only ${m.corroboration} signals moved`)
})

test('a fall is never called thin', () => {
  const chart = buildChart({
    weekId: '2026-W38',
    rows: [row('leader'), row('cooling', { uniqueSources: 1, uniqueCountries: 1 })],
    rollups: {
      leader: rollup('leader', { levels: [60, 60, 60, 60, 60, 60, 60], before: [55, 55, 55] }),
      cooling: rollup('cooling', {
        levels: [12, 11, 10, 9, 9, 8, 8], before: [40, 40, 40, 40, 40, 40, 40],
        sources: 1, countries: 1,
      }),
    },
    previous: {
      entries: [
        { id: 'cooling', slug: 'cooling', displayName: 'Cooling', rank: 1, score: 40 },
        { id: 'leader', slug: 'leader', displayName: 'Leader', rank: 2, score: 38 },
      ],
    },
    records: { cooling: { peak: 1, weeksOn: 3 }, leader: { peak: 2, weeksOn: 3 } },
  })
  const cooling = chart.entries.find((e) => e.id === 'cooling')
  assert.equal(cooling.movement.move.direction, 'down')
  assert.equal(cooling.movement.thin, false, 'a fall is not a claim that needs propping up')
})

test('a rank that rises while the attention behind it falls is marked thin', () => {
  /*
   * Rank is relative, so a name can climb a place because somebody above
   * them collapsed rather than because anything happened to them. Before
   * the corroboration rule that was indistinguishable from a real climb,
   * and the card would have announced it as one. Nothing moved, so the
   * record says nothing moved.
   */
  const chart = buildChart({
    weekId: '2026-W38',
    rows: [row('drifter', { uniqueSources: 1, uniqueCountries: 1 })],
    rollups: {
      drifter: rollup('drifter', {
        levels: [12, 11, 10, 9, 9, 8, 8], before: [40, 40, 40, 40, 40, 40, 40],
        sources: 1, countries: 1,
      }),
    },
    previous: { entries: [{ id: 'drifter', slug: 'drifter', displayName: 'Drifter', rank: 2, score: 40 }] },
    records: { drifter: { peak: 2, weeksOn: 3 } },
  })
  const m = chart.entries[0].movement
  assert.equal(m.move.direction, 'up', 'their rank did improve')
  assert.equal(m.corroboration, 0, 'and not one signal moved to justify it')
  assert.equal(m.thin, true)
  assert.equal(whyLine(m), null, 'so there is no why to give')
  assert.match(rowLine(m), /thin$/i)
  assert.match(rowLine(m), /^Score /, 'and says what they are actually on, not that they held')
})

/* ================================================================== *
 * Rule 3 — momentum cannot manufacture a score
 * ================================================================== */

test('acceleration with nothing behind it scores nothing', () => {
  const nothing = newsComponent({ mentions: 0, weightedMentions: 0, baselines: { '7d': [0, 0, 0, 0, 0, 0, 0] }, marketMentions: [1, 5, 20] })
  const flying = gossipScore({ news: nothing, wikipedia: null, breadth: breadthComponent({}), momentum: 100, mentions: 0 })
  assert.equal(flying.score, 0, 'there is nothing to accelerate')
  assert.equal(momentumFactor(0), 1, 'and standing still is worth exactly nothing')
})

/* ================================================================== *
 * Rule 4 — the explanation is made of the numbers that ranked them
 * ================================================================== */

const explained = () => {
  const chart = buildChart({
    weekId: '2026-W38',
    rows: [row('zendaya', { uniqueSources: 22, uniqueCountries: 7, drivers: [{ domain: 'apnews.com' }, { domain: 'variety.com' }] })],
    rollups: {
      zendaya: rollup('zendaya', {
        levels: [30, 34, 40, 46, 44, 48, 46], before: [10, 10, 10, 10, 10, 10, 10],
        sources: 22, countries: 7,
      }),
    },
    previous: { entries: [{ id: 'zendaya', slug: 'zendaya', displayName: 'Zendaya', rank: 23, score: 12.4 }] },
    records: { zendaya: { peak: 23, weeksOn: 2 } },
    stories: [{ id: 's1', headline: 'Zendaya announces a world tour', people: ['Zendaya'], publishedAt: '2026-09-19T10:00:00Z', outlets: 30 }],
  })
  return chart.entries[0]
}

test('the record explains the same number it was ranked on', () => {
  const entry = explained()
  assert.equal(entry.movement.week.score, entry.score)
  assert.equal(entry.movement.move.to, entry.rank)
  assert.equal(entry.movement.move.from, entry.lastWeek)
})

test('the explanation leads with what moved, not with an article', () => {
  const lines = explain(explained().movement, { name: 'Zendaya' })
  assert.match(lines[0], /^Zendaya is up \d+ to number \d+$/)
  assert.match(lines[1], /^(Coverage|Picked up by|Search interest)/)
  assert.ok(!lines.some((l) => /world tour/i.test(l)), 'the headline is not the explanation')
})

test('the story survives as somewhere to go, not as the reason', () => {
  const m = explained().movement
  assert.equal(m.evidence.story.headline, 'Zendaya announces a world tour')
  assert.equal(m.evidence.story.href, '/story/s1')
})

test('every surface says the same thing, because they read the same record', () => {
  const m = explained().movement
  const row1 = rowLine(m)
  const share = shareLine(m, 'Zendaya')
  const full = explain(m, { name: 'Zendaya' }).join(' ')
  // Whatever the biggest mover is, all three mention it.
  const lead = m.drivers.filter((d) => d.moved).sort((a, b) => b.share - a.share)[0]
  const word = { coverage: /coverage/i, breadth: /newsroom|outlet/i, search: /search/i }[lead.key]
  for (const [label, line] of [['row', row1], ['share', share], ['full', full]]) {
    assert.match(line, word, `${label} line does not mention the driver that moved`)
  }
})

test('no surface ever prints a figure the record does not hold', () => {
  const chart = buildChart({
    weekId: '2026-W38',
    rows: [row('bare')],
    rollups: { bare: rollup('bare', { levels: [20, 20, 20, 20, 20, 20, 20] }) },
  })
  const m = chart.entries[0].movement
  for (const line of [rowLine(m), shareLine(m, 'Bare'), ...explain(m, { name: 'Bare' })]) {
    if (line == null) continue
    assert.ok(!/null|undefined|NaN|Infinity/.test(line), line)
  }
})
