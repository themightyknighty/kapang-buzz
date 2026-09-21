/**
 * What a link to this page should say about itself.
 *
 * One function decides the title, the blurb and the card for every shareable
 * address, and both the page function (which writes the meta tags) and the
 * card function (which draws the picture) read it. Keeping them together is
 * the point: a card that says one thing while the tag beside it says another
 * is the failure mode this whole feature exists to avoid.
 *
 * Pure — every caller hands in the data it already loaded — so the copy can
 * be tested without a network, a blob store or a browser.
 */
import { BASES, basisFor, reasonFor, shortReason } from '../../src/lib/movers.js'
import { CHART } from '../../market/config.mjs'
import { weekLabel, numberOneLine } from '../../market/chart.mjs'

export const SITE = 'Gossip Genie'
export const TAGLINE = '30 family-friendly stories a day — celebrity news, health, fantastic facts and bizarre news, with a 24/7 watch channel.'

const STRANDS = {
  celebrity: 'Celebrity Gossip',
  health: 'Health',
  facts: 'Fantastic Facts',
  bizarre: 'Bizarre News',
}

/** Trim to a length that survives a preview card without being cut mid-word. */
export function clip(s, max = 200) {
  const clean = String(s || '').replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, max).replace(/\s+\S*$/, '')}…`
}

const signed = (n, dp = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(dp)}`

/**
 * Which measure of movement this row is being judged on, and by how much.
 *
 * The same three-way fallback the boards use, so a card cannot claim a
 * 24-hour move on a market that has only been running for an hour.
 */
export function moveFor(row, rows = []) {
  const basis = basisFor(rows.length ? rows : [row])
  const B = BASES[basis]
  const value = Number.isFinite(row?.[B.field]) ? Number(row[B.field].toFixed(B.dp)) : null
  return { basis, value, label: B.short === '24h' ? 'today' : B.short, suffix: B.suffix }
}

/* ------------------------------------------------------------------ *
 * One description per kind of page
 * ------------------------------------------------------------------ */

const home = () => ({
  kind: 'home',
  title: `${SITE} · Celebrity, Health, Facts & Bizarre News`,
  shareTitle: SITE,
  description: TAGLINE,
  card: '/og/home.png',
  path: '/',
})

const strandPage = (key) => ({
  kind: 'strand',
  title: `${STRANDS[key] || 'Stories'} · ${SITE}`,
  shareTitle: `${STRANDS[key] || 'Stories'} on ${SITE}`,
  description: TAGLINE,
  card: '/og/home.png',
  path: `/strand/${key}`,
})

const storyPage = (story) => ({
  kind: 'story',
  title: `${story.headline} · ${SITE}`,
  shareTitle: story.headline,
  description: clip(story.caption || story.body || TAGLINE),
  card: `/og/story/${encodeURIComponent(story.id)}.png`,
  path: `/story/${encodeURIComponent(story.id)}`,
  publishedAt: story.publishedAt || null,
  strand: story.strand || null,
})

/**
 * A celebrity page.
 *
 * The number goes in the title because the number is the news. "Zendaya ·
 * Gossip Score 62.1" is a link somebody clicks; "Zendaya — Gossip Genie" is
 * one they scroll past.
 */
const celebrityPage = (row, { rows = [], stories = [] } = {}) => {
  const move = moveFor(row, rows)
  const score = Number.isFinite(row.gossipScore) ? row.gossipScore.toFixed(1) : null
  const bits = [row.displayName]
  if (score) bits.push(`Gossip Score ${score}`)
  if (move.value != null && move.value !== 0) bits.push(`${signed(move.value)} ${move.label}`)

  const why = shortReason(reasonFor(row, stories), { max: 120 })
  return {
    kind: 'celebrity',
    title: `${bits.join(' · ')} · ${SITE}`,
    shareTitle: bits.join(' · '),
    description: clip(why
      ? `${why} — tracked on the ${SITE} Celebrity Market, updated every 15 minutes.`
      : `${row.displayName} on the ${SITE} Celebrity Market. How loudly the world is talking, updated every 15 minutes.`),
    card: `/og/market/${encodeURIComponent(row.slug)}.png`,
    path: `/market/${encodeURIComponent(row.slug)}`,
  }
}

