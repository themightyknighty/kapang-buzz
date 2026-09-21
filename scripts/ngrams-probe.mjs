#!/usr/bin/env node
/**
 * Find out what GDELT's ngram feed actually serves us.
 *
 * The DOC API refuses us at any pace, and its own 429 points here. Before
 * building an adapter on top of this, we need three facts: which URL pattern
 * is live, how big a file is, and whether celebrity names are findable in it.
 *
 *   node scripts/ngrams-probe.mjs
 */
import { gunzipSync } from 'node:zlib'

const pad = (n) => String(n).padStart(2, '0')
const stamp = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`

// Files land a couple of minutes behind, so walk back from "a few minutes ago".
const minutesAgo = (m) => new Date(Date.now() - m * 60000)

const PATTERNS = [
  ['webngrams 3.0 (JSON)', (s) => `https://data.gdeltproject.org/gdeltv3/webngrams/${s}.webngrams.json.gz`],
  ['weblegacy ngrams (TSV)', (s) => `https://data.gdeltproject.org/gdeltv5/weblegacy/ngrams/${s}.ngrams.txt.gz`],
]

const NAMES = ['Taylor Swift', 'Zendaya', 'Pedro Pascal', 'Dwayne Johnson', 'Bad Bunny']

async function grab(url) {
  const started = Date.now()
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'GossipGenie-Market/0.1 (contact simon@knightvisionstudios.tv)' } })
    if (!res.ok) return { url, status: res.status, ms: Date.now() - started }
    const buf = Buffer.from(await res.arrayBuffer())
    return { url, status: 200, ms: Date.now() - started, gz: buf.length, buf }
  } catch (err) {
    return { url, status: null, ms: Date.now() - started, error: err.message }
  }
}

console.log('Probing GDELT ngram files. Nothing here is rate limited — these are static files.\n')

let winner = null
for (const [label, build] of PATTERNS) {
  for (const back of [3, 4, 5, 6, 8, 12]) {
    const r = await grab(build(stamp(minutesAgo(back))))
    const size = r.gz ? `${(r.gz / 1048576).toFixed(2)} MB gzipped` : '—'
    console.log(`${r.status === 200 ? '✓' : '·'} ${label.padEnd(24)} ${back}m ago  HTTP ${r.status ?? 'no response'}  ${size}${r.error ? '  ' + r.error : ''}`)
    if (r.status === 200 && r.gz > 1000) { winner = { label, ...r }; break }
  }
  if (winner) break
}

if (!winner) {
  console.log('\nNo ngram file came back. Either the URL pattern has moved or this host is unreachable from here.')
  process.exit(1)
}

const text = gunzipSync(winner.buf).toString('utf8')
const lines = text.split('\n').filter(Boolean)
console.log(`\n── ${winner.label}`)
console.log(`   ${winner.url}`)
console.log(`   ${(winner.gz / 1048576).toFixed(2)} MB gzipped → ${(text.length / 1048576).toFixed(1)} MB raw · ${lines.length.toLocaleString()} lines · fetched in ${winner.ms}ms\n`)

console.log('   First two lines, verbatim:')
for (const l of lines.slice(0, 2)) console.log('   │ ' + l.slice(0, 220))

console.log('\n   Celebrity names found in this ONE minute of global news:')
for (const name of NAMES) {
  const hits = lines.filter((l) => l.toLowerCase().includes(name.toLowerCase()))
  const urls = new Set()
  for (const h of hits) {
    try { const j = JSON.parse(h); if (j.url) urls.add(new URL(j.url).hostname) } catch { /* TSV, not JSON */ }
  }
  console.log(`   ${name.padEnd(16)} ${String(hits.length).padStart(4)} matching lines${urls.size ? ` · ${urls.size} distinct publishers` : ''}`)
  if (hits[0]) console.log(`       e.g. ${hits[0].slice(0, 170)}`)
}
