import { useEffect, useState } from 'react'
import { remaining } from '../lib/countdown.js'

/**
 * How long until the week freezes.
 *
 * The one thing on the page that visibly moves while you look at it, and the
 * reason the live standings are worth checking rather than skimming: what is
 * on screen is not final, and there is a deadline. It ticks by the minute
 * under an hour and by the hour above it — a seconds counter on a five-day
 * wait is a fidget, not information.
 */
export function Countdown({ at, label = 'Freezes in', onDone = null }) {
  const target = at ? Date.parse(at) : NaN
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!Number.isFinite(target)) return undefined
    // A minute is the finest grain shown, so there is no reason to wake up
    // more often than that.
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [target])

  if (!Number.isFinite(target)) return null
  const left = target - now
  if (left <= 0) {
    return <span className="cd done">{onDone || 'Freezing now'}</span>
  }

  return (
    <span className="cd">
      <span className="cd-label">{label}</span>
      <b>{remaining(left)}</b>
    </span>
  )
}

export default Countdown
