/** Netlify Blobs behind the tiny store interface the pipeline expects. */
import { getStore } from '@netlify/blobs'

// Storage name kept from the app's first name so the published feed carries over.
export const STORE = 'kapang-buzz'

export function blobStore() {
  const s = getStore(STORE)
  return {
    getJSON: (k) => s.get(k, { type: 'json' }),
    setJSON: (k, v) => s.setJSON(k, v),
  }
}

export const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body, null, 2), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
})

export const authorised = (req) => {
  const expected = process.env.SYNC_TOKEN
  const given = req.headers.get('x-sync-token') || new URL(req.url).searchParams.get('token')
  return Boolean(expected) && given === expected
}

/**
 * Scheduled functions get 30 seconds; a run needs a few minutes. So the
 * schedule only kicks the background worker and returns.
 */
export async function kickRun(trigger) {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL
  if (!base || !process.env.SYNC_TOKEN) return { kicked: false, reason: 'URL or SYNC_TOKEN missing' }
  const res = await fetch(`${base}/.netlify/functions/run-background?trigger=${encodeURIComponent(trigger)}`, {
    method: 'POST', headers: { 'x-sync-token': process.env.SYNC_TOKEN },
  })
  return { kicked: res.status === 202, status: res.status }
}
