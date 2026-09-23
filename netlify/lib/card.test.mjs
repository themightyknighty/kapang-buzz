import test from 'node:test'
import assert from 'node:assert/strict'
import { chartCard } from './card.mjs'

/*
 * The chart card is drawn, not laid out — every y is a number in the source,
 * and nothing warns when two of them collide. Three rows under a sparkline
 * ran to y=558 while `chrome` rules off at 538 and prints the date at 578, so
 * the third name was struck through the rule and into the date on every card
 * with a week series, which is every card a published edition produces.
 *
 * So the band between the rule and the date is asserted empty. It is the one
 * part of this canvas where anything drawn is, by definition, drawn on top of
 * something else.
 */
const RULE_Y = 538
const FOOTER_Y = 578

/** Every y a <text> element is drawn at. */
const textYs = (svg) => [...svg.matchAll(/<text[^>]*\sy="([\d.]+)"/g)].map((m) => Number(m[1]))

const series = [40, 48, 61, 72, 66, 58, 62].map((level, i) => ({ day: `2026-09-${14 + i}`, level }))

const edition = (over = {}) => ({
  id: '2026-W38',
  label: '14–20 September 2026',
  entries: [
    {
      rank: 1, displayName: 'Zendaya', slug: 'zendaya', score: 62.1, status: 'up', move: 3,
      movement: { week: { series, peak: { day: '2026-09-17', level: 72 } }, drivers: [] },
    },
    { rank: 2, displayName: 'Pedro Pascal', slug: 'pedro-pascal', score: 58.4, status: 'down', move: -1 },
    { rank: 3, displayName: 'Benedict Cumberbatch', slug: 'bc', score: 55, status: 'new', move: null },
    { rank: 4, displayName: 'Dua Lipa', slug: 'dua-lipa', score: 51.2, status: 'same', move: 0 },
  ],
  summary: { numberOne: { displayName: 'Zendaya' }, charted: 100 },
  ...over,
})

const clear = (svg, what) => {
  const caught = textYs(svg).filter((y) => y > RULE_Y && y < FOOTER_Y)
  assert.deepEqual(caught, [], `${what} is drawn through the footer rule at y=${RULE_Y}`)
}

test('nothing is drawn through the footer rule', () => {
  clear(chartCard(edition(), {}), 'the list of names')
  clear(chartCard(edition(), { headline: 'Zendaya takes the top' }), 'the headline')
  clear(
    chartCard(edition(), { headline: 'Half the world’s attention now goes to eleven people' }),
    'a headline that runs to two lines',
  )
})

test('an edition with a lead puts the week on the card instead of the also-rans', () => {
  const said = chartCard(edition(), { headline: 'Zendaya takes the top' })
  assert.match(said, /Zendaya takes the top/)
  assert.doesNotMatch(said, /Pedro Pascal/, 'the list is what the headline replaces')
})

test('an edition with no lead still lists the names behind the number one', () => {
  // Every edition published before the chart decided its own lead.
  const list = chartCard(edition(), {})
  assert.match(list, /Pedro Pascal/)
  assert.doesNotMatch(list, /Dua Lipa/, 'the third row is what overflowed')
})
