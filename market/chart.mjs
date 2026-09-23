/**
 * The Genie 100 — a week of the market, frozen.
 *
 * The live market is a number that changes every fifteen minutes. Nobody
 * cites a number that changes every fifteen minutes; there is nothing to
 * point at and no reason to come back. A chart is the same data with a
 * publication attached, and the publication is what turns it into something
 * a journalist quotes, a sponsor buys the name of, and a reader checks on a
 * Monday.
 *
 * Everything here is pure. It takes rollups, the previous edition and a
 * running records file, and returns an edition — which is then written once
 * and never touched again. That immutability is the point: a chart people can
 * argue with is a chart that was wrong; a chart that quietly changes after
 * publication is not a chart at all.
 *
 * Three decisions worth knowing about:
 *
 *  - A week's score is the average LEVEL across the week, not Sunday night's
 *    reading. A chart measures seven days; a snapshot measures a moment, and
 *    using one to stand for the other is how a Sunday news cycle would decide
 *    the whole week.
 *  - Weeks are UTC Monday to Sunday, the same boundary the daily rollup uses,
 *    so a chart week is exactly seven rollup days with nothing straddling an
 *    edge.
 *  - Peak position and weeks on chart are carried in a records file rather
 *    than recomputed, so a re-entry after two years off still knows it once
 *    reached number four.
 */
import { CHART } from './config.mjs'
import { storiesAbout } from '../src/lib/movers.js'
import { buildEvidence } from './evidence.mjs'
import { snapshot as insightSnapshot } from './insights.mjs'
import { pickLead } from './lead.mjs'
import { writeLead } from '../src/lib/reportcopy.js'

const DAY = 86400000
const WEEK = 7 * DAY

/* ------------------------------------------------------------------ *
 * Chart weeks
 * ------------------------------------------------------------------ */

/** UTC midnight on the Monday of the week containing `t`. */
export function mondayOf(t) {
  const d = new Date(t)
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const dayNum = (new Date(midnight).getUTCDay() + 6) % 7 // Mon = 0 … Sun = 6
  return midnight - dayNum * DAY
}

/**
 * The ISO week `t` falls in.
 *
 * ISO rather than a homemade scheme because the edges are genuinely awkward —
 * the 1st of January is often in last year's week 52 — and ISO has already
 * decided all of them. The rule is that a week belongs to the year containing
 * its Thursday.
 */
export function isoWeek(t) {
  const monday = mondayOf(t)
  const year = new Date(monday + 3 * DAY).getUTCFullYear()
  const week = Math.round((monday - mondayOf(Date.UTC(year, 0, 4))) / WEEK) + 1
  return { year, week, id: `${year}-W${String(week).padStart(2, '0')}` }
}

export const weekIdAt = (t) => isoWeek(t).id

const ID = /^(\d{4})-W(\d{2})$/

/** `2026-W38` → the Monday and the last millisecond of the Sunday, in UTC. */
export function weekRange(id) {
  const m = ID.exec(String(id || ''))
  if (!m) return null
  const year = Number(m[1])
  const week = Number(m[2])
  if (week < 1 || week > 53) return null
  const startsAt = mondayOf(Date.UTC(year, 0, 4)) + (week - 1) * WEEK
  // A year has 52 or 53 ISO weeks; asking for a 53rd that does not exist
  // would otherwise silently return the first week of the next year.
  if (isoWeek(startsAt).id !== id) return null
  return { startsAt, endsAt: startsAt + WEEK - 1 }
}

export const nextWeekId = (id) => {
  const r = weekRange(id)
  return r ? weekIdAt(r.startsAt + WEEK) : null
}

export const previousWeekId = (id) => {
  const r = weekRange(id)
  return r ? weekIdAt(r.startsAt - WEEK) : null
}

/**
 * The most recent week that has actually finished.
 *
 * Published on the Monday after it closes, so at 09:00 on Monday the 21st the
 * chart on the wall is the week of the 14th. Before the publication hour on a
 * Monday the week just gone is not out yet, and the chart still standing is
 * the one from the week before.
 */
export function chartWeekFor(now = Date.now(), { publishHourUtc = CHART.publishHourUtc } = {}) {
  const thisMonday = mondayOf(now)
  const published = now >= thisMonday + publishHourUtc * 3600000
  return weekIdAt(thisMonday - (published ? DAY : WEEK + DAY))
}

