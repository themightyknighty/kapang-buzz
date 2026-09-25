import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFile } from 'node:fs/promises'

/**
 * In dev, /api/market serves what `npm run market:once` wrote to
 * .market-data/, so a local run can actually be looked at.
 *
 * Without this the page falls back to the mock market and shows its banner,
 * which is correct — /api/market is a Netlify function reading Netlify Blobs,
 * and neither exists on a laptop.
 */
const localMarket = () => {
  const read = async (path) => readFile(new URL(path, import.meta.url), 'utf8')
  const handler = async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    const slug = (req.url || '/').replace(/^\/+|\/+$/g, '').split('?')[0]
    try {
      const market = JSON.parse(await read('./.market-data/market/current.json'))
      if (!slug) { res.end(JSON.stringify(market)); return }

      // One celebrity: the same shape the Netlify function returns.
      const row = market.rows.find((r) => r.slug === slug)
      if (!row) { res.statusCode = 404; res.end(JSON.stringify({ error: 'Not tracked.', slug })); return }
      let scoreSeries = [], daily = []
      try {
        const day = new Date().toISOString().slice(0, 10)
        const series = JSON.parse(await read(`./.market-data/series/${row.id}/${day}.json`))
        scoreSeries = series.points.map((p) => ({ t: Date.parse(p.timestamp), v: p.gossipScore }))
      } catch { /* no snapshots yet today */ }
      try { daily = JSON.parse(await read(`./.market-data/series/${row.id}/rollup.json`)).days } catch { /* no rollup yet */ }
      res.end(JSON.stringify({ row, scoreSeries, daily, generatedAt: market.generatedAt, mock: false }))
    } catch {
      res.statusCode = 404
      res.end(JSON.stringify({ rows: [], empty: true, reason: 'No local run yet — try: npm run market:once' }))
    }
  }
  // Block bodies on purpose: Vite treats anything RETURNED from these hooks
  // as a post-hook and calls it with no arguments, which crashes the server.
  return {
    name: 'local-market',
    configureServer(server) { server.middlewares.use('/api/market', handler) },
    configurePreviewServer(server) { server.middlewares.use('/api/market', handler) },
  }
}

/**
 * In dev, /api/chart serves the editions `node scripts/chart-local.mjs` wrote
 * to .market-data/charts/. Without it the chart screen can only ever show its
 * "not published yet" state on a laptop, which is the one state that needs
 * the least looking at.
 */
const localChart = () => {
  const read = async (path) => readFile(new URL(path, import.meta.url), 'utf8')
  const handler = async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    const arg = (req.url || '/').replace(/^\/+|\/+$/g, '').split('?')[0]
    try {
      if (arg === 'index') { res.end(await read('./.market-data/charts/index.json')); return }
      if (arg === 'live') { res.end(await read('./.market-data/charts/live.json')); return }
      res.end(await read(`./.market-data/charts/${arg || 'latest'}.json`))
    } catch {
      res.statusCode = arg ? 404 : 200
      res.end(JSON.stringify({
        empty: true,
        reason: 'No local edition — try: node scripts/chart-local.mjs --backfill',
      }))
    }
  }
  return {
    name: 'local-chart',
    configureServer(server) { server.middlewares.use('/api/chart', handler) },
    configurePreviewServer(server) { server.middlewares.use('/api/chart', handler) },
  }
}

/**
 * In dev, /api/exchange serves the board `node scripts/exchange-local.mjs`
 * wrote to .market-data/prices/.
 *
 * There was no handler at all, so the exchange screen on a laptop could only
 * ever show "The exchange is not answering" — the one screen in the app whose
 * whole claim is that it is live was the one screen nobody could look at.
 */
