/**
 * Records broken and milestones reached — the engine a chart runs on.
 *
 * Billboard's real product is not the ranking. It is "the longest-running
 * number one in chart history", "the biggest jump since 1996", "the first act
 * to do X" — a permanent supply of superlatives that only exists because
 * somebody kept the archive. Every one of those is worth more in year three
 * than it is in year one, and none of them can be retrofitted: an archive you
 * did not keep is a record you cannot claim.
 *
 * So this is deliberately written before it is useful. In the first weeks
 * almost everything here is a first rather than a record, which it says
 * plainly; by next year the same code is producing a headline most weeks
 * without anybody touching it.
 *
 * Two kinds of thing:
 *
 *   records      an all-time best has been beaten — the biggest climb, the
 *                highest new entry, the longest reign
 *   milestones   a threshold has been reached that is worth saying out loud
 *                even though it beats nothing — a tenth week at number one,
 *                a hundredth week on the chart
 *
 * Pure: give it an edition, what came before it and the running records.
 */
import { CHART } from './config.mjs'

const finite = (x) => (Number.isFinite(x) ? x : null)

/** Weeks at number one worth marking even when they beat nothing. */
export const REIGN_MARKS = [2, 4, 8, 13, 26, 39, 52, 78, 104]
/** Weeks on the chart, likewise. */
export const TENURE_MARKS = [10, 26, 52, 100, 156, 208, 260]

/** The highest mark this number has just passed, or null. */
const markReached = (n, marks) => (marks.includes(n) ? n : null)

/**
 * The all-time bests held before this edition.
 *
 * Kept as a small block on the records file rather than recomputed from every
 * edition ever published, because by year five that would mean reading two
 * hundred and sixty files to write one sentence.
 */
export function bestsBefore(records = {}) {
  return {
    climb: records.__bests?.climb || null,
    fall: records.__bests?.fall || null,
    newEntry: records.__bests?.newEntry || null,
    reign: records.__bests?.reign || null,
    tenure: records.__bests?.tenure || null,
    score: records.__bests?.score || null,
    editions: records.__bests?.editions || 0,
  }
}

/**
 * Everything this edition beat or reached.
 *
 * `firstEver` marks the case that matters at launch: there was no record to
 * beat, so this is the first one on the board. Saying "the biggest climb we
 * have recorded" when the archive is three weeks old would be true and
 * ridiculous, and the copy needs to know the difference.
 */
export function milestonesIn({ edition, previous = null, records = {} } = {}) {
  if (!edition?.entries?.length) return { records: [], milestones: [], bests: bestsBefore(records) }

  const bests = bestsBefore(records)
  const young = bests.editions < 4
  const out = []
  const marks = []

  const entries = edition.entries
  const at = (id) => entries.find((e) => e.id === id)

  /*
   * A move the chart called thin cannot set a record.
   *
   * It can chart, it can be the week's biggest climb, it can be the lead on
   * a quiet week — the score is the score. But "the biggest climb in the
   * history of the Genie 100" is a claim that stands forever, and putting
   * one outlet's say-so into the permanent record would mean every
   * superlative after it is measured against something we ourselves said we
   * could not corroborate. Records are the one place where thin is
   * disqualifying rather than merely disclosed.
   */
  const solid = (e) => !e?.movement?.thin

  /* ---- the biggest climb ---- */
  const climbs = entries.filter((e) => e.status === 'up' && Number.isFinite(e.move) && e.move > 0 && solid(e))
  const topClimb = climbs.sort((a, b) => b.move - a.move)[0]
  if (topClimb) {
    const beat = !bests.climb || topClimb.move > bests.climb.places
    if (beat) {
      out.push({
        kind: 'climb',
        firstEver: !bests.climb,
        young,
        entry: pick(topClimb),
        places: topClimb.move,
        from: topClimb.lastWeek,
        to: topClimb.rank,
        previous: bests.climb ? { places: bests.climb.places, name: bests.climb.name, weekId: bests.climb.weekId } : null,
      })
    }
  }

  /* ---- the biggest fall ---- */
  const falls = entries.filter((e) => e.status === 'down' && Number.isFinite(e.move) && e.move < 0)
  const topFall = falls.sort((a, b) => a.move - b.move)[0]
  if (topFall) {
    const places = Math.abs(topFall.move)
    if (!bests.fall || places > bests.fall.places) {
      out.push({
        kind: 'fall',
        firstEver: !bests.fall,
        young,
        entry: pick(topFall),
        places,
        from: topFall.lastWeek,
        to: topFall.rank,
        previous: bests.fall ? { places: bests.fall.places, name: bests.fall.name, weekId: bests.fall.weekId } : null,
      })
    }
  }

  /* ---- the highest new entry ---- */
  const news = entries.filter((e) => e.status === 'new' && solid(e))
  const topNew = news.sort((a, b) => a.rank - b.rank)[0]
  if (topNew) {
    if (!bests.newEntry || topNew.rank < bests.newEntry.rank) {
      out.push({
        kind: 'newEntry',
        firstEver: !bests.newEntry,
        young,
        entry: pick(topNew),
        rank: topNew.rank,
        previous: bests.newEntry ? { rank: bests.newEntry.rank, name: bests.newEntry.name, weekId: bests.newEntry.weekId } : null,
      })
    }
  }

  /* ---- the longest reign ---- */
  const one = entries.find((e) => e.rank === 1)
  if (one && Number.isFinite(one.weeksAtOne) && one.weeksAtOne > 0) {
    if (!bests.reign || one.weeksAtOne > bests.reign.weeks) {
      out.push({
        kind: 'reign',
        firstEver: !bests.reign,
        young,
        entry: pick(one),
        weeks: one.weeksAtOne,
        previous: bests.reign ? { weeks: bests.reign.weeks, name: bests.reign.name, weekId: bests.reign.weekId } : null,
      })
    }
    const mark = markReached(one.weeksAtOne, REIGN_MARKS)
    if (mark) marks.push({ kind: 'reignMark', entry: pick(one), weeks: mark })
  }

  /* ---- the longest tenure ---- */
  const longest = [...entries].sort((a, b) => (b.weeksOn || 0) - (a.weeksOn || 0))[0]
  if (longest && Number.isFinite(longest.weeksOn) && longest.weeksOn > 0) {
    if (!bests.tenure || longest.weeksOn > bests.tenure.weeks) {
      out.push({
        kind: 'tenure',
        firstEver: !bests.tenure,
        young,
        entry: pick(longest),
        weeks: longest.weeksOn,
        previous: bests.tenure ? { weeks: bests.tenure.weeks, name: bests.tenure.name, weekId: bests.tenure.weekId } : null,
      })
    }
    for (const e of entries) {
      const mark = markReached(e.weeksOn, TENURE_MARKS)
      if (mark) marks.push({ kind: 'tenureMark', entry: pick(e), weeks: mark })
    }
  }

  /* ---- the highest score ever charted ---- */
  const best = [...entries].filter(solid).sort((a, b) => b.score - a.score)[0]
  if (best && Number.isFinite(best.score) && (!bests.score || best.score > bests.score.score)) {
    out.push({
      kind: 'score',
      firstEver: !bests.score,
      young,
      entry: pick(best),
      score: best.score,
      previous: bests.score ? { score: bests.score.score, name: bests.score.name, weekId: bests.score.weekId } : null,
    })
  }

  /* ---- a return after a long time away ---- */
  for (const e of entries.filter((x) => x.status === 'reentry')) {
    const was = records[e.id]
    const away = weeksBetween(was?.lastCharted, edition.id)
    if (Number.isFinite(away) && away >= 4) {
      marks.push({ kind: 'comeback', entry: pick(e), away, lastSeen: was.lastCharted, peak: was.peak ?? null })
    }
  }

  /* ---- a new number one, which is not a record but is the week's news ---- */
  const wasOne = (previous?.entries || []).find((e) => e.rank === 1)
  if (one && wasOne && wasOne.id !== one.id) {
    marks.push({
      kind: 'crown',
      entry: pick(one),
      deposed: pick(wasOne),
      deposedReign: finite(wasOne.weeksAtOne) ?? 1,
      deposedTo: at(wasOne.id)?.rank ?? null,
    })
  }

  return { records: out, milestones: marks, bests }
}

