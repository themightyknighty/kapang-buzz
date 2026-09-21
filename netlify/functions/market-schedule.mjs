/**
 * Every 15 minutes: refresh one shard of the roster plus the hot list.
 *
 * Four shards mean every celebrity is fully refreshed hourly while the top
 * movers are re-checked on every tick. The shard to run is stored alongside
 * the hot list, so the rotation survives restarts.
 */
import { marketBlobs, kickMarket, json } from './_market-store.mjs'
import { createStore } from '../../market/store.mjs'

export default async () => {
  if (process.env.MARKET_PAUSED === '1') return json({ skipped: 'MARKET_PAUSED=1' })
  const { shard = 0 } = (await createStore(marketBlobs()).readHotList()) || {}
  return json(await kickMarket({ shard: String(shard), trigger: 'schedule' }))
}

export const config = { schedule: '*/15 * * * *' }
