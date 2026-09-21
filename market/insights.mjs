/**
 * What the archive knows that a ranking does not.
 *
 * A chart answers one question — who is highest — and answers it once a week.
 * The same data answers a dozen more, and those are the ones nobody else can
 * answer at all, because nobody else is keeping the series: how long a
 * celebrity story actually lasts, whether the press is writing about people
 * anybody is looking for, how much of the world's attention one name holds,
 * and whether fame is getting broader or narrower.
 *
 * Every measure here is derived from figures already stored. Nothing fetches,
 * nothing guesses, and each one returns the evidence beside the number so the
 * narrative layer never has to go and look it up again.
 *
 * Several of these need history before they mean anything — the half-life
 * wants a month, the concentration trend wants a quarter — so each returns an
 * honest `basis` saying how much it had to work with rather than producing a
 * confident figure from three days of data.
 *
 * Pure: no network, no storage, no clock beyond what is passed in.
 */
import { CATEGORIES } from './config.mjs'

const DAY = 86400000
const finite = (x) => (Number.isFinite(x) ? x : null)
const dayMs = (day) => Date.parse(`${day}T00:00:00Z`)

export const mean = (values) => {
  const v = values.filter(Number.isFinite)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

export function median(values) {
  const v = values.filter(Number.isFinite).slice().sort((a, b) => a - b)
  if (!v.length) return null
  const mid = v.length >> 1
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

/** One day's level, from its rollup — the same figure the chart ranks on. */
export const dayLevel = (d) => {
  const parts = [d?.open, d?.high, d?.low, d?.close].filter(Number.isFinite)
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null
}

const round = (n, dp = 1) => (Number.isFinite(n) ? Math.round(n * 10 ** dp) / 10 ** dp : null)

/* ================================================================== *
 * Attention share — the consumption number
 * ================================================================== */

/**
 * What share of all measured attention one name holds.
 *
 * The index's equivalent of Billboard's equivalent album units: a figure that
 * turns "number four" into "four per cent of everything anybody was paying
 * attention to", which is a sentence that travels and a sentence a ranking
 * cannot produce. Shares are of the MEASURED roster, which is a real
 * limitation and is named in `basis` rather than buried.
 */
export function attentionShare(rows = []) {
  const scored = rows.filter((r) => Number.isFinite(r.gossipScore) && r.gossipScore > 0)
  const total = scored.reduce((a, r) => a + r.gossipScore, 0)
  if (!total) return { total: 0, roster: rows.length, shares: [], basis: 'nothing measured' }

  const shares = scored
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      displayName: r.displayName,
      category: r.primaryCategory || null,
      score: round(r.gossipScore),
      share: round((r.gossipScore / total) * 100, 2),
    }))
    .sort((a, b) => b.share - a.share)

  return {
    total: round(total),
    roster: scored.length,
    shares,
    basis: `${scored.length} names measured`,
  }
}

/**
 * How narrow is fame this week?
 *
 * Three readings of the same thing. `halfCount` is the headline — how few
 * names it takes to account for half of all attention — because it is a whole
 * number a reader can picture, and because watching it move month over month
 * is the only way anybody will ever know whether fame is concentrating or
 * spreading out. `top10Share` is the quotable percentage, and `gini` is the
 * one an economist would ask for.
 */
export function concentration(rows = []) {
  const { shares, total, roster } = attentionShare(rows)
  if (!shares.length) return { halfCount: null, top10Share: null, gini: null, leaderShare: null, roster: 0 }

  let run = 0
  let halfCount = 0
  for (const s of shares) {
    run += s.share
    halfCount++
    if (run >= 50) break
  }

  const top10Share = round(shares.slice(0, 10).reduce((a, s) => a + s.share, 0), 1)

  // Gini over the score distribution: 0 is everybody equal, 1 is one name
  // holding everything.
  const vals = shares.map((s) => s.score).sort((a, b) => a - b)
  const n = vals.length
  const sum = vals.reduce((a, b) => a + b, 0)
  const gini = sum > 0
    ? round(vals.reduce((a, v, i) => a + (2 * (i + 1) - n - 1) * v, 0) / (n * sum), 3)
    : null

  return {
    halfCount,
    halfShare: round(run, 1),
    top10Share,
    gini,
    leaderShare: shares[0].share,
    leader: shares[0].displayName,
    roster,
    total,
  }
}

