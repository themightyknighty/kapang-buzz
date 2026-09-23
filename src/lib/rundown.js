/**
 * The Watch channel's running order — a chart show.
 *
 * It used to be rolling news: a top story, twenty-four more at forty seconds
 * each, and a handful of breaks dropped in at fixed fractions of the way
 * through. That had no shape. A viewer joining at any point saw the same thing
 * they would see at any other point, there was nothing to stay for, and the
 * one asset nobody else has — the Genie 100 — was not on the channel at all.
 *
 * So the chart is the spine. The half hour opens on the title, counts down
 * from ten to one with stories and breaks between the positions, gives the
 * number one the climax, recaps and loops. That is a format: it has an
 * opening, a build, an ending, and a reason to still be watching in twenty
 * minutes' time.
 *
 * Pure. Give it a feed, a chart and a time; get back an ordered list of
 * segments with durations. The player walks the list and knows nothing about
 * why it is in that order.
 *
 * When there is no chart — before the first market run, or if the store is
 * unreachable — it falls back to the old news shape rather than showing an
 * empty countdown. A channel with no chart is still a channel.
 */

import { mixStories, DEFAULT_MIX } from './mix.js'

export const DUR = {
  open: 15,
  top: 60,
  story: 40,
  /** One chart position: the rank, the face, the number and why it moved. */
  chartPos: 26,
  /** The climax. Long enough to land, short enough that the loop keeps moving. */
  numberOne: 50,
  chartRecap: 25,
  comingUp: 30,
  factBlast: 90,
  healthMinute: 60,
  weird: 90,
  quiz: 45,
  answer: 30,
  // The presenter's slot is however long her clip runs; this is only the
  // fallback for a bulletin whose length we were not told.
  headlines: 35,
}

/** How many names the show counts down. Ten is a countdown; twenty is a list. */
export const COUNTDOWN = 10
export const STORY_BLOCK = 24
/** Each Fact Blast card stays up long enough to read the headline and the line under it. */
export const FACT_CARD_SECONDS = 22

/**
 * The shape of the show, as data.
 *
 * A number is a chart position; a string is an interstitial. Written out in
 * full because a running order is something a person should be able to read
 * and argue with, not something derived from three constants and a modulo.
 *
 * Beats with no material are dropped rather than shown empty, so a thin feed
 * gives a shorter show rather than a broken one.
 */
export const SHOW = [
  10, 'story',
  9, 'story', 'factBlast',
  8, 'story',
  7, 'healthMinute',
  6, 'story', 'story',
  5, 'quiz',
  4, 'story',
  3, 'weird',
  2, 'story', 'answer',
  1,
]

const within = (s, hours, now) => now - Date.parse(s.publishedAt) <= hours * 3600000

/**
 * Interleave so two celebrity stories never run back to back where avoidable,
 * and the day part sets the lean: mornings lead with Health and Facts,
 * evenings with Celebrity.
 */
export function orderStories(stories, hour) {
  const morning = hour >= 5 && hour < 12
  const celeb = stories.filter((s) => s.strand === 'celebrity')
  const other = stories.filter((s) => s.strand !== 'celebrity')
  const out = []
  while (celeb.length || other.length) {
    const last = out.at(-1)
    const wantCeleb = out.length === 0 ? !morning : last.strand !== 'celebrity'
    const from = wantCeleb ? (celeb.length ? celeb : other) : (other.length ? other : celeb)
    out.push(from.shift())
  }
  return out
}

/**
 * Start the story block somewhere different each loop.
 *
 * A chart show only has room for about nine stories, and the feed holds
 * thirty. Without this the channel would show the same nine all day while
 * twenty-one sat unused — and anybody who looked twice would see exactly the
 * same programme. The offset walks the whole feed across the day.
 */
export const rotate = (list, by) => (list.length ? [...list.slice(by % list.length), ...list.slice(0, by % list.length)] : list)

/**
 * @param {object} feed
 * @param {object} opts
 * @param {object} [opts.chart]  a Genie 100 edition — live or published
 */
