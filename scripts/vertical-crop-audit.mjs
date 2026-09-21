#!/usr/bin/env node
/**
 * Does the vertical show cut people out of its pictures?
 *
 * The 9:16 frame is half as wide as it is tall, and most press photography is
 * the opposite shape. Anything cropped to fill that frame loses roughly
 * two-thirds of its width, so a picture of three people at a premiere becomes a
 * close-up of whatever happened to be in the middle — which is how a viewer
 * ends up looking at an abstract smear of a shoulder.
 *
 * This renders the vertical cuts over test images whose composition is known:
 * a percentage grid and labelled figures at 18%, 50% and 82% across. Whatever
 * survives in the screenshot says exactly how much of the frame is reaching the
 * viewer, and the report says which figures were lost.
 *
 *   node scripts/vertical-crop-audit.mjs --url http://localhost:5173 --shots out/
 *
 * Playwright is deliberately not a dependency of this project:
 *   npm i --no-save playwright && npx playwright install chromium
 */
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

/*
 * The test patterns live beside this script rather than in public/, so they
 * are never copied into a build, and are served to the page from here.
 * Each is a percentage grid with labelled figures at known positions, so a
 * screenshot says exactly which part of the picture reached the viewer.
 */
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

const argv = process.argv.slice(2)
const value = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const BASE = value('--url', 'http://localhost:5173')
const SHOTS = value('--shots', null)

const IMG = (name, w, h, kind) => ({
  url: `${BASE}/__test/${name}`, width: w, height: h, kind,
  alt: 'test pattern', credit: 'Test pattern', licence: 'CC0', provider: 'local',
  // showable() requires a review stamp, the same as a real published picture.
  review: { version: 'vision-1', verdict: 'ok' },
})

const WIDE_GROUP = IMG('wide-group.jpg', 1600, 900, 'scene')
const WIDE_OFF = IMG('wide-offcentre.jpg', 1600, 900, 'scene')
const TALL = IMG('tall-portrait.jpg', 800, 1200, 'person')

/*
 * The same off-centre photograph, but with the subject box the picture desk
 * records. This is the good case: the frame can still be filled, because the
 * window is moved onto the figure at 78% across instead of sitting in the
 * middle where there is nothing.
 */
const WIDE_OFF_PLACED = {
  ...WIDE_OFF,
  review: { ...WIDE_OFF.review, subject: { x: 0.68, y: 0.12, w: 0.2, h: 0.62 } },
}

const story = (id, strand, image, over = {}) => ({
  id, strand, publishedAt: new Date().toISOString(),
  headline: `Test story ${id}`, caption: 'A caption for the test story.',
  whyTrending: 'Because this is a layout test.', people: [], outlets: 6,
  image, ...over,
})

const feedOf = (stories) => ({
  generatedAt: new Date().toISOString(),
  counts: { total: stories.length, celebrity: stories.length, health: 0, facts: 0, bizarre: 0 },
  stories,
})

/*
 * Two passes, because they are asking different questions.
 *
 * `unplaced` is every picture already published: no subject box, so the only
 * safe answer is to stop cropping. `placed` is what the picture desk produces
 * from now on: a box, so the frame can be filled AND keep the subject.
 */
const PASSES = [
  {
    name: 'unplaced',
    feed: feedOf([
      story('wide-group', 'celebrity', WIDE_GROUP),
      story('wide-off', 'celebrity', WIDE_OFF),
      story('tall', 'celebrity', TALL),
      story('gallery', 'bizarre', WIDE_GROUP, { gallery: [WIDE_GROUP, TALL, WIDE_OFF] }),
    ]),
    // Nothing may be cropped out of frame.
    expect: 'nothing lost',
  },
  {
    name: 'placed',
    feed: feedOf([
      story('placed-1', 'celebrity', WIDE_OFF_PLACED),
      story('placed-2', 'celebrity', WIDE_OFF_PLACED),
      story('placed-3', 'celebrity', WIDE_OFF_PLACED),
    ]),
    // ...and the frame should still be FILLED, not letterboxed, because the
    // box says where to point the window.
    expect: 'filled and on the subject',
  },
]

/*
 * What actually reaches the viewer.
 *
 * For every <img> that is cropped to fill its box, work out which slice of the
 * source survives — the browser will not say, so it is recomputed here from the
 * natural size, the box and object-position, exactly as `cover` does it.
 */
