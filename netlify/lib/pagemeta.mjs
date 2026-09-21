/**
 * Turning a request into a route, and a route's meta into head tags.
 *
 * Separate from the functions that use it so it can be tested without a blob
 * store, a network or a bundler — this is the part that is easy to get subtly
 * wrong and impossible to notice, because nobody browsing the site ever sees
 * a meta tag.
 */

const CARD_W = 1200
const CARD_H = 630

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

/**
 * The app path a request is really for.
 *
 * Netlify's rewrite can present the path either as the address the visitor
 * typed or as the function's own path with the parameters appended, depending
 * on the rule and the runtime. Rather than depend on which, the
 * `/.netlify/functions/<name>` prefix is stripped when it is there.
 */
export function appPath(rawUrl) {
  const { pathname, search } = new URL(rawUrl, 'https://example.invalid')
  const stripped = pathname.replace(/^\/\.netlify\/functions\/[^/]+/, '')
  return (stripped || '/') + (search || '')
}

/** `/market/zendaya?x=1` → `{ name: 'market', arg: 'zendaya' }`. */
export function routeOf(path) {
  const parts = String(path).split('?')[0].split('/').filter(Boolean)
  let arg = null
  if (parts[1]) { try { arg = decodeURIComponent(parts[1]) } catch { arg = parts[1] } }
  return { name: parts[0] || 'home', arg }
}

/** `/og/market/zendaya.png` → `{ kind: 'market', arg: 'zendaya' }`. */
export function cardRoute(rawUrl) {
  const { pathname } = new URL(rawUrl, 'https://example.invalid')
  const parts = pathname
    .replace(/^\/\.netlify\/functions\/[^/]+/, '')
    .replace(/^\/og\/?/, '')
    .replace(/\.png$/i, '')
    .split('/').filter(Boolean)
  let arg = null
  if (parts[1]) { try { arg = decodeURIComponent(parts[1]) } catch { arg = parts[1] } }
  return { kind: parts[0] || 'home', arg }
}

/** The head tags for one page. */
export function metaTags(meta, { origin }) {
  const url = `${origin}${meta.path}`
  const card = `${origin}${meta.card}`
  const type = meta.kind === 'story' ? 'article' : 'website'
  const tags = [
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:site_name" content="Gossip Genie" />`,
    `<meta property="og:title" content="${esc(meta.shareTitle)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${esc(card)}" />`,
    `<meta property="og:image:width" content="${CARD_W}" />`,
    `<meta property="og:image:height" content="${CARD_H}" />`,
    `<meta property="og:image:alt" content="${esc(meta.shareTitle)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(meta.shareTitle)}" />`,
    `<meta name="twitter:description" content="${esc(meta.description)}" />`,
    `<meta name="twitter:image" content="${esc(card)}" />`,
  ]
  if (meta.publishedAt) tags.push(`<meta property="article:published_time" content="${esc(meta.publishedAt)}" />`)
  return tags.join('\n    ')
}

/**
 * Splice the tags in, taking out the ones the built file already carries.
 *
 * index.html ships the front page's own preview tags, which is what makes `/`
 * free to serve straight off the CDN. On every other page they are wrong, and
 * two og:titles in a head is not a crash but something worse: the crawler
 * picks one, and not always the one you meant.
 */
export function inject(html, tags) {
  return html
    .replace(/\s*<title>[\s\S]*?<\/title>/i, '')
    .replace(/\s*<meta\s+name=["']description["'][^>]*>/ig, '')
    .replace(/\s*<meta\s+property=["']og:[^"']*["'][^>]*>/ig, '')
    .replace(/\s*<meta\s+name=["']twitter:[^"']*["'][^>]*>/ig, '')
    .replace(/\s*<link\s+rel=["']canonical["'][^>]*>/ig, '')
    .replace('</head>', `  ${tags}\n  </head>`)
}
