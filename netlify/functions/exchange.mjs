/**
 * The Genie Exchange.
 *
 *   /api/exchange          the whole board, one blob read
 *   /api/exchange/:slug    one name's book — every close since listing
 *
 * The board is rewritten every fifteen minutes with an indicative price and
 * once a day with a settled close, so it is cached about as hard as the live
 * chart: long enough to absorb a rush, short enough that the number on the
 * page is the number the market has.
 *
 * A book is different. Every day in it has closed and will never change —
 * that is the whole reason books are stored rather than derived — so it is
 * cached hard and revalidated lazily.
 */
import { marketBlobs, json } from './_market-store.mjs'
import { createStore } from '../../market/store.mjs'

const BOARD = 'public, max-age=30, s-maxage=60, stale-while-revalidate=300'
const BOOK = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400'

export default async (req) => {
  const parts = new URL(req.url).pathname.split('/').filter(Boolean)
  const slug = parts[parts.length - 1] === 'exchange' ? null : parts[parts.length - 1]
  const store = createStore(marketBlobs())

  if (slug) {
    const board = await store.readPriceBoard()
    const row = (board?.names || []).find((n) => n.slug === slug || n.id === slug)
    if (!row) return json({ error: 'not listed', slug }, 404, { 'Cache-Control': BOARD })
    const book = await store.readPrices(row.id)
    if (!book) return json({ error: 'no book', slug }, 404, { 'Cache-Control': BOARD })
    return json({ ...row, book: book.days || [] }, 200, { 'Cache-Control': BOOK })
  }

  const board = await store.readPriceBoard()
  if (!board?.names?.length) {
    /*
     * Not an error. The exchange lists a name once it has a day of history
     * behind it, so before the first settle there is genuinely nothing to
     * quote — and saying so is better than an empty table that looks broken.
     */
    return json({
      empty: true,
      reason: 'The exchange has not opened yet. Prices are settled once a day.',
      names: [],
    }, 200, { 'Cache-Control': BOARD })
  }
  return json(board, 200, { 'Cache-Control': BOARD })
}
