/** GET /api/status — did the last runs work, and why were stories dropped? */
import { blobStore, json } from './_store.mjs'
import { KEYS } from '../../pipeline/run.mjs'

/**
 * How the picture review is doing, across however many runs we still hold.
 *
 * The single number worth watching is the share turned down. A rise because
 * `people` is climbing means the picture sources are full of people, which is
 * the check working. A rise in `error` means the check itself is broken and
 * stories are losing pictures for no reason at all. They look the same from
 * outside, so they are reported apart.
 */
function pictureStats(history = [], lastRun) {
  const runs = history.filter((h) => h?.pictures?.reviewed)
  const add = (a, b) => ({
    reviewed: a.reviewed + b.reviewed, kept: a.kept + b.kept,
    rejected: a.rejected + b.rejected, failed: a.failed + (b.failed || 0),
    reasons: Object.entries(b.reasons || {}).reduce((r, [k, n]) => ({ ...r, [k]: (r[k] || 0) + n }), a.reasons),
  })
  const total = runs.map((h) => h.pictures).reduce(add, { reviewed: 0, kept: 0, rejected: 0, failed: 0, reasons: {} })
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : null)
  return {
    lastRun: lastRun?.pictures?.reviewed
      ? { ...lastRun.pictures, rejectedPct: pct(lastRun.pictures.rejected, lastRun.pictures.reviewed) }
      : null,
    acrossRuns: runs.length,
    ...total,
    rejectedPct: pct(total.rejected, total.reviewed),
    // Said in words, because a percentage on its own invites the wrong reading.
    reading: !total.reviewed ? 'no pictures reviewed yet — the first run after deploy will fill this in'
      : total.failed > total.reviewed * 0.2 ? 'MOST REJECTIONS ARE FAILURES, NOT JUDGEMENTS — check ANTHROPIC_API_KEY and REVIEW_MODEL'
        : `${pct(total.kept, total.reviewed)}% of pictures are being published`,
  }
}

export default async (req) => {
  const store = blobStore()
  const [feed, log, history] = await Promise.all([KEYS.feed, KEYS.log, KEYS.history].map((k) => store.getJSON(k).catch(() => null)))
  // /api/status?pictures=1 answers just "how much is it turning down?" —
  // the full status is a wall of run history, which is the wrong shape for a
  // question you want to glance at.
  const stats = pictureStats(history || [], log)
  if (new URL(req.url).searchParams.has('pictures')) return json({ checkedAt: new Date().toISOString(), ...stats })

  return json({
    checkedAt: new Date().toISOString(),
    paused: process.env.BUZZ_PAUSED === '1',
    writerConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    feed: feed ? { generatedAt: feed.generatedAt, stories: feed.stories.length, last24h: feed.counts } : null,
    pictures: stats,
    lastRun: log,
    history: history || [],
  })
}
