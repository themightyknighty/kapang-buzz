import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkText, checkStory } from './safety.mjs'
import { clusterItems, rootDomain, alreadyCovered, fingerprint } from './cluster.mjs'
import { verify, runQuota, pickCandidates, runIndexFor } from './select.mjs'
import { readGdelt, readRss, readMetaDescription, parseGdeltDate } from './harvest.mjs'
import { parseModelJson, validateDraft, copiesSource } from './writer.mjs'
import { licenceAccepted, readCommonsPage, readNasa, imageLoads, resolveNasaSize, findImage } from './images.mjs'
import { mergeFeed, trendFromDaily, countToday } from './feed.mjs'
import { runPipeline, pullStory, KEYS } from './run.mjs'
import { STRANDS } from './config.mjs'

const item = (strand, title, domain, extra = {}) => ({ strand, title, url: `https://${domain}/${encodeURIComponent(title)}`, domain, seenAt: '2026-09-16T12:00:00Z', ...extra })

/* ---------- safety ---------- */
test('safety blocks crime, death and adult topics for every strand', () => {
  for (const s of ['celebrity', 'health', 'facts', 'bizarre']) {
    assert.equal(checkText('Star arrested after party', s).ok, false)
    assert.equal(checkText('Singer dies aged 80', s).ok, false)
    assert.equal(checkText('Topless photos surface', s).ok, false)
  }
})
test('safety blocks gossip patterns only on celebrity', () => {
  assert.equal(checkText('Couple split after five years', 'celebrity').ok, false)
  assert.equal(checkText('Insiders claim the pair are feuding', 'celebrity').ok, false)
  assert.equal(checkText('Banana split world record attempt', 'bizarre').ok, true)
})
test('safety allows ordinary good news and avoids substring false positives', () => {
  assert.equal(checkText('Actress wins award for new drama series', 'celebrity').ok, true) // "award" is not "war"
  assert.equal(checkText('Talent show judge celebrates 10 years', 'celebrity').ok, true)
  assert.equal(checkText('Clinical trial finds walking helps sleep', 'health').ok, true)
  assert.equal(checkText('Astronomers spot a planet made of diamond', 'facts').ok, true)
})
test('checkStory inspects every field including the quiz', () => {
  const s = { strand: 'facts', headline: 'Octopuses have three hearts', caption: 'ok', body: 'ok', keyFacts: ['fine'], quiz: { statement: 'The octopus was killed', answer: false } }
  assert.equal(checkStory(s).ok, false)
})

/* ---------- clustering ---------- */
test('rootDomain handles www and two-part country suffixes', () => {
  assert.equal(rootDomain('www.bbc.co.uk'), 'bbc.co.uk')
  assert.equal(rootDomain('https://edition.cnn.com/x'), 'cnn.com')
  assert.equal(rootDomain('people.com'), 'people.com')
})
test('the same story from several outlets clusters into one, one item per domain', () => {
  const cs = clusterItems([
    item('celebrity', 'Taylor Example announces new album Midnight Garden', 'people.com'),
    item('celebrity', 'Taylor Example reveals new album Midnight Garden release date', 'variety.com'),
    item('celebrity', 'New album Midnight Garden announced by Taylor Example', 'billboard.com'),
    item('celebrity', 'Taylor Example announces album Midnight Garden', 'people.com'),
    item('celebrity', 'Chef opens restaurant on the moon base set', 'ew.com'),
  ])
  assert.equal(cs.length, 2)
  const big = cs.find((c) => c.items.length > 1)
  assert.deepEqual(big.domains.sort(), ['billboard.com', 'people.com', 'variety.com'])
})
test('clusters never cross strands', () => {
  const cs = clusterItems([
    item('health', 'Walking ten minutes a day improves sleep', 'nih.gov'),
    item('bizarre', 'Walking ten minutes a day improves sleep', 'upi.com'),
  ])
  assert.equal(cs.length, 2)
})
test('alreadyCovered matches by key and by similar headline', () => {
  const [c] = clusterItems([item('facts', 'Astronomers find water on distant moon Europa', 'space.com')])
  assert.equal(alreadyCovered(c, new Set([c.key])), true)
  assert.equal(alreadyCovered(c, new Set(), ['Water found on distant moon Europa by astronomers']), true)
  assert.equal(alreadyCovered(c, new Set(), ['Giant pumpkin sets record']), false)
  assert.equal(fingerprint('B a C'), fingerprint('c b a'))
})

/* ---------- verification and quotas ---------- */
test('celebrity needs two outlets, official sources pass alone elsewhere', () => {
  const [one] = clusterItems([item('celebrity', 'Star announces world tour dates today', 'people.com')])
  assert.equal(verify(one).ok, false)
  const [nasa] = clusterItems([item('facts', 'NASA probe photographs icy moon surface', 'nasa.gov', { publicDomain: true })])
  assert.equal(verify(nasa).ok, true)
  const [blog] = clusterItems([item('bizarre', 'Giant pumpkin weighs as much as a car', 'someblog.net')])
  assert.equal(verify(blog).ok, false)
  const [upi] = clusterItems([item('bizarre', 'Giant pumpkin weighs as much as a car', 'upi.com')])
  assert.equal(verify(upi).ok, true, 'UPI is a trusted single source for bizarre')
  const [bbcCeleb] = clusterItems([item('celebrity', 'Star announces world tour dates today', 'bbc.co.uk')])
  assert.equal(verify(bbcCeleb).ok, false, 'celebrity never accepts a single source')
})
test('three runs add up to exactly 30 a day with 12 celebrity', () => {
  const total = { celebrity: 0, health: 0, facts: 0, bizarre: 0 }
  for (const i of [0, 1, 2]) for (const [k, v] of Object.entries(runQuota(i))) total[k] += v
  assert.deepEqual(total, { celebrity: 12, health: 6, facts: 6, bizarre: 6 })
  assert.equal(Object.values(STRANDS).reduce((a, s) => a + s.perDay, 0), 30)
})
test('run index follows 6am / noon / 5pm Pacific (13, 19, 00 UTC)', () => {
  assert.equal(runIndexFor(new Date('2026-09-16T13:00:00Z')), 0)
  assert.equal(runIndexFor(new Date('2026-09-16T19:00:00Z')), 1)
  assert.equal(runIndexFor(new Date('2026-09-17T00:00:00Z')), 2)
})
test('pickCandidates rejects unsafe and unverified, ranks by coverage', () => {
  const cs = clusterItems([
    item('celebrity', 'Star arrested outside nightclub downtown', 'people.com'),
    item('celebrity', 'Star arrested outside nightclub downtown', 'variety.com'),
    item('celebrity', 'Singer Jo Example wins Album of the Year prize', 'people.com'),
    item('celebrity', 'Jo Example wins Album of the Year prize', 'billboard.com'),
    item('celebrity', 'Jo Example wins Album of Year prize tonight', 'variety.com'),
    item('celebrity', 'Actor Sam Example premieres film in Toronto', 'people.com'),
    item('celebrity', 'Sam Example film premieres in Toronto', 'ew.com'),
  ])
  const { picked, rejected } = pickCandidates(cs, { celebrity: 1 }, { now: Date.parse('2026-09-16T13:00:00Z') })
  assert.equal(picked.length, 2)
  assert.match(picked[0].lead.title, /Album of the Year/)
  assert.ok(rejected.some((r) => /arrested/.test(r.reason)))
})

/* ---------- harvest parsing ---------- */
test('GDELT: parses articles and recognises its rate-limit reply', () => {
  const json = JSON.stringify({ articles: [{ url: 'https://www.people.com/a', title: 'Hello there world', seendate: '20260916T123000Z', domain: 'people.com', language: 'English' }] })
  const [a] = readGdelt(json, 'celebrity')
  assert.equal(a.seenAt, '2026-09-16T12:30:00Z')
  assert.equal(a.domain, 'people.com')
  assert.throws(() => readGdelt('Please limit requests to one every 5 seconds', 'celebrity'), /rate limit/)
  assert.equal(parseGdeltDate('bad'), null)
})
test('RSS and Atom parse with CDATA, entities and enclosures', () => {
  const rss = `<rss><channel><item><title><![CDATA[Webb sees a &quot;cosmic&quot; ring]]></title><link>https://www.nasa.gov/x</link>
    <pubDate>Tue, 15 Sep 2026 14:00:00 GMT</pubDate><description>&lt;p&gt;A ring of dust.&lt;/p&gt;</description>
    <enclosure url="https://www.nasa.gov/img.jpg" type="image/jpeg"/></item></channel></rss>`
  const [r] = readRss(rss, { id: 'nasa', strand: 'facts', url: 'https://www.nasa.gov/feed', publicDomain: true, credit: 'NASA' })
  assert.equal(r.title, 'Webb sees a "cosmic" ring')
  assert.equal(r.summary, 'A ring of dust.')
  assert.equal(r.imageUrl, 'https://www.nasa.gov/img.jpg')
  assert.equal(r.domain, 'nasa.gov')
  const atom = `<feed><entry><title>Atom item here</title><link href="https://nih.gov/a"/><updated>2026-09-15T10:00:00Z</updated></entry></feed>`
  assert.equal(readRss(atom, { id: 'n', strand: 'health', url: 'https://nih.gov', publicDomain: true })[0].url, 'https://nih.gov/a')
})
test('meta description is read in either attribute order', () => {
  assert.equal(readMetaDescription('<meta property="og:description" content="The singer confirmed the tour on Monday.">'), 'The singer confirmed the tour on Monday.')
  assert.equal(readMetaDescription('<meta content="The singer confirmed the tour on Monday." name="description">'), 'The singer confirmed the tour on Monday.')
})

