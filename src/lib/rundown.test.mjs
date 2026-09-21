import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildRundown, orderStories, totalSeconds, rotate,
  freshStories, storyIdsOf, COUNTDOWN, SHOW,
} from './rundown.js'

const now = Date.parse('2026-09-16T20:00:00Z')
const mk = (i, strand, extra = {}) => ({
  id: `s${i}`, strand, publishedAt: new Date(now - i * 600000).toISOString(), outlets: 2,
  headline: `h${i}`, keyFacts: ['a', 'b', 'c'], quiz: { statement: 'x', answer: true }, ...extra,
})
const strands = ['celebrity', 'celebrity', 'health', 'facts', 'bizarre']
const day = Array.from({ length: 30 }, (_, i) => mk(i, strands[i % 5]))

/** A chart edition, in the shape the market publishes. */
const chart = (n = 12) => ({
  id: '2026-W38',
  label: '14–20 September 2026',
  live: true,
  entries: Array.from({ length: n }, (_, i) => ({
    rank: i + 1,
    id: `c${i}`,
    slug: `c${i}`,
    displayName: `Name ${i + 1}`,
    score: 90 - i * 3,
    status: i === 4 ? 'new' : 'up',
    move: i === 4 ? null : 2,
    lastWeek: i === 4 ? null : i + 3,
    peak: i + 1,
    weeksOn: 3,
    reason: { kind: 'none', headline: null, text: '', href: null },
  })),
  summary: { charted: n, numberOne: { displayName: 'Name 1' } },
})

/* ------------------------------------------------------------------ *
 * The story order
 * ------------------------------------------------------------------ */

test('never two celebrity stories back to back while others remain', () => {
  const o = orderStories(day, 20)
  for (let i = 1; i < o.length; i++) {
    const remainingOther = o.slice(i).some((s) => s.strand !== 'celebrity')
    if (remainingOther) assert.ok(!(o[i].strand === 'celebrity' && o[i - 1].strand === 'celebrity'), `at ${i}`)
  }
})

test('mornings open with a non-celebrity story, evenings with celebrity', () => {
  assert.notEqual(orderStories(day, 8)[0].strand, 'celebrity')
  assert.equal(orderStories(day, 19)[0].strand, 'celebrity')
})

test('the story block moves along each loop, so the channel is not nine stories all day', () => {
  const list = ['a', 'b', 'c', 'd']
  assert.deepEqual(rotate(list, 0), ['a', 'b', 'c', 'd'])
  assert.deepEqual(rotate(list, 1), ['b', 'c', 'd', 'a'])
  assert.deepEqual(rotate(list, 5), ['b', 'c', 'd', 'a'], 'wraps')
  assert.deepEqual(rotate([], 3), [])
})

test('two consecutive half hours do not show the same stories first', () => {
  const half = 1800000
  const a = buildRundown({ stories: day }, { now, hour: 19, chart: chart() })
  const b = buildRundown({ stories: day }, { now: now + half, hour: 19, chart: chart() })
  const first = (segs) => segs.find((s) => s.type === 'story')?.story?.id
  assert.notEqual(first(a), first(b))
})

/* ------------------------------------------------------------------ *
 * The chart show
 * ------------------------------------------------------------------ */

test('the show opens on the title, counts down and ends on the recap', () => {
  const segs = buildRundown({ stories: day }, { now, hour: 19, chart: chart() })
  const types = segs.map((s) => s.type)
  assert.equal(types[0], 'open')
  assert.equal(types.at(-1), 'chartRecap')
  assert.equal(types.filter((t) => t === 'numberOne').length, 1)
  assert.equal(new Set(segs.map((s) => s.key)).size, segs.length, 'keys are unique')
})

