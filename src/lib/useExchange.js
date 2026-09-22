import { useEffect, useState } from 'react'

/**
 * The exchange board.
 *
 * Unlike the chart, which is a claim about a finished week, this is a price
 * — and a price that does not move is not one anybody believes. The board is
 * rewritten every fifteen minutes by the ingestion run, so the page polls on
 * the same cadence rather than making the visitor reload to find out whether
 * anything happened.
 *
 * There is no mock fallback. The market screen may show invented numbers
 * while it warms up because an empty terminal looks broken; an exchange may
 * not, because every number on it is something somebody could act on. Before
 * the first settle it says it has not opened yet, and says why.
 */
const POLL_MS = 15 * 60 * 1000

export function useExchange() {
  const [state, setState] = useState({ board: null, loading: true, error: null, empty: false })

  useEffect(() => {
    let alive = true
    const load = () => fetch('/api/exchange', { headers: { accept: 'application/json' } })
      .then(async (res) => {
        const data = await res.json().catch(() => null)
        if (!alive) return
        if (data?.empty) {
          setState({ board: null, loading: false, error: null, empty: true, reason: data.reason })
          return
        }
        if (!res.ok || !data) throw new Error(`the exchange did not answer (${res.status})`)
        setState({ board: data, loading: false, error: null, empty: false })
      })
      .catch((err) => { if (alive) setState((s) => ({ ...s, loading: false, error: err.message })) })

    load()
    const id = setInterval(load, POLL_MS)
    /*
     * A tab left open overnight is the common case for something people
     * check rather than read, and a fifteen-minute timer does not fire
     * while a tab is asleep. Coming back to the page refreshes it.
     */
    const onWake = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onWake)
    return () => {
      alive = false
      clearInterval(id)
      document.removeEventListener('visibilitychange', onWake)
    }
  }, [])

  return state
}