/* ---------- writer checks ---------- */
const goodDraft = () => ({
  familySafe: true, safetyNote: 'fine', headline: 'Jo Example wins top album prize',
  caption: 'The singer took home Album of the Year at a star-studded ceremony on Sunday night.',
  body: 'Singer Jo Example has won Album of the Year, one of music’s biggest honours. The prize was handed out at a glittering ceremony on Sunday night, where the star thanked fans and bandmates. It is the first time Jo has won the award, after two earlier nominations. Several outlets covered the moment, which quickly became one of the most talked-about of the evening.',
  keyFacts: ['First win after two nominations', 'Ceremony held Sunday night', 'Thanked fans on stage'],
  whyTrending: 'A first big win after years of near misses', people: ['Jo Example'], imageQuery: 'trophy',
  bigNumber: { value: '3', label: 'career nominations' }, quiz: { statement: 'This was Jo Example’s first Album of the Year win.', answer: true },
})
test('parseModelJson tolerates fences and chatter', () => {
  assert.equal(parseModelJson('Sure!\n```json\n{"a":1}\n```').a, 1)
  assert.throws(() => parseModelJson('no json here'))
})
test('validateDraft passes a good draft and catches missing parts', () => {
  assert.deepEqual(validateDraft(goodDraft()), [])
  assert.ok(validateDraft({ ...goodDraft(), headline: 'one two three four five six seven eight nine ten eleven' }).length)
  assert.deepEqual(validateDraft({ ...goodDraft(), quiz: undefined }), [], 'stories no longer need their own quiz')
  assert.ok(validateDraft({ ...goodDraft(), keyFacts: [] }).length)
})
test('copy check catches 8 words lifted from a non-government source', () => {
  const [c] = clusterItems([item('celebrity', 'Jo Example wins', 'people.com', { summary: 'The prize was handed out at a glittering ceremony on Sunday night in LA' })])
  assert.equal(copiesSource(goodDraft(), c), true)
  c.items[0].publicDomain = true
  assert.equal(copiesSource(goodDraft(), c), false)
})

/* ---------- images ---------- */
test('only accepted licences pass', () => {
  for (const ok of ['CC BY-SA 4.0', 'CC BY 2.0', 'CC0', 'Public domain', 'PD-USGov']) assert.equal(licenceAccepted(ok), true, ok)
  for (const bad of ['', 'Fair use', 'CC BY-NC 2.0', 'All rights reserved', 'GFDL']) assert.equal(licenceAccepted(bad), false, bad)
})
test('Commons page: rejects restrictions and small files, credits the artist', () => {
  const page = (md, extra = {}) => ({ title: 'File:Star.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/t.jpg', thumbwidth: 1920, thumbheight: 1280, descriptionurl: 'https://commons/x', extmetadata: md, ...extra }] })
  const img = readCommonsPage(page({ LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: '<a href="x">Jane Photographer</a>' } }))
  assert.equal(img.credit, 'Jane Photographer')
  assert.equal(readCommonsPage(page({ LicenseShortName: { value: 'CC BY-SA 4.0' }, Restrictions: { value: 'personality' } })), null)
  assert.equal(readCommonsPage(page({ LicenseShortName: { value: 'CC BY-SA 4.0' } }, { thumbwidth: 320, thumbheight: 200 })), null)
})
test('NASA library skips third-party copyright items', () => {
  const mk = (desc) => ({ data: [{ media_type: 'image', nasa_id: 'x', title: 't', description: desc, center: 'JPL' }], links: [{ rel: 'preview', href: 'https://images-assets.nasa.gov/image/x/x~thumb.jpg' }] })
  assert.equal(readNasa({ collection: { items: [mk('Image © Some Observatory')] } }), null)
  const ok = readNasa({ collection: { items: [mk('Jupiter from Juno')] } })
  assert.match(ok.url, /~large\.jpg$/)
  assert.deepEqual(ok.candidates.map((u) => u.split('~')[1]), ['large.jpg', 'medium.jpg', 'orig.jpg', 'thumb.jpg'])
})

/* ---------- pictures that do not load ---------- */

/** A fetch that answers from a map of url → status. */
const server = (statuses, { type = 'image/jpeg', seen = [] } = {}) => Object.assign(
  async (url, init = {}) => {
    seen.push(`${init.method || 'GET'} ${url}`)
    const status = statuses[url] ?? 404
    if (status === 'throw') throw new Error('socket hang up')
    return { ok: status >= 200 && status < 300, status, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? type : null) } }
  },
  { seen },
)

test('a URL only counts as an image when it actually serves one', async () => {
  const live = 'https://cdn.test/a.jpg'
  assert.equal(await imageLoads(live, { fetchImpl: server({ [live]: 200 }) }), true)
  assert.equal(await imageLoads(live, { fetchImpl: server({ [live]: 404 }) }), false)
  assert.equal(await imageLoads(null, { fetchImpl: server({}) }), false)
  // A 200 that is an error page, not a picture.
  assert.equal(await imageLoads(live, { fetchImpl: server({ [live]: 200 }, { type: 'text/html' }) }), false)
})

test('a host that refuses HEAD is not mistaken for a missing picture', async () => {
  const url = 'https://cdn.test/a.jpg'
  const seen = []
  const fetchImpl = async (u, init = {}) => {
    seen.push(init.method)
    if (init.method === 'HEAD') return { ok: false, status: 405, headers: { get: () => null } }
    return { ok: true, status: 206, headers: { get: () => 'image/jpeg' } }
  }
  assert.equal(await imageLoads(url, { fetchImpl }), true)
  assert.deepEqual(seen, ['HEAD', 'GET'], 'HEAD first, then a one-byte GET')
})

test('a NASA item falls back to the rendition that was actually generated', async () => {
  // The real failure: images-assets serves ~orig and ~thumb for this item and
  // nothing else, but the search result implies a ~large.
  const base = 'https://images-assets.nasa.gov/image/x/x'
  const img = readNasa({ collection: { items: [{ data: [{ media_type: 'image', nasa_id: 'x', title: 't', description: 'Jupiter', center: 'JPL' }], links: [{ rel: 'preview', href: `${base}~thumb.jpg` }] }] } })
  const fetchImpl = server({ [`${base}~orig.jpg`]: 200, [`${base}~thumb.jpg`]: 200 })
  const log = []
  const out = await resolveNasaSize(img, { fetchImpl, log })
  assert.equal(out.url, `${base}~orig.jpg`, 'the biggest one that exists')
  assert.equal(out.candidates, undefined, 'the candidate list does not leak into the feed')
  assert.equal(log.length, 2, 'and it says which ones it skipped')

  assert.equal(await resolveNasaSize(img, { fetchImpl: server({}), log: [] }), null, 'nothing at all means no picture')
})

test('a dead link never reaches a story, and no longer costs it the picture', async () => {
  // The first file has been deleted from the CDN; the second is really there.
  // The old code offered one candidate per source, so this was a story with
  // no picture. Now it is a story with the second picture.
  const gone = 'https://upload.wikimedia.org/gone.jpg'
  const here = 'https://upload.wikimedia.org/here.jpg'
  const ok = { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: 'Jane' } }
  const body = JSON.stringify({ query: { pages: {
    1: { index: 1, title: 'File:Gone.jpg', imageinfo: [{ thumburl: gone, thumbwidth: 1920, thumbheight: 1080, descriptionurl: 'https://commons/1', extmetadata: ok }] },
    2: { index: 2, title: 'File:Here.jpg', imageinfo: [{ thumburl: here, thumbwidth: 1920, thumbheight: 1080, descriptionurl: 'https://commons/2', extmetadata: ok }] },
  } } })
  const fetchImpl = async (u) => {
    if (u.includes('list=search')) return { ok: true, status: 200, text: async () => JSON.stringify({ query: { search: [] } }) }
    if (u.startsWith('https://commons.wikimedia.org')) return { ok: true, status: 200, text: async () => body }
    const alive = u === here
    return { ok: alive, status: alive ? 200 : 404, headers: { get: () => 'image/jpeg' } }
  }
  const log = []
  const passes = async (i) => i
  const img = await findImage('bizarre', { imageQuery: 'meteor', headline: 'h' }, { items: [] }, { fetchImpl, log, review: passes })
  assert.equal(img.url, here)
  assert.equal(img.credit, 'Jane')
  assert.ok(log.some((l) => l.includes('does not load')))
})

