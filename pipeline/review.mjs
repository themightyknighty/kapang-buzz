/**
 * Step 6b — look at the picture.
 *
 * WHY THIS EXISTS, in one example. A story about a Maryland woman winning the
 * lottery twice ran with a Commons file called "Lottery Tickets, Ethiopia".
 * The photograph is of a child. Everything Commons knew about that file said
 * otherwise: its categories were the licence, the camera model, the
 * photographer and "Lottery tickets"; its structured data had no `depicts`
 * statement at all; its description was the title again; it carried no
 * personality-rights restriction. The filter we had read exactly those fields,
 * so it passed — and any tightening of those rules would have passed it too.
 *
 * Metadata says what a file is CALLED. Only the pixels say what is in it.
 *
 * So every illustrative picture is looked at before it is published, by the
 * same model that writes the stories. The rule it enforces is narrow and
 * absolute: an illustrative photograph may not show an identifiable person.
 * Not a recognisable one, not a child, not a bystander. A story about someone
 * we cannot photograph gets the typographic card instead, and the card is a
 * perfectly good outcome — a stranger's face next to a stranger's story is not.
 *
 * Celebrity portraits do not come through here. Those are resolved from the
 * person's own Wikidata entry (P18), so the identity is established by the
 * lookup rather than guessed from a search result.
 */
import { ANTHROPIC_URL, DEFAULT_MODEL } from './config.mjs'

/** Bumped when the rules change, so older verdicts are re-checked, not trusted. */
export const REVIEW_VERSION = 'vision-1'

/*
 * The model that looks at pictures, which need not be the one that writes the
 * stories. Writing needs judgement about tone and fairness; this is a narrow
 * perception task — count the people, say what is in the frame. Keeping it on
 * its own setting means the cheaper model can do the looking without quietly
 * changing who writes the copy, which is what would happen if both read
 * ANTHROPIC_MODEL.
 */
export const reviewModel = (env = process.env) => env.REVIEW_MODEL || env.ANTHROPIC_MODEL || DEFAULT_MODEL

const SYSTEM = `You are a picture desk assistant for a family-friendly news app. You are shown ONE photograph that is proposed as an illustration for ONE news story. You answer only with JSON.

Your job is to protect two things: real people's dignity, and the reader's trust.

Answer these questions about the IMAGE ITSELF, from what you can see in it — never from the filename or any caption:

- people: how many human beings appear in the image, at any size, including in the background, blurred, partially visible, or from behind. Statues, drawings, cartoons and dolls are not people; count them as 0.
- identifiable: true if ANY person in the image could be recognised by someone who knows them — a visible face, or a distinctive combination of build, clothing and setting. If people appear at all and you are unsure, answer true.
- minors: true if anyone in the image appears to be under 18, or if you cannot tell an apparent adult from an apparent child.
- topical: true if the image plainly shows the subject matter the story is about, or a clear example of it. A good photograph of the right subject counts even if it was taken elsewhere or at another time — it is an illustration, not evidence. Answer false when the image shows something else entirely.
- describe: one short factual sentence describing exactly what is in the frame.
- subject: where the thing the picture is OF sits in the frame, as a box {x, y, w, h} in fractions of the image, with x,y the top-left corner and 0,0 the top-left of the image. Include everything a viewer must see for the picture to still make sense — the whole animal, the whole building, all of the people — and nothing more. If that fills the frame, say {"x":0,"y":0,"w":1,"h":1}. If there is no single subject, use null.

Be conservative on every count. A wrong "no people here" puts a stranger's face on a story about someone else.

Reply with only this JSON object and nothing else:
{"people": <integer>, "identifiable": <boolean>, "minors": <boolean>, "topical": <boolean>, "describe": "<sentence>", "subject": {"x": <0-1>, "y": <0-1>, "w": <0-1>, "h": <0-1>} | null}`

const parseJson = (text) => {
  const m = /\{[\s\S]*\}/.exec(text || '')
  if (!m) throw new Error('no JSON in reply')
  return JSON.parse(m[0])
}

