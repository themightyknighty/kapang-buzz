/**
 * One celebrity's page — the score over time, what it is made of, and what
 * moved it.
 *
 * The chart is a single series, so it carries no legend: the title names it.
 * The component breakdown is four fixed categories, each direct-labelled and
 * colour-coded in a fixed order, so identity never rests on colour alone.
 *
 * Every figure here was computed at ingestion. Nothing is scored in the UI.
 */
import { useMemo, useState } from 'react'
import { STATUS_TONE, CATEGORIES } from '../../market/config.mjs'
import { SurfaceNav } from '../ui/SurfaceNav.jsx'
import { liveWhy } from '../lib/livewhy.js'
import { sinceLabel, signed, dirOf } from '../lib/useMarket.js'
import { Avatar } from './Market.jsx'
import { reasonFor, BASES, basisFor } from '../lib/movers.js'
import { Why } from '../ui/Why.jsx'
import { Share } from '../ui/Share.jsx'
import { celebrityShare } from '../lib/share.js'

/**
 * The move the share sheet is allowed to claim.
 *
 * The same three-way fallback the boards use: a market a few hours old has no
 * 24-hour figure, and a link that says "up 18.4 today" when the market has
 * only been running since lunchtime is a lie the reader cannot check.
 */
function moveShown(row, rows = []) {
  const B = BASES[basisFor(rows?.length ? rows : [row])]
  const value = Number.isFinite(row?.[B.field]) ? Number(row[B.field].toFixed(B.dp)) : null
  return { value, label: B.short === '24h' ? 'today' : B.short }
}

const RANGES = [
  { key: '1h', label: '1H', hours: 1 },
  { key: '6h', label: '6H', hours: 6 },
  { key: '24h', label: '24H', hours: 24 },
  { key: '7d', label: '7D', hours: 168 },
  { key: '30d', label: '30D', hours: 720 },
]

/** Fixed order, never cycled. Validated for CVD and contrast on this surface. */
const COMPONENTS = [
  { key: 'news', label: 'News attention', colour: 'var(--c-news)', source: 'news' },
  { key: 'momentum', label: 'Momentum', colour: 'var(--c-momentum)' },
  { key: 'wikipedia', label: 'Wikipedia interest', colour: 'var(--c-wikipedia)', source: 'wikipedia' },
  { key: 'breadth', label: 'Coverage breadth', colour: 'var(--c-breadth)' },
]

const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const dayLabel = (t) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' })

/**
 * The score over time, with a crosshair and tooltip — an SVG chart is
 * interactive by default, so hovering has to tell you the value.
 */