/* ---------- feed ---------- */
test('mergeFeed keeps 72h, dedupes, honours pulled stories and counts today', () => {
  const now = Date.parse('2026-09-16T20:00:00Z')
  const s = (id, h, strand = 'facts') => ({ id, strand, publishedAt: new Date(now - h * 3600000).toISOString() })
  const feed = mergeFeed({ stories: [s('old', 80), s('a', 30), s('b', 2)] }, [s('c', 0, 'celebrity'), s('b', 0)], { now, pulled: ['a'] })
  assert.deepEqual(feed.stories.map((x) => x.id), ['c', 'b'])
  assert.equal(countToday(feed.stories, now).total, 2)
  assert.equal(feed.counts.celebrity, 1)
})
test('trendFromDaily reports rising and cooling', () => {
  assert.equal(trendFromDaily([100, 100, 100, 200]).direction, 'rising')
  assert.equal(trendFromDaily([100, 100, 100, 50]).direction, 'cooling')
  assert.equal(trendFromDaily([]).direction, 'steady')
})

/* ---------- the whole run ---------- */
const memStore = () => { const m = new Map(); return { m, getJSON: async (k) => m.get(k) ?? null, setJSON: async (k, v) => { m.set(k, structuredClone(v)) } } }

test('a full run publishes to quota, drops unsafe drafts and logs why', async () => {
  const store = memStore()
  const items = []
  const celeb = ['Jo Example premieres Toronto thriller', 'Sam Example sings anthem stadium', 'Alex Example launches perfume Paris',
    'Max Example adopts rescue puppy', 'Kim Example wedding photos Italy', 'Lee Example cooking show renewed',
    'Ray Example hosts charity gala', 'Dee Example tour extended Europe', 'Pat Example children book bestseller']
  for (const t of celeb) for (const d of ['people.com', 'variety.com']) items.push(item('celebrity', t, d))
  const health = ['Walking routine improves sleep quality', 'Leafy greens linked sharper memory', 'Stretching breaks ease back stiffness', 'Hydration helps afternoon concentration']
  const facts = ['Spacecraft maps icy Europa surface', 'Webb telescope spots newborn stars', 'Mars rover finds layered rocks', 'Hubble captures colliding galaxies']
  const odd = ['Giant pumpkin breaks county record', 'Parrot learns whistle anthem tune', 'Town builds longest sandwich ever', 'Goat elected honorary mayor village']
  health.forEach((t) => items.push(item('health', t, 'nih.gov', { publicDomain: true })))
  facts.forEach((t) => items.push(item('facts', t, 'nasa.gov', { publicDomain: true })))
  odd.forEach((t) => { for (const d of ['upi.com', 'apnews.com']) items.push(item('bizarre', t, d)) })
  let calls = 0
  const write = async (c) => {
    calls++
    const d = goodDraft()
    d.headline = c.lead.title.split(' ').slice(0, 6).join(' ')
    if (/^Sam/.test(c.lead.title)) d.familySafe = false
    if (/^Alex/.test(c.lead.title)) d.body += ' The star was later arrested.'
    return d
  }
  const r = await runPipeline({ store, items, write, image: async () => null, now: new Date('2026-09-16T13:05:00Z'), env: {} })
  assert.equal(r.ok, true, r.lines.join('\n'))
  assert.deepEqual(r.byStrand, { celebrity: 4, health: 2, facts: 2, bizarre: 2 })
  assert.equal(r.published, 10)
  assert.ok(r.dropped.some((d) => d.stage === 'writer-safety'))
  assert.ok(r.dropped.some((d) => d.stage === 'final-safety'))
  const feed = store.m.get(KEYS.feed)
  assert.equal(feed.stories.length, 10)
  assert.ok(calls <= 16)

  // the next run does not repeat what it already covered
  const r2 = await runPipeline({ store, items, write, image: async () => null, now: new Date('2026-09-16T19:05:00Z'), env: {} })
  const repeats = r2.published && store.m.get(KEYS.feed).stories.filter((s) => s.runId === r2.runId)
    .filter((s) => feed.stories.some((f) => f.key === s.key))
  assert.equal(repeats ? repeats.length : 0, 0)

  // pulling a story removes it and keeps it out
  const id = feed.stories[0].id
  assert.equal(await pullStory(store, id), true)
  assert.equal(store.m.get(KEYS.feed).stories.some((s) => s.id === id), false)
})

test('a run with every source down keeps the last good feed', async () => {
  const store = memStore()
  await store.setJSON(KEYS.feed, { stories: [{ id: 'keep', publishedAt: new Date().toISOString(), strand: 'facts' }] })
  const r = await runPipeline({ store, items: [], env: {} })
  assert.equal(r.ok, false)
  assert.equal(store.m.get(KEYS.feed).stories[0].id, 'keep')
  assert.equal(store.m.get(KEYS.log).ok, false)
})

test('BUZZ_PAUSED stops publishing', async () => {
  const store = memStore()
  const r = await runPipeline({ store, items: [item('facts', 'x y z w', 'nasa.gov')], env: { BUZZ_PAUSED: '1' } })
  assert.equal(r.published, 0)
  assert.equal(store.m.get(KEYS.feed), undefined)
})

/* ---------- network edges, with a fake fetch ---------- */
import { writeStory, SYSTEM_PROMPT } from './writer.mjs'
import { harvestGdelt } from './harvest.mjs'

test('writeStory sends a proper Messages API request and parses the reply', async () => {
  let sent
  const fetchImpl = async (url, init) => {
    sent = { url, init }
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(goodDraft()) }] }) }
  }
  const [c] = clusterItems([item('celebrity', 'Jo Example wins Album prize tonight', 'people.com'), item('celebrity', 'Jo Example wins Album prize', 'variety.com')])
  const d = await writeStory(c, { apiKey: 'k', model: 'm', fetchImpl })
  assert.equal(d.headline, goodDraft().headline)
  assert.equal(sent.url, 'https://api.anthropic.com/v1/messages')
  assert.equal(sent.init.headers['x-api-key'], 'k')
  assert.equal(sent.init.headers['anthropic-version'], '2023-06-01')
  const body = JSON.parse(sent.init.body)
  assert.equal(body.system, SYSTEM_PROMPT)
  assert.match(body.messages[0].content, /Number of independent outlets: 2/)
  await assert.rejects(() => writeStory(c, { apiKey: '', fetchImpl }), /ANTHROPIC_API_KEY/)
})

test('GDELT harvest retries once after a rate-limit reply and carries on', async () => {
  let n = 0
  const fetchImpl = async () => {
    n++
    const text = n === 1 ? 'Please limit requests to one every 5 seconds'
      : JSON.stringify({ articles: [{ url: `https://people.com/${n}`, title: `Headline number ${n} here`, seendate: '20260916T120000Z', domain: 'people.com' }] })
    return { ok: true, text: async () => text }
  }
  const log = []
  const items = await harvestGdelt({ fetchImpl, log, gapMs: 0 })
  assert.equal(items.length, 4) // four strands, first one on its retry
  assert.match(log[0], /rate limit hit — retrying/)
})

test('a writer configuration error stops writing early and leaves stories eligible for the next run', async () => {
  const store = memStore()
  const items = ['Walking routine improves sleep quality', 'Leafy greens linked sharper memory', 'Stretching breaks ease back stiffness']
    .map((t) => item('health', t, 'nih.gov', { publicDomain: true }))
  let calls = 0
  const write = async () => { calls++; throw new Error('writer HTTP 400: not scoped to a workspace') }
  const r = await runPipeline({ store, items, write, image: async () => null, now: new Date('2026-09-16T13:05:00Z'), env: {} })
  assert.equal(r.ok, false)
  assert.match(r.error, /writer not working/)
  assert.ok(calls <= 2, `called ${calls} times`)
  assert.deepEqual(Object.keys(store.m.get(KEYS.seen)), [])
})

