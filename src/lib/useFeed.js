import { useEffect, useState, useCallback } from 'react'
import sample from '../data/sample-feed.json'

/**
 * The feed, refreshed every few minutes. Until the first live run has
 * published, the app shows the sample feed and says so on screen.
 * Sample times are shifted so they always look recent.
 */
function rebased() {
  const newest = Math.max(...sample.stories.map((s) => Date.parse(s.publishedAt)))
  const shift = Date.now() - 8 * 60000 - newest
  const move = (iso) => new Date(Date.parse(iso) + shift).toISOString()
  return { ...sample, generatedAt: move(sample.generatedAt), stories: sample.stories.map((s) => ({ ...s, publishedAt: move(s.publishedAt) })) }
}

export function useFeed(refreshMs = 5 * 60000) {
  const [feed, setFeed] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/feed', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!data.stories?.length) { setFeed(rebased()); return }
      setFeed(data); setError(null)
    } catch (err) {
      setError(err.message)
      setFeed((f) => (f && !f.sample ? f : rebased())) // keep the last good live feed if we had one
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, refreshMs)
    return () => clearInterval(t)
  }, [load, refreshMs])

  return { feed, error, reload: load }
}

/** Is the live feed older than it should be? Three runs a day → >9h is late. */
export const isStale = (feed, now = Date.now()) => Boolean(feed && !feed.sample && feed.generatedAt && now - Date.parse(feed.generatedAt) > 9 * 3600000)
