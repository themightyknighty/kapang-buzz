/**
 * Who is gaining and losing attention right now — and why.
 *
 * The market knows that a celebrity's gossip score is moving. It does not know
 * what happened to them: GDELT's knowledge graph hands us names and article
 * URLs, never headlines. So the reason comes from our own published story when
 * we have one, and when we do not, from naming the outlets driving the
 * coverage and linking out to them. What it never does is write a reason to
 * fill the gap — a mover with nothing behind it says exactly that.
 *
 * Pure, so the front page, the Watch screen and the tests all read the same
 * board from the same two inputs.
 */

const norm = (s) => (s || '').toLowerCase()
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim()

const padded = (s) => ` ${norm(s)} `

/**
 * The three ways the board can measure movement, best first.
 *
 * `change24h` is the one worth showing, but it needs a day of stored history
 * and the market spends its first day filling that in. `change1h` is the move
 * since the last 15-minute update. `momentum` is the engine's own rate-of-
 * change and is always defined, so the board is never empty — it is just
 * measuring something coarser and says so.
 */
export const BASES = {
  day: { field: 'change24h', short: '24h', label: 'change in gossip score vs 24 hours ago', suffix: ' pts', dp: 1 },
  update: { field: 'change1h', short: 'live', label: 'change in gossip score since the last update', suffix: ' pts', dp: 1 },
  momentum: { field: 'momentum', short: 'mom', label: 'momentum — how fast coverage is accelerating, −100 to +100', suffix: '', dp: 0 },
}

/**
 * One basis for the whole board, never a mix.
 *
 * A list where one name moved against yesterday and the next against fifteen
 * minutes ago is not a ranking of anything.
 */
export function basisFor(rows, { min = 3 } = {}) {
  const order = ['day', 'update', 'momentum']
  const usable = (k) => rows.filter((r) => Number.isFinite(r[BASES[k].field]) && r[BASES[k].field] !== 0).length
  // The best measure that covers enough of the board to be a ranking...
  const broad = order.find((k) => usable(k) >= min)
  // ...and failing that, the best one with anything in it at all, because a
  // market of four names with real 24-hour moves should still show them.
  return broad || order.find((k) => usable(k) > 0) || 'momentum'
}

/**
 * Our published stories about this person.
 *
 * `people` is the trustworthy field — the pipeline put the name there. The
 * copy is only searched for the FULL name, because a surname on its own is how
 * Taylor Swift ends up credited with a story about Jonathan Swift.
 */
export function storiesAbout(row, stories = []) {
  const name = norm(row?.displayName)
  if (!name) return []
  const byPerson = stories.filter((s) => (s.people || []).some((p) => norm(p) === name))
  if (byPerson.length) return byPerson
  const needle = ` ${name} `
  return stories.filter((s) => padded(`${s.headline} ${s.caption || ''}`).includes(needle))
}

const newestFirst = (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)

/** Outlet names read better than bare domains, without inventing a brand. */
export const outletName = (domain) => (domain || '').replace(/^www\./, '')

const listOf = (xs) => (xs.length <= 1 ? xs[0] || '' : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)

/**
 * Why this name is moving — our story, the outlets covering it, or an honest
 * admission that we do not know yet.
 */
export function reasonFor(row, stories = []) {
  const story = storiesAbout(row, stories).sort(newestFirst)[0]
  if (story) {
    return {
      kind: 'story',
      story,
      headline: story.headline,
      text: story.whyTrending || story.caption,
      href: `/story/${story.id}`,
      outlets: story.outlets ?? null,
    }
  }
  const domains = [...new Set((row.drivers || []).map((d) => outletName(d.domain)).filter(Boolean))]
  if (domains.length) {
    const shown = domains.slice(0, 3)
    const more = domains.length - shown.length
    return {
      kind: 'coverage',
      headline: null,
      text: `Being covered by ${listOf(shown)}${more > 0 ? ` and ${more} more` : ''}`,
      href: row.drivers?.[0]?.url || null,
      outlets: domains.length,
      domains,
    }
  }
  return { kind: 'none', headline: null, text: 'No story behind this one yet', href: null, outlets: null }
}

