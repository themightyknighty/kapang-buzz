import { useEffect, useMemo, useState } from 'react'
import { CHART } from '../../market/config.mjs'
import { moveLabel, numberOneLine, weekLabel } from '../../market/chart.mjs'
import { useChart, useChartIndex } from '../lib/useChart.js'
import { loadSeen, movesSince, rememberIfStale } from '../lib/lastseen.js'
import { Avatar } from './Market.jsx'
import { MovementBlock, MovementRow, Confidence } from '../ui/Movement.jsx'
import { shareLine } from '../lib/narrative.js'
import { writeWeek, writeGap, writeHalfLife, writeAttention } from '../lib/reportcopy.js'
import { Share } from '../ui/Share.jsx'
import { Countdown } from '../ui/Countdown.jsx'
import { SurfaceNav } from '../ui/SurfaceNav.jsx'
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

  /*
   * Written once for the whole screen, because two things read it: the story
   * at the top, and the number one below it, which stops shouting the name a
   * second time when the headline has already said it.
   *
   * Both ids have to be present for that to mean anything — two undefineds
   * are not a match, and an edition with no lead must keep its hero.
   */
  const week = useMemo(() => writeWeek(chart.report, { chartName: CHART.name }), [chart.report])
  const namedInLead = Boolean(week?.lead?.subject?.id && one?.id && week.lead.subject.id === one.id)

  return (
    <div className={`ch${live ? ' live' : ''}`}>
      <Head chart={chart} live={live} changes={changes} path={path} one={one} />
      <LeadStory week={week} />
      {one && <NumberOne entry={one} live={live} chart={chart} named={namedInLead} />}
      <Summary chart={chart} live={live} changes={changes} />

      <ol className="ch-list">
        {rest.map((e) => (
          <Row key={e.id} entry={e} live={live} moved={changes.moves[e.id]} chart={chart} />
        ))}
      </ol>

      <Reports insight={chart.insight} />
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
      <SurfaceNav current="chart" />
      <div className="ch-head-row">
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
 * What the week was about.
 *
 * A chart that publishes and says "here is the chart" is a scoreboard, and a
 * scoreboard is read once. The edition arrives with its lead already decided —
 * every candidate the data supports, tested, strongest first — so this is the
 * one thing on the page that says the week MEANT something rather than merely
 * recording it.
 *
 * The English is written here rather than stored, exactly as a row's movement
 * record is: the edition keeps the numbers and the verdict, every surface
 * turns them into the same sentence with the same templates, and no two
 * screens can describe one week differently.
 *
 * It sits above the number one because it is the headline and the number one
 * is the story underneath it. On a week when nothing happened the two agree,
 * which is what a week when nothing happened looks like.
 *
 * A live chart carries no report and never will — a running order that
 * headlines itself is the confusion between a standing and an edition that
 * the two states exist to prevent — so this renders nothing there.
 */
function LeadStory({ week }) {
  if (!week) return null
  const { lead, also } = week

  return (
    <section className="ch-lead" aria-label="The week’s story">
      <p className="ch-lead-tag">
        {lead.tag}
        {/* The same honesty label the rows carry: a lead the corroboration
            test could not stand up says so in the tag, where somebody who
            reads the headline and nothing else has still been told. */}
        {lead.thin && <b className="ch-lead-thin">Thin</b>}
      </p>
      <h2 className="ch-lead-head">{lead.headline}</h2>
      {lead.standfirst && <p className="ch-lead-stand">{lead.standfirst}</p>}
      {lead.note && <p className="ch-lead-note">{lead.note}</p>}

      {also.length > 0 && (
        <ul className="ch-lead-also">
          {also.map((item, i) => (
            <li key={`${item.kind}-${i}`}>
              <b>{item.tag}</b>
              <span>{item.headline}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
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
function NumberOne({ entry, live, chart, named = false }) {
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
          {/* `said` when the headline above already carried this name: the
              hero keeps its portrait, its line and its figures, but printing
              the same name twice in display face 300px apart reads as a
              mistake rather than as emphasis. */}
          <a className={`ch-one-name${named ? ' said' : ''}`} href={`/market/${entry.slug}`}>{entry.displayName}</a>
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

/**
 * What the archive knows that a ranking does not.
 *
 * A chart answers one question — who is highest — and answers it once a week.
 * The same readings answer a dozen more, and those are the ones nobody else
 * can answer at all, because nobody else kept the series: how long a
 * celebrity story actually lasts, whether the press is writing about people
 * anybody is looking for, and how much of the world's attention one name
 * holds.
 *
 * Every figure here was computed when the edition was published and stored
 * with it, so this reads one block off a file the page has already loaded —
 * no request, no endpoint, and an edition from two years ago still reports
 * itself. Each report says what it had to work with rather than printing a
 * confident number from three days of data, and an edition published before
 * the figures were kept renders nothing at all.
 */
function Reports({ insight }) {
  const reports = useMemo(() => (insight
    ? [writeAttention(insight), writeGap(insight.gap), writeHalfLife(insight.halfLives)].filter(Boolean)
    : []), [insight])
  if (!reports.length) return null

  return (
    <section className="ch-reports" aria-label="What the archive knows">
      <h2 className="ch-reports-title">What the archive knows</h2>
      <p className="ch-reports-note">
        The same week, asked the questions a ranking cannot answer. Every
        figure below is derived from readings already stored — nothing here
        was fetched and nothing was guessed.
      </p>
      <div className="ch-reports-grid">
        {reports.map((report) => <Report key={report.kind} report={report} />)}
      </div>
    </section>
  )
}

/** One report: the finding, then the evidence under it. */
function Report({ report }) {
  return (
    <article className="ch-report">
      <p className="ch-report-tag">
        {report.title}
        {/* A figure that needs more weeks says so where it is read, not in a
            footnote. An average over four spikes is a rumour. */}
        {report.early && <b className="ch-report-early">early</b>}
      </p>
      <h3 className="ch-report-head">{report.headline}</h3>
      {report.standfirst && <p className="ch-report-stand">{report.standfirst}</p>}

      {report.sections.map((section) => (
        <div className="ch-report-sec" key={section.heading}>
          <p className="ch-report-sub">{section.heading}</p>
          {section.note && <p className="ch-report-note">{section.note}</p>}
          <ul>
            {section.rows.map((row, i) => (
              <li key={`${row.name}-${i}`}>
                {row.slug
                  ? <a href={`/market/${row.slug}`}>{row.name}</a>
                  : <span className="ch-report-name">{row.name}</span>}
                <span className="ch-report-line">{row.line}</span>
                <b>{row.figure}</b>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </article>
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
      {index.editions.map((e) => {
        /*
         * An archive of dates is a filing cabinet; an archive of stories is a
         * back catalogue, and the second is the one somebody reads down.
         * Editions published before the chart decided its own lead carry no
         * headline and keep the week as their heading, which is what the
         * whole list used to be.
         */
        const sub = [
          e.headline ? e.label : null,
          e.numberOne ? `No.1 ${e.numberOne.displayName}` : null,
        ].filter(Boolean).join(' · ')

        return (
          <li key={e.id} className={e.id === current ? 'on' : ''}>
            <a href={`/chart/${e.id}`}>
              <b>{e.headline || e.label}</b>
              <span>{sub || '—'}</span>
            </a>
          </li>
        )
      })}
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
      <SurfaceNav current="chart" />
      <div className="ch-head-row">
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
