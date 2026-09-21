/**
 * Where the channel is right now, and where this viewer should join it.
 *
 * The show used to be a playlist that started at segment 0 on every page load.
 * Since the feed only refreshes three times a day, that meant the same
 * twelve-minute running order replayed from the top every time anyone opened
 * the channel — dip in after lunch and you watched the morning's top story
 * again, with no way past it.
 *
 * Two ideas fix that, and they stack:
 *
 *   live      — the position comes from the clock, not from when you arrived.
 *               The channel is somewhere specific at 2:14pm and you join it
 *               there, the way you join any broadcast.
 *   catch-up  — if what is on air is something you have already seen, you are
 *               moved forward to the first thing you have not. From then on
 *               you are time-shifted, which is exactly what catch-up is.
 *
 * All of this is pure arithmetic over the running order, so the player can
 * stay a player and this can be reasoned about on its own.
 */

/**
 * The real time a handover costs: the branded wipe sweeping in, holding on its
 * card, and sweeping out. It is dead air as far as the running order is
 * concerned but not as far as the clock is, so the live position has to count
 * it or it drifts by a second per segment — a minute and a half each loop.
 *
 * Measured, not assumed. The arithmetic:
 *
 *   WIPE_CARD_MS   5000   the hold, timed from the START of the sweep-in
 *   WIPE_OUT_MS     500   the sweep out
 *   polling slop    ~45   the hold is checked every 80ms, so it overruns
 *                         by up to that and by ~40ms on average
 *                 ------
 *                  5545
 *
 * The sweep-in is NOT added: Wipe measures its hold from t0, which is the
 * moment the panel starts moving, so the 450ms sweep-in happens inside the
 * five seconds rather than before them. This was previously written as 5.9 —
 * 450 + 5000 + 500 — which assumed otherwise and left the live position four
 * tenths of a second further ahead of the real show on every handover.
 *
 * `scripts/watch-timing-audit.mjs` times the real thing against this.
 */
export const HANDOVER_SECONDS = 5.55

/** How long one full time round the running order takes, in seconds. */
export function showLength(segs, { handoverSeconds = HANDOVER_SECONDS } = {}) {
  if (!segs?.length) return 0
  return segs.reduce((a, s) => a + (s.dur || 0) + handoverSeconds, 0)
}

/**
 * The segment playing `seconds` into the show, and how far into it we are.
 * Wraps, because the channel loops.
 */
export function positionAt(segs, seconds, { handoverSeconds = HANDOVER_SECONDS } = {}) {
  const total = showLength(segs, { handoverSeconds })
  if (!total) return null
  let t = seconds % total
  if (t < 0) t += total
  for (let i = 0; i < segs.length; i++) {
    const span = (segs[i].dur || 0) + handoverSeconds
    if (t < span) {
      // Landing inside the handover itself counts as the very top of the
      // segment that follows it — there is nothing to join half way through.
      return { idx: i, into: Math.min(t, segs[i].dur || 0) }
    }
    t -= span
  }
  return { idx: segs.length - 1, into: 0 }
}

/**
 * Where the channel is now.
 *
 * `epoch` is when this running order began — the feed's own publication time,
 * so a new feed starts the show at the top and every viewer of that feed is
 * working from the same origin rather than from whenever they happened to
 * open the page.
 */
export function livePosition(segs, { now = Date.now(), epoch, handoverSeconds = HANDOVER_SECONDS } = {}) {
  const from = Number.isFinite(epoch) ? epoch : Date.parse(epoch)
  if (!Number.isFinite(from)) return positionAt(segs, 0, { handoverSeconds })
  return positionAt(segs, (now - from) / 1000, { handoverSeconds })
}

/** The stories a segment puts on screen, so "have I seen this" has an answer. */
export function storyIdsIn(seg) {
  const ids = [seg?.story?.id, ...(seg?.stories || []).map((s) => s?.id)]
  return ids.filter(Boolean)
}

/**
 * Has this viewer already had this segment?
 *
 * Only segments built from stories can be "seen". The quiz, the market board
 * and the coming-up card are furniture — they are rebuilt from whatever is
 * current and skipping past them would strand the viewer in a show made of
 * nothing but stories.
 */
export function segmentSeen(seg, seen) {
  const ids = storyIdsIn(seg)
  if (!ids.length) return false
  return ids.every((id) => seen.has(id))
}

/**
 * The first thing from `from` onwards that this viewer has not seen.
 *
 * Searches forward and wraps once. Returns null when everything in the running
 * order has been seen — which is a real answer, not a failure: the caller then
 * plays from where the channel actually is and says so.
 */
export function firstUnseen(segs, seen, { from = 0 } = {}) {
  if (!segs?.length) return null
  if (!seen?.size) return from
  for (let n = 0; n < segs.length; n++) {
    const i = (from + n) % segs.length
    if (!segmentSeen(segs[i], seen)) return i
  }
  return null
}

/** The first segment from `from` that actually shows a story. */
function nextStory(segs, from) {
  for (let n = 0; n < segs.length; n++) {
    const i = (from + n) % segs.length
    if (storyIdsIn(segs[i]).length) return i
  }
  return null
}

/** The first segment from `from` that shows a story this viewer has not seen. */
function nextUnseenStory(segs, seen, from) {
  for (let n = 0; n < segs.length; n++) {
    const i = (from + n) % segs.length
    const ids = storyIdsIn(segs[i])
    if (ids.length && !ids.every((id) => seen.has(id))) return i
  }
  return null
}

/**
 * Where to start this viewer: the live position, nudged forward past anything
 * they have already watched.
 *
 * The nudge looks THROUGH furniture rather than at it. Furniture can never
 * have been "seen" — the title card, the countdown and the quiz are rebuilt
 * every show — so a running order that opens on one used to park a returning
 * viewer there and then hand them straight back the story they watched this
 * morning. The chart show opens on its title card, which made that the normal
 * case rather than an edge one.
 *
 * @returns {{idx: number, into: number, mode: 'live'|'catchup'|'caught-up'}}
 *   live      — joining the channel where it is
 *   catchup   — moved forward past what they have seen, so now time-shifted
 *   caught-up — they have seen the lot; play from the live point anyway
 */
export function joinAt(segs, seen = new Set(), { now = Date.now(), epoch, handoverSeconds = HANDOVER_SECONDS } = {}) {
  const live = livePosition(segs, { now, epoch, handoverSeconds })
  if (!live) return null
  if (!seen?.size) return { ...live, mode: 'live' }

  // The next story they would actually be served from here.
  const ahead = nextStory(segs, live.idx)
  if (ahead == null || !segmentSeen(segs[ahead], seen)) return { ...live, mode: 'live' }

  const next = nextUnseenStory(segs, seen, live.idx)
  if (next == null) return { ...live, mode: 'caught-up' }
  // Joining an unwatched segment starts it at the top, not part way through.
  return { idx: next, into: 0, mode: 'catchup' }
}
