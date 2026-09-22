import { useMemo } from 'react'
import { race } from '../../market/race.mjs'
import { writeRace } from '../lib/reportcopy.js'
import { Avatar } from '../screens/Market.jsx'
import './race.css'

/**
 * The race for number one.
 *
 * Everything else on the front page has already happened. This is the one
 * thing that has not: a gap, a challenger, and a deadline on Monday. It is
 * the difference between a page you read and a page you check.
 *
 * All of it is arithmetic over the live chart the strip has already
 * fetched — `race()` and `writeRace()` were written, tested and then wired
 * to nothing for a fortnight. No request, no endpoint, no store.
 *
 * It renders nothing when there is nothing to say. A race needs two names
 * and a clock, and inventing tension where there is none is how a feature
 * like this stops being believed.
 */
export function Race({ chart }) {
  const state = useMemo(() => (chart ? race(chart) : null), [chart])
  const said = useMemo(() => writeRace(state), [state])
  if (!state?.chaser || !said) return null

  return (
    <aside className={`rc${said.tight ? ' tight' : ''}${state.frozen ? ' frozen' : ''}`}>
      <span className="rc-kicker">
        {state.frozen ? 'The week is frozen' : 'The race for number one'}
      </span>

      <div className="rc-pair">
        <Faces row={state.leader} rank={1} />
        <span className="rc-gap" aria-hidden="true">
          <b>{state.gap}</b>
          <i>{state.gap === 1 ? 'point' : 'points'}</i>
        </span>
        <Faces row={state.chaser} rank={2} />
      </div>

      <p className="rc-head">{said.headline}</p>
      <p className="rc-line">{said.line}</p>

      {/* Only claimed when the arithmetic supports it: the rate they have
          been closing at, against the time actually left. A "could still
          catch them" that turns out to be decoration is the fastest way to
          make every other number here look decorative too. */}
      {state.catchable && !state.frozen && (
        <p className="rc-catch">At this rate they catch them before the close.</p>
      )}
    </aside>
  )
}

function Faces({ row, rank }) {
  return (
    <a className="rc-face" href={`/market/${row.slug}`}>
      <Avatar row={row} />
      <span className="rc-face-n">{row.displayName}</span>
      <span className="rc-face-s">{row.score}</span>
      <span className="rc-face-r">{rank === 1 ? 'Leading' : 'Second'}</span>
    </a>
  )
}
