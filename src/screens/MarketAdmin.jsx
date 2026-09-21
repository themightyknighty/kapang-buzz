/**
 * The admin panel — exactly why a celebrity has the score they have.
 *
 * This exists because the model will need tuning. Every component, weight and
 * contribution is stored at ingestion rather than just the total, which makes
 * two things possible: showing the full derivation, and re-scoring the whole
 * market against different weights in the browser without writing anything or
 * re-fetching anything.
 */
import { useMemo, useState } from 'react'
import { WEIGHTS } from '../../market/config.mjs'
import { gossipScore } from '../../market/score.mjs'
import { rankMarket } from '../../market/rank.mjs'
import { sinceLabel } from '../lib/useMarket.js'

const COMPONENT_COLOUR = {
  news: 'var(--c-news)', momentum: 'var(--c-momentum)',
  wikipedia: 'var(--c-wikipedia)', breadth: 'var(--c-breadth)',
}

function Derivation({ row }) {
  const c = row.contributions || {}
  return (
    <div className="mkt-derive-wrap">
    <table className="mkt-derive">
      <thead>
        <tr>
          <th className="l">Component</th><th>Score</th><th>Weight</th>
          <th>Effective</th><th>Freshness</th><th>Contribution</th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(c).map(([key, v]) => (
          <tr key={key} className={v.dropped ? 'dropped' : ''}>
            <td className="l">
              <span className="swatch" style={{ background: COMPONENT_COLOUR[key] }} />
              {key}{v.dropped ? ' (dropped — too stale)' : ''}
            </td>
            <td>{v.value == null ? '—' : v.value.toFixed(2)}</td>
            <td>{v.weight.toFixed(2)}</td>
            <td>{v.effectiveWeight.toFixed(3)}</td>
            <td>{v.freshnessFactor.toFixed(2)}</td>
            <td>{v.contribution.toFixed(2)}</td>
          </tr>
        ))}
        <tr>
          <td className="l">Raw total</td><td /><td /><td /><td /><td>{row.raw?.toFixed(2)}</td>
        </tr>
        <tr>
          <td className="l">× confidence ({row.mentions} stories)</td><td /><td /><td /><td />
          <td>{row.confidence?.toFixed(3)}</td>
        </tr>
        <tr className="total">
          <td className="l">Gossip Score</td><td /><td /><td /><td /><td>{row.gossipScore?.toFixed(2)}</td>
        </tr>
      </tbody>
    </table>
    </div>
  )
}

