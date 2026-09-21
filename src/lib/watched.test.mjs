import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadWatched, saveWatched, markWatched, clearWatched, seenSet } from './watched.js'

/** A localStorage that behaves like the real one, including throwing. */
const fakeStorage = () => {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  }
}

beforeEach(() => { globalThis.localStorage = fakeStorage() })

const FEED = '2026-09-18T12:00:00Z'

test('nothing watched yet reads as empty, not as broken', () => {
  const w = loadWatched(FEED)
  assert.deepEqual(w.ids, [])
  assert.equal(w.feed, FEED)
  assert.equal(seenSet(w).size, 0)
})

test('what was watched survives a reload', () => {
  saveWatched(markWatched(loadWatched(FEED), ['s1', 's2'], { feedAt: FEED }))
  assert.deepEqual(loadWatched(FEED).ids, ['s1', 's2'])
  assert.ok(seenSet(loadWatched(FEED)).has('s2'))
})

test('a new feed starts the viewer over', () => {
  // The feed refreshes three times a day. Holding yesterday's list would only
  // stand between the viewer and what is new.
  saveWatched(markWatched(loadWatched(FEED), ['s1'], { feedAt: FEED }))
  assert.deepEqual(loadWatched('2026-09-18T17:00:00Z').ids, [])
})

test('the same story is never recorded twice', () => {
  let w = markWatched(loadWatched(FEED), ['s1'], { feedAt: FEED })
  const again = markWatched(w, ['s1'], { feedAt: FEED })
  assert.equal(again, w, 'unchanged, so the caller can skip the write and the re-render')
  w = markWatched(w, ['s1', 's2'], { feedAt: FEED })
  assert.deepEqual(w.ids, ['s1', 's2'])
})

test('nothing to record changes nothing', () => {
  const w = loadWatched(FEED)
  assert.equal(markWatched(w, []), w)
  assert.equal(markWatched(w, [null, undefined, '']), w)
})

test('the list cannot grow without bound', () => {
  let w = loadWatched(FEED)
  w = markWatched(w, Array.from({ length: 900 }, (_, i) => `s${i}`), { feedAt: FEED })
  assert.equal(w.ids.length, 400)
  assert.equal(w.ids.at(-1), 's899', 'the most recent are the ones kept')
})

test('clearing forgets everything', () => {
  saveWatched(markWatched(loadWatched(FEED), ['s1'], { feedAt: FEED }))
  clearWatched(FEED)
  assert.deepEqual(loadWatched(FEED).ids, [])
})

/* ---------------- storage that will not cooperate ---------------- */

test('a browser that refuses storage still plays the channel', () => {
  // Private windows and blocked site data throw on access. A show that will
  // not start because it could not remember what you watched is a worse fault
  // than one that forgets.
  globalThis.localStorage = {
    getItem() { throw new Error('denied') },
    setItem() { throw new Error('denied') },
    removeItem() { throw new Error('denied') },
  }
  assert.deepEqual(loadWatched(FEED).ids, [])
  assert.doesNotThrow(() => saveWatched({ feed: FEED, ids: ['s1'] }))
  assert.doesNotThrow(() => clearWatched(FEED))
})

test('rubbish in storage is ignored rather than trusted', () => {
  globalThis.localStorage = fakeStorage()
  globalThis.localStorage.setItem('gossip-genie-watched', '{not json')
  assert.deepEqual(loadWatched(FEED).ids, [])
  globalThis.localStorage.setItem('gossip-genie-watched', '{"feed":"x","ids":"nope"}')
  assert.deepEqual(loadWatched(FEED).ids, [])
})
