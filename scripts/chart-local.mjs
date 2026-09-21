#!/usr/bin/env node
/**
 * Build the Genie 100 on a laptop, from whatever `npm run market:once` wrote.
 *
 * The live chart publishes itself every Monday. This is for looking at one
 * before it does — checking that a week's numbers produce a chart anybody
 * would recognise, and for the launch, when there are weeks of data sitting
 * in the store and no editions written from them yet.
 *
 *   npm run market:once            # fill .market-data/ first
 *   node scripts/chart-local.mjs                 # the last complete week
 *   node scripts/chart-local.mjs --week 2026-W38
 *   node scripts/chart-local.mjs --backfill      # every week the data covers
 *   node scripts/chart-local.mjs --min-days 2    # a provisional soft launch
 *   node scripts/chart-local.mjs --json out.json # write the edition out
 *
 * Nothing here talks to the live site. To publish on the real store, run the
 * job there:
 *
 *   SYNC_TOKEN=$(netlify env:get SYNC_TOKEN)
 *   curl -X POST -H "x-sync-token: $SYNC_TOKEN" \
 *     "https://<site>/.netlify/functions/market-run-background?chart=1&backfill=1"
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { publishChart, backfillCharts } from '../market/chartjob.mjs'
import { moveLabel, numberOneLine, weekLabel } from '../market/chart.mjs'
import { CHART } from '../market/config.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, '.market-data')
const FEED = join(ROOT, '.data/feed.json')

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const value = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }

/** The same tiny store interface the pipeline expects, over a folder. */
const fileBlobs = () => ({
  async getJSON(key) {
    try { return JSON.parse(await readFile(join(DATA, key), 'utf8')) } catch { return null }
  },
  async setJSON(key, value) {
    const path = join(DATA, key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(value, null, 2))
  },
})

const bar = (s = '─') => console.log(s.repeat(64))

function show(edition) {
  const { summary } = edition
  bar('═')
  console.log(`  ${CHART.name.toUpperCase()}   ${weekLabel(edition.id)}   ${edition.id}`)
  if (edition.provisional) console.log(`  provisional — built on ${edition.minDays} days, not ${CHART.minDays}`)
  bar('═')

  const one = summary.numberOne
  if (one) console.log(`\n  1. ${one.displayName}  ${one.score}   ${numberOneLine(one)}\n`)

  for (const e of edition.entries.slice(1, 20)) {
    const move = moveLabel(e).padStart(4)
    const why = e.reason?.headline || (e.reason?.kind === 'coverage' ? e.reason.text : '')
    console.log(
      `  ${String(e.rank).padStart(3)}. ${e.displayName.padEnd(26).slice(0, 26)}`
      + ` ${String(e.score).padStart(5)} ${move}`
      + `${e.weeksOn > 1 ? `  ${e.weeksOn}w` : '    '}`
      + `${why ? `  ${why.slice(0, 40)}` : ''}`,
    )
  }
  if (edition.entries.length > 20) console.log(`  … and ${edition.entries.length - 20} more`)

  bar()
  console.log(
    `  ${summary.charted} charted of ${summary.eligible} eligible, ${summary.measured} measured`
    + `\n  ${summary.newEntries} new · ${summary.reEntries} re-entries`
    + ` · ${summary.climbers} up · ${summary.fallers} down · ${summary.dropped} out`,
  )
  if (summary.biggestClimb) console.log(`  biggest climb: ${summary.biggestClimb.displayName} ${moveLabel(summary.biggestClimb)}`)
  if (summary.highestNew) console.log(`  highest new entry: ${summary.highestNew.displayName} at ${summary.highestNew.rank}`)
  bar()
}

const run = async () => {
  const blobs = fileBlobs()
  if (!(await blobs.getJSON('market/current.json'))) {
    console.error('\n  No local market. Run `npm run market:once` first.\n')
    process.exit(1)
  }

  let stories = []
  try { stories = JSON.parse(await readFile(FEED, 'utf8')).stories || [] } catch { /* no local feed */ }
  if (!stories.length) console.log('  (no local feed — names will chart without a reason beside them)')

  const minDays = Number(value('--min-days')) || CHART.minDays
  const log = []
  const opts = { blobs, stories, minDays, log, replace: flag('--replace') }

  if (flag('--backfill')) {
    const out = await backfillCharts({ ...opts, from: value('--week') })
    for (const line of log) console.log(`  ${line}`)
    const published = out.weeks.filter((w) => w.published)
    console.log(`\n  ${published.length} of ${out.weeks.length} weeks published (${out.from} → ${out.to})\n`)
    if (published.length) show((await publishChart({ blobs, weekId: published.at(-1).id })).edition)
    return
  }

  const out = await publishChart({ ...opts, weekId: value('--week') })
  for (const line of log) console.log(`  ${line}`)
  if (!out.edition) { console.error(`\n  Nothing to show: ${out.reason}\n`); process.exit(1) }
  show(out.edition)

  const jsonPath = value('--json')
  if (jsonPath) {
    await writeFile(jsonPath, JSON.stringify(out.edition, null, 2))
    console.log(`  wrote ${jsonPath}`)
  }
}

run().catch((err) => { console.error(err); process.exit(1) })
