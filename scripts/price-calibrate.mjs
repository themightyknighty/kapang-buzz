#!/usr/bin/env node
/**
 * What the price model actually does to your real names.
 *
 * The constants in PRICE were chosen from first principles, not fitted —
 * when they were written the market had four days of history and most of the
 * roster was on zero. Fitting to that would have been theatre. This runs the
 * model over whatever history exists and prints its behaviour, so the
 * constants can be argued about with evidence as the weeks accumulate.
 *
 *   npm run market:once                       # fill .market-data first
 *   node scripts/price-calibrate.mjs
 *   node scripts/price-calibrate.mjs --k 0.3 --max-move 0.12
 *   node scripts/price-calibrate.mjs --csv out/prices.csv
 *
 * What to look at, in order of how much it matters:
 *
 *   SPREAD        the gap between the best and worst performer. Too narrow
 *                 and nobody's portfolio choices mattered; too wide and one
 *                 lucky pick decides the season.
 *   CAPPED DAYS   how often maxMove binds. Often means the cap, not the
 *                 model, is setting your prices — turn k down instead.
 *   DEAD NAMES    names whose price never moved. These are unbuyable and
 *                 make the market feel small.
 *   DRAG          volatility drag: what an erratic name loses against a
 *                 steady one on the same mean. A known, intended property —
 *                 but if it is enormous, every volatile name is a trap.
 */
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { priceSeries } from '../market/price.mjs'
import { PRICE } from '../market/config.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = process.env.MARKET_DIR || join(ROOT, '.market-data')

const argv = process.argv.slice(2)
const value = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
// Number(null) is 0, and 0 is finite — so reading an absent flag this way
// silently set every constant to zero and printed a table of noughts.
const numArg = (n, d) => {
  const raw = value(n)
  if (raw == null) return d
  const v = Number(raw)
  return Number.isFinite(v) ? v : d
}

const opts = {
  k: numArg('--k', PRICE.k),
  maxMove: numArg('--max-move', PRICE.maxMove),
  smoothing: numArg('--smoothing', PRICE.smoothing),
  window: numArg('--window', PRICE.baselineDays),
}

/** A day's level, the same way the chart reads one: the mean of its OHLC. */
const levelOf = (d) => {
  const v = [d?.open, d?.high, d?.low, d?.close].filter(Number.isFinite)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

const read = async (path) => {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { return null }
}

/** Every name's rollup, from the local store the pipeline writes. */
async function histories() {
  const out = new Map()
  let dirs = []
  try { dirs = await readdir(join(DATA, 'rollup')) } catch { dirs = [] }
  for (const file of dirs) {
    if (!file.endsWith('.json')) continue
    const roll = await read(join(DATA, 'rollup', file))
    const days = (roll?.days || [])
      .map((d) => ({ day: d.day, level: levelOf(d) }))
      .filter((d) => d.day && Number.isFinite(d.level))
      .sort((a, b) => (a.day < b.day ? -1 : 1))
    if (days.length) out.set(roll.id || file.replace(/\.json$/, ''), days)
  }
  return out
}

const pct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`
const bar = (share, width = 24) => '█'.repeat(Math.round(share * width)).padEnd(width, '·')

const h = await histories()
if (!h.size) {
  console.log(`No rollups under ${DATA}.`)
  console.log('Fill it first:  npm run market:once')
  process.exit(1)
}

const rows = []
for (const [id, days] of h) {
  const s = priceSeries(days, opts)
  if (s.length < 2) continue
  const moves = s.slice(1).map((p) => p.change)
  const capped = moves.filter((m) => Math.abs(m) >= opts.maxMove * 100 - 0.05).length
  const vol = Math.sqrt(moves.reduce((a, m) => a + m * m, 0) / moves.length)
  rows.push({
    id,
    days: s.length,
    list: s[0].price,
    end: s[s.length - 1].price,
    ret: ((s[s.length - 1].price - s[0].price) / s[0].price) * 100,
    capped,
    moves: moves.length,
    vol,
    dead: moves.every((m) => m === 0),
  })
}
rows.sort((a, b) => b.ret - a.ret)

const totalMoves = rows.reduce((a, r) => a + r.moves, 0)
const totalCapped = rows.reduce((a, r) => a + r.capped, 0)
const dead = rows.filter((r) => r.dead)
const spread = rows.length ? rows[0].ret - rows[rows.length - 1].ret : 0

console.log(`\n  k ${opts.k}   maxMove ${opts.maxMove}   smoothing ${opts.smoothing}   window ${opts.window}`)
console.log(`  ${rows.length} names, ${rows[0]?.days ?? 0} days at most\n`)

console.log('  BEST')
for (const r of rows.slice(0, 5)) console.log(`    ${r.id.padEnd(24)} ${String(r.list).padStart(6)} → ${String(r.end).padStart(7)}   ${pct(r.ret).padStart(9)}`)
console.log('  WORST')
for (const r of rows.slice(-5).reverse()) console.log(`    ${r.id.padEnd(24)} ${String(r.list).padStart(6)} → ${String(r.end).padStart(7)}   ${pct(r.ret).padStart(9)}`)

console.log(`\n  SPREAD       ${pct(spread)} between best and worst`)
console.log(`  CAPPED DAYS  ${totalCapped}/${totalMoves} (${((totalCapped / Math.max(1, totalMoves)) * 100).toFixed(1)}%)  ${bar(totalCapped / Math.max(1, totalMoves))}`)
console.log(`  DEAD NAMES   ${dead.length}/${rows.length}  ${bar(dead.length / Math.max(1, rows.length))}`)
console.log(`  MEDIAN VOL   ${(rows.map((r) => r.vol).sort((a, b) => a - b)[rows.length >> 1] || 0).toFixed(2)}% a day`)

/*
 * Volatility drag, measured rather than asserted: the same mean attention,
 * delivered steadily and erratically, and the gap between where they end.
 */
const mean = 40
const steady = priceSeries(Array.from({ length: 60 }, (_, i) => ({ day: `2026-01-${String(i + 1).padStart(2, '0')}`, level: mean })), opts)
const erratic = priceSeries(Array.from({ length: 60 }, (_, i) => ({ day: `2026-01-${String(i + 1).padStart(2, '0')}`, level: i % 2 ? mean * 0.25 : mean * 1.75 })), opts)
const drag = ((erratic[erratic.length - 1].price - steady[steady.length - 1].price) / steady[steady.length - 1].price) * 100
console.log(`  DRAG         ${pct(drag)} for an erratic name against a steady one on the same mean\n`)

const csv = value('--csv')
if (csv) {
  await mkdir(dirname(join(ROOT, csv)), { recursive: true })
  const lines = ['id,days,list,end,return_pct,capped_days,vol_pct']
  for (const r of rows) lines.push([r.id, r.days, r.list, r.end, r.ret.toFixed(2), r.capped, r.vol.toFixed(2)].join(','))
  await writeFile(join(ROOT, csv), `${lines.join('\n')}\n`)
  console.log(`  written to ${csv}\n`)
}
