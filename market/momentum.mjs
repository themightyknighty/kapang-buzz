/**
 * Momentum — the rate of change of attention, separate from its level.
 *
 * A celebrity can sit at a Gossip Score of 90 with a momentum of -40:
 * enormous attention that is draining away. That combination is what COOLING
 * means and it is the most interesting cell in the table.
 *
 * Momentum is measured on the slope of LOG volume, so it is scale-free — a
 * small celebrity doubling and a huge one doubling read the same.
 *
 * Pure: no network, no storage, no clock.
 */
import { MOMENTUM, MOMENTUM_BANDS, STATUS_RULES } from './config.mjs'
import { log1p } from './normalize.mjs'

/**
 * Average slope of log volume across a window, in units per hour.
 * `points` are { t: epochMs, v: number }, oldest first.
 */
export function velocity(points, hours, now) {
  const from = now - hours * 3600000
  const win = points.filter((p) => p.t >= from && p.t <= now)
  if (win.length < 2) return 0
  const first = win[0], last = win.at(-1)
  const dt = (last.t - first.t) / 3600000
  if (dt <= 0) return 0
  return (log1p(last.v) - log1p(first.v)) / dt
}

/**
 * Acceleration: is attention arriving faster now than it was? This, not the
 * current level, is what momentum measures.
 */
export function acceleration(points, now, { recentHours = MOMENTUM.recentHours, priorHours = MOMENTUM.priorHours } = {}) {
  const recent = velocity(points, recentHours, now)
  const prior = velocity(points, priorHours, now - recentHours * 3600000)
  return { recent, prior, value: recent - prior }
}

/**
 * -100..+100. tanh bounds it naturally and keeps the middle of the range
 * sensitive, so ordinary movement is legible instead of everything pinning
 * at the extremes.
 */
export function momentumOf(points, now, { history = [], scale = MOMENTUM.scale, smoothing = MOMENTUM.smoothing } = {}) {
  const acc = acceleration(points, now)
  const instant = 100 * Math.tanh(acc.value / scale)
  // Smoothed, so one noisy fetch cannot flip a celebrity from surging to
  // collapsing and back on the next tick.
  const recent = [...history.slice(-(smoothing - 1)), instant]
  const smoothed = recent.reduce((a, b) => a + b, 0) / recent.length
  return {
    momentum: Number(Math.max(-100, Math.min(100, smoothed)).toFixed(2)),
    instant: Number(instant.toFixed(2)),
    velocityRecent: Number(acc.recent.toFixed(4)),
    velocityPrior: Number(acc.prior.toFixed(4)),
    acceleration: Number(acc.value.toFixed(4)),
  }
}

export const momentumBand = (m) => (MOMENTUM_BANDS.find((b) => m >= b.min) || MOMENTUM_BANDS.at(-1)).label

/** ↑↑ / ↑ / → / ↓ / ↓↓ for the Trend column. */
export function trendArrow(momentum) {
  if (momentum >= 40) return '↑↑'
  if (momentum >= 10) return '↑'
  if (momentum <= -40) return '↓↓'
  if (momentum <= -10) return '↓'
  return '→'
}

/**
 * Classify a celebrity. Rules are evaluated in order and the first match
 * wins; BREAKING needs all three of its conditions because it is the loudest
 * state in the interface and will eventually drive notifications.
 */
export function classify({ score, momentum, confidence, deviationPercentile = 0, newEntry = false }, rules = STATUS_RULES) {
  for (const r of rules) {
    if (r.newEntry !== undefined && r.newEntry !== newEntry) continue
    if (r.newEntry === undefined && newEntry) continue
    if (r.minDeviationPct !== undefined && !(deviationPercentile >= r.minDeviationPct)) continue
    if (r.minMomentum !== undefined && !(momentum >= r.minMomentum)) continue
    if (r.maxMomentum !== undefined && !(momentum <= r.maxMomentum)) continue
    if (r.maxAbsMomentum !== undefined && !(Math.abs(momentum) < r.maxAbsMomentum)) continue
    if (r.minConfidence !== undefined && !(confidence >= r.minConfidence)) continue
    if (r.minScore !== undefined && !(score >= r.minScore)) continue
    if (r.maxScore !== undefined && !(score < r.maxScore)) continue
    return r.status
  }
  return 'STABLE'
}
