import { useMemo, useState } from 'react'
import { useExchange } from '../lib/useExchange.js'
import { Avatar } from './Market.jsx'
import { Sparkline } from '../ui/Movement.jsx'
import { dayName } from '../lib/reportcopy.js'
import { SurfaceNav } from '../ui/SurfaceNav.jsx'
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

export default function Exchange() {
  const { board, loading, error, empty, reason } = useExchange()
  const [sort, setSort] = useState('price')

  const names = useMemo(() => {
    const rows = [...(board?.names || [])]
    const by = SORTS.find((s) => s.key === sort) || SORTS[0]
    return rows.sort((a, b) => by.of(a) - by.of(b))
  }, [board, sort])

  if (loading) return <Shell><p className="xc-note">Opening the exchange…</p></Shell>

  if (empty) {
    return (
      <Shell>
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
      <Shell>
        <p className="xc-note">The exchange is not answering.</p>
        <p className="xc-note dim">{error}</p>
      </Shell>
    )
  }

  const moved = names.filter((n) => !n.settled).length
  const top = [...names].sort((a, b) => (b.change || 0) - (a.change || 0))
  const riser = top[0]
  const faller = top[top.length - 1]

  return (
    <Shell settledOn={board?.settledOn} refreshedAt={board?.refreshedAt} count={names.length} moved={moved}>
      {riser && faller && (riser.change || faller.change) ? (
        <div className="xc-movers">
          <Mover row={riser} kind="up" />
          <Mover row={faller} kind="down" />
        </div>
      ) : null}

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
        {names.map((r, i) => <Row key={r.id} row={r} n={i + 1} />)}
      </ol>
    </Shell>
  )
}

function Shell({ children, settledOn = null, refreshedAt = null, count = 0, moved = 0 }) {
  return (
    <div className="b-wrap xc">
      <SurfaceNav current="exchange" />
      <header className="xc-top">
        <h1>The Genie Exchange</h1>
        <p className="xc-sub">
          Every name on the Genie 100, priced on how much attention they are
          getting against their own normal. Fantasy money. Nothing here is a
          real security.
        </p>
        {count > 0 && (
          <p className="xc-state">
            <span className="xc-pill">{count} listed</span>
            {settledOn && <span className="xc-pill">Settled {dayName(settledOn) || settledOn}</span>}
            {moved > 0
              ? <span className="xc-pill live"><span className="dot" />{moved} moving — indicative</span>
              : <span className="xc-pill">No trading yet today</span>}
            {refreshedAt && <span className="xc-pill dim">Updated {new Date(refreshedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
          </p>
        )}
      </header>
      {children}
    </div>
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

function Row({ row, n }) {
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
        {money(row.price)}
        {!row.settled && <em className="xc-ind" title="Indicative — settles at the close">·</em>}
      </span>
      <span className={`xc-chg ${dir(row.change)}`}>{pct(row.change)}</span>
      <span className={`xc-since ${dir(row.sinceListing)}`}>{pct(row.sinceListing)}</span>
    </li>
  )
}
