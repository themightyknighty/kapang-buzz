import { test } from 'node:test'
import assert from 'node:assert/strict'
import { framing, coverWindow, subjectOf, DEFAULT_FOCUS } from './framing.js'

const WIDE = { width: 1600, height: 900 }   // ordinary press photography
const TALL = { width: 800, height: 1200 }   // a portrait
const V916 = { width: 1080, height: 1920 }  // the vertical show
const STORY = { width: 900, height: 560 }   // the story box inside it
const W169 = { width: 1920, height: 1080 }  // the wide show

/* ---------------- how much survives a crop ---------------- */

test('a wide photograph in a vertical frame keeps only its middle third', () => {
  const w = coverWindow(WIDE, V916)
  assert.ok(Math.abs(w.w * w.h - 0.316) < 0.01, `kept ${w.w * w.h}`)
  assert.equal(w.h, 1, 'the full height shows; it is the sides that are lost')
})

test('a photograph in a frame of its own shape loses nothing', () => {
  const w = coverWindow(WIDE, W169)
  assert.ok(Math.abs(w.w * w.h - 1) < 0.001)
})

/* ---------------- the subject decides the crop ---------------- */

test('the window moves onto a subject sitting off to one side', () => {
  // The single figure at 78% across is exactly the case that reached the
  // viewer as an empty blue wall.
  const f = framing(WIDE, V916, { subject: { x: 0.68, y: 0.14, w: 0.2, h: 0.5 } })
  assert.equal(f.mode, 'cover')
  const [x] = f.position.split(' ')
  assert.ok(parseFloat(x) > 80, `expected the window near the right, got ${f.position}`)
})

test('a subject too wide for the frame is shown whole, not cut in half', () => {
  // Three people spread across a wide frame cannot all survive a 9:16 crop.
  // Letterboxing is the right answer; choosing one of them is not.
  const f = framing(WIDE, V916, { subject: { x: 0.1, y: 0.2, w: 0.8, h: 0.5 } })
  assert.equal(f.mode, 'fit')
  assert.equal(f.kept, 1)
  assert.match(f.reason, /wider than the frame/)
})

test('the window never slides off the edge of the picture', () => {
  // A subject hard against the right edge: the window must stop at the edge
  // rather than positioning past it and leaving a strip of nothing.
  // Only the horizontal axis is cropped here, so only it should move.
  const f = framing(WIDE, V916, { subject: { x: 0.94, y: 0.0, w: 0.06, h: 0.3 } })
  assert.equal(f.position, '100% 50%')
  const g = framing(WIDE, V916, { subject: { x: 0, y: 0, w: 0.06, h: 0.3 } })
  assert.equal(g.position, '0% 50%')
  // ...and a tall picture in a wide frame is the same story on the other axis.
  const h = framing(TALL, W169, { subject: { x: 0.2, y: 0.9, w: 0.5, h: 0.1 } })
  assert.equal(h.position, '50% 100%')
})

test('an axis that is not cropped is left alone', () => {
  // A wide photo in a tall frame loses width, not height, so the vertical
  // position is irrelevant and should not wander.
  const f = framing(WIDE, V916, { subject: { x: 0.4, y: 0.8, w: 0.2, h: 0.2 } })
  assert.equal(f.position.split(' ')[1], '50%')
})

/* ---------------- when nobody has told us where the subject is ---------------- */

test('an unplaced picture is letterboxed rather than reduced to a third of itself', () => {
  const f = framing(WIDE, V916)
  assert.equal(f.mode, 'fit', 'this is the fix for every picture already published')
  assert.match(f.reason, /discard 68%/)
})

test('a trim is still a crop', () => {
  // 900x560 against 16:9 keeps ~90%. Letterboxing that would put pointless
  // bars around a picture that is very nearly the right shape already.
  const f = framing(WIDE, STORY)
  assert.equal(f.mode, 'cover')
  assert.ok(f.kept > 0.85)
})

test('the default focal point sits above the middle, where faces are', () => {
  assert.equal(framing(WIDE, STORY).position, `50% ${DEFAULT_FOCUS.y * 100}%`)
  assert.ok(DEFAULT_FOCUS.y < 0.5)
})

test('a portrait fills the vertical frame, because that is its shape', () => {
  const f = framing(TALL, V916)
  assert.equal(f.mode, 'cover')
  assert.ok(f.kept > 0.8, `kept ${f.kept}`)
})

test('a picture of unknown size is filled from the default point, not letterboxed', () => {
  // Older stories carry no dimensions. Bars around everything would be a
  // worse regression than the crop this is fixing.
  const f = framing({ width: null, height: null }, V916)
  assert.equal(f.mode, 'cover')
  assert.equal(f.kept, 1)
})

/* ---------------- what counts as a subject box ---------------- */

test('a malformed or impossible box is ignored rather than trusted', () => {
  const bad = [
    { x: 0.5, y: 0.5, w: 0.8, h: 0.2 },   // runs off the right edge
    { x: 0.1, y: 0.1, w: 0, h: 0.2 },     // no width
    { x: -0.1, y: 0.1, w: 0.2, h: 0.2 },  // negative origin
    { x: 'a', y: 0.1, w: 0.2, h: 0.2 },   // not a number
  ]
  for (const b of bad) {
    assert.equal(subjectOf({ review: { subject: b } }), null, JSON.stringify(b))
    // and the picture still gets a sane answer from the fallback
    assert.equal(framing(WIDE, V916, { subject: b }).mode, 'fit')
  }
  assert.equal(subjectOf({ review: {} }), null)
  assert.equal(subjectOf(null), null)
  assert.deepEqual(subjectOf({ review: { subject: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 } } }), { x: 0.1, y: 0.1, w: 0.3, h: 0.3 })
})
