/**
 * NewsAdapter — coverage from GDELT's Web News NGrams files.
 *
 * This replaces the DOC API, which refuses us at any pace: a 429 on the first
 * call of a fresh process, with its own error pointing here ("All high-traffic
 * users should switch to our ngrams dataset").
 *
 * The shape of the problem changes completely, and for the better. These are
 * static files on a CDN, published every minute, holding 4-word phrases from
 * global news with the article URL attached. So instead of one query per
 * celebrity — 210 rate-limited calls an hour — we download a handful of files
 * and match every celebrity in a single pass. No key, no rate limit, no
 * per-celebrity cost at all. Adding the 500th celebrity costs nothing.
 *
 * The 4-word window also does disambiguation work that full-text search never
 * did: "Pedro Pascal told reporters" carries its own context, so an ambiguous
 * surname can be confirmed from the phrase it sits in.
 *
 * One honest caveat. "Mentions" here means *distinct documents whose phrases
 * contain the name*, not *articles a query returned*. That is arguably a truer
 * measure of attention, but it is a different quantity from what the DOC API
 * would have given, so the baselines and the confidence floor will need
 * retuning against real data. The admin sandbox exists for that.
 */
import { NGRAMS, UA } from '../config.mjs'
import { verify, norm, domainOf, tierOf } from '../match.mjs'
import { TIER_WEIGHT } from '../config.mjs'
import { gunzipSync } from 'node:zlib'

export const meta = { key: 'news', label: 'News coverage (GDELT ngrams)', cadenceMinutes: 15, weightGroup: 'news' }

const pad = (n) => String(n).padStart(2, '0')

