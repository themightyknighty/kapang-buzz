import { test } from 'node:test'
import assert from 'node:assert/strict'
import { median, expectedLevel, dayReturn, listingPrice, nextPrice, priceSeries, indicativePrice, settle, quote } from './price.mjs'
import { PRICE } from './config.mjs'

/** A run of days at a level, from a fixed start. */
const days = (levels, from = '2026-09-01') => levels.map((level, i) => ({
  day: new Date(Date.parse(`${from}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10),
  level,
}))

const last = (s) => s[s.length - 1]
const prices = (s) => s.map((p) => p.price)

/* ================================================================== *
 * The properties the game depends on
 * ================================================================== */

test('a name at their own normal does not drift', () => {
  /*
   * The one that kills a naive model. If ordinary weeks move the price,
   * then every price is really a bet on the constant, not on the celebrity.
   */
  const s = priceSeries(days(new Array(30).fill(40)))
  assert.equal(last(s).price, s[0].price)
  assert.ok(s.slice(1).every((p) => p.change === 0), 'flat attention, flat price')
})

test('a megastar who is permanently enormous is not a free ride', () => {
  // 90 every day is ordinary FOR THEM. The chart says number one; the
  // exchange says nothing is happening, and both are right.
  const s = priceSeries(days(new Array(30).fill(90)))
  assert.equal(last(s).price, s[0].price)
})

test('an unknown breaking out beats a megastar having a good run', () => {
  /*
   * The whole fantasy: you owned them before anybody had heard of them.
   * The daily cap means it takes a fortnight rather than a week — nobody
   * makes a fortune on one session, by design — but the gap is decisive.
   */
  const unknown = priceSeries(days([...new Array(14).fill(2), ...Array.from({ length: 14 }, (_, i) => 10 + i * 4)]))
  const famous = priceSeries(days([...new Array(14).fill(70), ...Array.from({ length: 14 }, (_, i) => 72 + i * 1.5)]))
  const gain = (s) => last(s).price / s[0].price
  assert.ok(gain(unknown) > gain(famous) * 1.5, `unknown ${gain(unknown).toFixed(2)}× vs famous ${gain(famous).toFixed(2)}×`)
})

test('there is no ceiling: a name who keeps growing keeps rising', () => {
  // Unbounded upside is what makes holding a strategy rather than a mistake.
  const s = priceSeries(days([...new Array(7).fill(5), ...Array.from({ length: 40 }, (_, i) => 5 + i * 3)]))
  assert.ok(last(s).price > s[0].price * 3, `reached ${last(s).price} from ${s[0].price}`)
  assert.ok(prices(s).every(Number.isFinite))
})

test('one viral day is a small permanent re-rating, not a round trip', () => {
  /*
   * Worth being explicit about, because the opposite is the intuitive guess.
   * The expectation is a MEDIAN, so a single enormous day does not move it,
   * so there is nothing to hand back afterwards. You end slightly bigger
   * than you were and stay there — which is what a viral moment does to a
   * person. Capped, so it is slight.
   */
  const s = priceSeries(days([...new Array(14).fill(20), 95, 20, 20, 20, 20]))
  assert.ok(last(s).price > s[0].price, 'the spike leaves a mark')
  assert.ok(last(s).price < s[0].price * 1.25, 'but a modest one')
  assert.deepEqual(prices(s).slice(-4), new Array(4).fill(last(s).price), 'and it settles flat, not drifting')
})

test('levelling up and then fading leaves you below where you started', () => {
  // The punishing one, and the reason a rise is not a free ride: the
  // expectation follows you up, so the fall is measured from the new height.
  const s = priceSeries(days([...new Array(14).fill(20), ...new Array(14).fill(60), ...new Array(8).fill(20)]))
  const peak = Math.max(...prices(s))
  assert.ok(peak > s[0].price * 3, `rose to ${peak}`)
  assert.ok(last(s).price < s[0].price, `and ended at ${last(s).price}, below the ${s[0].price} it listed at`)
})

test('spiking on a metronome does not ratchet upwards forever', () => {
  /*
   * The exploit to check for: if alternating enormous and ordinary days
   * compounded without limit, the game would be won by whoever found the
   * most erratic name. It rises at first, then the expectation fills with
   * both modes and the ordinary days start costing more than the spikes pay.
   */
  const alternating = (n) => [...new Array(14).fill(20), ...Array.from({ length: n }, (_, i) => (i % 2 ? 20 : 95))]
  const at = (n) => last(priceSeries(days(alternating(n)))).price
  assert.ok(at(20) > at(10) * 0.5, 'it does rise early')
  assert.ok(at(80) < at(20), 'and then it does not keep rising')
  assert.ok(at(160) < at(80), 'volatility is a cost, not a strategy')
})

test('the steady name beats the erratic one on the same average attention', () => {
  /*
   * Volatility drag, stated as a test because it is a design decision and
   * not an accident: geometric returns punish troughs harder than they
   * reward peaks. Sustained attention is what the index is for.
   */
  const steady = priceSeries(days([...new Array(14).fill(40), ...new Array(40).fill(50)]))
  const erratic = priceSeries(days([...new Array(14).fill(40), ...Array.from({ length: 40 }, (_, i) => (i % 2 ? 10 : 90))]))
  assert.ok(last(steady).price > last(erratic).price,
    `steady ${last(steady).price} should beat erratic ${last(erratic).price} on the same mean`)
})

test('a name nobody writes about bleeds rather than collapses', () => {
  // Forgotten is not the same as worthless, and a holder who is wrong should
  // have time to notice. A cliff here makes the whole game unforgiving.
  const s = priceSeries(days([...new Array(10).fill(45), ...new Array(20).fill(0)]))
  assert.ok(last(s).price < s[0].price, 'silence costs something')
  assert.ok(last(s).price > 1, 'but never reaches zero')
})

/* ================================================================== *
 * The guard rails
 * ================================================================== */

test('no single day can decide the leaderboard', () => {
  const s = priceSeries(days([...new Array(14).fill(1), 100]))
  assert.ok(Math.abs(last(s).change) <= PRICE.maxMove * 100 + 0.1, `moved ${last(s).change}%`)
})

test('the smoothing constant holds when the numbers are tiny', () => {
  /*
   * Most of the roster sits at or near zero on any given day. A bare ratio
   * of two small numbers is noise amplified without limit — one article
   * against a baseline of 0.2 is a 500% day.
   */
  const s = priceSeries(days([...new Array(14).fill(0.2), 1]))
  assert.ok(Number.isFinite(last(s).price))
  assert.ok(Math.abs(last(s).change) < 5, `one article moved it ${last(s).change}%`)
})

test('twice expected and half expected are equal and opposite', () => {
  const up = dayReturn(2 * 40 + PRICE.smoothing - PRICE.smoothing, 40)
  const down = dayReturn(20, 40)
  assert.ok(up > 0 && down < 0)
  // Symmetric in log space, which is the point of using one.
  const a = dayReturn(88, 40)
  const b = dayReturn(40, 88)
  assert.ok(Math.abs(a + b) < 1e-9, `${a} and ${b} should cancel`)
})

test('a first sighting is a listing, not a windfall', () => {
  // Pricing day one as a rise from nothing hands a fortune to whoever
  // happened to hold a name the day it joined.
  assert.equal(dayReturn(90, null), 0)
  const s = priceSeries(days([80, 80]))
  assert.equal(s[0].change, 0)
  assert.equal(s[0].listed, true)
})

test('the price never reaches zero', () => {
  const s = priceSeries(days([...new Array(5).fill(90), ...new Array(200).fill(0)]))
  assert.ok(last(s).price >= PRICE.floor)
})

/* ================================================================== *
 * It has to be rebuildable
 * ================================================================== */

test('recomputing the series produces exactly the same history', () => {
  /*
   * A market whose past changes when you recompute it is not one anybody can
   * be asked to trust. The expectation looks only backwards, so this holds.
   */
  const h = days([5, 8, 40, 12, 9, 60, 22, 18, 31, 44])
  assert.deepEqual(priceSeries(h), priceSeries(h))
  assert.deepEqual(priceSeries(h).slice(0, 6), priceSeries(h.slice(0, 6)))
})

test('days arriving out of order are still priced in order', () => {
  const h = days([10, 20, 30, 40])
  const shuffled = [h[2], h[0], h[3], h[1]]
  assert.deepEqual(prices(priceSeries(shuffled)), prices(priceSeries(h)))
})

/* ================================================================== *
 * The pieces on their own
 * ================================================================== */

test('the expectation is the median of the days before, never including today', () => {
  const h = days([10, 10, 10, 90])
  assert.equal(expectedLevel(h, h[3].day), 10, 'today does not raise its own bar')
  assert.equal(expectedLevel(h, h[0].day), null, 'nothing before the first day')
  assert.equal(expectedLevel([], '2026-09-01'), null)
})

test('the expectation forgets the distant past', () => {
  const h = days([...new Array(30).fill(5), ...new Array(14).fill(50)])
  const e = expectedLevel(h, last(h).day, { window: 14 })
  assert.equal(e, 50, 'a name who has levelled up is judged at their new level')
})

test('median handles holes and empties', () => {
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 3, 2]), 2.5)
  assert.equal(median([null, 5, undefined, NaN]), 5)
  assert.equal(median([]), null)
})

test('a listing is floored, so nothing lists at nothing', () => {
  assert.equal(listingPrice(55), 55)
  assert.equal(listingPrice(0), PRICE.listFloor)
  assert.equal(listingPrice(null), PRICE.listFloor)
})

test('nextPrice needs a previous price and says so', () => {
  assert.equal(nextPrice(null, { level: 50, expected: 10 }), null)
  assert.ok(nextPrice(100, { level: 50, expected: 10 }) > 100)
  assert.ok(nextPrice(100, { level: 5, expected: 50 }) < 100)
})

/* ================================================================== *
 * Between closes
 * ================================================================== */

test('the live price is marked as not settled', () => {
  const h = days(new Array(14).fill(20))
  const live = indicativePrice(100, 60, h, { day: '2026-09-20' })
  assert.equal(live.settled, false, 'the UI must never present this as a fill')
  assert.ok(live.price > 100)
  assert.ok(live.change > 0)
})

test('an indicative price with no history yet is no price, not a guess', () => {
  assert.equal(indicativePrice(100, 60, [], { day: '2026-09-20' })?.price, 100, 'no expectation, no movement')
  assert.equal(indicativePrice(null, 60, days([10, 20])), null)
})

test('a return that cannot be computed is zero, never NaN', () => {
  /*
   * One NaN poisons every price after it for the rest of that name's
   * history, and a silent hole in a market is worse than a wrong number.
   * Zero over zero is the real case: a name at nothing, with a baseline of
   * nothing, and the smoothing turned off by a caller doing a sweep.
   */
  assert.equal(dayReturn(0, 0, { smoothing: 0 }), 0)
  // An infinity is not a reading, so it is treated as a missing one.
  assert.equal(dayReturn(Infinity, 10), 0)
  assert.equal(dayReturn(10, Infinity), 0)
  assert.equal(dayReturn(NaN, 10), 0)
  const s = priceSeries(days([0, 0, 0, 0]), { smoothing: 0 })
  assert.ok(s.every((p) => Number.isFinite(p.price)), 'no hole anywhere in the series')
})

/* ================================================================== *
 * Settling: the past is a fact
 * ================================================================== */

test('a name with no book is listed and backfilled from everything known', () => {
  // What makes the exchange openable on day one rather than in a fortnight.
  const b = settle(days([20, 25, 30, 28]), null, { upTo: '2026-09-04' })
  assert.equal(b.days.length, 4)
  assert.equal(b.listedOn, '2026-09-01')
  assert.equal(b.listedAt, b.days[0].price)
  assert.equal(b.added, 4)
})

test('today is not settled — only days that have closed are written', () => {
  const b = settle(days([20, 25, 30, 28]), null, { upTo: '2026-09-03' })
  assert.deepEqual(b.days.map((d) => d.day), ['2026-09-01', '2026-09-02', '2026-09-03'])
})

test('a day that has closed is never rewritten, even if its source changes', () => {
  /*
   * The reason a price book is stored at all. Rollups are not frozen — a
   * late snapshot or a corrected reading can move one — and a market whose
   * past changes underneath a portfolio is not one anybody should trust.
   */
  const first = settle(days([20, 25, 30]), null, { upTo: '2026-09-03' })
  const corrupted = days([20, 95, 30])           // day two "corrected" upwards
  const second = settle(corrupted, first, { upTo: '2026-09-03' })
  assert.deepEqual(second.days.map((d) => d.price), first.days.map((d) => d.price))
  assert.equal(second.added, 0, 'nothing new closed, so nothing was written')
})

test('new days are added with the whole run behind them', () => {
  const h = days([20, 25, 30, 60, 70])
  const monday = settle(h, null, { upTo: '2026-09-03' })
  const tuesday = settle(h, monday, { upTo: '2026-09-05' })
  assert.equal(tuesday.days.length, 5)
  assert.equal(tuesday.added, 2)
  // The days it already had are untouched; the new ones priced properly.
  assert.deepEqual(tuesday.days.slice(0, 3), monday.days)
  assert.ok(tuesday.days[4].price > tuesday.days[2].price, 'the new run was priced, not stubbed')
})

test('settling an empty history does not invent a listing', () => {
  const b = settle([], null, { upTo: '2026-09-03' })
  assert.deepEqual(b.days, [])
  assert.equal(b.added, 0)
})

/* ================================================================== *
 * The quote the board reads
 * ================================================================== */

test('a quote is the settled close until the day moves it', () => {
  const b = settle(days(new Array(20).fill(30)), null, { upTo: '2026-09-20' })
  const flat = quote(b)
  assert.equal(flat.settled, true)
  assert.equal(flat.price, flat.close)

  const live = quote(b, { level: 80, history: days(new Array(20).fill(30)), day: '2026-09-21' })
  assert.equal(live.settled, false, 'an indicative price must say so')
  assert.ok(live.price > live.close)
})

test('a quote carries what it has done since listing', () => {
  const b = settle(days([20, 30, 40, 50, 60]), null, { upTo: '2026-09-05' })
  const q = quote(b)
  assert.equal(q.listedAt, 20)
  assert.ok(q.sinceListing > 0, `up ${q.sinceListing}% since listing`)
})

test('a name with no closed days has no quote rather than a nonsense one', () => {
  assert.equal(quote(null), null)
  assert.equal(quote({ days: [] }), null)
})