/* ================================================================== *
 * The Gap — what the press pushes against what the public wants
 * ================================================================== */

/**
 * Where coverage and curiosity disagree.
 *
 * The one measure here that nobody else publishes, and the one most likely to
 * be quoted, because it is about the press rather than about celebrities.
 * Rank every name on how much was written about them and again on how many
 * people went looking, and subtract.
 *
 *   ahead of the press    people are searching harder than the coverage
 *                         justifies — unserved demand, and a commissioning
 *                         list for anyone who reads it
 *   ahead of the public   the industry pushed a story nobody opened
 *
 * Ranks rather than raw figures on purpose: mentions and pageviews are in
 * different units on different scales, and subtracting one from the other
 * would be arithmetic with no meaning. A position in a queue is comparable.
 */
export function interestGap(rows = [], { min = 12, count = 5 } = {}) {
  const usable = rows.filter((r) => Number.isFinite(r.newsScore) && Number.isFinite(r.wikipediaScore))
  if (usable.length < min) {
    return { pairs: [], publicAhead: [], pressAhead: [], measured: usable.length, basis: 'too few names measured on both' }
  }

  const rank = (key) => {
    const order = [...usable].sort((a, b) => b[key] - a[key])
    return new Map(order.map((r, i) => [r.id, i + 1]))
  }
  const byPress = rank('newsScore')
  const byPublic = rank('wikipediaScore')

  const pairs = usable.map((r) => {
    const press = byPress.get(r.id)
    const search = byPublic.get(r.id)
    return {
      id: r.id,
      slug: r.slug,
      displayName: r.displayName,
      category: r.primaryCategory || null,
      pressRank: press,
      searchRank: search,
      /** Positive: the public is ahead. Negative: the press is ahead. */
      gap: press - search,
      newsScore: round(r.newsScore),
      wikipediaScore: round(r.wikipediaScore),
      outlets: finite(r.uniqueSources) ?? 0,
    }
  }).sort((a, b) => b.gap - a.gap)

  return {
    pairs,
    publicAhead: pairs.filter((p) => p.gap > 0).slice(0, count),
    pressAhead: pairs.filter((p) => p.gap < 0).slice(-count).reverse(),
    measured: usable.length,
    /** The widest disagreement in either direction, for the headline. */
    widest: pairs[0]?.gap >= Math.abs(pairs.at(-1)?.gap ?? 0) ? pairs[0] : pairs.at(-1),
    basis: `${usable.length} names measured on both coverage and search`,
  }
}

/* ================================================================== *
 * The Half-Life — how long a celebrity story actually lasts
 * ================================================================== */

/**
 * One name's spike, and how fast it decayed.
 *
 * A spike is a peak that clears the person's own normal by `lift`; the
 * half-life is the days from that peak until they fall back through the
 * halfway point between the peak and their normal. Measured against their OWN
 * baseline rather than against zero, because a celebrity who never drops below
 * forty has not "decayed to half" at fifty — they have gone back to being
 * themselves.
 *
 * Returns null rather than a number when there was no spike to measure. A
 * quiet month is not a fast half-life, it is no half-life, and reporting one
 * would poison every average built on top of it.
 */
export function halfLife(days = [], { lift = 1.5, window = 14, before = 3 } = {}) {
  const series = days
    .map((d) => ({ day: d?.day, level: dayLevel(d) }))
    .filter((d) => d.day && Number.isFinite(d.level))
    .sort((a, b) => a.day.localeCompare(b.day))
  if (series.length < 8) return null

  let peakAt = -1
  let peak = -Infinity
  series.forEach((d, i) => { if (d.level > peak) { peak = d.level; peakAt = i } })
  if (peakAt < before || peakAt >= series.length - 1) return null

  /*
   * Their normal is what they were at BEFORE this, not the median of the
   * whole series.
   *
   * Taking the median across everything lets a long spike raise its own
   * baseline: a name at 10 who goes to 60 and stays there for five days has
   * a whole-series median of 54, against which 60 is not a spike at all, so
   * the biggest events in the archive were the ones this could not see. The
   * days before the peak cannot be contaminated by it.
   */
  const base = median(series.slice(0, peakAt).map((d) => d.level))
  if (!Number.isFinite(base) || base <= 0) return null
  // No spike: nothing to time the decay of.
  if (peak < base * lift) return null

  const target = base + (peak - base) / 2
  const after = series.slice(peakAt + 1, peakAt + 1 + window)
  const fell = after.findIndex((d) => d.level <= target)

  return {
    peakDay: series[peakAt].day,
    peak: round(peak),
    baseline: round(base),
    /** Null means it had not come back down inside the window — still burning. */
    days: fell >= 0 ? fell + 1 : null,
    stillBurning: fell < 0,
    /** How far above their own normal the peak reached, as a multiple. */
    lift: round(peak / base, 2),
  }
}

