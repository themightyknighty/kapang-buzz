#!/usr/bin/env node
/**
 * Run the market from your own machine instead of from Netlify.
 *
 * Two reasons this exists. First, it is how the model gets tuned: a run here
 * costs nothing but time and writes to a local folder you can inspect.
 * Second, GDELT rate-limits by IP, and Netlify's egress IPs are shared with
 * everyone else on the platform — so if the scheduled runs keep getting 429s,
 * this same code run from a machine with its own IP is the fallback, and it
 * can push its results to the live site.
 *
 *   node scripts/market-local.mjs --probe        ONE raw GDELT call, verbatim
 *   node scripts/market-local.mjs --limit 10      a quick 10-celebrity test
 *   node scripts/market-local.mjs                 one shard, to ./.market-data
 *   node scripts/market-local.mjs --all           the whole roster
 *   node scripts/market-local.mjs --daily         the daily job as well
 *   node scripts/market-local.mjs --mock          no network at all
 *   node scripts/market-local.mjs --all --push    also publish to the live site
 *
 * A sweep is paced at one GDELT call every 8 seconds, so it is slow on
 * purpose. Start with --limit 10 to see whether your IP is rate-limited
 * before committing half an hour to a full run.
 *
 * --push needs SYNC_TOKEN and SITE_URL in the environment.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { runMarket, runDaily } from '../market/run.mjs'
import { mockMarket } from '../market/mock.mjs'
import { activeRoster } from '../market/roster.mjs'
import { probe } from '../market/adapters/news.mjs'

const DIR = process.env.MARKET_DIR || '.market-data'
const argv = process.argv.slice(2)
const args = new Set(argv)
const flagValue = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null }
const limit = Number(flagValue('--limit')) || null

/** The same tiny interface the Netlify store implements, backed by files. */
const fileBlobs = {
  async getJSON(key) {
    try { return JSON.parse(await readFile(join(DIR, key), 'utf8')) } catch { return null }
  },
  async setJSON(key, value) {
    const path = join(DIR, key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(value, null, 2))
  },
}

const fullRoster = activeRoster()
const roster = limit ? fullRoster.slice(0, limit) : fullRoster

// Print each line as it happens rather than hoarding them until the end.
const log = []
const pushLog = log.push.bind(log)
log.push = (...lines) => { for (const l of lines) console.log('  ·', l); return pushLog(...lines) }

if (args.has('--probe')) {
  // No retries, no backoff, no interpretation — just what GDELT sends back,
  // across several query shapes, so we can see which one it actually answers.
  const who = fullRoster.find((c) => c.slug === (flagValue('--probe') || '')) || fullRoster[0]
  const name = who.displayName
  const cases = [
    ['as the adapter builds it', 'timelinevolraw', null],
    ['no language filter', 'timelinevolraw', `"${name}"`],
    ['bare name, unquoted', 'timelinevolraw', name],
    ['article list', 'artlist', `"${name}"`],
  ]
  console.log(`Probing GDELT for ${name} — one call every 12s, no retries.\n`)
  for (const [label, mode, query] of cases) {
    const r = await probe(who, { mode, query })
    const verdict = r.status === 429 ? 'RATE LIMITED'
      : r.status !== 200 ? `HTTP ${r.status ?? 'no response'}`
        : (r.bytes ?? 0) <= 2 ? 'EMPTY — query matched nothing'
          : 'DATA'
    console.log(`── ${label}  [${verdict}]`)
    console.log(`   ${r.url}`)
    console.log(`   HTTP ${r.status ?? '—'} · ${r.ms}ms · ${r.bytes ?? 0} bytes${r.error ? ` · ${r.error}` : ''}`)
    console.log('   │ ' + (r.body || '(empty)').replace(/\s+/g, ' ').slice(0, 200))
    console.log('')
    await new Promise((s) => setTimeout(s, 12000))
  }
  process.exit(0)
}

if (args.has('--mock')) {
  const market = mockMarket({ now: Date.now() })
  await fileBlobs.setJSON('market/current.json', market)
  console.log(`mock market written to ${DIR}/market/current.json — ${market.rows.length} rows, flagged mock:true`)
  process.exit(0)
}

const started = Date.now()
const shard = (args.has('--all') || limit) ? null : Number(process.env.MARKET_SHARD || 0)
console.log(`Gossip Genie — Celebrity Market`)
console.log(`${roster.length} celebrities${limit ? ` (limited from ${fullRoster.length})` : ''}, ${shard == null ? 'all in one pass' : `shard ${shard}`}.`)
console.log('Reading the newest GDELT GKG window — one 6 MB file, not rate limited.\n')

// One line for the file, since every celebrity comes out of the same pass.
const onProgress = ({ file, bytes, articles, matched, total, seconds }) => {
  console.log(`  ${file} · ${(bytes / 1048576).toFixed(1)} MB · ${articles.toLocaleString()} articles → ${matched}/${total} celebrities in this window (${seconds}s)`)
}

const market = args.has('--daily')
  ? await runDaily({ blobs: fileBlobs, roster, log })
  : await runMarket({ blobs: fileBlobs, shard, roster, log, onProgress })

const top = market.rows.slice(0, 12)
console.log('\nRANK  CELEBRITY              SCORE    CHG  MENTIONS  MOM   STATUS')
for (const r of top) {
  console.log(
    String(r.rank).padStart(4),
    r.displayName.padEnd(22).slice(0, 22),
    r.gossipScore.toFixed(1).padStart(6),
    (r.change24h == null ? '—' : r.change24h.toFixed(1)).padStart(6),
    String(r.mentions).padStart(8),
    r.momentum.toFixed(0).padStart(5),
    ' ' + r.status,
  )
}

const measured = market.rows.filter((r) => r.sources.news.freshnessSeconds === 0).length
const withHistory = market.rows.filter((r) => r.mentions > 0).length
console.log(`\n${measured} celebrities appeared in this window · ${withHistory} have coverage in the rolling day · ${market.run.calls} requests · ${Math.round((Date.now() - started) / 1000)}s`)
console.log(`Written to ${DIR}/`)
console.log('\nOne window is a tick, not a measurement — a 15-minute file holds ~1,400')
console.log('articles, so most of the roster appears in none of any single one. Run this')
console.log('every 15 minutes and the rolling day fills in; the first full day is a warm-up.')

const failures = Object.entries(market.health || {}).filter(([, h]) => !h.ok)
if (failures.length) {
  console.log('\nSources reporting failure:')
  for (const [k, h] of failures) console.log(`  ${k}: ${h.errors?.[0]?.error ?? 'unknown'}`)
}

if (args.has('--push')) {
  const site = process.env.SITE_URL, token = process.env.SYNC_TOKEN
  if (!site || !token) {
    console.error('\n--push needs SITE_URL and SYNC_TOKEN in the environment.')
    process.exit(1)
  }
  const res = await fetch(`${site}/.netlify/functions/market-publish`, {
    method: 'POST',
    headers: { 'x-sync-token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify(market),
  })
  console.log(res.ok ? '\nPushed to the live site.' : `\nPush failed: HTTP ${res.status}`)
}
