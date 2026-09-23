import { usePriceBoard } from '../lib/usePriceBoard.js'
import { ratesFor, priceLabel, scoreLabel } from '../lib/rates.js'
import './marketrate.css'

/**
 * What the people in this story are worth, right now.
 *
 * A story names up to four people and used to say nothing about any of them,
 * which wasted the one thing this site has that a news page does not: it has
 * been measuring these names all week. A reader who has just read about
 * somebody could not tell whether this was the biggest week of their life or
 * an ordinary Tuesday.
 *
 * The score is always there and always current. The price is fantasy money,
 * settled once a day, and exists only for names the Exchange has listed — so
 * it appears beside the ones that have one and is simply absent beside the
 * ones that do not, rather than printed as a dash. A dash reads as a price of
 * nothing, which is a different and untrue claim.
 *
 * Renders nothing when the market tracks nobody in the story, which is most
 * stories: the market is a hundred names and the feed covers thousands.
 */
export function MarketRate({ people = [], market = null, label = 'Market rate' }) {
  const board = usePriceBoard()
  const rates = ratesFor(people, { market, board })
  if (!rates.length) return null

  return (
    <div className="b-rate">
      <span className="b-rate-label">{label}</span>
      {rates.map((r) => {
        const price = priceLabel(r)
        return (
          <a key={r.id} className="b-rate-chip" href={r.href}>
            <span className="nm">{r.displayName}</span>
            <b>{scoreLabel(r)}</b>
            {Number.isFinite(r.change24h) && Math.abs(r.change24h) >= 0.5 && (
              <i className={r.change24h > 0 ? 'up' : 'down'}>
                {r.change24h > 0 ? '+' : '−'}{Math.abs(r.change24h).toFixed(1)}
              </i>
            )}
            {price && <em>{price}</em>}
          </a>
        )
      })}
    </div>
  )
}

export default MarketRate
