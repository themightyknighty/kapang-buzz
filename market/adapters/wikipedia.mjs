/**
 * WikipediaAdapter — daily pageviews from the Wikimedia Analytics API.
 *
 * Per-article pageviews are DAILY only. There is no public hourly per-article
 * feed, and a day's figure lands a day or two after the fact. So Wikipedia is
 * not a live signal and is never presented as one: its `freshnessSeconds` is
 * genuinely large, the UI says so, and the engine down-weights it accordingly.
 *
 * That suits its job. It is a good baseline signal — a sustained lift in
 * people looking someone up — and a poor breaking-news signal, which is why
 * it carries only 15% of the score.
 *
 * One request per celebrity per day returns a 60-day range, so the whole
 * roster is ~100 requests once a day.
 */
import { WIKIPEDIA, UA } from '../config.mjs'

export const meta = { key: 'wikipedia', label: 'Wikipedia interest', cadenceMinutes: 1440, weightGroup: 'wikipedia' }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const stamp = (d) => new Date(d).toISOString().slice(0, 10).replace(/-/g, '')

export function pageviewsUrl(pageTitle, fromMs, toMs) {
  const article = encodeURIComponent(String(pageTitle).replace(/ /g, '_'))
  return [WIKIPEDIA.pageviewsApi, WIKIPEDIA.project, WIKIPEDIA.access, WIKIPEDIA.agent,
    article, WIKIPEDIA.granularity, stamp(fromMs), stamp(toMs)].join('/')
}

/**
 * Wikimedia's data lags, so "today" is usually absent and the newest complete
 * day is the one to use. Returning its age honestly is the whole point.
 */
export function readViews(payload, now = Date.now()) {
  const items = (payload?.items || [])
    .map((i) => ({ day: `${i.timestamp.slice(0, 4)}-${i.timestamp.slice(4, 6)}-${i.timestamp.slice(6, 8)}`, views: Number(i.views) || 0 }))
    .sort((a, b) => a.day.localeCompare(b.day))
  if (!items.length) return null
  const latest = items.at(-1)
  const ageSeconds = Math.max(0, Math.round((now - Date.parse(`${latest.day}T23:59:59Z`)) / 1000))
  return {
    latest: latest.views,
    latestDay: latest.day,
    ageSeconds,
    daily: items.map((i) => i.views),
    days: items.map((i) => i.day),
  }
}

export async function collect(celebrities, {
  now = Date.now(), fetchImpl = fetch, log = [], gapMs = WIKIPEDIA.gapMs,
  lookbackDays = WIKIPEDIA.lookbackDays, deadline = Infinity,
} = {}) {
  const signals = []
  const from = now - lookbackDays * 86400000
  let calls = 0

  for (const celebrity of celebrities) {
    if (Date.now() > deadline) { log.push('wikipedia: run deadline reached'); break }
    if (calls > 0) await sleep(gapMs)
    try {
      const res = await fetchImpl(pageviewsUrl(celebrity.wikipediaPageTitle, from, now),
        { headers: { 'User-Agent': UA, Accept: 'application/json' } })
      calls++
      if (res.status === 404) { log.push(`wikipedia: ${celebrity.id} — no such article (${celebrity.wikipediaPageTitle})`); continue }
      if (!res.ok) { log.push(`wikipedia: ${celebrity.id} — HTTP ${res.status}`); continue }
      const views = readViews(await res.json(), now)
      if (!views) { log.push(`wikipedia: ${celebrity.id} — empty response`); continue }

      signals.push({
        source: 'wikipedia',
        celebrityId: celebrity.id,
        timestamp: new Date(now).toISOString(),
        raw: views.latest,
        series: null,
        normalized: null,
        // Confidence falls away as the newest complete day recedes.
        confidence: views.ageSeconds < 172800 ? 0.9 : 0.6,
        freshnessSeconds: views.ageSeconds,
        meta: { latestDay: views.latestDay, daily: views.daily, days: views.days, pageTitle: celebrity.wikipediaPageTitle },
      })
    } catch (err) {
      log.push(`wikipedia: ${celebrity.id} — ${err.message}`)
    }
  }
  return { signals, calls }
}
