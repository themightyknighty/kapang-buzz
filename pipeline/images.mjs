/**
 * Step 6 — find a picture we are allowed to show, or show none.
 *
 *  - Celebrity: the person's own Wikidata image (P18) from Wikimedia Commons,
 *    only under an accepted licence, credited on screen.
 *  - Facts: NASA's image library, then the subject's Wikipedia article, then
 *    Commons search.
 *  - Health / Bizarre: the subject's Wikipedia article, then Commons search.
 *
 * Every source offers a LIST, and the caller works down it until enough
 * pictures have passed the review in review.mjs. That shape matters: when a
 * picture could only be rejected for its licence, one candidate per source was
 * enough; now that it can also be rejected for what is in the frame, one
 * candidate per source means one rejection leaves the story bare. A budget
 * caps how many any single story may look at, so a subject nothing suits
 * cannot spend the whole bill.
 *
 * No licence, unclear licence, a personality-rights warning, a dead link or a
 * picture the review turns down → no image, and the app draws a typographic
 * card instead.
 */
import { ACCEPTED_LICENCES } from './config.mjs'
import { fetchText, stripHtml } from './harvest.mjs'
import { reviewImage, storyContextOf, reviewModel } from './review.mjs'

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php'
const NASA_IMAGES_API = 'https://images-api.nasa.gov/search'
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php'

const getJson = async (url, fetchImpl) => JSON.parse(await fetchText(url, { fetchImpl, timeoutMs: 12000 }))

const num = (k, d) => { const v = Number(process.env?.[k]); return Number.isFinite(v) ? v : d }
const MIN_WIDTH = num('PICTURE_MIN_WIDTH', 560)
const MIN_HEIGHT = num('PICTURE_MIN_HEIGHT', 360)
/** How many pictures one story may have looked at. Bounds the API bill. */
const REVIEW_BUDGET = num('PICTURE_REVIEW_BUDGET', 8)

/**
 * Does this URL actually serve a picture?
 *
 * Every image we publish is hosted by someone else, and a URL that an API
 * handed us is a claim, not a fact: NASA's search results advertise a `~large`
 * rendition that, for a good many items, was never generated — so the feed
 * carried image links that 404'd for every reader. Nothing goes into a story
 * now without being asked to prove it exists.
 *
 * HEAD first because it costs no bytes. Some CDNs refuse HEAD, so a rejection
 * that is not a 404 falls back to a one-byte ranged GET rather than being
 * taken as proof of absence.
 */
export async function imageLoads(url, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  if (!url) return false
  const isImage = (res) => res.ok && /^image\//i.test(res.headers?.get?.('content-type') || 'image/')
  const attempt = async (init) => {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      return await fetchImpl(url, { ...init, signal: ctl.signal, headers: { 'User-Agent': UA, ...(init.headers || {}) } })
    } finally { clearTimeout(timer) }
  }
  try {
    const head = await attempt({ method: 'HEAD' })
    if (isImage(head)) return true
    if (head.status === 404 || head.status === 410) return false
  } catch { /* fall through to the ranged GET */ }
  try {
    return isImage(await attempt({ method: 'GET', headers: { Range: 'bytes=0-0' } }))
  } catch {
    return false
  }
}

/** Identify ourselves to Commons and NASA, as both ask API clients to do. */
const UA = 'GossipGenie/1.0 (+https://kapang-buzz.netlify.app)'

/** The first of these images that actually loads, or null. */
async function firstThatLoads(images, { fetchImpl, log, what = 'image' } = {}) {
  for (const img of images.filter(Boolean)) {
    if (await imageLoads(img.url, { fetchImpl })) return img
    log?.push(`${what}: ${img.url.split('/').pop()} does not load — skipping it`)
  }
  return null
}

export function licenceAccepted(shortName) {
  const s = String(shortName || '').trim()
  return Boolean(s) && ACCEPTED_LICENCES.some((re) => re.test(s))
}

/**
 * Commons imageinfo → our image record, or null if it may not be shown.
 * @param {object} page  a page from prop=imageinfo&iiprop=url|extmetadata
 */
