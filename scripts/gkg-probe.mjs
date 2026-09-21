#!/usr/bin/env node
/**
 * Test GDELT's Global Knowledge Graph instead of the ngrams.
 *
 * The ngram files are 42 MB gzipped for ONE MINUTE of news, and quadgrams
 * mean matching names in raw text. The GKG is the purpose-built alternative:
 * one file per 15 minutes covering the whole window, with a V2Persons column
 * holding the people an article is about, already extracted.
 *
 * GDELT publishes the current file list at lastupdate.txt, so there is no
 * guessing at timestamps.
 *
 *   node scripts/gkg-probe.mjs
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync, statSync, rmSync } from 'node:fs'

const UA = 'GossipGenie-Market/0.1 (contact simon@knightvisionstudios.tv)'
const NAMES = ['Taylor Swift', 'Zendaya', 'Pedro Pascal', 'Dwayne Johnson', 'Bad Bunny', 'Timothee Chalamet']

console.log('Asking GDELT which files are current — no guessing at timestamps.\n')
const res = await fetch('http://data.gdeltproject.org/gdeltv2/lastupdate.txt', { headers: { 'User-Agent': UA } })
if (!res.ok) { console.log(`lastupdate.txt → HTTP ${res.status}`); process.exit(1) }
const listing = (await res.text()).trim()

console.log('── current files')
const files = listing.split('\n').map((l) => {
  const [bytes, hash, url] = l.trim().split(/\s+/)
  console.log(`   ${(Number(bytes) / 1048576).toFixed(1).padStart(6)} MB  ${url.split('/').pop()}`)
  return { bytes: Number(bytes), url }
})

const gkg = files.find((f) => f.url.includes('.gkg.'))
if (!gkg) { console.log('\nNo GKG file in the listing.'); process.exit(1) }

console.log(`\n── downloading ${gkg.url.split('/').pop()} (${(gkg.bytes / 1048576).toFixed(1)} MB zipped)`)
const started = Date.now()
const buf = Buffer.from(await (await fetch(gkg.url, { headers: { 'User-Agent': UA } })).arrayBuffer())
writeFileSync('/tmp/gkg.zip', buf)
console.log(`   ${(buf.length / 1048576).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(1)}s`)

// Stream through unzip rather than holding the whole CSV in a string —
// that is what broke the ngram probe.
const raw = execFileSync('unzip', ['-p', '/tmp/gkg.zip'], { maxBuffer: 1024 * 1024 * 1024 })
console.log(`   ${(raw.length / 1048576).toFixed(1)} MB unzipped`)

const rows = raw.toString('latin1').split('\n').filter(Boolean)
console.log(`   ${rows.length.toLocaleString()} articles in this 15-minute window\n`)

// V2Persons is column 12 (0-indexed) in the GKG 2.1 layout.
const PERSONS_COL = 11
const sample = rows[0].split('\t')
console.log(`── layout check: ${sample.length} tab-separated columns`)
console.log(`   col ${PERSONS_COL} of the first row: ${(sample[PERSONS_COL] || '').slice(0, 160) || '(empty)'}\n`)

console.log('── celebrities found in ONE 15-minute window')
for (const name of NAMES) {
  const needle = name.toLowerCase()
  let articles = 0
  const domains = new Set()
  for (const row of rows) {
    const cols = row.split('\t')
    const persons = (cols[PERSONS_COL] || '').toLowerCase()
    if (!persons.includes(needle)) continue
    articles++
    try { domains.add(new URL(cols[4]).hostname.replace(/^www\./, '')) } catch { /* no url */ }
  }
  console.log(`   ${name.padEnd(20)} ${String(articles).padStart(4)} articles · ${String(domains.size).padStart(3)} publishers`)
}

rmSync('/tmp/gkg.zip', { force: true })
console.log('\nOne file. Every celebrity. No per-celebrity calls.')
