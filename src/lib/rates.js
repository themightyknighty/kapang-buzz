/**
 * What a celebrity is worth, for a surface that has just said their name.
 *
 * A story names up to four people and said nothing about any of them. The
 * market knows all of them, so a reader who has just read about somebody has
 * no idea whether this is the biggest week of their life or a Tuesday.
 *
 * Two figures, and they are not the same claim:
 *
 *   score   the Gossip Score, 0-100, recomputed every fifteen minutes.
 *           Every tracked name has one.
 *   price   the Exchange price in G$, settled once a day. Fantasy money,
 *           and only for names the Exchange has listed — most have none,
 *           so it is shown where it exists and omitted where it does not
 *           rather than printed as a dash.
 *
 * Pure. The surfaces pass in what they have already loaded.
 */

const norm = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').trim()
const has = (n) => Number.isFinite(n)

/**
 * One name's rate, or null.
 *
 * Matched on the normalised display name, the same way `storiesAbout` goes
 * the other way — so "Beyoncé" in a story finds "Beyonce" on the board.
 */
export function rateFor(name, { market = null, board = null } = {}) {
  const wanted = norm(name)
  if (!wanted) return null

  const row = (market?.rows || []).find((r) => norm(r.displayName) === wanted)
  if (!row) return null

  const listed = (board?.names || []).find((n) => n.slug === row.slug || n.id === row.id) || null

  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    href: `/market/${row.slug}`,
    score: has(row.gossipScore) ? row.gossipScore : null,
    change24h: has(row.change24h) ? row.change24h : null,
    rank: has(row.rank) ? row.rank : null,
    // Absent for most names, and absent is the honest rendering.
    price: has(listed?.price) ? listed.price : null,
    priceChange: has(listed?.change) ? listed.change : null,
    settled: Boolean(listed?.settled),
  }
}

/** The rates for the people a story names, in the order it named them. */
export function ratesFor(people = [], ctx = {}) {
  return (people || []).map((p) => rateFor(p, ctx)).filter(Boolean)
}

/** `G$1,204.50`, or null when this name is not listed. */
export function priceLabel(rate) {
  if (!has(rate?.price)) return null
  return `G$${rate.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** The score, to one decimal, the way every other surface prints it. */
export function scoreLabel(rate) {
  return has(rate?.score) ? rate.score.toFixed(1) : null
}
