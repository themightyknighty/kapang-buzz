/**
 * The ingestion run itself. A background function (15 minutes), token-gated
 * because it spends external API quota on every call.
 *
 * Three jobs share it, chosen by query parameter:
 *   (none)      one shard of the roster, every 15 minutes
 *   daily=1     the 03:00 sweep — Wikipedia, rollups, history, pruning
 *   chart=1     Monday's Genie 100 edition
 */
import { runMarket, runDaily } from '../../market/run.mjs'
import { publishChart, backfillCharts } from '../../market/chartjob.mjs'
import { marketBlobs, authorised } from './_market-store.mjs'
import { blobStore } from './_store.mjs'
import { KEYS } from '../../pipeline/run.mjs'

/**
 * The published feed, for the reason beside each name on the chart.
 *
 * It lives in the news app's blob store rather than the market's, and a
 * chart is worth publishing without it — a week with no reasons attached is
 * a thinner chart, not a broken one.
 */
const stories = async () => {
  try { return (await blobStore().getJSON(KEYS.feed))?.stories || [] } catch { return [] }
}

export default async (req) => {
  if (!authorised(req)) return new Response('Not authorised.', { status: 401 })
  const url = new URL(req.url)
  const blobs = marketBlobs()
  const log = []
  try {
    if (url.searchParams.get('chart') === '1') {
      const opts = {
        blobs,
        stories: await stories(),
        log,
        weekId: url.searchParams.get('week') || null,
        replace: url.searchParams.get('replace') === '1',
      }
      const minDays = Number(url.searchParams.get('minDays'))
      if (Number.isFinite(minDays) && minDays > 0) opts.minDays = minDays
      if (url.searchParams.get('backfill') === '1') await backfillCharts({ ...opts, weekId: undefined })
      else await publishChart(opts)
    } else if (url.searchParams.get('daily') === '1') {
      await runDaily({ blobs, log })
    } else {
      await runMarket({ blobs, shard: Number(url.searchParams.get('shard')) || 0, log })
    }
  } catch (err) {
    log.push(`run failed: ${err.message}`)
    console.error('market run failed', err)
  }
  console.log(log.join('\n'))
  return new Response(null, { status: 202 })
}
