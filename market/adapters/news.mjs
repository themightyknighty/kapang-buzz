/**
 * NewsAdapter — coverage volume from GDELT.
 *
 * GDELT rate-limits hard and this project has already been bitten by it from
 * Netlify's shared IPs, so the defences here are structural rather than
 * hopeful: a gap between calls, exponential backoff with jitter, a circuit
 * breaker, a per-run call ceiling, and a cache that serves a recent response
 * rather than asking again.
 *
 * The important design choice is `timelinevolraw`: it returns a TIME SERIES,
 * not a single count. One call per celebrity per hour therefore yields the
 * volume curve that velocity and acceleration are computed from — momentum
 * does not need high-frequency polling, it needs one well-chosen call.
 */
import { GDELT, UA } from '../config.mjs'
import { buildQuery, measureNews } from '../match.mjs'

export const meta = { key: 'news', label: 'News coverage', cadenceMinutes: 60, weightGroup: 'news' }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** GDELT signals a rate limit in the body as often as in the status. */
const rateLimited = (status, text) =>
  status === 429 || /rate limit|too many requests|please wait|please limit requests/i.test(text || '')

/**
 * One GDELT request, with backoff. Returns `{ ok, data, rateLimited, error }`
 * rather than throwing, because one celebrity failing must never stop the run.
 */
export async function gdeltFetch(url, { fetchImpl = fetch, retries = GDELT.retries, backoffMs = GDELT.backoffMs, log = [] } = {}) {
  let wait = backoffMs
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
      const text = await res.text()
      if (rateLimited(res.status, text)) {
        // Carry what the server actually said. "Rate limited" with no evidence
        // is undiagnosable, and GDELT answers in plain text as often as in a
        // status code.
        if (attempt === retries) {
          return { ok: false, rateLimited: true, status: res.status, body: text.slice(0, 300),
            error: `rate limited after ${retries + 1} attempts (HTTP ${res.status}): ${text.slice(0, 160).replace(/\s+/g, ' ').trim()}` }
        }
        // Jitter, so a whole shard does not retry in lockstep.
        await sleep(wait + Math.random() * wait * 0.4)
        wait *= 2
        continue
      }
      if (!res.ok) return { ok: false, status: res.status, body: text.slice(0, 300), error: `HTTP ${res.status}: ${text.slice(0, 160).replace(/\s+/g, ' ').trim()}` }
      try {
        const data = JSON.parse(text)
        if (!data || Object.keys(data).length === 0) {
          return { ok: false, status: res.status, body: text.slice(0, 300), empty: true,
            error: 'empty result — the query matched nothing (check encoding and aliases)' }
        }
        return { ok: true, data }
      }
      catch { return { ok: false, status: res.status, body: text.slice(0, 300), error: `non-JSON response: ${text.slice(0, 160).replace(/\s+/g, ' ').trim()}` } }
    } catch (err) {
      if (attempt === retries) return { ok: false, error: err.message }
      await sleep(wait); wait *= 2
    }
  }
  return { ok: false, error: 'unreachable' }
}

/**
 * Build the URL by hand rather than with URLSearchParams.
 *
 * URLSearchParams uses form encoding, which turns a space into "+". GDELT
 * then searches for the literal string `Timothee+Chalamet`, matches nothing,
 * and answers HTTP 200 with `{}` — a silent empty result that looks like the
 * celebrity simply had no coverage. Spaces must be %20.
 */
const docUrl = (query, mode, extra = {}) => {
  const params = { query, mode, format: 'json', timespan: GDELT.timespan, ...extra }
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
  return `${GDELT.docApi}?${qs}`
}

