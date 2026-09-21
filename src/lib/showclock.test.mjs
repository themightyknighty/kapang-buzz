import { test } from 'node:test'
import assert from 'node:assert/strict'
import { showLength, positionAt, livePosition, firstUnseen, segmentSeen, joinAt, HANDOVER_SECONDS as H } from './showclock.js'

const seg = (type, dur, storyId) => ({
  type, dur, key: `${type}-${storyId || type}`,
  ...(storyId ? { story: { id: storyId } } : {}),
})

// A small running order with the shape of a real one: stories, and furniture
// that is not made of stories.
const SEGS = [
  seg('top', 60, 's1'),
  seg('story', 40, 's2'),
  seg('movers', 60),
  seg('story', 40, 's3'),
  seg('quiz', 45),
]
const TOTAL = 245 + 5 * H

/*
 * Seconds, summed in floating point. A handover is not a whole number of them
 * and never will be — it is three animation constants added up — so five of
 * them in a row land a few parts in 10^14 from where the arithmetic says.
 * Comparing to the nearest millisecond is what the assertion actually means.
 */
const close = (got, want, why) => assert.ok(Math.abs(got - want) < 1e-3, why || `${got} is not ${want}`)
const isAt = (got, want) => { assert.equal(got.idx, want.idx); close(got.into, want.into) }

/* ---------------- the length of the show ---------------- */

test('the show length counts the handovers, not just the segments', () => {
  close(showLength(SEGS), TOTAL)
  // Nearly six seconds a segment is a minute and a half over a 19-segment
  // loop. Ignoring it would drift the live position by that much every round.
  assert.ok(showLength(SEGS) - 245 > 25)
  assert.equal(showLength([]), 0)
  assert.equal(showLength(null), 0)
})

/* ---------------- where the channel is ---------------- */

test('the position walks the running order and wraps at the end', () => {
  isAt(positionAt(SEGS, 0), { idx: 0, into: 0 })
  isAt(positionAt(SEGS, 30), { idx: 0, into: 30 })
  isAt(positionAt(SEGS, 60 + H + 10), { idx: 1, into: 10 })
  // One full lap later, the same place.
  isAt(positionAt(SEGS, TOTAL + 30), { idx: 0, into: 30 })
  isAt(positionAt(SEGS, TOTAL * 3 + 30), { idx: 0, into: 30 })
})

test('landing inside a handover joins the next segment at its top', () => {
  // There is nothing to join half way through a wipe.
  const p = positionAt(SEGS, 60 + H / 2)
  assert.equal(p.idx, 0)
  assert.equal(p.into, 60, 'clamped to the end of the segment, not past it')
})

test('a negative offset still lands somewhere real', () => {
  const p = positionAt(SEGS, -30)
  assert.ok(p.idx >= 0 && p.idx < SEGS.length)
  assert.ok(p.into >= 0)
})

test('the live position is measured from the feed, not from when you arrived', () => {
  const epoch = Date.parse('2026-09-18T12:00:00Z')
  const a = livePosition(SEGS, { now: epoch + 90_000, epoch })
  const b = livePosition(SEGS, { now: epoch + 90_000, epoch: new Date(epoch).toISOString() })
  assert.deepEqual(a, b, 'a timestamp and a date string mean the same thing')
  // Two viewers opening the page at different moments see different points.
  const later = livePosition(SEGS, { now: epoch + 200_000, epoch })
  assert.notDeepEqual(a, later)
})

test('a missing epoch falls back to the top rather than to NaN', () => {
  assert.deepEqual(livePosition(SEGS, { epoch: undefined }), { idx: 0, into: 0 })
  assert.deepEqual(livePosition(SEGS, { epoch: 'not a date' }), { idx: 0, into: 0 })
})

/* ---------------- what counts as seen ---------------- */

