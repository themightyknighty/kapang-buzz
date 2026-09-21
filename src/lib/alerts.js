/**
 * What is worth telling someone about since they were last here.
 *
 * The app already knows who a reader follows — people they tapped on a story,
 * strands they followed on the front page — and it has never done anything
 * with it. This turns that into a short list: the people they follow who are
 * in today's stories, the ones whose score has moved sharply, what is new,
 * and a streak about to lapse.
 *
 * Three rules it holds to:
 *
 *  - Nothing is invented. Every alert points at a real story or a real row,
 *    and one that cannot say why it is here does not appear.
 *  - Following nobody means a quiet bell, not a bell full of adverts for the
 *    site. The only thing an unfollowing reader is told is that there are new
 *    stories, which is the one thing they came for.
 *  - Ids are stable. The same event alerts once, however many times the page
 *    is reloaded or the market ticks.
 *
 * Pure: it takes the feed, the market, the reader's preferences and the time,
 * and returns a list. Storage lives in noticestate.js.
 */

/** How far a gossip score has to move before it is worth interrupting for. */
export const SHARP_MOVE = 6

/** Past this hour, a streak that has not been kept today is worth mentioning. */
export const STREAK_HOUR = 17

/** At most this many, newest first. A bell with forty things in it is a wall. */
export const MAX_ALERTS = 8

const norm = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').trim()

const dayOf = (t) => new Date(t).toISOString().slice(0, 10)

const STRAND_LABELS = {
  celebrity: 'Celebrity Gossip',
  health: 'Health',
  facts: 'Fantastic Facts',
  bizarre: 'Bizarre News',
}

export const followedPeople = (prefs) => (prefs?.follows || [])
  .filter((f) => f.startsWith('person:')).map((f) => f.slice(7))

export const followedStrands = (prefs) => (prefs?.follows || [])
  .filter((f) => f.startsWith('strand:')).map((f) => f.slice(7))

/**
 * The move a row is being judged on.
 *
 * Deliberately only the two figures a reader would recognise as "since I last
 * looked". Momentum is a rate of change on a scale of its own, and "momentum
 * 40" is not something to wake anybody up for.
 */
function moveOf(row) {
  if (Number.isFinite(row?.change24h) && row.change24h !== 0) return { value: row.change24h, label: 'today' }
  if (Number.isFinite(row?.change1h) && row.change1h !== 0) return { value: row.change1h, label: 'since the last update' }
  return null
}

/**
 * @param {{feed?:object, market?:object, prefs?:object, since?:number|null, now?:number}} input
 * @returns {Array<{id:string,kind:string,title:string,text:string,href:string,at:number,tone:string}>}
 */
export function buildAlerts({ feed, market, prefs, since = null, now = Date.now() } = {}) {
  const alerts = []
  const stories = feed?.stories || []
  const people = followedPeople(prefs)
  const strands = followedStrands(prefs)
  const watched = new Set(people.map(norm))

  const isNew = (s) => {
    const t = Date.parse(s.publishedAt)
    return Number.isFinite(t) && (since == null || t > since)
  }
  const fresh = stories.filter(isNew)

  /* ---- someone they follow is in the news ---- */
  if (watched.size) {
    for (const s of fresh) {
      const hit = (s.people || []).find((p) => watched.has(norm(p)))
      if (!hit) continue
      alerts.push({
        id: `person:${norm(hit)}:${s.id}`,
        kind: 'person',
        title: `${hit} is in today’s stories`,
        text: s.headline,
        href: `/story/${encodeURIComponent(s.id)}`,
        at: Date.parse(s.publishedAt) || now,
        tone: 'person',
      })
    }
  }

  /* ---- someone they follow has moved sharply ---- */
  if (watched.size && market?.rows?.length) {
    for (const row of market.rows) {
      if (!watched.has(norm(row.displayName))) continue
      const move = moveOf(row)
      if (!move || Math.abs(move.value) < SHARP_MOVE) continue
      alerts.push({
        // Once a day per person: the market ticks every fifteen minutes and
        // nobody wants ninety-six of these.
        id: `market:${row.slug}:${dayOf(now)}:${move.value > 0 ? 'up' : 'down'}`,
        kind: 'market',
        title: `${row.displayName} is ${move.value > 0 ? 'up' : 'down'} ${Math.abs(move.value).toFixed(1)} ${move.label}`,
        text: `Gossip Score ${Number.isFinite(row.gossipScore) ? row.gossipScore.toFixed(1) : '—'}`,
        href: `/market/${encodeURIComponent(row.slug)}`,
        at: Date.parse(market.generatedAt) || now,
        tone: move.value > 0 ? 'up' : 'down',
      })
    }
  }

  /* ---- a strand they follow has something new ---- */
  for (const key of strands) {
    const count = fresh.filter((s) => s.strand === key).length
    if (!count) continue
    alerts.push({
      id: `strand:${key}:${feed?.generatedAt || dayOf(now)}`,
      kind: 'strand',
      title: `${count} new in ${STRAND_LABELS[key] || key}`,
      text: fresh.find((s) => s.strand === key)?.headline || '',
      href: `/strand/${key}`,
      at: Date.parse(feed?.generatedAt) || now,
      tone: 'strand',
    })
  }

  /* ---- what is new, for everybody ---- */
  if (since != null && fresh.length) {
    alerts.push({
      id: `feed:${feed?.generatedAt || dayOf(now)}`,
      kind: 'feed',
      title: `${fresh.length} new ${fresh.length === 1 ? 'story' : 'stories'}`,
      text: fresh[0]?.headline || '',
      href: '/',
      at: Date.parse(feed?.generatedAt) || now,
      tone: 'feed',
    })
  }

  /* ---- a streak about to lapse ---- */
  const streak = prefs?.quizStreak || 0
  if (streak > 0 && prefs?.lastQuizDay) {
    const today = dayOf(now)
    const yesterday = dayOf(now - 86400000)
    // The day has to be counted the way the quiz counts it, or this nags
    // someone who has already played. The hour is the reader's own, because
    // "it is getting late" is about their evening, not the server's.
    const hour = new Date(now).getHours()
    if (prefs.lastQuizDay === yesterday && hour >= STREAK_HOUR) {
      alerts.push({
        id: `quiz:${today}`,
        kind: 'quiz',
        title: `Your ${streak}-day quiz streak ends at midnight`,
        text: 'Today’s quiz takes a minute.',
        href: '/quiz',
        at: now,
        tone: 'quiz',
      })
    }
  }

  // Newest first, one per id, capped.
  const seen = new Set()
  return alerts
    .sort((a, b) => b.at - a.at)
    .filter((a) => (seen.has(a.id) ? false : seen.add(a.id)))
    .slice(0, MAX_ALERTS)
}

/** Which of these the reader has not already been shown. */
export const unread = (alerts, state) => alerts.filter((a) => !state?.seen?.[a.id])
