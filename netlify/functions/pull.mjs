/**
 * Take a story off air immediately, and keep it off.
 *   curl -X POST -H "x-sync-token: $SYNC_TOKEN" "https://<site>/api/pull?id=<story id>"
 */
import { blobStore, json, authorised } from './_store.mjs'
import { pullStory } from '../../pipeline/run.mjs'

export default async (req) => {
  if (!authorised(req)) return json({ error: 'Not authorised.' }, 401)
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return json({ error: 'id is required' }, 400)
  return json({ id, removed: await pullStory(blobStore(), id) })
}