function ScoreChart({ points, range }) {
  const [hover, setHover] = useState(null)
  const W = 1000, H = 260, PAD = { l: 38, r: 12, t: 10, b: 22 }

  const geom = useMemo(() => {
    if (points.length < 2) return null
    const vals = points.map((p) => p.v)
    const lo = Math.max(0, Math.floor(Math.min(...vals) / 10) * 10 - 2)
    const hi = Math.min(100, Math.ceil(Math.max(...vals) / 10) * 10 + 2)
    const span = hi - lo || 1
    const x = (i) => PAD.l + (i / (points.length - 1)) * (W - PAD.l - PAD.r)
    const y = (v) => PAD.t + (1 - (v - lo) / span) * (H - PAD.t - PAD.b)
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ')
    const area = `${line} L${x(points.length - 1).toFixed(1)} ${y(lo)} L${x(0).toFixed(1)} ${y(lo)} Z`
    const ticks = [lo, lo + span / 2, hi]
    return { x, y, line, area, lo, hi, ticks }
  }, [points])

  if (!geom) return <p className="mkt-thin">Not enough history yet for this range.</p>

  const net = points.at(-1).v - points[0].v
  const tone = net >= 0 ? 'var(--up)' : 'var(--down)'
  // A 24-hour window crosses midnight, so bare times at the ends are ambiguous.
  const labelFor = range.hours > 48 ? dayLabel
    : range.hours >= 24 ? (t) => `${dayLabel(t)} ${clock(t)}` : clock

  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect()
    const rel = ((e.clientX - box.left) / box.width) * W
    const i = Math.round(((rel - PAD.l) / (W - PAD.l - PAD.r)) * (points.length - 1))
    if (i >= 0 && i < points.length) setHover(i)
  }

  // The plot is stretched to the container width, so any text inside the SVG
  // would be stretched with it. Labels are HTML, positioned over the plot.
  const pctX = (i) => `${(geom.x(i) / W) * 100}%`
  const pctY = (v) => `${(geom.y(v) / H) * 100}%`

  return (
    <div className="mkt-chart">
      <div className="mkt-chart-title">Gossip Score · last {range.label}</div>
      <div className="mkt-plot">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        role="img" aria-label={`Gossip Score over the last ${range.label}`}>
        <defs>
          <linearGradient id="mktFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tone} stopOpacity="0.22" />
            <stop offset="100%" stopColor={tone} stopOpacity="0" />
          </linearGradient>
        </defs>
        {geom.ticks.map((t) => (
          <line key={t} className="grid" x1={PAD.l} x2={W - PAD.r} y1={geom.y(t)} y2={geom.y(t)} />
        ))}
        <path d={geom.area} fill="url(#mktFill)" />
        <path d={geom.line} fill="none" stroke={tone} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {hover != null && (
          <g>
            <line className="grid" x1={geom.x(hover)} x2={geom.x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--ink-faint)" />
            <circle cx={geom.x(hover)} cy={geom.y(points[hover].v)} r="4" fill={tone} stroke="var(--deck)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {geom.ticks.map((t) => (
        <span className="mkt-ytick" key={t} style={{ top: pctY(t) }}>{Math.round(t)}</span>
      ))}
      <span className="mkt-xtick start">{labelFor(points[0].t)}</span>
      <span className="mkt-xtick end">{labelFor(points.at(-1).t)}</span>
      </div>
      {hover != null && (
        <div className="mkt-tip" style={{ left: pctX(hover), top: 8, transform: 'translateX(-50%)' }}>
          <b>{points[hover].v.toFixed(1)}</b>
          <em>{labelFor(points[hover].t)} {range.hours <= 48 ? '' : clock(points[hover].t)}</em>
        </div>
      )}
    </div>
  )
}

/**
 * The biggest jump in the window, and the story cluster whose arrival best
 * lines up with it. Where nothing correlates it says so — an unexplained
 * spike labelled as such is more useful than a wrong explanation.
 */
function spikeFor(points, drivers) {
  if (points.length < 6) return null
  let best = { gain: 0, i: -1 }
  for (let i = 1; i < points.length; i++) {
    const gain = points[i].v - points[i - 1].v
    if (gain > best.gain) best = { gain, i }
  }
  if (best.gain < 6) return null
  const at = points[best.i].t
  const near = (drivers || [])
    .map((d) => ({ d, gap: Math.abs(Date.parse(d.firstSeen ?? d.publishedAt ?? 0) - at) }))
    .filter((x) => Number.isFinite(x.gap) && x.gap < 3 * 3600000)
    .sort((a, b) => a.gap - b.gap)[0]
  return {
    at, from: points[best.i - 1].v, to: points[best.i].v,
    driver: near?.d || null,
  }
}

/**
 * The photograph's credit, which is not decoration.
 *
 * Every portrait here is under a Creative Commons licence, and attribution is
 * the condition of using it. So the credit appears wherever the picture does,
 * linking to the licence and to the file on Commons — which is also how a
 * reader checks for themselves that it is the right person.
 */
function PortraitCredit({ row }) {
  if (!row.imageUrl || !row.imageCredit) return null
  // Clamped to two lines, with the whole attribution in the title. Some
  // photographers ask to be credited as "© Name, longstudioname.com", which
  // set loose under a 112px avatar becomes a five-line paragraph that dwarfs
  // the picture it belongs to. The link to the file on Commons carries the
  // full, canonical credit either way.
  const full = [row.imageCredit, row.imageLicence, row.imageProvider].filter(Boolean).join(' · ')
  return (
    <p className="mkt-credit" title={`Photo: ${full}`}>
      <span className="who">
        {row.imageSourceUrl
          ? <a href={row.imageSourceUrl} target="_blank" rel="noopener noreferrer">{row.imageCredit}</a>
          : row.imageCredit}
      </span>
      {/* The licence gets its own line, never the clamped one. Naming the
          photographer and naming the licence are both conditions of using the
          picture, and a clamp that swallowed the licence would quietly drop
          half the attribution. */}
      {row.imageLicence && (
        <span className="lic">
          {row.imageLicenceUrl
            ? <a href={row.imageLicenceUrl} target="_blank" rel="noopener noreferrer">{row.imageLicence}</a>
            : row.imageLicence}
        </span>
      )}
    </p>
  )
}

