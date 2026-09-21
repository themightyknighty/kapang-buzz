/**
 * Entity matching — deciding whether an article is actually about the
 * celebrity we asked for.
 *
 * GDELT full-text search has no entity linking, so a query for "Taylor
 * Swift" happily returns a piece about swift birds and a query for Dwayne
 * Johnson returns Boris Johnson. Counting those would make the index
 * meaningless, so every returned article is verified before it counts.
 *
 * The rules, in order of cost:
 *   1. an `excludes` phrase present  → reject outright
 *   2. a unique or strong alias      → accept
 *   3. an ambiguous alias            → accept only with a `requires` term
 *   4. nothing                       → reject
 *
 * Pure: no network, no storage, no clock.
 */
import { queryAliases, weakAliases } from './celebrities.mjs'
import { PUBLISHER_TIERS, TIER_WEIGHT, RECENCY_HALF_LIFE_HOURS } from './config.mjs'

/** Lowercase, strip accents, collapse punctuation to spaces. */
export const norm = (s) => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

/** Whole-word containment, so "rock" does not match "rocket". */
export function hasPhrase(haystack, phrase) {
  const h = ` ${norm(haystack)} `
  const p = norm(phrase)
  return p.length > 0 && h.includes(` ${p} `)
}

/**
 * The GDELT query for one celebrity: their safe aliases as quoted phrases,
 * joined by OR. Ambiguous aliases are deliberately never sent — they are only
 * used to verify text that has already come back.
 */
export function buildQuery(celebrity, { sourceLang = 'english' } = {}) {
  const phrases = queryAliases(celebrity).map((a) => `"${a.text}"`)
  const or = phrases.length > 1 ? `(${phrases.join(' OR ')})` : phrases[0]
  return sourceLang ? `${or} sourcelang:${sourceLang}` : or
}

/**
 * Does this text refer to this celebrity? Returns the reason as well as the
 * verdict, because the admin panel needs to show why something was counted.
 */
export function verify(celebrity, text) {
  const t = String(text || '')
  for (const ex of celebrity.excludes || []) {
    if (hasPhrase(t, ex)) return { ok: false, reason: 'excluded', by: ex }
  }
  for (const a of queryAliases(celebrity)) {
    if (hasPhrase(t, a.text)) return { ok: true, reason: a.strength, by: a.text }
  }
  for (const a of weakAliases(celebrity)) {
    if (!hasPhrase(t, a.text)) continue
    const hit = (a.requires || []).find((r) => hasPhrase(t, r))
    if (hit) return { ok: true, reason: 'ambiguous+context', by: `${a.text} + ${hit}` }
    return { ok: false, reason: 'ambiguous-unconfirmed', by: a.text }
  }
  return { ok: false, reason: 'no-alias' }
}

/** The text an article offers for verification. */
const articleText = (a) => [a.title, a.seendescription, a.description, a.snippet].filter(Boolean).join(' . ')

export const domainOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase() } catch { return '' }
}

export function tierOf(domain) {
  for (const [tier, list] of Object.entries(PUBLISHER_TIERS)) if (list.includes(domain)) return Number(tier)
  return 0
}

/* ------------------------------------------------------------------ *
   Syndication
 * ------------------------------------------------------------------ */

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'by',
  'from', 'as', 'is', 'are', 'was', 'were', 'it', 'its', 'his', 'her', 'their', 'after', 'over', 'new'])

const words = (s) => norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w))

/**
 * Group articles that are the same story. A wire piece carried by 150 cloned
 * sites has to count as ONE story with breadth 150, not 150 mentions —
 * otherwise a single syndicated item dominates the whole index.
 *
 * Same approach as pipeline/cluster.mjs: rare shared words matter more than
 * common ones, so two headlines about the same event group even when worded
 * differently, and two unrelated stories about the same person do not.
 *
 * `ignore` carries the celebrity's own name words. Every story about a person
 * shares their name, so leaving those in makes two unrelated stories about
 * the same celebrity look like one — which would undercount attention badly.
 */
