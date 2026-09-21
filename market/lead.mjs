/**
 * What the week's story is.
 *
 * The chart used to publish and say "here is the chart", which is a
 * scoreboard. A scoreboard is read once; a story is read, argued with and
 * passed on. The difference is entirely in whether somebody decided what the
 * week was ABOUT — and doing that by hand every Monday is a job nobody will
 * keep doing at six in the morning for two years.
 *
 * So it is done by rule. Every candidate the data can support is tested, each
 * returns a strength on one scale, and the strongest wins. That has three
 * properties a person cannot match: it never fails to produce a lead, it is
 * never arbitrary, and it can be argued with — if the picker leads on the
 * wrong thing, the rule is wrong and can be fixed, rather than somebody
 * having had a bad morning.
 *
 * The strength scale, roughly:
 *
 *    90+   an all-time record fell
 *    70-89 a big change at the top, or a very large move
 *    50-69 a solid week's news — a new number one, a real climb
 *    30-49 worth leading on a quiet week
 *    0-29  filler, only used because nothing else fired
 *
 * Two rules that are not negotiable. A lead is never built on evidence the
 * chart itself has marked thin — leading the week on one outlet's say-so
 * would undo everything the corroboration test is for — and there is always
 * a lead, because a week with no story is still a week that has to publish.
 *
 * Pure. Give it an edition, what came before, the records and a snapshot.
 */
import { CHART } from './config.mjs'
import { milestonesIn } from './milestones.mjs'

const finite = (x) => (Number.isFinite(x) ? x : null)
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

/**
 * How much a thin claim is worth.
 *
 * Not zero — the score is the score and the name did move — but never enough
 * to carry a week on its own. A thin lead beaten by a solid second story is
 * the system working.
 */
export const THIN_PENALTY = 0.45

/* ================================================================== *
 * The candidates
 * ================================================================== */

/**
 * Each rule takes the week and returns a candidate or null. `strength` is
 * the only thing compared between them, so every formula is written out
 * rather than tuned by feel, and each says what it is worth and why.
 */
