import { useEffect, useMemo, useState } from 'react'
import { CHART } from '../../market/config.mjs'
import { moveLabel } from '../../market/chart.mjs'
import { useChart } from '../lib/useChart.js'
import { loadSeen, movesSince, rememberIfStale } from '../lib/lastseen.js'
import { Avatar } from '../screens/Market.jsx'
import { Sparkline, MovementRow } from './Movement.jsx'
import { Share } from './Share.jsx'
import { Countdown } from './Countdown.jsx'
import { Race } from './Race.jsx'

/**
 * The chart at the top of the front page — the week in progress.
 *
 * The front page used to carry two ranked lists of celebrity names with
 * signed numbers beside them, in the same visual language, and no way to tell
 * why there were two. Now there is one: this week so far, live, counting down
 * to Monday. Last week's published edition is one tap away and is the same
 * screen in its other state.
 *
 * It being live is also what makes the front page worth returning to. A
 * weekly chart is the same page for six days out of seven; a running order
 * moves every fifteen minutes, and the badges say what has moved since this
 * particular reader last looked.
 */
export function ChartStrip({ count = 10 }) {
  const { chart, loading, empty } = useChart('live')
  const [seen] = useState(loadSeen)
  const changes = useMemo(() => movesSince(chart, seen), [chart, seen])
  useEffect(() => { if (chart) rememberIfStale(chart, seen) }, [chart, seen])

  // Nothing rather than a box apologising for itself: the front page has
  // plenty else on it and the standings arrive with the next market run.
  if (loading || empty || !chart?.entries?.length) return null

  const [one, ...rest] = chart.entries

  return (
    <section className="b-chart" aria-labelledby="b-chart-title">
      <div className="b-chart-head">
        <a href="/chart/live" className="b-chart-title" id="b-chart-title">
          {CHART.name}
          <span>This week so far</span>
        </a>
        <span className="b-chart-clock">
          <Countdown at={chart.freezesAt} label="Freezes in" onDone="Freezing now" />
        </span>
        <Share
          compact
          label="Share the chart"
          title={`${one.displayName} is leading ${CHART.name}`}
          text={`${chart.daysCounted} days into the week, with the chart freezing on Monday.`}
          path="/chart/live"
        />
      </div>

      {/* Before the standings, not after: the standings are the state of
          things and this is the reason to come back to them. */}
      <Race chart={chart} />

      {changes.count > 0 && (
        <p className="b-chart-moved">
          <b>{changes.count}</b> {changes.count === 1 ? 'name has' : 'names have'} moved since you last looked
        </p>
      )}

      <div className="b-chart-one">
        <a className="b-chart-one-pic" href={`/market/${one.slug}`} tabIndex={-1} aria-hidden="true">
          <Avatar row={one} big />
        </a>
        <div className="b-chart-one-body">
          <span className="b-chart-no">Leading</span>
          <a className="b-chart-one-name" href={`/market/${one.slug}`}>{one.displayName}</a>
          {/* What moved, not which article mentioned them. */}
          <MovementRow record={one.movement} max={110} />
        </div>
        {/* The leader's week as a shape — the one thing on the front page
            that shows the chart is a measurement over time rather than a
            list somebody wrote out this morning. */}
        {one.movement?.week?.series?.length > 0 && (
          <Sparkline series={one.movement.week.series} peak={one.movement.week.peak} w={140} h={40} />
        )}
      </div>

      <ol className="b-chart-list">
        {rest.slice(0, count - 1).map((e) => (
          <li key={e.id} className={`${e.status}${changes.moves[e.id] ? ' shifted' : ''}`}>
            <span className="b-chart-rank">{e.rank}</span>
            <a href={`/market/${e.slug}`}>{e.displayName}</a>
            {/* Out of 100, anchored at zero — the same scale the chart
                screen uses, so a score means one thing everywhere. */}
            <span className="b-chart-bar" title={`Gossip Score ${e.score.toFixed(1)}`}>
              <span style={{ width: `${Math.max(2, Math.round(e.score))}%` }} />
            </span>
            <span className={`b-chart-move ${e.status}`}>{moveLabel(e)}</span>
          </li>
        ))}
      </ol>

      <div className="b-chart-foot">
        <a href="/chart/live">See all {chart.entries.length} →</a>
        <a href="/chart">Last week’s chart →</a>
      </div>
    </section>
  )
}

export default ChartStrip
