import { useEffect, useRef, useState } from 'react'
import logo from './assets/kapang-logo.webp'

export const WIPE_IN_MS = 450
export const WIPE_OUT_MS = 500
export const WIPE_HOLD_MAX = 4200
/** The panel holds at least this long even when the next view is ready
 *  instantly — otherwise the destination card animates in and straight back
 *  out, and nobody can read what it said. */
export const WIPE_HOLD_MIN = 420

/**
 * The branded graphic wipe. It sweeps in, holds while `ready` is false, then
 * sweeps out. The load happens behind it, so there is never a visible spinner.
 * If `ready` never arrives, WIPE_HOLD_MAX caps the hold so the app cannot
 * stall behind its own graphic.
 */
export function Wipe({
  show, ready = true, minHoldMs = WIPE_HOLD_MIN, cue = 'Next',
  place, sub, date, mark, note, facts = [], onCovered, onDone, brand,
}) {
  const [phase, setPhase] = useState('idle') // idle | in | out
  const timers = useRef([])

  // `ready` and the callbacks are read through refs rather than closed over.
  //
  // This is the whole reason the sweep used to restart mid-transition: with
  // `ready` in the dependency list, the moment the next view finished loading
  // the effect tore itself down and started again — a fresh panel, a fresh
  // clock, and a second onCovered. The caller would then reset its own loading
  // flag, which flipped `ready` back to false, and round it went. The wipe is
  // one animation with a lifetime of its own; what it is waiting for can change
  // underneath it without restarting it.
  const readyRef = useRef(ready)
  const coveredRef = useRef(onCovered)
  const doneRef = useRef(onDone)
  useEffect(() => {
    readyRef.current = ready
    coveredRef.current = onCovered
    doneRef.current = onDone
  })

  useEffect(() => {
    const clear = () => { timers.current.forEach(clearTimeout); timers.current = [] }
    if (!show) { clear(); setPhase('idle'); return }
    setPhase('in')
    const t0 = Date.now()
    let announced = false
    const hold = () => {
      // The panel is fully across: this is the moment to swap what is behind
      // it, so the change is never seen happening.
      if (!announced) { announced = true; coveredRef.current?.() }
      const held = Date.now() - t0
      if (held < minHoldMs || (!readyRef.current && held < WIPE_HOLD_MAX)) {
        timers.current.push(setTimeout(hold, 80)); return
      }
      setPhase('out')
      timers.current.push(setTimeout(() => { setPhase('idle'); doneRef.current?.() }, WIPE_OUT_MS))
    }
    timers.current.push(setTimeout(hold, WIPE_IN_MS))
    return clear
  }, [show, minHoldMs])

  if (phase === 'idle') return null
  return (
    <div className={`k-wipe ${phase}`} aria-hidden="true">
      <div className="k-wipe-panel">
        <div className="k-wipe-body">
          <span className="k-wipe-brand">
            {brand || (<><img src={logo} alt="" width="200" height="59" />
            {mark && <span className="k-wipe-mark">{mark}</span>}</>)}
          </span>
          <span className="k-wipe-cue">{cue}</span>
          <span className="k-wipe-place">{place || ' '}</span>
          <span className="k-wipe-sub">{sub || ' '}</span>
          <span className="k-wipe-date">{date || ' '}</span>
          {/* Optional, and additive: a wipe with nothing to say renders
              exactly what it always did. Where there is a record behind the
              ground, the panel is the one moment in the sequence with the
              viewer's whole attention and nothing competing for it — which
              makes it the right place for figures, rather than a caption
              fighting a satellite picture. Every number carries its sample. */}
          {note && <span className="k-wipe-note">{note}</span>}
          {facts.length > 0 && (
            <span className="k-wipe-facts">
              {facts.map((f) => (
                <span className="k-wipe-fact" key={f.k}>
                  <b>{f.v}</b>
                  <i>{f.k}</i>
                  {f.n && <em>{f.n}</em>}
                </span>
              ))}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
