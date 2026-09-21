/**
 * The Gossip Score — a transparent 0-100 index of unusual attention.
 *
 * Nothing here is random and nothing is hidden. Every component, every
 * weight and every contribution is returned alongside the total, because the
 * admin panel has to be able to show exactly why a number is what it is, and
 * because stored components let history be re-scored under new weights
 * without re-fetching anything.
 *
 * Pure: no network, no storage, no clock. `now` is always passed in.
 */
import { WEIGHTS, NEWS_MIX, MOMENTUM_MODIFIER, STALE_TOLERANCE_SECONDS, STALE_DROP_SECONDS, ATTENTION_BANDS } from './config.mjs'
import { squash, percentileOf, confidenceFor, deviation } from './normalize.mjs'

/** A source too old to mean anything contributes nothing and loses its weight. */
export function sourceUsable(source, ageSeconds) {
  const drop = STALE_DROP_SECONDS[source]
  if (!Number.isFinite(ageSeconds)) return false
  return !drop || ageSeconds <= drop
}

/** A source past tolerance but not yet dropped is trusted a little less. */
export function freshnessFactor(source, ageSeconds) {
  const tol = STALE_TOLERANCE_SECONDS[source]
  const drop = STALE_DROP_SECONDS[source]
  if (!Number.isFinite(ageSeconds) || !tol) return 1
  if (ageSeconds <= tol) return 1
  if (!drop || ageSeconds >= drop) return 0
  return Number((1 - (ageSeconds - tol) / (drop - tol)).toFixed(4))
}

/**
 * The news component: mostly "is this unusual for them", a little "is this
 * big in absolute terms". The absolute term is what keeps a real A-lister in
 * a real news cycle above a micro-celebrity having a slightly odd Tuesday.
 */
export function newsComponent({ mentions, weightedMentions, baselines, marketMentions = [], categoryMedian = null }) {
  const dev = deviation(weightedMentions ?? mentions, baselines, { categoryMedian })
  const deviationScore = squash(dev.z) * 100
  const absoluteScore = percentileOf(mentions, marketMentions) * 100
  const score = NEWS_MIX.deviation * deviationScore + NEWS_MIX.absolute * absoluteScore
  return {
    score: Number(score.toFixed(2)),
    deviationScore: Number(deviationScore.toFixed(2)),
    absoluteScore: Number(absoluteScore.toFixed(2)),
    z: Number(dev.z.toFixed(3)), basis: dev.basis, provisional: dev.provisional,
  }
}

/** Wikipedia interest, on the same deviation logic but against daily views. */
export function wikipediaComponent({ views, baselines, categoryMedian = null }) {
  if (!Number.isFinite(views)) return null
  const dev = deviation(views, baselines, { categoryMedian })
  return { score: Number((squash(dev.z) * 100).toFixed(2)), z: Number(dev.z.toFixed(3)), basis: dev.basis }
}

/**
 * Breadth of coverage, from de-duplicated clusters. Independent pickup by
 * real outlets across many countries beats the same wire story cloned across
 * content farms, which is exactly what `prominence` already encodes.
 */
export function breadthComponent({ uniqueSources = 0, uniqueCountries = 0, prominence = 0 }) {
  const sources = Math.min(1, Math.log1p(uniqueSources) / Math.log1p(60))
  const countries = Math.min(1, Math.log1p(uniqueCountries) / Math.log1p(15))
  const prom = Math.min(1, prominence / 12)
  const score = (0.45 * sources + 0.25 * countries + 0.30 * prom) * 100
  return { score: Number(score.toFixed(2)), sources: Number(sources.toFixed(3)), countries: Number(countries.toFixed(3)), prominence: Number(prom.toFixed(3)) }
}

/**
 * Momentum as a multiplier on coverage, not a component of its own.
 *
 * Folding a signed quantity into an unsigned component meant momentum of
 * zero — nothing accelerating — scored 50 and contributed a quarter of its
 * weight to every celebrity on the roster, whether or not anything was
 * happening to them. Here, nothing accelerating multiplies by exactly 1 and
 * contributes nothing; and because it multiplies the NEWS value, a celebrity
 * with no coverage gets no benefit from it at all. There is nothing to
 * accelerate.
 */
export function momentumFactor(momentum, { gain = MOMENTUM_MODIFIER.gain,
  floor = MOMENTUM_MODIFIER.floor, ceiling = MOMENTUM_MODIFIER.ceiling } = {}) {
  const m = Math.max(-100, Math.min(100, Number(momentum) || 0))
  return Number(Math.max(floor, Math.min(ceiling, 1 + gain * (m / 100))).toFixed(4))
}

/**
 * Put it together.
 *
 * Missing or dropped sources have their weight redistributed across the
 * survivors rather than being scored as zero — a celebrity should not be
 * punished because Wikipedia's API was down.
 */
export function gossipScore({ news, wikipedia, breadth, momentum, mentions, ages = {}, weights = WEIGHTS }) {
  // Acceleration lifts or damps the coverage reading; it never stands alone.
  const mFactor = momentumFactor(momentum)
  const newsValue = news?.score == null ? null : Math.max(0, Math.min(100, news.score * mFactor))

  const parts = {
    news: { value: newsValue, weight: weights.news, factor: freshnessFactor('news', ages.news), usable: news != null && sourceUsable('news', ages.news ?? 0) },
    wikipedia: { value: wikipedia?.score ?? null, weight: weights.wikipedia, factor: freshnessFactor('wikipedia', ages.wikipedia), usable: wikipedia != null && sourceUsable('wikipedia', ages.wikipedia ?? 0) },
    breadth: { value: breadth?.score ?? null, weight: weights.breadth, factor: 1, usable: breadth != null },
  }

  const live = Object.entries(parts).filter(([, p]) => p.usable && Number.isFinite(p.value) && p.factor > 0)
  const totalWeight = live.reduce((s, [, p]) => s + p.weight, 0)

  const contributions = {}
  let raw = 0
  for (const [key, p] of live) {
    // Redistribute proportionally so the surviving weights still sum to 1.
    const effective = p.weight / totalWeight
    const contribution = p.value * effective * p.factor
    contributions[key] = {
      value: p.value, weight: p.weight, effectiveWeight: Number(effective.toFixed(4)),
      freshnessFactor: p.factor, contribution: Number(contribution.toFixed(2)),
    }
    raw += contribution
  }
  for (const [key, p] of Object.entries(parts)) {
    if (!contributions[key]) contributions[key] = { value: p.value, weight: p.weight, effectiveWeight: 0, freshnessFactor: p.factor, contribution: 0, dropped: true }
  }

  const confidence = confidenceFor(mentions)
  const final = Math.max(0, Math.min(100, raw * confidence))

  return {
    score: Number(final.toFixed(2)),
    raw: Number(raw.toFixed(2)),
    confidence,
    contributions,
    // Kept beside the contributions so the admin panel and the evidence
    // record can both say what acceleration did to the coverage reading.
    momentum: { value: momentum ?? null, factor: mFactor, newsBefore: news?.score ?? null, newsAfter: newsValue },
    droppedSources: Object.entries(contributions).filter(([, c]) => c.dropped).map(([k]) => k),
  }
}

export const attentionBand = (score) => (ATTENTION_BANDS.find((b) => score >= b.min) || ATTENTION_BANDS.at(-1)).label
