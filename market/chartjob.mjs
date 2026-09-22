/**
 * Publishing the Genie 100.
 *
 * The chart engine in chart.mjs is pure and knows nothing about storage. This
 * is the part that goes and gets things: the roster, everybody's daily
 * rollups, last week's edition, the running records, and the feed for the
 * reason beside each name. It builds one edition and writes it once.
 *
 * It is deliberately boring and deliberately idempotent. Netlify will
 * occasionally run a scheduled function twice, a deploy will occasionally
 * land mid-job, and somebody will eventually run the backfill by hand on a
 * Tuesday. None of those may change a chart that has already gone out.
 *
 * Timing: the Monday 03:00 daily job writes Sunday's rollup, and the chart
 * publishes at 13:00 the same morning. Ten hours is a comfortable margin, and
 * if the daily job did fail, the missing Sunday shows up as a six-day week
 * rather than as a wrong answer.
 */
import { createStore } from './store.mjs'
import { pool } from './pool.mjs'
import { CHART } from './config.mjs'
import {
  buildChart, buildReport, nextRecords, chartWeekFor, weekRange, weekIdAt, nextWeekId, previousWeekId,
} from './chart.mjs'

/**
 * How many earlier editions the report reads.
 *
 * The lead picker measures this week against the weeks around it — how much
 * the chart usually churns, how concentrated attention usually is, who has
 * been trading places with whom — and not one of those means anything from a
 * single edition. Eight covers the widest window any rule asks for, with
 * slack, and it is eight small reads on a job that already reads a hundred
 * rollups.
 */
const REPORT_WINDOW = 8

/**
 * Build and publish one week.
 *
 * @param {object} opts
 * @param {object} opts.blobs      the market blob store
 * @param {Array}  [opts.stories]  the published feed, for the reason beside each name
 * @param {string} [opts.weekId]   defaults to the most recent complete week
 * @param {boolean}[opts.replace]  overwrite an edition that already exists
 * @param {number} [opts.minDays]  eligibility bar; below the standard marks it provisional
 */
export async function publishChart({
  blobs,
  stories = [],
  weekId = null,
  now = Date.now(),
  minDays = CHART.minDays,
  replace = false,
  size = CHART.size,
  log = [],
} = {}) {
  const store = createStore(blobs)
  const id = weekId || chartWeekFor(now)
  if (!weekRange(id)) throw new Error(`not a chart week: ${id}`)

  const already = await store.readChart(id)
  if (already && !replace) {
    log.push(`chart ${id}: already published at ${already.publishedAt}`)
    return { id, published: false, reason: 'already published', edition: already }
  }

  const market = await store.readMarket()
  const rows = market?.rows || []
  if (!rows.length) {
    log.push(`chart ${id}: no market to chart`)
    return { id, published: false, reason: 'no market' }
  }

  /*
   * Rollups are read for the whole roster, twelve at a time — the same width
   * the ingestion run uses. A hundred small reads is a second or so; a
   * hundred sequential ones is most of a minute.
   */
  const rollups = {}
  await pool(rows, 12, async (row) => {
    rollups[row.id] = await store.readRollup(row.id)
  })

  const [previous, records] = await Promise.all([
    store.readChart(previousWeekId(id)),
    store.readChartRecords(),
  ])

  /*
   * Records are carried forward from the edition BEFORE this one. When an
   * edition is being replaced, the stored records already include its first
   * run, so they are rebuilt from the previous week's state instead of being
   * applied twice — otherwise a re-run would silently add a week to every
   * name's "weeks on chart".
   */
  const base = already ? await recordsBefore(store, id, records) : records

  const built = buildChart({
    weekId: id, rows, rollups, previous, records: base, stories, size, minDays, now,
  })

  if (!built.entries.length) {
    log.push(`chart ${id}: nobody had ${minDays} days of data — nothing published`)
    return { id, published: false, reason: 'no eligible entries', edition: built }
  }

  /*
   * What the week was ABOUT, settled before it goes out and frozen into it.
   * An edition that publishes and says "here is the chart" is a scoreboard,
   * and this is the difference between a scoreboard and a story.
   *
   * `earlier` is the weeks BEFORE this one and nothing else, which is what
   * keeps a republish honest: it reads what the first run read and reaches
   * the same verdict, rather than re-leading a two-year-old edition on
   * everything that has happened since.
   */
  const earlier = await recentEditions(store, id)
  const { insight, report } = buildReport({
    edition: built,
    previous,
    records: base,
    rows,
    rollups,
    editions: earlier,
    history: earlier.map((e) => e.insight).filter(Boolean),
    now,
  })
  const edition = { ...built, insight, report }

  const result = await store.publishChart(edition, nextRecords(base, edition), { replace })
  log.push(
    `chart ${id}: ${edition.summary.charted} entries`
    + `, number one ${edition.summary.numberOne?.displayName || '—'}`
    + `, ${edition.summary.newEntries} new`
    + `${report?.lead ? `, leading on ${report.lead.kind}` : ''}`
    + `${result.replaced ? ' (replaced)' : ''}`,
  )
  return { id, published: result.written, edition, ...result }
}