test('it counts DOWN, ten to one, and the number one is last of them', () => {
  const segs = buildRundown({ stories: day }, { now, hour: 19, chart: chart() })
  const places = segs.filter((s) => s.type === 'chartPos').map((s) => s.place)
  assert.deepEqual(places, [10, 9, 8, 7, 6, 5, 4, 3, 2])

  const ranks = segs.filter((s) => s.type === 'chartPos').map((s) => s.entry.rank)
  assert.deepEqual(ranks, places, 'the entry matches the place announced')

  const one = segs.findIndex((s) => s.type === 'numberOne')
  const lastPos = segs.map((s) => s.type).lastIndexOf('chartPos')
  assert.ok(one > lastPos, 'number one comes after every other position')
  assert.equal(segs[one].entry.rank, 1)
})

test('the positions are broken up — never two in a row', () => {
  const segs = buildRundown({ stories: day }, { now, hour: 19, chart: chart() })
  const isChart = (s) => s.type === 'chartPos' || s.type === 'numberOne'
  for (let i = 1; i < segs.length; i++) {
    assert.ok(!(isChart(segs[i]) && isChart(segs[i - 1])), `two positions back to back at ${i}`)
  }
})

test('the breaks all run, spread through the countdown', () => {
  const feed = {
    stories: day,
    quiz: { questions: [{ id: 'q0', storyId: 's2', question: 'Which?', options: ['a', 'b', 'c', 'd'], answer: 1, explanation: 'x' }] },
  }
  const segs = buildRundown(feed, { now, hour: 19, chart: chart() })
  const types = segs.map((s) => s.type)
  for (const t of ['top', 'story', 'factBlast', 'healthMinute', 'quiz', 'weird', 'answer']) {
    assert.ok(types.includes(t), `${t} is missing`)
  }
  // ...and none of them twice.
  for (const t of ['factBlast', 'healthMinute', 'quiz', 'weird', 'answer']) {
    assert.equal(types.filter((x) => x === t).length, 1, `${t} ran twice`)
  }
})

test('the quiz is asked before it is answered, with something in between', () => {
  const feed = {
    stories: day,
    quiz: { questions: [{ id: 'q0', storyId: 's2', question: 'Which?', options: ['a', 'b', 'c', 'd'], answer: 1, explanation: 'x' }] },
  }
  const types = buildRundown(feed, { now, hour: 19, chart: chart() }).map((s) => s.type)
  const q = types.indexOf('quiz')
  const a = types.indexOf('answer')
  assert.ok(q > 0 && a > q + 1, `quiz at ${q}, answer at ${a}`)
})

test('no question asked, no answer revealed', () => {
  // The quiz falls back to a story's true-or-false, which has no reveal of
  // its own — an answer segment there would be a non sequitur.
  const segs = buildRundown({ stories: day }, { now, hour: 19, chart: chart() })
  const types = segs.map((s) => s.type)
  assert.ok(types.includes('quiz'))
  assert.ok(!types.includes('answer'))
})

test('a show runs somewhere between a quarter of an hour and half an hour', () => {
  const segs = buildRundown({ stories: day }, { now, hour: 19, chart: chart() })
  const mins = totalSeconds(segs) / 60
  assert.ok(mins >= 14 && mins <= 30, `${mins} minutes`)
})

test('a chart with only three names still counts down the names it has', () => {
  const segs = buildRundown({ stories: day }, { now, hour: 19, chart: chart(3) })
  const places = segs.filter((s) => s.type === 'chartPos').map((s) => s.place)
  assert.deepEqual(places, [3, 2])
  assert.equal(segs.filter((s) => s.type === 'numberOne').length, 1)
})

test('every position carries the chart it came from, so the frame can say which week', () => {
  const segs = buildRundown({ stories: day }, { now, hour: 19, chart: chart() })
  for (const s of segs.filter((x) => x.type === 'chartPos' || x.type === 'numberOne' || x.type === 'chartRecap')) {
    assert.equal(s.chart.id, '2026-W38')
  }
})

test('the countdown never runs longer than the chart it is counting', () => {
  assert.equal(SHOW.filter((b) => typeof b === 'number').length, COUNTDOWN)
  assert.deepEqual(
    SHOW.filter((b) => typeof b === 'number'),
    Array.from({ length: COUNTDOWN }, (_, i) => COUNTDOWN - i),
  )
})

