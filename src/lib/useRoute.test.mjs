import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRoute, pathFor, pathFromHash, isInternalLink, ROUTES } from './useRoute.js'

test('the front page is the empty path', () => {
  assert.deepEqual(parseRoute('/'), { name: 'home', arg: null })
  assert.deepEqual(parseRoute(''), { name: 'home', arg: null })
})

test('a story path carries the id', () => {
  assert.deepEqual(parseRoute('/story/abc123'), { name: 'story', arg: 'abc123' })
})

test('query strings and fragments are not part of the route', () => {
  assert.deepEqual(parseRoute('/watch?seg=quiz&speed=10'), { name: 'watch', arg: null })
  assert.deepEqual(parseRoute('/market/zendaya?from=share'), { name: 'market', arg: 'zendaya' })
  assert.deepEqual(parseRoute('/quiz#top'), { name: 'quiz', arg: null })
})

test('an id with a slash or a space in it survives the round trip', () => {
  const id = 'a b/c'
  assert.equal(pathFor('story', id), '/story/a%20b%2Fc')
  assert.deepEqual(parseRoute(pathFor('story', id)), { name: 'story', arg: id })
})

test('a half-escaped path is read literally rather than thrown over', () => {
  // Somebody's chat app mangles a link now and then; a broken escape should
  // land on a "no such story" screen, not a white page.
  assert.deepEqual(parseRoute('/story/100%'), { name: 'story', arg: '100%' })
})

test('every route name round-trips through pathFor', () => {
  for (const name of ROUTES) {
    if (name === 'home') { assert.equal(pathFor(name), '/'); continue }
    assert.equal(parseRoute(pathFor(name)).name, name)
  }
})

/* ---------------- the links people already have ---------------- */

test('an old fragment becomes the path it meant', () => {
  assert.equal(pathFromHash('#/story/abc'), '/story/abc')
  assert.equal(pathFromHash('#/market/zendaya'), '/market/zendaya')
  assert.equal(pathFromHash('#/'), '/')
})

test('a fragment keeps its query string, because the show reads those', () => {
  assert.equal(pathFromHash('#/watch?seg=headlines&speed=6'), '/watch?seg=headlines&speed=6')
})

test('an in-page anchor is not a route', () => {
  assert.equal(pathFromHash('#top'), null)
  assert.equal(pathFromHash(''), null)
  assert.equal(pathFromHash(null), null)
})

/* ---------------- which clicks we take over ---------------- */

const ORIGIN = 'https://gossip.example'

const anchor = (href, attrs = {}) => ({
  target: attrs.target || '',
  href: new URL(href, ORIGIN).href,
  hasAttribute: (n) => n in attrs,
  getAttribute: (n) => (n === 'href' ? href : attrs[n] ?? null),
})

test('our own routes are handled in the page', () => {
  for (const href of ['/', '/story/abc', '/market', '/market/zendaya', '/watch', '/quiz', '/strand/health']) {
    assert.equal(isInternalLink(anchor(href), { origin: ORIGIN }), true, href)
  }
})

test('a source link, a new tab and a download are left to the browser', () => {
  assert.equal(isInternalLink(anchor('https://apnews.com/x'), { origin: ORIGIN }), false)
  assert.equal(isInternalLink(anchor('/story/abc', { target: '_blank' }), { origin: ORIGIN }), false)
  assert.equal(isInternalLink(anchor('/report.csv', { download: '' }), { origin: ORIGIN }), false)
  assert.equal(isInternalLink(anchor('/story/abc', { rel: 'external' }), { origin: ORIGIN }), false)
})

test('an in-page anchor and an api path are not ours', () => {
  assert.equal(isInternalLink(anchor('#sources'), { origin: ORIGIN }), false)
  assert.equal(isInternalLink(anchor('/api/feed'), { origin: ORIGIN }), false)
  assert.equal(isInternalLink(anchor('/og/story/abc.png'), { origin: ORIGIN }), false)
})

test('nothing to click is not a link', () => {
  assert.equal(isInternalLink(null, { origin: ORIGIN }), false)
})
