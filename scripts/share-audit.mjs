#!/usr/bin/env node
/**
 * Does sharing actually work, in a browser?
 *
 * The unit tests cover the copy and the rules. What they cannot cover is the
 * part that broke the old app: an address bar. Moving off the fragment means
 * every link, every back button and every already-shared URL has to keep
 * working, and the only way to know is to click them.
 *
 *   node scripts/share-audit.mjs --url http://localhost:5175 --shots out/
 *
 * Playwright is deliberately not a dependency of this project:
 *   npm i --no-save playwright && npx playwright install chromium
 */
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const argv = process.argv.slice(2)
const value = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const BASE = value('--url', 'http://localhost:5175')
const SHOTS = value('--shots', null)

const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString()

const story = (id, headline, over = {}) => ({
  id, strand: 'celebrity', publishedAt: hoursAgo(1), headline,
  caption: 'A caption that goes under the headline.',
  body: 'The body of the story, which is longer.',
  people: [], outlets: 8, keyFacts: ['one', 'two', 'three'],
  sources: [{ name: 'A source', url: 'https://apnews.com/x' }],
  image: null, ...over,
})

const FEED = {
  generatedAt: hoursAgo(0.4),
  counts: { total: 5 },
  stories: [
    story('elk', 'Elk jumps on the bonnet of a parked car in Colorado', { strand: 'bizarre', outlets: 23 }),
    story('tour', 'Zendaya announces a world tour', { people: ['Zendaya'], outlets: 31 }),
    story('lift', 'Strength training twice a week is enough', { strand: 'health' }),
    story('gal', 'A galaxy spins two ways at once', { strand: 'facts' }),
    story('old', 'Something from the day before', { publishedAt: hoursAgo(40) }),
  ],
}

/*
 * The market fixture is the app's own mock market with a few rows forced, not
 * a hand-written object. The market row has about forty fields and the screens
 * read most of them; a fixture written by hand fails on the fortieth and looks
 * like a bug in the thing being tested.
 */
const { mockMarket } = await import('../market/mock.mjs')

const MARKET = (() => {
  const m = mockMarket({ now: Date.now() })
  // Two names with moves big enough to alert on, so the bell has something
  // definite to say rather than whatever the seed happened to produce.
  const [up, down] = m.rows
  Object.assign(up, { displayName: 'Zendaya', slug: 'zendaya', id: 'zendaya', gossipScore: 62.1, change24h: 18.4 })
  Object.assign(down, { displayName: 'Dua Lipa', slug: 'dua-lipa', id: 'dua-lipa', gossipScore: 44.2, change24h: -9.8 })
  for (const key of Object.keys(m.cards || {})) {
    const c = m.cards[key]
    if (c && c.id === up.id) m.cards[key] = up
    if (c && c.id === down.id) m.cards[key] = down
  }
  m.mock = false
  return m
})()

/**
 * Three weeks of the Genie 100, built by the real engine from the real
 * rollups so the fixture cannot drift from what the site actually publishes.
 */
const { buildChart, buildLiveChart, nextRecords, weekRange, weekIdAt } = await import('../market/chart.mjs')

