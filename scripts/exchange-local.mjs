#!/usr/bin/env node
/**
 * Open the Genie Exchange on a laptop.
 *
 * The chart had `chart-local.mjs` and the exchange had nothing, so the one
 * screen in the app whose whole claim is that it is live was the one screen
 * that could not be run locally at all: `/api/exchange` is not served in dev
 * and no local command ever wrote a book. Anybody working on it was looking
 * at "The exchange is not answering."
 *
 *   npm run market:mock            # a roster and rollups to price
 *   node scripts/exchange-local.mjs
 *   node scripts/exchange-local.mjs --refresh   # move the indicative quotes on
 *
 * Nothing here talks to the live site. On the real store the ingestion run
 * does this itself every fifteen minutes.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStore, dayKey } from '../market/store.mjs'
import { settlePrices, refreshBoard } from '../market/run.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, '.market-data')
const argv = process.argv.slice(2)

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

const store = createStore(fileBlobs())
const market = await store.readMarket()
const rows = market?.rows || []
if (!rows.length) {
  console.error('No market in .market-data — run `npm run market:mock` first.')
  process.exit(1)
}

const log = []
const now = Date.now()

if (argv.includes('--refresh')) {
  await refreshBoard(store, { rows, histories: new Map(), now, log })
} else {
  await settlePrices(store, { rows, upTo: dayKey(now - 86400000), log })
  await refreshBoard(store, { rows, histories: new Map(), now, log })
}
for (const line of log) console.log(' ', line)

const board = await store.readPriceBoard()
const names = board?.names || []
console.log('─'.repeat(64))
console.log(`  THE GENIE EXCHANGE   ${names.length} listed   settled ${board?.settledOn || '—'}`)
console.log('─'.repeat(64))
for (const [i, r] of names.slice(0, 12).entries()) {
  const chg = Number.isFinite(r.change) ? `${r.change > 0 ? '+' : ''}${r.change.toFixed(1)}%` : '—'
  console.log(
    `  ${String(i + 1).padStart(3)}. ${String(r.displayName).padEnd(26).slice(0, 26)}`
    + ` G$${Number(r.price).toFixed(2).padStart(9)} ${chg.padStart(7)}${r.settled ? '' : '  ·indicative'}`,
  )
}
if (names.length > 12) console.log(`  … and ${names.length - 12} more`)
