import test from 'node:test'
import assert from 'node:assert/strict'
import { shareMeta, needs, clip, moveFor, SITE } from './preview.mjs'
import { appPath, routeOf, cardRoute, metaTags, inject } from './pagemeta.mjs'

const ORIGIN = 'https://gossip.example'

const story = (over = {}) => ({
  id: 'abc', strand: 'bizarre', publishedAt: '2026-09-18T09:00:00Z',
  headline: 'Elk jumps on a car in Colorado',
  caption: 'Rangers waited forty minutes.',
  outlets: 23, ...over,
})

const row = (over = {}) => ({
  id: 'zendaya', slug: 'zendaya', displayName: 'Zendaya',
  gossipScore: 62.1, change24h: 18.4, change1h: 0.4, momentum: 40,
  mentions: 400, drivers: [], ...over,
})

/* ---------------- what each page says about itself ---------------- */

test('a story link is titled with the headline, not the site', () => {
  const m = shareMeta({ name: 'story', arg: 'abc' }, { feed: { stories: [story()] } })
  assert.equal(m.kind, 'story')
  assert.equal(m.shareTitle, 'Elk jumps on a car in Colorado')
  assert.match(m.title, /^Elk jumps on a car in Colorado · /)
  assert.equal(m.description, 'Rangers waited forty minutes.')
  assert.equal(m.card, '/og/story/abc.png')
  assert.equal(m.path, '/story/abc')
})

test('a story that has fallen out of the feed previews as the site', () => {
  // Stories last three days; a link can outlive one. Better a dull preview
  // than a card promising a story that is not there.
  const m = shareMeta({ name: 'story', arg: 'gone' }, { feed: { stories: [story()] } })
  assert.equal(m.kind, 'home')
})

test('a celebrity link leads with the number, because the number is the news', () => {
  const m = shareMeta({ name: 'market', arg: 'zendaya' },
    { market: { rows: [row(), row({ id: 'b', slug: 'b', change24h: 2 }), row({ id: 'c', slug: 'c', change24h: -3 })] } })
  assert.equal(m.kind, 'celebrity')
  assert.match(m.shareTitle, /^Zendaya · Gossip Score 62\.1 · \+18\.4 today$/)
  assert.equal(m.card, '/og/market/zendaya.png')
})

test('a celebrity with one of our stories says what happened', () => {
  const m = shareMeta({ name: 'market', arg: 'zendaya' }, {
    market: { rows: [row(), row({ id: 'b', slug: 'b', change24h: 2 }), row({ id: 'c', slug: 'c', change24h: -3 })] },
    feed: { stories: [story({ headline: 'Zendaya announces a world tour', people: ['Zendaya'] })] },
  })
  assert.match(m.description, /Zendaya announces a world tour/)
})

test('a name we do not track previews as the board', () => {
  const m = shareMeta({ name: 'market', arg: 'nobody' }, { market: { rows: [row()] }, movers: { risers: [], fallers: [] } })
  assert.equal(m.kind, 'market')
})

test('the board names who is moving rather than describing itself', () => {
  const m = shareMeta({ name: 'market', arg: null }, {
    movers: {
      risers: [{ name: 'Zendaya', moveText: '+18.4 pts' }, { name: 'Pedro Pascal', moveText: '+11.2 pts' }],
      fallers: [{ name: 'Dua Lipa', moveText: '-9.8 pts' }],
    },
  })
  assert.match(m.description, /Zendaya \+18\.4 pts/)
  assert.match(m.description, /Dua Lipa -9\.8 pts/)
})

test('the admin panel is not its own shareable thing', () => {
  assert.equal(shareMeta({ name: 'market', arg: 'admin' }, {}).kind, 'market')
})

test('the channel, the quiz and a strand each say what they are', () => {
  assert.equal(shareMeta({ name: 'watch', arg: null }, {}).path, '/watch')
  assert.equal(shareMeta({ name: 'vertical', arg: null }, {}).path, '/vertical')
  assert.equal(shareMeta({ name: 'quiz', arg: null }, {}).path, '/quiz')
  assert.match(shareMeta({ name: 'strand', arg: 'health' }, {}).shareTitle, /^Health on /)
})

test('a strand nobody publishes is not invented', () => {
  assert.equal(shareMeta({ name: 'strand', arg: 'sport' }, {}).kind, 'home')
})

test('nothing loaded still produces a usable preview', () => {
  for (const route of [{ name: 'story', arg: 'x' }, { name: 'market', arg: 'x' }, { name: 'market', arg: null }]) {
    const m = shareMeta(route, {})
    assert.ok(m.title && m.description && m.card && m.path, JSON.stringify(route))
  }
})

test('only the pages that need data ask for it', () => {
  assert.deepEqual(needs({ name: 'story' }), { feed: true })
  assert.deepEqual(needs({ name: 'market' }), { market: true, feed: true })
  assert.deepEqual(needs({ name: 'watch' }), {})
})

/* ---------------- the chart ---------------- */

