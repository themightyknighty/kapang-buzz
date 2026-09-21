import { useEffect, useMemo, useState } from 'react'
import { CHART } from '../../market/config.mjs'
import { moveLabel, numberOneLine, weekLabel } from '../../market/chart.mjs'
import { useChart, useChartIndex } from '../lib/useChart.js'
import { loadSeen, movesSince, rememberIfStale } from '../lib/lastseen.js'
import { Avatar } from './Market.jsx'
import { MovementBlock, MovementRow, Confidence } from '../ui/Movement.jsx'
import { shareLine } from '../lib/narrative.js'
import { Share } from '../ui/Share.jsx'
import { Countdown } from '../ui/Countdown.jsx'
import { GenieLockup } from '../brand/Genie.jsx'
import { ago } from '../lib/time.js'

/**
 * The Genie 100 — one ranking, in two states.
 *
 * `/chart/live` is the week in progress: provisional, rewritten every fifteen
 * minutes, counting down to Monday. `/chart` is last week, published and
 * frozen for good. They are deliberately the SAME screen with the same
 * vocabulary, because they are the same chart — a reader learns to read it
 * once. The only things that differ are the state banner, the countdown and
 * what the numbers are allowed to claim.
 *
 * The score bar is the point of the redesign. A hundred rows of name-and-
 * number is a database dump; the bar is what makes the shape of a week
 * visible at a glance, and it fills the eight hundred pixels of nothing that
 * every row used to carry on a desktop.
 */
export default function Chart({ weekId = null }) {
  const live = weekId === 'live'
  const { chart, loading, error, empty, notYet } = useChart(live ? 'live' : weekId)
  const [showArchive, setShowArchive] = useState(false)
  const index = useChartIndex(showArchive)

  // What moved since this reader last looked. Read once, then the snapshot is
  // refreshed — so the marks stand for the session rather than vanishing on
  // the first refresh.
  const [seen] = useState(loadSeen)
  const changes = useMemo(() => (live ? movesSince(chart, seen) : { moves: {}, count: 0, since: null }), [chart, seen, live])
  useEffect(() => { if (live && chart) rememberIfStale(chart, seen) }, [live, chart, seen])

  if (loading) return <Shell live={live}><p className="ch-note">Loading the chart…</p></Shell>
  if (error) return <Shell live={live}><p className="ch-note">The chart could not be loaded. {error}</p></Shell>
  if (empty) return <Shell live={live}><NotYet info={notYet} weekId={weekId} live={live} /></Shell>

  return (
    <Edition
      chart={chart}
      live={live}
      changes={changes}
      index={index}
      showArchive={showArchive}
      onArchive={() => setShowArchive((v) => !v)}
    />
  )
}

/* ------------------------------------------------------------------ *
 * The screen
 * ------------------------------------------------------------------ */

function Edition({ chart, live, changes, index, showArchive, onArchive }) {
  const one = chart.entries[0]
  const rest = chart.entries.slice(1)
  const path = live ? '/chart/live' : `/chart/${chart.id}`

  return (
    <div className={`ch${live ? ' live' : ''}`}>
      <Head chart={chart} live={live} changes={changes} path={path} one={one} />
      {one && <NumberOne entry={one} live={live} chart={chart} />}
      <Summary chart={chart} live={live} changes={changes} />

      <ol className="ch-list">
        {rest.map((e) => (
          <Row key={e.id} entry={e} live={live} moved={changes.moves[e.id]} chart={chart} />
        ))}
      </ol>

      <Method chart={chart} live={live} />

      <footer className="ch-foot">
        <button type="button" className="ch-archive-btn" onClick={onArchive} aria-expanded={showArchive}>
          {showArchive ? 'Hide past charts' : 'Past charts'}
        </button>
        {showArchive && <Archive index={index} current={chart.id} />}
      </footer>
    </div>
  )
}

/**
 * The header, and the switch between the two states.
 *
 * The switch is the whole idea made visible: last week's chart and this
 * week's running order are two buttons a thumb's width apart, so nobody has
 * to work out why there appear to be two rankings.
 */
function Head({ chart, live, changes, path, one }) {
  return (
    <header className="ch-head">
      <div className="ch-head-row">
        <a href="/" className="ch-mark" aria-label="Gossip Genie home"><GenieLockup descriptor="Gossip" height={26} /></a>
        <h1 className="ch-title">{CHART.name}</h1>
        <div className="ch-head-right">
          <Share
            title={one
              ? `${one.displayName} is ${live ? 'leading' : 'number one on'} ${CHART.name}`
              : CHART.name}
            text={live
              ? `${chart.daysCounted} days into the week, with the chart freezing on Monday.`
              : `${chart.label} · ${chart.summary.charted} names ranked by how loudly the world is talking.`}
            path={path}
            label="Share"
          />
        </div>
      </div>

      <nav className="ch-states" aria-label="Which chart">
        <a href="/chart/live" className={live ? 'on' : ''}>
          <b>This week so far</b>
          <span>live · provisional</span>
        </a>
        <a href="/chart" className={live ? '' : 'on'}>
          <b>Last week’s chart</b>
          <span>published · final</span>
        </a>
      </nav>

      <div className="ch-week">
        <b>{chart.label}</b>
        {live ? (
          <>
            <span>{chart.daysCounted} of 7 days counted</span>
            <Countdown at={chart.freezesAt} label="Freezes in" onDone="Freezing — the edition is being written" />
            {changes.count > 0 && (
              <span className="ch-moved">{changes.count} {changes.count === 1 ? 'name has' : 'names have'} moved since you last looked</span>
            )}
          </>
        ) : (
          <>
            <span>published {ago(chart.publishedAt)}</span>
            {chart.provisional && <span className="ch-flag">built on {chart.minDays} days</span>}
          </>
        )}
      </div>
    </header>
  )
}

