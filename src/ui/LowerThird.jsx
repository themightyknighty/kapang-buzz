import { useLayoutEffect, useRef } from 'react'

/**
 * Lower third, treatment B. Copy left, figures right.
 *
 * fitLowerThird turns the whole copy column down on one shared scale until it
 * fits its bounded track. Shrinking the elements independently can never make
 * the set fit — that is the bug this exists to prevent. Text is never cut off.
 */
export function LowerThird({ tags = [], kicker, place, line, stats = [] }) {
  const copyRef = useRef(null)

  useLayoutEffect(() => {
    const el = copyRef.current
    if (!el) return
    const fit = () => {
      let scale = 1
      el.style.setProperty('--k-tscale', '1')
      // Step down in 4% increments; 16 steps bottoms out at ~0.36.
      for (let i = 0; i < 16 && el.scrollHeight > el.clientHeight + 1; i++) {
        scale -= 0.04
        el.style.setProperty('--k-tscale', String(scale))
      }
    }
    fit()
    // Webfonts land after first layout and change every line length.
    document.fonts?.ready?.then(fit)
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [kicker, place, line, stats])

  return (
    <div className="k-l3">
      <div className="k-l3-copy" ref={copyRef}>
        {tags.length > 0 && (
          <div className="k-l3-eyebrow">
            {tags.map((t) => (
              <span key={t.label} className={`k-tag${t.live ? ' live' : ''}`}>
                {t.live && <span className="dot" />}{t.label}
              </span>
            ))}
          </div>
        )}
        {kicker && <p className="k-l3-kicker">{kicker}</p>}
        {place && <p className="k-l3-place">{place}</p>}
        {line && <p className="k-l3-line">{line}</p>}
      </div>
      {stats.length > 0 && (
        <div className="k-l3-stats">
          {stats.map((s) => (
            <div className="k-stat" key={s.k}>
              <div className="k">{s.k}</div>
              <div className={`v${s.tone ? ' ' + s.tone : ''}`}>{s.v}</div>
              {s.n && <div className="n">{s.n}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
