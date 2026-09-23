/**
 * The week, written up.
 *
 * `narrative.js` explains one name; this explains a whole edition — the lead
 * story, the two under it, and the standing reports. Same rule as before and
 * for the same reason: every clause is assembled from a figure the picker
 * handed over, there is no model call, and a headline therefore cannot drift
 * away from the chart it is describing.
 *
 * The house style, such as it is:
 *
 *   the headline states the fact, not the feeling — "Sixteen places in a
 *   week" rather than "You won't BELIEVE this climb"
 *   the standfirst carries the number that proves it
 *   nothing claims a record the archive is too young to hold
 *   a thin story says so in its own headline, not in a footnote
 *
 * Pure: give it a pick, get back strings.
 */
import { num, sizeOf } from './narrative.js'

const has = (x) => Number.isFinite(x)
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

/** "one", "two"… up to twelve, then the numeral. Reads better in a headline. */
export function words(n) {
  const w = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
  return has(n) && n >= 0 && n < w.length ? w[n] : num(n)
}

const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many || `${one}s`}`

/* ================================================================== *
 * The lead
 * ================================================================== */

/**
 * Each kind of lead knows how to say itself.
 *
 * Kept as one table rather than scattered through the picker so the whole
 * voice of the chart can be read in one place and changed in one place.
 */
const LEADS = {
  record: (c) => {
    const r = c.record
    const e = r.entry
    const ever = r.firstEver ? 'the first on the board' : 'a record'
    const beat = r.previous
      ? ` It beats ${r.previous.name}${r.previous.places ? `’s ${plural(r.previous.places, 'place')}` : ''}${r.previous.weeks ? `’s ${plural(r.previous.weeks, 'week')}` : ''}.`
      : ''
    const by = {
      climb: () => ({
        headline: `${plural(r.places, 'place')} in a week`,
        standfirst: `${e.displayName} climbed from ${r.from} to ${r.to} — the biggest move the ${c.chartName || 'chart'} has recorded.${beat}`,
      }),
      newEntry: () => ({
        headline: `Straight in at ${r.rank}`,
        standfirst: `${e.displayName} arrives higher than any new entry before them.${beat}`,
      }),
      reign: () => ({
        headline: `${cap(words(r.weeks))} weeks at number one`,
        standfirst: `${e.displayName} has now held the top longer than anybody since we started counting.${beat}`,
      }),
      tenure: () => ({
        headline: `${cap(words(r.weeks))} weeks on the chart`,
        standfirst: `Nobody has lasted longer than ${e.displayName}.${beat}`,
      }),
      score: () => ({
        headline: `The highest score we have measured`,
        standfirst: `${e.displayName} finished the week on ${num(r.score)}.${beat}`,
      }),
      fall: () => ({
        headline: `${plural(r.places, 'place')} the other way`,
        standfirst: `${e.displayName} fell from ${r.from} to ${r.to}, the steepest drop on record.${beat}`,
      }),
    }[r.kind]
    if (!by) return null
    const said = by()
    return { ...said, tag: r.firstEver ? 'First on the board' : 'Record', note: r.firstEver ? `Nothing to beat yet — ${ever}.` : null }
  },

  crown: (c) => {
    const k = c.crown
    const held = k.deposedReign
    return {
      tag: 'New number one',
      headline: `${k.entry.displayName} takes the top`,
      standfirst: held > 1
        ? `${k.deposed.displayName}’s ${plural(held, 'week')} at number one ${held === 1 ? 'is' : 'are'} over${has(k.deposedTo) ? `, and they fall to ${k.deposedTo}` : ''}.`
        : `${k.deposed.displayName} held it for a week${has(k.deposedTo) ? ` and drops to ${k.deposedTo}` : ''}.`,
    }
  },

  reign: (c) => ({
    tag: 'Still there',
    headline: `${cap(words(c.mark.weeks))} weeks at number one`,
    standfirst: `${c.mark.entry.displayName} has not been moved since ${plural(c.mark.weeks - 1, 'week')} ago.`,
  }),

  climb: (c) => ({
    tag: c.thin ? 'Climb of the week · thin' : 'Climb of the week',
    headline: `${plural(c.places, 'place')} for ${c.entry.displayName}`,
    standfirst: `From ${c.entry.lastWeek} to ${c.entry.rank}${has(c.entry.score) ? `, on ${num(c.entry.score)}` : ''}.`,
  }),

  newEntry: (c) => ({
    tag: 'New entry',
    headline: `${c.entry.displayName} arrives at ${c.rank}`,
    standfirst: `The highest of ${words(1)} new name${c.newCount > 1 ? 's' : ''} on the chart this week.`,
  }),

  comeback: (c) => ({
    tag: 'Back',
    headline: `${c.comeback.entry.displayName} returns after ${plural(c.comeback.away, 'week')}`,
    standfirst: has(c.comeback.peak)
      ? `Last seen in ${c.comeback.lastSeen}, with a peak of ${c.comeback.peak}. Back in at ${c.comeback.entry.rank}.`
      : `Back in at ${c.comeback.entry.rank}.`,
  }),

  collapse: (c) => ({
    tag: 'Fall of the week',
    headline: `${c.entry.displayName} drops ${plural(c.places, 'place')}`,
    standfirst: `From ${c.entry.lastWeek} to ${c.entry.rank}.`,
  }),

  concentration: (c) => ({
    tag: 'Fame is narrowing',
    headline: c.direction === 'narrowest'
      ? `Half the world’s attention now goes to ${words(c.halfCount)} people`
      : `Attention is the most spread out we have measured`,
    standfirst: c.direction === 'narrowest'
      ? `Down from ${words(c.previous)} — the narrowest in ${plural(c.weeks, 'week')} of measuring.`
      : `It now takes ${words(c.halfCount)} names to account for half of it, against ${words(c.previous)} before.`,
  }),

  category: (c) => {
    const k = c.category
    const up = k.delta > 0
    return {
      tag: 'Shifting',
      headline: `${k.label} ${up ? 'takes over' : 'gives way'}`,
      standfirst: `${k.label} now holds ${num(k.share)}% of all measured attention, against ${num(k.was)}% across recent weeks.`,
    }
  },

  gap: (c) => {
    const p = c.pair
    return c.direction === 'public'
      ? {
        tag: 'The Gap',
        headline: `Everybody is looking for ${p.displayName}. Nobody is writing about them.`,
        standfirst: `${p.displayName} is ${num(p.searchRank)} of ${num(c.measured)} on search and only ${num(p.pressRank)} on coverage — the widest disagreement on the chart.`,
      }
      : {
        tag: 'The Gap',
        headline: `The story of the week that nobody opened`,
        standfirst: `${p.displayName} is ${num(p.pressRank)} of ${num(c.measured)} on coverage and ${num(p.searchRank)} on search. The press is a long way ahead of the public.`,
      }
  },

  rivalry: (c) => {
    const r = c.rivalry
    return {
      tag: 'Rivalry',
      headline: `${r.a.name} and ${r.b.name} keep swapping`,
      standfirst: `${plural(r.swaps, 'change')} of order between them in recent weeks, never more than ${plural(r.closest, 'place')} apart.`,
    }
  },

  churn: (c) => ({
    tag: 'Turnover',
    headline: `${cap(words(c.churn.arrived))} new names on the chart`,
    standfirst: `${plural(c.churn.left, 'name')} dropped out — the most movement in ${plural(c.weeks, 'week')} of measuring.`,
  }),

  numberOne: (c) => ({
    tag: 'This week',
    headline: `${c.entry.displayName} holds number one`,
    standfirst: has(c.entry.weeksAtOne) && c.entry.weeksAtOne > 1
      ? `${cap(words(c.entry.weeksAtOne))} weeks at the top, on ${num(c.entry.score)}.`
      : `On ${num(c.entry.score)}, with ${plural(c.entry.weeksOn, 'week')} on the chart.`,
  }),
}

/** One candidate, written up. Returns null for a kind with nothing to say. */
export function writeLead(candidate, { chartName = 'The Genie 100' } = {}) {
  if (!candidate?.kind) return null
  const write = LEADS[candidate.kind]
  if (!write) return null
  const said = write({ ...candidate, chartName })
  if (!said?.headline) return null
  return {
    kind: candidate.kind,
    strength: candidate.strength,
    thin: Boolean(candidate.thin),
    tag: said.tag || null,
    headline: said.headline,
    standfirst: said.standfirst || null,
    note: said.note || null,
    // The name the piece is about, so a card knows whose portrait to draw.
    subject: candidate.entry || candidate.pair || candidate.crown?.entry || null,
  }
}

/**
 * The whole front of the week: a lead and the stories under it.
 *
 * A thin lead gets its caveat in the tag rather than buried at the bottom —
 * somebody who reads the headline and nothing else has still been told.
 */
export function writeWeek(pick, { chartName = 'The Genie 100' } = {}) {
  if (!pick?.lead) return null
  const lead = writeLead(pick.lead, { chartName })
  if (!lead) return null
  return {
    chart: chartName,
    weekId: pick.weekId,
    label: pick.label,
    lead,
    also: (pick.also || []).map((c) => writeLead(c, { chartName })).filter(Boolean),
  }
}

/* ================================================================== *
 * The standing reports
 * ================================================================== */

/**
 * The Gap — press against public.
 *
 * The one report that is about the industry rather than about celebrities,
 * which is exactly why it travels: a trade outlet will quote a number that
 * says something about their own commissioning.
 */
/**
 * A signed figure, with the minus the rest of the chart uses.
 *
 * `-59` beside a row reading `−3` is two different characters for one idea
 * on one page. U+2212 is the one the move column has always used.
 */
const signed = (n) => (n > 0 ? `+${num(n)}` : n < 0 ? `\u2212${num(Math.abs(n))}` : `${num(n)}`)

export function writeGap(gap, { label = null } = {}) {
  if (!gap?.pairs?.length) return null
  const wanted = gap.publicAhead[0]
  const pushed = gap.pressAhead[0]
  return {
    kind: 'gap',
    title: 'The Gap',
    subtitle: label ? `Press against public · ${label}` : 'Press against public',
    headline: wanted
      ? `The public is ${plural(wanted.gap, 'place')} ahead of the press on ${wanted.displayName}`
      : 'Press and public are in step this week',
    standfirst: `Every name ranked twice — once on how much was written, once on how many people went looking. ${cap(plural(gap.measured, 'name'))} measured on both.`,
    sections: [
      {
        heading: 'Ahead of the press',
        note: 'People are looking for them harder than the coverage justifies.',
        rows: gap.publicAhead.map((p) => ({
          name: p.displayName, slug: p.slug,
          line: `search ${num(p.searchRank)} · coverage ${num(p.pressRank)}`,
          figure: signed(p.gap),
        })),
      },
      {
        heading: 'Ahead of the public',
        note: pushed ? 'Written about hard, and barely looked up.' : null,
        rows: gap.pressAhead.map((p) => ({
          name: p.displayName, slug: p.slug,
          line: `coverage ${num(p.pressRank)} · search ${num(p.searchRank)}`,
          figure: signed(p.gap),
        })),
      },
    ],
  }
}

/**
 * The Half-Life — how long a celebrity story actually lasts.
 *
 * Says how much it had to work with, every time. An average over four spikes
 * is a rumour, and a report that prints one as though it were a finding is
 * the reason nobody trusts indexes.
 */
export function writeHalfLife(h, { label = null } = {}) {
  if (!h || h.basis === 'too little') {
    return {
      kind: 'halfLife',
      title: 'The Half-Life',
      subtitle: label || null,
      headline: 'Not enough spikes measured yet',
      standfirst: `A half-life needs a spike to time, and the archive holds ${plural(h?.measured || 0, 'measurable one')} so far. This fills in as the weeks go by.`,
      sections: [],
      early: true,
    }
  }
  const cats = Object.entries(h.byCategory || {})
  const fastest = cats.at(-1)
  const slowest = cats[0]
  return {
    kind: 'halfLife',
    title: 'The Half-Life',
    subtitle: label ? `How long a story lasts · ${label}` : 'How long a story lasts',
    headline: `The average celebrity story is half over in ${num(h.average)} days`,
    standfirst: [
      `Measured from the peak of a spike to the point it falls half way back to that person's own normal.`,
      `${cap(plural(h.resolved, 'spike'))} timed${h.stillBurning.length ? `, ${plural(h.stillBurning.length, 'more')} still burning` : ''}.`,
      h.basis === 'early' ? 'Early figures — they will move.' : null,
    ].filter(Boolean).join(' '),
    sections: [
      slowest && fastest && slowest[0] !== fastest[0] ? {
        heading: 'By kind of fame',
        note: `${slowest[1].days} days for ${slowest[0]}, ${fastest[1].days} for ${fastest[0]}.`,
        rows: cats.map(([c, v]) => ({ name: c, line: plural(v.spikes, 'spike'), figure: `${num(v.days)}d` })),
      } : null,
      {
        heading: 'Longest burning',
        rows: h.longest.map((s) => ({
          name: s.displayName, slug: s.slug,
          line: `peaked ${s.peakDay} at ${num(s.peak)}, ${num(s.lift)}× their normal`,
          figure: has(s.days) ? `${num(s.days)}d` : 'still going',
        })),
      },
    ].filter(Boolean),
    early: h.basis === 'early',
  }
}

