/** Search the tracked roster. An untracked name says so rather than 404ing silently. */
import { marketBlobs, json } from './_market-store.mjs'
import { createStore } from '../../market/store.mjs'

export default async (req) => {
  const q = (new URL(req.url).searchParams.get('q') || '').trim().toLowerCase()
  const market = await createStore(marketBlobs()).readMarket()
  if (!q) return json({ query: q, results: [] })
  const results = (market?.rows || [])
    .filter((r) => r.displayName.toLowerCase().includes(q))
    .slice(0, 20)
    .map((r) => ({ id: r.id, slug: r.slug, displayName: r.displayName, rank: r.rank, gossipScore: r.gossipScore, momentum: r.momentum, change24h: r.change24h, status: r.status }))
  return json({ query: q, results, tracked: market?.rows?.length ?? 0, trackable: results.length === 0 })
}