/**
 * The same reason, cut down to a clause that fits under a name on a board.
 *
 * A row on the front page or on air has one line for this, so it takes the
 * headline where we have one and who is covering it where we do not. It
 * returns null rather than filler when there is nothing to say — a board of
 * rows all captioned "no story yet" is worse than a board of bare names.
 */
export function shortReason(reason, { max = 72 } = {}) {
  if (!reason || reason.kind === 'none') return null
  const s = (reason.kind === 'story' ? reason.headline || reason.text : reason.text) || ''
  const clean = s.trim()
  if (!clean) return null
  // Cut at a word so a clipped headline still reads as English.
  if (clean.length <= max) return clean
  return `${clean.slice(0, max).replace(/\s+\S*$/, '')}…`
}

/**
 * The board: risers, fallers, and the reason beside each.
 *
 * Only names the market actually measured appear. A celebrity with no
 * coverage at all can still wobble a point on noise, and putting that on the
 * front page as a riser would be a lie told in good faith.
 */
export function marketMovers(market, feed, { count = 5 } = {}) {
  const rows = (market?.rows || []).filter((r) => (r.mentions || 0) > 0)
  const basis = basisFor(rows)
  const B = BASES[basis]
  const stories = feed?.stories || []

  const moves = rows
    .map((row) => ({ row, move: Number.isFinite(row[B.field]) ? row[B.field] : null }))
    .filter((x) => x.move != null && x.move !== 0)

  const dress = (x, direction) => ({
    id: x.row.id,
    name: x.row.displayName,
    slug: x.row.slug,
    href: `/market/${x.row.slug}`,
    score: x.row.gossipScore,
    move: Number(x.move.toFixed(B.dp)),
    moveText: `${x.move > 0 ? '+' : ''}${x.move.toFixed(B.dp)}${B.suffix}`,
    direction,
    status: x.row.status,
    mentions: x.row.mentions,
    reason: reasonFor(x.row, stories),
  })

  const risers = moves.filter((x) => x.move > 0).sort((a, b) => b.move - a.move).slice(0, count).map((x) => dress(x, 'up'))
  const fallers = moves.filter((x) => x.move < 0).sort((a, b) => a.move - b.move).slice(0, count).map((x) => dress(x, 'down'))

  return {
    basis, basisLabel: B.label, basisShort: B.short, suffix: B.suffix, dp: B.dp,
    risers, fallers,
    measured: rows.length,
    mock: Boolean(market?.mock),
    generatedAt: market?.generatedAt || null,
    empty: risers.length === 0 && fallers.length === 0,
    // Why the board is bare, when it is — the warm-up and a broken market are
    // different things and the screen should not say the same thing for both.
    emptyReason: !market ? 'The market has not loaded yet'
      : rows.length === 0 ? 'No coverage measured yet — the market fills in over its first day'
        : 'Nothing has moved since the last update',
  }
}

/** Alternating risers and fallers, for the ticker tape. */
export function tapeItems(movers, { max = 12 } = {}) {
  const out = []
  for (let i = 0; i < Math.max(movers.risers.length, movers.fallers.length) && out.length < max; i++) {
    if (movers.risers[i]) out.push(movers.risers[i])
    if (movers.fallers[i] && out.length < max) out.push(movers.fallers[i])
  }
  return out
}

/** The one name worth telling the story of this time round. */
export function biggestMover(movers) {
  const all = [...movers.risers, ...movers.fallers]
  const withStory = all.filter((m) => m.reason.kind === 'story')
  const rank = (a, b) => Math.abs(b.move) - Math.abs(a.move)
  return (withStory.length ? withStory.sort(rank) : all.slice().sort(rank))[0] || null
}
