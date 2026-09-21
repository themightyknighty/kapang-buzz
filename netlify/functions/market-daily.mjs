/**
 * Once a day at 03:00 UTC: the Wikipedia sweep for the whole roster, the
 * daily rollups, the day's history, records, and pruning of expired
 * intraday files.
 */
import { marketBlobs, kickMarket, json } from './_market-store.mjs'

export default async () => {
  if (process.env.MARKET_PAUSED === '1') return json({ skipped: 'MARKET_PAUSED=1' })
  return json(await kickMarket({ daily: '1', trigger: 'daily' }))
}

export const config = { schedule: '0 3 * * *' }