/** The board. The blurb names who is actually moving, so it is worth reading. */
const marketPage = (movers) => {
  const names = [...(movers?.risers || []).slice(0, 2), ...(movers?.fallers || []).slice(0, 1)]
    .map((m) => `${m.name} ${m.moveText}`)
  return {
    kind: 'market',
    title: `Celebrity Market · who's rising right now · ${SITE}`,
    shareTitle: `Celebrity Market · who's rising right now`,
    description: clip(names.length
      ? `${names.join(' · ')}. A gossip score for every name we track, updated every 15 minutes.`
      : `A gossip score for every celebrity we track, updated every 15 minutes.`),
    card: '/og/market.png',
    path: '/market',
  }
}

/**
 * A chart edition.
 *
 * The number one goes in the title, because the number one is the news and a
 * link that says "The Genie 100" is a link nobody clicks.
 */
const chartPage = (edition, weekId) => {
  if (!edition) {
    return {
      kind: 'chart',
      title: `${CHART.name} · ${SITE}`,
      shareTitle: `${CHART.name} — ${CHART.descriptor}`,
      description: `A hundred names ranked every Monday by how loudly the world is talking about them. ${SITE}.`,
      card: '/og/chart.png',
      path: weekId ? `/chart/${weekId}` : '/chart',
    }
  }
  const one = edition.summary?.numberOne
  const behind = (edition.entries || []).slice(1, 4).map((e) => e.displayName)
  return {
    kind: 'chart',
    title: one
      ? `${one.displayName} is number one on ${CHART.name} · ${edition.label}`
      : `${CHART.name} · ${edition.label}`,
    shareTitle: one
      ? `${one.displayName} is number one on ${CHART.name}`
      : `${CHART.name} · ${edition.label}`,
    description: clip([
      one ? `${numberOneLine(one)}.` : null,
      behind.length ? `Then ${behind.join(', ')}.` : null,
      `${edition.summary?.charted || 0} names ranked for the week of ${edition.label}.`,
    ].filter(Boolean).join(' ')),
    card: `/og/chart/${encodeURIComponent(edition.id)}.png`,
    path: `/chart/${edition.id}`,
    publishedAt: edition.publishedAt || null,
  }
}

const watchPage = (vertical) => ({
  kind: 'watch',
  title: `Watch · ${SITE}`,
  shareTitle: `${SITE} — the channel`,
  description: vertical
    ? 'The vertical cut of the Gossip Genie channel: celebrity, health, facts and bizarre news, running around the clock.'
    : 'A 24/7 channel of celebrity, health, fantastic facts and bizarre news. No adverts, nothing to sign up to — it is just on.',
  card: '/og/home.png',
  path: vertical ? '/vertical' : '/watch',
})

const quizPage = () => ({
  kind: 'quiz',
  title: `Quiz · ${SITE}`,
  shareTitle: `Today's Gossip Genie quiz`,
  description: 'True or false, from today’s stories. A new one every day.',
  card: '/og/home.png',
  path: '/quiz',
})

/**
 * The meta for one address.
 *
 * `data` carries whatever the caller managed to load. Anything missing falls
 * back to the site's own description rather than to an error: a link that
 * previews as the site is a disappointment, a link that previews as a 500 is
 * a reason not to click the next one.
 */
export function shareMeta(route, data = {}) {
  const { name, arg } = route
  if (name === 'chart') return chartPage(data.edition, arg)
  if (name === 'story') {
    const story = (data.feed?.stories || []).find((s) => s.id === arg)
    return story ? storyPage(story) : home()
  }
  if (name === 'market') {
    if (!arg || arg === 'admin') return marketPage(data.movers)
    const row = (data.market?.rows || []).find((r) => r.slug === arg)
    return row
      ? celebrityPage(row, { rows: data.market?.rows || [], stories: data.feed?.stories || [] })
      : marketPage(data.movers)
  }
  if (name === 'strand' && STRANDS[arg]) return strandPage(arg)
  if (name === 'watch') return watchPage(false)
  if (name === 'vertical') return watchPage(true)
  if (name === 'quiz') return quizPage()
  return home()
}

/** What a page function needs to load before it can answer. */
export function needs(route) {
  if (route.name === 'story') return { feed: true }
  if (route.name === 'market') return { market: true, feed: true }
  if (route.name === 'chart') return { chart: route.arg || true }
  return {}
}

export { CHART }

export { STRANDS as SHARE_STRANDS }