const pick = (e) => (e ? {
  id: e.id, slug: e.slug, displayName: e.displayName,
  rank: e.rank, score: e.score, lastWeek: finite(e.lastWeek),
  weeksOn: finite(e.weeksOn), weeksAtOne: finite(e.weeksAtOne), peak: finite(e.peak),
  thin: Boolean(e.movement?.thin),
} : null)

/** Whole weeks between two chart-week ids, or null if either is unreadable. */
export function weeksBetween(a, b) {
  const ms = (id) => {
    const m = /^(\d{4})-W(\d{2})$/.exec(String(id || ''))
    if (!m) return null
    // The Thursday of that ISO week — any fixed day in the week will do for a
    // difference, and Thursday is the one the year is defined by.
    const jan4 = Date.UTC(Number(m[1]), 0, 4)
    const dow = (new Date(jan4).getUTCDay() + 6) % 7
    return jan4 - dow * 86400000 + (Number(m[2]) - 1) * 7 * 86400000
  }
  const from = ms(a)
  const to = ms(b)
  if (from == null || to == null) return null
  return Math.round((to - from) / (7 * 86400000))
}

/**
 * The records file with this edition's bests folded in.
 *
 * Written beside the per-celebrity records the chart already keeps, under a
 * reserved key, so one read answers "what is the biggest climb we have ever
 * recorded" without opening a single edition.
 */
export function nextBests(records = {}, edition, { found = null } = {}) {
  if (!edition?.entries?.length) return records
  const bests = { ...bestsBefore(records) }
  const stamp = (e, extra) => ({ id: e.id, name: e.displayName, slug: e.slug, weekId: edition.id, ...extra })

  const { records: hits } = found || milestonesIn({ edition, records })
  for (const h of hits) {
    if (h.kind === 'climb') bests.climb = stamp(h.entry, { places: h.places })
    if (h.kind === 'fall') bests.fall = stamp(h.entry, { places: h.places })
    if (h.kind === 'newEntry') bests.newEntry = stamp(h.entry, { rank: h.rank })
    if (h.kind === 'reign') bests.reign = stamp(h.entry, { weeks: h.weeks })
    if (h.kind === 'tenure') bests.tenure = stamp(h.entry, { weeks: h.weeks })
    if (h.kind === 'score') bests.score = stamp(h.entry, { score: h.score })
  }
  bests.editions = (bests.editions || 0) + 1
  bests.latest = edition.id
  bests.chart = CHART.name
  return { ...records, __bests: bests }
}