const localExchange = () => {
  const read = async (path) => readFile(new URL(path, import.meta.url), 'utf8')
  const handler = async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    const arg = (req.url || '/').replace(/^\/+|\/+$/g, '').split('?')[0]
    try {
      const board = JSON.parse(await read('./.market-data/prices/board.json'))
      if (!arg) { res.end(JSON.stringify(board)); return }
      // One name's book, the way /api/exchange/:slug answers in production.
      const row = (board.names || []).find((n) => n.slug === arg || n.id === arg)
      if (!row) { res.statusCode = 404; res.end(JSON.stringify({ error: 'not listed', slug: arg })); return }
      const book = JSON.parse(await read(`./.market-data/prices/${row.id}.json`).catch(() => '{}'))
      res.end(JSON.stringify({ ...row, book: book.days || [] }))
    } catch {
      res.end(JSON.stringify({
        empty: true,
        reason: 'No local board — try: npm run market:mock && node scripts/exchange-local.mjs',
        names: [],
      }))
    }
  }
  return {
    name: 'local-exchange',
    configureServer(server) { server.middlewares.use('/api/exchange', handler) },
    configurePreviewServer(server) { server.middlewares.use('/api/exchange', handler) },
  }
}

/**
 * In dev, /og/*.png draws the real share cards from the local data.
 *
 * The chart screen shows the card on the page now — it is the thing people
 * screenshot — so on a laptop it would otherwise always be a broken image,
 * which is both ugly and the one part of sharing nobody can check by eye
 * without deploying.
 */
const localCards = () => {
  const handler = async (req, res) => {
    const path = (req.url || '/').split('?')[0].replace(/\.png$/i, '')
    const [, kind = 'home', arg = null] = path.split('/')
    try {
      const card = await import('./netlify/lib/card.mjs')
      const read = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'))
      let svg = null

      if (kind === 'chart') {
        const edition = await read(`./.market-data/charts/${arg || 'live'}.json`)
        svg = card.chartCard(edition, { name: 'The Genie 100' })
      } else if (kind === 'market' && arg) {
        const market = await read('./.market-data/market/current.json')
        const row = market.rows.find((r) => r.slug === arg)
        if (row) {
          svg = card.celebrityCard({
            displayName: row.displayName, gossipScore: row.gossipScore,
            change: row.change24h, changeLabel: 'today', rank: row.rank, tracked: market.rows.length,
          })
        }
      }
      if (!svg) svg = card.siteCard()

      res.setHeader('Content-Type', 'image/png')
      res.setHeader('Cache-Control', 'no-store')
      res.end(await card.toPng(svg))
    } catch (err) {
      res.statusCode = 404
      res.end(String(err.message))
    }
  }
  return {
    name: 'local-cards',
    configureServer(server) { server.middlewares.use('/og', handler) },
    configurePreviewServer(server) { server.middlewares.use('/og', handler) },
  }
}

/** In dev, /api/feed serves .data/feed.json from `npm run run:local`, if there is one. */
const localFeed = () => ({
  name: 'local-feed',
  configureServer(server) {
    server.middlewares.use('/api/feed', async (_req, res) => {
      try {
        const body = await readFile(new URL('./.data/feed.json', import.meta.url), 'utf8')
        res.setHeader('Content-Type', 'application/json'); res.end(body)
      } catch {
        res.statusCode = 404; res.end('{"empty":true}')
      }
    })
  },
})

/**
 * Absolute URLs in the front page's preview tags.
 *
 * `og:image` is allowed to be relative and several of the crawlers that
 * matter quietly ignore it when it is. The site's own address is only known
 * at build time, so `%SITE_URL%` in index.html is filled in here from what
 * Netlify puts in the environment. On a laptop there is no such address, so
 * the tags stay relative — which is right, because a localhost URL in an
 * og:image is worse than a relative one.
 */
const siteUrl = () => ({
  name: 'site-url',
  transformIndexHtml(html) {
    const base = (process.env.URL || process.env.DEPLOY_PRIME_URL || '').replace(/\/$/, '')
    return html.replaceAll('%SITE_URL%', base)
  },
})

export default defineConfig({
  plugins: [react(), siteUrl(), localFeed(), localMarket(), localChart(), localExchange(), localCards()],
  build: {
    outDir: 'dist',
    assetsInlineLimit: (file) => /kapang-logo\.webp$/.test(file),
  },
  server: { port: 5175 },
})
