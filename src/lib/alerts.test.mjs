import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAlerts, unread, followedPeople, followedStrands, SHARP_MOVE, MAX_ALERTS } from './alerts.js'
import { prune, since, markSeen, firstVisit } from './noticestate.js'

const NOW = Date.parse('2026-09-18T20:00:00Z')
const HOUR = 3600_000
const at = (h) => new Date(NOW - h * HOUR).toISOString()

const story = (over = {}) => ({
  id: 's1', strand: 'celebrity', publishedAt: at(1),
  headline: 'Zendaya announces a world tour', caption: 'Forty dates.',
  people: ['Zendaya'], outlets: 12, ...over,
})

const feedOf = (stories) => ({ generatedAt: at(0.5), stories })

const marketOf = (rows) => ({ generatedAt: at(0.2), rows })

const row = (over = {}) => ({
  id: 'zendaya', slug: 'zendaya', displayName: 'Zendaya', gossipScore: 62.1,
  change24h: 18.4, change1h: 0.2, ...over,
})

/* ---------------- following somebody ---------------- */

test('a followed name in a new story is the first thing the bell says', () => {
  const alerts = buildAlerts({
    feed: feedOf([story()]),
    prefs: { follows: ['person:Zendaya'] },
    since: NOW - 6 * HOUR,
    now: NOW,
  })
  const a = alerts.find((x) => x.kind === 'person')
  assert.ok(a, JSON.stringify(alerts))
  assert.equal(a.title, 'Zendaya is in today’s stories')
  assert.equal(a.text, 'Zendaya announces a world tour')
  assert.equal(a.href, '/story/s1')
})

test('a name nobody follows is not an alert', () => {
  const alerts = buildAlerts({ feed: feedOf([story()]), prefs: { follows: [] }, since: NOW - 6 * HOUR, now: NOW })
  assert.equal(alerts.filter((a) => a.kind === 'person').length, 0)
})

test('accents and case do not stop a follow matching', () => {
  const alerts = buildAlerts({
    feed: feedOf([story({ people: ['Beyoncé Knowles'] })]),
    prefs: { follows: ['person:beyonce knowles'] },
    since: NOW - 6 * HOUR, now: NOW,
  })
  assert.equal(alerts.filter((a) => a.kind === 'person').length, 1)
})

/* ---------------- the market ---------------- */

test('a followed celebrity moving sharply is worth saying', () => {
  const alerts = buildAlerts({
    market: marketOf([row()]), prefs: { follows: ['person:Zendaya'] }, since: NOW - 6 * HOUR, now: NOW,
  })
  const a = alerts.find((x) => x.kind === 'market')
  assert.equal(a.title, 'Zendaya is up 18.4 today')
  assert.equal(a.href, '/market/zendaya')
  assert.equal(a.tone, 'up')
})

test('a small wobble is not news', () => {
  const alerts = buildAlerts({
    market: marketOf([row({ change24h: SHARP_MOVE - 0.1 })]),
    prefs: { follows: ['person:Zendaya'] }, since: NOW - 6 * HOUR, now: NOW,
  })
  assert.equal(alerts.filter((a) => a.kind === 'market').length, 0)
})

test('a fall says fall', () => {
  const alerts = buildAlerts({
    market: marketOf([row({ change24h: -9.4 })]),
    prefs: { follows: ['person:Zendaya'] }, since: NOW - 6 * HOUR, now: NOW,
  })
  const a = alerts.find((x) => x.kind === 'market')
  assert.match(a.title, /is down 9\.4 today/)
  assert.equal(a.tone, 'down')
})

test('the market alert is the same alert all day, however often it ticks', () => {
  const p = { follows: ['person:Zendaya'] }
  const one = buildAlerts({ market: marketOf([row()]), prefs: p, since: NOW - 6 * HOUR, now: NOW })
  const two = buildAlerts({ market: marketOf([row({ change24h: 19.9 })]), prefs: p, since: NOW - 6 * HOUR, now: NOW })
  assert.equal(one.find((a) => a.kind === 'market').id, two.find((a) => a.kind === 'market').id)
})