/**
 * The name at the top, and the card somebody can actually take away.
 *
 * The share card was only ever seen by crawlers. People screenshot, so the
 * picture they would screenshot is put on the page with a way to save it —
 * which is the cheapest share this site has, because images travel and links
 * do not.
 */
function NumberOne({ entry, live, chart }) {
  const [cardOk, setCardOk] = useState(true)
  const card = live ? '/og/chart.png' : `/og/chart/${encodeURIComponent(chart.id)}.png`
  return (
    <section className="ch-one">
      <div className="ch-one-main">
        <a className="ch-one-pic" href={`/market/${entry.slug}`} tabIndex={-1} aria-hidden="true">
          <Avatar row={entry} big />
        </a>
        <div className="ch-one-body">
          <span className="ch-one-rank">{live ? 'Leading' : 'No.1'}</span>
          <a className="ch-one-name" href={`/market/${entry.slug}`}>{entry.displayName}</a>
          <p className="ch-one-line">{live ? leadLine(entry) : numberOneLine(entry)}</p>
          {/* The explanation, made of the same numbers as the rank —
              what moved, by how much, and whether it lasted. */}
          <MovementBlock record={entry.movement} />
          <dl className="ch-one-figs">
            <div><dt>Score</dt><dd>{entry.score.toFixed(1)}</dd></div>
            <div><dt>Last week</dt><dd>{entry.lastWeek ?? '—'}</dd></div>
            <div><dt>Peak</dt><dd>{entry.peak}</dd></div>
            <div><dt>Weeks on</dt><dd>{entry.weeksOn}</dd></div>
          </dl>
        </div>
      </div>

      {/* Hidden outright if the card cannot be drawn — a broken image where
          the share preview should be is worse than no preview at all. */}
      <figure className="ch-card" hidden={!cardOk}>
        <img
          src={card}
          alt={`${CHART.name}: ${entry.displayName} at number one`}
          loading="lazy" width="1200" height="630"
          onError={() => setCardOk(false)}
        />
        <figcaption>
          <span>The card that goes with a shared link</span>
          <a href={card} download={`genie-100-${chart.id}.png`}>Save the image</a>
        </figcaption>
      </figure>
    </section>
  )
}

const leadLine = (e) => {
  if (e.lastWeek == null) return 'Not on last week’s chart'
  if (e.lastWeek === 1) return 'Holding on to number one'
  return `Up from ${e.lastWeek} last week`
}

/* ------------------------------------------------------------------ *
 * A row
 * ------------------------------------------------------------------ */

function Row({ entry, live, moved, chart }) {
  /*
   * The bar is the score out of 100 — anchored at zero, not scaled to
   * whoever happens to be top this week. Scaling to the leader would make a
   * quiet week look exactly like a loud one, and the whole value of a chart
   * that runs for years is that two weeks can be put side by side.
   *
   * One series, so no legend: the score column beside it names it.
   */
  const width = `${Math.max(2, Math.round(entry.score))}%`
  /*
   * One line under the name, and it is evidence rather than a headline.
   *
   * It used to be the newest story that happened to mention them, which was
   * both wallpaper on a hundred rows and frequently about something other
   * than the move. `rowLine` says what actually shifted — "Coverage 3.1×
   * last week · 22 outlets in 7 countries" — and says "thin" when that is
   * all there is.
   */
  return (
    <li className={`ch-row ${entry.status}${moved ? ' shifted' : ''}`}>
      <span className="ch-rank">{entry.rank}</span>
      <span className={`ch-move ${entry.status}`}>{moveLabel(entry)}</span>
      <Avatar row={entry} />
      <span className="ch-name">
        <a href={`/market/${entry.slug}`}>{entry.displayName}</a>
        <MovementRow record={entry.movement} max={90} />
      </span>

      <span className="ch-bar" title={`Gossip Score ${entry.score.toFixed(1)}`}>
        <span className="ch-bar-fill" style={{ width }} />
      </span>
      <span className="ch-score">{entry.score.toFixed(1)}</span>

      {/* Only on the live chart, and only when it has actually moved — a
          badge on every row would be wallpaper rather than news. */}
      {moved ? (
        <span className={`ch-shift ${moved > 0 ? 'up' : 'down'}`} title="Since you last looked">
          {moved > 0 ? '▲' : '▼'}{Math.abs(moved)}
        </span>
      ) : <span className="ch-shift" />}

      <Share
        compact
        label="Share"
        title={`${entry.displayName} is ${live ? 'number' : 'at'} ${entry.rank} on ${CHART.name}`}
        text={shareLine(entry.movement, entry.displayName)}
        path={`/market/${entry.slug}`}
      />
    </li>
  )
}

