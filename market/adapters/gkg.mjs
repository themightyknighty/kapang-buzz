/**
 * NewsAdapter — GDELT's Global Knowledge Graph.
 *
 * The third source tried, and the right one. The DOC API refuses us at any
 * pace; the ngram files are 42 MB gzipped for a single minute of news and
 * would have meant matching names in raw text. The GKG is what this index
 * actually wants: one 6 MB file per 15 minutes covering the whole window,
 * with a column listing the people each article is about — already extracted
 * by GDELT.
 *
 * That makes entity matching almost trivial. Where the DOC path had to read
 * "Blaise Pascal and his calculating machine" and decide it was not the
 * actor, here GDELT has already named the person and we compare a normalized
 * string. The alias-strength machinery in match.mjs survives as a safety net
 * rather than the main event.
 *
 * ONE 15-MINUTE WINDOW IS A THIN SLICE. A real file holds around 1,400
 * articles: Taylor Swift appeared in 14 of them, and most of the roster in
 * none. So a window is not a measurement on its own — it is one tick that the
 * run accumulates into a rolling 24-hour count. The market therefore fills in
 * over its first day rather than arriving complete, which is honest and
 * visible in the UI as NEW ENTRY until each celebrity's baseline matures.
 */
import { unzipSync } from 'fflate'
import { GKG, UA } from '../config.mjs'
import { norm, domainOf, tierOf } from '../match.mjs'
import { queryAliases } from '../celebrities.mjs'
import { TIER_WEIGHT } from '../config.mjs'

export const meta = { key: 'news', label: 'News coverage (GDELT GKG)', cadenceMinutes: 15, weightGroup: 'news' }

/**
 * GKG 2.1 column positions. Named rather than numbered at the call site,
 * because GDELT has moved these between versions and a silent off-by-one
 * would read as "nobody is in the news".
 */
export const COL = {
  date: 1,
  sourceName: 3,
  documentId: 4,
  persons: 11,          // V1Persons — plain semicolon-separated names
  enhancedPersons: 12,  // V2EnhancedPersons — name,offset pairs
}

/**
 * GDELT publishes the current file list, so nothing here guesses at
 * timestamps. Guessing cost us five 404s per probe.
 */
export async function latestFiles(fetchImpl = fetch) {
  const res = await fetchImpl(GKG.lastUpdate, { headers: { 'User-Agent': UA } })
  if (!res.ok) return { ok: false, error: `lastupdate.txt → HTTP ${res.status}` }
  const files = (await res.text()).trim().split('\n').map((line) => {
    const [bytes, hash, url] = line.trim().split(/\s+/)
    return { bytes: Number(bytes) || 0, hash, url }
  }).filter((f) => f.url)
  const gkg = files.find((f) => f.url.includes('.gkg.'))
  return gkg ? { ok: true, gkg, files } : { ok: false, error: 'no GKG file in the listing' }
}

/**
 * The 15-minute window before this one.
 *
 * GDELT names every file for the start of its window, on a fixed quarter-hour
 * grid, so the previous file is a subtraction rather than a guess. This is
 * only ever used when the newest file is announced in lastupdate.txt but is
 * not yet on the CDN — a real and recurring race, and the reason the market
 * read zero for everyone at 22:00.
 */
export function previousWindowUrl(url) {
  const m = /(\d{14})\.gkg\.csv\.zip$/.exec(url || '')
  if (!m) return null
  const [, s] = m
  const at = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14))
  if (!Number.isFinite(at)) return null
  const p = new Date(at - 15 * 60000).toISOString().replace(/[-:T]/g, '').slice(0, 14)
  return url.replace(`${s}.gkg.csv.zip`, `${p}.gkg.csv.zip`)
}

/** The people an article is about, lowercased and de-duplicated. */
export function personsOf(cols) {
  const plain = cols[COL.persons] || ''
  const enhanced = cols[COL.enhancedPersons] || ''
  const names = new Set()
  for (const part of plain.split(';')) {
    const n = norm(part)
    if (n) names.add(n)
  }
  // The enhanced column carries "Name,offset" pairs; the name is what matters.
  for (const part of enhanced.split(';')) {
    const n = norm(part.split(',')[0])
    if (n) names.add(n)
  }
  return names
}

/**
 * Exact-match index from a person's name to the celebrity.
 *
 * Only full-name aliases go in. A bare surname would match the wrong person
 * the moment GDELT extracts one — "johnson" is not evidence of Dwayne
 * Johnson, and unlike the text path there is no surrounding sentence here to
 * confirm it from.
 */
export function buildPersonIndex(celebrities) {
  const index = new Map()
  for (const c of celebrities) {
    for (const a of queryAliases(c)) {
      const key = norm(a.text)
      // Single words are only safe when they are the celebrity's whole name.
      if (!key || (!key.includes(' ') && norm(c.displayName) !== key)) continue
      if (!index.has(key)) index.set(key, [])
      if (!index.get(key).some((x) => x.id === c.id)) index.get(key).push(c)
    }
  }
  return index
}

/** One file's rows folded into per-celebrity evidence. Pure. */
export function ingestRows(rows, celebrities, { index = buildPersonIndex(celebrities), into = new Map() } = {}) {
  let articles = 0
  for (const row of rows) {
    if (!row) continue
    const cols = row.split('\t')
    if (cols.length < COL.persons + 1) continue
    articles++
    const url = cols[COL.documentId] || null
    const domain = (cols[COL.sourceName] || domainOf(url || '')).toLowerCase().replace(/^www\./, '')
    for (const person of personsOf(cols)) {
      for (const c of index.get(person) || []) {
        if (!into.has(c.id)) into.set(c.id, { docs: new Map(), domains: new Set() })
        const bucket = into.get(c.id)
        if (url && !bucket.docs.has(url)) bucket.docs.set(url, { domain, url })
        if (domain) bucket.domains.add(domain)
      }
    }
  }
  return { into, articles }
}

