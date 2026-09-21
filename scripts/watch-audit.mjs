#!/usr/bin/env node
/**
 * Layout audit for the Watch screen.
 *
 * Walks every segment of the show in both formats and reports anything that is
 * clipped, overflowing its box, or sitting on top of something else. It exists
 * because the 1920×1080 and 1080×1920 stages are fixed pixel canvases: text
 * that wraps one line further than expected does not reflow the page, it runs
 * off the bottom of the frame, and on a channel nobody is there to notice.
 *
 *   node scripts/watch-audit.mjs                 both formats, normal copy
 *   node scripts/watch-audit.mjs --stress        long names and headlines
 *   node scripts/watch-audit.mjs --shots out/    also write a PNG per segment
 *
 * Needs the dev server (npm run dev, or pass --url) and Playwright, which is
 * deliberately NOT a dependency of this project — its postinstall downloads
 * browsers and would sit in the middle of every Netlify build:
 *
 *   npm i --no-save playwright && npx playwright install chromium
 */
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const value = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const BASE = value('--url', 'http://localhost:5173')
const SHOTS = value('--shots', null)
const STRESS = flag('--stress')

/** Every segment the show can produce, so none is audited by luck. */
const SEGMENTS = ['open', 'top', 'chartPos', 'numberOne', 'chartRecap', 'story',
  'factBlast', 'healthMinute', 'quiz', 'answer', 'weird']
const FORMATS = [
  { name: '16x9', route: 'watch', w: 1920, h: 1080 },
  { name: '9x16', route: 'vertical', w: 1080, h: 1920 },
]

/*
 * The chart the audit runs the countdown against.
 *
 * Stubbed rather than taken from .market-data, because the countdown's
 * layout depends on things local data happens not to have: a portrait to
 * frame, a re-entry with no last week, a name long enough to need the
 * fitter. A fixture puts all of them on air every run.
 */
const PIX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg=='
const CHART = {
  id: '2026-W38',
  label: '14–20 September 2026',
  live: true,
  provisional: true,
  freezesAt: new Date(Date.now() + 3 * 86400000).toISOString(),
  entries: Array.from({ length: 12 }, (_, i) => {
    const rank = i + 1
    const status = rank === 3 ? 'new' : rank === 5 ? 'reentry' : rank === 7 ? 'flat' : rank % 2 ? 'up' : 'down'
    return {
      rank,
      id: `c${rank}`,
      slug: `c${rank}`,
      displayName: ['Patrick Mahomes', 'Bruno Mars', 'Zendaya', 'Harry Styles', 'Taylor Swift',
        'Dua Lipa', 'Timothée Chalamet', 'Rihanna', 'Pedro Pascal', 'Florence Pugh',
        'Bad Bunny', 'Ariana Grande'][i],
      score: Math.round((94 - i * 5.5) * 10) / 10,
      daysOfData: 5,
      // Half have a portrait and half do not: the initials frame is the one
      // most names will actually get, so it is audited as often as the photo.
      imageUrl: i % 2 === 0 ? PIX : null,
      lastWeek: status === 'new' || status === 'reentry' ? null : rank + (status === 'up' ? 6 : -4),
      move: status === 'new' || status === 'reentry' ? null : (status === 'up' ? 6 : -4),
      peak: Math.max(1, rank - 2),
      weeksOn: status === 'new' ? 1 : 4,
      weeksAtOne: rank === 1 ? 2 : 0,
      status,
      reason: rank === 7
        ? { kind: 'none', headline: null, text: '', href: null }
        : { kind: 'story', headline: 'Something happened at the weekend that everybody has an opinion about',
            text: 'Something happened at the weekend that everybody has an opinion about', href: '/story/x' },
    }
  }),
  summary: { charted: 12, numberOne: { displayName: 'Patrick Mahomes' } },
}

/**
 * Run inside the page: find text that is cut off, boxes that spill out of the
 * stage, and pairs of text blocks that overlap.
 */
