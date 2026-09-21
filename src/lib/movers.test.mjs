import { test } from 'node:test'
import assert from 'node:assert/strict'
import { marketMovers, basisFor, storiesAbout, reasonFor, shortReason, tapeItems, biggestMover } from './movers.js'

const NOW = Date.parse('2026-09-17T14:00:00Z')

const row = (o) => ({
  id: o.name.toLowerCase().replace(/ /g, '-'), displayName: o.name, slug: o.name.toLowerCase().replace(/ /g, '-'),
  gossipScore: 50, mentions: 20, status: 'ACTIVE', drivers: [], momentum: 0,
  change24h: null, change1h: null, ...o,
})

const story = (o) => ({
  id: o.id, strand: 'celebrity', publishedAt: o.at || '2026-09-17T12:00:00Z',
  headline: o.headline, caption: o.caption || 'A caption.', people: o.people || [], outlets: o.outlets ?? 7,
  whyTrending: o.why || null, ...o,
})

/* ---------------- which measure the board uses ---------------- */

test('the board picks one measure for every row, best available first', () => {
  const day = [row({ name: 'A', change24h: 4 }), row({ name: 'B', change24h: -2 }), row({ name: 'C', change24h: 1 })]
  assert.equal(basisFor(day), 'day')

  // Not enough 24-hour history yet — step down rather than show a board of three.
  const tick = day.map((r) => ({ ...r, change24h: null, change1h: 2 }))
  assert.equal(basisFor(tick), 'update')

  // First ticks of all: momentum is the only thing defined, and it is honest.
  const cold = day.map((r) => ({ ...r, change24h: null, change1h: null, momentum: 40 }))
  assert.equal(basisFor(cold), 'momentum')
})

test('a board never mixes measures', () => {
  const rows = [
    row({ name: 'A', change24h: 9, change1h: 1 }),
    row({ name: 'B', change24h: -5, change1h: 2 }),
    row({ name: 'C', change24h: 3, change1h: -8 }),
    // Has no 24-hour history. It must be left off, not quietly ranked on its
    // 15-minute move against everyone else's day.
    row({ name: 'D', change24h: null, change1h: 40 }),
  ]
  const m = marketMovers({ rows }, null)
  assert.equal(m.basis, 'day')
  assert.deepEqual(m.risers.map((r) => r.name), ['A', 'C'])
  assert.deepEqual(m.fallers.map((r) => r.name), ['B'])
  assert.ok(![...m.risers, ...m.fallers].some((r) => r.name === 'D'))
})

/* ---------------- who is allowed on the board ---------------- */

test('a name with no measured coverage never appears, however it wobbles', () => {
  const m = marketMovers({
    rows: [
      row({ name: 'Covered', mentions: 30, change1h: 2 }),
      row({ name: 'Unmeasured', mentions: 0, change1h: 99 }),
      row({ name: 'Also Covered', mentions: 5, change1h: 3 }),
      row({ name: 'Third', mentions: 4, change1h: -1 }),
    ],
  }, null)
  assert.ok(!m.risers.some((r) => r.name === 'Unmeasured'), 'noise on an uncovered name is not a rise')
  assert.equal(m.measured, 3)
})

test('an empty board says which kind of empty it is', () => {
  assert.match(marketMovers(null, null).emptyReason, /not loaded/)
  assert.match(marketMovers({ rows: [] }, null).emptyReason, /fills in over its first day/)
  assert.match(marketMovers({ rows: [row({ name: 'Flat', change1h: 0, momentum: 0 })] }, null).emptyReason, /Nothing has moved/)
})

/* ---------------- the why ---------------- */

test('our own story is the reason when we have published one', () => {
  const feed = { stories: [story({ id: 's1', headline: 'Ava Lumen announces world tour', people: ['Ava Lumen'], why: 'Three years without live dates' })] }
  const r = reasonFor(row({ name: 'Ava Lumen' }), feed.stories)
  assert.equal(r.kind, 'story')
  assert.equal(r.href, '/story/s1')
  assert.equal(r.text, 'Three years without live dates')
  assert.equal(r.headline, 'Ava Lumen announces world tour')
})