/**
 * Every measurable spike across the roster, and what they average to.
 *
 * The aggregate is the headline — "the average celebrity story is over in
 * two and a half days" — and the per-category breakdown is the one that
 * gets argued with, which is the same thing as being read.
 */
export function halfLives(rollups = {}, rows = [], opts = {}) {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const spikes = []
  for (const [id, rollup] of Object.entries(rollups)) {
    const life = halfLife(rollup?.days || [], opts)
    if (!life) continue
    const row = byId.get(id)
    spikes.push({
      id,
      slug: row?.slug || id,
      displayName: row?.displayName || id,
      category: row?.primaryCategory || null,
      ...life,
    })
  }

  const done = spikes.filter((s) => Number.isFinite(s.days))
  const byCategory = {}
  for (const s of done) {
    if (!s.category) continue
    ;(byCategory[s.category] ||= []).push(s.days)
  }

  return {
    spikes: spikes.sort((a, b) => (b.days ?? 99) - (a.days ?? 99)),
    measured: spikes.length,
    resolved: done.length,
    average: round(mean(done.map((s) => s.days)), 1),
    median: round(median(done.map((s) => s.days)), 1),
    longest: spikes.filter((s) => Number.isFinite(s.days)).slice(0, 5),
    shortest: [...done].sort((a, b) => a.days - b.days).slice(0, 5),
    stillBurning: spikes.filter((s) => s.stillBurning),
    byCategory: Object.fromEntries(
      Object.entries(byCategory)
        .map(([c, list]) => [c, { days: round(mean(list), 1), spikes: list.length }])
        .sort((a, b) => b[1].days - a[1].days),
    ),
    // Below about a dozen resolved spikes an average is a rumour, not a
    // finding, and nothing should print it as though it were one.
    basis: done.length >= 12 ? 'sound' : done.length >= 5 ? 'early' : 'too little',
  }
}

/* ================================================================== *
 * Volatility, spread and categories
 * ================================================================== */

/**
 * How unpredictable a name is — the spread of their daily levels against
 * their own average, so a big name and a small one are comparable.
 */
export function volatility(days = [], { minDays = 7 } = {}) {
  const levels = days.map(dayLevel).filter(Number.isFinite)
  if (levels.length < minDays) return null
  const m = mean(levels)
  if (!m) return null
  const sd = Math.sqrt(levels.reduce((a, v) => a + (v - m) ** 2, 0) / levels.length)
  return { cv: round(sd / m, 3), sd: round(sd), mean: round(m), days: levels.length }
}

/** The roster ranked by how steady each name is. */
export function volatilities(rollups = {}, rows = [], opts = {}) {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const out = []
  for (const [id, rollup] of Object.entries(rollups)) {
    const v = volatility(rollup?.days || [], opts)
    if (!v) continue
    const row = byId.get(id)
    out.push({ id, slug: row?.slug || id, displayName: row?.displayName || id, category: row?.primaryCategory || null, ...v })
  }
  out.sort((a, b) => b.cv - a.cv)
  return { all: out, mostVolatile: out.slice(0, 5), steadiest: out.slice(-5).reverse(), measured: out.length }
}

/**
 * Who is famous everywhere, and who is famous in one place.
 *
 * The second list is the more interesting one and the one that travels: a
 * name forty newsrooms are covering inside a single country is a different
 * kind of celebrity from one twelve newsrooms cover across nine, and no
 * ranking anywhere makes that distinction.
 */
