/**
 * Accept a market computed elsewhere and publish it.
 *
 * This is the escape hatch for the GDELT rate-limit problem: if Netlify's
 * shared egress IPs keep drawing 429s, the same ingestion code runs on a
 * machine with its own IP (scripts/market-local.mjs --push) and hands the
 * finished market to the site through here. Token-gated, and it refuses
 * anything that is not a real market.
 */
import { marketBlobs, json, authorised } from './_market-store.mjs'
import { createStore } from '../../market/store.mjs'

export default async (req) => {
  if (!authorised(req)) return new Response('Not authorised.', { status: 401 })
  let market
  try { market = await req.json() } catch { return json({ error: 'Body must be JSON.' }, 400) }

  if (!Array.isArray(market?.rows) || !market.rows.length) return json({ error: 'No rows.' }, 400)
  if (market.mock) return json({ error: 'Refusing to publish mock data to production.' }, 400)
  if (!market.generatedAt || Number.isNaN(Date.parse(market.generatedAt))) return json({ error: 'Missing generatedAt.' }, 400)

  await createStore(marketBlobs()).writeMarket({ ...market, publishedVia: 'external', publishedAt: new Date().toISOString() })
  return json({ ok: true, rows: market.rows.length, generatedAt: market.generatedAt })
}