export function readCommonsPage(page) {
  const info = page?.imageinfo?.[0]
  if (!info) return null
  const md = info.extmetadata || {}
  const licence = md.LicenseShortName?.value
  if (!licenceAccepted(licence)) return null
  if (md.Restrictions?.value) return null // personality rights, trademarks, etc.
  if (/\.(svg|gif|tiff?|pdf|djvu|webm|ogv)$/i.test(page.title || '')) return null
  const w = info.thumbwidth || info.width, h = info.thumbheight || info.height
  // Small enough to look poor blown up, rather than merely smaller than the
  // stage. Every screen fits pictures to their box, and a 700px photograph of
  // the right thing beats the typographic card.
  if (w && h && (w < MIN_WIDTH || h < MIN_HEIGHT)) return null
  return {
    url: info.thumburl || info.url,
    width: w || null,
    height: h || null,
    credit: stripHtml(md.Artist?.value || 'Unknown photographer').slice(0, 80),
    licence,
    licenceUrl: md.LicenseUrl?.value || null,
    sourceUrl: info.descriptionurl,
    provider: 'Wikimedia Commons',
  }
}

export async function celebrityImage(name, { fetchImpl } = {}) {
  const search = await getJson(`${WIKIDATA_API}?${new URLSearchParams({
    action: 'wbsearchentities', search: name, language: 'en', type: 'item', limit: '3', format: 'json', origin: '*',
  })}`, fetchImpl)
  for (const hit of search.search || []) {
    const ent = await getJson(`${WIKIDATA_API}?${new URLSearchParams({
      action: 'wbgetentities', ids: hit.id, props: 'claims', format: 'json', origin: '*',
    })}`, fetchImpl)
    const claims = ent.entities?.[hit.id]?.claims || {}
    const isHuman = (claims.P31 || []).some((c) => c.mainsnak?.datavalue?.value?.id === 'Q5')
    if (!isHuman) continue
    if (claims.P570) return null // we do not run pictures of people who have died; the story should not exist either
    const file = claims.P18?.[0]?.mainsnak?.datavalue?.value
    if (!file) return null
    const data = await getJson(`${COMMONS_API}?${new URLSearchParams({
      action: 'query', titles: `File:${file}`, prop: 'imageinfo', iiprop: 'url|size|extmetadata',
      iiurlwidth: '1920', format: 'json', origin: '*',
    })}`, fetchImpl)
    const page = Object.values(data.query?.pages || {})[0]
    const img = readCommonsPage(page)
    return img ? { ...img, kind: 'person', alt: name, filePhoto: true } : null
  }
  return null
}

/**
 * Every Commons result we are allowed to use, in relevance order.
 *
 * This used to return the FIRST acceptable file and throw the other eleven
 * away. That was affordable when the only gate was a licence check; once a
 * picture can also be turned down for what is in it, one candidate per search
 * means one rejection leaves the story with nothing. The caller reviews down
 * the list instead.
 *
 * The keyword filter that used to sit here — skipping any file whose title or
 * description mentioned a person, a portrait, a crowd — is gone. It was a
 * guess at the contents made from the text, which is precisely the guess that
 * put a photograph of a child under a lottery headline, and meanwhile it threw
 * away good pictures for incidental words. The vision check does this properly
 * now, by looking.
 */
export async function commonsCandidates(query, { fetchImpl, limit = 16 } = {}) {
  const data = await getJson(`${COMMONS_API}?${new URLSearchParams({
    action: 'query', generator: 'search', gsrsearch: `${query} filetype:bitmap`, gsrnamespace: '6', gsrlimit: String(limit),
    prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: '1920', format: 'json', origin: '*',
  })}`, fetchImpl)
  return Object.values(data.query?.pages || {})
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .map((p) => { const img = readCommonsPage(p); return img && { ...img, kind: 'illustration', alt: query } })
    .filter(Boolean)
}

/**
 * The pictures an encyclopaedia chose for this subject.
 *
 * Commons search ranks by filename and text, so "octopus" can return a boat
 * called Octopus before it returns an octopus. The Wikipedia article on a
 * subject has already had its illustrations chosen by someone who read it,
 * and they are hosted on Commons under the same licences we already accept —
 * so this is both the most on-topic source available and the cheapest to
 * trust. It matters most for Fantastic Facts, where the subject is a thing
 * rather than an event and a good photograph of that thing always exists.
 */