test('writeStory adds the workspace header when a workspace id is set', async () => {
  let headers
  const fetchImpl = async (_u, init) => { headers = init.headers; return { ok: true, json: async () => ({ content: [{ type: 'text', text: '{}' }] }) } }
  const [c] = clusterItems([item('facts', 'NASA probe photographs icy moon surface', 'nasa.gov', { publicDomain: true })])
  await writeStory(c, { apiKey: 'k', workspaceId: 'wrkspc_1', fetchImpl })
  assert.equal(headers['anthropic-workspace-id'], 'wrkspc_1')
})

test('real headlines: same story worded differently clusters, different stories do not', () => {
  const real = [
    ['variety.com', 'Madonna Set to Open MTV Video Music Awards for the First Time in Over 20 Years'],
    ['billboard.com', 'Madonna to Open 2026 MTV VMAs, Her 1st Performance at the Show in 23 Years'],
    ['variety.com', 'Robert Kraft Says Ed Sheeran Is Donating $2 Million to Fight This Humanitarian Crisis'],
    ['deadline.com', 'Billionaire Robert Kraft Doubles $1 Million Macklemore Donation To Aid Humanitarian Crisis'],
    ['deadline.com', 'Dancing With The Stars Recap: Season 35 Kick Off Continues With Ladies Night & Another Elimination'],
    ['billboard.com', 'Dancing With the Stars Continues Season 35 Premiere Spotlighting the Female Celebrities: See the Scores'],
    ['deadline.com', 'Nancy Robertson Joins An Angel In My Stocking Hallmark Movie In Recasting'],
    ['deadline.com', 'Reacher’s Kathleen Robertson Says Role Is Certainly Set Up To Become Powerful Ally In Season 5'],
    ['hollywoodreporter.com', 'Neagley Cast Guide: Meet All the Characters From Prime Video’s New Reacher Spinoff'],
    ['variety.com', 'Zhang Yimou to Lead Busan Film Festival Competition Jury'],
    ['hollywoodreporter.com', 'Jessica Chastain to Star in New Netflix Drama Series The Retrievals'],
    ['billboard.com', 'Prince Royce Speaks Out About Omission of Bachata in 2026 Latin Grammys Nominations'],
    ['billboard.com', 'Billboard Hot Latin Songs Top 10 Countdown for September 19th, 2026'],
    ['eonline.com', 'How Georgie and Mandy’s Age Gap Issues Will Change During Season 3'],
    ['usmagazine.com', 'Tinashe Has One Rule Before Agreeing to Be an Opening Act: Here’s Why Harry Styles Made the Cut'],
  ].map(([d, t]) => item('celebrity', t, d))
  const cs = clusterItems(real)
  const find = (re) => cs.find((c) => c.items.some((i) => re.test(i.title)))
  assert.equal(find(/Madonna/).items.length, 2, 'Madonna VMAs')
  assert.equal(find(/Kraft/).items.length, 2, 'Kraft donation')
  assert.equal(find(/Dancing With/).items.length, 2, 'DWTS')
  assert.equal(find(/Nancy Robertson/).items.length, 1, 'two different Robertsons stay apart')
  assert.equal(find(/Chastain/).items.length, 1)
  assert.equal(find(/Prince Royce/).items.length, 1, 'Latin Grammys vs Latin chart stay apart')
  assert.equal(cs.length, 12)
})

/* ---------- media for the vertical screen ---------- */
import { readNasaVideoSearch, pickNasaMp4, readCommonsVideo, findMedia, mentionsQuery, queryTerms, pickVideo } from './images.mjs'
import { assembleStory } from './feed.mjs'

test('NASA video: skips copyrighted clips and picks a light mp4', () => {
  const item = (desc, id) => ({
    href: `http://images-assets.nasa.gov/video/${id}/collection.json`,
    links: [{ rel: 'preview', href: `http://images-assets.nasa.gov/video/${id}/${id}~thumb.jpg` }],
    data: [{ media_type: 'video', nasa_id: id, title: 't', description: desc, center: 'JSC' }],
  })
  assert.deepEqual(readNasaVideoSearch({ collection: { items: [item('© Somebody', 'a')] } }), [])
  const hits = readNasaVideoSearch({ collection: { items: [item('ISS flyover', 'b')] } })
  assert.equal(hits[0].nasaId, 'b')
  assert.match(hits[0].poster, /~thumb\.jpg$/, 'the frame the picture desk will look at')
  const files = ['x~orig.mp4', 'x~large.mp4', 'x~medium.mp4', 'x~mobile.mp4', 'x.srt']
  assert.equal(pickNasaMp4(files), 'x~mobile.mp4')
  assert.equal(pickNasaMp4(['x~orig.mp4']), null)
})

test('NASA video: every usable clip comes back, not just the first', () => {
  const item = (id) => ({ href: `http://x/${id}/collection.json`, links: [], data: [{ media_type: 'video', nasa_id: id, title: 'Aurora over Earth', description: 'aurora', center: 'JSC' }] })
  const all = readNasaVideoSearch({ collection: { items: [item('a'), item('b'), item('c')] } })
  assert.equal(all.length, 3, 'the caller reviews them in order rather than being handed one')
})

test('a clip that shares a word with the story is looked at first', () => {
  // This is the elk. Commons has few videos, so its search returns the
  // nearest thing it has — which for "elk jumping on car" was ducks.
  assert.equal(mentionsQuery('Ducks on a pond.webm', 'elk jumping on car'), false)
  assert.equal(mentionsQuery('Elk crossing a road.webm', 'elk jumping on car'), true)
  assert.equal(mentionsQuery('A car park at dusk.webm', 'elk jumping on car'), true, 'one term is enough — the review decides the rest')
  // Never a rejection on its own: a clip of a car's numberplates titled
  // "Coche con placas de Sinaloa" shares no English word with the query and
  // was genuinely relevant, so a filter here would have cost a good clip.
  assert.equal(mentionsQuery('Coche con placas de Sinaloa', 'car numberplates lottery'), false)
  // Singular and plural are the same word for this purpose.
  assert.equal(mentionsQuery('A herd of elks.webm', 'elk jumping on car'), true)
  assert.equal(mentionsQuery('Volcano lava flow.webm', 'volcanoes erupting'), true)
})

test('the word match never rejects when it has nothing to go on', () => {
  // A guard with no evidence must not be the thing that says no.
  assert.equal(mentionsQuery('Anything at all', ''), true)
  assert.equal(mentionsQuery('Anything at all', 'the and for'), true)
  assert.deepEqual(queryTerms('the new video of an elk'), ['elk'])
  assert.deepEqual(queryTerms('VOLCANO, erupting!'), ['volcano', 'erupting'])
})

test('a clip is only published once the picture desk has passed it', async () => {
  const draft = { headline: 'Elk jumps on a car', caption: 'It happened.', imageQuery: 'elk car' }
  const clip = (alt, poster = 'https://x/p.jpg') => ({ url: 'https://x/v.webm', alt, poster, credit: 'C', licence: 'CC0' })
  const looked = []
  const review = async (img) => { looked.push(img.url); return img.url.includes('good') ? { ...img, review: { version: 'vision-1', saw: 'An elk.' } } : null }

  // Nothing passes → nothing is published, and the story runs on stills.
  const log = []
  const none = await pickVideo('bizarre', draft, {
    review, log, env: {},
    safe: async (label) => (label === 'commons video' ? [clip('Ducks', 'https://x/bad.jpg')] : []),
  })
  assert.equal(none, null, 'no footage is better than wrong footage')
  assert.match(log.join(' '), /does not show what the story is about/)

  // The first that passes is the one published, and it carries its stamp.
  const kept = await pickVideo('bizarre', draft, {
    review, log: [], env: {},
    safe: async (label) => (label === 'commons video'
      ? [clip('Ducks', 'https://x/bad.jpg'), clip('Elk on a car', 'https://x/good.jpg')] : []),
  })
  assert.ok(kept, 'the second candidate was tried rather than giving up on the first')
  assert.equal(kept.alt, 'Elk on a car')
  assert.equal(kept.review.version, 'vision-1', 'the stamp is what lets the player play it')
})

test('a clip in another language is still looked at, just not first', async () => {
  /*
   * "Coche con placas de Sinaloa" was on the live feed under a story about
   * winning numbers from car plates — relevant, and sharing not one English
   * word with the query. Word matching orders the queue; it never empties it.
   */
  const draft = { headline: 'Lucky numbers from car plates', caption: 'A win.', imageQuery: 'car numberplates' }
  const looked = []
  const review = async (img) => { looked.push(img.alt); return img.alt.includes('Coche') ? { ...img, review: { version: 'vision-1' } } : null }
  const out = await pickVideo('bizarre', draft, {
    review, log: [], env: {},
    safe: async (label) => (label === 'commons video' ? [
      { url: 'https://x/a.webm', alt: 'Coche con placas de Sinaloa', poster: 'https://x/a.jpg', matches: false },
      { url: 'https://x/b.webm', alt: 'A car advert', poster: 'https://x/b.jpg', matches: true },
    ] : []),
  })
  assert.deepEqual(looked, ['A car advert', 'Coche con placas de Sinaloa'], 'the word match went first, the other was still tried')
  assert.equal(out.alt, 'Coche con placas de Sinaloa', 'and the one the desk passed is the one published')
})

