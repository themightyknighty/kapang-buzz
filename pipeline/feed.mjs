/**
 * The published feed: merge a run's new stories in, age old ones out, and
 * build the Buzz Board.
 */
import { FEED_WINDOW_HOURS, FEED_MAX, SEEN_DAYS, STRAND_KEYS } from './config.mjs'
import { fingerprint } from './cluster.mjs'

export function storyId(cluster, now = new Date()) {
  const d = now.toISOString().slice(0, 10).replace(/-/g, '')
  let h = 0
  for (const ch of cluster.key) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return `${d}-${cluster.strand.slice(0, 3)}-${h.toString(36)}`
}

/** A finished story: the draft, the image and the paperwork. */
/** `media` is the result of findMedia, or (older callers and tests) a single image. */
export function assembleStory(cluster, draft, media, { now = new Date(), runId } = {}) {
  const m = media && ('gallery' in media || 'video' in media) ? media : { image: media || null, gallery: media ? [media] : [], video: null }
  const cp = draft.chatPrompt
  return {
    id: storyId(cluster, now),
    key: cluster.key,
    strand: cluster.strand,
    publishedAt: now.toISOString(),
    runId,
    headline: draft.headline.trim(),
    caption: draft.caption.trim(),
    body: draft.body.trim(),
    keyFacts: (draft.keyFacts || []).slice(0, 3).map((s) => String(s).trim()),
    whyTrending: String(draft.whyTrending || '').trim(),
    people: (draft.people || []).slice(0, 4),
    bigNumber: draft.bigNumber?.value ? { value: String(draft.bigNumber.value), label: String(draft.bigNumber.label || '') } : null,
    quiz: draft.quiz,
    outlets: new Set(cluster.domains).size,
    sources: cluster.items.slice(0, 6).map((i) => ({ name: i.credit || i.domain, url: i.url })),
    image: m.image || null,
    gallery: m.gallery || [],
    video: m.video || null,
    chatPrompt: cp?.question ? { question: String(cp.question).trim(), a: String(cp.a || '').trim(), b: String(cp.b || '').trim() } : null,
  }
}

export function mergeFeed(previous, fresh, { now = Date.now(), pulled = [] } = {}) {
  const cutoff = now - FEED_WINDOW_HOURS * 3600000
  const pulledSet = new Set(pulled)
  const byId = new Map()
  for (const s of [...fresh, ...(previous?.stories || [])]) {
    if (pulledSet.has(s.id)) continue
    if (Date.parse(s.publishedAt) < cutoff) continue
    if (!byId.has(s.id)) byId.set(s.id, s)
  }
  const stories = [...byId.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, FEED_MAX)
  return {
    generatedAt: new Date(now).toISOString(),
    counts: countToday(stories, now),
    stories,
    buzz: previous?.buzz || null,
  }
}

/** Stories published in the last 24 hours, per strand. */
export function countToday(stories, now = Date.now()) {
  const c = Object.fromEntries(STRAND_KEYS.map((k) => [k, 0]))
  let total = 0
  for (const s of stories) {
    if (now - Date.parse(s.publishedAt) <= 86400000) { c[s.strand]++; total++ }
  }
  return { ...c, total }
}

export function updateSeen(seen = {}, clusters, now = Date.now()) {
  const cutoff = now - SEEN_DAYS * 86400000
  const out = {}
  for (const [k, t] of Object.entries(seen)) if (t >= cutoff) out[k] = t
  for (const c of clusters) out[c.key || fingerprint(c.lead.title)] = now
  return out
}

/* ---------------- Buzz Board ----------------
   Built only from names in stories we have already published and judged
   family-safe. Wikipedia's most-viewed list is full of people in the news
   for terrible reasons; this board can never show one of them. */

const PAGEVIEWS = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user'
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '')

export function trendFromDaily(views) {
  // views: oldest → newest daily counts. Latest day vs the average of the rest.
  if (!views.length) return { today: 0, avg: 0, change: 0, direction: 'steady' }
  const today = views.at(-1)
  const rest = views.slice(0, -1)
  const avg = rest.length ? rest.reduce((a, b) => a + b, 0) / rest.length : today
  const change = avg ? (today - avg) / avg : 0
  return { today, avg: Math.round(avg), change: Math.round(change * 100), direction: change > 0.15 ? 'rising' : change < -0.15 ? 'cooling' : 'steady' }
}

export async function buildBuzz(stories, { fetchText, now = new Date(), log } = {}) {
  const mentions = new Map()
  for (const s of stories) {
    if (s.strand !== 'celebrity') continue
    if (Date.parse(now) - Date.parse(s.publishedAt) > 7 * 86400000) continue
    for (const p of s.people || []) {
      const m = mentions.get(p) || { name: p, stories: 0, latestStoryId: s.id, image: null }
      m.stories++
      if (!m.image && s.image?.kind === 'person') m.image = s.image
      mentions.set(p, m)
    }
  }
  const end = new Date(now.getTime() - 86400000) // yesterday is the latest complete day
  const start = new Date(end.getTime() - 7 * 86400000)
  const rows = []
  for (const m of mentions.values()) {
    let trend = { today: 0, avg: 0, change: 0, direction: 'steady' }, series = []
    try {
      const title = encodeURIComponent(m.name.replace(/ /g, '_'))
      const data = JSON.parse(await fetchText(`${PAGEVIEWS}/${title}/daily/${ymd(start)}/${ymd(end)}`))
      series = (data.items || []).map((i) => i.views)
      trend = trendFromDaily(series)
    } catch (err) {
      log?.push(`buzz: no pageviews for ${m.name} (${err.message})`)
    }
    rows.push({ ...m, ...trend, series })
  }
  rows.sort((a, b) => (b.today || 0) - (a.today || 0) || b.stories - a.stories)
  return { generatedAt: now.toISOString(), rows: rows.slice(0, 10) }
}
