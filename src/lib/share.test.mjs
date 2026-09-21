import test from 'node:test'
import assert from 'node:assert/strict'
import { shareTargets, absolute, canNativeShare, storyShare, celebrityShare, marketShare, TARGETS } from './share.js'

const ORIGIN = 'https://gossip.example'

test('a path becomes an address somebody can paste', () => {
  assert.equal(absolute('/story/abc', ORIGIN), 'https://gossip.example/story/abc')
  assert.equal(absolute('story/abc', ORIGIN), 'https://gossip.example/story/abc')
  assert.equal(absolute('/story/abc', 'https://gossip.example/'), 'https://gossip.example/story/abc')
})

test('an address that is already absolute is left alone', () => {
  assert.equal(absolute('https://elsewhere.test/x', ORIGIN), 'https://elsewhere.test/x')
})

test('every target gets the real link, escaped', () => {
  const url = `${ORIGIN}/story/abc`
  const links = shareTargets({ url, title: 'Elk & car', text: 'A caption' })
  assert.equal(links.length, TARGETS.length)
  for (const t of links) {
    assert.ok(t.href.length > 10, t.key)
    // The raw URL must never appear unescaped in a query string, or the
    // target truncates the link at the first ampersand.
    assert.ok(!t.href.includes(url) || t.key === 'whatsapp' || t.key === 'email', t.key)
  }
  const x = links.find((t) => t.key === 'x')
  assert.match(x.href, /text=Elk%20%26%20car/)
  assert.match(x.href, /url=https%3A%2F%2Fgossip\.example%2Fstory%2Fabc/)
})

test('WhatsApp gets one field with the headline and the link in it', () => {
  const [wa] = shareTargets({ url: `${ORIGIN}/story/abc`, title: 'Elk jumps on a car' })
  assert.equal(wa.key, 'whatsapp')
  assert.equal(
    wa.href,
    'https://wa.me/?text=Elk%20jumps%20on%20a%20car%20https%3A%2F%2Fgossip.example%2Fstory%2Fabc',
  )
})

test('Facebook is handed the page and nothing else, because that is all it reads', () => {
  const fb = shareTargets({ url: `${ORIGIN}/market/zendaya`, title: 'ignored' }).find((t) => t.key === 'facebook')
  assert.equal(fb.href, 'https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fgossip.example%2Fmarket%2Fzendaya')
})

/* ---------------- what each thing says when it is shared ---------------- */

test('a story shares as its headline', () => {
  const s = storyShare({ id: 'a b', headline: 'Elk jumps on a car', caption: 'Rangers waited.' })
  assert.deepEqual(s, { title: 'Elk jumps on a car', text: 'Rangers waited.', path: '/story/a%20b' })
})

test('a celebrity shares with the score and which way it went', () => {
  const s = celebrityShare({ displayName: 'Zendaya', slug: 'zendaya', gossipScore: 62.1 }, { value: 18.4, label: 'today' })
  assert.match(s.title, /^Zendaya on the Gossip Genie Celebrity Market$/)
  assert.equal(s.text, 'Gossip Score 62.1, up 18.4 today')
  assert.equal(s.path, '/market/zendaya')
})

test('a celebrity who has not moved does not claim to have moved', () => {
  const s = celebrityShare({ displayName: 'Dua Lipa', slug: 'dua-lipa', gossipScore: 55 }, { value: 0, label: 'today' })
  assert.equal(s.text, 'Gossip Score 55.0')
})

test('a celebrity with no figures at all still shares', () => {
  const s = celebrityShare({ displayName: 'Nobody', slug: 'nobody' }, null)
  assert.equal(s.text, '')
  assert.equal(s.path, '/market/nobody')
})

test('the board shares as whoever is moving most', () => {
  const s = marketShare({ risers: [{ name: 'Zendaya', moveText: '+18.4 pts', reason: { headline: 'A world tour' } }] })
  assert.match(s.title, /^Zendaya is the biggest riser/)
  assert.equal(s.text, 'Zendaya +18.4 pts — A world tour')
  assert.equal(s.path, '/market')
})

test('an empty board shares as the board', () => {
  const s = marketShare({ risers: [], fallers: [] })
  assert.match(s.title, /Who's rising/)
  assert.equal(s.text, '')
})

/* ---------------- the share sheet ---------------- */

test('the operating system sheet is used where a finger is', () => {
  assert.equal(canNativeShare(null), false)
  assert.equal(canNativeShare({}), false)
  // No matchMedia (older browser, or a test): having `share` at all is enough.
  assert.equal(canNativeShare({ share: () => {} }), true)
})
