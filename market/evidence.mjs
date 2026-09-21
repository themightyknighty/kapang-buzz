/**
 * Why a name moved — worked out from the same numbers that moved it.
 *
 * This file exists because the chart used to explain itself by association.
 * The score was computed here, in market/; the reason shown beside it was
 * fetched somewhere else entirely, by asking "which story in the feed
 * mentions this person most recently?" Those two things were never derived
 * from each other, so the explanation could be — and often was — about a
 * different event from the one that moved the number. A name could climb on
 * search interest with no story at all and still be captioned with whichever
 * article happened to carry their name.
 *
 * So the rule here is: every figure a reader is shown is a figure that
 * contributed to the rank. Nothing is looked up after the fact. The record
 * this produces is what the chart ranks on, what the screen explains with,
 * and what the share card draws — one set of numbers, three surfaces.
 *
 * Pure: no network, no storage, no clock beyond what is passed in.
 */
import { CHART, PUBLISHER_TIERS } from './config.mjs'
import { dayLevel, weekDays } from './chart.mjs'

const DAY = 86400000
const dayMs = (day) => Date.parse(`${day}T00:00:00Z`)
const finite = (x) => (Number.isFinite(x) ? x : null)

/** Median, on a copy. */
function median(values) {
  const v = values.filter(Number.isFinite).slice().sort((a, b) => a - b)
  if (!v.length) return null
  const mid = v.length >> 1
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

const mean = (values) => {
  const v = values.filter(Number.isFinite)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

/**
 * Fractional change, guarded.
 *
 * Against a base of zero any arrival is an infinite rise, which is both true
 * and useless — so a base below one is treated as one. Going from nothing to
 * four mentions is a change of 3, not of infinity.
 */
export function changeRatio(now, before) {
  if (!Number.isFinite(now)) return null
  const base = Math.max(1, Number.isFinite(before) ? before : 0)
  return Number(((now - base) / base).toFixed(3))
}

/** How many tier-one and tier-two publishers are behind this. */
export function topTierCount(drivers = []) {
  const tier1 = new Set(PUBLISHER_TIERS[1] || [])
  const tier2 = new Set(PUBLISHER_TIERS[2] || [])
  const domains = new Set((drivers || []).map((d) => d?.domain).filter(Boolean))
  let n = 0
  for (const d of domains) if (tier1.has(d) || tier2.has(d)) n++
  return n
}

/* ------------------------------------------------------------------ *
 * The shape of a week
 * ------------------------------------------------------------------ */

/**
 * Is this a new level or a loud afternoon?
 *
 * The distinction the index could not previously draw, and the one that
 * decides whether a rise deserves the word "rising". `regimeShift` has been
 * sitting in normalize.mjs since the beginning, written and commented and
 * imported by nothing at all — this is the question it was written to answer,
 * asked of daily levels rather than mention counts.
 *
 *   spike      one day carries the week and the rest is ordinary
 *   building   the second half is well above the first
 *   fading     the second half is well below it — they have already peaked
 *   sustained  the whole week sits above their own normal and held there
 *   steady     nothing to report, which is a real answer
 */
export function weekShape({ levels = [], quiet = null,
  spikeShare = 0.36, riseBy = 1.25, fallBy = 0.75, above = 1.2 } = {}) {
  const vals = levels.filter(Number.isFinite)
  if (vals.length < 3) return 'steady'

  const total = vals.reduce((a, b) => a + b, 0)
  const peak = Math.max(...vals)
  // One day worth more than a third of the whole week is a spike whatever
  // else is true of it, so this is tested before the trend.
  if (total > 0 && peak / total >= spikeShare) return 'spike'

  const half = Math.floor(vals.length / 2)
  const first = mean(vals.slice(0, half))
  const second = mean(vals.slice(-half))
  const level = median(vals)

  if (Number.isFinite(first) && Number.isFinite(second) && first > 0) {
    if (second >= first * riseBy) return 'building'
    if (second <= first * fallBy) return 'fading'
  }
  if (Number.isFinite(quiet) && quiet > 0 && Number.isFinite(level) && level >= quiet * above) return 'sustained'
  return 'steady'
}

/* ------------------------------------------------------------------ *
 * The drivers
 * ------------------------------------------------------------------ */

const DRIVERS = [
  { key: 'coverage', label: 'Coverage', unit: 'mentions', pick: (d) => finite(d?.mentions) },
  { key: 'breadth', label: 'Outlets', unit: 'outlets', pick: (d) => finite(d?.sources) },
  { key: 'search', label: 'Search', unit: 'views', pick: (d) => finite(d?.wikipediaViews) },
]

/**
 * What moved, by how much, and how much of the movement each one accounts for.
 *
 * Three independent signals. Coverage is how much was written; breadth is how
 * many separate newsrooms wrote it; search is how many people went looking
 * afterwards. A real event moves more than one of them. One outlet writing
 * one story moves coverage alone, and that is the difference this exists to
 * make visible.
 *
 * A signal with no reading before this week is reported but never counted as
 * having moved — we cannot say a number rose if we never had the old one.
 * Breadth is in that position for every edition built before the rollup
 * started keeping it.
 */
export function driversOf(thisWeek = [], lastWeek = [], { moved = CHART.CORROBORATION.moved } = {}) {
  return DRIVERS.map(({ key, label, unit, pick }) => {
    const now = mean(thisWeek.map(pick))
    const before = mean(lastWeek.map(pick))
    const known = Number.isFinite(now) && Number.isFinite(before)
    const change = known ? changeRatio(now, before) : null
    return {
      key,
      label,
      unit,
      now: Number.isFinite(now) ? Math.round(now * 10) / 10 : null,
      before: Number.isFinite(before) ? Math.round(before * 10) / 10 : null,
      change,
      moved: known && change >= moved,
      // Filled in below, once we know which of them moved.
      share: 0,
    }
  })
}

/** Each moving driver's share of the total movement, so a bar chart can be drawn. */
function withShares(drivers) {
  const total = drivers.filter((d) => d.moved).reduce((a, d) => a + Math.abs(d.change), 0)
  return drivers.map((d) => ({
    ...d,
    share: d.moved && total > 0 ? Number((Math.abs(d.change) / total).toFixed(3)) : 0,
  }))
}

/* ------------------------------------------------------------------ *
 * The record
 * ------------------------------------------------------------------ */

/**
 * Everything known about why this name sits where it sits.
 *
 * @param {object}  input
 * @param {number}  input.rank         this week's place
 * @param {number?} input.lastWeek     last week's place, or null
 * @param {string}  input.status       new | reentry | up | down | same
 * @param {object}  input.figure       what weekScore returned
 * @param {object}  input.row          the current market row
 * @param {Array}   input.days         this celebrity's whole rollup
 * @param {object}  input.range        the chart week
 * @param {object?} input.previousEntry  their entry in last week's edition
 * @param {object?} input.story        a story that supports this, if one exists
 */
export function buildEvidence({
  rank,
  lastWeek = null,
  status = 'same',
  figure = {},
  row = {},
  days = [],
  range = {},
  previousEntry = null,
  story = null,
  rules = CHART.CORROBORATION,
} = {}) {
  const inRange = (d, from, to) => {
    const t = dayMs(d?.day)
    return Number.isFinite(t) && t >= from && t <= to
  }
  const thisWeek = days.filter((d) => inRange(d, range.startsAt, range.endsAt))
  const lastWeekDays = days.filter((d) => inRange(d, range.startsAt - 7 * DAY, range.startsAt - 1))

  /* ---- the week, day by day ---- */
  const measured = new Map(thisWeek.map((d) => [d.day, d]))
  const span = weekDays(range)
  const series = span.map((day) => {
    const d = measured.get(day)
    const level = d ? dayLevel(d) : null
    return {
      day,
      level: Number.isFinite(level) ? Math.round(level * 10) / 10 : null,
      measured: Number.isFinite(level),
    }
  })
  const levels = series.map((p) => p.level).filter(Number.isFinite)
  const peak = series.filter((p) => p.measured).sort((a, b) => b.level - a.level)[0] || null

  /* ---- what moved ---- */
  const drivers = withShares(driversOf(thisWeek, lastWeekDays, { moved: rules.moved }))
  const corroboration = drivers.filter((d) => d.moved).length
  /*
   * How much of the corroboration test we are entitled to apply.
   *
   * A signal with no reading last week cannot have moved, so in the chart's
   * first weeks — and for breadth, which the rollup only began keeping
   * recently — corroboration is capped below the bar by the absence of
   * history rather than by the absence of evidence. Marking every riser
   * "thin" on that basis would be both unfair and useless: a label every row
   * carries is a label nobody reads.
   */
  const judgeable = drivers.filter((d) => Number.isFinite(d.before)).length
  const basis = judgeable === drivers.length ? 'full' : judgeable > 0 ? 'partial' : 'none'

  /* ---- the hard evidence ---- */
  const outlets = finite(Math.max(0, ...thisWeek.map((d) => d.sources || 0))) || finite(row.uniqueSources) || 0
  const countries = finite(Math.max(0, ...thisWeek.map((d) => d.countries || 0))) || finite(row.uniqueCountries) || 0

  const direction = status === 'new' ? 'new'
    : status === 'reentry' ? 'reentry'
      : !Number.isFinite(lastWeek) ? 'new'
        : lastWeek > rank ? 'up'
          : lastWeek < rank ? 'down' : 'flat'

  /*
   * "Thin" is not a judgement on the person, it is a statement about the
   * evidence: this climb is visible in one place and nowhere else. It is
   * only ever applied to a RISE — a name falling needs no corroboration to
   * be believed, and a name holding station is not claiming anything.
   */
  const rising = direction === 'up' || direction === 'new'
  const thin = rising && (
    // Breadth of coverage stands on its own: it is a fact about this week,
    // not a comparison with last week, so it applies from the first edition.
    outlets < rules.minOutlets
    || countries < rules.minCountries
    /*
     * The corroboration test only applies when EVERY signal is judgeable.
     *
     * Requiring two of two is a stricter bar than two of three, so applying
     * it on partial history punishes a name for our own missing data — the
     * opposite of the intent. Below a full basis, breadth decides and the
     * copy says the comparison is partial.
     */
    || (basis === 'full' && corroboration < rules.signals)
  )

  return {
    move: {
      direction,
      from: Number.isFinite(lastWeek) ? lastWeek : null,
      to: rank,
      places: Number.isFinite(lastWeek) ? Math.abs(lastWeek - rank) : null,
    },
    week: {
      score: finite(figure.score),
      previousScore: finite(previousEntry?.score),
      change: Number.isFinite(figure.score) && Number.isFinite(previousEntry?.score)
        ? Number((figure.score - previousEntry.score).toFixed(1))
        : null,
      days: finite(figure.days),
      span: finite(figure.span) ?? span.length,
      quietLevel: finite(figure.quietLevel),
      series,
      peak: peak ? { day: peak.day, level: peak.level } : null,
      shape: weekShape({ levels, quiet: figure.quietLevel }),
      highest: finite(figure.highest),
      bestRank: finite(figure.bestRank),
    },
    drivers,
    corroboration,
    /** How many of the three signals we had a previous reading for. */
    judgeable,
    basis,
    thin,
    evidence: {
      outlets,
      countries,
      topTier: topTierCount(row.drivers),
      mentions: finite(mean(thisWeek.map((d) => d.mentions))) != null
        ? Math.round(mean(thisWeek.map((d) => d.mentions)))
        : finite(row.mentions),
      // The story is supporting evidence now, not the explanation. It is
      // here so a reader can go and read the thing; it is not what the
      // numbers are derived from, and the card leads with the numbers.
      story: story ? { id: story.id, headline: story.headline, href: `/story/${story.id}`, outlets: story.outlets ?? null } : null,
    },
  }
}
