/**
 * What has moved since this reader last looked.
 *
 * A weekly chart is the same page for six days out of seven, and that is fatal
 * for somewhere people are meant to come back to. The live standings fix most
 * of it by changing every fifteen minutes — but only if the reader can SEE
 * that they changed. "Zendaya, 62.1" looks identical whether it moved four
 * places an hour ago or has not moved since Tuesday.
 *
 * So the positions are remembered and diffed. Nothing leaves the browser, and
 * a browser that refuses storage simply sees no badges.
 */
const KEY = 'gossip-genie-lastseen'

/**
 * How long a remembered snapshot stands before it is replaced.
 *
 * Not on every page load: refreshing twice in a minute would wipe the marks
 * you came back to read. Half an hour is long enough that a session shows one
 * consistent set of changes, and short enough that coming back after lunch
 * measures from lunch.
 */
const HOLD_MS = 30 * 60000

export function loadSeen() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!raw || typeof raw.ranks !== 'object') return null
    return raw
  } catch { return null }
}

export function saveSeen(chart, now = Date.now()) {
  if (!chart?.entries?.length) return null
  const snapshot = {
    id: chart.id,
    at: now,
    ranks: Object.fromEntries(chart.entries.map((e) => [e.id, e.rank])),
  }
  try { localStorage.setItem(KEY, JSON.stringify(snapshot)) } catch { /* private mode */ }
  return snapshot
}

/**
 * The move each name has made since the remembered snapshot.
 *
 * Returns `{ since, moves, count }` — `moves` keyed by id, positive meaning
 * they climbed. A first visit, a different week, or a snapshot from moments
 * ago all return no moves, because in each case there is honestly nothing to
 * report.
 */
export function movesSince(chart, seen, { now = Date.now(), minAgeMs = 60000 } = {}) {
  const none = { since: null, moves: {}, count: 0 }
  if (!chart?.entries?.length || !seen || seen.id !== chart.id) return none
  if (now - seen.at < minAgeMs) return none

  const moves = {}
  for (const e of chart.entries) {
    const was = seen.ranks[e.id]
    if (Number.isFinite(was) && was !== e.rank) moves[e.id] = was - e.rank
  }
  return { since: seen.at, moves, count: Object.keys(moves).length }
}

/** Remember this chart, unless a recent enough snapshot is still standing. */
export function rememberIfStale(chart, seen, { now = Date.now(), holdMs = HOLD_MS } = {}) {
  if (!chart?.entries?.length) return seen
  if (seen && seen.id === chart.id && now - seen.at < holdMs) return seen
  return saveSeen(chart, now) || seen
}

export const clearSeen = () => {
  try { localStorage.removeItem(KEY) } catch { /* private mode */ }
}