export function globalSpread(rows = [], { minOutlets = 8, localCountries = 2, count = 5 } = {}) {
  const usable = rows.filter((r) => Number.isFinite(r.uniqueCountries) && Number.isFinite(r.uniqueSources))
  const shaped = usable.map((r) => ({
    id: r.id,
    slug: r.slug,
    displayName: r.displayName,
    category: r.primaryCategory || null,
    countries: r.uniqueCountries,
    outlets: r.uniqueSources,
    /** Newsrooms per country: high means deep in few places. */
    density: r.uniqueCountries > 0 ? round(r.uniqueSources / r.uniqueCountries, 1) : null,
  }))

  return {
    mostGlobal: [...shaped].sort((a, b) => b.countries - a.countries || b.outlets - a.outlets).slice(0, count),
    bigButLocal: shaped
      .filter((s) => s.outlets >= minOutlets && s.countries <= localCountries)
      .sort((a, b) => b.outlets - a.outlets)
      .slice(0, count),
    measured: shaped.length,
  }
}

/** Which kinds of fame are holding the room. */
export function categoryShare(rows = []) {
  const { shares, total } = attentionShare(rows)
  if (!shares.length) return { shares: [], total: 0 }
  const by = {}
  for (const s of shares) {
    const key = s.category || 'other'
    by[key] ||= { category: key, label: CATEGORIES[key] || key, score: 0, names: 0 }
    by[key].score += s.score
    by[key].names++
  }
  const out = Object.values(by)
    .map((c) => ({ ...c, score: round(c.score), share: round((c.score / total) * 100, 1) }))
    .sort((a, b) => b.share - a.share)
  return { shares: out, total: round(total), leader: out[0] || null }
}

/* ================================================================== *
 * Movement over the archive
 * ================================================================== */

/**
 * How much the chart itself turned over — the churn nobody sees in a table.
 *
 * A week where eleven names left and eleven arrived is a different week from
 * one where two did, and the number is a story in itself the first time it
 * hits an extreme.
 */
export function churn(edition = null, previous = null) {
  const now = new Set((edition?.entries || []).map((e) => e.id))
  const before = new Set((previous?.entries || []).map((e) => e.id))
  if (!now.size || !before.size) return { arrived: null, left: null, held: null, rate: null }
  const arrived = [...now].filter((id) => !before.has(id)).length
  const left = [...before].filter((id) => !now.has(id)).length
  return {
    arrived,
    left,
    held: now.size - arrived,
    rate: round((arrived / now.size) * 100, 1),
  }
}

/**
 * Two names repeatedly trading places — a rivalry, which is a story that
 * writes itself every week it continues.
 */
export function rivalries(editions = [], { window = 6, minSwaps = 2 } = {}) {
  const recent = editions.slice(-window)
  if (recent.length < 3) return []

  const ranks = new Map()
  for (const [w, ed] of recent.entries()) {
    for (const e of ed?.entries || []) {
      if (!ranks.has(e.id)) ranks.set(e.id, { name: e.displayName, slug: e.slug, weeks: new Map() })
      ranks.get(e.id).weeks.set(w, e.rank)
    }
  }

  const ids = [...ranks.keys()]
  const found = []
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ranks.get(ids[i])
      const b = ranks.get(ids[j])
      let swaps = 0
      let last = null
      let closest = Infinity
      for (let w = 0; w < recent.length; w++) {
        const ra = a.weeks.get(w)
        const rb = b.weeks.get(w)
        if (!Number.isFinite(ra) || !Number.isFinite(rb)) { last = null; continue }
        closest = Math.min(closest, Math.abs(ra - rb))
        const ahead = ra < rb ? 'a' : 'b'
        if (last && ahead !== last) swaps++
        last = ahead
      }
      // Trading places is only a rivalry if they are actually near each other.
      if (swaps >= minSwaps && closest <= 5) {
        found.push({ a: { id: ids[i], ...a, weeks: undefined }, b: { id: ids[j], ...b, weeks: undefined }, swaps, closest })
      }
    }
  }
  return found.sort((x, y) => y.swaps - x.swaps || x.closest - y.closest).slice(0, 3)
}

/* ================================================================== *
 * Everything at once
 * ================================================================== */

/**
 * The whole picture for one moment, which is what the reports and the lead
 * picker read. Built in one pass so no two surfaces can compute the same
 * figure differently.
 */
export function snapshot({ rows = [], rollups = {}, edition = null, previous = null, editions = [], now = Date.now() } = {}) {
  return {
    at: new Date(now).toISOString(),
    share: attentionShare(rows),
    concentration: concentration(rows),
    gap: interestGap(rows),
    halfLives: halfLives(rollups, rows),
    volatility: volatilities(rollups, rows),
    spread: globalSpread(rows),
    categories: categoryShare(rows),
    churn: churn(edition, previous),
    rivalries: rivalries(editions),
  }
}
