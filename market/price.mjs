/**
 * The Genie Exchange: turning the index into a price.
 *
 * The chart answers "who was talked about most". A price has to answer
 * something else entirely — "was that more than you'd expect from them?" —
 * because a bounded 0–100 score cannot be traded. Buy a name at 90 and the
 * only direction available is down; buy one at 10 and you can barely lose.
 * A market priced on the score directly would be solved by every player in
 * about a week, and the solution would be "buy the bottom of the chart".
 *
 * So a price here is a PATH rather than a level. Each day it compounds by
 * how far that day's attention sat from that name's own normal:
 *
 *     r     = k · log( (level + c) / (expected + c) )     clipped
 *     P(t)  = P(t-1) · (1 + r)
 *
 * Four properties fall out of that, and all four are things the game needs:
 *
 *   unbounded upside   holding can genuinely win, so holding is a strategy
 *   megastars flatline  a name who is permanently enormous is permanently
 *                       ordinary FOR THEM, and stops being a free ride
 *   unknowns rocket     going from nowhere to somewhere is the biggest move
 *                       on the board, which makes this a scouting game
 *   fading costs        a name who levels up and then fades ends BELOW where
 *                       they started, because the expectation followed them
 *                       up and the fall is measured against the new one
 *
 * What it does NOT do, which is worth knowing before you read a chart: an
 * isolated one-day spike is a small PERMANENT re-rating, not a round trip.
 * The expectation is a median, so one enormous day does not move it, so
 * there is nothing to give back afterwards. Twenty becomes twenty-four and
 * stays there. That is defensible — a viral moment does leave you a slightly
 * bigger deal than you were — but it is a choice, and the alternative (a
 * mean, which gives the spike back and also swallows the next real move for
 * a fortnight) was the worse one.
 *
 * It also has VOLATILITY DRAG, by construction. Two names with the same
 * average attention will not end at the same price: the erratic one ends
 * lower, because the logarithm punishes the troughs harder than it rewards
 * the peaks. This is a real property of every geometric return series, it
 * rewards sustained attention over noise, and it is the single number most
 * worth watching as real history accumulates — `scripts/price-calibrate.mjs`
 * reports it.
 *
 * The logarithm is doing real work. It makes the ratio symmetric — twice
 * expected and half expected are equal and opposite moves — and it keeps its
 * head when a name at almost zero gets one article. The smoothing constant
 * does the rest: most of the roster is at or near zero on any given day, and
 * a bare ratio of two small numbers is noise amplified without limit.
 *
 * This module is the INDEX price only: what the name is worth on the
 * evidence. What players do to that at the daily clear — the demand
 * multiplier — belongs to the exchange, not to the index, and lives
 * elsewhere. Keeping them apart is what stops a crowd being able to argue
 * with the facts for longer than a day or two.
 *
 * Pure: no network, no storage, no clock.
 */
import { PRICE } from './config.mjs'

const finite = (x) => (Number.isFinite(x) ? x : null)
const round2 = (n) => Math.round(n * 100) / 100
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

/** The middle of a set of numbers, ignoring the holes. */
export function median(xs = []) {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b)
  if (!v.length) return null
  const mid = v.length >> 1
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

/**
 * What this name is normally worth in attention.
 *
 * The median rather than the mean, and of the days BEFORE the one being
 * priced. A mean lets one enormous day raise the bar it is about to be
 * measured against, which quietly swallows exactly the events the exchange
 * exists to price. Including today does the same thing more directly.
 *
 * @param {Array<{day:string, level:number}>} history  oldest first
 * @param {string} day    the day being priced; days from it on are ignored
 */
export function expectedLevel(history = [], day = null, { window = PRICE.baselineDays } = {}) {
  const before = history.filter((d) => d && Number.isFinite(d.level) && (!day || d.day < day))
  if (!before.length) return null
  return median(before.slice(-window).map((d) => d.level))
}

/**
 * One day's return: how surprising the day was, geared and capped.
 *
 * `expected` of null means we have never seen this name before, and the
 * honest return is zero. A first day is a listing, not a movement — pricing
 * it as a rise from nothing would hand a free fortune to whoever happened to
 * hold a name on the day it joined.
 */
export function dayReturn(level, expected, { k = PRICE.k, maxMove = PRICE.maxMove, smoothing = PRICE.smoothing } = {}) {
  const now = finite(level)
  const was = finite(expected)
  if (now == null || was == null) return 0
  const surprise = Math.log((Math.max(0, now) + smoothing) / (Math.max(0, was) + smoothing))
  // Zero over zero is NaN, and one NaN poisons every price after it for the
  // rest of that name's history. A surprise we cannot compute is no surprise.
  if (!Number.isFinite(surprise)) return 0
  return clamp(k * surprise, -maxMove, maxMove)
}

/** What a name lists at: their score on the day they join, floored. */
export function listingPrice(score, { listFloor = PRICE.listFloor, floor = PRICE.floor } = {}) {
  const s = finite(score)
  return round2(Math.max(floor, listFloor, s == null ? listFloor : s))
}

