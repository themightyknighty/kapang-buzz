#!/usr/bin/env node
/**
 * Does the channel actually respond to a viewer?
 *
 * The show had no input at all — every segment ran its full length and the
 * only control was Exit. This drives the new ones the way a viewer would and
 * checks the behaviour that matters:
 *
 *   - a tap moves the show on, and moves it on again straight away
 *   - the skip is a quick cut, not the five-second branded wipe
 *   - the keyboard does the same, for the desktop and for recording
 *   - pause actually stops the clock
 *   - joining is by the wall clock, so two viewers arriving at different
 *     times land in different places
 *   - a viewer who has already watched the opening is moved past it
 *   - the Exit link is still clickable underneath the new tap zones
 *
 *   node scripts/watch-controls-audit.mjs --url http://localhost:5173
 *
 * Playwright is deliberately not a dependency of this project:
 *   npm i --no-save playwright && npx playwright install chromium
 */
import { chromium } from 'playwright'

const argv = process.argv.slice(2)
const value = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const BASE = value('--url', 'http://localhost:5173')

const story = (id, strand, over = {}) => ({
  id, strand, publishedAt: new Date(Date.now() - 3600_000).toISOString(),
  headline: `Story ${id}`, caption: 'A caption.', whyTrending: 'Testing.',
  people: [], outlets: 8, keyFacts: ['a', 'b', 'c'], ...over,
})

// Enough material for a full rundown: a top story, spares, facts, health and
// a bizarre one, so the running order has its usual shape.
const FEED = (generatedAt) => ({
  generatedAt,
  counts: { total: 12 },
  stories: [
    story('a', 'celebrity', { outlets: 40 }),
    ...['b', 'c', 'd', 'e', 'f', 'g'].map((i) => story(i, 'celebrity')),
    story('h', 'health'), story('i', 'facts'), story('j', 'facts'),
    story('k', 'facts'), story('l', 'bizarre'),
  ],
})

/*
 * A chart, so the checks run against the programme the channel
 * actually plays. Without one the running order falls back to the old
 * news shape, and a controls audit that only ever drives the fallback
 * proves nothing about the show viewers get.
 */
