import { useEffect, useState } from 'react'

/**
 * One edition of the Genie 100.
 *
 * Unlike the market, this does not poll. A chart changes once a week, on a
 * Monday, and a page that re-fetches it every minute is asking a question
 * whose answer it already knows. It loads once and, if the visitor leaves the
 * tab open across a Monday morning, the reload they do anyway will pick up
 * the new one.
 *
 * There is also no mock fallback here, on purpose. The market may show
 * invented numbers while it warms up because an empty terminal looks broken;
 * a chart may not, because a chart is a claim about what actually happened.
 * Before the first Monday the screen says so and says when.
 */
export function useChart(weekId = null) {
  const [state, setState] = useState({ chart: null, loading: true, error: null, empty: false })

  // The running order is the one thing here that changes while you are
  // looking at it, so it is the one thing that polls. A published edition
  // never changes again, and asking for it twice would be asking a question
  // whose answer is already known.
  const isLive = weekId === 'live'

  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: !s.chart }))

    const url = weekId ? `/api/chart/${encodeURIComponent(weekId)}` : '/api/chart'
    const load = () => fetch(url, { headers: { accept: 'application/json' } })
      .then(async (res) => {
        const data = await res.json().catch(() => null)
        if (!alive) return
        if (data?.empty || (!res.ok && res.status === 404)) {
          setState({ chart: null, loading: false, error: null, empty: true, notYet: data })
          return
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setState({ chart: data, loading: false, error: null, empty: false })
      })
      .catch((err) => {
        // A failed refresh keeps whatever is on screen: a standing that is a
        // minute old beats an error where the chart was.
        if (alive) setState((s) => (s.chart ? s : { chart: null, loading: false, error: err.message, empty: false }))
      })

    load()
    if (!isLive) return () => { alive = false }

    // The market publishes every fifteen minutes; a minute is often enough to
    // catch it without being a poll worth worrying about.
    const timer = setInterval(load, 60000)
    return () => { alive = false; clearInterval(timer) }
  }, [weekId, isLive])

  return state
}

/** Every edition ever published, newest first. Loaded only when asked for. */
export function useChartIndex(enabled = true) {
  const [index, setIndex] = useState(null)
  useEffect(() => {
    if (!enabled) return undefined
    let live = true
    fetch('/api/chart/index', { headers: { accept: 'application/json' } })
      .then((r) => r.json())
      .then((d) => { if (live) setIndex(d) })
      .catch(() => { if (live) setIndex({ editions: [] }) })
    return () => { live = false }
  }, [enabled])
  return index
}
