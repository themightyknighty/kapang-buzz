import test from 'node:test'
import assert from 'node:assert/strict'
import { NAV, sectionOf } from './nav.js'
import { ROUTES, parseRoute, pathFor } from './useRoute.js'

/*
 * A nav link that lands on a route the app does not render falls through to
 * the home screen, which looks like the click did nothing. These are cheap
 * assertions against the one failure mode a menu has.
 */

test('every destination in the menu is a route the app renders', () => {
  for (const item of NAV) {
    const { name } = parseRoute(item.href)
    const route = item.href === '/' ? 'home' : name
    assert.ok(ROUTES.includes(route), `${item.label} points at /${name}, which is not a route`)
  }
})

test('a destination and its section agree', () => {
  for (const item of NAV) {
    assert.equal(sectionOf(parseRoute(item.href).name === '' ? 'home' : parseRoute(item.href).name), item.section,
      `${item.label} marks itself as ${item.section} but sits at ${item.href}`)
  }
})

test('every route belongs to a section, so something is always marked', () => {
  // Otherwise a reader lands somewhere the menu says nothing about, which is
  // how "where am I" becomes "how do I get back".
  for (const route of ROUTES) {
    assert.ok(sectionOf(route), `nothing in the menu owns /${route}`)
  }
})

test('the menu covers the sections and holds its order', () => {
  assert.deepEqual(NAV.map((i) => i.section), ['home', 'chart', 'market', 'exchange', 'quiz', 'watch'])
  assert.deepEqual(NAV.map((i) => i.href), ['/', '/chart', '/market', '/exchange', '/quiz', '/watch'])
  // The same list builds the header and the slim bar, so this is the order on
  // every surface, not just the front page.
  assert.equal(pathFor('chart'), '/chart')
})
