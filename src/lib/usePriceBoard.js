import { useEffect, useState } from 'react'

/**
 * The exchange board, fetched once and shared.
 *
 * `useExchange` polls every fifteen minutes because the exchange screen is a
 * price ticker and a price that never moves is not one anybody believes. A
 * story page is not a ticker: it names somebody and says what they are worth
 * at the moment you read it. So this fetches once per session and hands the
 * same promise to every caller, rather than opening a poller per mounted
 * component.
 *
 * A failure is not an error state anywhere. The price is the optional half of
 * a rate — the score is always there — so a board that will not load quietly
 * leaves the G$ figure off.
 */
let pending = null

function board() {
  if (!pending) {
    pending = fetch('/api/exchange', { headers: { accept: 'application/json' } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => (data && !data.empty ? data : null))
      .catch(() => null)
  }
  return pending
}

export function usePriceBoard() {
  const [state, setState] = useState(null)
  useEffect(() => {
    let alive = true
    board().then((b) => { if (alive) setState(b) })
    return () => { alive = false }
  }, [])
  return state
}
