/**
 * PortraitAdapter — a licence-free photograph of each celebrity.
 *
 * The chain is Wikipedia page → Wikidata entity → P18 ("image") → the file on
 * Wikimedia Commons. That route matters: P18 is the picture Wikidata holds
 * FOR THAT PERSON, so the identity comes from the lookup rather than from a
 * search result that merely looked right. It is the same reason the news
 * pipeline resolves celebrity portraits this way, and the reason a photograph
 * of a child once ended up under a lottery headline when a search was trusted
 * instead.
 *
 * Three things are checked before a portrait is ever shown:
 *
 *  - The entity is a human (P31 = Q5). Wikipedia page titles are ambiguous —
 *    a band, a film and a person can share one — and a film poster is not a
 *    portrait.
 *  - The licence is one we accept. The list is imported from the news
 *    pipeline rather than copied, because two allowlists that drift apart is
 *    how something ends up published that should not have been.
 *  - Commons records no restriction. That field carries personality rights and
 *    trademark warnings, which are exactly the cases to leave alone.
 *
 * Anything that fails is remembered as "none", so a celebrity with no usable
 * picture is not looked up again every quarter of an hour. The market screen
 * falls back to their initials, which is a perfectly good avatar.
 */
import { UA, PORTRAITS } from '../config.mjs'
// One allowlist for the whole product. See the note above.
import { ACCEPTED_LICENCES } from '../../pipeline/config.mjs'

export const meta = { key: 'portrait', label: 'Celebrity portrait', cadenceMinutes: 60 * 24 * 30 }

const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php'
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php'
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'

const getJson = async (url, fetchImpl) => {
  const res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json ? res.json() : JSON.parse(await res.text())
}

const stripHtml = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()

/**
 * Commons appends its own analytics parameters to every URL the API returns
 * (`?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&…`). They are not
 * part of the picture's address, they change with the call that fetched it,
 * and storing them would put a tracking query string on every avatar we serve.
 */
const cleanUrl = (u) => (u ? String(u).split('?')[0] : null)

export const licenceAccepted = (shortName) => {
  const s = String(shortName || '').trim()
  return Boolean(s) && ACCEPTED_LICENCES.some((re) => re.test(s))
}

/**
 * A Commons imageinfo page → a portrait we may publish, or a reason we may not.
 * Returns `{ portrait }` or `{ reject: <reason> }`, because the reasons are
 * worth counting: "no licence we accept" and "personality rights" call for
 * different answers, and a single null hides which is which.
 */
export function readPortraitPage(page, { allowPersonalityRights = PORTRAITS.allowPersonalityRights } = {}) {
  const info = page?.imageinfo?.[0]
  if (!info) return null
  const md = info.extmetadata || {}
  const licence = md.LicenseShortName?.value
  if (!licenceAccepted(licence)) return null

  /*
   * Commons records the depicted person's own rights here, separately from the
   * copyright licence. `personality` is the common one and it is not rare: it
   * sits on about a quarter of the portraits on this roster. Whether to use
   * those is a policy decision, made in config.mjs, not here.
   */
  const restrictions = md.Restrictions?.value || null
  if (restrictions && !(restrictions === 'personality' && allowPersonalityRights)) return null

  if (/\.(svg|gif|tiff?|pdf|djvu|webm|ogv)$/i.test(page.title || '')) return null

  /*
   * Use the thumbnail only when it is genuinely smaller than the original.
   *
   * Commons does not upscale: ask for a 400px rendition of a 300px file and
   * the URL it hands back has never been generated and answers 400. That is
   * how a batch of celebrity avatars would arrive as broken-image glyphs, and
   * it is the same mistake that produced two dead picture URLs earlier — a
   * thumbnail URL was constructed or trusted without checking the original was
   * bigger than the size asked for. When it is not, the original is already
   * small enough to serve.
   */
  const upscaled = info.thumbwidth && info.width && info.thumbwidth > info.width
  const thumb = info.thumburl && !upscaled ? info.thumburl : null

  return {
    url: cleanUrl(thumb || info.url),
    width: (thumb ? info.thumbwidth : info.width) || null,
    height: (thumb ? info.thumbheight : info.height) || null,
    // `Attribution` is the wording the licensor asked to be credited with, so
    // it beats the uploader's username where they have written one.
    credit: stripHtml(md.Attribution?.value || md.Artist?.value || 'Unknown photographer').slice(0, 90),
    licence,
    licenceUrl: md.LicenseUrl?.value || null,
    sourceUrl: info.descriptionurl || null,
    restrictions,
    provider: 'Wikimedia Commons',
  }
}

/** The Wikidata entity behind an English Wikipedia page title. */
export async function wikidataIdFor(pageTitle, { fetchImpl = fetch } = {}) {
  if (!pageTitle) return null
  const data = await getJson(`${WIKIPEDIA_API}?${new URLSearchParams({
    action: 'query', titles: String(pageTitle).replace(/_/g, ' '), prop: 'pageprops',
    ppprop: 'wikibase_item', redirects: '1', format: 'json', origin: '*',
  })}`, fetchImpl)
  return Object.values(data.query?.pages || {})[0]?.pageprops?.wikibase_item || null
}

/**
 * One celebrity's portrait, or null when there is not one we may use.
 * Three requests, run once a month per person.
 */
