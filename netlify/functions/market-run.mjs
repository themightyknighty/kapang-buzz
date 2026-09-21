/** Kick a run by hand, for the first fill and for debugging. */
import { marketBlobs, json, authorised, kickMarket } from './_market-store.mjs'

export default async (req) => {
  if (!authorised(req)) return new Response('Not authorised.', { status: 401 })
  const url = new URL(req.url)
  return json(await kickMarket({
    shard: url.searchParams.get('shard') ?? '',
    daily: url.searchParams.get('daily') ?? '',
    trigger: 'manual',
  }))
}