test('a clip with no frame to look at is never published', async () => {
  // Unreviewable is not the same as fine.
  const log = []
  const out = await pickVideo('bizarre', { headline: 'h', caption: 'c', imageQuery: 'elk' }, {
    review: async () => { throw new Error('should not be called') }, log, env: {},
    safe: async (label) => (label === 'commons video' ? [{ url: 'https://x/v.webm', alt: 'Elk', poster: null }] : []),
  })
  assert.equal(out, null)
  assert.match(log.join(' '), /no poster frame/)
})

test('Commons video: licence, people filter and a 360–720p transcode', () => {
  const page = (md, derivatives, title = 'File:Volcano lava flow.webm') => ({ title, videoinfo: [{ descriptionurl: 'https://commons/x', extmetadata: md, derivatives }] })
  const ok = { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: 'Jane' } }
  const ders = [{ src: 'a.1080p.webm', type: 'video/webm', height: 1080 }, { src: 'a.720p.webm', type: 'video/webm', height: 720 }, { src: 'a.240p.webm', type: 'video/webm', height: 240 }]
  assert.equal(readCommonsVideo(page(ok, ders)).url, 'a.720p.webm')
  assert.equal(readCommonsVideo(page({ LicenseShortName: { value: 'CC BY-NC 2.0' } }, ders)), null)
  assert.equal(readCommonsVideo(page(ok, ders, 'File:Interview with a man.webm')), null)
})

test('findMedia never looks for celebrity video and survives every lookup failing', async () => {
  const fetchImpl = async () => { throw new Error('offline') }
  const [c] = clusterItems([item('celebrity', 'Jo Example wins award tonight', 'people.com')])
  const m = await findMedia('celebrity', { people: ['Jo Example'], imageQuery: 'trophy' }, c, { fetchImpl, log: [] })
  assert.deepEqual(m, { image: null, gallery: [], video: null })
})

test('assembleStory carries gallery, video and a comment prompt, and accepts a bare image', () => {
  const [c] = clusterItems([item('facts', 'NASA probe photographs icy moon surface', 'nasa.gov', { publicDomain: true })])
  const d = { ...goodDraft(), chatPrompt: { question: 'Would you visit this moon?', a: 'Yes please', b: 'No way' } }
  const s = assembleStory(c, d, { image: { url: 'a' }, gallery: [{ url: 'a' }, { url: 'b' }], video: { url: 'v.mp4' } })
  assert.equal(s.gallery.length, 2); assert.equal(s.video.url, 'v.mp4'); assert.equal(s.chatPrompt.b, 'No way')
  const s2 = assembleStory(c, goodDraft(), { url: 'x' })
  assert.deepEqual(s2.gallery, [{ url: 'x' }]); assert.equal(s2.chatPrompt, null)
})

test('the comment prompt goes through the safety check too', () => {
  const s = { strand: 'celebrity', headline: 'ok', caption: 'ok', body: 'ok', keyFacts: [], chatPrompt: { question: 'Do you think they will divorce?', a: 'Yes', b: 'No' } }
  assert.equal(checkStory(s).ok, false)
})

/* ---------- the daily quiz ---------- */
import { buildQuiz, cleanQuestion, quizIsStale } from './quiz.mjs'

const quizStories = [
  { id: 's1', strand: 'facts', headline: 'Octopuses have three hearts and blue blood', body: 'Octopus blood uses copper to carry oxygen.', keyFacts: ['Three hearts'], publishedAt: '2026-09-16T12:00:00Z' },
  { id: 's2', strand: 'bizarre', headline: 'Wombats make cube-shaped droppings', body: 'Wombats live in Australia.', keyFacts: ['Cubes'], publishedAt: '2026-09-16T12:00:00Z' },
  { id: 's3', strand: 'celebrity', headline: 'Sample Star Ava Lumen announces world tour', body: 'Forty dates.', keyFacts: ['40 dates'], publishedAt: '2026-09-16T12:00:00Z' },
]
const byId = new Map(quizStories.map((s) => [s.id, s]))
const q = (over = {}) => ({ storyId: 's1', question: 'Octopus blood is blue because it uses which metal?', options: ['Iron', 'Copper', 'Zinc', 'Gold'], answer: 1, explanation: 'Copper-based blood turns blue and works well in cold water.', ...over })

test('quiz questions: good ones pass, bad shapes and unsafe or lazy ones are dropped', () => {
  assert.equal(cleanQuestion(q(), byId).answer, 1)
  assert.equal(cleanQuestion(q({ options: ['a', 'b', 'c'] }), byId), null, 'needs 4 options')
  assert.equal(cleanQuestion(q({ answer: 4 }), byId), null, 'answer index out of range')
  assert.equal(cleanQuestion(q({ storyId: 'nope' }), byId), null, 'must belong to a story')
  assert.equal(cleanQuestion(q({ options: ['Iron', 'iron', 'Zinc', 'Gold'] }), byId), null, 'duplicate options')
  assert.equal(cleanQuestion(q({ storyId: 's3', question: 'Who is Ava Lumen dating?', options: ['A', 'B', 'C', 'D'], explanation: 'She is dating someone after an affair.' }), byId), null, 'private life')
  assert.equal(cleanQuestion(q({ question: 'Octopuses have three hearts and blue blood?' }), byId), null, 'just the headline back')
})

test('buildQuiz writes, then keeps only what the fact-check confirms', async () => {
  const calls = []
  const reply = (obj) => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] }) })
  const fetchImpl = async (_u, init) => {
    const body = JSON.parse(init.body); calls.push(body.system.slice(0, 20))
    if (calls.length === 1) return reply({ questions: [q(), q({ storyId: 's2', question: 'Which country do wombats come from?', options: ['Brazil', 'Australia', 'Kenya', 'Canada'], answer: 1, explanation: 'Wombats are found only in Australia.' }), q({ answer: 9 })] })
    return reply({ results: [{ i: 0, ok: true }, { i: 1, ok: false, reason: 'unsure' }] })
  }
  const quiz = await buildQuiz(quizStories, { now: new Date('2026-09-16T13:00:00Z'), fetchImpl, env: { ANTHROPIC_API_KEY: 'k' }, log: [] })
  assert.equal(calls.length, 2)
  assert.equal(quiz.questions.length, 1)
  assert.equal(quiz.questions[0].options[quiz.questions[0].answer], 'Copper')
  assert.equal(quiz.questions[0].headline, quizStories[0].headline)
  assert.equal(quizIsStale(quiz, Date.parse('2026-09-16T14:00:00Z')), false)
  assert.equal(quizIsStale(quiz, Date.parse('2026-09-16T23:00:00Z')), true)
})

test('a failed quiz never blocks publishing and keeps the previous quiz', async () => {
  const store = memStore()
  const old = { generatedAt: '2026-09-16T01:00:00Z', questions: [{ id: 'old' }] }
  await store.setJSON(KEYS.feed, { stories: [], quiz: old })
  const items = ['Walking routine improves sleep quality', 'Leafy greens linked sharper memory'].map((t) => item('health', t, 'nih.gov', { publicDomain: true }))
  const r = await runPipeline({ store, items, write: async () => goodDraft(), image: async () => null, quiz: async () => { throw new Error('boom') }, now: new Date('2026-09-16T13:05:00Z'), env: {} })
  assert.equal(r.ok, true)
  assert.ok(r.published >= 1)
  assert.deepEqual(store.m.get(KEYS.feed).quiz, old)
  assert.ok(r.lines.some((l) => /quiz: boom/.test(l)))
})


/* ---------- looking at the picture ---------- */
import { verdictOf, storyContextOf, reviewImage, readSubject, REVIEW_VERSION } from './review.mjs'

test('an illustration passes only when nobody is in the frame', () => {
  const clean = { people: 0, identifiable: false, minors: false, topical: true, describe: 'A pile of lottery tickets on a counter.' }
  assert.equal(verdictOf(clean).ok, true)

  // The exact failure: a file whose every piece of metadata said "lottery
  // tickets", and whose photograph was of a child.
  const theChild = { people: 1, identifiable: true, minors: true, topical: true, describe: 'A child holding lottery tickets.' }
  const v = verdictOf(theChild)
  assert.equal(v.ok, false)
  assert.match(v.reason, /a person.*including a child/)

  // Any person at all, not just a recognisable one.
  assert.equal(verdictOf({ people: 3, identifiable: false, minors: false, topical: true }).ok, false)
  assert.match(verdictOf({ people: 3, identifiable: false, minors: false, topical: true }).reason, /3 people/)
})

