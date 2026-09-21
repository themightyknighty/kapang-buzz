#!/usr/bin/env node
/**
 * Timing audit for the Watch channel.
 *
 * The layout audit walks the show a segment at a time and checks nothing is
 * clipped. It cannot see the fault this one is for: a show whose every frame
 * is correct and which runs at the wrong speed. That happened — the join
 * offset was applied to every segment rather than to the one segment that was
 * joined, so the channel put a chart position on air for a third of a second
 * and wiped again, and no static check noticed.
 *
 * So this one watches the channel for a few minutes and times it:
 *
 *   - every segment gets the airtime its running order says it gets
 *   - a handover costs what showclock.js charges for one
 *
 * Both matter to the same thing. The live position is arithmetic over stated
 * durations plus HANDOVER_SECONDS; if the real show disagrees with either,
 * every viewer joins somewhere the channel is not.
 *
 *   node scripts/watch-timing-audit.mjs
 *   node scripts/watch-timing-audit.mjs --route vertical
 *   node scripts/watch-timing-audit.mjs --ms 360000     watch for longer
 *
 * Needs the dev server (npm run dev, or pass --url) and Playwright, which is
 * deliberately NOT a dependency of this project:
 *
 *   npm i --no-save playwright && npx playwright install chromium
 */
import { chromium } from 'playwright'
import { HANDOVER_SECONDS } from '../src/lib/showclock.js'

const argv = process.argv.slice(2)
const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const BASE = val('--url', 'http://localhost:5173')
const ROUTE = val('--route', 'watch')
const RUN_MS = Number(val('--ms', 210000))

/*
 * Timed at speed 1, deliberately.
 *
 * ?speed scales the segments and the wipe's hold but not its sweeps, so a fast
 * run distorts exactly the ratio being measured. The audit is slow because the
 * thing it audits is.
 */
const SPEED = 1
/** A segment may miss its mark by this much before it is a fault. */
const SEG_TOLERANCE = 1.2
/** A handover may miss HANDOVER_SECONDS by this much. */
const HANDOVER_TOLERANCE = 0.25

/**
 * Recorded from inside the page, because what is wanted is what a viewer sees:
 * when the wipe covers the screen and when the segment behind it changes.
 */
const PROBE = `
window.__log = []
window.__t0 = Date.now()
let last = { wipe: 'none', type: '', dur: '' }
setInterval(() => {
  const w = document.querySelector('.k-wipe')
  const wipe = w ? (w.classList.contains('in') ? 'in' : w.classList.contains('out') ? 'out' : 'on') : 'none'
  const stage = document.querySelector('.w-stage')
  const type = stage?.dataset.seg || ''
  const dur = stage?.dataset.dur || ''
  if (wipe !== last.wipe || type !== last.type || dur !== last.dur) {
    window.__log.push({ at: Date.now() - window.__t0, wipe, type, dur: Number(dur) })
    last = { wipe, type, dur }
  }
}, 20)
`

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await b.newPage({ viewport: { width: 1280, height: 720 } })
await page.addInitScript(PROBE)
await page.goto(`${BASE}/${ROUTE}?speed=${SPEED}`, { waitUntil: 'networkidle' })
process.stdout.write(`watching ${ROUTE} for ${Math.round(RUN_MS / 1000)}s…\n`)
await page.waitForTimeout(RUN_MS)
const log = await page.evaluate('window.__log')
await b.close()

/* Each wipe is one episode: the frame it appears to the frame it is gone. */
const wipes = []
let open = null
for (const e of log) {
  if (e.wipe !== 'none' && !open) open = e
  if (e.wipe === 'none' && open) { wipes.push({ from: open.at, to: e.at }); open = null }
}

const found = []

if (wipes.length < 3) {
  found.push({ kind: 'stalled', line: `only ${wipes.length} handovers in ${Math.round(RUN_MS / 1000)}s — the show is not running` })
}

for (const w of wipes) {
  const secs = (w.to - w.from) / 1000
  if (Math.abs(secs - HANDOVER_SECONDS) > HANDOVER_TOLERANCE) {
    found.push({ kind: 'handover', line: `a handover took ${secs.toFixed(2)}s, showclock charges ${HANDOVER_SECONDS}s` })
  }
}

/*
 * A segment's airtime is the gap between one wipe clearing and the next
 * starting, and what it should be is whatever the running order booked it
 * for — which the stage carries on itself, so the audit compares the show
 * against its own rundown rather than against a copy of the durations table
 * that would go stale the first time anyone retimed a segment.
 */
const airtimes = []
for (let i = 0; i < wipes.length - 1; i++) {
  const secs = (wipes[i + 1].from - wipes[i].to) / 1000
  const on = log.find((x) => x.at >= wipes[i].to && x.at < wipes[i + 1].from && x.type)
    || log.filter((x) => x.at <= wipes[i].to && x.type).at(-1)
  airtimes.push({ secs, type: on?.type || '?', dur: on?.dur })
}

for (const a of airtimes) {
  if (!Number.isFinite(a.dur) || a.dur <= 0) {
    found.push({ kind: 'airtime', line: `${a.type} went out with no stated duration` })
    continue
  }
  if (Math.abs(a.secs - a.dur) > SEG_TOLERANCE) {
    /*
     * Under by almost the whole of it is the shape of the join-offset
     * fault: useSegmentEnd fell through to its 0.3s floor because the
     * segment believed it had already played.
     */
    const how = a.secs < 1 ? ' — the floor in useSegmentEnd, so it thought it had already played' : ''
    found.push({ kind: 'airtime', line: `${a.type} ran ${a.secs.toFixed(2)}s, booked for ${a.dur}s${how}` })
  }
}

const mean = (xs) => xs.reduce((a, x) => a + x, 0) / (xs.length || 1)
console.log(`\n${wipes.length} handovers, mean ${mean(wipes.map((w) => (w.to - w.from) / 1000)).toFixed(2)}s (showclock: ${HANDOVER_SECONDS}s)`)
console.log(`${airtimes.length} segments, mean airtime ${mean(airtimes.map((a) => a.secs)).toFixed(1)}s`)

if (!found.length) {
  console.log('\nThe show runs at the length it says it does.')
  process.exit(0)
}
console.log(`\n${found.length} timing fault${found.length > 1 ? 's' : ''}:\n`)
const seen = new Set()
for (const f of found) {
  if (seen.has(f.line)) continue
  seen.add(f.line)
  console.log(`  ${f.kind.padEnd(9)} ${f.line}`)
}
process.exit(1)