export function clusterArticles(articles, { threshold = 0.42, ignore = [] } = {}) {
  const skip = new Set(ignore.flatMap((t) => words(t)))
  const strip = (title) => {
    const all = words(title)
    const kept = all.filter((w) => !skip.has(w))
    // A headline that is only the person's name keeps it, or it matches nothing.
    return new Set(kept.length ? kept : all)
  }
  const docs = articles.map((a) => ({ a, w: strip(a.title || '') }))
  const df = new Map()
  for (const d of docs) for (const w of d.w) df.set(w, (df.get(w) || 0) + 1)
  const idf = (w) => Math.log(1 + docs.length / (df.get(w) || 1))

  const clusters = []
  for (const d of docs) {
    let best = null, bestScore = 0
    for (const c of clusters) {
      const shared = [...d.w].filter((w) => c.w.has(w))
      if (!shared.length) continue
      const weight = shared.reduce((s, w) => s + idf(w), 0)
      const total = Math.min(
        [...d.w].reduce((s, w) => s + idf(w), 0),
        [...c.w].reduce((s, w) => s + idf(w), 0),
      )
      const score = total > 0 ? weight / total : 0
      if (score > bestScore) { bestScore = score; best = c }
    }
    if (best && bestScore >= threshold) { best.items.push(d.a); for (const w of d.w) best.w.add(w) }
    else clusters.push({ w: new Set(d.w), items: [d.a] })
  }
  return clusters.map((c) => c.items)
}

/* ------------------------------------------------------------------ *
   The news measurement
 * ------------------------------------------------------------------ */

/** Older coverage counts for less, on an exponential decay. */
export const recencyWeight = (publishedAt, now, halfLife = RECENCY_HALF_LIFE_HOURS) => {
  const hours = (now - Date.parse(publishedAt)) / 3600000
  if (!Number.isFinite(hours) || hours < 0) return 1
  return Math.pow(0.5, hours / halfLife)
}

/**
 * Turn a raw article list into the numbers the scoring engine wants.
 *
 * `mentions` counts STORIES, not articles — that is the whole point of the
 * clustering step. `breadth` is where the number of publishers shows up, and
 * it is weighted by publisher prominence so independent pickup by real
 * outlets beats cloning across content farms.
 */
export function measureNews(celebrity, articles, { now = Date.now() } = {}) {
  const checked = articles.map((a) => ({ a, v: verify(celebrity, articleText(a)) }))
  const kept = checked.filter((x) => x.v.ok).map((x) => x.a)
  const rejected = checked.filter((x) => !x.v.ok)

  const clusters = clusterArticles(kept, { ignore: celebrity.aliases.map((a) => a.text) })
  const domains = new Set(), countries = new Set()
  let prominence = 0, weighted = 0

  for (const cluster of clusters) {
    const clusterDomains = new Set()
    let bestTier = 0
    let recency = 0
    for (const a of cluster) {
      const d = domainOf(a.url)
      if (d) { domains.add(d); clusterDomains.add(d) }
      if (a.sourcecountry) countries.add(a.sourcecountry)
      const tier = tierOf(d)
      if (tier && (bestTier === 0 || tier < bestTier)) bestTier = tier
      recency = Math.max(recency, recencyWeight(a.seendate || a.publishedAt, now))
    }
    // One story counts once, scaled by how recent and how prominent it is.
    weighted += recency * TIER_WEIGHT[bestTier]
    prominence += TIER_WEIGHT[bestTier] * Math.log1p(clusterDomains.size)
  }

  return {
    mentions: clusters.length,
    articles: kept.length,
    rawArticles: articles.length,
    weightedMentions: Number(weighted.toFixed(3)),
    uniqueSources: domains.size,
    uniqueCountries: countries.size,
    prominence: Number(prominence.toFixed(3)),
    largestCluster: clusters.reduce((m, c) => Math.max(m, c.length), 0),
    // What proportion of what came back was really about them. A low number
    // means the query is too loose, and the admin panel flags it.
    matchRate: articles.length ? Number((kept.length / articles.length).toFixed(3)) : 0,
    rejections: rejected.slice(0, 20).map((x) => ({ title: x.a.title, reason: x.v.reason, by: x.v.by })),
    clusters,
  }
}
