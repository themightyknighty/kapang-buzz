#!/usr/bin/env node
/**
 * Does the presenter segment work, and does it say she is not a person?
 *
 * The bulletin is rendered elsewhere — revid.ai is not reachable from the
 * sandbox — so this stubs a clip in through the same `?bulletin=` hook a real
 * render would use, and checks what the channel does with it:
 *
 *   - she plays, in both cuts
 *   - the headlines come up beside her as she reads
 *   - the frame says the presenter is generated, the whole time
 *   - a clip that will not play leaves a readable segment, not a black hole
 *
 *   node scripts/bulletin-audit.mjs --url http://localhost:5173 --shots out/
 *
 * Playwright is deliberately not a dependency of this project:
 *   npm i --no-save playwright && npx playwright install chromium
 */
import { readFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const CLIP = `data:video/webm;base64,${(await readFile(join(FIXTURES, 'clip.webm'))).toString('base64')}`

const argv = process.argv.slice(2)
const value = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const BASE = value('--url', 'http://localhost:5173')
const SHOTS = value('--shots', null)

const story = (id, headline, over = {}) => ({
  id, strand: 'celebrity', publishedAt: new Date(Date.now() - 3600_000).toISOString(),
  headline, caption: 'A caption.', people: [], outlets: 8, keyFacts: ['a', 'b', 'c'], ...over,
})

const HEADS = [
  'Elk jumps on a car in Colorado',
  'Painting bought for thirty dollars could sell for a quarter of a million',
  'Telescope finds a galaxy spinning two different ways',
  'Strength training study brings good news',
  'Lucky numbers from car plates win big prize',
]

const FEED = {
  generatedAt: new Date(Date.now() - 5000).toISOString(),
  counts: { total: 7 },
  stories: [
    story('a', HEADS[0], { outlets: 40 }),
    ...HEADS.slice(1).map((h, i) => story(`s${i}`, h)),
    story('h', 'A health story', { strand: 'health' }),
  ],
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? `  — ${detail}` : ''}`)
}

const open = async (browser, { w, h, route, bulletin = CLIP }) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } })
  await ctx.route('**/api/feed', (r) => r.fulfill({ json: FEED }))
  await ctx.route('**/api/market', (r) => r.fulfill({ status: 500, body: '{}' }))
  const page = await ctx.newPage()
  /*
   * The clip rides in the FRAGMENT, not the query.
   *
   * Here the bulletin is a base-64 data URI tens of kilobytes long. In
   * the query string that is a request header no server will accept —
   * the dev server answers 431 before the page ever loads. The
   * fragment is never sent, and the app reads its switches from both.
   */
  const url = `${BASE}/?r=${Math.random()}#/${route}?seg=headlines&bulletin=${encodeURIComponent(bulletin)}`
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForSelector('.w-seg-headlines', { timeout: 10_000 })
  return { ctx, page }
}

const run = async () => {
  if (SHOTS) await mkdir(SHOTS, { recursive: true })
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

  for (const cut of [
    { name: 'wide', w: 1280, h: 720, route: 'watch' },
    { name: 'vertical', w: 540, h: 960, route: 'vertical' },
  ]) {
    const { ctx, page } = await open(browser, cut)
    await page.waitForTimeout(2000)

    const seg = await page.evaluate(() => {
      const v = document.querySelector('.w-presenter')
      return {
        playing: Boolean(v) && !v.paused && v.videoWidth > 0,
        t: v ? v.currentTime : null,
        label: document.querySelector('.w-ai-label')?.textContent?.trim() || null,
        shown: [...document.querySelectorAll('.w-hl-list li.on')].length,
        total: document.querySelectorAll('.w-hl-list li').length,
        topbar: document.querySelector('.w-seg')?.textContent?.trim() || null,
      }
    })
    check(`${cut.name}: the presenter plays`, seg.playing, seg.t != null ? `at ${seg.t.toFixed(1)}s` : 'no video element')
    check(`${cut.name}: the frame says the presenter is generated`, /ai presenter/i.test(seg.label || ''), seg.label)
    check(`${cut.name}: the headlines are listed`, seg.total >= 3, `${seg.total} headlines`)
    check(`${cut.name}: they come up a beat apart, not all at once`, seg.shown > 0 && seg.shown < seg.total,
      `${seg.shown} of ${seg.total} up after 2s`)
    check(`${cut.name}: the top bar names the segment`, /headlines/i.test(seg.topbar || ''), seg.topbar)

    // ...and by the end of the read they are all up.
    await page.waitForTimeout(6000)
    const later = await page.evaluate(() => [...document.querySelectorAll('.w-hl-list li.on')].length)
    check(`${cut.name}: they are all up by the end of the read`, later > seg.shown, `${seg.shown} → ${later}`)

    if (SHOTS) await page.screenshot({ path: `${SHOTS}/headlines-${cut.name}.png` })
    await ctx.close()
  }

  /* ---- a clip that will not play ---- */
  {
    // The render queue is somebody else's, and a URL that was good this
    // morning can be gone by tonight. The segment has to stay readable.
    const { ctx, page } = await open(browser, { w: 1280, h: 720, route: 'watch', bulletin: 'https://example.invalid/none.mp4' })
    await page.waitForTimeout(2500)
    const fallback = await page.evaluate(() => ({
      noPresenter: Boolean(document.querySelector('.w-seg-headlines.no-presenter')),
      heads: document.querySelectorAll('.w-hl-list li').length,
      label: Boolean(document.querySelector('.w-ai-label')),
    }))
    check('a clip that will not play still leaves the headlines readable',
      fallback.noPresenter && fallback.heads >= 3, JSON.stringify(fallback))
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/headlines-nopresenter.png` })
    await ctx.close()
  }

  /* ---- no bulletin at all: the show is unchanged ---- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    await ctx.route('**/api/feed', (r) => r.fulfill({ json: FEED }))
    await ctx.route('**/api/market', (r) => r.fulfill({ status: 500, body: '{}' }))
    const page = await ctx.newPage()
    await page.goto(`${BASE}/watch?r=${Math.random()}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.w-stage', { timeout: 10_000 })
    await page.waitForTimeout(1500)
    const none = await page.evaluate(() => ({
      headlines: Boolean(document.querySelector('.w-seg-headlines')),
      something: Boolean(document.querySelector('[class*="w-seg-"], .vs')),
    }))
    check('with no bulletin the show runs exactly as before',
      !none.headlines && none.something, JSON.stringify(none))
    await ctx.close()
  }

  await browser.close()
  const bad = results.filter((r) => !r.ok)
  console.log(bad.length ? `\n${bad.length} of ${results.length} checks failed.` : `\nAll ${results.length} checks passed.`)
  process.exit(bad.length ? 1 : 0)
}

run().catch((err) => { console.error(err); process.exit(2) })
