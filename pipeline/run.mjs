/**
 * One publishing run, end to end. Storage is injected so the same code runs
 * on Netlify (Blobs) and on a laptop (files).
 *
 *   harvest → cluster → drop covered → safety + verify + score → write →
 *   second safety pass + copy check → image → publish
 *
 * Auto-publish: there is no approval step. What stands in for the editor is
 * three independent safety gates, the two-outlet rule, and a kill switch
 * (BUZZ_PAUSED=1) plus a pull endpoint that removes a story within one request.
 */
import { harvestAll, addSummaries, fetchText } from './harvest.mjs'
import { clusterItems, alreadyCovered } from './cluster.mjs'
import { pickCandidates, runQuota, runIndexFor } from './select.mjs'
import { writeStory, validateDraft, copiesSource } from './writer.mjs'
import { checkStory } from './safety.mjs'
import { findMedia } from './images.mjs'
import { assembleStory, mergeFeed, updateSeen, buildBuzz } from './feed.mjs'
import { reviewPublished, createTally } from './review.mjs'
import { buildQuiz, quizIsStale } from './quiz.mjs'

export const KEYS = { feed: 'feed.json', seen: 'seen.json', log: 'run-log.json', pulled: 'pulled.json', history: 'run-history.json' }

async function pool(items, size, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k) }
  }))
  return out
}

/**
 * @param {object} o
 * @param {{getJSON(k):Promise<any>, setJSON(k,v):Promise<void>}} o.store
 * @param {string} [o.trigger]
 * @param {Date}   [o.now]
 * @param {Function} [o.fetchImpl]
 * @param {Function} [o.write]  injectable writer, for tests
 * @param {Function} [o.image]  injectable image finder, for tests
 * @param {Array}  [o.items]    injectable harvest, for tests
 */