export async function wikipediaImages(query, { fetchImpl, max = 8 } = {}) {
  const found = await getJson(`${WIKIPEDIA_API}?${new URLSearchParams({
    action: 'query', list: 'search', srsearch: query, srlimit: '1', srnamespace: '0', format: 'json', origin: '*',
  })}`, fetchImpl)
  const title = found.query?.search?.[0]?.title
  if (!title) return []

  const listed = await getJson(`${WIKIPEDIA_API}?${new URLSearchParams({
    action: 'query', titles: title, prop: 'images', imlimit: '30', format: 'json', origin: '*',
  })}`, fetchImpl)
  const files = (Object.values(listed.query?.pages || {})[0]?.images || [])
    .map((i) => i.title)
    // Interface furniture, not illustration: every article carries some.
    .filter((t) => !/(commons-logo|wiki(pedia|media|quote|source)|edit-ltr|question_book|ambox|disambig|padlock|symbol_|icon|flag_of|coat_of_arms)/i.test(t))
    .filter((t) => /\.(jpe?g|png)$/i.test(t))
    .slice(0, 12)
  if (!files.length) return []

  const data = await getJson(`${COMMONS_API}?${new URLSearchParams({
    action: 'query', titles: files.join('|'), prop: 'imageinfo', iiprop: 'url|size|extmetadata',
    iiurlwidth: '1920', format: 'json', origin: '*',
  })}`, fetchImpl)
  /*
   * Article order is editorial order: the lead picture comes first. Anything
   * Commons returns that we did not ask for is dropped rather than sorted —
   * an unknown title indexes as -1, which would otherwise put a file we never
   * requested ahead of the lead.
   */
  const rank = new Map(files.map((t, i) => [t, i]))
  const pages = Object.values(data.query?.pages || {})
    .filter((p) => rank.has(p.title))
    .sort((a, b) => rank.get(a.title) - rank.get(b.title))
  return pages.map(readCommonsPage).filter(Boolean)
    .map((img) => ({ ...img, kind: 'illustration', alt: query, fromArticle: title }))
    .slice(0, max)
}

/** The single best Commons result, for callers that only want one. */
export async function commonsSearch(query, opts = {}) {
  return (await commonsCandidates(query, opts))[0] || null
}

export function readNasa(data) {
  for (const item of data?.collection?.items || []) {
    const d = item.data?.[0]
    const preview = (item.links || []).find((l) => l.rel === 'preview' || l.render === 'image')
    if (!d || d.media_type !== 'image' || !preview) continue
    const text = `${d.description || ''} ${d.photographer || ''} ${d.secondary_creator || ''}`
    if (/©|copyright|courtesy of (?!nasa)/i.test(text)) continue // third-party material NASA uses with permission
    /*
     * NASA renditions are NOT all generated for every item.
     *
     * The search result advertises a `~thumb`, and rewriting that to `~large`
     * looked like a free upgrade — but plenty of items only ever had `~orig`
     * and `~thumb`, so the rewrite produced a 404 and the story shipped with a
     * broken picture. The sizes are offered in preference order and the caller
     * takes the first that actually loads.
     */
    const base = preview.href.replace(/~\w+\.jpg$/, '')
    return {
      url: `${base}~large.jpg`,
      candidates: ['large', 'medium', 'orig', 'thumb'].map((s) => `${base}~${s}.jpg`),
      credit: `NASA${d.center ? ' / ' + d.center : ''}`,
      licence: 'Public domain (NASA)',
      licenceUrl: 'https://www.nasa.gov/nasa-brand-center/images-and-media/',
      sourceUrl: `https://images.nasa.gov/details/${d.nasa_id}`,
      provider: 'NASA Image and Video Library',
      kind: 'illustration',
      alt: d.title,
    }
  }
  return null
}

export async function nasaImage(query, { fetchImpl, log } = {}) {
  const img = readNasa(await getJson(`${NASA_IMAGES_API}?${new URLSearchParams({ q: query, media_type: 'image' })}`, fetchImpl))
  return img ? resolveNasaSize(img, { fetchImpl, log }) : null
}