/**
 * The editions immediately before `id`, oldest first.
 *
 * Oldest first because rivalries read a run of weeks in order, and the run has
 * to end with the week being published for this week's swap to count.
 */
async function recentEditions(store, id) {
  const index = await store.readChartIndex()
  const wanted = (index.editions || [])
    .filter((e) => e.id < id)
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(-REPORT_WINDOW)
  const found = await Promise.all(wanted.map((e) => store.readChart(e.id)))
  return found.filter(Boolean)
}

/**
 * The records as they stood before `id` was first published.
 *
 * Rebuilt by replaying every earlier edition, which is only reachable when
 * somebody is deliberately republishing a week — rare, and worth the reads to
 * get right rather than leaving a double-counted week in the history.
 */
async function recordsBefore(store, id, fallback) {
  const index = await store.readChartIndex()
  const earlier = index.editions.filter((e) => e.id < id).sort((a, b) => a.id.localeCompare(b.id))
  if (!earlier.length) return {}
  let records = {}
  for (const entry of earlier) {
    const edition = await store.readChart(entry.id)
    if (!edition) return fallback
    records = nextRecords(records, edition)
  }
  return records
}

/**
 * Fill in every week we have the data for, oldest first.
 *
 * For the launch, and for the day somebody notices a Monday was missed. It
 * never touches a week that already has an edition, so running it twice is
 * free, and it stops at the most recent complete week.
 */
export async function backfillCharts({ blobs, stories = [], from = null, now = Date.now(), minDays = CHART.minDays, log = [] } = {}) {
  const store = createStore(blobs)
  const market = await store.readMarket()
  const rows = market?.rows || []
  if (!rows.length) { log.push('backfill: no market'); return { weeks: [] } }

  // How far back the data itself goes: the earliest day anyone has a rollup
  // for. There is no point asking for a chart of a week nobody was measured in.
  const firstDays = await pool(rows, 12, async (row) => (await store.readRollup(row.id)).days?.[0]?.day || null)
  const earliest = firstDays.filter(Boolean).sort()[0]
  if (!earliest) { log.push('backfill: no rollups yet'); return { weeks: [] } }

  const last = chartWeekFor(now)
  let id = from || weekIdOf(earliest)
  const weeks = []
  // 520 weeks is ten years — a bound so a bad `from` cannot loop forever.
  for (let i = 0; i < 520 && id <= last; i++) {
    const result = await publishChart({ blobs, stories, weekId: id, now, minDays, log })
    weeks.push({ id, published: result.published, reason: result.reason || null })
    id = nextWeekId(id)
    if (!id) break
  }
  return { weeks, from: from || weekIdOf(earliest), to: last }
}

/** `2026-09-14` → the chart week that day sits in. */
const weekIdOf = (day) => {
  const t = Date.parse(`${day}T12:00:00Z`)
  return Number.isFinite(t) ? weekIdAt(t) : null
}
