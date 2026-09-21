/** Adapter freshness and errors — how the market knows it is telling the truth. */
import { marketBlobs, json } from './_market-store.mjs'
import { createStore } from '../../market/store.mjs'

export default async () => {
  const store = createStore(marketBlobs())
  const [health, market] = await Promise.all([store.readHealth(), store.readMarket()])

  /*
   * How deep the rolling day actually is. The market needs 96 windows before
   * a 24-hour total means anything, and without this the warm-up is
   * indistinguishable from a fault — which is how "everyone is on zero" got
   * diagnosed the slow way the first time.
   */
  const now = Date.now()
  const busiest = (market?.rows || []).slice().sort((a, b) => (b.mentions || 0) - (a.mentions || 0))[0]
  const points = busiest ? await store.readSeries(busiest.id, now - 24 * 3600000, now) : []

  return json({
    health,
    generatedAt: market?.generatedAt ?? null,
    nextUpdateAt: market?.nextUpdateAt ?? null,
    tracked: market?.rows?.length ?? 0,
    window: {
      file: market?.newsWindowFile ?? null,
      measured: market?.newsWindowMeasured ?? null,
    },
    rollingDay: {
      windowsStored: points.length,
      windowsNeeded: 96,
      oldest: points[0]?.timestamp ?? null,
      newest: points.at(-1)?.timestamp ?? null,
      sampledFrom: busiest?.displayName ?? null,
      warmingUp: points.length < 96,
    },
    lastRun: market?.run ?? null,
  })
}
