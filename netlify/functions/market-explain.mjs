/**
 * The full derivation for one celebrity, including the raw source payloads.
 * Token-gated: it exposes API responses and internal baselines.
 */
import { marketBlobs, json, authorised } from './_market-store.mjs'
import { createStore } from '../../market/store.mjs'
import { WEIGHTS } from '../../market/config.mjs'

export default async (req) => {
  if (!authorised(req)) return new Response('Not authorised.', { status: 401 })
  const slug = new URL(req.url).pathname.split('/').filter(Boolean).pop()
  const store = createStore(marketBlobs())
  const market = await store.readMarket()
  const row = market?.rows?.find((r) => r.slug === slug)
  if (!row) return json({ error: 'Not tracked.', slug }, 404)
  const [news, wikipedia, health] = await Promise.all([
    store.readSource('news', row.id), store.readSource('wikipedia', row.id), store.readHealth(),
  ])
  return json({ row, weights: WEIGHTS, raw: { news, wikipedia }, health, generatedAt: market.generatedAt })
}