/** When the edition for `id` goes out. */
export function publishAt(id, { publishHourUtc = CHART.publishHourUtc } = {}) {
  const r = weekRange(id)
  return r ? r.startsAt + WEEK + publishHourUtc * 3600000 : null
}

/** "14–20 September 2026" — one week, read as a person would say it. */
export function weekLabel(id) {
  const r = weekRange(id)
  if (!r) return ''
  const from = new Date(r.startsAt)
  const to = new Date(r.endsAt)
  const month = (d) => d.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })
  const sameMonth = from.getUTCMonth() === to.getUTCMonth()
  const head = sameMonth
    ? `${from.getUTCDate()}–${to.getUTCDate()} ${month(to)}`
    : `${from.getUTCDate()} ${month(from)} – ${to.getUTCDate()} ${month(to)}`
  return `${head} ${to.getUTCFullYear()}`
}

/* ------------------------------------------------------------------ *
 * A week's score
 * ------------------------------------------------------------------ */

/**
 * One day's level, from its rollup.
 *
 * Open, high, low and close averaged, rather than the close alone. The close
 * is a single 15-minute sample that happens to sit at midnight; averaging the
 * four describes the day the reader actually lived through, and costs nothing
 * because the rollup already stores them.
 */
export function dayLevel(d) {
  const parts = [d?.open, d?.high, d?.low, d?.close].filter(Number.isFinite)
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null
}

const dayMs = (day) => Date.parse(`${day}T00:00:00Z`)
const newestFirst = (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)

