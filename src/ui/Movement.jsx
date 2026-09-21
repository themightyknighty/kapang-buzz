/**
 * The evidence record, on screen.
 *
 * One component set, used by the chart page, the front-page strip and the
 * Watch channel, so what a reader sees in one place is the same thing they
 * see in the others — and the same thing the share card draws. That matters
 * more than it sounds: the old reason line was assembled separately on every
 * surface, so three screens could describe the same rank three ways.
 *
 * The visual grammar, decided before any colour was chosen:
 *
 *   the week      a single series over time -> a stat tile with a sparkline,
 *                 not a chart with axes. One series, so no legend; the figure
 *                 beside it names what it is.
 *   the drivers   three measures of one event, where the point is WHICH of
 *                 them moved -> the emphasis form. Movers in the data hue,
 *                 the rest in the de-emphasis grey, every bar direct-labelled
 *                 so identity is never colour alone.
 *
 * The hue is the chart's own #5EC8E8, the same one the score bars use, because
 * it is the same measure. Against the de-emphasis grey on the deck it clears
 * CVD separation (ΔE 23.2 deutan, 25.2 tritan), the normal-vision floor
 * (24.4) and 3:1 contrast. The palette validator also reports the grey as
 * "below chroma floor" and the blue as outside the categorical lightness
 * band: both are checks for categorical palettes, where every slot is a
 * peer. This is not one — it is one data colour and a deliberate grey — so
 * those two are not faults to fix.
 */
import {
  explain, rowLine, thinLine, confidenceLabel, sizeOf, num, weekCaption,
} from '../lib/narrative.js'

const VIEW = { w: 220, h: 48 }

/**
 * The week, as a shape.
 *
 * Scaled to its own range, not to zero.
 *
 * Zero-anchoring is right for the score BARS, where length is the encoding
 * and a bar half as long has to mean half as much. A line encodes position,
 * and anchoring one at zero throws away the only thing it is there to show:
 * a leader whose week ran 93 to 99 became a flat rule pinned to the top of
 * the box, identical to a leader who never moved. The absolute level is
 * already in the score column and in this chart's own caption, so the line
 * is free to do the job a line is for.
 *
 * Days nobody measured are breaks rather than zeroes, and an isolated
 * measured day is a dot, because that is what it is.
 */
export function Sparkline({ series = [], peak = null, w = VIEW.w, h = VIEW.h, label = 'Gossip score' }) {
  const points = series.filter((p) => p && Number.isFinite(p.level))
  if (points.length < 2) return null

  const levels = points.map((p) => p.level)
  const lo = Math.min(...levels)
  const hi = Math.max(...levels)
  // A flat week is a real answer, so a zero span still draws a level line
  // through the middle rather than dividing by nothing.
  const pad = Math.max(1, (hi - lo) * 0.18)
  const from = Math.max(0, lo - pad)
  const to = hi + pad
  const x = (i) => (series.length < 2 ? 0 : (i / (series.length - 1)) * (w - 8) + 4)
  const y = (v) => h - 5 - ((v - from) / Math.max(0.001, to - from)) * (h - 12)

  // Each measured run is its own path, so a gap in the middle of the week is
  // drawn as a gap instead of a straight line through days nobody watched.
  const runs = []
  let run = []
  series.forEach((p, i) => {
    if (p && Number.isFinite(p.level)) run.push([x(i), y(p.level)])
    else if (run.length) { runs.push(run); run = [] }
  })
  if (run.length) runs.push(run)

  const peakAt = peak ? series.findIndex((p) => p.day === peak.day) : -1

  return (
    <svg className="mv-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h}
      role="img" aria-label={`${label} over the week, ${num(lo)} to ${num(hi)}`}>
      {/* The floor of the plotted range, recessive — a rule to read the
          line against, not a zero it is anchored to. */}
      <line x1="0" y1={h - 2} x2={w} y2={h - 2} className="mv-spark-base" />
      {runs.map((r, k) => (
        // A day measured between two gaps is a run of one, and a polyline of
        // one point draws nothing — so a patchy week lost exactly the days
        // it most needed to show. It gets a dot.
        r.length === 1
          ? <circle key={k} className="mv-spark-dot" cx={r[0][0]} cy={r[0][1]} r="3" />
          : <polyline key={k} className="mv-spark-line" points={r.map(([px, py]) => `${px},${py}`).join(' ')} />
      ))}
      {peakAt >= 0 && Number.isFinite(peak.level) && (
        <circle className="mv-spark-peak" cx={x(peakAt)} cy={y(peak.level)} r="4.5" />
      )}
      {series.map((p, i) => (p && Number.isFinite(p.level) ? (
        <circle key={p.day} cx={x(i)} cy={y(p.level)} r="7" className="mv-spark-hit">
          <title>{`${p.day}: ${num(p.level)}`}</title>
        </circle>
      ) : null))}
    </svg>
  )
}