const MEASURE = `(() => {
  const out = []
  for (const img of document.querySelectorAll('img')) {
    if (!img.naturalWidth || !img.complete) continue
    const b = img.getBoundingClientRect()
    if (b.width < 60 || b.height < 60) continue
    const s = getComputedStyle(img)
    if (s.objectFit !== 'cover') { out.push({ cls: img.className, fit: s.objectFit, kept: 1 }); continue }

    const sx = b.width / img.naturalWidth
    const sy = b.height / img.naturalHeight
    const k = Math.max(sx, sy)                      // cover scales to the larger
    const drawnW = img.naturalWidth * k
    const drawnH = img.naturalHeight * k
    const [px, py] = s.objectPosition.split(' ')
    const frac = (v, span) => v.endsWith('%') ? parseFloat(v) / 100 : (parseFloat(v) || 0) / (span || 1)
    const fx = frac(px, drawnW - b.width)
    const fy = frac(py || px, drawnH - b.height)

    // The window into the source, as fractions of the source.
    const winW = Math.min(1, b.width / drawnW)
    const winH = Math.min(1, b.height / drawnH)
    const left = (1 - winW) * (isFinite(fx) ? fx : 0.5)
    const top = (1 - winH) * (isFinite(fy) ? fy : 0.5)
    out.push({
      cls: img.className, fit: 'cover',
      kept: Number((winW * winH).toFixed(3)),
      window: { left: +left.toFixed(3), right: +(left + winW).toFixed(3), top: +top.toFixed(3), bottom: +(top + winH).toFixed(3) },
      box: [Math.round(b.width), Math.round(b.height)],
      natural: [img.naturalWidth, img.naturalHeight],
      src: img.src.split('/').pop(),
    })
  }
  return out
})()`

// Where the figures sit in the test images, so a lost one can be named.
const FIGURES = {
  'wide-group.jpg': [{ n: 'L', x: 0.18, y: 0.34 }, { n: 'C', x: 0.50, y: 0.30 }, { n: 'R', x: 0.82, y: 0.34 }],
  'wide-offcentre.jpg': [{ n: 'S', x: 0.78, y: 0.32 }],
  'tall-portrait.jpg': [{ n: 'P', x: 0.50, y: 0.28 }],
}

// `top`, `story` and `weird` are the segments that render VerticalStory, which
// is the full-bleed cut and therefore where the cropping actually happens.
// `factBlast` is the other picture segment in this format.
const FRAMES = [
  { name: 'top', hash: '/vertical?seg=top', wait: 2600 },
  { name: 'story', hash: '/vertical?seg=story', wait: 2600 },
  { name: 'weird', hash: '/vertical?seg=weird', wait: 2600 },
  { name: 'factBlast', hash: '/vertical?seg=factBlast', wait: 2600 },
  { name: 'healthMinute', hash: '/vertical?seg=healthMinute', wait: 2600 },
]

const run = async () => {
  if (SHOTS) await mkdir(SHOTS, { recursive: true })
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  let lost = 0
  let cropped = 0

  for (const pass of PASSES) {
  const ctx = await browser.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 })
  await ctx.route('**/api/feed', (r) => r.fulfill({ json: pass.feed }))
  await ctx.route('**/api/market', (r) => r.fulfill({ status: 500, body: '{}' }))
  await ctx.route('**/__test/*', async (r) => {
    const name = r.request().url().split('/').pop().split('?')[0]
    try {
      r.fulfill({ contentType: 'image/jpeg', body: await readFile(join(FIXTURES, name)) })
    } catch { r.fulfill({ status: 404, body: 'no such fixture' }) }
  })
  const page = await ctx.newPage()
  console.log(`\n── ${pass.name}: ${pass.expect} ──`)

  for (const f of FRAMES) {
    await page.goto(`${BASE}${f.hash}&r=${pass.name}-${f.name}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(f.wait)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${pass.name}-${f.name}.png` })
    const shots = await page.evaluate(MEASURE)
    for (const m of shots) {
      if (m.fit !== 'cover' || !m.window) continue
      if (m.cls.includes('wash')) continue // the blurred backdrop is meant to bleed
      const figs = FIGURES[m.src] || []
      const missing = figs.filter((g) => g.x < m.window.left || g.x > m.window.right || g.y < m.window.top || g.y > m.window.bottom)
      const pct = Math.round(m.kept * 100)
      const flag = missing.length ? `  ✗ LOST ${missing.map((g) => g.n).join(', ')}` : '  ok'
      if (missing.length) lost += missing.length
      if (pass.name === 'placed') cropped++
      console.log(`${f.name.padEnd(16)} ${m.cls.padEnd(26)} ${String(pct).padStart(3)}% of the picture shown` +
        `  x ${m.window.left}–${m.window.right}  y ${m.window.top}–${m.window.bottom}${flag}`)
    }
  }

  await ctx.close()
  }

  await browser.close()
  console.log(lost ? `\n${lost} figures cropped out of frame.` : '\nEvery figure stayed in frame.')
  // A placed picture that letterboxes has thrown away the whole point of
  // asking the picture desk where the subject was.
  if (!cropped) console.log('A placed picture never filled the frame — the subject box is not reaching the cut.')
  else console.log(`Placed pictures filled the frame ${cropped} times with the subject in shot.`)
  process.exit(lost || !cropped ? 1 : 0)
}

run().catch((err) => { console.error(err); process.exit(2) })
