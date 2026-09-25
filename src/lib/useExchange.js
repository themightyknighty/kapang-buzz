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
/*
 * Sixty seconds, not fifteen minutes.
 *
 * The board is rewritten by the ingestion run every quarter of an hour, so a
 * fifteen-minute client timer looks right — but it is phase-blind. Landing on
 * the wrong side of the write meant a quote could sit fourteen minutes stale
 * on a screen whose whole claim is that it is live, and the endpoint itself
 * revalidates at sixty seconds (`s-maxage=60`). Polling on the cadence the
 * cache already allows costs one conditional request a minute and means a new
 * price is on screen within a minute of existing.
 */
const POLL_MS = 60 * 1000

/**
 * What changed between two boards.
 *
 * Every piece of motion on the exchange screen is driven by this and nothing
 * else. A price that did not move does not flash, because a market screen
 * that animates on a timer rather than on a trade is a screen that lies about
 * the one thing it exists to report.
 *
 * Keyed by id, carrying the direction and the moment, so a name that ticks
 * twice the same way still restarts its own animation.
 */
export function ticksBetween(before, after) {
  const was = new Map((before?.names || []).map((n) => [n.id, n.price]))
  const at = Date.now()
  const out = new Map()
  for (const n of after?.names || []) {
    const then = was.get(n.id)
    if (!Number.isFinite(then) || !Number.isFinite(n.price) || then === n.price) continue
    out.set(n.id, { dir: n.price > then ? 'up' : 'down', from: then, at })
  }
  return out
}

export function useExchange() {
  const [state, setState] = useState({ board: null, loading: true, error: null, empty: false, ticks: new Map() })

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
        setState((s) => ({
          board: data,
          loading: false,
          error: null,
          empty: false,
          // Against the board we were showing, not against the last fetch:
          // an unchanged poll must not wipe the marks from a real one.
          ticks: ticksBetween(s.board, data),
        }))
      })
      .catch((err) => { if (alive) setState((s) => ({ ...s, loading: false, error: err.message })) })

    load()
    const id = setInterval(load, POLL_MS)
    /*
     * A tab left open overnight is the common case for something people
     * check rather than read, and a background timer is throttled hard or
     * stopped outright while a tab is asleep. Coming back to the page
     * refreshes it.
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