/** Several NASA results rather than one, for the same reason as Commons. */
export async function nasaCandidates(query, { fetchImpl, log, max = 6 } = {}) {
  const data = await getJson(`${NASA_IMAGES_API}?${new URLSearchParams({ q: query, media_type: 'image' })}`, fetchImpl)
  const out = []
  for (const item of (data?.collection?.items || []).slice(0, max * 2)) {
    const one = readNasa({ collection: { items: [item] } })
    const usable = one && await resolveNasaSize(one, { fetchImpl, log })
    if (usable) out.push(usable)
    if (out.length >= max) break
  }
  return out
}

/** Swap a NASA record's URL for the largest rendition that was actually made. */
export async function resolveNasaSize(img, { fetchImpl, log } = {}) {
  const found = await firstThatLoads(
    (img.candidates || [img.url]).map((url) => ({ ...img, url })),
    { fetchImpl, log, what: 'nasa' },
  )
  if (!found) return null
  const { candidates, ...clean } = found
  return clean
}

/** Public-domain RSS items sometimes carry their own picture (NASA image of the day). */
function ownImage(cluster) {
  const it = cluster.items.find((i) => i.publicDomain && i.imageUrl && /nasa\.gov/.test(i.imageUrl))
  return it ? {
    url: it.imageUrl, credit: it.credit, licence: 'Public domain (NASA)', sourceUrl: it.url,
    provider: it.credit, kind: 'illustration', alt: it.title,
  } : null
}

/*
 * Celebrity portraits are identity-bound: they come from the person's own
 * Wikidata entry, so the picture is of them because the lookup said so, not
 * because a search result looked right. Every other picture is an ILLUSTRATION
 * chosen by keyword, and an illustration has to be looked at before it runs.
 */
const isIllustration = (img, strand) => strand !== 'celebrity' && img?.kind !== 'person'


/**
 * Every picture worth considering for this story, best first.
 *
 * Sources in order of how likely they are to be both right and usable, each
 * offering a list rather than a single result. One rejection used to end a
 * source's turn; now it moves to the next candidate, which is the difference
 * between a story having a picture and a story having a card.
 */
export async function candidatesFor(strand, draft, cluster, { fetchImpl, log } = {}) {
  const out = []
  const add = async (label, fn) => {
    try { out.push(...(await fn()).filter(Boolean)) } catch (err) { log?.push(`${label} lookup failed (${err.message})`) }
  }
  if (strand === 'celebrity') {
    for (const name of (draft.people || []).slice(0, 2)) await add('celebrity', async () => [await celebrityImage(name, { fetchImpl })])
    return out
  }
  await add('own', async () => [ownImage(cluster)])
  if (draft.imageQuery) {
    if (strand === 'facts') await add('nasa', () => nasaCandidates(draft.imageQuery, { fetchImpl, log }))
    await add('wikipedia', () => wikipediaImages(draft.imageQuery, { fetchImpl }))
    await add('commons', () => commonsCandidates(draft.imageQuery, { fetchImpl }))
  }
  // The same file can surface from the article and from search.
  const seen = new Set()
  return out.filter((i) => i?.url && !seen.has(i.url) && seen.add(i.url))
}

/**
 * Walk candidates until enough have passed, spending no more than `budget`
 * reviews on this story however long the list is.
 */
async function takeReviewed(candidates, want, { strand, context, fetchImpl, log, tally, env, review, budget }) {
  const kept = []
  for (const img of candidates) {
    if (kept.length >= want || budget.left <= 0) break
    if (!await imageLoads(img.url, { fetchImpl })) {
      log?.push(`image ${img.url.split('/').pop().slice(0, 50)} does not load — next candidate`)
      continue
    }
    if (!isIllustration(img, strand)) { kept.push(img); continue }
    budget.left--
    const ok = await review(img, context, {
      fetchImpl, log, tally,
      apiKey: env.ANTHROPIC_API_KEY, model: reviewModel(env), workspaceId: env.ANTHROPIC_WORKSPACE_ID,
    })
    if (ok) kept.push(ok)
  }
  return kept
}

