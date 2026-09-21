#!/usr/bin/env node
/**
 * Layout audit for the front page, the market and a celebrity's page.
 *
 * These three screens now answer "why is this name moving?" and show a
 * photograph with its credit — both of which are variable-length text next to
 * fixed-size furniture, which is exactly where layouts break. The dev server
 * only ever serves the mock market, and the mock has no portraits and no
 * stories behind its movers, so the interesting cases never appear by
 * themselves. This stubs the two API calls with a market and a feed that do
 * have them, at phone and desktop widths.
 *
 *   node scripts/market-audit.mjs --url http://localhost:5173
 *   node scripts/market-audit.mjs --shots out/
 *
 * Playwright is deliberately not a dependency of this project:
 *
 *   npm i --no-save playwright && npx playwright install chromium
 */
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const argv = process.argv.slice(2)
const value = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const BASE = value('--url', 'http://localhost:5173')
const SHOTS = value('--shots', null)

const WIDTHS = [
  { name: 'phone', w: 390, h: 844 },
  { name: 'desktop', w: 1440, h: 900 },
]

const ROUTES = [
  { name: 'home', hash: '/' },
  { name: 'market', hash: '/market' },
  { name: 'celebrity', hash: '/market/ava-lumen' },
  { name: 'admin', hash: '/market/admin' },
]

/*
 * Invented people, so nothing here can be mistaken for a real claim about a
 * real celebrity. The picture is a 1x1 data URI: this audit is about how the
 * text sits around the frame, not about the photograph.
 */
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='
const LONG = 'Ava Lumen and the entire cast reunite in Cannes after eleven years apart, and nobody saw it coming'

const person = (i, over = {}) => ({
  id: `p${i}`, displayName: over.name || `Person ${i}`, slug: over.slug || `person-${i}`,
  primaryCategory: 'music', secondaryCategories: [],
  gossipScore: 40 + i, raw: 40 + i, confidence: 0.9,
  contributions: { news: { value: 50 }, wikipedia: { value: 30 }, breadth: { value: 20 }, momentum: { value: 10 } },
  droppedSources: [], newsScore: 50, wikipediaScore: 30, breadthScore: 20,
  momentum: 10 - i, velocity1h: 2, acceleration: 1,
  mentions: 100 + i, windowMentions: 4, uniqueSources: 12, uniqueCountries: 5,
  deviationZ: 1.2, baselines: { '7d': [10], '30d': [10], daysOfHistory: 30 },
  newEntry: false, drivers: [], change24h: 0, change7d: 0, rank: i + 1, rankChange: 0,
  status: 'ACTIVE', trend: '▲', attention: 'High', peakToday: 60, peakWeek: 70, rankPrev: i + 2,
  scoreSeries: Array.from({ length: 40 }, (_, k) => ({ t: Date.now() - (40 - k) * 900000, v: 40 + Math.sin(k) * 5 })),
  sources: { news: { at: new Date().toISOString(), freshnessSeconds: 60, ok: true }, wikipedia: { at: new Date().toISOString(), freshnessSeconds: 3600, ok: true } },
  ...over,
})

const MARKET = {
  mock: false, published: true, generatedAt: new Date().toISOString(),
  nextUpdateAt: new Date(Date.now() + 900000).toISOString(),
  weights: { news: 0.5, wikipedia: 0.15, breadth: 0.15, momentum: 0.2 },
  rows: [
    // A long name, a long credit and a story behind the move — the worst case.
    person(0, {
      name: 'Ava Lumen-Castellanos', slug: 'ava-lumen', change24h: 18.4,
      imageUrl: PIXEL, imageCredit: '© A Photographer With A Very Long Studio Name, example.com',
      imageLicence: 'CC BY-SA 4.0', imageLicenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
      imageSourceUrl: 'https://commons.wikimedia.org/wiki/File:X.jpg', imageProvider: 'Wikimedia Commons',
    }),
    // Moving, with outlets but no story of ours.
    person(1, { name: 'Leo Marsh', slug: 'leo-marsh', change24h: 9.1, drivers: [{ domain: 'variety.com', url: 'https://example.com/a', title: 'A headline', firstSeen: new Date().toISOString(), publishers: 9 }] }),
    // Moving with nothing behind it at all, and no picture.
    person(2, { name: 'Nina Park', slug: 'nina-park', change24h: 3.2 }),
    person(3, { name: 'Ida Sol', slug: 'ida-sol', change24h: -12.7, imageUrl: PIXEL, imageCredit: 'Someone', imageLicence: 'CC0' }),
    person(4, { name: 'Bo Vance', slug: 'bo-vance', change24h: -5.5 }),
    person(5, { name: 'Wren Adeyemi-Fitzgerald', slug: 'wren-a', change24h: -2.1 }),
  ],
  cards: {
    hottest: { celebrity: { displayName: 'Ava Lumen-Castellanos', slug: 'ava-lumen', gossipScore: 40, attention: 'High' } },
    riser: { celebrity: { displayName: 'Ava Lumen-Castellanos', slug: 'ava-lumen', change24h: 18.4 } },
    faller: { celebrity: { displayName: 'Ida Sol', slug: 'ida-sol', change24h: -12.7 } },
    mostCovered: { celebrity: { displayName: 'Leo Marsh', slug: 'leo-marsh', mentions: 101 } },
    breaking: { empty: true, reason: 'Nothing breaking' },
  },
  summary: { tracked: 6, rising: 3, falling: 3, breaking: 0, totalMentions: 612, averageScore: 42.5 },
  health: { news: { ok: true, lastSuccess: new Date().toISOString() }, portrait: { ok: true, lastSuccess: new Date().toISOString() } },
  portraits: { roster: 6, looked: 6, withPicture: 2, refused: 4, personalityRightsAllowed: false },
  run: { calls: 40, seconds: 12, log: [] },
}

