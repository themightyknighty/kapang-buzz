/** The market's blob store, kept separate from the news feed's. */
import { getStore } from '@netlify/blobs'
import { STORE_NAME } from '../../market/config.mjs'

/*
 * Strong consistency is not optional here.
 *
 * Blobs reads default to eventual consistency, served from a regional cache.
 * Two things in this codebase break under that. `appendSnapshot` is a
 * read-modify-write on a day file: a stale read returns the file as it was
 * several ticks ago, and the write then puts that back — silently deleting
 * every snapshot in between, which is exactly how a rolling 24-hour count
 * ends up permanently reading as its own latest window. And the read
 * endpoints disagree with each other: /api/market/health served the 22:00
 * market while /api/market served 22:15, from the same key, seconds apart.
 *
 * Strong reads cost a little latency per call. The run makes a few hundred,
 * pooled, and finishes in about a second.
 */
export function marketBlobs() {
  const s = getStore(STORE_NAME, { consistency: 'strong' })
  return {
    getJSON: (k) => s.get(k, { type: 'json' }),
    setJSON: (k, v) => s.setJSON(k, v),
    delete: (k) => s.delete(k),
  }
}

export const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
})

export const authorised = (req) => {
  const expected = process.env.SYNC_TOKEN
  const given = req.headers.get('x-sync-token') || new URL(req.url).searchParams.get('token')
  return Boolean(expected) && given === expected
}

/**
 * Scheduled functions get 30 seconds and a run needs minutes, so the schedule
 * only kicks the background worker and returns.
 */
export async function kickMarket(params) {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL
  if (!base || !process.env.SYNC_TOKEN) return { kicked: false, reason: 'URL or SYNC_TOKEN missing' }
  const res = await fetch(`${base}/.netlify/functions/market-run-background?${new URLSearchParams(params)}`, {
    method: 'POST', headers: { 'x-sync-token': process.env.SYNC_TOKEN },
  })
  return { kicked: res.status === 202, status: res.status }
}
