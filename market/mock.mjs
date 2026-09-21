/**
 * A synthetic market, for building and tuning the UI without spending API
 * calls.
 *
 * This is NOT production data and must never be confused with it. Everything
 * generated here carries `mock: true`, the UI shows a persistent banner when
 * it sees that flag, and nothing from this file is ever written to the
 * production blob store.
 *
 * It runs the real scoring engine over invented raw counts rather than
 * inventing scores, so the numbers relate to each other the way real ones
 * will — which is the only way the UI is worth building against.
 */
import { activeRoster } from './roster.mjs'
import { newsComponent, wikipediaComponent, breadthComponent, gossipScore } from './score.mjs'
import { momentumOf, classify } from './momentum.mjs'
import { rankMarket, marketCards, marketSummary } from './rank.mjs'
import { percentileOf } from './normalize.mjs'
import { SNAPSHOT_INTERVAL_MINUTES } from './config.mjs'

/** Deterministic PRNG, so a given seed always produces the same market. */
function rng(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

/**
 * A plausible 30 days of daily volume plus 48 hours of 15-minute volume for
 * one celebrity. Some are flat, some are in a slow build, a few are having a
 * genuine event — which is what makes the market interesting to look at.
 */
function simulate(celebrity, rand, now) {
  const fame = 8 + Math.floor(rand() * 900)          // their ordinary level
  const roll = rand()
  const shape = roll > 0.90 ? 'breaking' : roll > 0.74 ? 'surging' : roll > 0.60 ? 'cooling' : roll > 0.12 ? 'steady' : 'dormant'

  // Each celebrity's event starts at its own moment, or every sparkline in
  // the table has an identical hook and the market looks fabricated.
  const onset = 0.55 + rand() * 0.4
  const jitter = (v) => Math.max(0, Math.round(v * (0.82 + rand() * 0.36)))
  const daily = Array.from({ length: 30 }, () => jitter(fame))

  const steps = 192 // 48 hours at 15 minutes
  const stepMs = SNAPSHOT_INTERVAL_MINUTES * 60000
  const intraday = []
  for (let i = 0; i < steps; i++) {
    const t = now - (steps - 1 - i) * stepMs
    const through = i / (steps - 1)
    let level = fame / 96
    // Deliberately gentle: real coverage does not go up 90x in an hour, and a
    // simulation that steep pins every momentum at 100 and tells us nothing.
    const ramp = Math.max(0, (through - onset) / Math.max(0.05, 1 - onset))
    if (shape === 'breaking') level *= 1 + 12 * ramp ** 2.2
    else if (shape === 'surging') level *= 1 + 2.4 * ramp ** 1.6
    else if (shape === 'cooling') level *= Math.max(0.18, 1 - 1.5 * Math.max(0, through - (onset - 0.35)))
    else if (shape === 'dormant') level *= 0.15
    else level *= 1 + 0.25 * Math.sin(through * 9 + fame)
    intraday.push({ t, v: jitter(level) })
  }
  return { daily, intraday, shape, fame }
}

/** Build the whole mock market, ranked and carded, exactly like a real run. */
export function mockMarket({ now = Date.now(), seed = 20260917 } = {}) {
  const rand = rng(seed)
  const roster = activeRoster()
  const sims = roster.map((c) => ({ c, ...simulate(c, rand, now) }))

  // Current mention counts over a 24-hour window — the SAME window the daily
  // baseline is in. Comparing an hourly count against a daily baseline would
  // make every celebrity look permanently quiet.
  const currents = sims.map((s) => s.intraday.slice(-96).reduce((a, p) => a + p.v, 0))
  const marketMentions = currents.slice().sort((a, b) => a - b)

  const rows = sims.map((s, i) => {
    const mentions = currents[i]
    const baselines = { '7d': s.daily.slice(-7), '30d': s.daily.slice(-30), daysOfHistory: 30 }
    const uniqueSources = Math.max(1, Math.round(mentions * (0.4 + rand() * 0.5)))
    const uniqueCountries = Math.max(1, Math.round(Math.log1p(uniqueSources) * (1 + rand() * 2)))

    const news = newsComponent({ mentions, weightedMentions: mentions, baselines, marketMentions })
    const wiki = wikipediaComponent({
      views: Math.round(mentions * (60 + rand() * 260)),
      baselines: { '7d': s.daily.map((d) => d * 90), '30d': s.daily.map((d) => d * 90), daysOfHistory: 30 },
    })
    const breadth = breadthComponent({ uniqueSources, uniqueCountries, prominence: Math.log1p(uniqueSources) * (0.6 + rand()) })
    const mom = momentumOf(s.intraday, now)

    const scored = gossipScore({
      news, wikipedia: wiki, breadth, momentum: mom.momentum, mentions,
      ages: { news: Math.round(rand() * 2400), wikipedia: Math.round(20000 + rand() * 60000) },
    })

    // The score series, so 1h/24h change are score changes — which is what
    // the Change column means — rather than raw mention deltas.
    const peak = Math.max(...s.intraday.map((p) => p.v)) || 1
    const shapeAt = (v) => 0.35 + 0.65 * (v / peak)
    // Anchored so the last point IS the current score — otherwise "change"
    // compares the score against a rescaled version of itself.
    const anchor = shapeAt(s.intraday.at(-1).v) || 1
    const scoreSeries = s.intraday.map((p) => ({ t: p.t, v: Number(Math.min(100, scored.score * shapeAt(p.v) / anchor).toFixed(2)) }))
    const at = (back) => scoreSeries[Math.max(0, scoreSeries.length - 1 - back)]?.v ?? scoreSeries[0].v
    const today = scoreSeries.slice(-96).map((p) => p.v)

    return {
      scoreSeries,
      change1h: Number((scored.score - at(4)).toFixed(2)),
      change24h: Number((scored.score - at(96)).toFixed(2)),
      change7d: null,
      peakToday: Number(Math.max(...today).toFixed(2)),
      peakWeek: Number(Math.max(...scoreSeries.map((p) => p.v)).toFixed(2)),
      id: s.c.id, displayName: s.c.displayName, slug: s.c.slug,
      primaryCategory: s.c.primaryCategory, secondaryCategories: s.c.secondaryCategories,
      imageUrl: null, wikipediaUrl: s.c.wikipediaUrl,
      gossipScore: scored.score, raw: scored.raw, confidence: scored.confidence,
      contributions: scored.contributions, droppedSources: scored.droppedSources,
      newsScore: news.score, wikipediaScore: wiki?.score ?? null, breadthScore: breadth.score,
      momentum: mom.momentum, velocity1h: mom.velocityRecent, acceleration: mom.acceleration,
      mentions, uniqueSources, uniqueCountries,
      deviationZ: news.z,
      baselines: { '7d': baselines['7d'], '30d': baselines['30d'], daysOfHistory: 30 },
      sources: {
        news: { freshnessSeconds: Math.round(rand() * 2400), confidence: 0.9, ok: true },
        wikipedia: { freshnessSeconds: Math.round(20000 + rand() * 60000), confidence: 0.8, ok: true },
      },
      mentionSeries: s.intraday.map((p) => ({ t: p.t, v: p.v })),
      shape: s.shape,
      /*
       * Invented drivers, on deliberately fictional domains.
       *
       * The screens that explain WHY a name is moving fall back to naming the
       * outlets driving the coverage, so a mock without drivers exercises only
       * half of them — which is how the biggest-mover segment came to be built
       * and never once seen locally. The domains end in .test, a reserved TLD
       * that resolves nowhere, so a sample market can never be mistaken for a
       * claim that anyone actually published anything.
       */
      drivers: Array.from({ length: 1 + Math.floor(rand() * 4) }, (_, k) => ({
        title: null,
        url: `https://outlet-${k + 1}.test/${s.c.slug}`,
        domain: `outlet-${k + 1}.test`,
        publishers: 1,
        firstSeen: new Date(now).toISOString(),
      })),
    }
  })

  // Status needs the market-wide deviation spread, so it comes after scoring.
  const zs = rows.map((r) => r.deviationZ)
  for (const r of rows) {
    r.status = classify({
      score: r.gossipScore, momentum: r.momentum, confidence: r.confidence,
      deviationPercentile: percentileOf(r.deviationZ, zs), newEntry: false,
    })
  }

  // Rank against where the market stood 15 minutes ago, so movement is real
  // rather than every row reading NEW forever.
  const prevRows = rows.map((r) => ({
    ...r, gossipScore: r.scoreSeries.at(-2)?.v ?? r.gossipScore,
  }))
  const previous = { rows: rankMarket(prevRows, null, { now: now - 900000 }) }
  const ranked = rankMarket(rows, previous, { now })

  return {
    mock: true,
    generatedAt: new Date(now).toISOString(),
    nextUpdateAt: new Date(now + SNAPSHOT_INTERVAL_MINUTES * 60000).toISOString(),
    rows: ranked,
    cards: marketCards(ranked),
    summary: marketSummary(ranked),
    health: {
      news: { ok: true, lastSuccess: new Date(now - 120000).toISOString(), errors: [] },
      wikipedia: { ok: true, lastSuccess: new Date(now - 41000000).toISOString(), errors: [] },
    },
  }
}
