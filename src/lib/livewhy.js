/**
 * Why a name is moving on the live market, right now.
 *
 * The chart explains itself well: every row carries an evidence record built
 * from the same numbers that produced the rank. The live market — the thing
 * that actually moves, every fifteen minutes — explained itself with nine
 * columns of figures and no words at all, and the one sentence it did offer
 * was `reasonFor`: whichever published story mentions this person most
 * recently. That is the reason the chart deliberately stopped using, because
 * it is looked up in a different file from the score and is regularly about a
 * different event from the one that moved it.
 *
 * So this is the chart's method applied to a live row: the explanation is
 * derived FROM the score rather than fetched alongside it, and every clause
 * is a figure the row already carries.
 *
 * It cannot reuse `buildEvidence`, which is shaped like a chart week — seven
 * days, a previous week, a range. A live row has a rolling 24 hours and a
 * baseline of its own.
 *
 * Pure, and deliberately unable to invent: with nothing to say it returns
 * null and the surface prints nothing, which is the honest answer on a name
 * that simply has not moved.
 */
import { num } from './narrative.js'

const has = (n) => Number.isFinite(n)

/** The score's three parts, in the order the config weights them. */
const PARTS = [
  { key: 'news', label: 'coverage', of: (c) => c?.news },
  { key: 'wikipedia', label: 'search', of: (c) => c?.wikipedia },
  { key: 'breadth', label: 'breadth', of: (c) => c?.breadth },
]

/**
 * How far above their own normal, as a multiple rather than a sigma.
 *
 * `deviationZ` is how many standard deviations today sits above this name's
 * own recent mentions. It is the most honest number the market holds — it
 * says "loud FOR THEM" rather than "loud", so a mid-tier name having their
 * biggest week is not buried under whoever is permanently famous. But nobody
 * says sigma out loud, so it is reported against the baseline mean, which is
 * the same claim in words a reader already owns.
 */
export function overNormal(row) {
  const days = row?.baselines?.['7d'] || row?.baselines?.['30d'] || []
  const mean = days.length ? days.reduce((a, b) => a + b, 0) / days.length : null
  if (!has(mean) || mean <= 0 || !has(row?.mentions) || row.mentions <= 0) return null
  const ratio = row.mentions / mean
  // Below a doubling a multiple is noise dressed as a finding.
  return ratio >= 1.5 ? Math.round(ratio * 10) / 10 : null
}

/**
 * What is actually moving this name, as a record.
 *
 * `leading` is the component carrying the most of the score, not the one that
 * changed most — a reader asking why somebody is high wants to know what is
 * holding them there.
 */
export function liveMove(row) {
  if (!row) return null

  const parts = PARTS
    .map((p) => ({ ...p, share: p.of(row.contributions)?.contribution }))
    .filter((p) => has(p.share))
    .sort((a, b) => b.share - a.share)

  /*
   * Below a few points of score there is no composition worth reporting.
   * "Breadth carries 96% of it" is arithmetically true of a name scoring
   * zero and tells a reader precisely nothing.
   */
  const total = parts.reduce((a, p) => a + p.share, 0)
  const leading = parts[0] && total >= 5
    ? { ...parts[0], portion: Math.round((parts[0].share / total) * 100) }
    : null

  return {
    direction: !has(row.change24h) || Math.abs(row.change24h) < 0.5 ? 'flat'
      : row.change24h > 0 ? 'up' : 'down',
    change24h: has(row.change24h) ? row.change24h : null,
    change1h: has(row.change1h) ? row.change1h : null,
    leading,
    parts,
    overNormal: overNormal(row),
    outlets: has(row.uniqueSources) ? row.uniqueSources : null,
    countries: has(row.uniqueCountries) && row.uniqueCountries > 1 ? row.uniqueCountries : null,
    mentions: has(row.mentions) ? row.mentions : null,
    shape: row.shape || null,
    // Momentum is the second derivative: still high but slowing is a real
    // thing to say, and the arrow alone never said it.
    cooling: has(row.momentum) && row.momentum < -1 && row.change24h > 0,
    building: has(row.momentum) && row.momentum > 1,
    thin: has(row.confidence) && row.confidence < 0.5,
  }
}

/**
 * One line for a row on the board.
 *
 * Built the same way the chart's `rowLine` is: what moved, then the hard
 * evidence, then the caveat. On a hundred rows it has to earn its width, so
 * anything that would be true of everybody is left out.
 */
export function liveWhyLine(row, { max = 96 } = {}) {
  const m = liveMove(row)
  if (!m) return null
  const parts = []

  /*
   * The leading component is only worth naming when there is a multiple to
   * attach to it. "Coverage leading" is true of most of the board most of
   * the time, and a clause that is true of everybody is wallpaper — it costs
   * a hundred rows their width and tells a reader nothing. Without it the
   * evidence below carries the row, which is what it is for.
   */
  if (m.overNormal) {
    parts.push(m.leading && m.leading.portion >= 45
      ? `${m.leading.label} ${m.overNormal}× their normal`
      : `${m.overNormal}× their normal`)
  }

  if (has(m.outlets) && m.outlets >= 2) {
    parts.push(`${num(m.outlets)} outlets${m.countries ? ` in ${num(m.countries)} countries` : ''}`)
  }

  // Said only when it contradicts the direction, which is the case a number
  // on its own gets wrong.
  if (m.cooling) parts.push('cooling')

  if (!parts.length) return null
  let line = parts.join(' · ')
  if (line.length > max) line = `${line.slice(0, max).replace(/\s+\S*$/, '')}…`
  return m.thin ? `${line} · thin` : line
}

/**
 * The fuller answer, for a page about one person.
 *
 * Sentences rather than a strip, because there is room, and in the order a
 * reader asks them: what happened, what is carrying it, how far past their
 * own normal it is, and whether it is still climbing.
 */
export function liveWhy(row) {
  const m = liveMove(row)
  if (!m) return []
  const out = []

  if (m.direction !== 'flat' && has(m.change24h)) {
    out.push(`${m.direction === 'up' ? 'Up' : 'Down'} ${num(Math.abs(m.change24h))} in the last 24 hours.`)
  } else {
    out.push('Level over the last 24 hours.')
  }

  if (m.leading && m.leading.portion >= 40) {
    /*
     * "Carries the score", not "did the move". The leading component is what
     * is holding this name where they are; saying it caused a change would
     * be false on every faller, whose score is still mostly coverage on the
     * way down.
     */
    out.push(`${cap(m.leading.label)} carries ${m.leading.portion}% of the score${
      has(m.mentions) && m.leading.key === 'news' ? `, on ${num(m.mentions)} stories` : ''
    }${
      has(m.outlets) && m.outlets >= 2 ? ` across ${num(m.outlets)} outlets${m.countries ? ` in ${num(m.countries)} countries` : ''}` : ''
    }.`)
  }

  if (m.overNormal) {
    out.push(`That is ${m.overNormal}× the coverage they usually get, measured against their own recent weeks rather than against anybody else.`)
  }

  if (m.cooling) out.push('Still high, but the rate has turned — this is fading rather than building.')
  else if (m.building && m.direction === 'up') out.push('Still accelerating.')

  if (m.thin) out.push('Thin evidence: too few independent sources to stand this up firmly.')
  return out
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)
