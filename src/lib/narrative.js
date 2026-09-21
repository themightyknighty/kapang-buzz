/**
 * The evidence record, in English.
 *
 * Every sentence here is assembled from a figure the record holds. Nothing is
 * inferred, nothing is rounded into a claim the numbers do not support, and
 * there is no model call — a chart of a hundred names publishes a hundred
 * lines in no time at all, identically every time, and a line can never drift
 * away from the rank it is explaining.
 *
 * The rule the copy follows: say the size of the thing, then where it came
 * from, then whether it lasted. A reader who only takes in the first clause
 * should still have been told the truth.
 *
 * Pure. Give it a record, get back strings.
 */

const has = (x) => Number.isFinite(x)

/** 1,240 rather than 1240, and 12.4 rather than 12.40. */
export function num(n) {
  if (!has(n)) return null
  const rounded = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10
  return rounded.toLocaleString('en-GB')
}

/**
 * A change, said the way a person would say it.
 *
 * Percentages below a doubling and multiples above it. No "tripled", no
 * "skyrocketed" — a multiple is exact and a verb is an opinion, and this copy
 * goes out unread by anybody.
 */
export function sizeOf(change) {
  if (!has(change)) return null
  const ratio = 1 + change
  if (change < 0) return `down ${Math.round(Math.abs(change) * 100)}%`
  if (ratio >= 2) return `${(Math.round(ratio * 10) / 10).toLocaleString('en-GB')}× last week`
  return `up ${Math.round(change * 100)}%`
}