/** Every day of a chart week, in order, as `YYYY-MM-DD`. */
export function weekDays({ startsAt, endsAt } = {}) {
  const out = []
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) return out
  for (let t = startsAt; t <= endsAt; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

/**
 * The level a celebrity sits at when nothing in particular is happening.
 *
 * The median of their daily levels over the thirty days before this week —
 * median rather than mean so one past storm does not raise their floor for a
 * month afterwards.
 */
export function quietLevel(days = [], { startsAt } = {}) {
  const before = days
    .filter((d) => { const t = dayMs(d?.day); return Number.isFinite(t) && t < startsAt && t >= startsAt - 30 * 86400000 })
    .map(dayLevel)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  if (!before.length) return null
  const mid = before.length >> 1
  return before.length % 2 ? before[mid] : (before[mid - 1] + before[mid]) / 2
}

/**
 * A celebrity's figure for one chart week, or null if they are not eligible.
 *
 * A week is seven days long for everybody.
 *
 * This used to average only the days that had a reading, which sounds
 * innocent and is not: a name present for four loud days scored the mean of
 * those four, while a name present for all seven carried their quiet days
 * too. Four days at 62, 58, 70 and 55 charted at 61.3; seven days at a
 * steady 48 charted at 48. The spiky name won, and won BECAUSE the three
 * days they were absent cost them nothing. That is exactly "somebody got a
 * story, so they went up".
 *
 * So every day of the week is scored. A day with a reading is scored at its
 * level. A day without one is scored at that celebrity's own trailing normal,
 * damped — not at zero, which would punish an outage, and not carried forward
 * from yesterday, which would hand a spike three extra days at the top.
 *
 * `daysRan` is the set of days the pipeline itself produced anything for. A
 * day nobody was measured on is an outage, not an absence, and is left out of
 * the week for everyone so a bad Thursday does not mark down the whole chart.
 *
 * @param {Array<{day:string}>} days  the rollup's day entries
 */
export function weekScore(days = [], { startsAt, endsAt, minDays = CHART.minDays, daysRan = null, quietFactor = CHART.quietDayFactor, fallbackQuiet = 0 } = {}) {
  const inWeek = days.filter((d) => {
    const t = dayMs(d?.day)
    return Number.isFinite(t) && t >= startsAt && t <= endsAt
  })
  const measured = new Map()
  for (const d of inWeek) {
    const level = dayLevel(d)
    if (Number.isFinite(level)) measured.set(d.day, { level, day: d })
  }
  if (measured.size < minDays) return null

  const all = weekDays({ startsAt, endsAt })
    .filter((day) => (daysRan ? daysRan.has(day) : true))
  // A week with no runnable days at all is not a week; fall back to what the
  // celebrity has rather than dividing by zero.
  const span = all.length ? all : [...measured.keys()]

  const quiet = quietLevel(days, { startsAt })
  /*
   * With no history of their own, the floor cannot be their own lowest day
   * of the week — that is a number FROM the week they are being judged on,
   * so a name whose quietest loud day was 55 would have their absences
   * carried at 55 and still beat a steady name. It has to come from outside:
   * the population's own quiet level, or zero at a cold start where nobody
   * has history and every name is in the same position.
   */
  const floor = Number.isFinite(quiet) ? quiet * quietFactor : fallbackQuiet * quietFactor

  const levels = span.map((day) => measured.get(day)?.level ?? floor)
  const score = levels.reduce((a, b) => a + b, 0) / levels.length

  const highs = inWeek.map((d) => d.high).filter(Number.isFinite)
  const ranks = inWeek.map((d) => d.bestRank).filter(Number.isFinite)
  return {
    score: Math.round(score * 10) / 10,
    /** Days actually measured — the number the reader is told. */
    days: measured.size,
    /** Days the week was scored over, measured or carried. */
    span: span.length,
    quietLevel: Number.isFinite(quiet) ? Math.round(quiet * 10) / 10 : null,
    // The best they reached at any point in the week, which is a different
    // and more flattering number than the week's average — so it is labelled
    // as such wherever it is shown, and never used to rank.
    highest: highs.length ? Math.max(...highs) : null,
    bestRank: ranks.length ? Math.min(...ranks) : null,
  }
}

/**
 * What a name with no history of their own is assumed to do at rest.
 *
 * The median of everybody else's quiet level. A celebrity added on the
 * Wednesday has no trailing normal to carry their absent days at, and taking
 * one from inside the week being judged would be circular — so the
 * population stands in for them until they have a history of their own.
 */
export function populationQuiet(rollups = {}, range = {}) {
  const quiets = Object.values(rollups)
    .map((r) => quietLevel(r?.days || [], range))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  if (!quiets.length) return 0
  const mid = quiets.length >> 1
  return quiets.length % 2 ? quiets[mid] : (quiets[mid - 1] + quiets[mid]) / 2
}

/** Days on which the pipeline produced a reading for anybody at all. */
export function daysWithData(rollups = {}, range = {}) {
  const ran = new Set()
  for (const day of weekDays(range)) {
    for (const r of Object.values(rollups)) {
      if ((r?.days || []).some((d) => d?.day === day && Number.isFinite(dayLevel(d)))) { ran.add(day); break }
    }
  }
  return ran
}

/**
 * Today, as a rollup day, from the snapshots taken so far.
 *
 * The daily rollup is written at 03:00 for the day before, so the day in
 * progress exists only as intraday points. The live chart needs it or it is
 * always a day behind — and a "this week so far" that ignores today is not
 * worth refreshing.
 *
 * It must carry the SAME FIELDS as a completed rollup day, not just the
 * score. This used to return the OHLC and nothing else, which quietly
 * disabled the entire explanation on the only chart most people ever see.
 * The evidence record reads `mentions`, `sources` and `wikipediaViews` off
 * each day to work out what moved; every day of the week in progress is a
 * partial day; so every driver came back `now: null`, nothing could be
 * marked as having moved, corroboration was always 0 and every name on the
 * live chart was flagged `thin`. The chart could say a name had risen
 * fourteen places and then explain precisely nothing about why — which is
 * exactly what it did.
 *
 * Aggregated the same way `writeRollupDay` aggregates a finished day, so a
 * partial day and a complete one are read identically downstream.
 */
export function partialDay(points = [], day) {
  const today = points.filter((p) => String(p?.timestamp || '').slice(0, 10) === day)
  const scores = today.map((p) => p.gossipScore).filter(Number.isFinite)
  if (!scores.length) return null

  // Math.min of an empty list is Infinity, which is not a rank.
  const ranks = today.map((p) => p.rank).filter(Number.isFinite)

  return {
    day,
    open: scores[0],
    close: scores[scores.length - 1],
    high: Math.max(...scores),
    low: Math.min(...scores),
    /* The three the drivers are made of. */
    mentions: Math.round(today.reduce((a, p) => a + (p.mentionCount || 0), 0) / today.length),
    wikipediaViews: today[today.length - 1]?.wikipediaViews ?? null,
    // The widest the day got, not its average — same rule as a finished day.
    sources: Math.max(0, ...today.map((p) => p.uniqueSourceCount || 0)),
    countries: Math.max(0, ...today.map((p) => p.uniqueCountryCount || 0)),
    bestRank: ranks.length ? Math.min(...ranks) : null,
    samples: scores.length,
    partial: true,
  }
}

/**
 * When the week in progress freezes and becomes an edition.
 *
 * `publishAt` of the CURRENT week — the Monday that closes it — not of the
 * week after, which is a week further out and would have the countdown
 * pointing at the wrong Monday all week.
 */
export const freezeAt = (now = Date.now(), opts = {}) => publishAt(weekIdAt(now), opts)

/**
 * The week in progress, ranked the same way as a published week.
 *
 * This is the same chart, in its other state. A published edition is a
 * record; this is a running order that changes every fifteen minutes and is
 * wrong by Monday — which is the point of it. Everything a reader has to
 * learn about reading the chart they learn once and it applies to both.
 *
 * `minDays` is 1 here on purpose. A provisional standing on two days of data
 * is honest as long as it says so; the four-day bar exists to stop somebody
 * charting on a fluke in the permanent record, and nothing here is permanent.
 *
 * @param {object} input
 * @param {Array} input.rows                the market rows
 * @param {Record<string,{days:Array}>} input.rollups  completed days, plus today's partial
 * @param {object|null} input.previous      last week's PUBLISHED edition, for the move
 */
export function buildLiveChart({ rows = [], rollups = {}, previous = null, records = {}, stories = [], size = CHART.size, now = Date.now() } = {}) {
  const weekId = weekIdAt(now)
  const chart = buildChart({ weekId, rows, rollups, previous, records, stories, size, minDays: 1, now })

  return {
    ...chart,
    live: true,
    provisional: true,
    freezesAt: new Date(freezeAt(now)).toISOString(),
    // Whole days of the week that have happened, today included while it runs.
    daysCounted: Math.max(...chart.entries.map((e) => e.daysOfData), 0),
    entries: chart.entries.map((e) => ({
      ...e,
      // On a live chart nobody has finished this week yet, so weeks-on-chart
      // is what they have BANKED. Counting the week in progress would let a
      // name claim a week it might still drop out of.
      weeksOn: Math.max(0, e.weeksOn - 1),
      weeksAtOne: e.rank === 1 ? Math.max(0, e.weeksAtOne - 1) : e.weeksAtOne,
    })),
  }
}

/* ------------------------------------------------------------------ *
 * Building an edition
 * ------------------------------------------------------------------ */

const byChart = (a, b) => (
  b.score - a.score
  // Ties go to the fuller week, then to the incumbent, then to the alphabet.
  // Something has to decide, and it should not be whatever order the roster
  // happened to be in.
  || b.daysOfData - a.daysOfData
  || (a.lastWeek ?? Infinity) - (b.lastWeek ?? Infinity)
  || String(a.displayName).localeCompare(String(b.displayName))
)

/**
 * Build one week's chart.
 *
 * @param {object} input
 * @param {string} input.weekId
 * @param {Array<object>} input.rows          the current market rows — names, slugs, portraits
 * @param {Record<string, {days:Array}>} input.rollups   id → that celebrity's rollup
 * @param {object|null} input.previous        last week's edition
 * @param {object} input.records              running peak / weeks-on across all time
 * @param {Array<object>} input.stories       the feed, for the reason beside each name
 */
export function buildChart({
  weekId,
  rows = [],
  rollups = {},
  previous = null,
  records = {},
  stories = [],
  size = CHART.size,
  minDays = CHART.minDays,
  now = Date.now(),
} = {}) {
  const range = weekRange(weekId)
  if (!range) throw new Error(`not a chart week: ${weekId}`)

  const lastRank = new Map((previous?.entries || []).map((e) => [e.id, e.rank]))
  const lastEntry = new Map((previous?.entries || []).map((e) => [e.id, e]))

  /*
   * Worked out once for the whole chart, not per celebrity: which days the
   * pipeline actually ran, and what a name with no history of their own is
   * assumed to do at rest. Both are properties of the week, not of a person.
   */
  const daysRan = daysWithData(rollups, range)
  const fallbackQuiet = populationQuiet(rollups, range)

  const eligible = []
  for (const row of rows) {
    const figure = weekScore(rollups[row.id]?.days || [], { ...range, minDays, daysRan, fallbackQuiet })
    if (!figure) continue
    eligible.push({
      id: row.id,
      slug: row.slug,
      displayName: row.displayName,
      category: row.primaryCategory || null,
      score: figure.score,
      daysOfData: figure.days,
      figure,
      lastWeek: lastRank.get(row.id) ?? null,
      row,
    })
  }

  eligible.sort(byChart)
  const charted = eligible.slice(0, size)

  const entries = charted.map((c, i) => {
    const rank = i + 1
    const was = records[c.id] || {}
    const everCharted = Number.isFinite(was.peak)
    const status = !everCharted ? 'new'
      : c.lastWeek == null ? 'reentry'
        : c.lastWeek > rank ? 'up'
          : c.lastWeek < rank ? 'down' : 'same'

    return {
      rank,
      id: c.id,
      slug: c.slug,
      displayName: c.displayName,
      category: c.category,
      score: c.score,
      daysOfData: c.daysOfData,
      lastWeek: c.lastWeek,
      move: c.lastWeek == null ? null : c.lastWeek - rank,
      peak: everCharted ? Math.min(was.peak, rank) : rank,
      weeksOn: (was.weeksOn || 0) + 1,
      weeksAtOne: (was.weeksAtOne || 0) + (rank === 1 ? 1 : 0),
      status,
      // The portrait travels with the entry so an edition from two years ago
      // still renders, whatever the roster looks like by then.
      imageUrl: c.row.imageUrl ?? null,
      imageCredit: c.row.imageCredit ?? null,
      imageLicence: c.row.imageLicence ?? null,
      imageSourceUrl: c.row.imageSourceUrl ?? null,
      /*
       * Why they are where they are — worked out from the same numbers
       * that put them there, and frozen at publication so an edition from
       * two years ago still explains itself.
       *
       * This replaced a `reason` that was a story looked up by name after
       * the fact. That reason could be, and regularly was, about a
       * different event from the one that moved the rank: a name climbing
       * on search interest with no coverage at all still got captioned
       * with whichever article mentioned them last. The record below
       * cannot do that, because it is derived from the rank rather than
       * fetched alongside it. The story survives inside it as supporting
       * evidence — somewhere for a reader to go — not as the explanation.
       */
      movement: buildEvidence({
        rank,
        lastWeek: c.lastWeek,
        status,
        figure: c.figure,
        row: c.row,
        days: rollups[c.id]?.days || [],
        range,
        previousEntry: lastEntry.get(c.id) || null,
        story: storiesAbout(c.row, stories).sort(newestFirst)[0] || null,
      }),
    }
  })

  const climbers = entries.filter((e) => e.status === 'up')
  const fallers = entries.filter((e) => e.status === 'down')
  const dropped = (previous?.entries || [])
    .filter((e) => !entries.some((x) => x.id === e.id))
    .map((e) => ({ id: e.id, slug: e.slug, displayName: e.displayName, lastWeek: e.rank }))

  return {
    id: weekId,
    ...range,
    label: weekLabel(weekId),
    publishedAt: new Date(now).toISOString(),
    dueAt: new Date(publishAt(weekId)).toISOString(),
    size,
    minDays,
    // An edition built on a looser bar than the standard says so, rather than
    // passing itself off as a full week.
    provisional: minDays < CHART.minDays,
    previousId: previous?.id || null,
    entries,
    dropped,
    summary: {
      charted: entries.length,
      eligible: eligible.length,
      measured: rows.length,
      numberOne: entries[0] || null,
      newEntries: entries.filter((e) => e.status === 'new').length,
      reEntries: entries.filter((e) => e.status === 'reentry').length,
      climbers: climbers.length,
      fallers: fallers.length,
      biggestClimb: [...climbers].sort((a, b) => b.move - a.move)[0] || null,
      biggestFall: [...fallers].sort((a, b) => a.move - b.move)[0] || null,
      highestNew: entries.find((e) => e.status === 'new') || null,
      dropped: dropped.length,
    },
  }
}

/* ------------------------------------------------------------------ *
 * What the week was about
 * ------------------------------------------------------------------ */

/**
 * The week's story, worked out from the edition that has just been built.
 *
 * A chart that publishes and says "here is the chart" is a scoreboard, and a
 * scoreboard is read once. Three finished modules were already sitting behind
 * this and reachable from nothing: `insights.mjs` turns the archive into the
 * dozen figures a ranking does not carry, `lead.mjs` tests every candidate the
 * data supports and returns the strongest with the two stories under it, and
 * `milestones.mjs` supplies the records they are measured against. All that
 * was missing was somebody to call them.
 *
 * It is deliberately NOT folded into `buildChart`. A lead is a claim about a
 * finished week — "X holds number one", "the biggest climb since we started" —
 * and `buildLiveChart` runs that same builder over a week that is three days
 * old. A running order that headlines itself is precisely the confusion
 * between a standing and an edition that the two-state design exists to
 * prevent, so the report is attached where a week is published and nowhere
 * else.
 *
 * `insight` is kept beside the pick rather than thrown away, because it is the
 * only thing that makes next year's leads better than this week's: three of
 * the rules test the present against the weeks before it and can never fire
 * unless somebody kept the figures. It is a few kilobytes on a file that
 * already carries a hundred entries with their evidence.
 *
 * @param {object}       input
 * @param {object}       input.edition   the edition just built
 * @param {object|null}  input.previous  last week's edition
 * @param {object}       input.records   the running records as they stood BEFORE this edition
 * @param {Array}        input.rows      the market rows, for the attention figures
 * @param {object}       input.rollups   id → rollup, for half-lives and volatility
 * @param {Array}        input.editions  EARLIER editions, oldest first — this one is appended here
 * @param {Array}        input.history   the `insight` block of those earlier editions, oldest first
 */
export function buildReport({
  edition,
  previous = null,
  records = {},
  rows = [],
  rollups = {},
  editions = [],
  history = [],
  now = Date.now(),
} = {}) {
  // No entries is not a week with a quiet story; it is a week with no chart.
  if (!edition?.entries?.length) return { insight: null, report: null }

  const insight = insightSnapshot({
    rows,
    rollups,
    edition,
    previous,
    // Rivalries read a run of weeks in order and the swap that matters most is
    // the one that has just happened, so this week goes on the end.
    editions: [...editions, edition],
    now,
  })

  return {
    insight,
    report: pickLead({ edition, previous, records, snapshot: insight, history }),
  }
}

/**
 * The records file after an edition — peak, weeks on chart, weeks at number
 * one, for every name that has ever charted.
 *
 * Carried forward rather than recomputed from every past edition, because
 * "weeks on chart" is the number a chart is measured by and reading four
 * hundred files to answer it would be a bad way to find that out.
 */
export function nextRecords(records = {}, edition) {
  const next = { ...records }
  for (const e of edition.entries) {
    const was = next[e.id] || {}
    const improved = !Number.isFinite(was.peak) || e.rank < was.peak
    next[e.id] = {
      peak: e.peak,
      peakAt: improved ? edition.id : was.peakAt,
      weeksOn: e.weeksOn,
      weeksAtOne: e.weeksAtOne,
      firstCharted: was.firstCharted || edition.id,
      lastCharted: edition.id,
    }
  }
  return next
}

/* ------------------------------------------------------------------ *
 * Reading an edition
 * ------------------------------------------------------------------ */

/** "NEW", "RE", "+14", "−3", "—" — what goes in the move column. */
export function moveLabel(entry) {
  if (!entry) return ''
  if (entry.status === 'new') return 'NEW'
  if (entry.status === 'reentry') return 'RE'
  if (!entry.move) return '—'
  return `${entry.move > 0 ? '+' : '−'}${Math.abs(entry.move)}`
}

/** The one line a number one deserves. */
export function numberOneLine(entry) {
  if (!entry) return ''
  if (entry.weeksAtOne > 1) return `${ordinal(entry.weeksAtOne)} week at number one`
  if (entry.status === 'new') return 'Straight in at number one'
  if (entry.lastWeek && entry.lastWeek > 1) return `Up from ${ordinal(entry.lastWeek)}`
  return 'New at number one'
}

export function ordinal(n) {
  const v = Math.abs(Math.round(n))
  const tens = v % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][v % 10] || 'th'}`
}

/**
 * What this edition should be called, in one line.
 *
 * The week's own headline when it has one. "X is number one" is true every
 * week and news in about half of them: on a week whose story is a collapse,
 * a rivalry or the gap between press and public, naming the person at the top
 * describes the furniture rather than the event.
 *
 * Falls back to the number one for the editions published before the chart
 * started deciding its own lead, and for the ones that carry no report at all.
 */
export const headline = (edition) => {
  const said = leadHeadline(edition)
  if (said) return said
  const one = edition?.summary?.numberOne
  return one ? `${one.displayName} is number one on ${CHART.name}` : CHART.name
}

/**
 * The week's own headline, or null.
 *
 * Deliberately without the fallback `headline` carries, because the callers
 * that want a listing line need to know the difference: an archive row
 * already prints the number one beside it, so falling back to "X is number
 * one" would put the same fact on the row twice.
 */
export const leadHeadline = (edition) => (
  writeLead(edition?.report?.lead, { chartName: CHART.name })?.headline || null
)