test('the newest of several stories wins', () => {
  const stories = [
    story({ id: 'old', headline: 'Ava Lumen signs deal', people: ['Ava Lumen'], at: '2026-09-15T09:00:00Z' }),
    story({ id: 'new', headline: 'Ava Lumen announces tour', people: ['Ava Lumen'], at: '2026-09-17T09:00:00Z' }),
  ]
  assert.equal(reasonFor(row({ name: 'Ava Lumen' }), stories).story.id, 'new')
})

test('a full name in the copy counts; a surname never does', () => {
  const stories = [story({ id: 's', headline: 'Fans queue overnight as Ava Lumen lands', people: [] })]
  assert.equal(storiesAbout(row({ name: 'Ava Lumen' }), stories).length, 1)
  // The trap that broke entity matching in the market, in a second place.
  assert.equal(storiesAbout(row({ name: 'Taylor Swift' }), [story({ id: 'x', headline: 'Jonathan Swift, 300 years on', people: [] })]).length, 0)
  assert.equal(storiesAbout(row({ name: 'Dwayne Johnson' }), [story({ id: 'y', headline: 'Johnson resigns', people: [] })]).length, 0)
})

test('accents and punctuation do not hide a match', () => {
  const stories = [story({ id: 's', headline: 'Beyoncé Knowles adds dates', people: ['Beyoncé Knowles'] })]
  assert.equal(storiesAbout(row({ name: 'Beyonce Knowles' }), stories).length, 1)
})

test('with no story of ours, the outlets driving it are named rather than a reason invented', () => {
  const r = reasonFor(row({
    name: 'Nina Park',
    drivers: [{ domain: 'apnews.com', url: 'https://apnews.com/a' }, { domain: 'bbc.co.uk', url: 'https://bbc.co.uk/b' }, { domain: 'variety.com', url: 'https://variety.com/c' }, { domain: 'people.com', url: 'https://people.com/d' }],
  }), [])
  assert.equal(r.kind, 'coverage')
  assert.equal(r.text, 'Being covered by apnews.com, bbc.co.uk and variety.com and 1 more')
  assert.equal(r.href, 'https://apnews.com/a')
})

test('with neither, it says so plainly instead of guessing', () => {
  const r = reasonFor(row({ name: 'Leo Marsh' }), [])
  assert.equal(r.kind, 'none')
  assert.equal(r.href, null)
  assert.match(r.text, /No story behind this one yet/)
})

/* ---------------- the board itself ---------------- */

test('risers and fallers are ordered by size of move and carry their reason', () => {
  const feed = { stories: [story({ id: 's1', headline: 'Ava Lumen announces tour', people: ['Ava Lumen'], why: 'Three years of waiting' })] }
  const m = marketMovers({
    generatedAt: '2026-09-17T14:00:00Z',
    rows: [
      row({ name: 'Ava Lumen', change24h: 12.34, gossipScore: 81 }),
      row({ name: 'Leo Marsh', change24h: 3.2 }),
      row({ name: 'Nina Park', change24h: -9.8, drivers: [{ domain: 'variety.com', url: 'https://variety.com/x' }] }),
      row({ name: 'Ben Cole', change24h: -1.1 }),
    ],
  }, feed)

  assert.deepEqual(m.risers.map((r) => r.name), ['Ava Lumen', 'Leo Marsh'])
  assert.deepEqual(m.fallers.map((r) => r.name), ['Nina Park', 'Ben Cole'])
  assert.equal(m.risers[0].moveText, '+12.3 pts')
  assert.equal(m.fallers[0].moveText, '-9.8 pts')
  assert.equal(m.risers[0].href, '/market/ava-lumen')
  assert.equal(m.risers[0].reason.kind, 'story')
  assert.equal(m.fallers[0].reason.kind, 'coverage')
  assert.equal(m.risers[1].reason.kind, 'none')
  assert.equal(m.empty, false)
})

test('momentum boards read as momentum, not as points', () => {
  const m = marketMovers({ rows: [row({ name: 'A', momentum: 62 }), row({ name: 'B', momentum: -41 })] }, null)
  assert.equal(m.basis, 'momentum')
  assert.equal(m.risers[0].moveText, '+62')
  assert.equal(m.fallers[0].moveText, '-41')
  assert.match(m.basisLabel, /momentum/)
})