export async function portraitFor(celebrity, { fetchImpl = fetch, width = 400, log, ...opts } = {}) {
  const qid = celebrity.wikidataId || await wikidataIdFor(celebrity.wikipediaPageTitle, { fetchImpl })
  if (!qid) { log?.push(`portrait: ${celebrity.id} — no Wikidata entity`); return null }

  const ent = await getJson(`${WIKIDATA_API}?${new URLSearchParams({
    action: 'wbgetentities', ids: qid, props: 'claims', format: 'json', origin: '*',
  })}`, fetchImpl)
  const claims = ent.entities?.[qid]?.claims || {}

  // A page title can belong to a band, a film or an album as easily as a
  // person, and only a person has a portrait.
  if (!(claims.P31 || []).some((c) => c.mainsnak?.datavalue?.value?.id === 'Q5')) {
    log?.push(`portrait: ${celebrity.id} — ${qid} is not a person`)
    return null
  }
  const file = claims.P18?.[0]?.mainsnak?.datavalue?.value
  if (!file) { log?.push(`portrait: ${celebrity.id} — no picture on Wikidata`); return null }

  const data = await getJson(`${COMMONS_API}?${new URLSearchParams({
    action: 'query', titles: `File:${file}`, prop: 'imageinfo', iiprop: 'url|size|extmetadata',
    // Without this filter every response carries the file's full description
    // page as HTML — kilobytes per picture, none of it used here.
    iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Restrictions|Artist|Attribution',
    iiurlwidth: String(width), format: 'json', origin: '*',
  })}`, fetchImpl)
  const portrait = readPortraitPage(Object.values(data.query?.pages || {})[0], opts)
  if (!portrait) { log?.push(`portrait: ${celebrity.id} — ${file} is not one we may publish`); return null }
  return { ...portrait, wikidataId: qid, file }
}

/** The policy a stored lookup was made under, so a change to it can be spotted. */
const policyOf = (allowPersonalityRights) => ({ personality: Boolean(allowPersonalityRights) })

/**
 * Was this stored answer reached under rules stricter than today's?
 *
 * It matters only for the misses. "We looked and there is nothing we may
 * publish" is an answer about the RULES as much as about the picture, so when
 * the rules loosen it stops being an answer. Without this, relaxing the
 * personality-rights policy would change nothing for a month: every celebrity
 * refused under the old rule is remembered as having no picture and is not
 * asked about again until the refresh falls due.
 */
export function supersededByPolicy(entry, policy) {
  if (!entry || entry.portrait) return false
  const was = entry.policy?.personality
  // An entry from before policies were recorded was written under the original
  // rule, which refused them.
  return policy.personality === true && was !== true
}

/**
 * Whose portrait to look up now.
 *
 * Portraits barely change, so this is a slow backfill rather than a refresh:
 * whoever has never been looked up, then whoever was looked up longest ago.
 * A celebrity we found nothing for is remembered as such and left alone for
 * the same period — the cost of asking again every fifteen minutes, forever,
 * for a picture that does not exist, is not worth paying. The exception is a
 * miss that only happened because of a rule we have since relaxed.
 */
export function portraitsDue(roster, portraits = {}, {
  now = Date.now(), limit = 6, refreshDays = 30,
  allowPersonalityRights = PORTRAITS.allowPersonalityRights,
} = {}) {
  const staleAfter = refreshDays * 86400000
  const policy = policyOf(allowPersonalityRights)
  const ageOf = (c) => {
    const entry = portraits[c.id]
    // A miss made under a stricter rule is infinitely stale: it goes to the
    // front of the queue, with the never-looked-up.
    if (supersededByPolicy(entry, policy)) return Infinity
    return entry?.at ? now - Date.parse(entry.at) : Infinity
  }
  return roster
    .map((c) => ({ c, age: ageOf(c) }))
    .filter((x) => x.age >= staleAfter)
    .sort((a, b) => b.age - a.age)
    .slice(0, Math.max(0, limit))
    .map((x) => x.c)
}

/**
 * Look up a batch. Returns entries to merge into the stored map, including
 * the misses — "we looked and there is nothing" is worth remembering.
 */
export async function collect(celebrities, {
  now = Date.now(), fetchImpl = fetch, log = [], gapMs = 200, width = 400, deadline = Infinity,
  allowPersonalityRights = PORTRAITS.allowPersonalityRights, ...opts
} = {}) {
  const found = {}
  // Stamped on every answer, so a later change to the rules can tell which
  // stored misses were the picture's fault and which were ours.
  const policy = policyOf(allowPersonalityRights)
  let calls = 0
  let kept = 0
  let refused = 0
  for (const c of celebrities) {
    if (Date.now() > deadline) { log.push('portrait: run deadline reached'); break }
    if (calls > 0) await new Promise((r) => setTimeout(r, gapMs))
    try {
      const portrait = await portraitFor(c, { fetchImpl, width, log, allowPersonalityRights, ...opts })
      calls += 3
      if (portrait) kept++; else refused++
      found[c.id] = { at: new Date(now).toISOString(), portrait: portrait || null, policy }
    } catch (err) {
      log.push(`portrait: ${c.id} — ${err.message}`)
      // Not recorded, so a transient failure is retried next run rather than
      // being remembered as "this person has no picture".
    }
  }
  return { found, calls, kept, refused }
}
