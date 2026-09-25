import test from 'node:test'
import assert from 'node:assert/strict'
import { ticksBetween } from './useExchange.js'

/*
 * Every piece of motion on the exchange screen is driven by this function.
 * A market screen that animates on a timer rather than on a trade is lying
 * about the one thing it exists to report, so these assertions are really
 * about what must NOT move.
 */
const board = (names) => ({ names })

test('a price that moved is marked, with its direction', () => {
  const t = ticksBetween(board([{ id: 'a', price: 10 }]), board([{ id: 'a', price: 12 }]))
  assert.equal(t.get('a').dir, 'up')
  assert.equal(t.get('a').from, 10)

  const down = ticksBetween(board([{ id: 'a', price: 12 }]), board([{ id: 'a', price: 10 }]))
  assert.equal(down.get('a').dir, 'down')
})

test('a price that did not move does not flash', () => {
  const t = ticksBetween(board([{ id: 'a', price: 10 }]), board([{ id: 'a', price: 10 }]))
  assert.equal(t.size, 0, 'an unchanged poll must leave the board still')
})

test('a name seen for the first time does not flash', () => {
  // Arriving is not moving. Flashing every row on first load is the exact
  // "it animates on a timer" tell.
  assert.equal(ticksBetween(null, board([{ id: 'a', price: 10 }])).size, 0)
  assert.equal(ticksBetween(board([]), board([{ id: 'a', price: 10 }])).size, 0)
})

test('a price that is not a number is not a movement', () => {
  assert.equal(ticksBetween(board([{ id: 'a', price: null }]), board([{ id: 'a', price: 10 }])).size, 0)
  assert.equal(ticksBetween(board([{ id: 'a', price: 10 }]), board([{ id: 'a', price: null }])).size, 0)
})

test('only the names that moved are marked', () => {
  const t = ticksBetween(
    board([{ id: 'a', price: 10 }, { id: 'b', price: 20 }, { id: 'c', price: 30 }]),
    board([{ id: 'a', price: 11 }, { id: 'b', price: 20 }, { id: 'c', price: 29 }]),
  )
  assert.deepEqual([...t.keys()].sort(), ['a', 'c'])
})

test('a tick carries the moment, so the same move twice still replays', () => {
  const t = ticksBetween(board([{ id: 'a', price: 10 }]), board([{ id: 'a', price: 11 }]))
  assert.ok(Number.isFinite(t.get('a').at))
})