test('a contradictory reply is read the way that protects the person', () => {
  // "Nobody is in shot" and "someone is identifiable" cannot both be true.
  assert.equal(verdictOf({ people: 0, identifiable: true, minors: false, topical: true }).ok, false)
  assert.equal(verdictOf({ people: 0, identifiable: false, minors: true, topical: true }).ok, false)
})

test('an unreadable or missing verdict is a rejection, never a pass', () => {
  for (const bad of [null, undefined, {}, { people: 'none' }, { people: NaN }]) {
    assert.equal(verdictOf(bad).ok, false, JSON.stringify(bad))
  }
})

test('a picture of the wrong thing is turned down even with nobody in it', () => {
  assert.equal(verdictOf({ people: 0, identifiable: false, minors: false, topical: false, describe: 'A beach.' }).ok, false)
  // Relevance can be waived; people can never be.
  assert.equal(verdictOf({ people: 0, identifiable: false, minors: false, topical: false }, { requireTopical: false }).ok, true)
  assert.equal(verdictOf({ people: 1, identifiable: false, minors: false, topical: true }, { requireTopical: false }).ok, false)
})

test('a review that cannot be carried out publishes no picture', async () => {
  const log = []
  const out = await reviewImage({ url: 'https://commons.test/a.jpg' }, 'a story', {
    fetchImpl: async () => { throw new Error('API down') }, log, apiKey: 'k',
  })
  assert.equal(out, null, '"we could not look" is not "we looked and it was fine"')
  assert.match(log[0], /could not be reviewed/)
})

test('a picture that passes is stamped with what was seen and which rules saw it', async () => {
  const seen = { people: 0, identifiable: false, minors: false, topical: true, describe: 'Lottery tickets on a counter.' }
  const fetchImpl = async (url) => (url.includes('anthropic')
    ? { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(seen) }] }) }
    : { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer })
  const out = await reviewImage({ url: 'https://commons.test/a.jpg', credit: 'Someone' }, 'a story', { fetchImpl, apiKey: 'k', log: [] })
  assert.equal(out.credit, 'Someone', 'the picture is returned unchanged apart from the stamp')
  assert.equal(out.review.version, REVIEW_VERSION)
  assert.equal(out.review.saw, 'Lottery tickets on a counter.')
  assert.ok(out.review.at)
})

test('the subject box is carried through so the vertical cut can frame on it', async () => {
  const seen = {
    people: 0, identifiable: false, minors: false, topical: true,
    describe: 'A lighthouse on a headland.', subject: { x: 0.62, y: 0.18, w: 0.2, h: 0.55 },
  }
  const fetchImpl = async (url) => (url.includes('anthropic')
    ? { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(seen) }] }) }
    : { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer })
  const out = await reviewImage({ url: 'https://commons.test/a.jpg' }, 'a story', { fetchImpl, apiKey: 'k', log: [] })
  assert.deepEqual(out.review.subject, { x: 0.62, y: 0.18, w: 0.2, h: 0.55 })
})

test('a subject box that makes no sense is dropped rather than acted on', () => {
  // A wrong box moves the crop somewhere arbitrary, which is the very fault
  // this was added to fix. No box has a safe fallback; a bad one does not.
  assert.equal(readSubject(null), null)
  assert.equal(readSubject({ x: 0.5, y: 0.1, w: 0.8, h: 0.2 }), null, 'runs off the right edge')
  assert.equal(readSubject({ x: -0.1, y: 0.1, w: 0.2, h: 0.2 }), null, 'negative origin')
  assert.equal(readSubject({ x: 0.1, y: 0.1, w: 0, h: 0.2 }), null, 'no width')
  assert.equal(readSubject({ x: 120, y: 80, w: 400, h: 300 }), null, 'pixels, not fractions')
  assert.equal(readSubject({ x: 0, y: 0, w: 1, h: 1 }), null, 'the whole frame says nothing a default does not')
  assert.equal(readSubject({ x: '0.1', y: 0.1, w: 0.2, h: 0.2 }), null, 'strings are not coordinates')
  assert.deepEqual(readSubject({ x: 0.1234, y: 0.2, w: 0.3, h: 0.4 }), { x: 0.123, y: 0.2, w: 0.3, h: 0.4 })
})

test('the story context tells the model what the picture has to match', () => {
  const ctx = storyContextOf({ headline: 'Maryland Woman Wins Lottery Prize Twice Same Day', caption: 'She bought two matching tickets.', people: [] })
  assert.match(ctx, /Maryland Woman Wins/)
  assert.match(ctx, /two matching tickets/)
  assert.ok(!/People named/.test(ctx), 'no names, no line about names')
  assert.match(storyContextOf({ headline: 'h', people: ['Ada Lovelace'] }), /People named in the story: Ada Lovelace/)
})

test('an illustration rejected by the review never reaches the story', async () => {
  const ok = { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: 'Rod' } }
  const url = 'https://upload.wikimedia.org/lottery.jpg'
  const commons = JSON.stringify({ query: { pages: { 1: { index: 1, title: 'File:Lottery Tickets, Ethiopia.jpg', imageinfo: [{ thumburl: url, thumbwidth: 1920, thumbheight: 1280, descriptionurl: 'https://commons/1', extmetadata: ok }] } } } })
  const fetchImpl = async (u) => (u.startsWith('https://commons.wikimedia.org')
    ? { ok: true, status: 200, text: async () => commons }
    : { ok: true, status: 200, headers: { get: () => 'image/jpeg' } })

  const log = []
  const rejects = async (img, ctx, { log: l }) => { l.push('picture rejected (shows a person, apparently including a child)'); return null }
  const img = await findImage('bizarre', { headline: 'Maryland Woman Wins Lottery Prize Twice Same Day', imageQuery: 'lottery tickets' }, { items: [] }, { fetchImpl, log, review: rejects })
  assert.equal(img, null, 'the story runs with the typographic card instead')
  assert.match(log.join(' '), /rejected/)
})

test('a celebrity portrait is not sent to the illustration review', async () => {
  // P18 is identity-bound: the picture is of them because Wikidata says so.
  let reviewed = 0
  const person = { url: 'https://upload.wikimedia.org/p.jpg', kind: 'person', alt: 'A Celebrity' }
  const fetchImpl = async (u) => (u.startsWith('https://www.wikidata.org')
    ? { ok: true, status: 200, text: async () => JSON.stringify({ search: [] }) }
    : { ok: true, status: 200, headers: { get: () => 'image/jpeg' } })
  const img = await findImage('celebrity', { people: ['A Celebrity'] }, { items: [] }, {
    fetchImpl, log: [], review: async (i) => { reviewed++; return i },
  })
  assert.equal(reviewed, 0)
  assert.equal(img, null, 'and with no Wikidata match there is simply no picture')
  void person
})

import { reviewPublished, fetchImageData, smallerNasa } from './review.mjs'

test('the picture is sent exactly as published, never at a URL we invented', async () => {
  // Commons answers 400 for a thumbnail wider than the original, which is how
  // the constructed-URL version of this broke.
  const asked = []
  const fetchImpl = async (u) => {
    asked.push(u)
    return { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }
  }
  const url = 'https://upload.wikimedia.org/wikipedia/commons/2/2e/Lottery_Tickets%2C_Ethiopia.jpg'
  const out = await fetchImageData(url, { fetchImpl })
  assert.deepEqual(asked, [url], 'exactly the published URL, untouched')
  assert.equal(out.media_type, 'image/jpeg')
  assert.equal(out.data, Buffer.from([1, 2, 3]).toString('base64'))
})

test('an oversized NASA plate falls back to a rendition the library always holds', async () => {
  const big = new Uint8Array(4_000_000)
  const asked = []
  const fetchImpl = async (u) => {
    asked.push(u)
    const body = u.includes('~small') ? new Uint8Array([9]) : big
    return { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => body.buffer }
  }
  await fetchImageData('https://images-assets.nasa.gov/image/x/x~orig.jpg', { fetchImpl })
  assert.deepEqual(asked.map((u) => u.split('~')[1]), ['orig.jpg', 'small.jpg'])
  assert.equal(smallerNasa('https://upload.wikimedia.org/a.jpg'), null, 'nothing is invented for other hosts')
})

test('an oversized picture from anywhere else is simply not published', async () => {
  const fetchImpl = async () => ({ ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new Uint8Array(4_000_000).buffer })
  await assert.rejects(() => fetchImageData('https://upload.wikimedia.org/huge.jpg', { fetchImpl }), /too large/)
})

