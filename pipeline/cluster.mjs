/**
 * Turn a pile of headlines into stories.
 *
 * Twenty outlets covering one premiere is ONE story with a coverage count of
 * twenty — and that count is both the trend signal and the verification.
 */
import { OFFICIAL_DOMAINS } from './config.mjs'

const STOP = new Set(('a an the and or but of to in on at for with from by as is are was were be been it its this that these those '
  + 'new news says say said after before over into about up out how why what who when where will just more than his her their '
  + 'they she he you your our we us not no yes can could would should has have had do does did get gets got make makes made '
  + 'first last one two three year years day days week weeks time report video watch photos photo see here').split(' '))

export function tokens(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

/** Registrable-ish domain: www.bbc.co.uk → bbc.co.uk, edition.cnn.com → cnn.com */
export function rootDomain(hostOrUrl) {
  let host = String(hostOrUrl || '')
  try { if (host.includes('/')) host = new URL(host).hostname } catch { /* keep */ }
  host = host.replace(/^www\./, '').toLowerCase()
  const parts = host.split('.')
  if (parts.length <= 2) return host
  const tail2 = parts.slice(-2).join('.')
  if (/^(co|com|org|gov|ac|net)\.[a-z]{2}$/.test(tail2)) return parts.slice(-3).join('.')
  return tail2
}

export const isOfficial = (domain) => OFFICIAL_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d))

/**
 * Greedy clustering on headline overlap.
 *
 * Plain word overlap misses the same story told two ways — "Madonna Set to
 * Open MTV Video Music Awards" and "Madonna to Open 2026 MTV VMAs" share only
 * three words. What they share are RARE words: names and specifics that
 * almost no other headline in the run contains. So two headlines also match
 * when they share at least two rare words and those carry a good share of
 * the shorter headline's weight.
 *
 * @param {Array<{title,url,domain,seenAt,strand,summary?,publicDomain?,credit?}>} items
 */
export function clusterItems(items, threshold = 0.34) {
  // document frequency per strand
  const df = new Map()
  const tk = items.map((it) => {
    const set = new Set(tokens(it.title))
    for (const t of set) { const k = it.strand + ':' + t; df.set(k, (df.get(k) || 0) + 1) }
    return set
  })
  const perStrand = new Map()
  for (const it of items) perStrand.set(it.strand, (perStrand.get(it.strand) || 0) + 1)
  const idf = (strand, t) => Math.log(1 + (perStrand.get(strand) || 1) / (df.get(strand + ':' + t) || 1))
  const isRare = (strand, t) => !/^\d+(st|nd|rd|th)?$/.test(t) && (df.get(strand + ':' + t) || 0) <= Math.max(3, Math.ceil((perStrand.get(strand) || 0) * 0.02))

  const similar = (strand, a, b) => {
    if (jaccard(a, b) >= threshold) return true
    let shared = 0, rare = 0, wa = 0, wb = 0
    for (const t of a) wa += idf(strand, t)
    for (const t of b) wb += idf(strand, t)
    for (const t of a) if (b.has(t)) { shared += idf(strand, t); if (isRare(strand, t)) rare++ }
    return rare >= 2 && shared / Math.min(wa, wb) >= 0.28
  }

  const clusters = []
  items.forEach((item, i) => {
    const set = tk[i]
    if (set.size < 2) return
    let best = null
    for (const c of clusters) {
      if (c.strand !== item.strand) continue
      if (c.titles.some((t) => similar(item.strand, set, t))) { best = c; break }
    }
    if (best) { best.items.push(item); best.titles.push(set) }
    else clusters.push({ strand: item.strand, titles: [set], items: [item] })
  })
  return clusters.map(finishCluster)
}

function finishCluster(c) {
  // One item per domain: syndicated copies of the same wire story are one source.
  const byDomain = new Map()
  for (const it of c.items) if (!byDomain.has(it.domain)) byDomain.set(it.domain, it)
  const items = [...byDomain.values()]
  const newest = Math.max(...c.items.map((i) => Date.parse(i.seenAt) || 0))
  const lead = items.find((i) => i.publicDomain) || items[0]
  return {
    key: fingerprint(lead.title),
    strand: c.strand,
    lead,
    items,
    domains: items.map((i) => i.domain),
    official: items.some((i) => isOfficial(i.domain) || i.publicDomain),
    newestAt: newest ? new Date(newest).toISOString() : null,
  }
}

/** Stable key for "have we done this story already?" */
export function fingerprint(title) {
  return [...new Set(tokens(title))].sort().slice(0, 8).join('-')
}

/** Is this cluster the same story as one we already hold? */
export function alreadyCovered(cluster, seenKeys, recentHeadlines = []) {
  if (seenKeys.has(cluster.key)) return true
  const tk = new Set(tokens(cluster.lead.title))
  return recentHeadlines.some((h) => jaccard(tk, new Set(tokens(h))) >= 0.5)
}