/* ------------------------------------------------------------------ *
 * The week in a line
 * ------------------------------------------------------------------ */

function Summary({ chart, live, changes }) {
  const s = chart.summary
  const bits = [
    s.highestNew && ['Highest new entry', `${s.highestNew.displayName} at ${s.highestNew.rank}`, `/market/${s.highestNew.slug}`],
    s.biggestClimb && ['Biggest climb', `${s.biggestClimb.displayName} ${moveLabel(s.biggestClimb)}`, `/market/${s.biggestClimb.slug}`],
    s.biggestFall && ['Biggest fall', `${s.biggestFall.displayName} ${moveLabel(s.biggestFall)}`, `/market/${s.biggestFall.slug}`],
  ].filter(Boolean)
  if (!bits.length && !live) return null

  return (
    <div className="ch-summary">
      {bits.map(([label, text, href]) => (
        <a key={label} className="ch-sum" href={href}>
          <span>{label}</span>
          <b>{text}</b>
        </a>
      ))}
      <p className="ch-sum-counts">
        {live && changes.count > 0 && <em>{changes.count} moved since your last visit · </em>}
        {s.newEntries} new · {s.climbers} up · {s.fallers} down{s.dropped ? ` · ${s.dropped} out` : ''}
      </p>
    </div>
  )
}

function Method({ chart, live }) {
  return (
    <details className="ch-method">
      <summary>How the {CHART.short} is worked out</summary>
      <p>
        Every name we track carries a Gossip Score from 0 to 100 — how loudly the world is
        talking about them, measured from news coverage across thousands of outlets and from
        Wikipedia readership, weighted towards what is unusual for that person rather than how
        famous they are. It is recalculated every fifteen minutes.
      </p>
      <p>
        A chart position is that score <b>averaged across the whole week</b>, Monday to Sunday,
        not its reading on Sunday night.{' '}
        {live
          ? `These are provisional standings from ${chart.daysCounted} day${chart.daysCounted === 1 ? '' : 's'} so far. They change every fifteen minutes and they are not the record — the chart freezes on Monday morning and that edition never changes.`
          : `A name needs at least ${chart.minDays} days of data in the week to be eligible, so somebody added on the Friday cannot chart on two loud days. This week ${chart.summary.eligible} of ${chart.summary.measured} names were eligible and the top ${chart.summary.charted} are listed.`}
      </p>
      <p>
        The chart measures coverage, not merit — it is a fact about the press, not a judgement
        about the person.
      </p>
    </details>
  )
}

function Archive({ index, current }) {
  if (!index) return <p className="ch-note">Loading…</p>
  if (!index.editions?.length) return <p className="ch-note">No editions have been published yet.</p>
  return (
    <ol className="ch-archive">
      {index.editions.map((e) => (
        <li key={e.id} className={e.id === current ? 'on' : ''}>
          <a href={`/chart/${e.id}`}>
            <b>{e.label}</b>
            <span>{e.numberOne ? `No.1 ${e.numberOne.displayName}` : '—'}</span>
          </a>
        </li>
      ))}
    </ol>
  )
}

function NotYet({ info, weekId, live }) {
  return (
    <div className="ch-notyet">
      <h2>{live ? 'This week has not been counted yet' : weekId ? 'No chart for that week' : 'The first chart is still counting'}</h2>
      <p>
        {live
          ? 'The standings appear once the first snapshots of the week are in — within about fifteen minutes of the market running.'
          : weekId
            ? `${weekLabel(weekId) || weekId} was before the ${CHART.short} started, or the week had too little data to rank.`
            : `The ${CHART.name} publishes every Monday morning, once a full Monday-to-Sunday week has been measured.`}
      </p>
      {info?.nextAt && (
        <p className="ch-note">
          Next edition: {new Date(info.nextAt).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      )}
      <a className="ch-link" href={live ? '/chart' : '/chart/live'}>
        {live ? 'See last week’s chart →' : 'See this week so far →'}
      </a>
    </div>
  )
}

const Shell = ({ children, live }) => (
  <div className={`ch${live ? ' live' : ''}`}>
    <header className="ch-head">
      <div className="ch-head-row">
        <a href="/" className="ch-mark" aria-label="Gossip Genie home"><GenieLockup descriptor="Gossip" height={26} /></a>
        <h1 className="ch-title">{CHART.name}</h1>
      </div>
      <nav className="ch-states" aria-label="Which chart">
        <a href="/chart/live" className={live ? 'on' : ''}><b>This week so far</b><span>live · provisional</span></a>
        <a href="/chart" className={live ? '' : 'on'}><b>Last week’s chart</b><span>published · final</span></a>
      </nav>
    </header>
    {children}
  </div>
)