test('only segments made of stories can be seen', () => {
  const seen = new Set(['s1', 's2', 's3'])
  assert.equal(segmentSeen(SEGS[0], seen), true)
  // The quiz and the market board are rebuilt from whatever is current;
  // treating them as watched would strand the viewer in an all-story show.
  assert.equal(segmentSeen(SEGS[2], seen), false)
  assert.equal(segmentSeen(SEGS[4], seen), false)
})

test('a multi-story segment counts only when the whole of it has been seen', () => {
  const blast = { type: 'factBlast', dur: 90, stories: [{ id: 'f1' }, { id: 'f2' }] }
  assert.equal(segmentSeen(blast, new Set(['f1'])), false)
  assert.equal(segmentSeen(blast, new Set(['f1', 'f2'])), true)
})

/* ---------------- being moved past what you have watched ---------------- */

test('the search runs forward and wraps around once', () => {
  assert.equal(firstUnseen(SEGS, new Set(['s1']), { from: 0 }), 1)
  assert.equal(firstUnseen(SEGS, new Set(['s1', 's2']), { from: 0 }), 2, 'furniture is never skipped')
  assert.equal(firstUnseen(SEGS, new Set(), { from: 3 }), 3)
})

test('nothing left unseen is reported as such, not as zero', () => {
  // Every story seen AND no furniture would mean a show with nothing new. The
  // caller needs to tell that apart from "start at the beginning".
  const stories = SEGS.filter((s) => s.story)
  assert.equal(firstUnseen(stories, new Set(['s1', 's2', 's3'])), null)
  assert.equal(firstUnseen([], new Set()), null)
})

/* ---------------- joining ---------------- */

const epoch = Date.parse('2026-09-18T12:00:00Z')
const at = (sec) => ({ now: epoch + sec * 1000, epoch })

test('a viewer who has seen nothing simply joins the channel where it is', () => {
  const j = joinAt(SEGS, new Set(), at(30))
  assert.equal(j.mode, 'live')
  assert.equal(j.idx, 0)
  assert.equal(j.into, 30, 'joined part way through, like any broadcast')
})

test('a viewer who has seen what is on air is moved to the first thing they have not', () => {
  // This is the whole complaint: back after lunch, same top story.
  const j = joinAt(SEGS, new Set(['s1']), at(30))
  assert.equal(j.mode, 'catchup')
  assert.equal(j.idx, 1)
  assert.equal(j.into, 0, 'and it starts at the top, not part way through')
})

test('a show that opens on furniture still skips the story behind it', () => {
  /*
   * The chart show opens on a title card, which carries no stories and
   * so can never have been watched. A join that only asked "have you
   * seen what is on air?" parked the returning viewer on the title and
   * then handed them the top story they watched this morning — the
   * exact complaint catch-up exists to answer.
   */
  const withTitle = [seg('open', 15), ...SEGS]
  const j = joinAt(withTitle, new Set(['s1']), at(5))
  assert.equal(j.mode, 'catchup')
  assert.equal(withTitle[j.idx].story.id, 's2')
})

test('furniture is not skipped when the story behind it is new', () => {
  const withTitle = [seg('open', 15), ...SEGS]
  const j = joinAt(withTitle, new Set(['s3']), at(5))
  assert.equal(j.mode, 'live')
  assert.equal(j.idx, 0, 'the title card still plays')
})

test('a viewer who has seen everything is not sent round in circles', () => {
  const stories = SEGS.filter((s) => s.story)
  const j = joinAt(stories, new Set(['s1', 's2', 's3']), at(30))
  assert.equal(j.mode, 'caught-up')
  assert.ok(Number.isFinite(j.idx), 'it still plays — it just says so')
})

test('joining twenty minutes apart lands in different places', () => {
  const seen = new Set()
  const first = joinAt(SEGS, seen, at(10))
  const second = joinAt(SEGS, seen, at(10 + 20 * 60))
  assert.notEqual(`${first.idx}:${Math.round(first.into)}`, `${second.idx}:${Math.round(second.into)}`)
})

test('an empty running order joins nothing rather than throwing', () => {
  assert.equal(joinAt([], new Set(), at(0)), null)
})