test('a mock market is carried through as mock, never laundered', () => {
  assert.equal(marketMovers({ mock: true, rows: [row({ name: 'A', change1h: 2 })] }, null).mock, true)
  assert.equal(marketMovers({ mock: false, rows: [] }, null).mock, false)
})

/* ---------------- the tape and the feature pick ---------------- */

test('the tape alternates risers and fallers so it never runs one-sided', () => {
  const m = marketMovers({
    rows: [
      row({ name: 'R1', change24h: 9 }), row({ name: 'R2', change24h: 7 }), row({ name: 'R3', change24h: 5 }),
      row({ name: 'F1', change24h: -8 }), row({ name: 'F2', change24h: -2 }),
    ],
  }, null)
  assert.deepEqual(tapeItems(m).map((x) => x.name), ['R1', 'F1', 'R2', 'F2', 'R3'])
  assert.equal(tapeItems(m, { max: 3 }).length, 3)
})

test('the featured mover prefers one we can actually tell a story about', () => {
  const feed = { stories: [story({ id: 's', headline: 'Leo Marsh cast in sequel', people: ['Leo Marsh'] })] }
  const m = marketMovers({
    rows: [
      row({ name: 'Ava Lumen', change24h: 30 }), // bigger move, but we have nothing to say
      row({ name: 'Leo Marsh', change24h: 11 }),
      row({ name: 'Nina Park', change24h: -4 }),
    ],
  }, feed)
  assert.equal(biggestMover(m).name, 'Leo Marsh')
  // With no story anywhere, the biggest move is still worth showing.
  assert.equal(biggestMover(marketMovers({ rows: [row({ name: 'Ava Lumen', change24h: 30 }), row({ name: 'Nina Park', change24h: -4 })] }, null)).name, 'Ava Lumen')
  assert.equal(biggestMover(marketMovers({ rows: [] }, null)), null)
})

/* ---------------- the one-line reason a board row carries ---------------- */

test('a board row takes the headline, and a bare name when there is nothing to say', () => {
  const feed = { stories: [story({ id: 's1', headline: 'Leo Marsh cast in sequel', people: ['Leo Marsh'] })] }
  assert.equal(shortReason(reasonFor(row({ name: 'Leo Marsh' }), feed.stories)), 'Leo Marsh cast in sequel')
  // Nothing behind it is nothing — not a row captioned "no story yet", which
  // would fill a board with an apology repeated five times.
  assert.equal(shortReason(reasonFor(row({ name: 'Ava Lumen' }), feed.stories)), null)
})

test('coverage names the outlets when we have not published', () => {
  const r = reasonFor(row({ name: 'Nina Park', drivers: [{ domain: 'www.bbc.co.uk', url: 'https://bbc.co.uk/a' }, { domain: 'variety.com' }] }), [])
  assert.equal(r.kind, 'coverage')
  assert.equal(shortReason(r), 'Being covered by bbc.co.uk and variety.com')
  assert.equal(r.href, 'https://bbc.co.uk/a', 'the link goes to the article, so the claim is checkable')
})

test('a long headline is clipped at a word, not mid-syllable', () => {
  const long = shortReason({ kind: 'story', headline: 'Ava Lumen reunites with her estranged sister on the red carpet in Cannes' }, { max: 30 })
  assert.ok(long.endsWith('…'))
  assert.ok(long.length <= 31)
  assert.ok(!/\s…$/.test(long), 'no dangling space before the ellipsis')
  assert.ok(long.startsWith('Ava Lumen reunites with her'))
})

test('every mover on the board carries its own reason, not just the lead', () => {
  const feed = { stories: [story({ id: 's1', headline: 'Leo Marsh cast in sequel', people: ['Leo Marsh'] })] }
  const m = marketMovers({
    rows: [
      row({ name: 'Leo Marsh', change24h: 9 }),
      row({ name: 'Ava Lumen', change24h: 4, drivers: [{ domain: 'variety.com', url: 'https://variety.com/x' }] }),
      row({ name: 'Nina Park', change24h: -6 }),
    ],
  }, feed)
  assert.deepEqual(m.risers.map((r) => r.reason.kind), ['story', 'coverage'])
  assert.equal(m.fallers[0].reason.kind, 'none')
  for (const mover of [...m.risers, ...m.fallers]) assert.ok(mover.reason.text, 'a reason always says something')
})