/**
 * The Attention Report — share, concentration and what kind of fame is
 * holding the room.
 */
export function writeAttention(snapshot, { label = null } = {}) {
  const c = snapshot?.concentration
  const cats = snapshot?.categories
  if (!c || !has(c.halfCount)) return null
  return {
    kind: 'attention',
    title: 'The Attention Report',
    subtitle: label || null,
    headline: `Half of all celebrity attention goes to ${words(c.halfCount)} people`,
    standfirst: `Out of ${plural(c.roster, 'name')} measured. The top ten hold ${num(c.top10Share)}% between them; ${c.leader} alone holds ${num(c.leaderShare)}%.`,
    sections: [
      cats?.shares?.length ? {
        heading: 'Where the attention went',
        rows: cats.shares.slice(0, 6).map((s) => ({ name: s.label, line: plural(s.names, 'name'), figure: `${num(s.share)}%` })),
      } : null,
      snapshot?.share?.shares?.length ? {
        heading: 'Biggest shares',
        rows: snapshot.share.shares.slice(0, 5).map((s) => ({ name: s.displayName, slug: s.slug, line: `score ${num(s.score)}`, figure: `${num(s.share)}%` })),
      } : null,
      snapshot?.spread?.bigButLocal?.length ? {
        heading: 'Big at home, invisible abroad',
        note: 'Covered hard, in one place.',
        rows: snapshot.spread.bigButLocal.map((s) => ({
          name: s.displayName, slug: s.slug,
          line: `${plural(s.outlets, 'outlet')} in ${plural(s.countries, 'country', 'countries')}`,
          figure: `${num(s.density)}×`,
        })),
      } : null,
    ].filter(Boolean),
  }
}