test('a market with no 24-hour history falls back to the last update', () => {
  const alerts = buildAlerts({
    market: marketOf([row({ change24h: null, change1h: -7.2 })]),
    prefs: { follows: ['person:Zendaya'] }, since: NOW - 6 * HOUR, now: NOW,
  })
  assert.match(alerts.find((a) => a.kind === 'market').title, /since the last update/)
})

/* ---------------- strands, and what is simply new ---------------- */

test('a followed strand counts only what is new', () => {
  const alerts = buildAlerts({
    feed: feedOf([story({ id: 'a', strand: 'health', people: [], publishedAt: at(1) }),
      story({ id: 'b', strand: 'health', people: [], publishedAt: at(30) })]),
    prefs: { follows: ['strand:health'] }, since: NOW - 6 * HOUR, now: NOW,
  })
  const a = alerts.find((x) => x.kind === 'strand')
  assert.equal(a.title, '1 new in Health')
  assert.equal(a.href, '/strand/health')
})

test('everybody is told what is new, follows or no follows', () => {
  const alerts = buildAlerts({
    feed: feedOf([story({ id: 'a', people: [] }), story({ id: 'b', people: [], publishedAt: at(2) })]),
    prefs: { follows: [] }, since: NOW - 6 * HOUR, now: NOW,
  })
  const a = alerts.find((x) => x.kind === 'feed')
  assert.equal(a.title, '2 new stories')
  assert.equal(a.href, '/')
})

test('one new story is a story, not stories', () => {
  const alerts = buildAlerts({ feed: feedOf([story({ people: [] })]), since: NOW - 6 * HOUR, now: NOW })
  assert.equal(alerts.find((a) => a.kind === 'feed').title, '1 new story')
})

test('a first visit is told nothing, because everything is new', () => {
  const alerts = buildAlerts({ feed: feedOf([story(), story({ id: 'b' })]), since: null, now: NOW })
  assert.equal(alerts.filter((a) => a.kind === 'feed').length, 0)
})

test('nothing published since last time means a quiet bell', () => {
  const alerts = buildAlerts({ feed: feedOf([story({ publishedAt: at(40) })]), since: NOW - 6 * HOUR, now: NOW })
  assert.deepEqual(alerts, [])
})

/* ---------------- the streak ---------------- */

/*
 * The hour is the reader's, the day is the quiz's (UTC, as Quiz.jsx writes
 * it). So the clocks below are built from local components and the day is
 * derived the way the app derives it — otherwise this passes in London and
 * fails in Auckland, which is the bug it is here to catch.
 */
const localAt = (hour) => new Date(2026, 8, 18, hour, 0, 0).getTime()
const quizDayBefore = (t) => new Date(t - 86400000).toISOString().slice(0, 10)

test('a streak that lapses at midnight is worth a nudge in the evening', () => {
  const evening = localAt(20)
  const alerts = buildAlerts({
    prefs: { follows: [], quizStreak: 5, lastQuizDay: quizDayBefore(evening) },
    since: evening - HOUR, now: evening,
  })
  const a = alerts.find((x) => x.kind === 'quiz')
  assert.ok(a, 'expected a streak nudge at 8pm')
  assert.equal(a.title, 'Your 5-day quiz streak ends at midnight')
  assert.equal(a.href, '/quiz')
})

test('the same streak is left alone in the morning', () => {
  const morning = localAt(9)
  const alerts = buildAlerts({
    prefs: { follows: [], quizStreak: 5, lastQuizDay: quizDayBefore(morning) },
    since: morning - HOUR, now: morning,
  })
  assert.equal(alerts.filter((a) => a.kind === 'quiz').length, 0)
})

test('somebody who already played today is not nagged', () => {
  const alerts = buildAlerts({
    prefs: { follows: [], quizStreak: 5, lastQuizDay: '2026-09-18' },
    since: NOW - HOUR, now: NOW,
  })
  assert.equal(alerts.filter((a) => a.kind === 'quiz').length, 0)
})

