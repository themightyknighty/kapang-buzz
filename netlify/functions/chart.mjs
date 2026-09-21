/**
 * The Genie 100.
 *
 *   /api/chart           the latest published edition
 *   /api/chart/live      the week in progress, provisional, rewritten every run
 *   /api/chart/index     every edition ever published, newest first
 *   /api/chart/2026-W38  one edition
 *
 * One blob read each. An edition never changes after it is published, so a
 * specific week is cached hard; "this week" is cached for long enough to
 * absorb a Monday morning and no longer.
 */
import { marketBlobs, json } from './_market-store.mjs'
import { createStore } from '../../market/store.mjs'
import { CHART } from '../../market/config.mjs'
import { chartWeekFor, weekRange, publishAt } from '../../market/chart.mjs'

const WEEK = 'public, max-age=300, s-maxage=604800, stale-while-revalidate=604800'
const LATEST = 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600'
/* The running order is rewritten every fifteen minutes and the whole point of
   it is that it has moved since last time, so it is barely cached at all. */
const LIVE = 'public, max-age=30, s-maxage=60, stale-while-revalidate=300'

export default async (req) => {
  const arg = new URL(req.url).pathname.split('/').filter(Boolean).pop()
  const store = createStore(marketBlobs())

  if (arg === 'live') {
    const live = await store.readLiveChart()
    if (!live) {
      return json({
        empty: true, live: true, name: CHART.name,
        reason: 'The week in progress has not been counted yet.',
      }, 200, { 'Cache-Control': LIVE })
    }
    return json(live, 200, { 'Cache-Control': LIVE })
  }

  if (arg === 'index') {
    const index = await store.readChartIndex()
    return json({ ...index, name: CHART.name, descriptor: CHART.descriptor }, 200, { 'Cache-Control': LATEST })
  }

  // A week id, or nothing at all for the current one.
  const wanted = arg && arg !== 'chart' && weekRange(arg) ? arg : null
  const edition = wanted ? await store.readChart(wanted) : await store.readLatestChart()

  if (!edition) {
    const due = chartWeekFor()
    return json({
      empty: true,
      name: CHART.name,
      descriptor: CHART.descriptor,
      // Not an error: before the first Monday there is genuinely no chart, and
      // the screen should say when there will be rather than that something
      // broke.
      reason: wanted
        ? `No edition for ${wanted}.`
        : 'The first chart has not been published yet.',
      nextAt: new Date(publishAt(due) + 7 * 86400000).toISOString(),
    }, wanted ? 404 : 200, { 'Cache-Control': LATEST })
  }

  return json(edition, 200, { 'Cache-Control': wanted ? WEEK : LATEST })
}