export async function runPipeline({ store, trigger = 'manual', now = new Date(), fetchImpl = fetch, write, image, items, quiz, env = process.env } = {}) {
  const runId = now.toISOString()
  const log = []
  const summary = { runId, trigger, startedAt: runId, ok: false, published: 0, byStrand: {}, dropped: [], pictures: createTally(), lines: log }

  const saveLog = async () => {
    summary.finishedAt = new Date().toISOString()
    await store.setJSON(KEYS.log, summary)
    const history = (await store.getJSON(KEYS.history).catch(() => null)) || []
    history.unshift({ runId, trigger, ok: summary.ok, published: summary.published, byStrand: summary.byStrand, pictures: summary.pictures, error: summary.error || null })
    await store.setJSON(KEYS.history, history.slice(0, 30))
  }

  if (env.BUZZ_PAUSED === '1') {
    log.push('BUZZ_PAUSED=1 — publishing is switched off; the feed is untouched')
    summary.ok = true
    await saveLog()
    return summary
  }

  await store.setJSON(KEYS.log, { runId, trigger, startedAt: runId, running: true, lines: ['running…'] }).catch(() => {})

  try {
    const [previous, seen, pulled] = await Promise.all([
      store.getJSON(KEYS.feed).catch(() => null),
      store.getJSON(KEYS.seen).catch(() => null),
      store.getJSON(KEYS.pulled).catch(() => null),
    ])

    // 1. harvest
    const harvested = items || await harvestAll({ fetchImpl, log, now: now.getTime(), env })
    log.push(`harvest: ${harvested.length} headlines`)
    if (!harvested.length) throw new Error('every source failed — keeping the last good feed')

    // 2. cluster, and drop what we have already covered
    const seenKeys = new Set(Object.keys(seen || {}))
    const recent = (previous?.stories || []).map((s) => s.headline)
    const clusters = clusterItems(harvested).filter((c) => !alreadyCovered(c, seenKeys, recent))
    log.push(`cluster: ${clusters.length} new stories after removing ones already covered`)

    // 3–4. safety, verification, scoring
    const quota = runQuota(runIndexFor(now))
    const { picked, rejected } = pickCandidates(clusters, quota, { now: now.getTime() })
    log.push(`select: quota ${JSON.stringify(quota)}; ${picked.length} candidates, ${rejected.length} rejected before writing`)
    summary.dropped.push(...rejected.slice(0, 40).map((r) => ({ stage: 'select', ...r })))

    // 5–6. write and illustrate, strand by strand until each quota is met
    const writer = write || ((c) => writeStory(c, { fetchImpl }))
    const imager = image || ((strand, d, c) => findMedia(strand, d, c, { fetchImpl, log, tally: summary.pictures, env }))
    const need = { ...quota }
    const fresh = []
    const tried = []
    let writerBroken = null
    const drop = (c, stage, reason) => summary.dropped.push({ stage, strand: c.strand, title: c.lead.title, reason })

    const writeOne = async (c) => {
      tried.push(c)
      if (!items) await addSummaries(c, { fetchImpl })
      if (writerBroken) { drop(c, 'write', 'skipped — the writer is failing on configuration'); return null }
      try { return { c, d: await writer(c) } } catch (err) {
        if (/HTTP (400|401|403)/.test(err.message)) writerBroken = err.message
        drop(c, 'write', err.message); return null
      }
    }
    const accept = async ({ c, d }) => {
      if (d.familySafe === false) return drop(c, 'writer-safety', d.safetyNote || 'writer judged it unsafe')
      const problems = validateDraft(d)
      if (problems.length) return drop(c, 'validate', problems.join('; ') + (d.safetyNote ? ` (writer note: ${d.safetyNote})` : ''))
      const second = checkStory({ ...d, strand: c.strand })
      if (!second.ok) return drop(c, 'final-safety', second.reason)
      if (copiesSource(d, c)) return drop(c, 'copy-check', 'shares 8+ consecutive words with a source')
      let img = null
      try { img = await imager(c.strand, d, c) } catch (err) { log.push(`image: ${err.message}`) }
      fresh.push(assembleStory(c, d, img, { now, runId }))
      need[c.strand]--
    }

    // Write only as many as are still needed, strand by strand, in parallel
    // batches — every call costs money, so we stop the moment a quota is met.
    const queues = {}
    for (const c of picked) (queues[c.strand] ||= []).push(c)
    for (;;) {
      const batch = []
      for (const [strand, q] of Object.entries(queues)) batch.push(...q.splice(0, Math.max(0, need[strand] || 0)))
      if (!batch.length) break
      const results = await pool(batch, 4, writeOne)
      for (const r of results) if (r && need[r.c.strand] > 0) await accept(r)
    }

    if (writerBroken) { summary.error = `writer not working: ${writerBroken.slice(0, 300)}`; log.push(`WRITER FAILING — nothing can publish until this is fixed: ${writerBroken.slice(0, 300)}`) }
    for (const k of Object.keys(quota)) summary.byStrand[k] = quota[k] - need[k]
    summary.published = fresh.length
    const short = Object.entries(need).filter(([, n]) => n > 0)
    if (short.length) log.push(`short this run: ${short.map(([k, n]) => `${k} −${n}`).join(', ')}`)

    // 7. publish
    const feed = mergeFeed(previous, fresh, { now: now.getTime(), pulled: pulled || [] })

    /*
     * Re-look at anything already in the feed that was published before the
     * picture review existed, or under an older version of its rules.
     *
     * This is what replaces an approval queue. A rule tightened today reaches
     * every story still on the site within one run, without anyone deciding
     * story by story — and the story that prompted the tightening is corrected
     * by the same mechanism as the ones that come after it.
     */
    try {
      const healed = await reviewPublished(feed.stories, { fetchImpl, env, log, tally: summary.pictures })
      if (healed) log.push(`picture review: ${healed} already-published picture(s) re-checked`)
      const p = summary.pictures
      if (p.reviewed) {
        log.push(`pictures: looked at ${p.reviewed}, kept ${p.kept}, turned down ${p.rejected}`
          + (p.failed ? ` (of which ${p.failed} could not be reviewed at all — check the API key and model)` : '')
          + (Object.keys(p.reasons).length ? ` — ${Object.entries(p.reasons).map(([k, n]) => `${k}: ${n}`).join(', ')}` : ''))
      }
    } catch (err) {
      log.push(`picture re-review failed (${err.message}) — the app hides unreviewed pictures anyway`)
    }
    try {
      feed.buzz = await buildBuzz(feed.stories, { fetchText: (u) => fetchText(u, { fetchImpl }), now, log })
    } catch (err) {
      log.push(`buzz board: ${err.message} — keeping the previous board`)
    }
    // The daily quiz: rebuilt when new stories land or it is getting old; the last good one stays otherwise.
    feed.quiz = previous?.quiz || null
    if (!writerBroken && (fresh.length || quizIsStale(feed.quiz, now.getTime())) && feed.stories.length >= 2) {
      try {
        feed.quiz = await (quiz || buildQuiz)(feed.stories, { now, fetchImpl, env, log })
      } catch (err) {
        log.push(`quiz: ${err.message} — keeping the previous quiz`)
      }
    }
    feed.lastRun = { runId, published: fresh.length, byStrand: summary.byStrand }
    await store.setJSON(KEYS.feed, feed)
    // Seen = everything written (kept or dropped) and everything blocked as unsafe.
    // A story rejected only for thin coverage stays eligible: a second outlet may arrive.
    const unsafeKeys = new Set(rejected.filter((r) => /blocked/.test(r.reason)).map((r) => r.key))
    await store.setJSON(KEYS.seen, updateSeen(seen || {}, [...(writerBroken ? [] : tried), ...clusters.filter((c) => unsafeKeys.has(c.key))], now.getTime()))
    log.push(`publish: ${fresh.length} new, feed holds ${feed.stories.length}`)
    summary.ok = !writerBroken
  } catch (err) {
    summary.error = err.message
    log.push(`FAILED: ${err.message}`)
  }
  await saveLog()
  return summary
}

/** Pull a story off air immediately and stop it coming back. */
export async function pullStory(store, id) {
  const pulled = new Set((await store.getJSON(KEYS.pulled).catch(() => null)) || [])
  pulled.add(id)
  await store.setJSON(KEYS.pulled, [...pulled])
  const feed = await store.getJSON(KEYS.feed).catch(() => null)
  if (feed) {
    const before = feed.stories.length
    feed.stories = feed.stories.filter((s) => s.id !== id)
    await store.setJSON(KEYS.feed, feed)
    return before !== feed.stories.length
  }
  return false
}
