/**
 * Monday morning: publish the Genie 100.
 *
 * The week that just closed becomes an edition, once, and never changes
 * again. Scheduled functions get thirty seconds and this reads the whole
 * roster's rollups, so — like every other job here — the schedule only kicks
 * the background worker and returns.
 *
 * 13:00 UTC is 9am Eastern in summer and 8am in winter; Netlify's scheduler
 * speaks only UTC, so the hour drifts with daylight saving exactly as the
 * news schedule already does. The daily rollup job runs at 03:00, so Sunday's
 * numbers have been in the bank for ten hours by the time this fires.
 */
import { kickMarket, json } from './_market-store.mjs'

export default async () => {
  if (process.env.MARKET_PAUSED === '1') return json({ skipped: 'MARKET_PAUSED=1' })
  return json(await kickMarket({ chart: '1', trigger: 'chart-weekly' }))
}

export const config = { schedule: '0 13 * * 1' }
