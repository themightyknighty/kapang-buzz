#!/usr/bin/env node
/**
 * Does the wide cut actually move?
 *
 * The pipeline gathers up to four reviewed frames for every story, and for
 * health, facts and bizarre a licence-free video clip — all of it under the
 * heading "the vertical screen needs movement". The 16:9 cut was using the
 * first still and ignoring the rest, so a 60-second top story was one
 * photograph with a slow zoom on it while three more sat unused in the same
 * payload, and footage never played at all.
 *
 * The sample feed carries neither, so nothing in normal development exercises
 * this. These fixtures do: four frames of flat, unmistakable colour, and a
 * three-second test clip.
 *
 *   node scripts/wide-motion-audit.mjs --url http://localhost:5173
 *
 * Playwright is deliberately not a dependency of this project:
 *   npm i --no-save playwright && npx playwright install chromium
 */
import { readFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

/*
 * The clip goes in as a data URI rather than over the fixture route.
 *
 * A route that fulfils a whole file in one go serves no byte ranges, and the
 * media element gives up on it — which lands in the player's own
 * fall-back-to-stills path and looks exactly like the feature not working.
 * Inlining it takes the network out of the question entirely.
 */
const CLIP = `data:video/webm;base64,${(await readFile(join(FIXTURES, 'clip.webm'))).toString('base64')}`
const argv = process.argv.slice(2)
const value = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const BASE = value('--url', 'http://localhost:5173')
const SHOTS = value('--shots', null)

const frame = (n) => ({
  url: `${BASE}/__test/reel-${n}.jpg`, width: 1600, height: 900, kind: 'scene',
  alt: `frame ${n}`, credit: 'Test pattern', licence: 'CC0', provider: 'local',
  review: { version: 'vision-1', verdict: 'ok' },
})

const story = (id, strand, over = {}) => ({
  id, strand, publishedAt: new Date(Date.now() - 3600_000).toISOString(),
  headline: `Story ${id}`, caption: 'A caption for the test story.',
  whyTrending: 'Testing.', people: [], outlets: 9, keyFacts: ['one', 'two', 'three'],
  image: frame(1), gallery: [frame(1), frame(2), frame(3), frame(4)], ...over,
})

const FEED = {
  generatedAt: new Date(Date.now() - 5000).toISOString(),
  counts: { total: 8 },
  stories: [
    story('a', 'celebrity', { outlets: 40 }),
    story('b', 'celebrity'), story('c', 'celebrity'), story('d', 'celebrity'),
    story('f', 'facts'), story('i', 'facts'), story('g', 'health'),
    // Video only ever attaches to the non-celebrity strands, because there is
    // no licence-free footage of celebrities. Bizarre gets its own hero
    // segment (Weird But True), so that is where this can be seen.
    // The stamp is what makes a clip playable: footage now goes through the
    // same picture desk the stills pass, and anything unvetted is refused.
    story('w', 'bizarre', { video: { url: CLIP, credit: 'Test clip', licence: 'CC0', review: { version: 'vision-1', saw: 'A test pattern.' } } }),
  ],
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? `  — ${detail}` : ''}`)
}

/** The colour at the centre of the hero, which names the frame on air. */
const heroColour = (page) => page.evaluate(async () => {
  const img = [...document.querySelectorAll('.w-hero.reel .w-frame.on img')].find((i) => i.naturalWidth)
  if (!img) return null
  return img.src.split('/').pop().split('?')[0]
})

const run = async () => {
  if (SHOTS) await mkdir(SHOTS, { recursive: true })
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  await ctx.route('**/api/feed', (r) => r.fulfill({ json: FEED }))
  await ctx.route('**/api/market', (r) => r.fulfill({ status: 500, body: '{}' }))
  await ctx.route('**/__test/*', async (r) => {
    const name = r.request().url().split('/').pop().split('?')[0]
    const type = name.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg'
    try { r.fulfill({ contentType: type, body: await readFile(join(FIXTURES, name)) }) }
    catch { r.fulfill({ status: 404, body: 'no such fixture' }) }
  })
  const page = await ctx.newPage()

  /* ---- the reel cuts ---- */
  // 10x speed: a 60-second top story with four frames holds each for 14s, so
  // this watches roughly two minutes of show in twelve seconds.
  await page.goto(`${BASE}/watch?seg=top&speed=10&r=${Math.random()}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.w-hero', { timeout: 10_000 })
  await page.waitForTimeout(1200)

  const seen = new Set()
  const moves = new Set()
  for (let i = 0; i < 26; i++) {
    const f = await heroColour(page)
    if (f) seen.add(f)
    // Sampled as we go: by the end of this walk the show has moved on to a
    // segment with no reel in it, and there would be nothing left to measure.
    for (const m of await page.evaluate(() => {
      const out = []
      for (const el of document.querySelectorAll('.w-hero.reel .w-frame.on')) {
        const img = el.querySelector('img')
        const name = img && getComputedStyle(img).animationName
        if (name && name !== 'none') out.push(`${[...el.classList].find((c) => c.startsWith('ken-'))}=${name}`)
      }
      return out
    })) moves.add(m)
    if (SHOTS && i % 8 === 0) await page.screenshot({ path: `${SHOTS}/reel-${i}.png` })
    await page.waitForTimeout(700)
  }
  check('the wide hero is a reel, not one still', seen.size > 1, `${seen.size} frames on air: ${[...seen].join(', ')}`)
  check('it works through the frames rather than flipping between two', seen.size >= 3, `${seen.size} of 4`)

  /* ---- each shot moves, and consecutive shots do not move alike ---- */
  check('the shot on air has a move of its own', moves.size > 0, [...moves].join(' '))
  check('consecutive shots do not all move the same way', moves.size > 1, `${moves.size} distinct moves`)

  /* ---- footage plays ---- */
  await page.goto(`${BASE}/watch?seg=weird&speed=1&r=${Math.random()}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  // The video story is a plain story segment; walk forward until it is on air.
  let video = null
  for (let i = 0; i < 12 && !video; i++) {
    video = await page.evaluate(() => {
      const v = document.querySelector('.w-hero video.w-video')
      if (!v) return null
      return { src: v.src.slice(0, 24), paused: v.paused, muted: v.muted, loop: v.loop, t: v.currentTime, w: v.videoWidth }
    })
    if (!video) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(700) }
  }
  check('a story with footage plays it on the wide cut', Boolean(video), video ? video.src : 'no <video> ever appeared')
  if (video) {
    await page.waitForTimeout(1200)
    const after = await page.evaluate(() => {
      const v = document.querySelector('.w-hero video.w-video')
      return v ? { t: v.currentTime, w: v.videoWidth } : null
    })
    check('the footage is actually running', after && after.t > video.t, `${video.t.toFixed(2)}s → ${after?.t?.toFixed(2)}s`)
    check('the footage is decoded, not a broken source', after && after.w > 0, `${after?.w}px wide`)
    check('it is muted and looping, as a channel bed must be', video.muted && video.loop)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/video.png` })
  }

  /* ---- an unvetted clip never goes to air ---- */
  {
    /*
     * The one that let the ducks through. Footage used to be the first search
     * hit with an acceptable licence and no relevance check at all, and a
     * report about an elk jumping on a car was illustrated with ducks.
     * Stories live in the feed for three days, so the player refuses anything
     * without a review stamp rather than waiting for them to age out.
     */
    const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    await ctx3.route('**/api/feed', (r) => r.fulfill({
      json: { ...FEED, stories: FEED.stories.map((s) => (s.id === 'w'
        ? { ...s, video: { url: CLIP, credit: 'Unvetted', licence: 'CC0' } } : s)) },
    }))
    await ctx3.route('**/api/market', (r) => r.fulfill({ status: 500, body: '{}' }))
    await ctx3.route('**/__test/*', async (r) => {
      const name = r.request().url().split('/').pop().split('?')[0]
      try { r.fulfill({ contentType: 'image/jpeg', body: await readFile(join(FIXTURES, name)) }) }
      catch { r.fulfill({ status: 404, body: 'no such fixture' }) }
    })
    const p3 = await ctx3.newPage()
    await p3.goto(`${BASE}/watch?seg=weird&speed=1&r=${Math.random()}`, { waitUntil: 'networkidle' })
    await p3.waitForSelector('.w-hero', { timeout: 10_000 })
    await p3.waitForTimeout(2200)
    const unvetted = await p3.evaluate(() => ({
      video: Boolean(document.querySelector('.w-hero video')),
      reel: Boolean(document.querySelector('.w-hero.reel .w-frame.on img')),
    }))
    check('a clip the picture desk has not passed never goes to air',
      !unvetted.video && unvetted.reel, `video:${unvetted.video} reel:${unvetted.reel}`)
    await ctx3.close()
  }

  /* ---- a clip the browser cannot play falls back to stills ---- */
  {
    /*
     * Found by accident: the first version of this fixture was H.264, which
     * stock Chromium cannot decode, and the channel quietly showed the reel
     * instead. That is exactly the right behaviour and worth pinning down —
     * a dead clip must never leave a black frame on air.
     */
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    await ctx2.route('**/api/feed', (r) => r.fulfill({
      json: { ...FEED, stories: FEED.stories.map((s) => (s.id === 'w'
        ? { ...s, video: { url: 'data:video/mp4;base64,AAAAAA', credit: 'Broken', licence: 'CC0' } } : s)) },
    }))
    await ctx2.route('**/api/market', (r) => r.fulfill({ status: 500, body: '{}' }))
    await ctx2.route('**/__test/*', async (r) => {
      const name = r.request().url().split('/').pop().split('?')[0]
      try { r.fulfill({ contentType: 'image/jpeg', body: await readFile(join(FIXTURES, name)) }) }
      catch { r.fulfill({ status: 404, body: 'no such fixture' }) }
    })
    const p2 = await ctx2.newPage()
    await p2.goto(`${BASE}/watch?seg=weird&speed=1&r=${Math.random()}`, { waitUntil: 'networkidle' })
    await p2.waitForSelector('.w-hero', { timeout: 10_000 })
    await p2.waitForTimeout(2500)
    const fell = await p2.evaluate(() => ({
      video: Boolean(document.querySelector('.w-hero video')),
      reel: Boolean(document.querySelector('.w-hero.reel .w-frame.on img')),
    }))
    check('a clip the browser cannot play falls back to the stills', !fell.video && fell.reel,
      `video:${fell.video} reel:${fell.reel}`)
    await ctx2.close()
  }

  /* ---- the lower third arrives ---- */
  await page.goto(`${BASE}/watch?seg=story&speed=1&r=${Math.random()}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.w-l3', { timeout: 10_000 })
  const l3 = await page.evaluate(() => {
    const el = document.querySelector('.w-l3')
    const kicker = document.querySelector('.w-l3 .k-l3-kicker')
    return {
      bar: getComputedStyle(el).animationName,
      kicker: kicker ? getComputedStyle(kicker).animationName : null,
      delay: kicker ? getComputedStyle(kicker).animationDelay : null,
    }
  })
  check('the lower third is revealed rather than simply appearing',
    l3.bar !== 'none' && l3.kicker !== 'none', `${l3.bar} / ${l3.kicker} @ ${l3.delay}`)

  // ...and the fitter still measures the copy correctly underneath it.
  await page.waitForTimeout(1400)
  const cut = await page.evaluate(() => {
    const el = document.querySelector('.w-l3 .k-l3-copy')
    return el ? { over: el.scrollHeight - el.clientHeight, scale: getComputedStyle(el).getPropertyValue('--k-tscale') } : null
  })
  check('the reveal did not confuse the text fitter', cut && cut.over <= 1, cut ? `${cut.over}px over at scale ${cut.scale}` : 'no copy column')

  await browser.close()
  const bad = results.filter((r) => !r.ok)
  console.log(bad.length ? `\n${bad.length} of ${results.length} checks failed.` : `\nAll ${results.length} checks passed.`)
  process.exit(bad.length ? 1 : 0)
}

run().catch((err) => { console.error(err); process.exit(2) })