export async function findImage(strand, draft, cluster, { fetchImpl, log, tally, review = reviewImage, env = process.env, budget } = {}) {
  const candidates = await candidatesFor(strand, draft, cluster, { fetchImpl, log })
  const kept = await takeReviewed(candidates, 1, {
    strand, context: storyContextOf(draft), fetchImpl, log, tally, env, review,
    budget: budget || { left: REVIEW_BUDGET },
  })
  if (!kept.length && candidates.length) log?.push(`no usable picture from ${candidates.length} candidate(s)`)
  return kept[0] || null
}

/* ==================================================================
   Galleries and video — the vertical screen needs movement.

   Same rules as single images: accepted licences only, no personality-rights
   restrictions, credited on screen. Celebrity galleries only use files whose
   name contains the person's surname, so a category photo of someone else
   standing next to them never slips in.
   ================================================================== */

export async function celebrityGallery(name, { fetchImpl, max = 4 } = {}) {
  const search = await getJson(`${WIKIDATA_API}?${new URLSearchParams({
    action: 'wbsearchentities', search: name, language: 'en', type: 'item', limit: '3', format: 'json', origin: '*',
  })}`, fetchImpl)
  for (const hit of search.search || []) {
    const ent = await getJson(`${WIKIDATA_API}?${new URLSearchParams({
      action: 'wbgetentities', ids: hit.id, props: 'claims', format: 'json', origin: '*',
    })}`, fetchImpl)
    const claims = ent.entities?.[hit.id]?.claims || {}
    if (!(claims.P31 || []).some((c) => c.mainsnak?.datavalue?.value?.id === 'Q5')) continue
    if (claims.P570) return []
    const files = []
    const p18 = claims.P18?.[0]?.mainsnak?.datavalue?.value
    if (p18) files.push(`File:${p18}`)
    const category = claims.P373?.[0]?.mainsnak?.datavalue?.value
    if (category) {
      const cat = await getJson(`${COMMONS_API}?${new URLSearchParams({
        action: 'query', list: 'categorymembers', cmtitle: `Category:${category}`, cmtype: 'file', cmlimit: '30', format: 'json', origin: '*',
      })}`, fetchImpl)
      for (const m of cat.query?.categorymembers || []) files.push(m.title)
    }
    const surname = name.trim().split(/\s+/).pop().toLowerCase()
    const wanted = [...new Set(files)].filter((t, i) => i === 0 || t.toLowerCase().includes(surname)).slice(0, 12)
    if (!wanted.length) return []
    const data = await getJson(`${COMMONS_API}?${new URLSearchParams({
      action: 'query', titles: wanted.join('|'), prop: 'imageinfo', iiprop: 'url|size|extmetadata',
      iiurlwidth: '1920', format: 'json', origin: '*',
    })}`, fetchImpl)
    const pages = Object.values(data.query?.pages || {})
    pages.sort((a, b) => wanted.indexOf(a.title) - wanted.indexOf(b.title))
    return pages.map(readCommonsPage).filter(Boolean).slice(0, max)
      .map((img) => ({ ...img, kind: 'person', alt: name, filePhoto: true }))
  }
  return []
}

