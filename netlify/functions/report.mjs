/**
 * POST /api/report — a viewer flags a story. Stored for review; three reports
 * on one story take it off air automatically until someone looks.
 */
import { blobStore, json } from './_store.mjs'
import { pullStory } from '../../pipeline/run.mjs'

export const AUTO_PULL_AT = 3

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  let body
  try { body = await req.json() } catch { return json({ error: 'bad JSON' }, 400) }
  const id = String(body.id || '').slice(0, 60)
  const reason = String(body.reason || '').slice(0, 300)
  if (!id) return json({ error: 'id is required' }, 400)
  const store = blobStore()
  const reports = (await store.getJSON('reports.json').catch(() => null)) || []
  reports.unshift({ id, reason, at: new Date().toISOString() })
  await store.setJSON('reports.json', reports.slice(0, 500))
  const count = reports.filter((r) => r.id === id).length
  let pulled = false
  if (count >= AUTO_PULL_AT) pulled = await pullStory(store, id)
  return json({ ok: true, pulled })
}