/**
 * What moved, as bars.
 *
 * Emphasis, not categories: the signals that moved carry the data hue and
 * the ones that did not are grey, because the reader's question is which of
 * them moved rather than how the three compare. Every bar is labelled with
 * its own number, so the distinction never rests on the colour.
 */
export function DriverBars({ drivers = [], compact = false }) {
  const shown = drivers.filter((d) => d && (d.moved || Number.isFinite(d.now)))
  if (!shown.length) return null
  const widest = Math.max(...shown.map((d) => Math.abs(d.change || 0)), 0.5)
  return (
    <ul className={`mv-drivers${compact ? ' compact' : ''}`}>
      {shown.map((d) => (
        <li key={d.key} className={d.moved ? 'moved' : 'still'}>
          <span className="mv-d-label">{d.label}</span>
          <span className="mv-d-track">
            <span className="mv-d-fill" style={{ width: `${Math.max(3, (Math.abs(d.change || 0) / widest) * 100)}%` }} />
          </span>
          <span className="mv-d-value">{d.moved ? sizeOf(d.change) : (Number.isFinite(d.before) ? 'flat' : 'no history')}</span>
        </li>
      ))}
    </ul>
  )
}

/** The honesty label — a rise nobody else noticed, said plainly. */
export function ThinTag({ record }) {
  const line = thinLine(record)
  if (!line) return null
  return <p className="mv-thin"><b>Thin</b>{line}</p>
}

/** How much the week rests on, as a word rather than a sentence. */
export function Confidence({ record }) {
  const label = confidenceLabel(record)
  if (!label) return null
  return <span className={`mv-conf ${label.toLowerCase()}`}>{label}</span>
}

/** One line, for a row on a board. */
export function MovementRow({ record, max = 96 }) {
  const line = rowLine(record, { max })
  return line ? <span className="mv-row">{line}</span> : null
}

/**
 * The whole explanation: what happened, why, whether it lasted, what it
 * rests on — plus the week as a picture and the signals behind it.
 */
export function MovementBlock({ record, name = null, chart = true }) {
  if (!record) return null
  const lines = explain(record, { name })
  if (!lines.length && !record.week?.series?.length) return null
  const caption = weekCaption(record)
  return (
    <div className="mv">
      {lines.length > 0 && (
        <div className="mv-says">
          {lines.map((l, i) => <p key={l} className={i === 0 ? 'lead' : ''}>{l}</p>)}
        </div>
      )}
      {chart && record.week?.series?.length > 0 && (
        <figure className="mv-week">
          <Sparkline series={record.week.series} peak={record.week.peak} />
          <figcaption>
            {caption}
            {record.week.peak && <> · peak {num(record.week.peak.level)}</>}
          </figcaption>
        </figure>
      )}
      <DriverBars drivers={record.drivers} />
      {record.evidence?.story && (
        <a className="mv-story" href={record.evidence.story.href}>
          {record.evidence.story.headline}
        </a>
      )}
    </div>
  )
}

export default MovementBlock