/** GDELT's own `YYYYMMDDTHHMMSSZ` stamps. */
export function parseGdeltDate(s) {
  const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/)
  if (!m) { const t = Date.parse(s); return Number.isFinite(t) ? t : null }
  const [, y, mo, d, h, mi, se] = m
  return Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${se}Z`)
}

/** The volume timeline, as points the momentum engine can read. */
export function timelinePoints(data) {
  const series = data?.timeline?.[0]?.data || []
  return series
    .map((p) => ({ t: parseGdeltDate(p.date), v: Number(p.value) || 0 }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t)
}

/**
 * A circuit breaker shared across a run. Three consecutive rate limits and the
 * adapter stops asking for half an hour — the market keeps updating on the
 * other sources and on carried-forward values rather than hammering a door
 * that is closed.
 */
export function createBreaker({ trips = GDELT.breakerTrips, cooldownMs = GDELT.breakerCooldownMs } = {}) {
  let consecutive = 0, openedAt = 0
  return {
    get open() { return openedAt > 0 && Date.now() - openedAt < cooldownMs },
    get state() { return { consecutive, openedAt } },
    hit() { if (++consecutive >= trips) openedAt = Date.now() },
    clear() { consecutive = 0; openedAt = 0 },
  }
}

/**
 * One raw call, unretried, returning exactly what came back. This is the
 * diagnostic: when a sweep reports rate limiting, this says whether that is
 * really what the server sent.
 */
export async function probe(celebrity, { fetchImpl = fetch, mode = 'timelinevolraw', query = null } = {}) {
  query = query ?? buildQuery(celebrity)
  const url = docUrl(query, mode)
  const started = Date.now()
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
    const text = await res.text()
    return { url, query, status: res.status, ms: Date.now() - started, bytes: text.length, body: text.slice(0, 600) }
  } catch (err) {
    return { url, query, status: null, ms: Date.now() - started, error: err.message }
  }
}

/**
 * Collect news signals for a set of celebrities.
 *
 * Returns one `Signal` per celebrity that could be measured. Celebrities that
 * failed are simply absent — the caller carries their previous value forward
 * with its freshness clock still running, rather than scoring them as zero.
 */
export async function collect(celebrities, {
  now = Date.now(), fetchImpl = fetch, log = [], breaker = createBreaker(),
  maxCalls = Infinity, gapMs = GDELT.gapMs, deadline = Infinity,
  // A full sweep takes minutes. Anything watching it run needs to see it move.
  onProgress = null,
} = {}) {
  const signals = []
  let calls = 0
  let done = 0

  for (const celebrity of celebrities) {
    if (breaker.open) { log.push('news: circuit breaker open — skipping the rest of this run'); break }
    if (calls >= maxCalls) { log.push(`news: call ceiling (${maxCalls}) reached`); break }
    if (Date.now() > deadline) { log.push('news: run deadline reached'); break }
    if (calls > 0) await sleep(gapMs)

    const query = buildQuery(celebrity)
    const vol = await gdeltFetch(docUrl(query, 'timelinevolraw'), { fetchImpl, log })
    calls++
    if (!vol.ok) {
      if (vol.rateLimited) breaker.hit()
      log.push(`news: ${celebrity.id} — ${vol.error}`)
      onProgress?.({ celebrity, index: ++done, total: celebrities.length, ok: false, error: vol.error, rateLimited: vol.rateLimited })
      continue
    }
    breaker.clear()

    await sleep(gapMs)
    const arts = await gdeltFetch(docUrl(query, 'artlist', { maxrecords: String(GDELT.maxArticles), sort: 'datedesc' }), { fetchImpl, log })
    calls++
    if (!arts.ok && arts.rateLimited) breaker.hit()

    const articles = arts.ok ? (arts.data?.articles || []) : []
    const measured = measureNews(celebrity, articles, { now })
    const points = timelinePoints(vol.data)

    signals.push({
      source: 'news',
      celebrityId: celebrity.id,
      timestamp: new Date(now).toISOString(),
      raw: measured.mentions,
      series: points,
      // Normalization happens in the engine, against this celebrity's own
      // baseline — an adapter has no idea what is normal for anyone.
      normalized: null,
      confidence: articles.length ? measured.matchRate : 0.4,
      freshnessSeconds: 0,
      meta: {
        ...measured,
        clusters: undefined,
        query,
        articlesOk: arts.ok,
        // The stories behind the number, for the detail page.
        drivers: measured.clusters.slice(0, 10).map((c) => ({
          title: c[0].title,
          url: c[0].url,
          domain: (c[0].url || '').replace(/^https?:\/\/(www\.)?/, '').split('/')[0],
          publishers: new Set(c.map((a) => a.domain || a.url)).size,
          firstSeen: new Date(Math.min(...c.map((a) => parseGdeltDate(a.seendate) || now))).toISOString(),
        })),
      },
    })
    onProgress?.({ celebrity, index: ++done, total: celebrities.length, ok: true, measured, articles: articles.length })
  }

  return { signals, calls, breakerOpen: breaker.open }
}