const edition = (over = {}) => ({
  id: '2026-W38',
  label: '14–20 September 2026',
  publishedAt: '2026-09-21T13:00:00Z',
  entries: [
    { rank: 1, id: 'a', slug: 'zendaya', displayName: 'Zendaya', score: 80, status: 'up', lastWeek: 3, weeksAtOne: 1 },
    { rank: 2, id: 'b', slug: 'pedro-pascal', displayName: 'Pedro Pascal', score: 70 },
    { rank: 3, id: 'c', slug: 'dua-lipa', displayName: 'Dua Lipa', score: 60 },
    { rank: 4, id: 'd', slug: 'adele', displayName: 'Adele', score: 50 },
  ],
  summary: { charted: 100, numberOne: { displayName: 'Zendaya', status: 'up', lastWeek: 3, weeksAtOne: 1 } },
  ...over,
})

test('a chart link with no decided lead is titled with the number one', () => {
  const m = shareMeta({ name: 'chart', arg: '2026-W38' }, { edition: edition() })
  assert.equal(m.kind, 'chart')
  assert.match(m.shareTitle, /^Zendaya is number one on /)
  assert.match(m.title, /14–20 September 2026/)
  assert.equal(m.card, '/og/chart/2026-W38.png')
  assert.equal(m.path, '/chart/2026-W38')
})

test('the blurb says how they got there and who is behind them', () => {
  const m = shareMeta({ name: 'chart', arg: null }, { edition: edition() })
  assert.match(m.description, /Up from 3rd/)
  assert.match(m.description, /Pedro Pascal, Dua Lipa, Adele/)
  assert.match(m.description, /100 names/)
})

test('a third week at number one says so', () => {
  const m = shareMeta({ name: 'chart', arg: null }, {
    edition: edition({ summary: { charted: 100, numberOne: { displayName: 'Zendaya', status: 'same', lastWeek: 1, weeksAtOne: 3 } } }),
  })
  assert.match(m.description, /3rd week at number one/)
})

test('before the first Monday a chart link still previews as the chart', () => {
  const m = shareMeta({ name: 'chart', arg: null }, {})
  assert.equal(m.kind, 'chart')
  assert.equal(m.card, '/og/chart.png')
  assert.equal(m.path, '/chart')
  assert.ok(m.description.length > 20)
})

test('a chart page asks for the right week and nothing else', () => {
  assert.deepEqual(needs({ name: 'chart', arg: '2026-W38' }), { chart: '2026-W38' })
  assert.deepEqual(needs({ name: 'chart', arg: null }), { chart: true })
})

test('a chart card route is read back correctly', () => {
  assert.deepEqual(cardRoute('/og/chart.png'), { kind: 'chart', arg: null })
  assert.deepEqual(cardRoute('/og/chart/2026-W38.png'), { kind: 'chart', arg: '2026-W38' })
})

/* ---------------- the move a card is allowed to claim ---------------- */

test('a market with a day of history is measured against yesterday', () => {
  const rows = [row(), row({ id: 'b', slug: 'b', change24h: 4 }), row({ id: 'c', slug: 'c', change24h: -2 })]
  assert.deepEqual(moveFor(rows[0], rows), { basis: 'day', value: 18.4, label: 'today', suffix: ' pts' })
})

test('a market in its first hours does not pretend to know the day', () => {
  const rows = [
    row({ change24h: null, change1h: 1.2 }),
    row({ id: 'b', slug: 'b', change24h: null, change1h: 0.5 }),
    row({ id: 'c', slug: 'c', change24h: null, change1h: -0.7 }),
  ]
  const m = moveFor(rows[0], rows)
  assert.equal(m.basis, 'update')
  assert.equal(m.value, 1.2)
  assert.notEqual(m.label, 'today')
})

test('a blurb is cut at a word, not a character', () => {
  assert.equal(clip('one two three four', 11), 'one two…')
  assert.equal(clip('short', 40), 'short')
  assert.equal(clip('  spaced   out  '), 'spaced out')
})

/* ---------------- request → route ---------------- */

test('the function path is stripped back to the address the visitor used', () => {
  assert.equal(appPath('/.netlify/functions/page/story/abc'), '/story/abc')
  assert.equal(appPath('https://x.test/story/abc?from=share'), '/story/abc?from=share')
  assert.equal(appPath('/.netlify/functions/page'), '/')
})

test('routes and card routes are read the same way whichever shape arrives', () => {
  assert.deepEqual(routeOf('/market/zendaya?x=1'), { name: 'market', arg: 'zendaya' })
  assert.deepEqual(cardRoute('/og/story/abc.png'), { kind: 'story', arg: 'abc' })
  assert.deepEqual(cardRoute('/.netlify/functions/og/market/zendaya.png'), { kind: 'market', arg: 'zendaya' })
  assert.deepEqual(cardRoute('/og/home.png'), { kind: 'home', arg: null })
  assert.deepEqual(cardRoute('/og/market.png'), { kind: 'market', arg: null })
})