const AUDIT = `(() => {
  const stage = document.querySelector('.w-stage')
  if (!stage) return { fatal: 'no stage' }
  const sb = stage.getBoundingClientRect()
  const issues = []

  /*
   * What the audit is NOT looking at.
   *
   * The two marquees run their content off both edges of a masked track on
   * purpose. The oversized strand glyph, the vertical sparkle field, the
   * confetti and the drifting headlines behind the watch tile are decoration,
   * already marked aria-hidden, and are meant to bleed and sit under text.
   * Auditing them buries the real faults under a thousand false ones.
   *
   * .w-face.bleed is number one's portrait filling the frame with a slow
   * push on it: the crop is the shot. The FRAMED .w-face is not exempt —
   * a portrait spilling out of its frame would be a real fault.
   */
  const DECOR = '[aria-hidden="true"], .w-tape-track, .w-ticker-track, .b-type-glyph, .b-type, .v-fx, .w-confetti, .b-watch-bg, .w-hero, .w-face.bleed, svg'
  const skip = (el) => el.closest(DECOR) !== null

  /** A box that actually shows words to a viewer. */
  const speaks = (el) => {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true
    return false
  }

  const name = (el) => (typeof el.className === 'string' && el.className.trim())
    ? '.' + el.className.trim().split(/\s+/).join('.')
    : el.tagName.toLowerCase()

  const boxes = []
  for (const el of stage.querySelectorAll('*')) {
    if (skip(el)) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue

    // Cut off by its own box. Two pixels of rounding is not a fault, and a box
    // whose overflow is a decorative child is cropping that child on purpose.
    if (cs.overflow !== 'visible' && !el.querySelector(DECOR)) {
      if (el.scrollHeight > el.clientHeight + 2) issues.push({ kind: 'clipped-y', el: name(el), by: el.scrollHeight - el.clientHeight })
      if (el.scrollWidth > el.clientWidth + 2) issues.push({ kind: 'clipped-x', el: name(el), by: el.scrollWidth - el.clientWidth })
    }

    if (!speaks(el)) continue
    // Off the edge of the frame — on a fixed canvas this is simply gone.
    const out = Math.max(sb.left - r.left, sb.top - r.top, r.right - sb.right, r.bottom - sb.bottom)
    if (out > 2) issues.push({ kind: 'offstage', el: name(el), by: Math.round(out) })
    boxes.push({ where: name(el), r, el })
  }

  // Text sitting on text. Ancestors legitimately contain their descendants, so
  // only unrelated boxes count.
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const A = boxes[i], B = boxes[j]
      if (A.el.contains(B.el) || B.el.contains(A.el)) continue
      const w = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left)
      const h = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top)
      if (w <= 4 || h <= 4) continue
      const smaller = Math.min(A.r.width * A.r.height, B.r.width * B.r.height)
      const pct = (w * h) / smaller
      if (pct > 0.35) issues.push({ kind: 'overlap', el: A.where, other: B.where, pct: Math.round(pct * 100) })
    }
  }
  return { issues }
})()`

const LONG = {
  headline: 'Reality television personality and part-time competitive cheesemonger announces an unexpectedly emotional farewell world tour',
  caption: 'A statement released overnight confirmed forty-one dates across five continents, a documentary, and what the announcement described as a complete reinvention of the live show.',
  name: 'Aleksandra Konstantinovna Featherstonehaugh-Villanueva',
}

/** Did ?seg=<type> actually put that segment on the stage? */
const CLASS_OF = {
  open: 'w-seg-open', top: 'w-seg-story', story: 'w-seg-story', weird: 'w-seg-weird',
  chartPos: 'w-seg-pos', numberOne: 'w-seg-one', chartRecap: 'w-seg-recap',
  factBlast: 'w-seg-blast', healthMinute: 'w-seg-health', quiz: 'w-seg-quiz',
  answer: 'w-seg-quiz', comingUp: 'w-seg-next',
}
// The vertical cut draws its stories with its own component.
const onAir = (seg, cls) => (['top', 'story', 'weird'].includes(seg) && /(^|\s)vs(\s|$)/.test(cls))
  || cls.split(/\s+/).includes(CLASS_OF[seg])