test('something that is not an image is refused before it is sent anywhere', async () => {
  const fetchImpl = async () => ({ ok: true, headers: { get: () => 'text/html' }, arrayBuffer: async () => new Uint8Array([1]).buffer })
  await assert.rejects(() => fetchImageData('https://upload.wikimedia.org/a.jpg', { fetchImpl }), /not an image/)
})

/* ---------- healing what is already published ---------- */

test('pictures published before the review existed are re-checked and dropped if they fail', async () => {
  const stories = [
    { id: 'a', headline: 'Maryland Woman Wins Lottery Prize Twice Same Day', caption: 'c', image: { url: 'https://commons.test/child.jpg', kind: 'illustration' }, gallery: [] },
    { id: 'b', headline: 'Fine one', caption: 'c', image: { url: 'https://commons.test/tickets.jpg', kind: 'illustration' }, gallery: [] },
    // Already stamped with the current rules — left alone, and costs nothing.
    { id: 'c', headline: 'Seen already', caption: 'c', image: { url: 'https://commons.test/ok.jpg', kind: 'illustration', review: { version: REVIEW_VERSION } }, gallery: [] },
    // A celebrity portrait: identity comes from Wikidata, not from a search.
    { id: 'd', headline: 'A star', caption: 'c', image: { url: 'https://commons.test/star.jpg', kind: 'person' }, gallery: [] },
  ]
  const looked = []
  const fetchImpl = async (u) => {
    if (!u.includes('anthropic')) return { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new Uint8Array([1]).buffer }
    const seen = looked.at(-1).includes('child')
      ? { people: 1, identifiable: true, minors: true, topical: true, describe: 'A child holding lottery tickets.' }
      : { people: 0, identifiable: false, minors: false, topical: true, describe: 'Lottery tickets.' }
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(seen) }] }) }
  }
  const trace = async (u, init) => { if (!u.includes('anthropic')) looked.push(u); return fetchImpl(u, init) }

  const log = []
  const n = await reviewPublished(stories, { fetchImpl: trace, env: { ANTHROPIC_API_KEY: 'k' }, log })
  assert.equal(n, 2, 'only the two that needed looking at')
  assert.equal(stories[0].image, null, 'the child’s photograph is gone')
  assert.match(log.join(' '), /removed the picture from "Maryland Woman/)
  assert.ok(stories[1].image.review.version, 'the good one is kept and stamped')
  assert.equal(stories[2].image.review.version, REVIEW_VERSION, 'an already-stamped picture is untouched')
  assert.equal(stories[3].image.kind, 'person', 'the celebrity portrait is untouched')
})

test('the re-review is bounded, so one run cannot spend the whole budget', async () => {
  const stories = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, headline: `h${i}`, image: { url: `https://c.test/${i}.jpg`, kind: 'illustration' } }))
  const fetchImpl = async (u) => (u.includes('anthropic')
    ? { ok: true, json: async () => ({ content: [{ type: 'text', text: '{"people":0,"identifiable":false,"minors":false,"topical":true,"describe":"x"}' }] }) }
    : { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new Uint8Array([1]).buffer })
  assert.equal(await reviewPublished(stories, { fetchImpl, env: { ANTHROPIC_API_KEY: 'k' }, limit: 3 }), 3)
  assert.ok(stories[3].image, 'the rest keep their pictures until the next run looks at them')
  assert.equal(stories[3].image.review, undefined, 'and stay unreviewed, so the app keeps them hidden')
})

import { reviewModel } from './review.mjs'

test('the picture reviewer can run on a different model from the writer', () => {
  // Both used to read ANTHROPIC_MODEL, so moving the review onto a cheaper
  // model would silently have moved the story writing there too.
  assert.equal(reviewModel({ REVIEW_MODEL: 'claude-haiku-4-5', ANTHROPIC_MODEL: 'claude-sonnet-4-5' }), 'claude-haiku-4-5')
  assert.equal(reviewModel({ ANTHROPIC_MODEL: 'claude-sonnet-4-5' }), 'claude-sonnet-4-5', 'and follows the writer when unset')
  assert.match(reviewModel({}), /^claude-/, 'with a sane default when neither is set')
})

import { createTally } from './review.mjs'

test('the review counts what it turned down, and why', async () => {
  const tally = createTally()
  const reply = (seen) => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(seen) }] }) })
  const image = { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new Uint8Array([1]).buffer }

  const cases = [
    { people: 0, identifiable: false, minors: false, topical: true, describe: 'Tickets.' },
    { people: 1, identifiable: true, minors: true, topical: true, describe: 'A child.' },
    { people: 4, identifiable: true, minors: false, topical: true, describe: 'A crowd.' },
    { people: 0, identifiable: false, minors: false, topical: false, describe: 'A beach.' },
  ]
  for (const seen of cases) {
    await reviewImage({ url: 'https://c.test/x.jpg' }, 'story', {
      fetchImpl: async (u) => (u.includes('anthropic') ? reply(seen) : image), apiKey: 'k', tally, log: [],
    })
  }
  assert.equal(tally.reviewed, 4)
  assert.equal(tally.kept, 1)
  assert.equal(tally.rejected, 3)
  assert.deepEqual(tally.reasons, { child: 1, people: 1, 'off-topic': 1 })
  assert.equal(tally.examples.length, 3, 'with a few worked examples to look at')
})

test('a review that breaks is counted apart from one that judges', async () => {
  const tally = createTally()
  await reviewImage({ url: 'https://c.test/x.jpg' }, 'story', {
    fetchImpl: async () => { throw new Error('API down') }, apiKey: 'k', tally, log: [],
  })
  assert.equal(tally.rejected, 1, 'the picture is still not published')
  assert.equal(tally.failed, 1, 'but it is not pretending to be a judgement')
  assert.deepEqual(Object.keys(tally.reasons), ['error'])
})

test('a run reports its picture tally so it can be read without grepping logs', async () => {
  const store = memStore()
  const r = await runPipeline({
    store, now: new Date('2026-09-17T12:00:00Z'), items: [], write: async () => null,
    env: { ANTHROPIC_API_KEY: 'k' },
  })
  assert.ok(r.pictures, 'every run carries one, even when it reviewed nothing')
  assert.equal(r.pictures.reviewed, 0)
  const history = store.m.get(KEYS.history)
  assert.ok('pictures' in history[0], 'and it is kept in the history, so the trend is visible')
})

/* ---------- finding more pictures ---------- */

import { commonsCandidates, wikipediaImages, candidatesFor } from './images.mjs'

const okLicence = { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: 'Jane' } }
const page = (title, url, extra = {}) => ({
  title, index: extra.index ?? 1,
  imageinfo: [{ thumburl: url, thumbwidth: 1920, thumbheight: 1080, descriptionurl: 'https://commons/x', extmetadata: okLicence, ...extra }],
})
const commonsReply = (pages) => JSON.stringify({ query: { pages: Object.fromEntries(pages.map((p, i) => [i + 1, { ...p, index: i + 1 }])) } })

test('Commons offers every usable result, in relevance order', async () => {
  const body = commonsReply([
    page('File:A.jpg', 'https://upload.wikimedia.org/a.jpg'),
    // Unacceptable licence: still filtered, as always.
    page('File:B.jpg', 'https://upload.wikimedia.org/b.jpg', { extmetadata: { LicenseShortName: { value: 'All rights reserved' } } }),
    page('File:C.jpg', 'https://upload.wikimedia.org/c.jpg'),
  ])
  const got = await commonsCandidates('octopus', { fetchImpl: async () => ({ ok: true, status: 200, text: async () => body }) })
  assert.deepEqual(got.map((g) => g.url.split('/').pop()), ['a.jpg', 'c.jpg'])
  assert.equal(got[0].kind, 'illustration')
})

test('a description mentioning a person no longer discards the picture', async () => {
  // This filter used to skip anything whose text said man/woman/child/people.
  // It never knew what was in the frame, and it cost us good pictures.
  const body = commonsReply([page('File:Woman_in_the_Moon_crater.jpg', 'https://upload.wikimedia.org/moon.jpg')])
  const got = await commonsCandidates('moon crater', { fetchImpl: async () => ({ ok: true, status: 200, text: async () => body }) })
  assert.equal(got.length, 1, 'the vision check decides this now, by looking')
})