/**
 * Fetch the picture as base64 for the model.
 *
 * The URL is used EXACTLY as published. An earlier version of this built its
 * own Commons thumbnail URL to save bytes; Commons answered 400, because the
 * original is 683px wide and it will not upscale to the 768 that was asked
 * for. That is the same mistake that put a dead `~large` NASA link in the
 * feed — inventing another service's URL and assuming it resolves. What we
 * publish is already the API's own answer for a sensible width, and for a
 * typical file that is a couple of hundred kilobytes.
 *
 * NASA is the one exception, and only as a fallback: if a full plate comes
 * back too big to send, `~small` is a rendition the library always holds.
 */
export async function fetchImageData(img, { fetchImpl = fetch, maxBytes = 3_000_000 } = {}) {
  const url = typeof img === 'string' ? img : img?.url
  const host = (u) => { try { return new URL(u).host } catch { return 'unknown host' } }
  const get = async (u, headers = {}) => {
    const res = await fetchImpl(u, { headers: { 'User-Agent': UA, ...headers } })
    if (!res.ok) {
      /*
       * Some CDNs serve a HEAD happily and refuse the GET that follows, which
       * is how a picture can pass the does-it-load check and then fail here.
       * One retry without our User-Agent distinguishes "this host dislikes
       * unknown clients" from "this file is gone", and the message names the
       * host either way so the run log says which service is refusing us.
       */
      if (res.status === 403 && !('User-Agent' in headers)) {
        const plain = await fetchImpl(u, { headers: {} })
        if (plain.ok) return read(plain)
      }
      throw new Error(`image HTTP ${res.status} from ${host(u)}`)
    }
    return read(res)
  }
  const read = async (res) => {
    const type = (res.headers?.get?.('content-type') || '').split(';')[0].toLowerCase()
    if (!/^image\/(jpeg|png|gif|webp)$/.test(type)) throw new Error(`not an image (${type || 'unknown'})`)
    return { type, buf: Buffer.from(await res.arrayBuffer()) }
  }

  let got = await get(url)
  if (got.buf.length > maxBytes) {
    const smaller = await smallerVersion(img, { fetchImpl })
    if (!smaller) throw new Error(`image too large to review (${Math.round(got.buf.length / 1024)}KB, ${host(url)} offers nothing smaller)`)
    got = await get(smaller)
    if (got.buf.length > maxBytes) throw new Error(`image too large to review (${Math.round(got.buf.length / 1024)}KB after asking for a smaller one)`)
  }
  return { media_type: got.type, data: got.buf.toString('base64') }
}

const UA = 'GossipGenie/1.0 (+https://kapang-buzz.netlify.app)'
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'

/**
 * A smaller rendition of the same picture, from the host that holds it.
 *
 * Commons is ASKED for one rather than having a thumbnail URL built for it —
 * building one returned 400 last time, because Commons will not upscale and
 * only it knows the original's size. NASA's `~small` is a rendition the
 * library always holds.
 */