/** GDELT names its files by the UTC minute they cover. */
export const stampFor = (d) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`

/**
 * The known layouts. Files land a couple of minutes behind real time, so a
 * caller walks back from "a few minutes ago" until one answers, and remembers
 * which pattern worked.
 */
export const PATTERNS = [
  { key: 'webngrams', url: (s) => `${NGRAMS.base}/gdeltv3/webngrams/${s}.webngrams.json.gz` },
  { key: 'weblegacy', url: (s) => `${NGRAMS.base}/gdeltv5/weblegacy/ngrams/${s}.ngrams.txt.gz` },
]

/**
 * One line, whichever format it is.
 *
 * The JSON layout carries the article URL on every line. The tab-separated
 * one carries only a document id, so breadth has to come from the companion
 * table of contents — where that is missing we still count documents, and say
 * so rather than inventing publishers.
 */
export function parseLine(line) {
  const s = line.trim()
  if (!s) return null
  if (s[0] === '{') {
    try {
      const j = JSON.parse(s)
      const text = [j.pre, j.ngram, j.post].filter(Boolean).join(' ')
      return { docId: j.url || j.docid || null, url: j.url || null, lang: j.lang || null, text, count: 1 }
    } catch { return null }
  }
  const [docId, ngram, count] = s.split('\t')
  if (!docId || !ngram) return null
  return { docId, url: /^https?:/i.test(docId) ? docId : null, lang: null, text: ngram, count: Number(count) || 1 }
}

/* ------------------------------------------------------------------ *
   Matching every celebrity in one pass
 * ------------------------------------------------------------------ */

const WORDS = (s) => norm(s).split(' ').filter(Boolean)

/**
 * A token index, so a line is only tested against celebrities it could
 * plausibly be about.
 *
 * Without this, every line would be checked against all 105 celebrities —
 * millions of comparisons per file. Here a line's words are looked up first,
 * and only the handful of candidates that share a distinctive word get the
 * full verification.
 */
export function buildIndex(celebrities) {
  const index = new Map()
  for (const c of celebrities) {
    const tokens = new Set()
    for (const a of c.aliases) {
      const w = WORDS(a.text)
      // The rarest word in the alias is the cheapest way in: "chalamet"
      // rather than "timothee", "kardashian" rather than "kim".
      for (const t of w) if (t.length > 3) tokens.add(t)
    }
    for (const t of tokens) {
      if (!index.has(t)) index.set(t, [])
      index.get(t).push(c)
    }
  }
  return index
}

/**
 * Two syndicated copies of one story share nearly all of their phrases, so
 * documents are grouped by how much of their phrase set they hold in common.
 * That keeps a wire story carried by 150 sites counting as one story with a
 * breadth of 150, which is the whole point.
 */
export function clusterDocs(docs, { threshold = NGRAMS.clusterThreshold } = {}) {
  const entries = [...docs.entries()]
  const clusters = []
  for (const [docId, d] of entries) {
    let best = null, bestScore = 0
    for (const c of clusters) {
      const shared = [...d.phrases].filter((p) => c.phrases.has(p)).length
      if (!shared) continue
      const score = shared / Math.min(d.phrases.size, c.phrases.size)
      if (score > bestScore) { bestScore = score; best = c }
    }
    if (best && bestScore >= threshold) {
      best.docs.push(docId)
      for (const p of d.phrases) best.phrases.add(p)
      if (d.url) best.urls.add(d.url)
    } else {
      clusters.push({ docs: [docId], phrases: new Set(d.phrases), urls: new Set(d.url ? [d.url] : []) })
    }
  }
  return clusters
}

/**
 * Fold one file's lines into per-celebrity evidence. Pure, so it can be
 * tested against fixtures without any network.
 */
export function ingestLines(lines, celebrities, { index = buildIndex(celebrities), into = new Map() } = {}) {
  for (const raw of lines) {
    const rec = parseLine(raw)
    if (!rec) continue
    const words = WORDS(rec.text)
    const seen = new Set()
    for (const w of words) {
      for (const c of index.get(w) || []) {
        if (seen.has(c.id)) continue
        seen.add(c.id)
        // The phrase plus its surrounding words is what confirms an
        // ambiguous alias — the same rule the DOC path used on headlines.
        if (!verify(c, rec.text).ok) continue
        if (!into.has(c.id)) into.set(c.id, new Map())
        const docs = into.get(c.id)
        if (!docs.has(rec.docId)) docs.set(rec.docId, { phrases: new Set(), url: rec.url, lang: rec.lang })
        docs.get(rec.docId).phrases.add(norm(rec.text))
      }
    }
  }
  return into
}

/** Turn the gathered evidence into the numbers the scoring engine reads. */
export function measure(celebrity, docs, { now = Date.now() } = {}) {
  const clusters = clusterDocs(docs)
  const domains = new Set(), langs = new Set()
  let prominence = 0
  for (const [, d] of docs) { if (d.lang) langs.add(d.lang) }
  for (const c of clusters) {
    const clusterDomains = new Set()
    let bestTier = 0
    for (const u of c.urls) {
      const dom = domainOf(u)
      if (!dom) continue
      domains.add(dom); clusterDomains.add(dom)
      const t = tierOf(dom)
      if (t && (bestTier === 0 || t < bestTier)) bestTier = t
    }
    prominence += TIER_WEIGHT[bestTier] * Math.log1p(clusterDomains.size || 1)
  }
  return {
    mentions: clusters.length,
    documents: docs.size,
    weightedMentions: clusters.length,
    uniqueSources: domains.size,
    uniqueCountries: langs.size,
    prominence: Number(prominence.toFixed(3)),
    largestCluster: clusters.reduce((m, c) => Math.max(m, c.docs.length), 0),
    // Everything here came from a name match, so the rate is 1 by
    // construction — there is no query returning strangers to filter out.
    matchRate: 1,
    drivers: clusters
      .slice()
      .sort((a, b) => b.urls.size - a.urls.size)
      .slice(0, 10)
      .map((c) => {
        const url = [...c.urls][0] || null
        return { title: null, url, domain: domainOf(url || ''), publishers: c.urls.size, firstSeen: new Date(now).toISOString() }
      }),
  }
}

/* ------------------------------------------------------------------ *
   Fetching
 * ------------------------------------------------------------------ */

async function fetchFile(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) return { ok: false, status: res.status }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 100) return { ok: false, status: res.status, empty: true }
  try { return { ok: true, bytes: buf.length, text: gunzipSync(buf).toString('utf8') } }
  catch (err) { return { ok: false, error: `could not decompress: ${err.message}` } }
}

/**
 * Collect news signals for every celebrity at once.
 *
 * `minutes` files are pulled from the window ending a little behind real time,
 * because a file for the current minute does not exist yet. A file that is
 * missing is skipped rather than retried — the next snapshot will cover it.
 */
export async function collect(celebrities, {
  now = Date.now(), fetchImpl = fetch, log = [], onProgress = null,
  minutes = NGRAMS.minutesPerSnapshot, lagMinutes = NGRAMS.lagMinutes, deadline = Infinity,
} = {}) {
  const index = buildIndex(celebrities)
  const into = new Map()
  let calls = 0, files = 0, lines = 0, bytes = 0
  let pattern = null

  for (let i = 0; i < minutes; i++) {
    if (Date.now() > deadline) { log.push('ngrams: run deadline reached'); break }
    const stamp = stampFor(new Date(now - (lagMinutes + i) * 60000))
    // Once a pattern answers, stay with it rather than probing every minute.
    const candidates = pattern ? [pattern] : PATTERNS
    let got = null
    for (const p of candidates) {
      calls++
      const r = await fetchFile(p.url(stamp), fetchImpl)
      if (r.ok) { pattern = p; got = r; break }
    }
    if (!got) { log.push(`ngrams: no file for ${stamp}`); continue }

    const fileLines = got.text.split('\n')
    ingestLines(fileLines, celebrities, { index, into })
    files++; lines += fileLines.length; bytes += got.bytes
    onProgress?.({ index: i + 1, total: minutes, stamp, lines: fileLines.length, bytes: got.bytes, pattern: pattern.key, matched: into.size })
  }

  if (!files) {
    log.push('ngrams: no files could be read')
    return { signals: [], calls, files: 0 }
  }

  const signals = []
  for (const c of celebrities) {
    const docs = into.get(c.id)
    if (!docs?.size) continue
    const m = measure(c, docs, { now })
    signals.push({
      source: 'news',
      celebrityId: c.id,
      timestamp: new Date(now).toISOString(),
      raw: m.mentions,
      // Momentum comes from our own stored snapshots here: these files are a
      // slice of the present, not a history.
      series: null,
      normalized: null,
      confidence: 0.9,
      freshnessSeconds: lagMinutes * 60,
      meta: { ...m, files, windowMinutes: minutes, pattern: pattern?.key },
    })
  }

  log.push(`ngrams: ${files} files (${(bytes / 1048576).toFixed(1)} MB, ${lines.toLocaleString()} lines) → ${signals.length}/${celebrities.length} celebrities measured in ${calls} requests`)
  return { signals, calls, files, lines, bytes }
}