export function buildRundown(feed, { now = Date.now(), hour = new Date(now).getHours(), durations = {}, chart = null, mix = DEFAULT_MIX } = {}) {
  const D = { ...DUR, ...durations }
  const all = (feed?.stories || []).slice().sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
  if (!all.length) return []

  const recent = all.filter((s) => within(s, 24, now))
  const pool = recent.length >= 6 ? recent : all

  const top = pool.slice().sort((a, b) => (b.outlets || 0) - (a.outlets || 0) || Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0]
  const rest = pool.filter((s) => s.id !== top.id)

  const facts = all.filter((s) => s.strand === 'facts')
  const health = all.find((s) => s.strand === 'health' && (s.keyFacts || []).length >= 3)
  const weird = all.find((s) => s.strand === 'bizarre' && s.id !== top.id)
  const quizzable = pool.filter((s) => s.quiz?.statement)
  const questions = feed?.quiz?.questions || []
  // Which half hour of the day this is — the same handle the quiz already
  // used to rotate, now also moving the story block along.
  const loop = Math.floor(now / 1800000)
  const question = questions.length ? questions[loop % questions.length] : null

  /*
   * The reader's mix chooses the pool; the show clock still paces it.
   *
   * They do not fight: `orderStories` alternates celebrity against the rest
   * and falls through to whichever queue still has stories, so a mix of
   * celebrity-only produces an all-celebrity block without the alternation
   * having to be disabled. Applied before the slice, so the proportion holds
   * across the nine stories a half hour has room for rather than across the
   * thirty it does not reach.
   */
  const block = rotate(orderStories(mixStories(rest, mix).slice(0, STORY_BLOCK), hour), loop)
  const entries = (chart?.entries || []).slice(0, COUNTDOWN)

  const bulletin = feed?.bulletin?.videoUrl ? feed.bulletin : null
  const segs = []

  if (bulletin) {
    segs.push({ type: 'headlines', dur: Math.round(bulletin.durationSeconds || D.headlines), bulletin, stories: pool.slice(0, 5) })
  }

  /*
   * No chart: fall back to the news shape. This is what runs before the first
   * market run has published anything, and it is a real state — a brand new
   * site is in it for hours.
   */
  if (entries.length < 3) return withKeys(newsShape({ segs, top, block, facts, health, weird, question, quizzable, loop, D }))

  segs.push({ type: 'open', dur: D.open, chart, entries })
  segs.push({ type: 'top', dur: D.top, story: top })

  // The interstitials, each used at most once, in the order the show asks.
  const breaks = {
    factBlast: facts.length >= 3 ? { type: 'factBlast', dur: Math.min(5, facts.length) * FACT_CARD_SECONDS, stories: facts.slice(0, 5) } : null,
    healthMinute: health ? { type: 'healthMinute', dur: D.healthMinute, story: health } : null,
    weird: weird ? { type: 'weird', dur: D.weird, story: weird } : null,
    quiz: question ? { type: 'quiz', dur: D.quiz, question }
      : quizzable.length ? { type: 'quiz', dur: D.quiz, story: quizzable[loop % quizzable.length] } : null,
    answer: null, // filled in below, only if the question was actually asked
  }

  let storyAt = 0
  let asked = false
  for (const beat of SHOW) {
    if (typeof beat === 'number') {
      // Positions are counted DOWN, so beat 10 is the tenth entry.
      const entry = entries[beat - 1]
      if (!entry) continue
      segs.push(beat === 1
        ? { type: 'numberOne', dur: D.numberOne, entry, chart }
        : { type: 'chartPos', dur: D.chartPos, entry, chart, place: beat })
      continue
    }

    if (beat === 'story') {
      const s = block[storyAt++]
      if (s) segs.push({ type: 'story', dur: D.story, story: s })
      continue
    }

    if (beat === 'answer') {
      // The answer is the reward for staying, and it only exists if the
      // question was asked — a reveal with no question is a non sequitur.
      if (asked && question) segs.push({ type: 'answer', dur: D.answer, question })
      continue
    }

    const b = breaks[beat]
    if (!b) continue
    if (beat === 'quiz') asked = true
    segs.push(b)
  }

  segs.push({ type: 'chartRecap', dur: D.chartRecap, chart, entries })
  return withKeys(segs)
}

/**
 * The show with no chart in it.
 *
 * Deliberately the old shape: a top story, the block, and the breaks spread
 * through it. It is not meant to be as good — it is meant to be a channel
 * rather than an apology, for the hours before a chart exists.
 */
function newsShape({ segs, top, block, facts, health, weird, question, quizzable, loop, D }) {
  segs.push({ type: 'top', dur: D.top, story: top })
  const inserts = [
    facts.length >= 3 ? { type: 'factBlast', dur: Math.min(5, facts.length) * FACT_CARD_SECONDS, stories: facts.slice(0, 5), at: 0.3 } : null,
    health ? { type: 'healthMinute', dur: D.healthMinute, story: health, at: 0.45 } : null,
    question ? { type: 'quiz', dur: D.quiz, question, at: 0.6 }
      : quizzable.length ? { type: 'quiz', dur: D.quiz, story: quizzable[loop % quizzable.length], at: 0.6 } : null,
    question ? { type: 'answer', dur: D.answer, at: 0.85, question, minGap: 3 } : null,
  ].filter(Boolean)

  let taken = 0
  let quizAt = 0
  for (const ins of inserts) {
    let at = Math.max(1, Math.round(ins.at * block.length))
    if (ins.minGap) at = Math.max(at, quizAt + ins.minGap)
    ins.slot = Math.max(at, taken + 1)
    taken = ins.slot
    if (ins.type === 'quiz') quizAt = ins.slot
  }

  block.forEach((s, i) => {
    segs.push({ type: 'story', dur: D.story, story: s })
    for (const ins of inserts) if (ins.slot === i + 1) segs.push(ins)
  })
  for (const ins of inserts) if (ins.slot > block.length) segs.push(ins)
  if (weird) segs.push({ type: 'weird', dur: D.weird, story: weird })
  // A show with no sign-off just stops. Even the fallback gets an ending.
  segs.push({ type: 'comingUp', dur: D.comingUp, stories: [top, ...block].slice(0, 3) })
  return segs
}

const withKeys = (segs) => segs.map((s, i) => ({
  ...s,
  key: `${i}-${s.type}-${s.story?.id || s.entry?.id || s.question?.id || ''}`,
}))

export const totalSeconds = (segs) => segs.reduce((a, s) => a + s.dur, 0)

/**
 * Stories that have arrived since the running order was built.
 *
 * "Just in" has to mean NEW, not merely "not in this half hour". The running
 * order holds one show while the feed holds three days of them, so deciding
 * freshness by asking "is this story in the current rundown?" made every story
 * the show had no room for look like breaking news.
 *
 * @param feed     the latest feed
 * @param baseline story ids that existed when the running order was built
 * @param queued   story ids already somewhere in the running order
 */
export function freshStories(feed, baseline, { max = 4, queued = new Set() } = {}) {
  if (!baseline?.size) return []
  return (feed?.stories || [])
    .filter((s) => s?.id && !baseline.has(s.id) && !queued.has(s.id))
    .slice(0, max)
}

/** Every story id the feed holds — the baseline a running order is built against. */
export const storyIdsOf = (feed) => new Set((feed?.stories || []).map((s) => s.id).filter(Boolean))
