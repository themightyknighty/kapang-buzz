import test from 'node:test'
import assert from 'node:assert/strict'
import { readPortraitPage, licenceAccepted, portraitFor, portraitsDue, collect, supersededByPolicy } from './portrait.mjs'

const imageinfo = (over = {}) => ({
  title: 'File:Zendaya 2019.jpg',
  imageinfo: [{
    url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Zendaya_2019.jpg',
    thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Zendaya_2019.jpg/400px-Zendaya_2019.jpg',
    thumbwidth: 400, thumbheight: 600, descriptionurl: 'https://commons.wikimedia.org/wiki/File:Zendaya_2019.jpg',
    extmetadata: {
      LicenseShortName: { value: 'CC BY-SA 4.0' },
      LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' },
      Artist: { value: '<a href="/wiki/User:X">Harald Krichel</a>' },
    },
    ...over,
  }],
})

test('a picture under a licence we accept is publishable', () => {
  const p = readPortraitPage(imageinfo())
  assert.equal(p.url, 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Zendaya_2019.jpg/400px-Zendaya_2019.jpg')
  assert.equal(p.credit, 'Harald Krichel', 'the credit is the photographer, not their user-page markup')
  assert.equal(p.licence, 'CC BY-SA 4.0')
  assert.equal(p.provider, 'Wikimedia Commons')
})

test('an all-rights-reserved picture is refused', () => {
  const page = imageinfo()
  page.imageinfo[0].extmetadata.LicenseShortName.value = 'All rights reserved'
  assert.equal(readPortraitPage(page), null)
})

test('a picture Commons marks with restrictions is refused', () => {
  // Trademark and the rest stay refused. Personality rights are the one
  // exception, and they are handled on their own below.
  const page = imageinfo()
  page.imageinfo[0].extmetadata.Restrictions = { value: 'trademarked' }
  assert.equal(readPortraitPage(page), null)
})

test('the licence allowlist is the news pipeline\'s, not a second one', () => {
  assert.ok(licenceAccepted('CC0'))
  assert.ok(licenceAccepted('Public domain'))
  assert.ok(licenceAccepted('CC BY 3.0'))
  assert.ok(!licenceAccepted('CC BY-NC 4.0'), 'non-commercial is not a licence this product can use')
  assert.ok(!licenceAccepted(''))
})

/* ---------------- the lookup chain ---------------- */

const stub = (responses) => {
  const calls = []
  return {
    calls,
    fetchImpl: async (url) => {
      calls.push(url)
      const hit = Object.entries(responses).find(([k]) => url.includes(k))
      if (!hit) throw new Error(`unstubbed ${url}`)
      return { ok: true, json: async () => hit[1] }
    },
  }
}

const HUMAN = {
  'wikidata.org': { entities: { Q193676: { claims: {
    P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }],
    P18: [{ mainsnak: { datavalue: { value: 'Zendaya 2019.jpg' } } }],
  } } } },
  'commons.wikimedia.org': { query: { pages: { 1: imageinfo() } } },
}

test('a portrait is resolved through Wikidata, not through a search', async () => {
  const { fetchImpl, calls } = stub(HUMAN)
  const p = await portraitFor({ id: 'zendaya', wikidataId: 'Q193676' }, { fetchImpl })
  assert.equal(p.licence, 'CC BY-SA 4.0')
  assert.equal(p.wikidataId, 'Q193676')
  assert.ok(!calls.some((u) => u.includes('srsearch')), 'identity must never come from a search result')
})

test('an entity that is not a person has no portrait', async () => {
  // A Wikipedia page title can belong to a band, a film or an album. A film
  // poster is not a photograph of anybody, and this is the check that once
  // would have stopped the wrong face going out under a headline.
  const log = []
  const { fetchImpl } = stub({
    ...HUMAN,
    'wikidata.org': { entities: { Q7 : { claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q5398426' } } } }], P18: [{ mainsnak: { datavalue: { value: 'Poster.jpg' } } }] } } } },
  })
  assert.equal(await portraitFor({ id: 'band', wikidataId: 'Q7' }, { fetchImpl, log }), null)
  assert.match(log.join(' '), /not a person/)
})

test('a person with no picture on Wikidata resolves to nothing', async () => {
  const { fetchImpl } = stub({
    ...HUMAN,
    'wikidata.org': { entities: { Q9: { claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }] } } } },
  })
  assert.equal(await portraitFor({ id: 'x', wikidataId: 'Q9' }, { fetchImpl }), null)
})

/* ---------------- scheduling ---------------- */

const roster = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
const now = Date.parse('2026-09-17T12:00:00Z')
const daysAgo = (n) => new Date(now - n * 86400000).toISOString()

// A stored answer carries the rules it was reached under.
const CURRENT = { personality: true }
const hit = (days) => ({ at: daysAgo(days), portrait: { url: 'x' }, policy: CURRENT })
const miss = (days, policy = CURRENT) => ({ at: daysAgo(days), portrait: null, policy })

test('whoever has never been looked up comes first', () => {
  const due = portraitsDue(roster, { a: hit(40), b: hit(1) }, { now, limit: 3 })
  assert.deepEqual(due.map((c) => c.id), ['c', 'a'], 'the unknown before the stale; the fresh not at all')
})

test('a celebrity we found nothing for is left alone, not asked again every tick', () => {
  const due = portraitsDue(roster, { a: miss(1), b: hit(1), c: hit(1) }, { now })
  assert.deepEqual(due, [], 'a recorded miss is an answer, and answers are not re-asked')
})