export async function commonsGallery(query, { fetchImpl, max = 4 } = {}) {
  const data = await getJson(`${COMMONS_API}?${new URLSearchParams({
    action: 'query', generator: 'search', gsrsearch: `${query} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '20',
    prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: '1920', format: 'json', origin: '*',
  })}`, fetchImpl)
  const out = []
  for (const p of Object.values(data.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0))) {
    const desc = `${p.title} ${p.imageinfo?.[0]?.extmetadata?.ImageDescription?.value || ''}`
    if (/\b(portrait|selfie|man|woman|boy|girl|child|people|person|crowd)\b/i.test(desc)) continue
    const img = readCommonsPage(p)
    if (img) out.push({ ...img, kind: 'illustration', alt: query })
    if (out.length >= max) break
  }
  return out
}

export async function nasaGallery(query, { fetchImpl, max = 4, log } = {}) {
  const data = await getJson(`${NASA_IMAGES_API}?${new URLSearchParams({ q: query, media_type: 'image' })}`, fetchImpl)
  const out = []
  for (const item of data?.collection?.items || []) {
    const one = readNasa({ collection: { items: [item] } })
    // Each gallery frame resolves to a rendition that exists, exactly as the
    // lead image does — a broken picture is no more acceptable at slide three.
    const usable = one && await resolveNasaSize(one, { fetchImpl, log })
    if (usable) out.push(usable)
    if (out.length >= max) break
  }
  return out
}

/* ==================================================================
   Video.

   Pictures go through the picture desk: every one is looked at and asked
   whether it shows what the story is about. Video went through none of that —
   it was the first search hit with an acceptable licence, and nothing ever
   asked whether it was relevant. Commons holds comparatively few videos, so
   for most queries the "best" match is barely related to the story, and a
   report about an elk jumping on a car was illustrated with ducks.

   A wrong still reads as a stock illustration. A wrong clip fills the frame
   for a minute and reads as footage OF THE STORY, so it is a worse mistake and
   gets a higher bar: a cheap word match to drop the hopeless, then the same
   vision check the pictures pass, run against the clip's own poster frame.
   Nothing that fails is published — no footage is better than wrong footage.
   ================================================================== */

/*
 * Words worth matching a file against: the query's own, minus the ones every
 * file on Commons would satisfy. Three letters and up, because "elk", "ice"
 * and "cat" are exactly the sort of term that carries a story.
 */
const QUERY_STOP = new Set(('the and for with from that this near over into onto about after before '
  + 'video videos footage clip clips film movie scene shot view image images photo photos '
  + 'new news story report shows showing seen caught camera').split(' '))

export function queryTerms(query) {
  return [...new Set(String(query || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length >= 3 && !QUERY_STOP.has(w)))]
}

/**
 * Does this file plainly mention any of what we searched for?
 *
 * This ORDERS candidates; it never rejects one. A clip on the live feed that
 * genuinely showed a car's numberplates was titled "Coche con placas de
 * Sinaloa" — relevant, and sharing not one English word with the query. A
 * filter would have thrown it away and kept nothing; a ranking puts the
 * obvious matches first and still looks at the rest when there is budget.
 * The vision check is the only thing that rejects.
 */
/*
 * The forms of a word that should count as the same word.
 *
 * Both sides are expanded rather than reduced to a stem, because reducing is
 * where this goes wrong: "volcanoes" stripped of a trailing s is "volcanoe",
 * which matches nothing, and a clip captioned "Volcano lava flow" would have
 * been thrown away for a story about volcanoes erupting. Expanding both and
 * looking for any overlap gets there without needing a real stemmer.
 */
function forms(w) {
  const f = new Set([w])
  if (w.endsWith('ies')) f.add(`${w.slice(0, -3)}y`)
  if (w.endsWith('es')) { f.add(w.slice(0, -2)); f.add(w.slice(0, -1)) }
  else if (w.endsWith('s')) f.add(w.slice(0, -1))
  else { f.add(`${w}s`); f.add(`${w}es`) }
  return f
}

export function mentionsQuery(text, query) {
  const terms = queryTerms(query)
  if (!terms.length) return true
  const words = new Set(String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
    .flatMap((w) => [...forms(w)]))
  return terms.some((t) => [...forms(t)].some((f) => words.has(f)))
}

/** NASA video search results → every usable clip, best match first. */
export function readNasaVideoSearch(data, { query = null } = {}) {
  const out = []
  for (const item of data?.collection?.items || []) {
    const d = item.data?.[0]
    if (!d || d.media_type !== 'video' || !item.href) continue
    const text = `${d.description || ''} ${d.photographer || ''} ${d.secondary_creator || ''}`
    if (/©|copyright|courtesy of (?!nasa)/i.test(text)) continue
    out.push({
      matches: !query || mentionsQuery(`${d.title || ''} ${d.description || ''} ${(d.keywords || []).join(' ')}`, query),
      collection: item.href, nasaId: d.nasa_id, title: d.title, center: d.center,
      description: d.description || '',
      // NASA's search result already carries a preview frame, which is what
      // the picture desk will actually look at.
      poster: (item.links || []).find((l) => l.rel === 'preview' && /\.(jpg|jpeg|png)$/i.test(l.href || ''))?.href || null,
    })
  }
  return out
}

/** NASA collection.json (a list of file URLs) → the lightest mp4 that is still watchable. */
export function pickNasaMp4(files) {
  const mp4 = (files || []).filter((u) => /\.mp4$/i.test(u))
  return mp4.find((u) => /~mobile\.mp4$/i.test(u)) || mp4.find((u) => /~medium\.mp4$/i.test(u))
    || mp4.find((u) => /~small\.mp4$/i.test(u)) || mp4.find((u) => !/~orig\.mp4$/i.test(u)) || null
}

/** Every NASA clip worth considering for this story, best match first. */
export async function nasaVideos(query, { fetchImpl, max = 3 } = {}) {
  const hits = readNasaVideoSearch(
    await getJson(`${NASA_IMAGES_API}?${new URLSearchParams({ q: query, media_type: 'video' })}`, fetchImpl),
    { query },
  )
  const out = []
  // Ranked BEFORE the cut, or a clip that actually mentions the story could be
  // trimmed off the end in favour of one that merely came back first.
  const ranked = hits.slice().sort((a, b) => Number(b.matches) - Number(a.matches))
  for (const hit of ranked.slice(0, max)) {
    const url = pickNasaMp4(await getJson(hit.collection.replace(/^http:/, 'https:'), fetchImpl))
    if (!url) continue
    out.push({
      url: url.replace(/^http:/, 'https:'), type: 'video/mp4', credit: `NASA${hit.center ? ' / ' + hit.center : ''}`,
      licence: 'Public domain (NASA)', sourceUrl: `https://images.nasa.gov/details/${hit.nasaId}`,
      provider: 'NASA Image and Video Library', alt: hit.title, description: hit.description,
      poster: hit.poster, matches: hit.matches,
    })
  }
  return out
}

