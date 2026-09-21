/** The market table — one blob read serves the whole page. */
import { marketBlobs, json } from './_market-store.mjs'
import { createStore } from '../../market/store.mjs'

export default async () => {
  const market = await createStore(marketBlobs()).readMarket()
  if (!market) return json({ rows: [], empty: true, reason: 'No ingestion run has published yet.' }, 200)
  return json(market)
}
