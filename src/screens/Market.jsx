/**
 * The Celebrity Market — a ranked table of who is attracting an unusual
 * amount of attention right now.
 *
 * The number here does NOT answer "who is most famous?". It answers "who is
 * attracting an unusual amount of attention right now?", which is why a
 * mid-tier name in the middle of a real story can sit above an A-lister.
 *
 * No scoring happens in this file. Every number was computed at ingestion
 * time and stored; the UI reads and arranges, nothing more.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { MARKET_TABS, STATUS_TONE, CATEGORIES } from '../../market/config.mjs'
import { filterTab } from '../../market/rank.mjs'
import { SurfaceNav } from '../ui/SurfaceNav.jsx'
import { liveWhyLine } from '../lib/livewhy.js'
import { sinceLabel, signed, dirOf } from '../lib/useMarket.js'
import { marketMovers } from '../lib/movers.js'
import { WhyLine } from '../ui/Why.jsx'
import { Share } from '../ui/Share.jsx'
import { marketShare } from '../lib/share.js'

const initials = (name) => name.split(' ').slice(0, 2).map((w) => w[0]).join('')

/** Their picture, or their initials — never a browser's broken-image glyph. */
export function Avatar({ row, big = false }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [row.imageUrl])
  return (
    <span className={big ? 'mkt-hero-av' : 'mkt-av'}>
      {row.imageUrl && !failed
        ? <img src={row.imageUrl} alt="" loading="lazy" onError={() => setFailed(true)} />
        : initials(row.displayName)}
    </span>
  )
}

/**
 * A sparkline of the last 24 hours. One series, so no legend — the column
 * names it. Its colour describes the line itself (where it started against
 * where it ended), not the celebrity's momentum: a rising line drawn in red
 * because momentum turned an hour ago just reads as a mistake.
 */
