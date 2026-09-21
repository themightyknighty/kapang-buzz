import { useEffect, useState } from 'react'

/**
 * Where we are, from the address bar.
 *
 * This used to read `location.hash`, which was the cheap way to route a single
 * HTML file and cost us the entire point of sharing. A fragment is never sent
 * to the server: `/#/story/abc` and `/#/market/zendaya` arrive at Netlify as
 * `/`, so every link anybody posted got the same generic preview — the same
 * title, the same blurb, no picture of the thing they were actually sharing.
 *
 * So: real paths. `/story/abc` reaches the server, a function can answer it
 * with that story's own Open Graph tags, and the link looks like the story in
 * everybody's chat app. The SPA still never reloads — `netlify.toml` serves
 * the app for any path and the click handler below keeps navigation in the
 * page.
 *
 * Old links keep working. `#/story/abc` is rewritten to `/story/abc` before
 * React renders, so anything already shared, bookmarked or sitting in
 * somebody's messages lands in the right place.
 */

export const ROUTES = ['home', 'chart', 'story', 'market', 'quiz', 'watch', 'vertical', 'strand', 'buzz']

/** `/story/abc` → `{ name: 'story', arg: 'abc' }`. */
export function parseRoute(pathname) {
  const parts = String(pathname || '/').split('?')[0].split('#')[0]
    .split('/').filter(Boolean)
  const name = parts[0] || 'home'
  let arg = null
  if (parts[1]) { try { arg = decodeURIComponent(parts[1]) } catch { arg = parts[1] } }
  return { name, arg }
}

/** `{ name: 'story', arg: 'abc' }` → `/story/abc`. The inverse, and tested as one. */
export function pathFor(name, arg = null) {
  if (!name || name === 'home') return '/'
  return arg ? `/${name}/${encodeURIComponent(arg)}` : `/${name}`
}

/**
 * The path an old fragment meant, or null if it did not mean one.
 *
 * Query strings ride along: `#/watch?seg=headlines` is a real thing people
 * have in their address bar, and the Watch screen reads those.
 */
export function pathFromHash(hash) {
  const h = String(hash || '')
  if (!h.startsWith('#/')) return null
  const rest = h.slice(1)
  return rest === '/' ? '/' : rest
}

/** Is this a link we should handle ourselves rather than hand to the browser? */
export function isInternalLink(anchor, { origin }) {
  if (!anchor) return false
  if (anchor.target && anchor.target !== '_self') return false
  if (anchor.hasAttribute('download')) return false
  const rel = (anchor.getAttribute('rel') || '').toLowerCase()
  if (rel.split(/\s+/).includes('external')) return false
  const href = anchor.getAttribute('href') || ''
  // A bare fragment is an in-page anchor and belongs to the browser.
  if (!href || href.startsWith('#')) return false
  try {
    const url = new URL(anchor.href, origin)
    if (url.origin !== origin) return false
    return ROUTES.includes(parseRoute(url.pathname).name)
  } catch { return false }
}

const listeners = new Set()
const announce = () => { for (const fn of listeners) fn() }

/** Go somewhere, in the page. */
export function navigate(to, { replace = false, scroll = true } = {}) {
  const url = new URL(to, window.location.origin)
  const here = window.location.pathname + window.location.search
  const there = url.pathname + url.search
  if (there === here) return
  window.history[replace ? 'replaceState' : 'pushState']({}, '', there)
  if (scroll) window.scrollTo(0, 0)
  announce()
}

/**
 * Rewrite a legacy `#/…` address to its path, once, before anything renders.
 *
 * `replaceState` rather than `assign` so the fragment does not sit in the
 * history as a step the back button returns to.
 */
export function migrateHash() {
  if (typeof window === 'undefined') return false
  const path = pathFromHash(window.location.hash)
  if (!path) return false
  window.history.replaceState({}, '', path)
  return true
}

let wired = false

/**
 * One click handler for the whole app, rather than an onClick on every link.
 *
 * Every navigation in here is an `<a href>` with a real, shareable address —
 * which is what makes middle-click, cmd-click, "copy link address" and the
 * browser's own back button all work without a line of code each. This only
 * takes over the plain left click.
 */
function wireLinks() {
  if (wired) return
  wired = true
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0) return
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const anchor = e.target?.closest?.('a[href]')
    if (!isInternalLink(anchor, { origin: window.location.origin })) return
    e.preventDefault()
    navigate(anchor.getAttribute('href'))
  })
  window.addEventListener('popstate', () => { window.scrollTo(0, 0); announce() })
}

export function useRoute() {
  const [route, setRoute] = useState(() => parseRoute(window.location.pathname))
  useEffect(() => {
    wireLinks()
    const on = () => setRoute(parseRoute(window.location.pathname))
    listeners.add(on)
    // The address can have moved between first render and this effect running.
    on()
    return () => listeners.delete(on)
  }, [])
  return route
}