/** Commons videoinfo page → a web-playable transcode under an accepted licence. */
export function readCommonsVideo(page) {
  const info = page?.videoinfo?.[0]
  if (!info) return null
  const md = info.extmetadata || {}
  if (!licenceAccepted(md.LicenseShortName?.value) || md.Restrictions?.value) return null
  const desc = `${page.title} ${md.ImageDescription?.value || ''}`
  if (/\b(portrait|interview|man|woman|boy|girl|child|people|person|crowd)\b/i.test(desc)) return null
  const d = (info.derivatives || []).filter((x) => /webm|mp4/.test(x.type || '') && (x.height || 0) >= 360 && (x.height || 0) <= 720)
    .sort((a, b) => (b.height || 0) - (a.height || 0))[0]
  if (!d) return null
  return {
    url: d.src, type: /mp4/.test(d.type) ? 'video/mp4' : 'video/webm',
    credit: stripHtml(md.Artist?.value || 'Unknown').slice(0, 80), licence: md.LicenseShortName.value,
    sourceUrl: info.descriptionurl, provider: 'Wikimedia Commons', alt: page.title.replace(/^File:/, ''),
    description: stripHtml(md.ImageDescription?.value || ''),
    // The frame the picture desk will look at. Commons renders one for every
    // video; without it there is nothing to review and the clip is dropped.
    poster: info.thumburl || null,
  }
}

/** Every Commons clip worth considering for this story, best match first. */
export async function commonsVideos(query, { fetchImpl, max = 3 } = {}) {
  const data = await getJson(`${COMMONS_API}?${new URLSearchParams({
    action: 'query', generator: 'search', gsrsearch: `${query} filetype:video`, gsrnamespace: '6', gsrlimit: '10',
    prop: 'videoinfo', viprop: 'url|size|extmetadata|derivatives', viurlwidth: '640', format: 'json', origin: '*',
  })}`, fetchImpl)
  const out = []
  for (const p of Object.values(data.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0))) {
    const v = readCommonsVideo(p)
    if (!v) continue
    // Commons' full-text search will happily return a file that shares no
    // word with the query, because its video collection is small and it
    // returns the nearest thing it has. That is where the ducks came from —
    // so the ones that do share a word are looked at first.
    out.push({ ...v, matches: mentionsQuery(`${v.alt} ${v.description}`, query) })
    if (out.length >= max * 2) break
  }
  return out
}

/** How many clips are worth paying a vision call to look at. */
export const VIDEO_REVIEW_MAX = num('BUZZ_VIDEO_REVIEW_MAX', 2)

