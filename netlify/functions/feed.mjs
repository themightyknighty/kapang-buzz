/** GET /api/feed — the published feed. Cached briefly at the edge. */
import { blobStore, json } from './_store.mjs'
import { KEYS } from '../../pipeline/run.mjs'

export default async () => {
  const store = blobStore()
  const [feed, log] = await Promise.all([store.getJSON(KEYS.feed).catch(() => null), store.getJSON(KEYS.log).catch(() => null)])
  if (!feed) return json({ stories: [], empty: true, hint: 'No run has published yet.' }, 200)
  return json({
    ...feed,
    lastRunOk: log ? log.ok !== false : null,
    lastRunAt: log?.finishedAt || null,
  }, 200, { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' })
}
