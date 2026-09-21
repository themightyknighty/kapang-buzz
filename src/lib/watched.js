/**
 * What this viewer has already watched.
 *
 * Per-viewer, per-device, and deliberately small: a set of story ids tied to
 * the feed they came from. When the feed refreshes — three times a day — the
 * record is dropped, because the whole point is to get you to what is new, and
 * yesterday's list would only stand in the way of that.
 *
 * Every read and write survives storage being unavailable. Private windows,
 * blocked site data and the odd locked-down browser all throw on access rather
 * than returning nothing, and a channel that will not play because it could
 * not remember what you watched is a worse fault than one that forgets.
 */
const KEY = 'gossip-genie-watched'

/** Stop the list growing without bound if a feed ever runs long. */
const MAX = 400

const empty = (feed = null) => ({ feed, ids: [] })

/**
 * The stories seen under this feed. A different feed — or none — starts over.
 */
export function loadWatched(feedAt = null) {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!raw || !Array.isArray(raw.ids)) return empty(feedAt)
    if (feedAt && raw.feed !== feedAt) return empty(feedAt)
    return { feed: raw.feed ?? feedAt, ids: raw.ids.slice(-MAX) }
  } catch { return empty(feedAt) }
}

export function saveWatched(w) {
  try { localStorage.setItem(KEY, JSON.stringify({ feed: w.feed, ids: w.ids.slice(-MAX) })) } catch { /* private mode */ }
}

/** The seen ids as a set, which is what the show clock wants. */
export const seenSet = (w) => new Set(w?.ids || [])

/**
 * Record that these stories have now been watched.
 *
 * Returns the same object when nothing changed, so a caller can skip a write
 * and a re-render on the many ticks where a segment is simply still playing.
 */
export function markWatched(w, ids, { feedAt = w?.feed ?? null } = {}) {
  const add = (Array.isArray(ids) ? ids : [ids]).filter(Boolean)
  if (!add.length) return w
  const have = new Set(w?.ids || [])
  const fresh = add.filter((id) => !have.has(id))
  if (!fresh.length && w?.feed === feedAt) return w
  return { feed: feedAt, ids: [...(w?.ids || []), ...fresh].slice(-MAX) }
}

/** Forget everything — for a "watch it all again" control. */
export function clearWatched(feedAt = null) {
  try { localStorage.removeItem(KEY) } catch { /* private mode */ }
  return empty(feedAt)
}