export async function smallerVersion(img, { fetchImpl = fetch, width = 800 } = {}) {
  const url = typeof img === 'string' ? img : img?.url
  const nasa = smallerNasa(url)
  if (nasa) return nasa

  const title = /\/(File:[^#?]+)/.exec(decodeURIComponent(img?.sourceUrl || ''))?.[1]
  if (!title) return null
  const res = await fetchImpl(`${COMMONS_API}?${new URLSearchParams({
    action: 'query', titles: title, prop: 'imageinfo', iiprop: 'url', iiurlwidth: String(width), format: 'json', origin: '*',
  })}`, { headers: { 'User-Agent': UA } })
  if (!res.ok) return null
  const data = JSON.parse(await res.text())
  const info = Object.values(data.query?.pages || {})[0]?.imageinfo?.[0]
  return info?.thumburl || null
}

/** NASA's small rendition of the same asset, or null for anything else. */
export function smallerNasa(url) {
  const m = /^(https:\/\/images-assets\.nasa\.gov\/image\/[^/]+\/[^/]+)~(orig|large|medium)\.jpg(\?.*)?$/i.exec(url || '')
  return m ? `${m[1]}~small.jpg${m[3] || ''}` : null
}

/** Ask the model what is actually in the frame. */
export async function lookAt(img, storyContext, {
  apiKey = process.env.ANTHROPIC_API_KEY, model = reviewModel(),
  workspaceId = process.env.ANTHROPIC_WORKSPACE_ID, fetchImpl = fetch,
} = {}) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  const image = await fetchImageData(img, { fetchImpl })
  const headers = { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
  if (workspaceId) headers['anthropic-workspace-id'] = workspaceId
  const res = await fetchImpl(ANTHROPIC_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model, max_tokens: 300, temperature: 0,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: image.media_type, data: image.data } },
          { type: 'text', text: `The story this would illustrate:\n${storyContext}\n\nAnswer with the JSON object only.` },
        ],
      }],
    }),
  })
  if (!res.ok) throw new Error(`review HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  return parseJson((data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''))
}

/**
 * The rule, kept separate from the asking so it can be tested on its own.
 *
 * `people: 0` is the only way an illustration passes. Not "no faces", not "no
 * children" — nobody. An illustrative picture is there to show a thing, and a
 * picture that needs a person in it to make its point is a picture about that
 * person, who has not agreed to illustrate this story.
 */
export function verdictOf(seen, { requireTopical = true } = {}) {
  if (!seen || typeof seen.people !== 'number' || Number.isNaN(seen.people)) {
    return { ok: false, code: 'unreadable', reason: 'the picture could not be read' }
  }
  if (seen.people > 0) {
    return {
      ok: false,
      code: seen.minors ? 'child' : 'people',
      reason: `shows ${seen.people === 1 ? 'a person' : `${seen.people} people`}${seen.minors ? ', apparently including a child' : ''}`,
    }
  }
  // Belt and braces: a reply that says nobody is in shot but then flags an
  // identifiable person or a minor is contradicting itself, and the safe
  // reading of a contradiction is the one that protects the person.
  if (seen.identifiable || seen.minors) return { ok: false, code: 'contradiction', reason: 'the reply contradicted itself about who is in the frame' }
  if (requireTopical && seen.topical === false) return { ok: false, code: 'off-topic', reason: 'does not show what the story is about' }
  return { ok: true, code: 'ok', reason: seen.describe || 'no people in frame' }
}

/**
 * The subject box, if the reply gave one worth believing.
 *
 * A model asked for coordinates will sometimes return a box that is inverted,
 * outside the frame, or the whole image expressed in pixels. None of those is
 * a subject, and acting on one would move the crop somewhere arbitrary — which
 * is exactly the failure this is meant to fix. Anything that does not read as
 * a sane fraction box is dropped, and the frame falls back to its default,
 * which is safe by construction.
 */
export function readSubject(box) {
  if (!box || typeof box !== 'object') return null
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const x = n(box.x), y = n(box.y), w = n(box.w), h = n(box.h)
  if ([x, y, w, h].some((v) => v == null)) return null
  if (w <= 0 || h <= 0) return null
  if (x < 0 || y < 0 || x + w > 1.0001 || y + h > 1.0001) return null
  // A box covering essentially the whole frame says nothing a default does not
  // already say, and storing it would defeat the "is it croppable" check.
  if (w > 0.98 && h > 0.98) return null
  const r = (v) => Math.round(v * 1000) / 1000
  return { x: r(x), y: r(y), w: r(w), h: r(h) }
}

/**
 * A running count of what the review did, so "how much is it turning down?"
 * is a number in the run summary rather than a grep through log lines.
 *
 * `rejected` is the headline figure and `reasons` says why — a high `people`
 * count means the picture sources are simply full of people, which is worth
 * knowing; a high `error` count means the review is not working and every
 * story is losing its picture for the wrong reason. Those look identical from
 * the outside and need opposite responses, so they are counted apart.
 */
export function createTally() {
  return { reviewed: 0, kept: 0, rejected: 0, failed: 0, reasons: {}, examples: [] }
}

const note = (tally, code, reason, url) => {
  if (!tally) return
  tally.reasons[code] = (tally.reasons[code] || 0) + 1
  if (tally.examples.length < 8) tally.examples.push({ code, reason, file: String(url || '').split('/').pop().slice(0, 70) })
}

/**
 * Review one candidate image. Returns the image with a `review` stamp when it
 * passes, and null when it does not — including when the check itself failed,
 * because "we could not look" is not "we looked and it was fine".
 */
export async function reviewImage(img, storyContext, { fetchImpl, log, tally, requireTopical = true, now = Date.now(), ...opts } = {}) {
  if (!img?.url) return null
  if (tally) tally.reviewed++
  try {
    const seen = await lookAt(img, storyContext, { fetchImpl, ...opts })
    const verdict = verdictOf(seen, { requireTopical })
    if (!verdict.ok) {
      if (tally) tally.rejected++
      note(tally, verdict.code, verdict.reason, img.url)
      log?.push(`picture rejected (${verdict.reason}): ${img.url.split('/').pop().slice(0, 60)}`)
      return null
    }
    if (tally) tally.kept++
    return {
      ...img,
      review: {
        version: REVIEW_VERSION, at: new Date(now).toISOString(), saw: seen.describe || null,
        // Where the subject sits, so the vertical cut can crop to it instead
        // of to the middle of the frame. Only stored when the reply gives a
        // box that makes sense — a made-up one is worse than none, because
        // none has a safe fallback and a wrong one does not.
        subject: readSubject(seen.subject),
      },
    }
  } catch (err) {
    // Counted apart from a rejection: this is the review failing, not the
    // picture. Both lose the picture; only one of them is working as intended.
    if (tally) { tally.failed++; tally.rejected++ }
    note(tally, 'error', err.message, img.url)
    log?.push(`picture could not be reviewed (${err.message}) — leaving the story without one`)
    return null
  }
}

/** A short description of the story, for the model to judge relevance against. */
export const storyContextOf = (draft) => [
  draft?.headline, draft?.caption,
  draft?.people?.length ? `People named in the story: ${draft.people.join(', ')}` : null,
].filter(Boolean).join('\n')

/**
 * Re-check pictures that are already on the site.
 *
 * Stories live in the feed for three days, so a rule written today has to
 * reach the ones published yesterday — otherwise the only way to correct a
 * picture is for a person to spot it, which is the approval loop by another
 * name. Anything without a current review stamp is looked at again and
 * dropped if it fails; anything already stamped with the current version is
 * left alone, so this costs nothing once the feed has caught up.
 *
 * Celebrity portraits are skipped: their identity comes from Wikidata, not
 * from a search, and re-reviewing them would only burn calls.
 *
 * @returns the number of pictures re-checked
 */
export async function reviewPublished(stories = [], { fetchImpl, env = process.env, log, tally, limit = Number(process.env.PICTURE_RECHECK_LIMIT) || 80, now = Date.now() } = {}) {
  const stale = (img) => img?.url && img.kind !== 'person' && img.review?.version !== REVIEW_VERSION
  const opts = { fetchImpl, log, tally, now, apiKey: env.ANTHROPIC_API_KEY, model: reviewModel(env), workspaceId: env.ANTHROPIC_WORKSPACE_ID }
  let checked = 0

  for (const story of stories) {
    if (checked >= limit) break
    const context = storyContextOf(story)
    if (stale(story.image)) {
      checked++
      const kept = await reviewImage(story.image, context, opts)
      if (!kept) log?.push(`removed the picture from "${String(story.headline).slice(0, 60)}"`)
      story.image = kept
    }
    if (Array.isArray(story.gallery) && story.gallery.some(stale)) {
      const out = []
      for (const g of story.gallery) {
        if (!stale(g)) { out.push(g); continue }
        if (checked >= limit) break
        checked++
        const kept = await reviewImage(g, context, opts)
        if (kept) out.push(kept)
      }
      story.gallery = out
      // The lead picture is the first frame of the reel; keep them agreeing.
      if (!story.image && out.length) story.image = out[0]
    }
  }
  return checked
}