test('a picture smaller than the stage is still worth showing', async () => {
  const small = page('File:S.jpg', 'https://upload.wikimedia.org/s.jpg')
  small.imageinfo[0].thumbwidth = 700
  small.imageinfo[0].thumbheight = 480
  const got = await commonsCandidates('q', { fetchImpl: async () => ({ ok: true, status: 200, text: async () => commonsReply([small]) }) })
  assert.equal(got.length, 1, '700px of the right subject beats a typographic card')

  const tiny = page('File:T.jpg', 'https://upload.wikimedia.org/t.jpg')
  tiny.imageinfo[0].thumbwidth = 320
  tiny.imageinfo[0].thumbheight = 200
  const none = await commonsCandidates('q', { fetchImpl: async () => ({ ok: true, status: 200, text: async () => commonsReply([tiny]) }) })
  assert.equal(none.length, 0, 'but a thumbnail is still a thumbnail')
})

test('the encyclopaedia’s own pictures are offered, in the order the article uses them', async () => {
  const fetchImpl = async (u) => {
    if (u.includes('list=search')) return { ok: true, status: 200, text: async () => JSON.stringify({ query: { search: [{ title: 'Octopus' }] } }) }
    if (u.includes('prop=images')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ query: { pages: { 1: { images: [
        { title: 'File:Commons-logo.svg' },          // interface furniture
        { title: 'File:Octopus_lead.jpg' },
        { title: 'File:Question_book-new.svg' },     // interface furniture
        { title: 'File:Octopus_arms.jpg' },
      ] } } } }) }
    }
    return { ok: true, status: 200, text: async () => commonsReply([
      page('File:Octopus_lead.jpg', 'https://upload.wikimedia.org/lead.jpg'),
      page('File:Octopus_arms.jpg', 'https://upload.wikimedia.org/arms.jpg'),
    ]) }
  }
  const got = await wikipediaImages('octopus hearts', { fetchImpl })
  assert.deepEqual(got.map((g) => g.url.split('/').pop()), ['lead.jpg', 'arms.jpg'])
  assert.equal(got[0].fromArticle, 'Octopus')

  // No article, no pictures — and no exception.
  assert.deepEqual(await wikipediaImages('zzz', { fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ query: { search: [] } }) }) }), [])
})

test('candidates come from every source, best first, with no duplicates', async () => {
  const fetchImpl = async (u) => {
    if (u.includes('images-api.nasa.gov')) return { ok: true, status: 200, text: async () => JSON.stringify({ collection: { items: [] } }) }
    if (u.includes('list=search')) return { ok: true, status: 200, text: async () => JSON.stringify({ query: { search: [{ title: 'Octopus' }] } }) }
    if (u.includes('prop=images')) return { ok: true, status: 200, text: async () => JSON.stringify({ query: { pages: { 1: { images: [{ title: 'File:Shared.jpg' }] } } } }) }
    return { ok: true, status: 200, text: async () => commonsReply([
      page('File:Shared.jpg', 'https://upload.wikimedia.org/shared.jpg'),
      page('File:Only_search.jpg', 'https://upload.wikimedia.org/only.jpg'),
    ]) }
  }
  const got = await candidatesFor('facts', { imageQuery: 'octopus' }, { items: [] }, { fetchImpl, log: [] })
  assert.deepEqual(got.map((g) => g.url.split('/').pop()), ['shared.jpg', 'only.jpg'], 'the article picture first, then search, each once')
})

test('a rejection moves to the next candidate instead of ending the search', async () => {
  const body = commonsReply([
    page('File:Bad.jpg', 'https://upload.wikimedia.org/bad.jpg'),
    page('File:Good.jpg', 'https://upload.wikimedia.org/good.jpg'),
  ])
  const fetchImpl = async (u) => (u.startsWith('https://upload.wikimedia.org')
    ? { ok: true, status: 200, headers: { get: () => 'image/jpeg' } }
    : { ok: true, status: 200, text: async () => (u.includes('list=search') ? JSON.stringify({ query: { search: [] } }) : body) })

  const seenByReview = []
  const review = async (img) => { seenByReview.push(img.url); return img.url.includes('good') ? img : null }
  const img = await findImage('health', { imageQuery: 'q', headline: 'h' }, { items: [] }, { fetchImpl, log: [], review })
  assert.equal(img.url.split('/').pop(), 'good.jpg')
  assert.equal(seenByReview.length, 2, 'it kept going after the first was turned down')
})

test('one story can never spend more than its review budget', async () => {
  const many = Array.from({ length: 30 }, (_, i) => page(`File:${i}.jpg`, `https://upload.wikimedia.org/${i}.jpg`))
  const fetchImpl = async (u) => (u.startsWith('https://upload.wikimedia.org')
    ? { ok: true, status: 200, headers: { get: () => 'image/jpeg' } }
    : { ok: true, status: 200, text: async () => (u.includes('list=search') ? JSON.stringify({ query: { search: [] } }) : commonsReply(many)) })
  let calls = 0
  const review = async () => { calls++; return null } // nothing is ever good enough
  const out = await findMedia('health', { imageQuery: 'q', headline: 'h' }, { items: [] }, { fetchImpl, log: [], review })
  assert.deepEqual(out.gallery, [])
  assert.ok(calls <= 8, `stopped at the budget, not the list (${calls} calls)`)
  assert.ok(calls >= 4, 'but did try properly first')
})

test('a reel fills up from a wide pool rather than a fixed four', async () => {
  const pages = Array.from({ length: 8 }, (_, i) => page(`File:${i}.jpg`, `https://upload.wikimedia.org/${i}.jpg`))
  const fetchImpl = async (u) => (u.startsWith('https://upload.wikimedia.org')
    ? { ok: true, status: 200, headers: { get: () => 'image/jpeg' } }
    : { ok: true, status: 200, text: async () => (u.includes('list=search') ? JSON.stringify({ query: { search: [] } }) : commonsReply(pages)) })
  // The first three are no good; the reel should still fill.
  let n = 0
  const review = async (img) => (++n <= 3 ? null : img)
  const out = await findMedia('health', { imageQuery: 'q', headline: 'h' }, { items: [] }, { fetchImpl, log: [], review })
  assert.equal(out.gallery.length, 4)
  assert.ok(out.image, 'and the lead picture is the first that passed')
})


import { smallerVersion } from './review.mjs'

test('a host that refuses our User-Agent gets one plain retry, and is named if it still refuses', async () => {
  const tried = []
  const fetchImpl = async (u, init = {}) => {
    tried.push(init.headers?.['User-Agent'] ? 'with-ua' : 'plain')
    if (init.headers?.['User-Agent']) return { ok: false, status: 403, headers: { get: () => null } }
    return { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new Uint8Array([1]).buffer }
  }
  const out = await fetchImageData({ url: 'https://images-assets.nasa.gov/image/x/x~large.jpg' }, { fetchImpl })
  assert.deepEqual(tried, ['with-ua', 'plain'], 'one retry, not a loop')
  assert.equal(out.media_type, 'image/jpeg')

  // Still refused: the message says which service said no.
  const always403 = async () => ({ ok: false, status: 403, headers: { get: () => null } })
  await assert.rejects(
    () => fetchImageData({ url: 'https://upload.wikimedia.org/a.jpg' }, { fetchImpl: always403 }),
    /HTTP 403 from upload\.wikimedia\.org/,
  )
})

test('an oversized Commons file is answered by asking Commons, not by inventing a URL', async () => {
  // Building a thumbnail URL returned 400 last time: Commons will not upscale,
  // and only Commons knows how big the original is.
  const asked = []
  const small = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Big.jpg/800px-Big.jpg'
  const fetchImpl = async (u) => {
    asked.push(u)
    if (u.startsWith('https://commons.wikimedia.org')) {
      return { ok: true, text: async () => JSON.stringify({ query: { pages: { 1: { imageinfo: [{ thumburl: small }] } } } }) }
    }
    const big = !u.includes('800px')
    return { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new Uint8Array(big ? 4_000_000 : 40).buffer }
  }
  const img = { url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Big.jpg', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Big.jpg' }
  const out = await fetchImageData(img, { fetchImpl })
  assert.ok(asked.some((u) => u.includes('iiurlwidth=800')), 'it asked Commons for a smaller one')
  assert.equal(out.data, Buffer.from(new Uint8Array(40)).toString('base64'))

  assert.equal(await smallerVersion({ url: 'https://images-assets.nasa.gov/image/x/x~orig.jpg' }), 'https://images-assets.nasa.gov/image/x/x~small.jpg')
  assert.equal(await smallerVersion({ url: 'https://elsewhere.test/a.jpg' }), null, 'and invents nothing for a host it does not know')
})

test('a picture with nowhere smaller to go is left unpublished, with the host named', async () => {
  const fetchImpl = async () => ({ ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new Uint8Array(4_000_000).buffer })
  await assert.rejects(
    () => fetchImageData({ url: 'https://elsewhere.test/huge.jpg' }, { fetchImpl }),
    /too large to review .*elsewhere\.test offers nothing smaller/,
  )
})
