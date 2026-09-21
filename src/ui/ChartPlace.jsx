import { useChart } from '../lib/useChart.js'
import { CHART } from '../../market/config.mjs'
import { moveLabel } from '../../market/chart.mjs'

const norm = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').trim()

/**
 * Where the people in this story sit on the chart.
 *
 * The market has always linked out to stories. Nothing linked back, so the
 * loop only ran one way and a reader who arrived on a story had no idea the
 * chart existed. This is the return leg: a name in a story is one tap from
 * its position, and the position is a reason to look at the chart.
 *
 * Shows nothing at all when nobody in the story charts, which is most stories
 * — the chart is a hundred names and the feed covers thousands.
 */
export function ChartPlace({ people = [] }) {
  const { chart } = useChart()
  if (!chart?.entries?.length || !people.length) return null

  const wanted = new Set(people.map(norm))
  const found = chart.entries.filter((e) => wanted.has(norm(e.displayName)))
  if (!found.length) return null

  return (
    <div className="b-place">
      <span className="b-place-label">On {CHART.name}</span>
      {found.map((e) => (
        <a key={e.id} className={`b-place-chip ${e.status}`} href={`/chart/${chart.id}`}>
          <b>No.{e.rank}</b>
          <span>{e.displayName}</span>
          <i>{moveLabel(e)}</i>
        </a>
      ))}
    </div>
  )
}

export default ChartPlace