/** The next price, given the last one and how the day went. */
export function nextPrice(previous, { level, expected, ...opts } = {}) {
  const p = finite(previous)
  if (p == null) return null
  const r = dayReturn(level, expected, opts)
  return round2(Math.max(opts.floor ?? PRICE.floor, p * (1 + r)))
}

/**
 * A name's whole price history, folded out of their daily levels.
 *
 * The first day is the listing and never moves — see `dayReturn`. Every day
 * after it is priced against the days before it, so the series can be rebuilt
 * from scratch at any time and comes out identical. That matters more than it
 * sounds: a market whose past changes when you recompute it is not a market
 * anybody can be asked to trust.
 *
 * @param {Array<{day:string, level:number}>} history  oldest first
 * @param {number} listAt  the listing price; defaults to the first day's level
 */
export function priceSeries(history = [], { listAt = null, ...opts } = {}) {
  const days = history.filter((d) => d && d.day).sort((a, b) => (a.day < b.day ? -1 : 1))
  if (!days.length) return []

  const out = []
  let price = listingPrice(listAt ?? days[0].level, opts)
  for (const [i, d] of days.entries()) {
    if (i === 0) {
      out.push({ day: d.day, price, change: 0, level: finite(d.level), expected: null, listed: true })
      continue
    }
    const expected = expectedLevel(days, d.day, opts)
    const r = dayReturn(d.level, expected, opts)
    const before = price
    price = round2(Math.max(opts.floor ?? PRICE.floor, price * (1 + r)))
    out.push({
      day: d.day,
      price,
      change: before > 0 ? round2(((price - before) / before) * 1000) / 10 : 0,
      level: finite(d.level),
      expected: expected == null ? null : round2(expected),
      listed: false,
    })
  }
  return out
}

/**
 * The live price between closes.
 *
 * The market clears once a day, but the app is open all the time and a price
 * that only moves at 4pm looks broken. This is the same arithmetic applied to
 * the day in progress: indicative, never settled, and explicitly marked so
 * the UI cannot present it as a fill.
 */
export function indicativePrice(lastClose, todayLevel, history = [], { day = null, ...opts } = {}) {
  const expected = expectedLevel(history, day, opts)
  const price = nextPrice(lastClose, { level: todayLevel, expected, ...opts })
  if (price == null) return null
  const base = finite(lastClose)
  return {
    price,
    change: base ? round2(((price - base) / base) * 1000) / 10 : 0,
    settled: false,
    expected: expected == null ? null : round2(expected),
  }
}

/**
 * Add any days that have closed since last time, and never touch the rest.
 *
 * `priceSeries` can rebuild a whole history from the rollups at any moment,
 * which raises the obvious question of why a price book is stored at all.
 * The answer is that a rollup day is not guaranteed frozen — a late snapshot,
 * a backfill, a corrected reading — and a market whose past changes when the
 * source does is not one anybody should be asked to put a portfolio into.
 * Once a day has closed it is a fact, so it is written once and read forever.
 *
 * A name with no book yet is listed and backfilled from everything known
 * about them, which is what makes an exchange openable on day one rather
 * than in a fortnight.
 *
 * @param {Array<{day:string, level:number}>} history  their rollup, oldest first
 * @param {object|null} book   what was stored last time
 * @param {string} upTo        the last day that has CLOSED; today is not settled
 */
export function settle(history = [], book = null, { upTo = null, ...opts } = {}) {
  const closed = history
    .filter((d) => d && d.day && Number.isFinite(d.level) && (!upTo || d.day <= upTo))
    .sort((a, b) => (a.day < b.day ? -1 : 1))
  const had = new Map((book?.days || []).map((d) => [d.day, d]))
  if (!closed.length) return { ...(book || {}), days: book?.days || [], added: 0 }

  /*
   * Recomputed in full, then merged so stored days win. Recomputing is what
   * gets the arithmetic right for the new days — each one needs the whole
   * run behind it — and the merge is what stops that arithmetic rewriting
   * anything that has already been traded on.
   */
  const fresh = priceSeries(closed, { listAt: book?.listedAt ?? null, ...opts })
  const days = fresh.map((d) => had.get(d.day) || d)
  const added = fresh.length - had.size

  return {
    ...(book || {}),
    listedAt: book?.listedAt ?? days[0]?.price ?? null,
    listedOn: book?.listedOn ?? days[0]?.day ?? null,
    days,
    added: Math.max(0, added),
  }
}

/** The one line the exchange board needs per name. */
export function quote(book, { level = null, history = [], day = null, ...opts } = {}) {
  const days = book?.days || []
  const close = days[days.length - 1] || null
  if (!close) return null
  const live = level == null ? null : indicativePrice(close.price, level, history, { day, ...opts })
  return {
    price: live?.price ?? close.price,
    close: close.price,
    change: live?.change ?? close.change,
    settled: live ? false : true,
    on: close.day,
    listedAt: book?.listedAt ?? null,
    sinceListing: book?.listedAt ? round2((((live?.price ?? close.price) - book.listedAt) / book.listedAt) * 1000) / 10 : null,
  }
}
