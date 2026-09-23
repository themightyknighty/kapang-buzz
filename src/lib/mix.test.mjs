import test from 'node:test'
import assert from 'node:assert/strict'
import { mixStories, normaliseMix, isDefaultMix, DEFAULT_MIX, MIX_MAX } from './mix.js'

/** A day shaped the way the pipeline publishes one. */
const day = () => [
  ...Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, strand: 'celebrity' })),
  ...Array.from({ length: 6 }, (_, i) => ({ id: `h${i}`, strand: 'health' })),
  ...Array.from({ length: 6 }, (_, i) => ({ id: `f${i}`, strand: 'facts' })),
  ...Array.from({ length: 6 }, (_, i) => ({ id: `b${i}`, strand: 'bizarre' })),
]
const count = (list, strand) => list.filter((s) => s.strand === strand).length

test('a strand at zero is gone, so "all celebrity" is reachable', () => {
  const only = mixStories(day(), { celebrity: 12, health: 0, facts: 0, bizarre: 0 })
  assert.equal(only.length, 12)
  assert.ok(only.every((s) => s.strand === 'celebrity'))

  const weird = mixStories(day(), { celebrity: 0, health: 0, facts: 0, bizarre: 9 })
  assert.equal(weird.length, 6, 'six bizarre stories exist; asking for more cannot invent them')
  assert.ok(weird.every((s) => s.strand === 'bizarre'))
})

test('the proportion holds at the top of the list, not just over the whole of it', () => {
  // The reader sees the first few and the channel plays only the first few,
  // so a mix that is only true at length 30 is not true where it is read.
  const mixed = mixStories(day(), { celebrity: 3, health: 1, facts: 1, bizarre: 1 })
  const top = mixed.slice(0, 12)
  assert.equal(count(top, 'celebrity'), 6)
  assert.equal(count(top, 'health'), 2)
  assert.equal(count(top, 'facts'), 2)
  assert.equal(count(top, 'bizarre'), 2)
})

test('nothing is lost: a page is never shorter than the day it came from', () => {
  const all = mixStories(day(), { celebrity: 1, health: 1, facts: 1, bizarre: 1 })
  assert.equal(all.length, 30)
  assert.equal(count(all, 'celebrity'), 12)
})

test('every slider at zero is a reader with no opinion, not a request for nothing', () => {
  const none = mixStories(day(), { celebrity: 0, health: 0, facts: 0, bizarre: 0 })
  assert.equal(none.length, 30, 'an empty page is never what somebody meant')
})

test('a limit takes the top of the mix, still in proportion', () => {
  const six = mixStories(day(), { celebrity: 2, health: 1, facts: 1, bizarre: 0 }, { limit: 8 })
  assert.equal(six.length, 8)
  assert.equal(count(six, 'bizarre'), 0)
  assert.equal(count(six, 'celebrity'), 4)
})

test('a stored mix is made safe before it is trusted', () => {
  const m = normaliseMix({ celebrity: -5, health: 999, facts: 2.6, bizarre: 'x' })
  assert.equal(m.celebrity, 0)
  assert.equal(m.health, MIX_MAX)
  assert.equal(m.facts, 3)
  assert.equal(m.bizarre, DEFAULT_MIX.bizarre, 'rubbish falls back to the published shape')
  assert.deepEqual(normaliseMix(null), DEFAULT_MIX)
})

test('the published shape is recognised as no opinion', () => {
  assert.equal(isDefaultMix(DEFAULT_MIX), true)
  assert.equal(isDefaultMix({ ...DEFAULT_MIX, bizarre: 12 }), false)
})

test('an empty day stays empty without throwing', () => {
  assert.deepEqual(mixStories([], DEFAULT_MIX), [])
  assert.deepEqual(mixStories(undefined, DEFAULT_MIX), [])
})
