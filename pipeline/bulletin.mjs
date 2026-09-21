/**
 * The headline bulletin — a presenter reading the day's top stories.
 *
 * Rendered by revid.ai's avatar-to-video workflow, once per feed run, and
 * stored on the feed as a finished video URL. Three things about that shape
 * are deliberate:
 *
 *  - ONCE PER RUN, NOT ONCE PER STORY. A render takes tens of seconds and
 *    costs credits; forty of them per run would be slow and expensive, and
 *    forty separate clips of the same presenter saying one sentence each is
 *    not what a bulletin is. One clip reads the headlines, then the show runs
 *    the stories — which is the shape a news channel has had for sixty years.
 *  - IN THE PIPELINE, NEVER AT VIEW TIME. A viewer opening the channel must
 *    not wait on somebody else's render queue.
 *  - IN ITS OWN FIELD. The bulletin is not `story.video`, so it never touches
 *    the picture desk's rules about footage, and footage never ends up being
 *    treated as a presenter.
 *
 * The presenter is synthetic and the app says so on screen. That is not
 * decoration: a generated person reading real news, unlabelled, is the kind
 * of thing that is fine until the day it is not.
 */

export const REVID_API = 'https://www.revid.ai/api/public/v3'

/** How the presenter opens, by the hour she is recorded. */
export function greeting(hour) {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/**
 * What she actually says.
 *
 * Headlines only. The stories that follow carry their own captions, key facts
 * and lower thirds, so a bulletin that also summarised them would be the
 * channel saying everything twice — and every extra sentence is render time
 * and credits. Trailing punctuation is stripped because a headline is written
 * to be read, not spoken, and "Alan Ritchson May Star in Helldivers Movie."
 * read aloud with a full stop lands like a shrug.
 */
export function bulletinScript(stories, { now = new Date(), max = 5 } = {}) {
  const heads = (stories || [])
    .map((s) => String(s?.headline || '').trim().replace(/[.\s]+$/, ''))
    .filter(Boolean)
    .slice(0, max)
  if (!heads.length) return null

  const lead = `${greeting(new Date(now).getHours())}, and welcome to Gossip Genie. Here are today's headlines.`
  // "And finally" is how a bulletin signals the end, and it stops the last
  // headline sounding like the list was cut off.
  const body = heads.map((h, i) => (heads.length > 1 && i === heads.length - 1 ? `And finally, ${lowerFirst(h)}` : h))
  return [lead, ...body.map((h) => `${h}.`), 'More on all of those, coming up.'].join(' ')
}

const lowerFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)

/**
 * The render request.
 *
 * `aspectRatio` is the caller's business: the channel has a 16:9 cut and a
 * 9:16 one and they are different videos, so nothing here assumes which is
 * wanted. Captions stay off — the show draws its own headline furniture over
 * the top and revid's burnt-in captions would collide with it.
 */
export function renderBody(script, { avatarUrl, aspectRatio = '16:9', voiceId = null, webhookUrl = null } = {}) {
  if (!script) throw new Error('nothing to read')
  if (!avatarUrl) throw new Error('no avatar image — see docs/bulletin.md')
  return {
    workflow: 'avatar-to-video',
    source: { text: script },
    avatar: { enabled: true, url: avatarUrl },
    aspectRatio,
    voice: { enabled: true, ...(voiceId ? { voiceId } : {}) },
    // The show puts the headlines on screen itself, in its own type.
    captions: { enabled: false },
    ...(webhookUrl ? { webhookUrl } : {}),
  }
}

/**
 * Ask revid for the video. The key travels in a header and is never logged,
 * never put in a URL and never returned.
 */
export async function requestRender(body, { apiKey, fetchImpl = fetch, api = REVID_API } = {}) {
  if (!apiKey) throw new Error('REVID_API_KEY is not set')
  const res = await fetchImpl(`${api}/render`, {
    method: 'POST',
    headers: { key: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`render refused: HTTP ${res.status} ${scrub(text, apiKey).slice(0, 200)}`)
  const data = JSON.parse(text)
  const pid = data.pid || data.id || data.projectId
  if (!pid) throw new Error(`render gave no job id: ${scrub(text, apiKey).slice(0, 200)}`)
  return pid
}

/**
 * A key that reaches a log is a key that has leaked. Some APIs echo the
 * request back in an error body, so anything we print gets checked first.
 */
export const scrub = (text, apiKey) =>
  (apiKey ? String(text).split(apiKey).join('«key»') : String(text))

/** One poll. Separated out so the waiting loop is testable without timers. */
export async function readStatus(pid, { apiKey, fetchImpl = fetch, api = REVID_API } = {}) {
  const res = await fetchImpl(`${api}/status?pid=${encodeURIComponent(pid)}`, { headers: { key: apiKey } })
  const text = await res.text()
  if (!res.ok) throw new Error(`status refused: HTTP ${res.status}`)
  const d = JSON.parse(text)
  return { status: d.status, progress: d.progress ?? null, videoUrl: d.videoUrl || null, error: d.errorMessage || null }
}

/**
 * Wait for the render, or give up.
 *
 * A bulletin that is not ready is not a failure the channel should feel: the
 * show simply runs without a presenter that cycle. So this has a hard ceiling
 * and returns rather than throwing on a timeout — a feed run must never hang
 * on somebody else's queue.
 */
export async function waitForRender(pid, {
  apiKey, fetchImpl = fetch, api = REVID_API, everyMs = 5000, timeoutMs = 6 * 60000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), log,
} = {}) {
  const until = now() + timeoutMs
  let last = null
  while (now() < until) {
    const s = await readStatus(pid, { apiKey, fetchImpl, api })
    if (s.status !== last) { log?.push(`bulletin ${pid}: ${s.status}${s.progress != null ? ` ${s.progress}%` : ''}`); last = s.status }
    if (s.status === 'ready' && s.videoUrl) return { ok: true, videoUrl: s.videoUrl }
    if (s.status === 'error') return { ok: false, error: s.error || 'render failed' }
    await sleep(everyMs)
  }
  return { ok: false, error: `not ready after ${Math.round(timeoutMs / 1000)}s` }
}

/**
 * The whole job: headlines in, a playable bulletin out — or null, and the
 * show runs without a presenter this cycle.
 */
export async function makeBulletin(stories, {
  apiKey, avatarUrl, aspectRatio = '16:9', voiceId = null, fetchImpl = fetch,
  api = REVID_API, log = [], now = new Date(), ...waitOpts
} = {}) {
  const script = bulletinScript(stories, { now })
  if (!script) { log.push('bulletin: no headlines to read'); return null }
  try {
    const pid = await requestRender(renderBody(script, { avatarUrl, aspectRatio, voiceId }), { apiKey, fetchImpl, api })
    const out = await waitForRender(pid, { apiKey, fetchImpl, api, log, ...waitOpts })
    if (!out.ok) { log.push(`bulletin: ${out.error} — the show runs without a presenter`); return null }
    return {
      videoUrl: out.videoUrl, pid, script, aspectRatio,
      presenter: 'synthetic', provider: 'revid.ai',
      at: new Date(now).toISOString(),
      headlines: (stories || []).slice(0, 5).map((s) => s.headline).filter(Boolean),
    }
  } catch (err) {
    log.push(`bulletin failed (${scrub(err.message, apiKey)}) — the show runs without a presenter`)
    return null
  }
}
