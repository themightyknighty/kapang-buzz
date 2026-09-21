/**
 * Normalization and baselines — turning raw counts into "is this unusual for
 * THIS person?".
 *
 * The whole product rests on this file. A celebrity with 5,000 mentions is
 * less interesting than one who normally gets 100 and suddenly gets 3,000, so
 * the primary measure is deviation from their own baseline, not volume.
 *
 * Three transforms, in order:
 *   log      — ratios rather than differences drive the result
 *   z-score  — median and MAD, so one past spike does not poison the baseline
 *   squash   — a logistic curve, so nobody can run away with first place
 *
 * Pure: no network, no storage, no clock.
 */
import { SQUASH_K, BASELINE, CONFIDENCE } from './config.mjs'

export const log1p = (x) => Math.log(1 + Math.max(0, Number(x) || 0))

export function median(values) {
  const v = values.filter(Number.isFinite).slice().sort((a, b) => a - b)
  if (!v.length) return 0
  const mid = v.length >> 1
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

/**
 * Median absolute deviation. Robust where a standard deviation is not: one
 * enormous past spike moves a standard deviation a long way and would make
 * that celebrity permanently hard to surprise.
 */
export function mad(values) {
  const m = median(values)
  return median(values.map((v) => Math.abs(v - m)))
}

/**
 * How unusual is `current` against `baseline`? Scaled by 1.4826 so the result
 * matches a standard deviation for normally distributed data.
 */
export function robustZ(current, baseline, { madFloor = BASELINE.madFloor } = {}) {
  const logs = baseline.map(log1p)
  const m = median(logs)
  const scale = Math.max(1.4826 * mad(logs), madFloor)
  return (log1p(current) - m) / scale
}

/** Map a z-score onto 0-1. Flattens at the top so one celebrity cannot own #1. */
export const squash = (z, k = SQUASH_K) => 1 / (1 + Math.exp(-z / k))

/**
 * Cross-market normalization: where does this value sit against everyone
 * else's right now? Used for the small absolute-volume term, so that scale
 * still counts for something without dominating.
 */
export function percentileOf(value, population) {
  const v = population.filter(Number.isFinite).slice().sort((a, b) => a - b)
  if (!v.length) return 0.5
  let below = 0
  for (const x of v) { if (x < value) below++; else break }
  return below / v.length
}

/**
 * Deviation alone would crown a nobody with six articles. Confidence rises
 * from 0 at no evidence to 1 at `fullMentions`, and below `floorMentions` it
 * is capped hard.
 */
export function confidenceFor(mentions, { floorMentions = CONFIDENCE.floorMentions,
  fullMentions = CONFIDENCE.fullMentions, floorCap = CONFIDENCE.floorCap } = {}) {
  const m = Math.max(0, Number(mentions) || 0)
  if (m <= 0) return 0
  if (m < floorMentions) return Number(((m / floorMentions) * floorCap).toFixed(4))
  const span = Math.max(1e-9, fullMentions - floorMentions)
  const t = Math.min(1, (m - floorMentions) / span)
  return Number((floorCap + (1 - floorCap) * t).toFixed(4))
}

/* ------------------------------------------------------------------ *
   Baseline windows
 * ------------------------------------------------------------------ */

/**
 * Build the four baseline windows from stored history.
 *
 * `intraday` is this celebrity's recent 15-minute snapshots, newest last.
 * `daily` is their daily rollup, newest last. Nothing is fetched and nothing
 * is invented — a window with no data comes back empty and its consumer
 * decides what to do.
 */
export function buildBaselines(intraday = [], daily = [], pick = (x) => x.mentions) {
  const i = intraday.map(pick).filter(Number.isFinite)
  const d = daily.map(pick).filter(Number.isFinite)
  return {
    '1h': i.slice(-4),
    '24h': i.slice(-96),
    '7d': d.slice(-7),
    '30d': d.slice(-30),
    daysOfHistory: d.length,
  }
}

/** A celebrity without enough history of their own to be judged against it. */
export const isNewEntry = (baselines, min = BASELINE.minDaysForOwnBaseline) =>
  (baselines?.daysOfHistory ?? 0) < min

/**
 * Deviation for a celebrity, with an honest fallback when they are too new.
 *
 * A new celebrity borrows the median of their category rather than having a
 * baseline invented for them, and the reduced confidence is returned so the
 * caller can mark the number as provisional.
 */
export function deviation(current, baselines, { categoryMedian = null } = {}) {
  const primary = baselines?.[BASELINE.primary] || []
  if (primary.length >= BASELINE.minDaysForOwnBaseline) {
    return { z: robustZ(current, primary), basis: BASELINE.primary, provisional: false }
  }
  const fallback = primary.length ? primary
    : Number.isFinite(categoryMedian) ? [categoryMedian] : []
  if (!fallback.length) return { z: 0, basis: 'none', provisional: true }
  return { z: robustZ(current, fallback), basis: 'category-median', provisional: true }
}

/**
 * Has this celebrity's whole level shifted? Someone in a sustained news cycle
 * should eventually stop reading as "surging" and settle into a new normal,
 * which is what comparing the 7-day against the 30-day catches.
 */
export function regimeShift(baselines) {
  const week = median((baselines?.['7d'] || []).map(log1p))
  const month = median((baselines?.['30d'] || []).map(log1p))
  if (!week || !month) return 0
  return Number((week - month).toFixed(4))
}
