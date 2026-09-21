/**
 * The share card itself, as a PNG.
 *
 *   /og/home.png
 *   /og/story/<id>.png
 *   /og/market.png
 *   /og/market/<slug>.png
 *
 * Crawlers fetch these once and cache them for a long time, so the job is to
 * answer fast and never 500: a card endpoint that errors leaves the link with
 * no picture at all, which is the thing this exists to prevent. Every failure
 * path here ends in a card — the generic one if it has to.
 */
import { blobStore } from './_store.mjs'
import { marketBlobs } from './_market-store.mjs'
import { KEYS } from '../../pipeline/run.mjs'
import { createStore } from '../../market/store.mjs'
import { storyCard, celebrityCard, marketCard, chartCard, movementCard, siteCard, toPng, inlineImage } from '../lib/card.mjs'
import { moveFor, CHART } from '../lib/preview.mjs'
import { cardRoute } from '../lib/pagemeta.mjs'
import { marketMovers } from '../../src/lib/movers.js'
import { shareLine } from '../../src/lib/narrative.js'
import { showable } from '../../src/lib/imagesrc.js'

const safe = async (p, fallback = null) => { try { return (await p) ?? fallback } catch { return fallback } }

/** The card shown when we have nothing specific to say. */
const generic = () => siteCard()

export default async (req) => {
  const { kind, arg } = cardRoute(req.url)

  let svg = null
  try {
    svg = await draw(kind, arg)
  } catch (err) {
    console.error('card failed', kind, arg, err?.message)
  }
  if (!svg) {
    try { svg = generic() } catch { return new Response('no card', { status: 500 }) }
  }

  let png
  try {
    png = await toPng(svg)
  } catch (err) {
    console.error('rasterise failed', err?.message)
    return new Response('no card', { status: 500, headers: { 'cache-control': 'no-store' } })
  }

  return new Response(png, {
    status: 200,
    headers: {
      'content-type': 'image/png',
      // A card is a picture of a moment. A day at the edge is long enough that
      // a link doing the rounds is served from cache, and short enough that a
      // score from last week does not follow somebody around.
      'cache-control': 'public, max-age=3600',
      'netlify-cdn-cache-control': 'public, s-maxage=86400, stale-while-revalidate=604800',
    },
  })
}

async function draw(kind, arg) {
  if (kind === 'chart') {
    const store = createStore(marketBlobs())
    // `/og/chart.png` is this week; `/og/chart/2026-W38.png` is that week.
    const edition = arg ? await safe(store.readChart(arg)) : await safe(store.readLatestChart())
    if (!edition?.entries?.length) return null
    return chartCard(edition, {
      image: await inlineImage(edition.entries[0].imageUrl),
      name: CHART.name,
    })
  }

  if (kind === 'story' && arg) {
    const feed = await safe(blobStore().getJSON(KEYS.feed))
    const story = (feed?.stories || []).find((s) => s.id === arg)
    if (!story) return null
    // The same rule the app itself applies: a picture nobody has checked does
    // not go out under a headline, and that holds doubly on a card, which is
    // the version of us that ends up on somebody else's timeline.
    const url = showable(story.image) ? story.image.url : null
    return storyCard(story, { image: await inlineImage(url) })
  }

  if (kind === 'market' && arg && arg !== 'admin') {
    const store = createStore(marketBlobs())
    const market = await safe(store.readMarket())
    const rows = market?.rows || []
    const row = rows.find((r) => r.slug === arg)
    if (!row) return null

    /*
     * On the chart, the card is the measurement.
     *
     * A name people share is almost always a name that just moved, and the
     * question anybody seeing that card has is "why?". The live chart holds
     * the record that answers it — where they came from, the shape of the
     * week, which signals moved — so when this celebrity is on it, that card
     * is drawn instead of the score-and-headline one.
     */
    const live = await safe(store.readLiveChart())
    const onChart = (live?.entries || []).find((e) => e.slug === arg)
    if (onChart?.movement) {
      return movementCard(onChart, {
        image: await inlineImage(onChart.imageUrl || row.imageUrl),
        record: onChart.movement,
        name: CHART.name,
        line: shareLine(onChart.movement, onChart.displayName),
      })
    }
    const move = moveFor(row, rows)
    const ranked = rows.filter((r) => Number.isFinite(r.gossipScore)).sort((a, b) => b.gossipScore - a.gossipScore)
    return celebrityCard({
      displayName: row.displayName,
      gossipScore: row.gossipScore,
      change: move.value,
      changeLabel: move.label,
      rank: row.rank ?? (ranked.findIndex((r) => r.id === row.id) + 1 || null),
      tracked: rows.length || null,
    }, { image: await inlineImage(row.imageUrl) })
  }

  if (kind === 'market') {
    const market = await safe(createStore(marketBlobs()).readMarket())
    const feed = await safe(blobStore().getJSON(KEYS.feed))
    const movers = marketMovers(market, feed, { count: 3 })
    const board = [
      ...movers.risers.slice(0, 2),
      ...movers.fallers.slice(0, 2),
    ].map((m) => ({ displayName: m.name, change: m.move }))
    if (!board.length) return null
    return marketCard({
      movers: board,
      basis: movers.basisLabel,
      tracked: market?.rows?.length || null,
    })
  }

  return null
}