export default function MarketAdmin({ market }) {
  const [id, setId] = useState(null)
  const [weights, setWeights] = useState(WEIGHTS)

  // Re-rank the whole market under the sandbox weights. Possible only because
  // every component was stored, not just the total.
  const resorted = useMemo(() => {
    if (!market?.rows) return []
    const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1
    const norm = Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, v / total]))
    const rescored = market.rows.map((r) => {
      const c = r.contributions || {}
      const s = gossipScore({
        news: c.news?.value == null ? null : { score: c.news.value },
        wikipedia: c.wikipedia?.dropped || c.wikipedia?.value == null ? null : { score: c.wikipedia.value },
        breadth: c.breadth?.value == null ? null : { score: c.breadth.value },
        momentum: r.momentum, mentions: r.mentions, weights: norm,
      })
      return { ...r, gossipScore: s.score, raw: s.raw }
    })
    return rankMarket(rescored, { rows: market.rows })
  }, [market, weights])

  if (!market) return <div className="mkt"><div className="mkt-thin">Loading…</div></div>

  const row = resorted.find((r) => r.id === id) || resorted[0]
  const changed = JSON.stringify(weights) !== JSON.stringify(WEIGHTS)
  const moved = resorted.filter((r) => r.rankChange).length

  return (
    <div className="mkt">
      {market.mock && <div className="mkt-mock">Mock market — synthetic data for development. Not real attention figures.</div>}
      <div className="mkt-admin">
        <h1>Score explanation</h1>
        <p className="mkt-sub">Why the number is the number · <a className="mkt-back" href="/market">← Market</a></p>

        <div className="mkt-cols" style={{ marginTop: 20 }}>
          <section className="mkt-panel">
            <h2>Derivation</h2>
            <select value={row?.id} onChange={(e) => setId(e.target.value)} aria-label="Choose a celebrity">
              {resorted.map((r) => (
                <option key={r.id} value={r.id}>{r.rank}. {r.displayName} — {r.gossipScore.toFixed(1)}</option>
              ))}
            </select>
            {row && <Derivation row={row} />}
            {row && (
              <p className="mkt-note">
                Status <b>{row.status}</b> · momentum {row.momentum.toFixed(1)} · deviation {row.deviationZ?.toFixed(2)}σ
                {row.confidence < 1 && ` · confidence capped at ${Math.round(row.confidence * 100)}% on ${row.mentions} stories`}
              </p>
            )}
          </section>

          <section className="mkt-panel">
            <h2>Weights sandbox</h2>
            {Object.keys(WEIGHTS).map((k) => (
              <div className="mkt-weight" key={k}>
                <label htmlFor={`w-${k}`}>{k}</label>
                <input id={`w-${k}`} type="range" min="0" max="1" step="0.01" value={weights[k]}
                  onChange={(e) => setWeights((w) => ({ ...w, [k]: Number(e.target.value) }))} />
                <b>{weights[k].toFixed(2)}</b>
              </div>
            ))}
            <p className="mkt-note">
              {changed
                ? `${moved} of ${resorted.length} celebrities change rank under these weights. Nothing is saved — this recomputes in the browser from stored components.`
                : 'Move a slider to re-rank the whole market instantly. Nothing is written; this is for finding the weights worth deploying.'}
            </p>
            {changed && (
              <div className="mkt-derive-wrap"><table className="mkt-derive">
                <thead><tr><th className="l">Biggest moves</th><th>Rank</th><th>Was</th><th>Score</th></tr></thead>
                <tbody>
                  {resorted.slice().sort((a, b) => Math.abs(b.rankChange || 0) - Math.abs(a.rankChange || 0)).slice(0, 8).map((r) => (
                    <tr key={r.id}>
                      <td className="l">{r.displayName}</td>
                      <td>{r.rank}</td><td>{r.rankPrev ?? '—'}</td><td>{r.gossipScore.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </section>
        </div>

        <div className="mkt-cols" style={{ marginTop: 20 }}>
          <section className="mkt-panel">
            <h2>Data sources</h2>
            {Object.entries(market.health || {}).map(([k, h]) => (
              <div className="mkt-kv" key={k}>
                <span>{k}</span>
                <b className={h.ok ? '' : 'down'}>
                  {h.ok ? 'ok' : 'failing'} · last success {h.lastSuccess ? sinceLabel((Date.now() - Date.parse(h.lastSuccess)) / 1000) : 'never'}
                  {h.errors?.length ? ` · ${h.errors.length} errors` : ''}
                </b>
              </div>
            ))}
            {row && (
              <>
                <div className="mkt-kv"><span>Match rate</span><b>{row.matchRate != null ? `${Math.round(row.matchRate * 100)}%` : '—'}</b></div>
                <div className="mkt-kv"><span>Raw articles before de-duplication</span><b>{row.rawArticles ?? '—'}</b></div>
                <div className="mkt-kv"><span>Largest syndication cluster</span><b>{row.largestCluster ?? '—'}</b></div>
              </>
            )}
            <p className="mkt-note">
              A low match rate means the query is returning people who are not this celebrity —
              tighten their aliases or add an exclude.
            </p>

            {market.portraits && (
              <>
                <h2 style={{ marginTop: 20 }}>Portraits</h2>
                <div className="mkt-kv"><span>Celebrities with a picture</span>
                  <b>{market.portraits.withPicture} of {market.portraits.roster}</b></div>
                <div className="mkt-kv"><span>Looked up so far</span><b>{market.portraits.looked}</b></div>
                <div className="mkt-kv"><span>Refused on licence or rights</span>
                  <b className={market.portraits.refused > market.portraits.looked / 2 ? 'down' : ''}>{market.portraits.refused}</b></div>
                <div className="mkt-kv"><span>Personality-rights pictures</span>
                  <b>{market.portraits.personalityRightsAllowed ? 'used — editorial' : 'refused'}</b></div>
                <p className="mkt-note">
                  Every portrait comes from the celebrity's own Wikidata entry, so the identity is
                  looked up rather than guessed, and only Creative Commons and public-domain
                  licences are used. Commons's personality-rights flag sits on roughly a quarter of
                  celebrity photographs; those rights restrict commercial use, and the market is
                  editorial, so they are used — the flag is still recorded against each picture.
                  Trademark and other restrictions are refused. Set
                  <code> MKT_PORTRAIT_ALLOW_PERSONALITY=0 </code> to reverse that.
                </p>
              </>
            )}
          </section>

          <section className="mkt-panel">
            <h2>Raw</h2>
            <pre className="mkt-raw">{JSON.stringify(
              row ? {
                id: row.id, mentions: row.mentions, baselines: row.baselines,
                deviationZ: row.deviationZ, momentum: row.momentum,
                velocity1h: row.velocity1h, acceleration: row.acceleration,
                sources: row.sources, droppedSources: row.droppedSources,
              } : {}, null, 2)}
            </pre>
          </section>
        </div>
      </div>
    </div>
  )
}
