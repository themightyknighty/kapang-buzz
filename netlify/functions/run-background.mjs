/**
 * The publishing run itself: harvest → write → publish. A background function
 * (15 minutes), token-gated because it spends money on every call.
 */
import { runPipeline } from '../../pipeline/run.mjs'
import { blobStore, authorised } from './_store.mjs'

export default async (req) => {
  if (!authorised(req)) return new Response('Not authorised.', { status: 401 })
  const trigger = new URL(req.url).searchParams.get('trigger') || 'manual'
  await runPipeline({ store: blobStore(), trigger })
  return new Response(null, { status: 202 })
}