/** The live answer to "why are they there", above the figures that say it. */
function WhyMoving({ row }) {
  const said = liveWhy(row)
  if (!said.length) return null
  return (
    <section className="mkt-why-block" aria-label="Why they are moving">
      <p className="mkt-why-tag">Why they are moving</p>
      {said.map((line, i) => (
        <p key={line} className={i === 0 ? 'lead' : undefined}>{line}</p>
      ))}
    </section>
  )
}


export default function CelebrityDetail({ market, feed, slug }) {
  const [range, setRange] = useState(RANGES[2])
  const row = market?.rows?.find((r) => r.slug === slug)

  const points = useMemo(() => {
    const all = row?.scoreSeries || []
    if (!all.length) return []
    const from = Date.now() - range.hours * 3600000
    const win = all.filter((p) => p.t >= from)
    return win.length >= 2 ? win : all.slice(-2)
  }, [row, range])

  if (!market) return <div className="mkt"><div className="mkt-thin">Loading…</div></div>
  if (!row) {
    return (
      <div className="mkt">
        <SurfaceNav current="market" feed={feed} market={market} />
        <div className="mkt-detail">
          <p className="mkt-thin">
            Not in the market. Gossip Genie tracks {market.summary?.tracked ?? 0} celebrities —
            this one can be added to the roster. <a className="mkt-back" href="/market">← Back to the market</a>
          </p>
        </div>
      </div>
    )
  }

  const spike = spikeFor(points, row.drivers)
  const move = row.isNew ? 'NEW' : row.rankChange > 0 ? `▲${row.rankChange}` : row.rankChange < 0 ? `▼${Math.abs(row.rankChange)}` : '—'
  // The same reason the front page and the Watch board give, from the same
  // function — so a viewer who saw it on air and looks it up here reads the
  // identical explanation rather than two accounts of one event.
  const reason = reasonFor(row, feed?.stories || [])
  const direction = (row.change24h ?? row.momentum ?? 0) < 0 ? 'down' : 'up'

  return (
    <div className="mkt">
      {market.mock && <div className="mkt-mock">Mock market — synthetic data for development. Not real attention figures.</div>}

      <SurfaceNav current="market" feed={feed} market={market} />
      <header className="mkt-head">
        <div className="mkt-head-top">
          <span className="mkt-sub">Celebrity Market</span>
          <div className="mkt-head-right">
            <Share {...celebrityShare(row, moveShown(row, market?.rows))} label="Share" />
            {/* The board is this page's parent, not its way out — the bar
                above handles leaving. */}
            <a className="mkt-back" href="/market">← Back to the board</a>
          </div>
        </div>
      </header>

      <div className="mkt-detail">
        {/* What is moving them, in sentences, derived from the same numbers
            that produced the score rather than from whichever story happens
            to mention them most recently. */}
        <WhyMoving row={row} />
        <div className="mkt-hero">
          <div className="mkt-hero-pic">
            <Avatar row={row} big />
            <PortraitCredit row={row} />
          </div>
          <div>
            <h1>{row.displayName}</h1>
            <div className="mkt-hero-meta">
              {CATEGORIES[row.primaryCategory]} · rank {row.rank} {move}
              {' · '}<span className={`mkt-chip ${STATUS_TONE[row.status] || 'neutral'}`}>{row.status}</span>
            </div>
          </div>
          <div className="mkt-hero-figs">
            <div className="mkt-fig"><span>Gossip Score</span><b className="big">{row.gossipScore.toFixed(1)}</b></div>
            <div className="mkt-fig"><span>24h change</span><b className={dirOf(row.change24h)}>{signed(row.change24h, 1)}</b></div>
            <div className="mkt-fig"><span>Momentum</span><b className={dirOf(row.momentum)}>{signed(row.momentum, 0)}</b></div>
            <div className="mkt-fig"><span>Peak today</span><b>{row.peakToday?.toFixed(1) ?? '—'}</b></div>
          </div>
        </div>

        <Why reason={reason} name={row.displayName} direction={direction} className="mkt-why" />

        <div className="mkt-ranges">
          {RANGES.map((r) => (
            <button key={r.key} className={`mkt-range${range.key === r.key ? ' on' : ''}`} onClick={() => setRange(r)}>{r.label}</button>
          ))}
        </div>

        <ScoreChart points={points} range={range} />

        {spike && (
          <div className="mkt-spike">
            <b>{clock(spike.at)} — {spike.from.toFixed(0)} → {spike.to.toFixed(0)}&nbsp;&nbsp;</b>
            {spike.driver
              ? <>Likely driver: <em>“{spike.driver.title}”</em>{spike.driver.publishers ? ` — ${spike.driver.publishers} publishers picked it up.` : ''}</>
              : <em>No single story lines up with this jump — it came from broad coverage rather than one event.</em>}
          </div>
        )}

        <div className="mkt-cols">
          <section className="mkt-panel">
            <h2>What the score is made of</h2>
            {COMPONENTS.map((c) => {
              const contrib = row.contributions?.[c.key]
              const src = c.source ? row.sources?.[c.source] : null
              const stale = src && src.freshnessSeconds > (c.source === 'wikipedia' ? 172800 : 5400)
              return (
                <div key={c.key} className={`mkt-comp${stale ? ' stale' : ''}`}>
                  <i style={{ background: c.colour }} aria-hidden="true" />
                  <span className="nm">{c.label}</span>
                  <span className="track" aria-hidden="true">
                    <b style={{ width: `${Math.max(0, Math.min(100, contrib?.value ?? 0))}%`, background: c.colour }} />
                  </span>
                  <span className="v">{contrib?.dropped ? '—' : (contrib?.value ?? 0).toFixed(0)}</span>
                  <span className="fresh">
                    {contrib?.dropped ? 'unavailable' : src ? sinceLabel(src.freshnessSeconds) : 'computed'}
                  </span>
                </div>
              )
            })}
            <p className="mkt-note">
              Each bar is the component's own 0–100 score. The weights that turn them into the
              Gossip Score are on the <a href="/market/admin">admin panel</a>.
              {row.confidence < 1 && ` Scored at ${Math.round(row.confidence * 100)}% confidence — ${row.mentions} stories measured.`}
            </p>
          </section>

          <section className="mkt-panel">
            <h2>Coverage</h2>
            <div className="mkt-kv"><span>Stories measured (de-duplicated)</span><b>{row.mentions.toLocaleString()}</b></div>
            <div className="mkt-kv"><span>Unique publishers</span><b>{row.uniqueSources?.toLocaleString() ?? '—'}</b></div>
            <div className="mkt-kv"><span>Countries</span><b>{row.uniqueCountries ?? '—'}</b></div>
            <div className="mkt-kv"><span>Deviation from own baseline</span><b>{row.deviationZ?.toFixed(2) ?? '—'}σ</b></div>
            <div className="mkt-kv"><span>Peak this week</span><b>{row.peakWeek?.toFixed(1) ?? '—'}</b></div>
            <div className="mkt-kv"><span>Previous rank</span><b>{row.rankPrev ?? '—'}</b></div>
            <p className="mkt-note">
              Syndicated copies of one story count once. Breadth is measured by how many
              independent publishers carried it, not by how many URLs exist.
            </p>
          </section>
        </div>

        <section className="mkt-panel mkt-stories">
          <h2>Stories driving the movement</h2>
          {row.drivers?.length
            ? row.drivers.slice(0, 8).map((d, i) => (
              <div className="mkt-story" key={i}>
                <time>{clock(Date.parse(d.firstSeen ?? d.publishedAt))}</time>
                <a href={d.url} target="_blank" rel="noopener noreferrer">{d.title}</a>
                <span className="pub">{d.publishers ? `${d.publishers} publishers` : d.domain}</span>
              </div>
            ))
            : <p className="mkt-note">No article list stored for this celebrity yet — it arrives with the next full ingestion run.</p>}
        </section>
      </div>
    </div>
  )
}
