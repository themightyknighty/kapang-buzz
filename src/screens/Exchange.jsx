import { useEffect, useMemo, useRef, useState } from 'react'
import { useExchange } from '../lib/useExchange.js'
import { Avatar } from './Market.jsx'
import { Sparkline } from '../ui/Movement.jsx'
import { dayName } from '../lib/reportcopy.js'
import { SurfaceNav } from '../ui/SurfaceNav.jsx'
import { Tape } from '../ui/Tape.jsx'
import { liveWhyLine } from '../lib/livewhy.js'
import '../exchange.css'

/**
 * The Genie Exchange board.
 *
 * A price is not a rank, and the board has to say so on sight or people
 * read it as the chart with extra steps. Three things carry that:
 *
 *   the money is money        G$ figures with decimals, not scores out of
 *                             a hundred
 *   every row has a shape     a fortnight of closes, so a price is a story
 *                             rather than a number
 *   settled or indicative     stated once at the top and marked on every
 *                             moving row, because the difference between a
 *                             close and a guess is the whole contract
 *
 * The sorts are the editorial. Default is by price, which is the league
 * table; movers is what happened today; and "since listing" is the only
 * one that answers "who would I have been right about", which is the
 * question the game is actually made of.
 */

const money = (n) => (Number.isFinite(n)
  ? `G$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : '—')

const pct = (n) => (Number.isFinite(n) ? `${n > 0 ? '+' : ''}${n.toFixed(1)}%` : '—')

const dir = (n) => (!Number.isFinite(n) || Math.abs(n) < 0.05 ? 'flat' : n > 0 ? 'up' : 'down')

const SORTS = [
  { key: 'price', label: 'Price', of: (r) => -r.price },
  { key: 'movers', label: 'Today', of: (r) => -Math.abs(r.change || 0) },
  { key: 'rising', label: 'Rising', of: (r) => -(r.change || 0) },
  { key: 'falling', label: 'Falling', of: (r) => (r.change || 0) },
  { key: 'listing', label: 'Since listing', of: (r) => -(r.sinceListing ?? -Infinity) },
]

export default function Exchange({ feed = null, market = null }) {
  const { board, loading, error, empty, reason, ticks } = useExchange()
  const [sort, setSort] = useState('price')

  const names = useMemo(() => {
    const rows = [...(board?.names || [])]
    const by = SORTS.find((s) => s.key === sort) || SORTS[0]
    return rows.sort((a, b) => by.of(a) - by.of(b))
  }, [board, sort])

  if (loading) return <Shell feed={feed} market={market}><p className="xc-note">Opening the exchange…</p></Shell>

  if (empty) {
    return (
      <Shell feed={feed} market={market}>
        <p className="xc-note">
          {reason || 'The exchange has not opened yet.'}
        </p>
        <p className="xc-note dim">
          A name is listed once there is a day of measured attention behind it.
          Prices settle once a day and move between closes.
        </p>
      </Shell>
    )
  }

  if (error) {
    return (
      <Shell feed={feed} market={market}>
        <p className="xc-note">The exchange is not answering.</p>
        <p className="xc-note dim">{error}</p>
      </Shell>
    )
  }

  const moved = names.filter((n) => !n.settled).length
  const tape = names.map((r) => ({
    key: r.id, name: r.displayName, value: money(r.price), change: pct(r.change), dir: dir(r.change),
  }))
  const top = [...names].sort((a, b) => (b.change || 0) - (a.change || 0))
  const riser = top[0]
  const faller = top[top.length - 1]

  return (
    <Shell feed={feed} market={market} settledOn={board?.settledOn} refreshedAt={board?.refreshedAt} count={names.length} moved={moved} tape={tape}>
      <SessionClock refreshedAt={board?.refreshedAt} settledOn={board?.settledOn} moved={moved} />

      {riser && faller && (riser.change || faller.change) ? (
        <div className="xc-movers">
          <Mover row={riser} kind="up" />
          <Mover row={faller} kind="down" />
        </div>
      ) : null}

      <Analysis names={names} market={market} />
      <MarketMap names={names} ticks={ticks} />

      <div className="xc-sorts" role="tablist" aria-label="Sort the board">
        {SORTS.map((s) => (
          <button
            key={s.key} role="tab" aria-selected={sort === s.key}
            className={`xc-sort${sort === s.key ? ' on' : ''}`}
            onClick={() => setSort(s.key)}
          >{s.label}</button>
        ))}
      </div>

      <ol className="xc-board">
        <li className="xc-head" aria-hidden="true">
          <span className="xc-n" />
          <span className="xc-who">Name</span>
          <span className="xc-line">Fortnight</span>
          <span className="xc-price">Price</span>
          <span className="xc-chg">Today</span>
          <span className="xc-since">Listing</span>
        </li>
        {names.map((r, i) => <Row key={r.id} row={r} n={i + 1} tick={ticks?.get(r.id)} />)}
      </ol>
    </Shell>
  )
}

function Shell({ children, feed = null, market = null, settledOn = null, refreshedAt = null, count = 0, moved = 0, tape = [] }) {
  return (
    <div className="b-wrap xc">
      <SurfaceNav current="exchange" feed={feed} market={market} />
      {/* The tape rides above everything, because it is the thing that says
          "exchange" before a reader has parsed a single figure. */}
      <Tape items={tape} />
      <header className="xc-top">
        <h1>The Genie Exchange</h1>
        <p className="xc-sub">
          Every name on the Genie 100, priced on how much attention they are
          getting against their own normal. Fantasy money. Nothing here is a
          real security.
        </p>
        {/* The state pills that used to live here said what the session
            strip below now says, and says live — the same four facts twice,
            one set of them frozen at page load. */}
        {count > 0 && <p className="xc-state"><span className="xc-pill">{count} listed</span></p>}
      </header>
      {children}
    </div>
  )
}

/**
 * A second, ticking.
 *
 * The board's prices step every fifteen minutes. A clock does not, and it is
 * the honest way to show a screen that is awake: the figure it counts —
 * seconds since the quotes were last recomputed — is true at every instant,
 * where an animated price would be true twice an hour.
 */
function useSecond() {
  const [, bump] = useState(0)
  useEffect(() => {
    const id = setInterval(() => bump((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
}

const since = (iso) => {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const secs = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ${String(secs % 60).padStart(2, '0')}s`
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`
}

/** The strip a trading floor has above the board: state, clock, freshness. */
function SessionClock({ refreshedAt, settledOn, moved }) {
  useSecond()
  const age = since(refreshedAt)
  const open = moved > 0
  return (
    <div className="xc-session">
      <span className={`xc-sess-state${open ? ' open' : ''}`}>
        <i aria-hidden="true" />
        {open ? 'Trading' : 'Settled'}
      </span>
      <span className="xc-sess-k">
        {open ? `${moved} indicative` : 'All quotes settled'}
      </span>
      {age && (
        <span className="xc-sess-k">
          Quotes recomputed <b>{age}</b> ago
        </span>
      )}
      {settledOn && <span className="xc-sess-k dim">Last close {dayName(settledOn) || settledOn}</span>}
      <time className="xc-sess-clock" dateTime={new Date().toISOString()}>
        {new Date().toLocaleTimeString('en-GB', { hour12: false })}
      </time>
    </div>
  )
}

/**
 * The wall.
 *
 * Every listed name as one cell, coloured by the day's move — the view a
 * trading floor puts on a screen nobody is standing next to, because the
 * shape of a market is legible from across a room in a way a table is not.
 * Opacity carries magnitude so a big mover reads first; the figure is on the
 * cell as well, because colour alone is not a reading.
 */
function MarketMap({ names = [], ticks }) {
  if (names.length < 6) return null
  /*
   * Scaled on the square root of the ratio, not the ratio.
   *
   * Straight-line scaling against the biggest mover means one loud name
   * flattens the other hundred into the background: a 1% move beside a 6.7%
   * one tints at 15% and reads as nothing, so the wall looks broken on
   * exactly the ordinary day it is supposed to describe. The curve keeps the
   * ordering exactly — bigger is always darker — and lets the middle of the
   * board be visible.
   */
  const strongest = Math.max(1, ...names.map((r) => Math.abs(r.change || 0)))
  return (
    <section className="xc-map" aria-label="The board at a glance">
      <p className="xc-map-tag">The wall · {names.length} listed</p>
      <div className="xc-map-grid">
        {names.map((r) => {
          const d = dir(r.change)
          const weight = Math.sqrt(Math.min(1, Math.abs(r.change || 0) / strongest))
          const tick = ticks?.get(r.id)
          return (
            <a
              key={tick ? `${r.id}-${tick.at}` : r.id}
              href={`/market/${r.slug}`}
              className={`xc-cell ${d}${tick ? ` tick-${tick.dir}` : ''}`}
              style={{ '--w': (0.14 + weight * 0.86).toFixed(3) }}
              title={`${r.displayName} · ${money(r.price)} · ${pct(r.change)}`}
            >
              <span className="xc-cell-n">{r.displayName}</span>
              <span className="xc-cell-c">{pct(r.change)}</span>
            </a>
          )
        })}
      </div>
    </section>
  )
}

/**
 * The flow of analysis, one name at a time.
 *
 * A quote says what; it never says why. `livewhy.js` already derives that
 * from the signals behind a live market row, so the exchange rotates through
 * its movers rather than repeating a number somebody has already read.
 *
 * It advances on a timer because a reader is not clicking — this is a screen
 * to glance at. Timed, not random: the same name in the same order every
 * cycle, so somebody who looks away mid-sentence can find it again.
 */
function Analysis({ names = [], market = null }) {
  const lines = useMemo(() => {
    const rows = market?.rows || []
    return names
      .map((n) => {
        const row = rows.find((r) => r.slug === n.slug || r.id === n.id)
        const why = row ? liveWhyLine(row, { max: 130 }) : null
        return why ? { id: n.id, name: n.displayName, slug: n.slug, why, change: n.change } : null
      })
      .filter(Boolean)
      .sort((a, b) => Math.abs(b.change || 0) - Math.abs(a.change || 0))
      .slice(0, 8)
  }, [names, market])

  const [at, setAt] = useState(0)
  const count = lines.length
  useEffect(() => {
    if (count < 2) return undefined
    const id = setInterval(() => setAt((n) => (n + 1) % count), 6000)
    return () => clearInterval(id)
  }, [count])

  if (!count) return null
  const line = lines[Math.min(at, count - 1)]
  return (
    <section className="xc-analysis" aria-label="What is moving and why" aria-live="polite">
      <p className="xc-an-tag">On the move</p>
      {/* Keyed so each turn of the rotation plays its own entrance rather
          than mutating the text under the reader's eye. */}
      <p className="xc-an-line" key={line.id}>
        <a href={`/market/${line.slug}`}>{line.name}</a>
        <span className={dir(line.change)}>{pct(line.change)}</span>
        <em>{line.why}</em>
      </p>
      <span className="xc-an-dots" aria-hidden="true">
        {lines.map((l, i) => <i key={l.id} className={i === (at % count) ? 'on' : undefined} />)}
      </span>
    </section>
  )
}

function Mover({ row, kind }) {
  return (
    <a className={`xc-mover ${kind}`} href={`/market/${row.slug}`}>
      <span className="xc-mover-k">{kind === 'up' ? 'Biggest riser' : 'Biggest faller'}</span>
      <span className="xc-mover-n">{row.displayName}</span>
      <span className={`xc-mover-c ${dir(row.change)}`}>{pct(row.change)}</span>
      <span className="xc-mover-p">{money(row.price)}</span>
    </a>
  )
}

function Row({ row, n, tick = null }) {
  // Sparkline speaks in { day, level }; a book speaks in { day, price }.
  const series = (row.series || []).map((p) => ({ day: p.day, level: p.price }))
  return (
    <li className="xc-row">
      <span className="xc-n">{n}</span>
      <a className="xc-who" href={`/market/${row.slug}`}>
        <Avatar row={row} />
        <span className="xc-name">{row.displayName}</span>
      </a>
      <span className="xc-line">
        {series.length > 1
          ? <Sparkline series={series} w={96} h={28} label={`${row.displayName} price`} />
          : <span className="xc-new">new</span>}
      </span>
      <span className="xc-price">
        {/* Remounted on each tick so a name that moves the same way twice
            still replays its own flash. Nothing flashes without a price
            that actually changed. */}
        <span
          key={tick ? `${row.id}-${tick.at}` : row.id}
          className={tick ? `xc-tick ${tick.dir}` : undefined}
        >{money(row.price)}</span>
        {!row.settled && <em className="xc-ind" title="Indicative — settles at the close">·</em>}
      </span>
      <span className={`xc-chg ${dir(row.change)}`}>{pct(row.change)}</span>
      <span className={`xc-since ${dir(row.sinceListing)}`}>{pct(row.sinceListing)}</span>
    </li>
  )
}
