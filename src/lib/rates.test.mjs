import test from 'node:test'
import assert from 'node:assert/strict'
import { rateFor, ratesFor, priceLabel, scoreLabel } from './rates.js'

const market = {
  rows: [
    { id: 'z', slug: 'zendaya', displayName: 'Zendaya', gossipScore: 87.73, change24h: 5.2, rank: 1 },
    { id: 'b', slug: 'beyonce', displayName: 'Beyoncé', gossipScore: 62.1, change24h: -3, rank: 9 },
  ],
}
const board = { names: [{ slug: 'zendaya', price: 1204.5, change: 2.4, settled: true }] }

test('a name in a story finds its score', () => {
  const r = rateFor('Zendaya', { market })
  assert.equal(r.slug, 'zendaya')
  assert.equal(scoreLabel(r), '87.7')
  assert.equal(r.href, '/market/zendaya')
})

test('accents match either way round', () => {
  // The feed writes "Beyoncé"; the roster may hold either.
  assert.equal(rateFor('Beyonce', { market }).slug, 'beyonce')
  assert.equal(rateFor('Beyoncé', { market }).slug, 'beyonce')
})

test('a price is shown where the exchange lists them and omitted where it does not', () => {
  assert.equal(priceLabel(rateFor('Zendaya', { market, board })), 'G$1,204.50')
  // Most names are not listed. A dash would read as a price of nothing.
  assert.equal(rateFor('Beyoncé', { market, board }).price, null)
  assert.equal(priceLabel(rateFor('Beyoncé', { market, board })), null)
})

test('a name the market does not track has no rate at all', () => {
  assert.equal(rateFor('Somebody Else', { market, board }), null)
  assert.equal(rateFor('', { market }), null)
  assert.equal(rateFor('Zendaya', {}), null)
})

test('the people a story names keep their order, and the untracked drop out', () => {
  const found = ratesFor(['Somebody Else', 'Beyoncé', 'Zendaya'], { market, board })
  assert.deepEqual(found.map((r) => r.slug), ['beyonce', 'zendaya'])
  assert.deepEqual(ratesFor([], { market }), [])
  assert.deepEqual(ratesFor(undefined, { market }), [])
})