const CHARTS = (() => {
  const DAY = 86400000
  const flat = (score, weekId) => {
    const { startsAt } = weekRange(weekId)
    return Array.from({ length: 7 }, (_, i) => ({
      day: new Date(startsAt + i * DAY).toISOString().slice(0, 10),
      open: score, high: score + 2, low: score - 2, close: score, bestRank: 4, samples: 96,
    }))
  }
  const weeks = { '2026-W36': [70, 60, 50], '2026-W37': [55, 80, 50], '2026-W38': [90, 80, 52] }
  const rows = MARKET.rows.slice(0, 3)
  const out = {}
  let records = {}
  let previous = null
  for (const [weekId, scores] of Object.entries(weeks)) {
    previous = buildChart({
      weekId, rows, previous, records,
      rollups: Object.fromEntries(rows.map((r, i) => [r.id, { days: flat(scores[i], weekId) }])),
    })
    records = nextRecords(records, previous)
    out[weekId] = previous
  }
  /*
   * The week in progress, built the same way the site builds it. The front
   * page shows this, not the published edition — so an audit that only
   * stubbed the published one would test a page nobody sees.
   */
  const thisWeek = weekIdAt(Date.now())
  const live = buildLiveChart({
    rows,
    rollups: Object.fromEntries(rows.map((r, i) => [r.id, { days: flat([88, 74, 61][i], thisWeek).slice(0, 3) }])),
    previous: out['2026-W38'],
    records,
  })

  return {
    latest: out['2026-W38'],
    live,
    byId: out,
    index: {
      latest: '2026-W38',
      editions: Object.values(out).reverse().map((e) => ({
        id: e.id, label: e.label, publishedAt: e.publishedAt, charted: e.summary.charted,
        numberOne: { slug: e.summary.numberOne.slug, displayName: e.summary.numberOne.displayName },
      })),
    },
  }
})()

/*
 * A real card, drawn by the real card module, served for any /og/*.png the
 * page asks for. Stubbed like the API is: the page's job is to show the card
 * and offer it, and tying that check to whatever happens to be in
 * .market-data would make it fail for reasons that have nothing to do with
 * the page.
 */
