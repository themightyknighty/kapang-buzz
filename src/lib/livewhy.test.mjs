import test from 'node:test'
import assert from 'node:assert/strict'
import { liveMove, liveWhyLine, liveWhy, overNormal } from './livewhy.js'

const row = (over = {}) => ({
  displayName: 'A',
  gossipScore: 80,
  change1h: 1,
  change24h: 20,
  mentions: 900,
  uniqueSources: 400,
  uniqueCountries: 9,
  momentum: 2,
  confidence: 1,
  baselines: { '7d': [300, 300, 300, 300, 300, 300, 300] },
  contributions: {
    news: { contribution: 56 },
    wikipedia: { contribution: 18 },
    breadth: { contribution: 14 },
  },
  ...over,
})

test('a move is explained by what carries the score, with the evidence beside it', () => {
  const line = liveWhyLine(row())
  assert.match(line, /coverage/)
  assert.match(line, /400 outlets in 9 countries/)
  assert.match(liveWhy(row()).join(' '), /Up 20/)
})

test('over-normal is measured against this name, not against everybody', () => {
  // 900 stories against a 300-a-day baseline of their own.
  assert.equal(overNormal(row()), 3)
  // A name whose loud day is barely above their own normal has not had one.
  assert.equal(overNormal(row({ mentions: 330 })), null)
  assert.equal(overNormal(row({ baselines: {} })), null)
})

test('a name with no score is not given a composition', () => {
  /*
   * "Breadth carries 96% of it" is arithmetically true of a name scoring
   * nothing and tells a reader precisely nothing, so there is no leader and
   * no row line at all.
   */
  const nil = row({
    gossipScore: 0, change24h: 0, mentions: 0, uniqueSources: 0, uniqueCountries: 0,
    contributions: { news: { contribution: 0 }, wikipedia: { contribution: 0 }, breadth: { contribution: 1 } },
  })
  assert.equal(liveMove(nil).leading, null)
  assert.equal(liveWhyLine(nil), null)
})

test('a faller is not told its coverage caused the fall', () => {
  const said = liveWhy(row({ change24h: -21, momentum: -4 })).join(' ')
  assert.match(said, /Down 21/)
  assert.match(said, /carries \d+% of the score/, 'the component holds the score; it did not cause the drop')
  assert.doesNotMatch(said, /doing \d+% of it/)
})

test('still high but turning is said, because the number alone gets it wrong', () => {
  const cooling = row({ change24h: 40, momentum: -6 })
  assert.equal(liveMove(cooling).cooling, true)
  assert.match(liveWhyLine(cooling), /cooling/)
  assert.match(liveWhy(cooling).join(' '), /fading rather than building/)
})

test('thin evidence says so on both surfaces', () => {
  const thin = row({ confidence: 0.3 })
  assert.match(liveWhyLine(thin), /thin$/)
  assert.match(liveWhy(thin).join(' '), /Thin evidence/)
})

test('nothing to say is said as nothing', () => {
  assert.equal(liveMove(null), null)
  assert.equal(liveWhyLine(null), null)
  assert.deepEqual(liveWhy(null), [])
  assert.equal(liveWhyLine(row({ uniqueSources: 1, mentions: 10, contributions: {} })), null)
})

test('a name at their own normal is not captioned "coverage leading"', () => {
  // True of most of the board most of the time, so it is wallpaper: the
  // evidence carries the row instead.
  const ordinary = row({ mentions: 310 })
  const line = liveWhyLine(ordinary)
  assert.doesNotMatch(line, /leading/)
  assert.match(line, /^400 outlets in 9 countries/)
})
