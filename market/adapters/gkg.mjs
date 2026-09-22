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
import { TIER_WEIGHT, COVERAGE } from '../config.mjs'

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
  extras: 26,           // V2ExtrasXML — last of the 27, and where the headline lives
}

/* ------------------------------------------------------------------ *
 * What the story actually said
 * ------------------------------------------------------------------ */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…',
}

/**
 * GDELT escapes every non-ASCII character in a title as an HTML entity, so a
 * headline arrives as "Beyonc&#233;s new album". One pass over all three
 * forms, because decoding named entities after numeric ones turns a literal
 * "&amp;#39;" into an apostrophe that was never there.
 */
export function decodeEntities(s = '') {
  return String(s).replace(
    /&(?:#[xX]([0-9a-fA-F]+)|#(\d+)|([a-zA-Z][a-zA-Z0-9]*));/g,
    (whole, hex, dec, name) => {
      if (name) return ENTITIES[name.toLowerCase()] ?? whole
      const code = hex ? parseInt(hex, 16) : parseInt(dec, 10)
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return whole
      try { return String.fromCodePoint(code) } catch { return whole }
    },
  )
}

/**
 * The headline, out of the file we already have.
 *
 * GKG has carried `<PAGE_TITLE>` inside the extras XML since 2019, and this
 * adapter was throwing the whole column away — so every driver went out with
 * `title: null` hardcoded, and the chart could name the outlet that covered
 * somebody but never what was written. No extra request: it is the same row
 * the mention was counted from, so the headline always belongs to the article
 * that actually moved the number.
 *
 * Falls back to the last column when a row is short, since extras is last.
 */
export function pageTitle(cols = []) {
  const extras = cols[COL.extras] ?? cols[cols.length - 1] ?? ''
  const m = /<PAGE_TITLE>([\s\S]*?)<\/PAGE_TITLE>/i.exec(extras)
  if (!m) return null
  const title = decodeEntities(m[1]).replace(/\s+/g, ' ').trim()
  return title || null
}

/**
 * When the article was seen, from the row's own timestamp.
 *
 * Every driver used to be stamped with the moment the job ran, which made
 * "when this broke" the same for all of them and equal to whenever the
 * scheduler last fired. The row carries the window it belongs to; use that.
 */
export function rowTime(cols = []) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(cols[COL.date] || '').trim())
  if (!m) return null
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
  return Number.isFinite(t) ? t : null
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

/* ------------------------------------------------------------------ *
 * Coverage of somebody, not a mention of them
 * ------------------------------------------------------------------ */

/**
 * Does this headline actually name them?
 *
 * Only aliases safe enough for a search query are allowed to answer — the
 * same discipline `queryAliases` enforces everywhere else, and for the same
 * reason. "Swift" in a headline is as likely to be a bird as a person, and
 * a headline match is the single heaviest signal here, so it is the last
 * place to start trusting an ambiguous one.
 */
export function headlines(title, celebrity) {
  const t = norm(title || '')
  if (!t) return false
  return queryAliases(celebrity).some((a) => {
    const name = norm(a.text)
    // Word-boundary, or "Swifty" counts as "Swift" and "Carrie" as "Carr".
    return name && new RegExp(`(^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(t)
  })
}

/**
 * How much this one article says about this one person.
 *
 * Being in the headline is being the subject. Being one of thirty names in
 * a round-up is being a footnote, and counting that as a full mention is
 * what put a listicle at the top of the chart. Both numbers come free with
 * the row: the title we now parse, and the length of the persons column.
 *
 * The split is honest rather than clever — a story about two people gives
 * each of them half of it — and the headline multiplier does the rest.
 */
export function coverageWeight({ inHeadline = false, named = 1 } = {}) {
  const share = 1 / Math.max(COVERAGE.minNamed, named || 1)
  return (inHeadline ? COVERAGE.headline : COVERAGE.body) * share * COVERAGE.scale
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
    const title = pageTitle(cols)
    const seenAt = rowTime(cols)
    // personsOf returns a SET, so .length on it is undefined — which quietly
    // made every article look like it named one person and switched the
    // listicle dilution off entirely.
    const people = [...personsOf(cols)]
    // How many people this article names, which is how thinly its attention
    // is spread. A round-up of thirty is not thirty stories.
    const named = people.length
    for (const person of people) {
      for (const c of index.get(person) || []) {
        if (!into.has(c.id)) into.set(c.id, { docs: new Map(), domains: new Set() })
        const bucket = into.get(c.id)
        if (url && !bucket.docs.has(url)) {
          const inHeadline = headlines(title, c)
          bucket.docs.set(url, { domain, url, title, seenAt, named, inHeadline, weight: coverageWeight({ inHeadline, named }) })
        }
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

  /*
   * The number the index is scored on is now the WEIGHT of the coverage,
   * not the count of it. An article that put them in the headline is worth
   * four of one that mentioned them halfway down, and a round-up naming
   * fifteen people is worth a fifteenth of itself to each of them.
   */
  const weight = docs.reduce((a, d) => a + (Number.isFinite(d.weight) ? d.weight : coverageWeight(d)), 0)
  const headlined = docs.filter((d) => d.inHeadline).length

  return {
    windowMentions: Math.round(weight * 1000) / 1000,
    /** What it would have been under the old count-everything rule. */
    windowArticlesSeen: docs.length,
    /** How much of this was somebody writing ABOUT them. */
    headlineMentions: headlined,
    uniqueSources: bucket.domains.size,
    // GKG gives no country per article here; claiming one would be invented.
    uniqueCountries: 0,
    prominence: Number(prominence.toFixed(3)),
    largestCluster: Math.max(0, ...[...byDomain.values()].map((v) => v.length)),
    matchRate: 1,
    /*
     * The ten that best explain the number, not the first ten parsed.
     *
     * An article we can name beats one we cannot, and a masthead beats an
     * aggregator, because this list is what the chart reads from when it has
     * to say why somebody moved. Ties keep the order they arrived in, so the
     * same window always produces the same drivers.
     */
    drivers: [...docs]
      .sort((a, b) => (
        // Being the subject beats being nameable beats being a big masthead.
        (b.inHeadline ? 1 : 0) - (a.inHeadline ? 1 : 0)
        || (b.title ? 1 : 0) - (a.title ? 1 : 0)
        || TIER_WEIGHT[tierOf(b.domain)] - TIER_WEIGHT[tierOf(a.domain)]
      ))
      .slice(0, 10)
      .map((d) => ({
        title: d.title ?? null,
        url: d.url,
        domain: d.domain,
        publishers: 1,
        /** Were they the subject, or one of the names in it? */
        inHeadline: Boolean(d.inHeadline),
        named: Number.isFinite(d.named) ? d.named : null,
        // The row's own window, not the moment the scheduler happened to run.
        firstSeen: new Date(d.seenAt ?? now).toISOString(),
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
