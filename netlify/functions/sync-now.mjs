/**
 * Start a run now. Primes the feed on first deploy.
 *   curl -X POST -H "x-sync-token: $SYNC_TOKEN" https://<site>/.netlify/functions/sync-now
 * Then check /api/status a few minutes later.
 */
import { kickRun, json, authorised } from './_store.mjs'

export default async (req) => {
  if (!process.env.SYNC_TOKEN) return json({ error: 'SYNC_TOKEN is not set on this site — refusing to run.' }, 500)
  if (!authorised(req)) return json({ error: 'Not authorised.' }, 401)
  return json(await kickRun('manual'))
}