/* ================================================================== *
 * The Race
 * ================================================================== */

/**
 * The gap to number one, with a clock on it.
 *
 * Structurally the most valuable sentence the product can write, because it
 * is the only one that is not yet true. Everything else on the site reports
 * something that has already happened.
 */
/**
 * A day, as somebody would say it out loud.
 *
 * "taken back 7.9 since 2026-09-18" was printed on the front page. A date
 * stamp is what a database says; a reader wants the day of the week, and
 * within a week that is both shorter and more use than the date.
 */
export function dayName(day, { now = Date.now() } = {}) {
  const t = Date.parse(`${day}T12:00:00Z`)
  if (!Number.isFinite(t)) return null
  const days = Math.round((Date.parse(new Date(now).toISOString().slice(0, 10)) - Date.parse(`${day}T00:00:00Z`)) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return new Date(t).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })
}

export function writeRace(race) {
  if (!race?.leader) return null
  if (!race.chaser) {
    return {
      headline: `${race.leader.displayName} leads`,
      line: `On ${num(race.leader.score)}, with nobody else measured yet.`,
    }
  }
  const { leader, chaser, gap, closed } = race
  const closing = has(closed) && closed > 0
  return {
    headline: closing
      ? `${chaser.displayName} is closing on ${leader.displayName}`
      : `${leader.displayName} is pulling away`,
    line: [
      `${num(gap)} ${gap === 1 ? 'point' : 'points'} between them`,
      closing ? `${chaser.displayName} has taken back ${num(closed)} since ${dayName(race.since) || race.since}` : null,
      // The clock clause tests the WORDS, not the hours: once the week has
      // frozen the hours are a finite negative number and the words are
      // null, which printed "null to go" on the one screen most likely to
      // be looked at on a Monday morning.
      race.frozen ? 'the week is frozen' : race.freezesIn ? `${race.freezesIn} to go` : null,
    ].filter(Boolean).join(' · '),
    tight: gap <= 2,
  }
}