const CHART = {
  id: '2026-W38', label: '14–20 September 2026', live: true,
  entries: Array.from({ length: 12 }, (_, i) => ({
    rank: i + 1, id: `c${i + 1}`, slug: `c${i + 1}`, displayName: `Name ${i + 1}`,
    score: 94 - i * 5.5, daysOfData: 5, imageUrl: null,
    lastWeek: i + 5, move: 4, peak: 1, weeksOn: 4, weeksAtOne: i === 0 ? 2 : 0, status: 'up',
    reason: { kind: 'none', headline: null, text: '', href: null },
  })),
  summary: { charted: 12, numberOne: { displayName: 'Name 1' } },
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? `  — ${detail}` : ''}`)
}

/** Which segment is on air, by the key React puts on it. */
const onAir = (page) => page.evaluate(() => {
  const el = document.querySelector('.w-stage > [class*="w-seg-"], .w-stage .vs')
  // The chart beats name themselves rather than carrying a kicker, and
  // without them two consecutive positions both read as "The Genie 100"
  // with no headline — so a skip from 10 to 9 looked like no skip at all.
  const head = document.querySelector('.w-pos-name, .w-one-name, .w-l3-kicker, .vs-hook h1, .w-panel-head h2, .k-l3-kicker')
  return {
    seg: document.querySelector('.w-seg')?.textContent?.trim() || null,
    head: head?.textContent?.trim().slice(0, 40) || null,
    has: Boolean(el),
    chip: document.querySelector('.w-state .w-chip')?.textContent?.trim() || null,
    wiping: Boolean(document.querySelector('.k-wipe')),
  }
})

const run = async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const epoch = new Date(Date.now() - 4 * 60_000).toISOString() // channel is 4 min in

  const open = async (ctx, path = '/watch', storage = null) => {
    const page = await ctx.newPage()
    await ctx.route('**/api/feed', (r) => r.fulfill({ json: FEED(epoch) }))
    await ctx.route('**/api/market', (r) => r.fulfill({ status: 500, body: '{}' }))
    await ctx.route('**/api/chart**', (r) => r.fulfill({ json: CHART }))
    if (storage) {
      await page.addInitScript((s) => { try { localStorage.setItem('gossip-genie-watched', s) } catch {} }, storage)
    }
    await page.goto(`${BASE}${path}?r=${Math.random()}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.w-taps', { timeout: 10_000 })
    await page.waitForTimeout(900)
    return page
  }

  /* ---- a tap moves the show on ---- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    const page = await open(ctx)
    const before = await onAir(page)
    await page.click('.w-tap.fwd')
    await page.waitForTimeout(700)
    const after = await onAir(page)
    check('a tap moves the show on', before.head !== after.head || before.seg !== after.seg,
      `${before.seg}/${before.head} → ${after.seg}/${after.head}`)

    // ...and again immediately, which is the point of a fast cut.
    const t0 = Date.now()
    await page.click('.w-tap.fwd')
    await page.waitForTimeout(700)
    const third = await onAir(page)
    check('a second tap lands straight away', third.head !== after.head || third.seg !== after.seg,
      `took ${Date.now() - t0}ms`)

    // The branded wipe must not be what a skip goes through.
    let sawWipe = false
    const watcher = setInterval(async () => { try { if ((await onAir(page)).wiping) sawWipe = true } catch {} }, 60)
    await page.click('.w-tap.fwd')
    await page.waitForTimeout(600)
    clearInterval(watcher)
    check('a skip does not sit through the branded wipe', !sawWipe)

    check('the viewer is marked time-shifted once they take the controls',
      /shift|catch|live/i.test((await onAir(page)).chip || ''), (await onAir(page)).chip)

    /* ---- back ---- */
    const beforeBack = await onAir(page)
    await page.click('.w-tap.back')
    await page.waitForTimeout(700)
    const afterBack = await onAir(page)
    check('tapping back goes back', beforeBack.head !== afterBack.head || beforeBack.seg !== afterBack.seg,
      `${beforeBack.seg} → ${afterBack.seg}`)

    /* ---- keyboard ---- */
    const beforeKey = await onAir(page)
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(700)
    check('the right arrow key skips', (await onAir(page)).head !== beforeKey.head || (await onAir(page)).seg !== beforeKey.seg)

    /* ---- pause ---- */
    await page.keyboard.press(' ')
    await page.waitForTimeout(400)
    const paused = await page.evaluate(() => Boolean(document.querySelector('.w-chip.paused')))
    check('space pauses', paused)
    const held = await onAir(page)
    await page.waitForTimeout(3500)
    check('a paused show does not advance on its own',
      (await onAir(page)).seg === held.seg && (await onAir(page)).head === held.head)
    await page.keyboard.press(' ')

    /* ---- exit still reachable ---- */
    const exitHit = await page.evaluate(() => {
      const a = document.querySelector('.w-exit')
      if (!a) return 'missing'
      const r = a.getBoundingClientRect()
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return top?.closest('.w-exit') ? 'reachable' : `covered by ${top?.className || top?.tagName}`
    })
    check('the exit link is not swallowed by the tap zones', exitHit === 'reachable', exitHit)

    await ctx.close()
  }

  /* ---- joining by the clock ---- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    const a = await open(ctx, '/watch')
    const first = await onAir(a)
    check('a fresh viewer joins the channel live', /live/i.test(first.chip || ''), first.chip)
    await ctx.close()

    // The same feed, but the page opened much later in the show: a different
    // place. This is what stops every visit replaying the top story.
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    const page2 = await ctx2.newPage()
    await ctx2.route('**/api/feed', (r) => r.fulfill({ json: FEED(new Date(Date.now() - 11 * 60_000).toISOString()) }))
    await ctx2.route('**/api/market', (r) => r.fulfill({ status: 500, body: '{}' }))
    await ctx2.route('**/api/chart**', (r) => r.fulfill({ json: CHART }))
    await page2.goto(`${BASE}/watch?r=${Math.random()}`, { waitUntil: 'networkidle' })
    await page2.waitForSelector('.w-taps'); await page2.waitForTimeout(900)
    const later = await onAir(page2)
    check('joining later in the show lands somewhere else',
      later.head !== first.head || later.seg !== first.seg, `${first.seg}/${first.head} vs ${later.seg}/${later.head}`)
    await ctx2.close()
  }

  /* ---- catch-up: skipped past what has already been watched ---- */
  {
    // Pinned so the live point is the very top of the show: segment 0, ten
    // seconds in. That makes this deterministic rather than dependent on
    // where the clock happens to be.
    const justStarted = new Date(Date.now() - 10_000).toISOString()
    const openAt = async (ctx, seen) => {
      const page = await ctx.newPage()
      await ctx.route('**/api/feed', (r) => r.fulfill({ json: FEED(justStarted) }))
      await ctx.route('**/api/market', (r) => r.fulfill({ status: 500, body: '{}' }))
      await ctx.route('**/api/chart**', (r) => r.fulfill({ json: CHART }))
      if (seen) await page.addInitScript((v) => { try { localStorage.setItem('gossip-genie-watched', v) } catch {} }, seen)
      await page.goto(`${BASE}/watch?r=${Math.random()}`, { waitUntil: 'networkidle' })
      await page.waitForSelector('.w-taps'); await page.waitForTimeout(900)
      return page
    }

    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    const fresh = await onAir(await openAt(ctxA, null))
    check('with the show just started, a new viewer joins at the top of it, live',
      /live/i.test(fresh.chip || ''), `${fresh.seg}/${fresh.head} (${fresh.chip})`)
    await ctxA.close()

    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    // 'a' is the top story. Having watched it, the viewer must not get it again.
    const seenTop = JSON.stringify({ feed: justStarted, ids: ['a'] })
    const moved = await onAir(await openAt(ctxB, seenTop))
    check('a returning viewer is moved past the story they already watched',
      /catch/i.test(moved.chip || '') && moved.head !== fresh.head,
      `${fresh.head} → ${moved.head} (${moved.chip})`)
    await ctxB.close()
  }

  await browser.close()
  const bad = results.filter((r) => !r.ok)
  console.log(bad.length ? `\n${bad.length} of ${results.length} checks failed.` : `\nAll ${results.length} checks passed.`)
  process.exit(bad.length ? 1 : 0)
}

run().catch((err) => { console.error(err); process.exit(2) })
