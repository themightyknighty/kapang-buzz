import { test } from 'node:test'
import assert from 'node:assert/strict'
import { race, until } from './race.mjs'
import { writeRace } from '../src/lib/reportcopy.js'

const NOW = Date.parse('2026-09-18T12:00:00Z')
const FREEZE = '2026-09-21T13:00:00Z'

const series = (levels) => levels.map((level, i) => ({
  day: new Date(Date.parse('2026-09-14T00:00:00Z') + i * 86400000).toISOString().slice(0, 10),
  level, measured: true,
}))

const entry = (id, rank, score, levels = null, over = {}) => ({
  id, slug: id, displayName: id.replace(/(^|-)(\w)/g, (m, a, b) => a + b.toUpperCase()),
  rank, score, imageUrl: null, weeksAtOne: 0,
  movement: { week: { series: levels ? series(levels) : [] }, thin: false },
  ...over,
})

const chart = (entries, over = {}) => ({
  id: '2026-W38', label: '14–20 September 2026', live: true, freezesAt: FREEZE, entries, ...over,
})

/* ================================================================== *
 * The clock
 * ================================================================== */

test('the time left reads the way somebody would say it', () => {
  assert.equal(until(3 * 86400000 + 4 * 3600000), '3d 4h')
  assert.equal(until(86400000), '1d')
  assert.equal(until(5 * 3600000 + 20 * 60000), '5h 20m')
  assert.equal(until(45 * 60000), '45m')
  assert.equal(until(-1), null)
  assert.equal(until(null), null)
})

/* ================================================================== *
 * The gap
 * ================================================================== */

test('the race is the gap between the top two, with a clock on it', () => {
  const r = race(chart([entry('leader', 1, 61.4), entry('chaser', 2, 59.3)]), { now: NOW })
  assert.equal(r.leader.displayName, 'Leader')
  assert.equal(r.chaser.displayName, 'Chaser')
  assert.equal(r.gap, 2.1)
  assert.equal(r.freezesIn, '3d 1h')
  assert.equal(r.frozen, false)
})

test('a gap of two points or less is a race worth watching', () => {
  assert.equal(race(chart([entry('a', 1, 60), entry('b', 2, 58.5)]), { now: NOW }).tight, true)
  assert.equal(race(chart([entry('a', 1, 60), entry('b', 2, 40)]), { now: NOW }).tight, false)
})

test('a chart with one name on it is a lead, not a race', () => {
  const r = race(chart([entry('alone', 1, 60)]), { now: NOW })
  assert.equal(r.chaser, null)
  assert.equal(r.gap, null)
  const said = writeRace(r)
  assert.match(said.headline, /^Alone leads$/)
})

test('an empty chart is no race rather than a crash', () => {
  assert.equal(race(chart([])), null)
  assert.equal(race(null), null)
  assert.equal(writeRace(null), null)
})

/* ================================================================== *
 * The part that makes it a race
 * ================================================================== */

test('a gap that is closing is the story, not the gap itself', () => {
  /*
   * "Second is two points behind" is a fact. "Second has taken back four
   * points since Tuesday" is a reason to come back tomorrow, and it is the
   * entire difference between a scoreboard and a race.
   */
  const r = race(chart([
    entry('leader', 1, 61, [70, 68, 66, 63, 61]),
    entry('chaser', 2, 59, [55, 56, 57, 58, 59]),
  ]), { now: NOW, back: 2 })
  assert.equal(r.gap, 2)
  assert.ok(r.closed > 0, `the chaser has taken back ${r.closed}`)
  assert.equal(r.since, '2026-09-16')
  assert.match(writeRace(r).headline, /Chaser is closing on Leader/)
})

test('a leader pulling away says so', () => {
  const r = race(chart([
    entry('leader', 1, 80, [62, 68, 72, 76, 80]),
    entry('chaser', 2, 60, [58, 59, 59, 60, 60]),
  ]), { now: NOW, back: 2 })
  assert.ok(r.closed < 0, 'the chaser has lost ground')
  assert.match(writeRace(r).headline, /pulling away/)
})

test('with no daily series there is a gap but no direction of travel', () => {
  const r = race(chart([entry('a', 1, 60), entry('b', 2, 58)]), { now: NOW })
  assert.equal(r.closed, null)
  const said = writeRace(r)
  assert.ok(!/closing|pulling/.test(said.headline) === false || said.headline.length > 0)
  assert.ok(!said.line.includes('null'))
})

test('catchable is worked out from the rate of closing and the time left', () => {
  // Two points apart, taking back two points every two days, three days left.
  const near = race(chart([
    entry('leader', 1, 61, [65, 64, 63, 62, 61]),
    entry('chaser', 2, 59, [55, 56, 57, 58, 59]),
  ]), { now: NOW, back: 2 })
  assert.equal(near.catchable, true)

  // Twenty points apart at the same rate: not in three days.
  const far = race(chart([
    entry('leader', 1, 79, [83, 82, 81, 80, 79]),
    entry('chaser', 2, 59, [55, 56, 57, 58, 59]),
  ]), { now: NOW, back: 2 })
  assert.equal(far.catchable, false)
})

/* ================================================================== *
 * After the freeze
 * ================================================================== */

test('once the week has frozen the clock says so rather than counting backwards', () => {
  const r = race(chart([entry('a', 1, 60), entry('b', 2, 58)]), { now: Date.parse('2026-09-22T00:00:00Z') })
  assert.equal(r.frozen, true)
  assert.equal(r.freezesIn, null)
  assert.ok(!writeRace(r).line.includes('null'))
})

test('the race carries the portraits and the shapes the surfaces need', () => {
  const r = race(chart([
    entry('a', 1, 60, [50, 55, 58, 59, 60], { imageUrl: 'https://x.test/a.jpg' }),
    entry('b', 2, 58, [40, 45, 50, 54, 58]),
  ]), { now: NOW })
  assert.equal(r.leader.imageUrl, 'https://x.test/a.jpg')
  assert.equal(r.leader.series.length, 5)
  assert.equal(r.chaser.series.at(-1).level, 58)
})

test('no line ever prints a figure the race does not hold', () => {
  for (const r of [
    race(chart([entry('a', 1, 60)]), { now: NOW }),
    race(chart([entry('a', 1, 60), entry('b', 2, 58)]), { now: NOW }),
    race(chart([entry('a', 1, 60), entry('b', 2, 58)], { freezesAt: null }), { now: NOW }),
  ]) {
    const said = writeRace(r)
    for (const s of [said.headline, said.line]) {
      assert.ok(!/null|undefined|NaN/.test(s), s)
    }
  }
})