export const ordinal = (n) => {
  if (!has(n)) return null
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

/* ------------------------------------------------------------------ *
 * The lines
 * ------------------------------------------------------------------ */

/** Where they moved to, and from. */
export function moveLine(record, { name = null } = {}) {
  const m = record?.move
  if (!m) return null
  const who = name ? `${name} is ` : ''
  if (m.direction === 'new') return `${who ? `${name} is a ` : ''}new entry at ${m.to}`.trim()
  if (m.direction === 'reentry') return `${who}back on the chart at ${m.to}`
  if (m.direction === 'flat' || !has(m.places) || m.places === 0) return `${who}holding at ${m.to}`
  const word = m.direction === 'up' ? 'up' : 'down'
  return `${who}${word} ${m.places} to number ${m.to}`
}

/**
 * What actually moved.
 *
 * The biggest mover leads, because that is the answer to "why", and a second
 * clause corroborates it where a second signal agrees. When nothing moved
 * enough to report, this says so rather than reaching for a story — a name
 * can hold a chart place on a steady week and there is nothing wrong with
 * that.
 */
export function whyLine(record) {
  const moved = (record?.drivers || []).filter((d) => d.moved).sort((a, b) => b.share - a.share)
  if (!moved.length) return null

  const [lead, second] = moved
  const size = sizeOf(lead.change)

  const phrase = {
    coverage: () => `Coverage ${size} — ${num(lead.now)} mentions a day against ${num(lead.before)}`,
    breadth: () => `Picked up by ${num(lead.now)} newsrooms, ${size}`,
    search: () => `Search interest ${size}`,
  }[lead.key]
  if (!phrase) return null

  const backing = second && {
    coverage: () => `with coverage ${sizeOf(second.change)}`,
    breadth: () => `across ${num(second.now)} newsrooms against ${num(second.before)}`,
    search: () => `and search interest ${sizeOf(second.change)}`,
  }[second.key]

  return backing ? `${phrase()}, ${backing()}.` : `${phrase()}.`
}

/** Whether it lasted — the difference between a level and an afternoon. */
export function shapeLine(record) {
  return {
    sustained: 'Held there all week — a level, not a moment.',
    building: 'Climbing through the week.',
    fading: 'Already coming off the peak.',
    spike: 'One big day carried the week.',
    steady: 'Steady all week.',
  }[record?.week?.shape] || null
}

/**
 * The honesty label.
 *
 * Said plainly and without apology. A rise nobody else noticed is still a
 * rise — the score is the score — but a reader deserves to know it rests on
 * one newsroom, and saying so is what makes the other ninety-nine lines worth
 * believing.
 */
export function thinLine(record) {
  if (!record?.thin) return null
  const e = record.evidence || {}
  if ((e.outlets || 0) <= 1) return 'One outlet so far — no wider pickup yet.'
  if ((e.countries || 0) <= 1) return `${num(e.outlets)} outlets, all in one country.`
  if (record.corroboration < 1) return 'Nothing else moved with it yet.'
  return 'Thin evidence so far.'
}

/**
 * How far back the comparison can see.
 *
 * Said out loud in the chart's first weeks, because "coverage flat" and
 * "we have nothing to compare this with" look identical on a bar and mean
 * completely different things.
 */
export function basisLine(record) {
  if (!record || record.basis === 'full') return null
  if (record.basis === 'none') return 'First week of data — nothing to compare it with yet.'
  const n = record.judgeable ?? 0
  return `Comparing ${n} of 3 signals — the rest have no history yet.`
}

/** How solid the week is, for a label rather than a sentence. */
export function confidenceLabel(record) {
  if (!record) return null
  if (record.thin) return 'Thin'
  const c = record.corroboration || 0
  const e = record.evidence || {}
  if (c >= 3 && (e.topTier || 0) >= 2) return 'Strong'
  if (c >= 2) return 'Corroborated'
  return 'Measured'
}

/* ------------------------------------------------------------------ *
 * Assembled
 * ------------------------------------------------------------------ */

/**
 * The whole explanation, in order: what happened, why, whether it lasted,
 * and what it rests on. Blank lines are dropped rather than padded, so a
 * quiet week produces a short paragraph instead of a padded one.
 */
export function explain(record, { name = null } = {}) {
  return [
    moveLine(record, { name }),
    whyLine(record),
    shapeLine(record),
    thinLine(record) || basisLine(record),
  ].filter(Boolean)
}

/** One sentence, for a share card or a message. */
export function shareLine(record, name) {
  const move = moveLine(record, { name })
  const why = whyLine(record)
  if (!move) return name ? `${name} on The Genie 100` : 'The Genie 100'
  const head = move.charAt(0).toUpperCase() + move.slice(1)
  return why ? `${head}. ${why}` : `${head}.`
}

/**
 * A clause for a chart row — one line under a name on a board or on air.
 *
 * It leads with the evidence rather than with a headline, which is the whole
 * change: a row used to say "here is an article" and now says what moved.
 */
export function rowLine(record, { max = 96 } = {}) {
  if (!record) return null
  const moved = (record.drivers || []).filter((d) => d.moved).sort((a, b) => b.share - a.share)[0]
  const e = record.evidence || {}
  const parts = []
  if (moved) {
    parts.push({
      coverage: `coverage ${sizeOf(moved.change)}`,
      breadth: `${num(moved.now)} newsrooms, ${sizeOf(moved.change)}`,
      search: `search ${sizeOf(moved.change)}`,
    }[moved.key])
  }
  // The evidence, whether or not anything moved. This is the clause that
  // carries the row when the week was quiet.
  if (e.outlets >= 2) parts.push(`${num(e.outlets)} outlets${e.countries >= 2 ? ` in ${num(e.countries)} countries` : ''}`)
  /*
   * "Holding at 85" is only true when they actually held. Said beside a
   * rank that moved six places it reads as a contradiction, and the row
   * already has the score in its own column — so this is the last resort,
   * for a row with no moving signal and no breadth to report.
   */
  if (!parts.length && record.move?.direction === 'flat' && has(record.week?.score)) {
    parts.push(`holding at ${num(record.week.score)}`)
  } else if (!parts.length && has(record.week?.score)) {
    parts.push(`score ${num(record.week.score)}`)
  }
  if (record.thin) parts.push('thin')
  if (!parts.length) return null
  const line = parts.filter(Boolean).join(' · ')
  const capped = line.charAt(0).toUpperCase() + line.slice(1)
  return capped.length <= max ? capped : `${capped.slice(0, max).replace(/\s+\S*$/, '')}…`
}

/** The sparkline's own caption: how much of the week is real. */
export function weekCaption(record) {
  const w = record?.week
  if (!w) return null
  const span = w.span || 7
  if (!has(w.days) || w.days >= span) return `${span} days measured`
  return `${w.days} of ${span} days measured`
}