/* ------------------------------------------------------------------ *
 * No chart
 * ------------------------------------------------------------------ */

test('before the first chart exists the channel still runs, as news', () => {
  const segs = buildRundown({ stories: day }, { now, hour: 19 })
  const types = segs.map((s) => s.type)
  assert.equal(types[0], 'top')
  assert.ok(!types.includes('open') && !types.includes('chartPos') && !types.includes('numberOne'))
  assert.ok(types.includes('story') && types.includes('factBlast') && types.includes('healthMinute'))
  assert.ok(totalSeconds(segs) > 600, 'and it is a real show, not a stub')
})

test('a chart too thin to count down falls back rather than showing two names', () => {
  const types = buildRundown({ stories: day }, { now, hour: 19, chart: chart(2) }).map((s) => s.type)
  assert.ok(!types.includes('chartPos'))
  assert.equal(types[0], 'top')
})

test('a thin feed drops what it cannot fill instead of showing it empty', () => {
  const segs = buildRundown({ stories: [mk(1, 'celebrity'), mk(2, 'celebrity')] }, { now, hour: 19, chart: chart() })
  const types = segs.map((s) => s.type)
  assert.ok(!types.includes('factBlast') && !types.includes('healthMinute') && !types.includes('weird'))
  assert.equal(types[0], 'open')
  // The countdown survives a thin feed, because it does not come from the feed.
  assert.ok(types.includes('numberOne'))
  assert.deepEqual(buildRundown({ stories: [] }), [])
})

test('the presenter, when there is one, opens ahead of the title', () => {
  const feed = { stories: day, bulletin: { videoUrl: 'https://x.test/a.mp4', durationSeconds: 42 } }
  const segs = buildRundown(feed, { now, hour: 19, chart: chart() })
  assert.equal(segs[0].type, 'headlines')
  assert.equal(segs[0].dur, 42)
  assert.equal(segs[1].type, 'open')
})

/* ------------------------------------------------------------------ *
 * Just in
 * ------------------------------------------------------------------ */

test('stories the show had no room for are not breaking news', () => {
  const feed = { stories: Array.from({ length: 55 }, (_, i) => mk(i, strands[i % 5])) }
  const baseline = storyIdsOf(feed)
  assert.equal(baseline.size, 55)

  const segs = buildRundown(feed, { now, hour: 19, chart: chart() })
  const queued = new Set(segs.flatMap((s) => [s.story?.id, ...(s.stories || []).map((x) => x.id)]).filter(Boolean))
  assert.ok(queued.size < 55, 'the show is a subset of the feed, which is the whole point')
  assert.deepEqual(freshStories(feed, baseline, { queued }), [])
})

test('a story that lands mid-show does jump the queue, once', () => {
  const feed = { stories: Array.from({ length: 30 }, (_, i) => mk(i, strands[i % 5])) }
  const baseline = storyIdsOf(feed)

  const later = { ...mk(99, 'celebrity'), id: 'breaking' }
  const withNew = { stories: [later, ...feed.stories] }
  const fresh = freshStories(withNew, baseline, { queued: new Set() })
  assert.deepEqual(fresh.map((s) => s.id), ['breaking'])

  for (const s of fresh) baseline.add(s.id)
  assert.deepEqual(freshStories(withNew, baseline, { queued: new Set() }), [])
})

test('at most four stories jump the queue at a time', () => {
  const baseline = storyIdsOf({ stories: [mk(0, 'facts')] })
  const feed = { stories: [mk(0, 'facts'), ...Array.from({ length: 9 }, (_, i) => ({ ...mk(i + 1, 'celebrity'), id: `n${i}` }))] }
  assert.equal(freshStories(feed, baseline).length, 4)
})

test('before a running order exists, nothing is treated as breaking', () => {
  assert.deepEqual(freshStories({ stories: [mk(1, 'facts')] }, new Set()), [])
  assert.deepEqual(freshStories({ stories: [mk(1, 'facts')] }, null), [])
})
