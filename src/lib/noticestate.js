/**
 * What this reader has already been told.
 *
 * Kept in its own storage key rather than in prefs.js: it changes on every
 * visit, and a bell being opened should not rewrite somebody's follows and
 * quiz streak alongside it.
 *
 * Every read and write survives storage being switched off. A private window
 * gets a bell that starts empty each time, which is the right answer for a
 * private window.
 */
const KEY = 'gossip-genie-notices'

/** Alerts older than this are forgotten; their ids will never come round again. */
const KEEP_MS = 14 * 86400000
const MAX_SEEN = 300

const EMPTY = { seen: {}, lastOpenedAt: null, firstSeenAt: null }

export function loadNotices() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    const seen = raw.seen && typeof raw.seen === 'object' ? raw.seen : {}
    return {
      seen,
      lastOpenedAt: Number.isFinite(raw.lastOpenedAt) ? raw.lastOpenedAt : null,
      firstSeenAt: Number.isFinite(raw.firstSeenAt) ? raw.firstSeenAt : null,
    }
  } catch { return { ...EMPTY, seen: {} } }
}

export function saveNotices(state) {
  try { localStorage.setItem(KEY, JSON.stringify(prune(state))) } catch { /* private mode */ }
  return state
}

/**
 * Drop what is too old to matter.
 *
 * Without this the seen-set grows for as long as somebody uses the site, and
 * the one thing it must never do is get big enough that writing it is slow.
 */
export function prune(state, now = Date.now()) {
  const entries = Object.entries(state.seen || {})
    .filter(([, t]) => Number.isFinite(t) && now - t < KEEP_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_SEEN)
  return { ...state, seen: Object.fromEntries(entries) }
}

/**
 * The moment "new since you were last here" is measured from.
 *
 * On a first visit there is no such moment, and inventing one would open the
 * bell with thirty things in it before the reader has read anything. So the
 * first visit sets the mark and says nothing.
 */
export const since = (state) => state.lastOpenedAt ?? state.firstSeenAt ?? null

/** Mark the visit, so the next one has something to measure against. */
export function firstVisit(state, now = Date.now()) {
  if (state.firstSeenAt || state.lastOpenedAt) return state
  return saveNotices({ ...state, firstSeenAt: now })
}

/** Everything currently shown has now been seen. */
export function markSeen(state, alerts, now = Date.now()) {
  const seen = { ...state.seen }
  for (const a of alerts) seen[a.id] = now
  return saveNotices({ ...state, seen, lastOpenedAt: now })
}

export function clearNotices() {
  try { localStorage.removeItem(KEY) } catch { /* private mode */ }
  return { ...EMPTY, seen: {} }
}