export function Spark({ points, w = 80, h = 22 }) {
  if (points?.length < 2) return null
  const vals = points.map((p) => p.v)
  const net = vals.at(-1) - vals[0]
  const tone = net > 0.5 ? 'up' : net < -0.5 ? 'down' : 'flat'
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const span = hi - lo || 1
  const d = points.map((p, i) => {
    const x = (i / Math.max(1, points.length - 1)) * w
    const y = h - ((p.v - lo) / span) * h
    return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')
  const stroke = tone === 'up' ? 'var(--up)' : tone === 'down' ? 'var(--down)' : 'var(--flat)'
  return (
    <svg viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={d} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function Card({ label, card, format, tone }) {
  if (card.empty) {
    return (
      <div className={`mkt-card${tone ? ` ${tone}` : ''}`}>
        <span className="mkt-card-label">{label}</span>
        <span className="mkt-card-empty">{card.reason}</span>
      </div>
    )
  }
  const c = card.celebrity
  const { text, dir } = format(c)
  return (
    <a className={`mkt-card${tone ? ` ${tone}` : ''}`} href={`/market/${c.slug}`}>
      <span className="mkt-card-label">{label}</span>
      <span className="mkt-card-name">{c.displayName}</span>
      <span className={`mkt-card-val${dir ? ` ${dir}` : ''}`}>{text}</span>
    </a>
  )
}

/**
 * Who is moving and why — the market's own answer, in words rather than in a
 * column of signed numbers.
 *
 * The table below it ranks a hundred names by score. This ranks a handful by
 * movement and, beside each, says what happened: our story where we published
 * one, the outlets driving it where we did not, and plainly nothing where
 * there is nothing. The reason links to the thing it is describing, so a
 * number on this screen is always one click from its evidence.
 */
function MoversBoard({ movers }) {
  if (movers.empty) return null
  const col = (label, list, dir) => (
    <div className={`mkt-mv-col ${dir}`}>
      <h3>{label}</h3>
      {list.map((m) => (
        <div key={m.id} className="mkt-mv-item">
          <a className="mkt-mv-name" href={m.href}>
            <span className="nm">{m.name}</span>
            <span className="mv">{m.moveText}</span>
          </a>
          {/* The explanation first, derived from the score. */}
          {m.why && <p className="mkt-mv-why">{m.why}</p>}
          {/* Then somewhere to go — but only a story we actually published.
              "Being covered by outlet-1.test" under a heading reading "why
              the market is moving" is not an answer to the heading. */}
          {m.reason?.kind === 'story' && <WhyLine reason={m.reason} max={150} />}
          {/* A mover is the unit people pass on — "look who's up today" —
              so the share sits on the row, not only on the board. */}
          <Share
            compact
            label="Share"
            /* moveText already carries its own sign, so the direction is
               said in words and the sign is dropped — "is up +44.4" is not
               something anybody writes. */
            title={`${m.name} is ${dir === 'up' ? 'up' : 'down'} ${m.moveText.replace(/^[+−-]/, '')} on the Gossip Genie Celebrity Market`}
            text={m.reason?.headline || m.reason?.text || ''}
            path={m.href}
            tone={dir === 'up' ? 'var(--health)' : 'var(--warm-hot)'}
          />
        </div>
      ))}
      {!list.length && <p className="mkt-note">Nothing {dir === 'up' ? 'rising' : 'falling'} on this measure yet.</p>}
    </div>
  )
  return (
    <section className="mkt-movers">
      <div className="mkt-movers-head">
        <h2>Why the market is moving</h2>
        <span>{movers.basisLabel} · {movers.measured} celebrities measured</span>
      </div>
      <div className="mkt-mv-cols">
        {col('Rising', movers.risers, 'up')}
        {col('Falling', movers.fallers, 'down')}
      </div>
    </section>
  )
}

// `short` is what the header says on a phone, where the full label does not fit
// its column. Truncating a header with an ellipsis instead would read as broken.
const COLUMNS = [
  { key: 'rank', label: 'Rank', short: '#', cls: 'mkt-rank l' },
  { key: 'displayName', label: 'Celebrity', short: 'Celebrity', cls: 'l' },
  { key: 'gossipScore', label: 'Gossip Score', short: 'Score', cls: 'mkt-score' },
  { key: 'change24h', label: 'Change', short: '24h', cls: 'mkt-chg' },
  { key: 'momentum', label: 'Trend', short: '', cls: 'mkt-trend' },
  { key: 'spark', label: '24h', cls: 'mkt-spark opt', nosort: true },
  { key: 'mentions', label: 'News Mentions', cls: 'mkt-num opt' },
  { key: 'gossipScore2', label: 'Attention', cls: 'mkt-att opt', sortBy: 'gossipScore' },
  { key: 'momentum2', label: 'Momentum', cls: 'mkt-mom opt', sortBy: 'momentum' },
  { key: 'status', label: 'Status', cls: 'mkt-status opt' },
]

function Row({ r, flash }) {
  const why = liveWhyLine(r, { max: 78 })
  const chg = dirOf(r.change24h)
  const mom = dirOf(r.momentum)
  const move = r.isNew ? { cls: 'new', text: 'NEW' }
    : r.rankChange > 0 ? { cls: 'up', text: `▲${r.rankChange}` }
      : r.rankChange < 0 ? { cls: 'down', text: `▼${Math.abs(r.rankChange)}` } : null
  return (
    <tr className={flash ? `flash-${flash}` : ''}>
      <td className="mkt-rank l">{r.rank}{move && <span className={`mv ${move.cls}`}>{move.text}</span>}</td>
      <td className="l">
        <span className="mkt-who">
          <Avatar row={r} />
          <span className="mkt-who-body">
            <span className="mkt-who-name">
              <a href={`/market/${r.slug}`}>{r.displayName}</a>
              <span className="mkt-cat">{CATEGORIES[r.primaryCategory]}</span>
            </span>
            {/* Why, not just how much. Every other column on this row is a
                figure; this is the one that says what the figures mean, and
                it is derived from them rather than looked up beside them. */}
            {why && <span className="mkt-why">{why}</span>}
          </span>
        </span>
      </td>
      <td className="mkt-score">
        {r.gossipScore.toFixed(1)}
        {r.confidence < 0.5 && <span className="mkt-low" title="Scored on thin evidence">THIN</span>}
      </td>
      <td className={`mkt-chg ${chg}`}>{signed(r.change24h, 1)}</td>
      <td className={`mkt-trend ${mom}`}>{r.trend}</td>
      <td className="mkt-spark opt"><Spark points={(r.scoreSeries || []).slice(-96)} /></td>
      <td className="mkt-num opt">{r.mentions.toLocaleString()}</td>
      <td className="mkt-att opt">{r.attention}</td>
      <td className={`mkt-mom opt ${mom}`}>
        <span className="bar" aria-hidden="true">
          <i style={r.momentum >= 0
            ? { left: '50%', width: `${Math.min(50, Math.abs(r.momentum) / 2)}%` }
            : { left: `${50 - Math.min(50, Math.abs(r.momentum) / 2)}%`, width: `${Math.min(50, Math.abs(r.momentum) / 2)}%` }} />
        </span>
        {r.momentum.toFixed(0)}
      </td>
      <td className="mkt-status opt"><span className={`mkt-chip ${STATUS_TONE[r.status] || 'neutral'}`}>{r.status}</span></td>
    </tr>
  )
}

export default function Market({ market, feed }) {
  const [tab, setTab] = useState('top')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState({ key: 'rank', dir: 1 })
  // Which rows moved since the last poll, so they can flash the way they moved.
  const [flashes, setFlashes] = useState({})
  const prevScores = useRef(null)

  useEffect(() => {
    if (!market?.rows) return
    const now = Object.fromEntries(market.rows.map((r) => [r.id, r.gossipScore]))
    if (prevScores.current) {
      const next = {}
      for (const [id, v] of Object.entries(now)) {
        const was = prevScores.current[id]
        if (was != null && Math.abs(v - was) > 0.05) next[id] = v > was ? 'up' : 'down'
      }
      if (Object.keys(next).length) {
        setFlashes(next)
        const t = setTimeout(() => setFlashes({}), 1300)
        prevScores.current = now
        return () => clearTimeout(t)
      }
    }
    prevScores.current = now
  }, [market])

  const movers = useMemo(() => marketMovers(market, feed), [market, feed])

  const counts = useMemo(() => {
    if (!market?.rows) return {}
    return Object.fromEntries(MARKET_TABS.map((t) => [t.key, filterTab(market.rows, t.key).length]))
  }, [market])

  const rows = useMemo(() => {
    if (!market?.rows) return []
    let list = query.trim()
      ? market.rows.filter((r) => r.displayName.toLowerCase().includes(query.trim().toLowerCase()))
      : filterTab(market.rows, tab)
    const col = COLUMNS.find((c) => c.key === sort.key)
    const key = col?.sortBy || sort.key
    list = list.slice().sort((a, b) => {
      const av = a[key], bv = b[key]
      if (typeof av === 'string') return sort.dir * av.localeCompare(bv)
      return sort.dir * ((av ?? -Infinity) - (bv ?? -Infinity))
    })
    return list
  }, [market, tab, query, sort])

  if (!market) return <div className="mkt"><div className="mkt-thin">Opening the market…</div></div>

  const sortOn = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === 'rank' || key === 'displayName' ? 1 : -1 }))
  const fresh = (Date.now() - Date.parse(market.generatedAt)) / 1000
  const nextIn = Math.max(0, Math.round((Date.parse(market.nextUpdateAt) - Date.now()) / 60000))

  return (
    <div className="mkt">
      {market.mock && (
        <div className="mkt-mock">
          Mock market — synthetic data for development. Not real attention figures.
        </div>
      )}

      <SurfaceNav current="market" feed={feed} market={market} />
      <header className="mkt-head">
        <div className="mkt-head-top">
          <h1 className="mkt-title">Celebrity Market</h1>
          <span className="mkt-sub">Attention index</span>
          <div className="mkt-head-right">
            <span className="mkt-live"><i />Live</span>
            <span>Updated {sinceLabel(fresh)}{nextIn > 0 ? ` · next in ${nextIn}m` : ''}</span>
            <Share {...marketShare(movers)} label="Share the board" />
          </div>
        </div>
        <div className="mkt-strip">
          <span><b>{market.summary.tracked}</b> tracked</span>
          <span className="up"><b>{market.summary.rising}</b> rising</span>
          <span className="down"><b>{market.summary.falling}</b> falling</span>
          {market.summary.breaking > 0 && <span className="alert"><b>{market.summary.breaking}</b> breaking</span>}
          <span><b>{market.summary.totalMentions.toLocaleString()}</b> stories measured</span>
          <span>Market average <b>{market.summary.averageScore.toFixed(1)}</b></span>
        </div>
      </header>

      <div className="mkt-cards">
        <Card label="Hottest right now" card={market.cards.hottest}
          format={(c) => ({ text: `${c.gossipScore.toFixed(1)} · ${c.attention}` })} />
        <Card label="Biggest riser" card={market.cards.riser}
          format={(c) => ({ text: `${signed(c.change24h, 1)} in 24h`, dir: 'up' })} />
        <Card label="Biggest faller" card={market.cards.faller}
          format={(c) => ({ text: `${signed(c.change24h, 1)} in 24h`, dir: 'down' })} />
        <Card label="Most covered" card={market.cards.mostCovered}
          format={(c) => ({ text: `${c.mentions.toLocaleString()} stories` })} />
        <Card label="Breaking" tone="alert" card={market.cards.breaking}
          format={(c) => ({ text: `${c.gossipScore.toFixed(1)} · momentum ${c.momentum.toFixed(0)}` })} />
      </div>

      <MoversBoard movers={movers} />

      <div className="mkt-barrow">
        <nav className="mkt-bar" aria-label="Filter the market">
          {MARKET_TABS.map((t) => (
            <button key={t.key} className={`mkt-tab${tab === t.key && !query ? ' on' : ''}`}
              onClick={() => { setTab(t.key); setQuery('') }}>
              {t.label}<span className="n">{counts[t.key] ?? 0}</span>
            </button>
          ))}
        </nav>
        <div className="mkt-search">
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search celebrity…" aria-label="Search the market" />
        </div>
      </div>

      <table className="mkt-table">
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th key={c.key} className={`${c.cls}${sort.key === c.key ? ' sorted' : ''}`}
                onClick={c.nosort ? undefined : () => sortOn(c.key)}
                style={c.nosort ? { cursor: 'default' } : undefined}>
                <span className="full">{c.label}</span>
                <span className="short">{c.short ?? c.label}</span>
                {sort.key === c.key && <span className="car">{sort.dir > 0 ? '▲' : '▼'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => <Row key={r.id} r={r} flash={flashes[r.id]} />)}
        </tbody>
      </table>

      {!rows.length && (
        <p className="mkt-thin">
          {query ? `No tracked celebrity matches “${query}”. The market tracks ${market.summary.tracked} names — they can be added to the roster.`
            : 'Nothing in this category right now.'}
        </p>
      )}
    </div>
  )
}
