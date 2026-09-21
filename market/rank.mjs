/**
 * The ranking engine — turning scored celebrities into a market table.
 *
 * A pure function of the scored roster plus the previous snapshot, so the
 * same inputs always produce the same table. Ties break deterministically,
 * which matters more than it sounds: a wobbling rank on equal scores would
 * look like movement that did not happen.
 */
import { attentionBand } from './score.mjs'
import { momentumBand, trendArrow } from './momentum.mjs'

/** Rank the scored rows and attach movement against the previous snapshot. */
export function rankMarket(rows, previous = null, { now = Date.now() } = {}) {
  const prev = new Map((previous?.rows || []).map((r) => [r.id, r]))

  const sorted = rows.slice().sort((a, b) =>
    b.gossipScore - a.gossipScore
    || b.momentum - a.momentum
    || b.mentions - a.mentions
    || a.id.localeCompare(b.id))

  return sorted.map((r, i) => {
    const p = prev.get(r.id)
    const rank = i + 1
    const rankPrev = p?.rank ?? null
    const peakToday = Math.max(r.gossipScore, p?.peakToday ?? 0)
    const peakWeek = Math.max(r.gossipScore, p?.peakWeek ?? 0)
    const statusChanged = p?.status !== r.status
    return {
      ...r,
      rank,
      rankPrev,
      // Positive means climbed. A new entry has no movement, not a movement of zero.
      rankChange: rankPrev == null ? null : rankPrev - rank,
      isNew: rankPrev == null,
      change1h: p ? Number((r.gossipScore - p.gossipScore).toFixed(2)) : null,
      peakToday: Number(peakToday.toFixed(2)),
      peakWeek: Number(peakWeek.toFixed(2)),
      attention: attentionBand(r.gossipScore),
      momentumLabel: momentumBand(r.momentum),
      trend: trendArrow(r.momentum),
      statusSince: statusChanged || !p?.statusSince ? now : p.statusSince,
    }
  })
}

/**
 * The five dashboard cards, all from data. A card with nothing to show comes
 * back empty with a reason rather than inventing an entry.
 */
export function marketCards(ranked) {
  const pick = (list, why) => (list.length ? { celebrity: list[0], empty: false } : { celebrity: null, empty: true, reason: why })
  const withChange = ranked.filter((r) => Number.isFinite(r.change24h))

  return {
    hottest: pick(ranked.slice(0, 1), 'no scored celebrities yet'),
    riser: pick(withChange.filter((r) => r.change24h > 0).sort((a, b) => b.change24h - a.change24h), 'nothing has risen in 24 hours'),
    faller: pick(withChange.filter((r) => r.change24h < 0).sort((a, b) => a.change24h - b.change24h), 'nothing has fallen in 24 hours'),
    mostCovered: pick(ranked.slice().sort((a, b) => b.mentions - a.mentions), 'no coverage measured yet'),
    breaking: pick(ranked.filter((r) => r.status === 'BREAKING').sort((a, b) => b.statusSince - a.statusSince), 'nothing is breaking'),
  }
}

/** Which celebrities the next run re-checks on the 15-minute tick. */
export function hotList(ranked, size) {
  const byScore = ranked.slice(0, 10).map((r) => r.id)
  const byMomentum = ranked.slice().sort((a, b) => Math.abs(b.momentum) - Math.abs(a.momentum)).slice(0, 10).map((r) => r.id)
  const breaking = ranked.filter((r) => r.status === 'BREAKING').map((r) => r.id)
  return [...new Set([...breaking, ...byScore, ...byMomentum])].slice(0, size)
}

/** Market-wide summary for the header strip. */
export function marketSummary(ranked) {
  const scores = ranked.map((r) => r.gossipScore)
  const rising = ranked.filter((r) => r.momentum >= 10).length
  const falling = ranked.filter((r) => r.momentum <= -10).length
  return {
    tracked: ranked.length,
    averageScore: scores.length ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)) : 0,
    totalMentions: ranked.reduce((a, r) => a + (r.mentions || 0), 0),
    rising,
    falling,
    breaking: ranked.filter((r) => r.status === 'BREAKING').length,
  }
}

/** The tab filters, so the UI does not hold selection logic of its own. */
export function filterTab(ranked, tab) {
  switch (tab) {
    case 'top': return ranked.slice(0, 100)
    case 'rising': return ranked.filter((r) => r.momentum >= 10)
    case 'falling': return ranked.filter((r) => r.momentum <= -10)
    case 'breaking': return ranked.filter((r) => r.status === 'BREAKING')
    default: return ranked.filter((r) => r.primaryCategory === tab || (r.secondaryCategories || []).includes(tab))
  }
}