const { chartCard, toPng } = await import('../netlify/lib/card.mjs')
const CARD_PNG = await toPng(chartCard(CHARTS.latest, { name: 'The Genie 100' }))

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? `  — ${detail}` : ''}`)
}

const context = async (browser, opts = {}) => {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
    ...opts,
  })
  await ctx.route('**/api/feed', (r) => r.fulfill({ json: FEED }))
  await ctx.route('**/api/market', (r) => r.fulfill({ json: MARKET }))
  await ctx.route('**/api/market/**', (r) => r.fulfill({ json: MARKET }))
  // Nothing here should ever reach a share target; if it tries, fail loudly
  // rather than opening somebody's Twitter in a test run.
  await ctx.route('**/og/**', (r) => r.fulfill({ contentType: 'image/png', body: CARD_PNG }))
  await ctx.route('**/api/chart', (r) => r.fulfill({ json: CHARTS.latest }))
  await ctx.route('**/api/chart/**', (r) => {
    const id = new URL(r.request().url()).pathname.split('/').pop()
    if (id === 'index') return r.fulfill({ json: CHARTS.index })
    if (id === 'live') return r.fulfill({ json: CHARTS.live })
    const edition = CHARTS.byId[id]
    return edition ? r.fulfill({ json: edition }) : r.fulfill({ status: 404, json: { empty: true } })
  })
  // Nothing here should ever reach a share target; if it tries, fail loudly
  // rather than opening somebody's Twitter in a test run.
  await ctx.route(/wa\.me|twitter\.com|facebook\.com/, (r) => r.fulfill({ body: 'blocked' }))
  return ctx
}

const go = async (page, path) => {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(350)
}

const run = async () => {
  if (SHOTS) await mkdir(SHOTS, { recursive: true })
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

  /* ================= routing ================= */
  {
    const ctx = await context(browser)
    const page = await ctx.newPage()

    await go(page, '/')
    check('the front page is at /, with no fragment', new URL(page.url()).hash === '', page.url())

    // A story card click must change the path, not the fragment, and must not
    // reload — a reload here means the click handler did not take it.
    await page.evaluate(() => { window.__stillHere = true })
    await page.click('a[href="/story/elk"]')
    await page.waitForTimeout(250)
    const afterClick = new URL(page.url())
    check('clicking a story goes to a real path', afterClick.pathname === '/story/elk', page.url())
    check('and does it in the page, without a reload',
      await page.evaluate(() => window.__stillHere === true))
    check('the story is the one that was clicked',
      (await page.textContent('.b-story h1'))?.includes('Elk jumps'), await page.textContent('.b-story h1'))

    await page.goBack()
    await page.waitForTimeout(250)
    check('the back button goes back', new URL(page.url()).pathname === '/', page.url())
    check('and the front page is still there', await page.isVisible('.b-grid, .b-movers'))

    // Deep link, cold: this is what somebody who was sent the link gets.
    await go(page, '/market/zendaya')
    check('a celebrity link opens that celebrity cold',
      (await page.textContent('.mkt-detail h1'))?.trim() === 'Zendaya',
      await page.textContent('.mkt-detail h1'))

    if (SHOTS) await page.screenshot({ path: `${SHOTS}/celebrity.png` })
    await ctx.close()
  }

  /* ================= the Genie 100 ================= */
  {
    const ctx = await context(browser)
    const page = await ctx.newPage()

    await go(page, '/')
    check('the front page leads with the chart', await page.isVisible('.b-chart'))
    check('and it is the week in progress, not last week',
      /this week so far/i.test(await page.textContent('.b-chart-title')),
      await page.textContent('.b-chart-title'))
    check('with a countdown to the freeze',
      /freezes in/i.test(await page.textContent('.b-chart-clock')), await page.textContent('.b-chart-clock'))
    check('there is only one ranked board on the page now',
      !(await page.isVisible('.b-movers')), 'the live movers strip is gone')

    const lead = await page.textContent('.b-chart-one-name')
    check('the leader is named at the top', Boolean(lead?.trim()), lead)
    check('the names behind them run down one column',
      (await page.$$eval('.b-chart-list li', (ls) => ls.length)) >= 2)

    await page.click('.b-chart-foot a[href="/chart/live"]')
    await page.waitForTimeout(400)
    check('"see all" opens the live chart', new URL(page.url()).pathname === '/chart/live', page.url())

    /* ---- the two states ---- */
    check('the chart offers both states', (await page.$$eval('.ch-states a', (a) => a.length)) === 2)
    check('and says which one is showing',
      (await page.textContent('.ch-states a.on'))?.toLowerCase().includes('this week'),
      await page.textContent('.ch-states a.on'))
    check('a live chart says it is provisional',
      /provisional/i.test(await page.textContent('.ch-states')))
    check('and counts down to Monday', await page.isVisible('.ch-week .cd'))

    /* ---- the bars ---- */
    const bars = await page.$$eval('.ch-bar-fill', (els) => els.map((e) => parseFloat(e.style.width)))
    check('every row carries a score bar', bars.length >= 2, `${bars.length} bars`)
    check('bars are anchored at zero, so weeks can be compared',
      bars.every((w) => w > 0 && w <= 100) && bars[0] < 100, `widest ${bars[0]}%`)
    check('and they fall with the ranking',
      bars.every((w, i) => i === 0 || w <= bars[i - 1] + 0.5), bars.slice(0, 5).join(' '))

    await page.click('.ch-states a[href="/chart"]')
    await page.waitForTimeout(400)
    check('the other state is one tap away', new URL(page.url()).pathname === '/chart', page.url())
    check('and it is the published edition',
      /published/i.test(await page.textContent('.ch-week')), await page.textContent('.ch-week'))
    check('the method is on the page, not hidden behind a link',
      /averaged across the whole week/i.test(await page.textContent('.ch-method')))

    // An edition is a permanent address — this is what a shared link opens.
    await go(page, '/chart/2026-W37')
    check('an old edition opens at its own address',
      (await page.textContent('.ch-week'))?.includes('7–13 September'), await page.textContent('.ch-week'))

    await go(page, '/chart/2026-W01')
    check('a week that was never published says so rather than erroring',
      await page.isVisible('.ch-notyet'))

    await ctx.close()
  }

  /* ================= the links people already have ================= */
  {
    const ctx = await context(browser)
    const page = await ctx.newPage()

    await go(page, '/#/story/tour')
    await page.waitForTimeout(400)
    const url = new URL(page.url())
    check('an old #/story link lands on the new path',
      url.pathname === '/story/tour' && url.hash === '', page.url())
    check('and shows the story it always meant',
      (await page.textContent('.b-story h1'))?.includes('Zendaya'), await page.textContent('.b-story h1'))

    await go(page, '/#/market')
    await page.waitForTimeout(400)
    check('an old #/market link lands on the market', new URL(page.url()).pathname === '/market', page.url())

    // The Watch screen's QA switches travelled in the fragment for months.
    await go(page, '/#/watch?seg=quiz&speed=8')
    await page.waitForTimeout(500)
    const watch = new URL(page.url())
    check('an old #/watch link keeps its switches',
      watch.pathname === '/watch' && watch.searchParams.get('seg') === 'quiz', page.url())

    await ctx.close()
  }

  /* ================= the share control ================= */
  {
    // No navigator.share: the desktop path, which is the one with a menu.
    const ctx = await context(browser)
    await ctx.addInitScript(() => { try { delete Navigator.prototype.share } catch { /* already absent */ } })
    const page = await ctx.newPage()

    await go(page, '/story/elk')
    check('a story has a share button', await page.isVisible('.b-story-top .sh-btn'))

    await page.click('.b-story-top .sh-btn')
    await page.waitForTimeout(200)
    check('it opens a menu rather than doing nothing', await page.isVisible('.sh-menu'))

    const targets = await page.$$eval('.sh-menu a', (as) => as.map((a) => ({ label: a.textContent.trim(), href: a.href })))
    check('the menu offers somewhere to send it', targets.length >= 3, targets.map((t) => t.label).join(', '))
    const wa = targets.find((t) => t.href.startsWith('https://wa.me/'))
    check('and the link it sends is this story, absolute',
      Boolean(wa) && decodeURIComponent(wa.href).includes('/story/elk'), wa?.href)

    // Copy: the thing most people actually use.
    await page.click('.sh-item:has-text("Copy link")')
    await page.waitForTimeout(250)
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    check('copy link puts the page address on the clipboard',
      clip === `${BASE}/story/elk`, clip)

    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    check('escape closes the menu', !(await page.isVisible('.sh-menu')))

    await go(page, '/chart')
    check('the chart can be shared', await page.isVisible('.ch-head-right .sh-btn'))
    await page.click('.ch-head-right .sh-btn')
    await page.waitForTimeout(200)
    const chartLink = await page.$eval('.sh-menu a[href^="https://wa.me/"]', (a) => decodeURIComponent(a.href))
    check('and the link it sends is that edition, not just the site',
      /\/chart\/2026-W38/.test(chartLink), chartLink)
    check('with the number one in the message', /number one/i.test(chartLink), chartLink)
    await page.keyboard.press('Escape')

    // The card is the thing people actually pass on, so it is on the page
    // rather than only in a crawler's head.
    await go(page, '/chart')
    const card = await page.$('.ch-card img')
    check('the share card is shown on the page', Boolean(card))
    if (card) {
      const drawn = await card.evaluate((img) => img.complete && img.naturalWidth > 0)
      check('and it actually draws', drawn, drawn ? '' : 'the image did not load')
      check('with a way to take it', await page.isVisible('.ch-card a[download]'))
    }

    await go(page, '/market')
    check('the market board can be shared', await page.isVisible('.mkt-head-right .sh-btn'))
    const movers = await page.$$('.mkt-mv-item .sh-btn')
    check('and so can each mover on it', movers.length >= 2, `${movers.length} movers`)

    if (movers.length) {
      await movers[0].click()
      await page.waitForTimeout(200)
      const first = await page.$eval('.sh-menu a[href^="https://wa.me/"]', (a) => decodeURIComponent(a.href))
      check('a mover shares that celebrity, not the board', /\/market\/[a-z-]+/.test(first), first)
    }

    if (SHOTS) await page.screenshot({ path: `${SHOTS}/share-market.png` })
    await ctx.close()
  }

  /* ================= the phone path ================= */
  {
    const ctx = await context(browser, {
      viewport: { width: 390, height: 844 },
      hasTouch: true, isMobile: true,
    })
    await ctx.addInitScript(() => {
      window.__shared = null
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: (data) => { window.__shared = data; return Promise.resolve() },
      })
    })
    const page = await ctx.newPage()
    await go(page, '/story/elk')
    await page.click('.b-story-top .sh-btn')
    await page.waitForTimeout(250)

    const shared = await page.evaluate(() => window.__shared)
    check('on a phone it uses the system share sheet', Boolean(shared), JSON.stringify(shared))
    check('and hands it the headline and the real link',
      shared?.title?.includes('Elk jumps') && shared?.url === `${BASE}/story/elk`, JSON.stringify(shared))
    check('no menu is opened on top of the sheet', !(await page.isVisible('.sh-menu')))

    // A phone is where sharing happens, so the row share must survive the
    // narrow layout — it was the first thing display:none took last time.
    await go(page, '/chart/live')
    const rowShares = await page.$$('.ch-row .sh-btn')
    check('a chart row can be shared on a phone', rowShares.length >= 2, `${rowShares.length} rows`)
    if (rowShares.length) {
      await rowShares[0].click()
      await page.waitForTimeout(250)
      const what = await page.evaluate(() => window.__shared)
      check('and it shares that name, not the chart',
        /on The Genie 100$/.test(what?.title || '') && /\/market\//.test(what?.url || ''),
        JSON.stringify(what))
    }

    await ctx.close()
  }

  /* ================= the bell ================= */
  {
    const ctx = await context(browser)
    const page = await ctx.newPage()

    // First visit: the mark gets set and nothing is claimed to be new.
    await go(page, '/')
    check('a first visit has a quiet bell', !(await page.isVisible('.nt-count')))

    // Come back later, following somebody, with the mark in the past.
    await page.evaluate(() => {
      localStorage.setItem('gossip-genie-prefs', JSON.stringify({ follows: ['person:Zendaya'], quizStreak: 0 }))
      localStorage.setItem('gossip-genie-notices', JSON.stringify({
        seen: {}, lastOpenedAt: Date.now() - 6 * 3600_000, firstSeenAt: Date.now() - 86400_000,
      }))
    })
    await go(page, '/')

    const badge = await page.textContent('.nt-count').catch(() => null)
    check('coming back to new stories rings the bell', Boolean(badge), `badge ${badge}`)

    await page.click('.nt-btn')
    await page.waitForTimeout(250)
    check('the panel opens', await page.isVisible('.nt-panel'))

    const items = await page.$$eval('.nt-item b', (bs) => bs.map((b) => b.textContent.trim()))
    check('a followed name is in it', items.some((t) => /Zendaya/.test(t)), items.join(' | '))
    check('a sharp move is in it', items.some((t) => /up 18\.4/.test(t)), items.join(' | '))
    check('and so is what is simply new', items.some((t) => /new stor/.test(t)), items.join(' | '))

    check('opening it clears the count', !(await page.isVisible('.nt-count')))

    // A notification is a link, and it has to go where it says.
    await page.click('.nt-item a')
    await page.waitForTimeout(300)
    check('tapping one goes where it points', new URL(page.url()).pathname !== '/', page.url())

    await go(page, '/')
    check('and it stays read on the next visit', !(await page.isVisible('.nt-count')))

    if (SHOTS) {
      await page.evaluate(() => {
        localStorage.setItem('gossip-genie-notices', JSON.stringify({
          seen: {}, lastOpenedAt: Date.now() - 6 * 3600_000, firstSeenAt: Date.now() - 86400_000,
        }))
      })
      await go(page, '/')
      await page.click('.nt-btn')
      await page.waitForTimeout(300)
      await page.screenshot({ path: `${SHOTS}/notices.png` })
    }
    await ctx.close()
  }

  await browser.close()
  const bad = results.filter((r) => !r.ok)
  console.log(bad.length ? `\n${bad.length} of ${results.length} checks failed.` : `\nAll ${results.length} checks passed.`)
  process.exit(bad.length ? 1 : 0)
}

run().catch((err) => { console.error(err); process.exit(2) })