const FEED = {
  generatedAt: new Date().toISOString(),
  counts: { total: 2 },
  stories: [
    { id: 's1', strand: 'celebrity', publishedAt: new Date().toISOString(), headline: LONG, caption: 'A caption that runs on for a while so the card has to wrap it.', people: ['Ava Lumen-Castellanos'], whyTrending: 'Eleven years is a long time, and the internet noticed within the hour.', outlets: 14 },
    { id: 's2', strand: 'health', publishedAt: new Date().toISOString(), headline: 'A short one', caption: 'Short.', people: [], outlets: 3 },
  ],
}

/** Text that is cut off, spilling out of the viewport, or sitting on top of something else. */
const AUDIT = `(() => {
  const issues = []
  const DECOR = '[aria-hidden="true"], svg, .b-watch-bg, .b-type, .b-type-glyph'
  const els = [...document.querySelectorAll('body *')].filter((el) => {
    if (el.closest(DECOR)) return false
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false
    // Only leaf-ish boxes that actually show words.
    return el.childElementCount === 0 && el.textContent.trim().length > 0
  })
  const name = (el) => (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').filter(Boolean).join('.') : el.tagName.toLowerCase())
    + ' — "' + el.textContent.trim().slice(0, 44) + '"'

  for (const el of els) {
    const s = getComputedStyle(el)
    // Clipped: content is taller or wider than the box that hides it.
    const hiddenX = s.overflowX === 'hidden' || s.overflow === 'hidden'
    const hiddenY = s.overflowY === 'hidden' || s.overflow === 'hidden'
    const ellipsis = s.textOverflow === 'ellipsis' || s.webkitLineClamp !== 'none'
    if (hiddenY && !ellipsis && el.scrollHeight > el.clientHeight + 2) issues.push('clipped vertically: ' + name(el))
    if (hiddenX && !ellipsis && el.scrollWidth > el.clientWidth + 2) issues.push('clipped horizontally: ' + name(el))
    const r = el.getBoundingClientRect()
    // Content inside a deliberate horizontal scroller — the market's tab bar
    // and the tickers — is meant to run past the edge. Auditing it buries the
    // real faults, which are the boxes that overflow a container that has no
    // way to reach them.
    const inScroller = el.closest('.mkt-bar, .b-tabs, .mkt-table, [data-scroll-x]')
    if (!inScroller && r.width > 0 && (r.left < -1 || r.right > window.innerWidth + 1)) {
      issues.push('outside the viewport: ' + name(el))
    }
  }
  // A page that scrolls sideways on a phone is a layout fault, always.
  if (document.documentElement.scrollWidth > window.innerWidth + 1) {
    issues.push('the page scrolls sideways (' + document.documentElement.scrollWidth + ' > ' + window.innerWidth + ')')
  }
  return issues
})()`

const run = async () => {
  if (SHOTS) await mkdir(SHOTS, { recursive: true })
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  let problems = 0
  let checked = 0

  for (const size of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h } })
    // The screens read their data from these two endpoints and nothing else,
    // so stubbing them is enough to put any state on screen.
    await ctx.route('**/api/market', (r) => r.fulfill({ json: MARKET }))
    await ctx.route('**/api/feed', (r) => r.fulfill({ json: FEED }))
    const page = await ctx.newPage()

    for (const route of ROUTES) {
      // A fresh load per route, with the cache buster after the path —
      // the app reads its switches from the query string now.
      await page.goto(`${BASE}${route.hash}?r=${route.name}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(600)
      const issues = await page.evaluate(AUDIT)
      checked++
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${route.name}-${size.name}.png`, fullPage: true })
      if (issues.length) {
        problems += issues.length
        console.log(`\n${route.name} @ ${size.name} (${size.w}px)`)
        for (const i of issues) console.log('  - ' + i)
      }
    }
    await ctx.close()
  }

  await browser.close()
  if (!problems) console.log(`No cropping, overflow or sideways scroll across ${checked} screen/width combinations.`)
  process.exit(problems ? 1 : 0)
}

run().catch((err) => { console.error(err); process.exit(2) })
