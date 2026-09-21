/**
 * The app, with this page's own preview tags in its head.
 *
 * A single-page app has one `index.html`, so every link to it previewed the
 * same way: same title, same blurb, no picture. Since the routing moved off
 * the fragment (see src/lib/useRoute.js), `/story/abc` actually reaches the
 * server — and this is what it reaches. It serves the identical built app,
 * with the title, description and card for the thing being shared spliced
 * into the head, so the link looks like the story in somebody's messages and
 * still opens as the app when they tap it.
 *
 * Everything here degrades. If the market is down, a celebrity link previews
 * as the market. If the blob store is unreachable, it previews as the site.
 * If this function falls over entirely, the redirect in netlify.toml has
 * already given the browser the app — the worst case is a dull preview, never
 * a broken page.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { blobStore } from './_store.mjs'
import { marketBlobs } from './_market-store.mjs'
import { KEYS } from '../../pipeline/run.mjs'
import { createStore } from '../../market/store.mjs'
import { shareMeta, needs } from '../lib/preview.mjs'
import { appPath, routeOf, metaTags, inject } from '../lib/pagemeta.mjs'
import { marketMovers } from '../../src/lib/movers.js'

/* ---------------- the built app ---------------- */

let shellCache = null

/**
 * `dist/index.html`, as Vite built it.
 *
 * Read from disk — Netlify bundles it in through `included_files` — and if it
 * is not there, fetched from the site itself. `/index.html` is served as a
 * file rather than through the SPA catch-all, so that fetch cannot come back
 * round to this function.
 */
async function shell() {
  if (shellCache) return shellCache
  for (const path of ['dist/index.html', '../dist/index.html', '../../dist/index.html']) {
    try {
      const html = await readFile(join(process.cwd(), path), 'utf8')
      if (html.includes('</head>')) { shellCache = html; return html }
    } catch { /* try the next one */ }
  }
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL
  if (base) {
    try {
      const res = await fetch(`${base}/index.html`, { signal: AbortSignal.timeout(3000) })
      if (res.ok) {
        const html = await res.text()
        if (html.includes('</head>')) { shellCache = html; return html }
      }
    } catch { /* fall through to the redirect */ }
  }
  return null
}

/* ---------------- loading what the page is about ---------------- */

const safe = async (p, fallback = null) => { try { return (await p) ?? fallback } catch { return fallback } }

async function load(route) {
  const want = needs(route)
  const store = want.market || want.chart ? createStore(marketBlobs()) : null
  const [feed, market, edition] = await Promise.all([
    want.feed ? safe(blobStore().getJSON(KEYS.feed)) : null,
    want.market ? safe(store.readMarket()) : null,
    // `chart: true` means this week; a week id means that one.
    want.chart === true ? safe(store.readLatestChart())
      : want.chart ? safe(store.readChart(want.chart)) : null,
  ])
  const data = { feed, market, edition }
  if (market) data.movers = marketMovers(market, feed)
  return data
}

/* ---------------- the handler ---------------- */

export default async (req) => {
  const path = appPath(req.url)
  const route = routeOf(path)
  const origin = (process.env.URL || new URL(req.url).origin).replace(/\/$/, '')

  const html = await shell()
  if (!html) {
    // Nothing to serve the app from. Rather than invent a page, hand the
    // browser back to the static build.
    return new Response(null, { status: 302, headers: { location: '/index.html', 'cache-control': 'no-store' } })
  }

  let meta
  try {
    meta = shareMeta(route, await load(route))
  } catch {
    meta = shareMeta({ name: 'home', arg: null }, {})
  }

  return new Response(inject(html, metaTags(meta, { origin })), {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Short at the edge, never in the visitor's browser: a story's blurb
      // changes when the feed republishes, and a celebrity's number changes
      // every fifteen minutes.
      'cache-control': 'public, max-age=0, must-revalidate',
      'netlify-cdn-cache-control': 'public, s-maxage=120, stale-while-revalidate=600',
    },
  })
}
