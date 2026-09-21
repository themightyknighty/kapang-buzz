/**
 * Steps 3 and 4 — score, verify and pick this run's share of the day.
 */
import { STRANDS, RUNS_PER_DAY, TRUSTED_SINGLE_SOURCE } from './config.mjs'
import { checkText } from './safety.mjs'

/**
 * Verification rule, strand by strand.
 *  - Celebrity: two independent outlets, always. No single-source stories about real people.
 *  - Health, Facts, Bizarre: two outlets, or one official source, or one
 *    established news or science organisation from TRUSTED_SINGLE_SOURCE.
 */
export function verify(cluster) {
  const n = new Set(cluster.domains).size
  if (cluster.strand === 'celebrity') {
    return n >= 2 ? { ok: true } : { ok: false, reason: `celebrity needs 2 outlets, has ${n}` }
  }
  if (cluster.official || n >= 2) return { ok: true }
  const trusted = TRUSTED_SINGLE_SOURCE[cluster.strand] || []
  if (cluster.domains.some((d) => trusted.includes(d))) return { ok: true }
  return { ok: false, reason: `needs 2 outlets, an official source or a trusted outlet, has ${n}` }
}

/** Higher is better. Coverage dominates, freshness breaks ties. */
export function score(cluster, now = Date.now()) {
  const outlets = new Set(cluster.domains).size
  const ageH = cluster.newestAt ? Math.max(0, (now - Date.parse(cluster.newestAt)) / 3600000) : 24
  const freshness = Math.max(0, 1 - ageH / 36)
  return Math.round((Math.min(outlets, 12) * 10 + freshness * 25 + (cluster.official ? 8 : 0)) * 10) / 10
}

/**
 * How many of each strand this run should publish. The daily quota is split
 * across the runs, with any remainder landing on the earliest runs so the
 * morning is never thin. `runIndex` is 0, 1, 2.
 */
export function runQuota(runIndex) {
  const q = {}
  for (const [k, s] of Object.entries(STRANDS)) {
    const base = Math.floor(s.perDay / RUNS_PER_DAY)
    const rem = s.perDay % RUNS_PER_DAY
    q[k] = base + (runIndex < rem ? 1 : 0)
  }
  return q
}

/**
 * Pick candidates for the writer. We over-pick (×2) because the writer and
 * the second safety pass will drop some.
 *
 * @returns {{picked: object[], rejected: {key,strand,title,reason}[]}}
 */
export function pickCandidates(clusters, quota, { now = Date.now(), overPick = 2 } = {}) {
  const rejected = []
  const byStrand = {}
  for (const c of clusters) {
    const safe = c.items.map((i) => checkText(i.title, c.strand)).find((r) => !r.ok)
    if (safe) { rejected.push({ key: c.key, strand: c.strand, title: c.lead.title, reason: safe.reason }); continue }
    const v = verify(c)
    if (!v.ok) { rejected.push({ key: c.key, strand: c.strand, title: c.lead.title, reason: v.reason }); continue }
    ;(byStrand[c.strand] ||= []).push({ ...c, score: score(c, now) })
  }
  const picked = []
  for (const [strand, n] of Object.entries(quota)) {
    const list = (byStrand[strand] || []).sort((a, b) => b.score - a.score)
    picked.push(...list.slice(0, n * overPick))
  }
  return { picked, rejected }
}

/** Which of the three daily runs a UTC time belongs to (6am / noon / 5pm Pacific). */
export function runIndexFor(date = new Date()) {
  const h = date.getUTCHours()
  if (h >= 12 && h < 18) return 0 // morning run at 13:00 UTC
  if (h >= 18) return 1           // noon run at 19:00 UTC
  return 2                        // evening run at 00:00 UTC
}