test('relaxing the rules re-opens the misses they caused', () => {
  /*
   * The decision that the market counts as editorial use would otherwise have
   * changed nothing for a month: every celebrity refused on personality
   * rights is stored as having no picture, and a stored answer is not
   * re-asked until its refresh falls due.
   */
  const stored = {
    a: miss(1, { personality: false }),   // refused under the old rule
    b: miss(1, { personality: true }),    // genuinely has nothing usable
    c: hit(1),                            // already has a picture
  }
  const due = portraitsDue(roster, stored, { now, allowPersonalityRights: true })
  assert.deepEqual(due.map((x) => x.id), ['a'], 'only the one the old rule cost us')

  // ...and nothing re-opens while the rule stands.
  assert.deepEqual(portraitsDue(roster, stored, { now, allowPersonalityRights: false }), [])
})

test('an answer from before the rules were recorded counts as the strict one', () => {
  // Entries written before the policy stamp existed were made under the
  // original rule, which refused these pictures.
  assert.equal(supersededByPolicy({ at: daysAgo(1), portrait: null }, { personality: true }), true)
  assert.equal(supersededByPolicy({ at: daysAgo(1), portrait: null }, { personality: false }), false)
  // A picture we already have is never re-opened by a rule change.
  assert.equal(supersededByPolicy({ at: daysAgo(1), portrait: { url: 'x' } }, { personality: true }), false)
  assert.equal(supersededByPolicy(undefined, { personality: true }), false)
})

test('the batch is capped so a run cannot overrun its window', () => {
  const big = Array.from({ length: 50 }, (_, i) => ({ id: `c${i}` }))
  assert.equal(portraitsDue(big, {}, { now, limit: 6 }).length, 6)
})

/* ---------------- the batch ---------------- */

test('misses are recorded and transient failures are not', async () => {
  const log = []
  let n = 0
  const fetchImpl = async (url) => {
    if (url.includes('wikidata.org')) {
      n++
      if (n === 2) throw new Error('socket hang up')
      return { ok: true, json: async () => HUMAN['wikidata.org'] }
    }
    if (url.includes('commons')) return { ok: true, json: async () => ({ query: { pages: { 1: imageinfo() } } }) }
    throw new Error(`unstubbed ${url}`)
  }
  const { found } = await collect(
    [{ id: 'a', wikidataId: 'Q193676' }, { id: 'b', wikidataId: 'Q193676' }],
    { now, fetchImpl, log, gapMs: 0 },
  )
  assert.ok(found.a.portrait, 'the one that worked is stored')
  assert.ok(!('b' in found), 'a network blip must not be remembered as "this person has no picture"')
  assert.match(log.join(' '), /socket hang up/)
})

test('the batch stops at the run deadline rather than overrunning it', async () => {
  const { fetchImpl } = stub(HUMAN)
  const log = []
  const { found } = await collect(
    Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, wikidataId: 'Q193676' })),
    { now, fetchImpl, log, gapMs: 0, deadline: Date.now() - 1 },
  )
  assert.deepEqual(found, {})
  assert.match(log.join(' '), /deadline/)
})

test('a thumbnail Commons would have to upscale is never used', () => {
  // Commons does not upscale. Ask for 400px of a 300px file and the URL it
  // returns has never been generated, so it answers 400 — a broken avatar.
  const page = imageinfo({ width: 300, height: 450, thumbwidth: 400, thumbheight: 600 })
  const p = readPortraitPage(page)
  assert.equal(p.url, 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Zendaya_2019.jpg', 'falls back to the original')
  assert.equal(p.width, 300)
  assert.equal(p.height, 450)
})

test('a thumbnail smaller than the original is used', () => {
  const p = readPortraitPage(imageinfo({ width: 2000, height: 3000 }))
  assert.match(p.url, /400px-/)
  assert.equal(p.width, 400)
})

test('a personality-rights picture is used, and still carries the flag', () => {
  // Showing someone's portrait beside coverage of that same person is
  // editorial use, and the Celebrity Market counts as editorial. The flag is
  // still recorded so the admin page can say which pictures carry it.
  const page = imageinfo()
  page.imageinfo[0].extmetadata.Restrictions = { value: 'personality' }
  const p = readPortraitPage(page)
  assert.ok(p, 'used by default')
  assert.equal(p.restrictions, 'personality')

  // And the decision is reversible without a deploy.
  assert.equal(readPortraitPage(page, { allowPersonalityRights: false }), null)
})

test('a restriction that is not personality rights is refused even so', () => {
  // Trademark and the rest are a different question from a celebrity's own
  // publicity rights. The decision covers one flag, not the whole field.
  for (const r of ['trademarked', 'insignia', 'currency']) {
    const page = imageinfo()
    page.imageinfo[0].extmetadata.Restrictions = { value: r }
    assert.equal(readPortraitPage(page, { allowPersonalityRights: true }), null, r)
  }
})

test("Commons's own tracking parameters are stripped from the stored URL", () => {
  const page = imageinfo({
    width: 2000, height: 3000,
    thumburl: 'https://thumb.wikimedia.org/x/400px-Z.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo',
  })
  assert.equal(readPortraitPage(page).url, 'https://thumb.wikimedia.org/x/400px-Z.jpg')
})

test('the credit prefers the wording the licensor asked for', () => {
  const page = imageinfo({ width: 2000, height: 3000 })
  page.imageinfo[0].extmetadata.Attribution = { value: '© Glenn Francis, www.PacificProDigital.com' }
  assert.equal(readPortraitPage(page).credit, '© Glenn Francis, www.PacificProDigital.com')
})
