/**
 * One celebrity: their row, today's intraday snapshots and the daily rollup.
 * Two blob reads, whatever time range the page asks for.
 */
import { marketBlobs, json } from './_market-store.mjs'
import { createStore } from '../../market/store.mjs'

export default async (req) => {
  const slug = new URL(req.url).pathname.split('/').filter(Boolean).pop()
  const store = createStore(marketBlobs())
  const market = await store.readMarket()
  const row = market?.rows?.find((r) => r.slug === slug)
  if (!row) return json({ error: 'Not tracked in the market.', slug }, 404)
  const now = Date.now()
  const [series, rollup] = await Promise.all([
    store.readSeries(row.id, now - 48 * 3600000, now),
    store.readRollup(row.id),
  ])
  return json({
    row,
    scoreSeries: series.map((p) => ({ t: Date.parse(p.timestamp), v: p.gossipScore })),
    daily: rollup.days,
    generatedAt: market.generatedAt,
    mock: false,
  })
}