async function run() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const found = []

  for (const f of FORMATS) {
    const page = await browser.newPage({ viewport: { width: f.w, height: f.h } })
    // The countdown is the spine of the show; audit it against a known chart.
    await page.route('**/api/chart/live', (r) => r.fulfill({ json: CHART }))
    await page.route('**/api/chart', (r) => r.fulfill({ json: CHART }))
    if (STRESS) {
      // Stretch the copy before React reads it, so every box is audited at the
      // longest text it will ever be handed rather than the tidiest.
      await page.addInitScript(([long]) => {
        const stretch = (o) => {
          if (!o || typeof o !== 'object') return o
          if (Array.isArray(o)) return o.map(stretch)
          if (typeof o.headline === 'string') o.headline = long.headline
          if (typeof o.caption === 'string') o.caption = long.caption
          if (typeof o.displayName === 'string') o.displayName = long.name
          for (const k of Object.keys(o)) if (typeof o[k] === 'object') stretch(o[k])
          return o
        }
        const orig = window.fetch
        window.fetch = async (...a) => {
          const res = await orig(...a)
          const json = res.json.bind(res)
          res.json = async () => stretch(await json())
          return res
        }
      }, [LONG])
    }

    for (const seg of SEGMENTS) {
      await page.goto(`${BASE}/${f.route}?seg=${seg}&speed=4`, { waitUntil: 'networkidle' })
      /*
       * Freeze, measure, let it run a little, freeze again.
       *
       * A segment is not one picture. Its copy arrives over the first
       * few seconds and half of it is invisible — and therefore
       * unaudited — until it does. A single measurement after a fixed
       * wait audited whichever moment that happened to be, and for the
       * short beats (the title card is fifteen seconds; the vertical
       * answer is twenty-two) the fixed wait was longer than the
       * segment, so they were never audited at all: the run measured
       * whatever had taken over the stage and passed it.
       *
       * So: settle, then sample repeatedly, stopping as soon as the
       * beat we asked for leaves the air. Space is the viewer's own
       * pause, which also proves it works in every segment of both cuts.
       */
      await page.waitForTimeout(2000)
      let sampled = 0
      for (let pass = 0; pass < 4; pass++) {
        await page.keyboard.press(' ')
        await page.waitForTimeout(250)
        const shown = await page.evaluate(`document.querySelector('.w-stage > [class*="w-seg-"], .w-stage .vs')?.className || ''`)
        if (!onAir(seg, shown)) {
          // Only the first pass can fail this: after that the beat has
          // simply run its length, which is not a fault.
          if (!sampled) found.push({ format: f.name, seg, kind: 'not-on-air', el: shown || '(nothing)', by: 0 })
          break
        }
        const type = await page.evaluate(`document.querySelector('.w-top .w-seg')?.textContent || ''`)
        const { issues, fatal } = await page.evaluate(AUDIT)
        if (fatal) { found.push({ format: f.name, seg, kind: 'fatal', el: fatal }); break }
        for (const i of issues) {
          const seen = found.some((x) => x.format === f.name && x.seg === seg && x.kind === i.kind && x.el === i.el && x.other === i.other)
          if (!seen) found.push({ format: f.name, seg, onAir: type, ...i })
        }
        if (SHOTS && !sampled) {
          await mkdir(SHOTS, { recursive: true })
          await page.screenshot({ path: `${SHOTS}/${f.name}-${seg}.png` })
        }
        sampled++
        // Back to the clock for another few seconds of the same beat.
        await page.keyboard.press(' ')
        await page.waitForTimeout(1200)
      }
    }
    await page.close()
  }
  await browser.close()

  if (!found.length) {
    console.log(`No cropping, overflow or overlap across ${SEGMENTS.length} segments × ${FORMATS.length} formats${STRESS ? ' under long-text stress' : ''}.`)
    return 0
  }
  console.log(`${found.length} layout issue${found.length === 1 ? '' : 's'}:\n`)
  for (const i of found) {
    const detail = i.kind === 'overlap' ? `${i.el} over ${i.other} (${i.pct}%)`
      : i.kind === 'not-on-air' ? `asked for it, got ${i.el}`
      : `${i.el} by ${i.by}px`
    console.log(`  ${i.format.padEnd(6)} ${String(i.seg).padEnd(13)} ${i.kind.padEnd(11)} ${detail}`)
  }
  return 1
}

process.exit(await run())
