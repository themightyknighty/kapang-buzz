import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import './tape.css'

/**
 * The ticker tape.
 *
 * The one piece of furniture that says "exchange" before a reader has parsed
 * a single figure — and the only honest way to put continuous motion on a
 * board whose prices change every fifteen minutes. The scroll is continuous;
 * the numbers on it are not invented to match. Nothing here interpolates a
 * price between two real ones, because a quote somebody could act on is the
 * last figure to make up for the sake of movement.
 *
 * The run is duplicated and translated by exactly half its width, which is
 * what makes the loop seamless — the copy arrives where the original left.
 * It pauses under the pointer and under a keyboard focus, so anybody trying
 * to read one quote can.
 */
/*
 * Pixels a second.
 *
 * A broadcast tape runs somewhere around 60-110 px/s; below that it reads as
 * stalled, above it nobody finishes a quote. This sat at 310 because the
 * duration was a flat 80s whatever the board's width — with a hundred names
 * the run is 25,000px long, and 80 seconds to cross it is four times reading
 * speed. The comment beside it claimed the duration scaled with the number of
 * items. It did not; that is what this measures.
 */
const PX_PER_SECOND = 75

export function Tape({ items = [], label = 'Live quotes', speed = PX_PER_SECOND }) {
  // A short board would scroll a gap across the screen, so it is repeated
  // until there is enough to fill a wide one before the halves are made.
  const run = useMemo(() => {
    if (!items.length) return []
    const out = [...items]
    while (out.length < 24) out.push(...items)
    return out
  }, [items])

  /*
   * Measured rather than estimated: item widths depend on the name, the
   * font and the reader's zoom, so the only way to hold a constant reading
   * speed is to ask the browser how wide the run actually came out. The
   * translation is -50% of the pair, which is exactly one half's width.
   *
   * In a layout effect, so the correct duration is set before the first
   * paint rather than after a frame of the wrong one.
   */
  const halfRef = useRef(null)
  const [secs, setSecs] = useState(null)

  useLayoutEffect(() => {
    const el = halfRef.current
    if (!el) return undefined
    const measure = () => {
      const width = el.scrollWidth
      if (width > 0) setSecs(Math.max(20, Math.round(width / speed)))
    }
    measure()
    // Re-measure on a resize or a font swap, either of which changes the
    // width underneath a duration that was correct a moment ago.
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [run, speed])

  if (!run.length) return null

  return (
    <div className="tp" role="marquee" aria-label={label} style={secs ? { '--tp-secs': `${secs}s` } : undefined}>
      <div className="tp-run">
        {[0, 1].map((copy) => (
          <div className="tp-half" key={copy} ref={copy === 0 ? halfRef : undefined} aria-hidden={copy === 1}>
            {run.map((it, i) => (
              <span className={`tp-item ${it.dir || 'flat'}`} key={`${copy}-${it.key ?? i}`}>
                <b>{it.name}</b>
                <span className="tp-v">{it.value}</span>
                {it.change && <i>{it.change}</i>}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export default Tape
