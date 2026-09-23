/**
 * The reader's own mix of the day.
 *
 * The pipeline publishes a fixed day — twelve celebrity, six each of health,
 * facts and bizarre — because a newsroom has to commit to a shape. A reader
 * does not. Somebody who only wants the bizarre news should be able to have
 * a page of it without us having to run a different pipeline for them.
 *
 * This is a weighting, not a filter. Each strand gets a share of the list in
 * proportion to its weight, so a mix of 3:1:1:1 puts celebrity stories three
 * times as often as the rest rather than removing anything — and a weight of
 * zero does remove a strand, which is what makes "all celebrity" reachable
 * from the same control.
 *
 * Supply is finite: asking for 90% bizarre out of a day holding six bizarre
 * stories gets you the six, not sixty. The proportion is honoured as far as
 * the day allows and then the remainder follows, so the page is never short.
 *
 * Pure, and used by both the front page and the channel — a reader who has
 * asked for one thing should not get another the moment they press play.
 */
import { STRAND_KEYS } from './strands.js'

/** The shape the pipeline publishes, which is also the shape of "no opinion". */
export const DEFAULT_MIX = { celebrity: 12, health: 6, facts: 6, bizarre: 6 }

export const MIX_MAX = 12

/** A stored mix, made safe: known strands, whole numbers, nothing negative. */
export function normaliseMix(mix) {
  const out = {}
  for (const k of STRAND_KEYS) {
    const v = Number(mix?.[k])
    out[k] = Number.isFinite(v) ? Math.max(0, Math.min(MIX_MAX, Math.round(v))) : DEFAULT_MIX[k] ?? 0
  }
  return out
}

/** Is this mix just the day as published? Then nothing needs reordering. */
export const isDefaultMix = (mix) => {
  const m = normaliseMix(mix)
  return STRAND_KEYS.every((k) => m[k] === (DEFAULT_MIX[k] ?? 0))
}

/**
 * The stories, in the reader's proportions.
 *
 * Greedy by lowest taken-to-weight ratio, which is the same rule a seat
 * allocation uses: at every step the strand that is furthest behind its share
 * goes next. That keeps the proportion true at EVERY length, so the first six
 * stories are mixed the way the whole list is — which matters, because a
 * reader sees the top of the page and the channel plays only the first few.
 */
export function mixStories(stories = [], mix = DEFAULT_MIX, { limit = null } = {}) {
  const list = stories.filter(Boolean)
  const m = normaliseMix(mix)

  const queues = new Map()
  for (const s of list) {
    if (!queues.has(s.strand)) queues.set(s.strand, [])
    queues.get(s.strand).push(s)
  }

  const live = [...queues.keys()].filter((k) => m[k] > 0)
  // Every slider at zero is not a request for an empty page. It is a reader
  // who has not chosen, so they get the day as published.
  if (!live.length) return limit ? list.slice(0, limit) : list

  const taken = Object.fromEntries(live.map((k) => [k, 0]))
  const out = []
  const want = limit == null ? list.length : Math.min(limit, list.length)

  while (out.length < want) {
    const next = live
      .filter((k) => queues.get(k).length)
      .sort((a, b) => (taken[a] / m[a]) - (taken[b] / m[b])
        || m[b] - m[a]
        || STRAND_KEYS.indexOf(a) - STRAND_KEYS.indexOf(b))[0]
    if (!next) break
    out.push(queues.get(next).shift())
    taken[next] += 1
  }

  /*
   * Whatever the weights could not place still belongs to the reader. A
   * strand set to zero is dropped on purpose; everything else follows in the
   * order it arrived, so a page is never shorter than the day.
   */
  const rest = live.flatMap((k) => queues.get(k))
  return limit ? out.slice(0, limit) : [...out, ...rest]
}