/* ---------------- the tags themselves ---------------- */

const HEAD = `<!doctype html><html><head>
    <title>Gossip Genie</title>
    <meta name="description" content="old" />
    <meta property="og:title" content="old" />
    <meta property="og:image" content="/og/home.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="canonical" href="https://x/" />
  </head><body><div id="root"></div><script src="/assets/app.js"></script></body></html>`

test('the page ends up with exactly one title and one og:image', () => {
  const meta = shareMeta({ name: 'story', arg: 'abc' }, { feed: { stories: [story()] } })
  const html = inject(HEAD, metaTags(meta, { origin: ORIGIN }))
  assert.equal(html.match(/<title>/g).length, 1)
  assert.equal(html.match(/property="og:image"/g).length, 1)
  assert.equal(html.match(/property="og:title"/g).length, 1)
  assert.equal(html.match(/rel="canonical"/g).length, 1)
  assert.match(html, /<title>Elk jumps on a car in Colorado · /)
})

test('the app itself is left untouched', () => {
  const html = inject(HEAD, metaTags(shareMeta({ name: 'home' }, {}), { origin: ORIGIN }))
  assert.match(html, /<div id="root"><\/div>/)
  assert.match(html, /<script src="\/assets\/app\.js">/)
})

test('card and page URLs are absolute, which is what crawlers want', () => {
  const meta = shareMeta({ name: 'story', arg: 'abc' }, { feed: { stories: [story()] } })
  const tags = metaTags(meta, { origin: ORIGIN })
  assert.match(tags, new RegExp(`og:image" content="${ORIGIN}/og/story/abc\\.png"`))
  assert.match(tags, new RegExp(`og:url" content="${ORIGIN}/story/abc"`))
})

test('a headline with a quote in it does not break the head', () => {
  const meta = shareMeta({ name: 'story', arg: 'abc' },
    { feed: { stories: [story({ headline: 'He said "no" & left <fast>' })] } })
  const tags = metaTags(meta, { origin: ORIGIN })
  assert.ok(!/content="He said "/.test(tags), tags)
  assert.match(tags, /&quot;no&quot; &amp; left &lt;fast&gt;/)
})

test('a story card is an article and everything else is a page', () => {
  const s = metaTags(shareMeta({ name: 'story', arg: 'abc' }, { feed: { stories: [story()] } }), { origin: ORIGIN })
  assert.match(s, /og:type" content="article"/)
  assert.match(s, /article:published_time" content="2026-09-18T09:00:00Z"/)
  assert.match(metaTags(shareMeta({ name: 'home' }, {}), { origin: ORIGIN }), /og:type" content="website"/)
})

test('the site name is the site name', () => {
  assert.equal(SITE, 'Gossip Genie')
})

test('the exchange has its own preview, and never a broken card', () => {
  /*
   * A route the page function serves but shareMeta does not know about
   * falls through to the home page's tags, so a shared exchange link would
   * describe the news app. The card is the market's on purpose: the board's
   * own card has to be drawn from the board, which does not exist until the
   * first settle, and a shared link opening on a broken image is worse than
   * one opening on a generic but correct picture.
   */
  const m = shareMeta({ name: 'exchange', arg: null }, {})
  assert.equal(m.kind, 'exchange')
  assert.equal(m.path, '/exchange')
  assert.match(m.shareTitle, /Genie Exchange/)
  assert.ok(m.card, 'a preview with no card is a preview nobody clicks')
  assert.match(m.description, /fantasy money/i, 'the money is not real and the preview says so')
})

test('a chart link leads on the week\u2019s story when there is one', () => {
  const m = shareMeta({ name: 'chart', arg: '2026-W38' }, {
    edition: edition({
      report: {
        lead: {
          kind: 'climb',
          places: 12,
          entry: { id: 'd', slug: 'adele', displayName: 'Adele', rank: 4, lastWeek: 16, score: 50 },
        },
      },
    }),
  })
  assert.equal(m.shareTitle, '12 places for Adele')
  assert.match(m.title, /14–20 September 2026/)
  assert.match(m.description, /From 16 to 4/)
  // The number one is context here rather than the news, and still worth a
  // sentence because the story is about somebody else.
  assert.match(m.description, /Zendaya is number one/)
})

test('a lead about the number one does not name them twice', () => {
  const m = shareMeta({ name: 'chart', arg: null }, {
    edition: edition({
      summary: {
        charted: 100,
        numberOne: { id: 'a', displayName: 'Zendaya', status: 'up', lastWeek: 3, weeksAtOne: 1, score: 80 },
      },
      report: {
        lead: { kind: 'numberOne', entry: { id: 'a', displayName: 'Zendaya', score: 80, weeksOn: 4, weeksAtOne: 1 } },
      },
    }),
  })
  assert.match(m.shareTitle, /Zendaya holds number one/)
  assert.equal((m.description.match(/Zendaya/g) || []).length, 0,
    'the headline has already named them; the blurb should move on')
})