/**
 * The clip for this story, or nothing.
 *
 * Every candidate's poster frame goes through the same picture desk the
 * stills pass, asked the same question: does this show what the story is
 * about? The first that passes is published with its review stamp; if none
 * does, the story runs without footage and the reel carries it instead.
 *
 * The stamp matters beyond the record: the player refuses to play a clip that
 * does not carry one, so this is also what stops an unvetted clip going to
 * air.
 */
export async function pickVideo(strand, draft, { fetchImpl, log, tally, env = process.env, review = reviewImage, safe = async (l, f, d) => { try { return await f() } catch { return d } } } = {}) {
  const query = draft.imageQuery
  const candidates = [
    ...(strand === 'facts' ? await safe('nasa video', () => nasaVideos(query, { fetchImpl }), []) : []),
    ...await safe('commons video', () => commonsVideos(query, { fetchImpl }), []),
  ]
  if (!candidates.length) { log?.push(`no video candidate for "${String(query).slice(0, 40)}"`); return null }

  // Whatever shares a word with the story goes first; the rest stay in the
  // queue rather than being thrown away, because a relevant clip can easily
  // be captioned in another language.
  candidates.sort((a, b) => Number(Boolean(b.matches)) - Number(Boolean(a.matches)))

  const context = storyContextOf(draft)
  let looked = 0
  for (const v of candidates) {
    if (looked >= VIDEO_REVIEW_MAX) break
    if (!v.poster) { log?.push(`video "${v.alt}" has no poster frame to check — skipped`); continue }
    looked++
    const ok = await review({ url: v.poster, kind: 'scene', alt: v.alt, credit: v.credit, licence: v.licence }, context, {
      fetchImpl, log, tally,
      apiKey: env.ANTHROPIC_API_KEY, model: reviewModel(env), workspaceId: env.ANTHROPIC_WORKSPACE_ID,
    })
    if (ok) {
      log?.push(`video kept: "${v.alt}" — ${ok.review?.saw || 'reviewed'}`)
      return { ...v, poster: v.poster, review: ok.review }
    }
    log?.push(`video rejected: "${v.alt}" does not show what the story is about`)
  }
  log?.push(`no usable video from ${candidates.length} candidate(s) — the story runs on stills`)
  return null
}

/**
 * Everything the vertical screen can move through for one story.
 * @returns {{image: object|null, gallery: object[], video: object|null}}
 */
export async function findMedia(strand, draft, cluster, { fetchImpl, log, tally, review = reviewImage, env = process.env } = {}) {
  const safe = async (label, fn, fallback) => {
    try { return await fn() } catch (err) { log?.push(`${label} lookup failed (${err.message})`); return fallback }
  }

  /*
   * One pool of candidates for the whole story, reviewed until four frames
   * have passed or the budget runs out.
   *
   * It used to pick exactly four and review those, so three rejections left a
   * reel of one. Sourcing wide and stopping when we have enough means a story
   * ends up short only when the pool is genuinely short — and the budget keeps
   * a story that nothing suits from spending the whole bill trying.
   */
  const pool = strand === 'celebrity'
    ? (await (async () => {
      const g = []
      for (const name of (draft.people || []).slice(0, 2)) {
        g.push(...await safe('gallery', () => celebrityGallery(name, { fetchImpl, max: 3 }), []))
        if (g.length >= 4) break
      }
      return g
    })())
    : await candidatesFor(strand, draft, cluster, { fetchImpl, log })

  const seen = new Set()
  const candidates = pool.filter((g) => g?.url && !seen.has(g.url) && seen.add(g.url))

  const budget = { left: REVIEW_BUDGET }
  const gallery = await takeReviewed(candidates, 4, {
    strand, context: storyContextOf(draft), fetchImpl, log, tally, env, review, budget,
  })
  log?.push(`pictures for "${String(draft.headline || '').slice(0, 40)}": ${candidates.length} candidate(s) → ${gallery.length} usable`)

  // Video only for non-celebrity strands: there is no licence-free footage of celebrities.
  const video = strand === 'celebrity' || !draft.imageQuery
    ? null
    : await pickVideo(strand, draft, { fetchImpl, log, tally, env, review, safe })
  return { image: gallery[0] || null, gallery, video }
}