const RULES = [
  /* ---- an all-time record fell ---- */
  function recordFell({ found }) {
    const best = (found.records || [])
      // A "record" set in the first month is a first, not a record, and
      // leading on it makes the chart sound like it is boasting about
      // having only just started.
      .filter((r) => !r.young)
      .map((r) => ({ ...r, weight: { climb: 1, newEntry: 0.95, reign: 1, score: 0.8, tenure: 0.75, fall: 0.6 }[r.kind] || 0.5 }))
      .sort((a, b) => b.weight - a.weight)[0]
    if (!best) return null
    const size = { climb: best.places, fall: best.places, newEntry: 101 - best.rank, reign: best.weeks * 6, tenure: best.weeks * 2, score: best.score }[best.kind] || 0
    return {
      kind: 'record',
      record: best,
      entry: best.entry,
      strength: clamp(72 + best.weight * 10 + Math.min(18, size / 3), 0, 100),
    }
  },

  /* ---- the crown changed hands ---- */
  function crownChanged({ found }) {
    const crown = (found.milestones || []).find((m) => m.kind === 'crown')
    if (!crown) return null
    // Deposing somebody who had held it for months is a bigger story than
    // deposing somebody who arrived last week.
    return {
      kind: 'crown',
      crown,
      entry: crown.entry,
      strength: clamp(56 + Math.min(28, (crown.deposedReign || 1) * 5), 0, 100),
    }
  },

  /* ---- a reign reaching a marked week ---- */
  function reignHeld({ found }) {
    const mark = (found.milestones || []).find((m) => m.kind === 'reignMark')
    if (!mark) return null
    return { kind: 'reign', mark, entry: mark.entry, strength: clamp(52 + Math.min(30, mark.weeks * 1.5), 0, 100) }
  },

  /* ---- the week's biggest climb ---- */
  function biggestClimb({ edition }) {
    const climb = (edition.entries || [])
      .filter((e) => e.status === 'up' && Number.isFinite(e.move) && e.move > 0)
      .sort((a, b) => b.move - a.move)[0]
    if (!climb) return null
    // A climb into the top ten is worth more than the same climb into the
    // fifties, because the top of a chart is what anybody looks at.
    const arriving = climb.rank <= 10 ? 12 : climb.rank <= 25 ? 6 : 0
    return {
      kind: 'climb',
      entry: climb,
      places: climb.move,
      strength: clamp(28 + Math.min(34, climb.move) + arriving, 0, 100),
    }
  },

  /* ---- a new name arriving high ---- */
  function highNewEntry({ edition }) {
    const fresh = (edition.entries || [])
      .filter((e) => e.status === 'new')
      .sort((a, b) => a.rank - b.rank)[0]
    if (!fresh || fresh.rank > 40) return null
    return { kind: 'newEntry', entry: fresh, rank: fresh.rank, strength: clamp(34 + (101 - fresh.rank) / 2.6, 0, 100) }
  },

  /* ---- somebody coming back ---- */
  function comeback({ found }) {
    const back = (found.milestones || []).filter((m) => m.kind === 'comeback').sort((a, b) => b.away - a.away)[0]
    if (!back) return null
    return { kind: 'comeback', comeback: back, entry: back.entry, strength: clamp(34 + Math.min(28, back.away), 0, 100) }
  },

  /* ---- a collapse ---- */
  function collapse({ edition }) {
    const fall = (edition.entries || [])
      .filter((e) => e.status === 'down' && Number.isFinite(e.move) && e.move < 0)
      .sort((a, b) => a.move - b.move)[0]
    if (!fall) return null
    // Deliberately worth less than the same-sized climb. A chart that leads
    // on who is finished every week is a chart nobody enjoys reading.
    return { kind: 'collapse', entry: fall, places: Math.abs(fall.move), strength: clamp(22 + Math.min(30, Math.abs(fall.move)), 0, 100) }
  },

  /* ---- fame narrowed or widened ---- */
  function concentrationMoved({ snapshot, history }) {
    const now = snapshot?.concentration?.halfCount
    if (!Number.isFinite(now)) return null
    const past = (history || []).map((h) => h?.concentration?.halfCount).filter(Number.isFinite)
    if (past.length < 6) return null
    const low = Math.min(...past)
    const high = Math.max(...past)
    const record = now < low ? 'narrowest' : now > high ? 'widest' : null
    if (!record) return null
    return {
      kind: 'concentration',
      direction: record,
      halfCount: now,
      previous: record === 'narrowest' ? low : high,
      weeks: past.length,
      snapshot: snapshot.concentration,
      strength: clamp(46 + Math.min(20, Math.abs(now - (record === 'narrowest' ? low : high)) * 3), 0, 100),
    }
  },

  /* ---- a category taking the room ---- */
  function categoryShifted({ snapshot, history }) {
    const now = snapshot?.categories?.shares || []
    if (!now.length) return null
    const past = (history || []).map((h) => h?.categories?.shares).filter((s) => s?.length)
    if (past.length < 3) return null
    const before = new Map()
    for (const week of past) for (const c of week) before.set(c.category, [...(before.get(c.category) || []), c.share])
    const moved = now
      .map((c) => {
        const was = before.get(c.category) || []
        if (!was.length) return null
        const avg = was.reduce((a, b) => a + b, 0) / was.length
        return { ...c, was: Math.round(avg * 10) / 10, delta: Math.round((c.share - avg) * 10) / 10 }
      })
      .filter(Boolean)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0]
    if (!moved || Math.abs(moved.delta) < 4) return null
    return { kind: 'category', category: moved, strength: clamp(30 + Math.min(26, Math.abs(moved.delta) * 2.5), 0, 100) }
  },

  /* ---- the press and the public disagreeing ---- */
  function gapOpened({ snapshot }) {
    const widest = snapshot?.gap?.widest
    if (!widest || !Number.isFinite(widest.gap)) return null
    const size = Math.abs(widest.gap)
    // Half the roster apart is a genuine disagreement; ten places is noise.
    if (size < Math.max(15, (snapshot.gap.measured || 0) * 0.3)) return null
    return {
      kind: 'gap',
      pair: widest,
      direction: widest.gap > 0 ? 'public' : 'press',
      gap: size,
      measured: snapshot.gap.measured,
      strength: clamp(30 + Math.min(30, size / 2), 0, 100),
    }
  },

  /* ---- two names trading places ---- */
  function rivalry({ snapshot }) {
    const duel = (snapshot?.rivalries || [])[0]
    if (!duel) return null
    return { kind: 'rivalry', rivalry: duel, strength: clamp(32 + duel.swaps * 7, 0, 100) }
  },

  /* ---- the chart turning over ---- */
  function churned({ snapshot, history }) {
    const rate = snapshot?.churn?.rate
    if (!Number.isFinite(rate)) return null
    const past = (history || []).map((h) => h?.churn?.rate).filter(Number.isFinite)
    if (past.length < 4) return null
    const high = Math.max(...past)
    if (rate <= high) return null
    return { kind: 'churn', churn: snapshot.churn, previous: high, weeks: past.length, strength: clamp(34 + Math.min(24, rate), 0, 100) }
  },

  /* ---- the fallback, which always fires ---- */
  function whoIsTop({ edition }) {
    const one = (edition.entries || []).find((e) => e.rank === 1)
    if (!one) return null
    return { kind: 'numberOne', entry: one, strength: 12 }
  },
]

/* ================================================================== *
 * The pick
 * ================================================================== */

/**
 * Every candidate this week supports, strongest first.
 *
 * Returned in full rather than just the winner, because the second and third
 * are the week's other stories — a report wants a lead and two sidebars, and
 * working them out twice would let them disagree.
 */
export function candidates({ edition, previous = null, records = {}, snapshot = null, history = [] } = {}) {
  if (!edition?.entries?.length) return []
  const found = milestonesIn({ edition, previous, records })
  const input = { edition, previous, records, snapshot, history, found }

  return RULES
    .map((rule) => {
      const c = rule(input)
      if (!c || !Number.isFinite(c.strength)) return null
      /*
       * A lead is never carried by evidence the chart itself called thin.
       * Everything the corroboration test is for would be undone by a Monday
       * headline built on one outlet, so the claim is damped rather than
       * dropped: it can still be the story on a week when nothing else
       * happened, and it cannot beat a solid one.
       */
      const thin = Boolean(c.entry?.movement?.thin || c.entry?.thin)
      return {
        ...c,
        thin,
        rule: rule.name,
        strength: Math.round(thin ? c.strength * THIN_PENALTY : c.strength),
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.strength - a.strength || RULES.findIndex((r) => r.name === a.rule) - RULES.findIndex((r) => r.name === b.rule))
}

/**
 * The week's lead, and the two stories under it.
 *
 * `also` skips anything about the same person as the lead — three items all
 * about the same name is one item with two repetitions.
 */
export function pickLead(input = {}) {
  const all = candidates(input)
  if (!all.length) return null
  const [lead] = all
  const also = all.slice(1)
    .filter((c) => !c.entry || !lead.entry || c.entry.id !== lead.entry.id)
    .slice(0, 2)
  return {
    chart: CHART.name,
    weekId: input.edition?.id || null,
    label: input.edition?.label || null,
    lead,
    also,
    considered: all.length,
  }
}
