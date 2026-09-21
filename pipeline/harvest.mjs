/**
 * Step 1 — harvest candidate headlines from every source.
 *
 * Every source is allowed to fail on its own. A dead feed is logged with a
 * count of zero and the run carries on with what it has.
 */
import { UA, GDELT_DOC_API, GDELT_QUERIES, GDELT_GAP_MS, RSS_FEEDS } from './config.mjs'
import { rootDomain } from './cluster.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function fetchText(url, { timeoutMs = 20000, fetchImpl = fetch, headers = {} } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': UA, ...headers }, signal: ctrl.signal, redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(t)
  }
}

/* ---------------- GDELT ---------------- */

/** GDELT seendate is 20260916T123000Z. */
export function parseGdeltDate(s) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(s || ''))
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null
}

/**
 * GDELT answers a rate-limit breach with a plain-text sentence and HTTP 200,
 * so "is it JSON" is the real success test.
 */
export function readGdelt(text, strand) {
  let data
  try { data = JSON.parse(text) } catch {
    throw new Error(/limit requests/i.test(text) ? 'GDELT rate limit hit' : 'GDELT returned non-JSON')
  }
  return (data.articles || [])
    .filter((a) => a.title && a.url && (!a.language || /english/i.test(a.language)))
    .map((a) => ({
      strand,
      title: a.title.trim(),
      url: a.url,
      domain: rootDomain(a.domain || a.url),
      seenAt: parseGdeltDate(a.seendate) || new Date().toISOString(),
      source: 'gdelt',
      publicDomain: false,
    }))
}

export async function harvestGdelt({ fetchImpl, log, gapMs = GDELT_GAP_MS } = {}) {
  const out = []
  let first = true
  for (const [strand, cfg] of Object.entries(GDELT_QUERIES)) {
    const url = `${GDELT_DOC_API}?${new URLSearchParams({
      query: cfg.q, mode: 'artlist', format: 'json', sort: 'hybridrel',
      timespan: cfg.timespan, maxrecords: String(cfg.max),
    })}`
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (!first) await sleep(attempt === 1 ? gapMs : gapMs * 2)
      first = false
      try {
        const items = readGdelt(await fetchText(url, { fetchImpl }), strand)
        log?.push(`gdelt ${strand}: ${items.length} headlines`)
        out.push(...items)
        break
      } catch (err) {
        log?.push(`gdelt ${strand}: ${err.message}${attempt === 1 ? ' — retrying' : ' — skipped'}`)
      }
    }
  }
  return out
}

/* ---------------- RSS ---------------- */

const decode = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')

export const stripHtml = (s) => decode(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

const tag = (block, name) => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block)
  return m ? m[1] : ''
}

/** Minimal RSS 2.0 / Atom reader. Enough for government press feeds. */
export function readRss(xml, feed) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || []
  return blocks.map((b) => {
    let link = stripHtml(tag(b, 'link'))
    if (!link) { const m = /<link[^>]*href="([^"]+)"/i.exec(b); link = m ? m[1] : '' }
    const date = stripHtml(tag(b, 'pubDate') || tag(b, 'updated') || tag(b, 'published') || tag(b, 'dc:date'))
    const summary = stripHtml(tag(b, 'content:encoded') || tag(b, 'description') || tag(b, 'summary')).slice(0, 4000)
    const enclosure = /<(?:enclosure|media:content)[^>]*url="([^"]+)"/i.exec(b)
    return {
      strand: feed.strand,
      title: stripHtml(tag(b, 'title')),
      url: link,
      domain: rootDomain(link || feed.url),
      seenAt: Date.parse(date) ? new Date(Date.parse(date)).toISOString() : new Date().toISOString(),
      summary,
      imageUrl: enclosure ? decode(enclosure[1]) : null,
      source: feed.id,
      publicDomain: feed.publicDomain,
      credit: feed.credit,
    }
  }).filter((i) => i.title && i.url)
}

export async function harvestRss({ fetchImpl, log, maxAgeHours = 48, now = Date.now() } = {}) {
  const ageFor = (feed) => (feed.maxAgeHours || (feed.strand === 'celebrity' ? maxAgeHours : 96))
  const results = await Promise.all(RSS_FEEDS.map(async (feed) => {
    try {
      const items = readRss(await fetchText(feed.url, { fetchImpl }), feed)
        .filter((i) => now - Date.parse(i.seenAt) <= ageFor(feed) * 3600000)
      log?.push(`rss ${feed.id}: ${items.length} recent items`)
      return items
    } catch (err) {
      log?.push(`rss ${feed.id}: ${err.message} — skipped`)
      return []
    }
  }))
  return results.flat()
}

/* ---------------- page summaries ---------------- */

/**
 * The writer needs more than a headline to report accurately. We read the
 * page's own published summary (og:description / meta description) — a
 * sentence or two — and never store or show the article body.
 */
export function readMetaDescription(html) {
  const m = /<meta[^>]+(?:property|name)=["'](?:og:description|description|twitter:description)["'][^>]*content=["']([^"']{20,})["']/i.exec(html)
    || /<meta[^>]+content=["']([^"']{20,})["'][^>]*(?:property|name)=["'](?:og:description|description)["']/i.exec(html)
  return m ? stripHtml(m[1]).slice(0, 400) : ''
}

export async function addSummaries(cluster, { fetchImpl, perCluster = 4 } = {}) {
  await Promise.all(cluster.items.slice(0, perCluster).map(async (it) => {
    if (it.summary) return
    try {
      const html = await fetchText(it.url, { fetchImpl, timeoutMs: 8000 })
      it.summary = readMetaDescription(html.slice(0, 60000))
    } catch { it.summary = '' }
  }))
  return cluster
}

/**
 * GDELT rate-limits Netlify's shared addresses, so it is off unless
 * BUZZ_GDELT=1. The RSS feeds carry the app.
 */
export async function harvestAll(opts = {}) {
  const useGdelt = (opts.env || process.env).BUZZ_GDELT === '1'
  if (!useGdelt) opts.log?.push('gdelt: off (set BUZZ_GDELT=1 to try it)')
  const [rss, gdelt] = await Promise.all([harvestRss(opts), useGdelt ? harvestGdelt(opts) : []])
  return [...rss, ...gdelt]
}