test('somebody with no streak is not told they are about to lose one', () => {
  const alerts = buildAlerts({
    prefs: { follows: [], quizStreak: 0, lastQuizDay: '2026-09-17' },
    since: NOW - HOUR, now: NOW,
  })
  assert.equal(alerts.filter((a) => a.kind === 'quiz').length, 0)
})

/* ---------------- shape ---------------- */

test('the list is capped and newest first', () => {
  const stories = Array.from({ length: 20 }, (_, i) => story({ id: `s${i}`, publishedAt: at(i * 0.1 + 0.1) }))
  const alerts = buildAlerts({
    feed: feedOf(stories), prefs: { follows: ['person:Zendaya'] }, since: NOW - 6 * HOUR, now: NOW,
  })
  assert.ok(alerts.length <= MAX_ALERTS, `${alerts.length}`)
  for (let i = 1; i < alerts.length; i++) assert.ok(alerts[i - 1].at >= alerts[i].at)
})

test('no ids repeat, so nothing is marked read twice', () => {
  const alerts = buildAlerts({
    feed: feedOf([story(), story({ id: 's2', publishedAt: at(2) })]),
    market: marketOf([row()]),
    prefs: { follows: ['person:Zendaya', 'strand:celebrity'] },
    since: NOW - 6 * HOUR, now: NOW,
  })
  assert.equal(new Set(alerts.map((a) => a.id)).size, alerts.length)
})

test('an empty everything is an empty list, not a crash', () => {
  assert.deepEqual(buildAlerts({}), [])
  assert.deepEqual(buildAlerts({ feed: { stories: [] }, market: { rows: [] }, prefs: {} }), [])
})

test('follows are read apart', () => {
  const prefs = { follows: ['person:Zendaya', 'strand:health', 'person:Dua Lipa'] }
  assert.deepEqual(followedPeople(prefs), ['Zendaya', 'Dua Lipa'])
  assert.deepEqual(followedStrands(prefs), ['health'])
})

/* ---------------- what has been seen ---------------- */

test('read alerts stop counting', () => {
  const alerts = buildAlerts({ feed: feedOf([story({ people: [] })]), since: NOW - 6 * HOUR, now: NOW })
  assert.equal(unread(alerts, { seen: {} }).length, alerts.length)
  assert.equal(unread(alerts, { seen: { [alerts[0].id]: NOW } }).length, alerts.length - 1)
})

test('the seen list forgets what is too old to come round again', () => {
  const state = { seen: { old: NOW - 30 * 86400000, recent: NOW - 86400000 } }
  assert.deepEqual(Object.keys(prune(state, NOW).seen), ['recent'])
})

test('the mark is the last time the bell was opened, and the first visit before that', () => {
  assert.equal(since({ seen: {}, lastOpenedAt: 5, firstSeenAt: 1 }), 5)
  assert.equal(since({ seen: {}, lastOpenedAt: null, firstSeenAt: 1 }), 1)
  assert.equal(since({ seen: {} }), null)
})

/* markSeen and firstVisit write to localStorage; under node that write is
   caught and the returned state is what matters. */
test('opening the bell marks everything and moves the mark', () => {
  const alerts = buildAlerts({ feed: feedOf([story({ people: [] })]), since: NOW - 6 * HOUR, now: NOW })
  const next = markSeen({ seen: {}, lastOpenedAt: null, firstSeenAt: 1 }, alerts, NOW)
  assert.equal(next.lastOpenedAt, NOW)
  assert.equal(unread(alerts, next).length, 0)
})

test('the first visit sets the mark once and never moves it again', () => {
  const first = firstVisit({ seen: {}, lastOpenedAt: null, firstSeenAt: null }, NOW)
  assert.equal(first.firstSeenAt, NOW)
  assert.equal(firstVisit(first, NOW + 9999).firstSeenAt, NOW)
})
