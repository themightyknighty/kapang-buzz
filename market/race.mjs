/**
 * The race for number one.
 *
 * Everything else the site publishes has already happened. The chart reports
 * last week, the reports report the month, and a reader who has read them has
 * no reason to come back until the next one. This is the one thing on the
 * product that is not yet true: a gap, a challenger, and a deadline.
 *
 * That is not a decoration. It is the difference between a reference work and
 * something people check. Billboard's chart-watching subculture exists
 * entirely because on a Thursday nobody knows what Sunday's number one is,
 * and the Genie 100 has exactly the same property for free — the week is
 * running, the live standing moves every fifteen minutes, and it freezes on
 * Monday at one.
 *
 * Pure: give it the live chart and a clock.
 */
import { CHART } from './config.mjs'

const finite = (x) => (Number.isFinite(x) ? x : null)
const round = (n, dp = 1) => (Number.isFinite(n) ? Math.round(n * 10 ** dp) / 10 ** dp : null)

/** How long until the week freezes, in words a person would use. */
export function until(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null
  const mins = Math.floor(ms / 60000)
  const days = Math.floor(mins / 1440)
  const hours = Math.floor((mins % 1440) / 60)
  if (days >= 1) return hours ? `${days}d ${hours}h` : `${days}d`
  if (hours >= 1) return `${hours}h ${mins % 60}m`
  return `${mins}m`
}

/**
 * Where the chase stands.
 *
 * `closed` is the part that makes it a race rather than a scoreboard: not
 * "second is two points behind" but "second has taken back two points since
 * Wednesday". A gap is a fact; a gap that is moving is a story, and the
 * direction of travel is the only thing that tells a reader whether to come
 * back tomorrow.
 *
 * It needs the day-by-day series the evidence record already carries, so
 * nothing new is fetched or stored to produce it.
 *
 * @param {object} chart  the live chart
 * @param {number} now
 */
export function race(chart, { now = Date.now(), back = 2 } = {}) {
  const entries = (chart?.entries || []).filter((e) => Number.isFinite(e.score))
  if (!entries.length) return null

  const [leader, chaser, third] = entries
  const freezesAt = chart?.freezesAt ? Date.parse(chart.freezesAt) : NaN
  const left = Number.isFinite(freezesAt) ? freezesAt - now : null

  const base = {
    chart: CHART.name,
    weekId: chart?.id || null,
    label: chart?.label || null,
    live: Boolean(chart?.live),
    leader: face(leader),
    freezesAt: chart?.freezesAt || null,
    freezesIn: until(left),
    hoursLeft: Number.isFinite(left) ? round(left / 3600000) : null,
    frozen: Number.isFinite(left) && left <= 0,
  }
  if (!chaser) return { ...base, chaser: null, gap: null, closed: null }

  const gap = round(leader.score - chaser.score)

  /*
   * How the gap has moved.
   *
   * Both names' daily levels come from their own records, so this compares
   * the same two figures the chart ranked them on rather than a second
   * measurement that could disagree with the first.
   */
  const at = (entry, daysBack) => {
    const series = (entry?.movement?.week?.series || []).filter((p) => Number.isFinite(p.level))
    if (series.length < 2) return null
    return series[Math.max(0, series.length - 1 - daysBack)] || null
  }
  const leaderThen = at(leader, back)
  const chaserThen = at(chaser, back)
  const gapThen = leaderThen && chaserThen ? leaderThen.level - chaserThen.level : null
  const closed = Number.isFinite(gapThen) ? round(gapThen - gap) : null

  return {
    ...base,
    chaser: face(chaser),
    third: third ? face(third) : null,
    gap,
    /** Positive: the chaser has taken points back. Negative: losing ground. */
    closed,
    since: leaderThen?.day || null,
    /** Close enough that the week is genuinely open. */
    tight: gap <= 2,
    /** At this rate, would they catch them before the freeze? */
    catchable: Number.isFinite(closed) && closed > 0 && Number.isFinite(left)
      ? gap <= (closed / Math.max(1, back)) * (left / 86400000)
      : false,
  }
}

const face = (e) => (e ? {
  id: e.id,
  slug: e.slug,
  displayName: e.displayName,
  rank: e.rank,
  score: round(e.score),
  imageUrl: e.imageUrl ?? null,
  series: (e.movement?.week?.series || []).map((p) => ({ day: p.day, level: p.level })),
  thin: Boolean(e.movement?.thin),
  weeksAtOne: finite(e.weeksAtOne),
} : null)