/** Turn one window's evidence into the numbers the engine reads. */
export function measure(bucket, { now = Date.now() } = {}) {
  const docs = [...bucket.docs.values()]
  let prominence = 0
  const byDomain = new Map()
  for (const d of docs) {
    if (!byDomain.has(d.domain)) byDomain.set(d.domain, [])
    byDomain.get(d.domain).push(d)
  }
  for (const [domain] of byDomain) prominence += TIER_WEIGHT[tierOf(domain)]

  return {
    windowMentions: docs.length,
    uniqueSources: bucket.domains.size,
    // GKG gives no country per article here; claiming one would be invented.
    uniqueCountries: 0,
    prominence: Number(prominence.toFixed(3)),
    largestCluster: Math.max(0, ...[...byDomain.values()].map((v) => v.length)),
    matchRate: 1,
    drivers: docs.slice(0, 10).map((d) => ({
      title: null, url: d.url, domain: d.domain, publishers: 1,
      firstSeen: new Date(now).toISOString(),
    })),
  }
}

/**
 * Read the newest GKG window and measure every celebrity from it.
 *
 * `raw` is this window's article count, not a 24-hour figure — the run
 * accumulates it across stored snapshots. Saying otherwise would make a quiet
 * celebrity look like they had vanished every time a window missed them.
 */
export async function collect(celebrities, {
  now = Date.now(), fetchImpl = fetch, log = [], onProgress = null, deadline = Infinity,
  alreadyIngested = null, retryDelayMs = 4000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const started = Date.now()
  const fileOf = (u) => (u || '').split('/').pop()
  const listing = await latestFiles(fetchImpl)
  if (!listing.ok) {
    log.push(`gkg: ${listing.error}`)
    return { signals: [], calls: 1, files: 0, ok: false, error: listing.error, file: null }
  }

  /*
   * Fetch the newest window, and if the CDN does not have it yet, wait once
   * and then drop back to the window before it. A tick that reads a slightly
   * older window is a small inaccuracy; a tick that reads nothing publishes
   * a zero for every celebrity in the market.
   */
  let calls = 1
  let url = listing.gkg.url
  let res = null
  for (const attempt of ['first', 'retry', 'previous']) {
    if (attempt === 'retry') await sleep(retryDelayMs)
    if (attempt === 'previous') {
      const back = previousWindowUrl(url)
      if (!back) break
      log.push(`gkg: ${fileOf(url)} is not published yet — falling back to ${fileOf(back)}`)
      url = back
    }
    calls++
    try {
      const r = await fetchImpl(url, { headers: { 'User-Agent': UA } })
      if (r.ok) { res = r; break }
      if (attempt === 'previous') log.push(`gkg: ${fileOf(url)} → HTTP ${r.status}`)
    } catch (err) {
      if (attempt === 'previous') log.push(`gkg: ${fileOf(url)} → ${err.message}`)
    }
    if (Date.now() > deadline) break
  }
  if (!res) {
    const error = `no GKG window could be read (newest was ${fileOf(listing.gkg.url)})`
    log.push(`gkg: ${error}`)
    return { signals: [], calls, files: 0, ok: false, error, file: null }
  }

  /*
   * Each window must be counted once and only once. The rolling 24-hour total
   * is a sum over stored windows, so re-ingesting a window we already counted
   * would inflate everyone in it — which is exactly what the fallback above
   * would do on the tick after it fired.
   */
  if (alreadyIngested && fileOf(url) === fileOf(alreadyIngested)) {
    log.push(`gkg: ${fileOf(url)} was already counted — no new window this tick`)
    return { signals: [], calls, files: 0, ok: true, repeat: true, file: fileOf(url) }
  }

  let rows, bytes = 0
  try {
    const zipped = new Uint8Array(await res.arrayBuffer())
    bytes = zipped.length
    const entries = unzipSync(zipped)
    const name = Object.keys(entries)[0]
    if (!name) throw new Error('empty archive')
    // GDELT ships latin1, not UTF-8; decoding as UTF-8 mangles accented names.
    rows = Buffer.from(entries[name]).toString('latin1').split('\n')
  } catch (err) {
    log.push(`gkg: could not read the file — ${err.message}`)
    return { signals: [], calls, files: 0, ok: false, error: err.message, file: null }
  }

  const index = buildPersonIndex(celebrities)
  const { into, articles } = ingestRows(rows, celebrities, { index })

  const signals = []
  for (const c of celebrities) {
    const bucket = into.get(c.id)
    if (!bucket) continue
    const m = measure(bucket, { now })
    signals.push({
      source: 'news',
      celebrityId: c.id,
      timestamp: new Date(now).toISOString(),
      raw: m.windowMentions,
      series: null,
      normalized: null,
      confidence: 0.95,
      freshnessSeconds: 0,
      meta: { ...m, windowArticles: articles, file: fileOf(url) },
    })
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  log.push(`gkg: ${fileOf(url)} — ${(bytes / 1048576).toFixed(1)} MB, ${articles.toLocaleString()} articles → ${signals.length}/${celebrities.length} celebrities in this window (${seconds}s, ${calls} requests)`)
  onProgress?.({ articles, bytes, matched: signals.length, total: celebrities.length, file: fileOf(url), seconds })

  return { signals, calls, files: 1, articles, bytes, ok: true, repeat: false, file: fileOf(url) }
}
