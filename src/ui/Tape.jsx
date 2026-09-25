import { useMemo } from 'react'
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
export function Tape({ items = [], label = 'Live quotes' }) {
  // A short board would scroll a gap across the screen, so it is repeated
  // until there is enough to fill a wide one before the halves are made.
  const run = useMemo(() => {
    if (!items.length) return []
    const out = [...items]
    while (out.length < 24) out.push(...items)
    return out
  }, [items])

  if (!run.length) return null

  return (
    <div className="tp" role="marquee" aria-label={label}>
      <div className="tp-run">
        {[0, 1].map((copy) => (
          <div className="tp-half" key={copy} aria-hidden={copy === 1}>
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
