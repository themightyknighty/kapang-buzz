import { STRANDS, STRAND_KEYS } from '../lib/strands.js'
import { MIX_MAX, DEFAULT_MIX, isDefaultMix } from '../lib/mix.js'
import './mixsliders.css'

/**
 * How much of each strand the reader wants.
 *
 * The tabs above this filter to one strand at a time, which is a different
 * question: "show me only bizarre" rather than "show me mostly celebrity".
 * Most people want a lean, not a filter, and had no way to say so.
 *
 * Four sliders rather than one axis, because "all bizarre facts" is a real
 * request and a single celebrity-to-serious axis cannot express it. Zero
 * removes a strand outright, so the filter case is still reachable from the
 * same control — you do not have to learn two.
 *
 * It applies to the channel as well as the page: somebody who has asked for
 * one thing should not get another the moment they press play.
 */
export function MixSliders({ mix, onChange, counts = {} }) {
  const reset = () => onChange({ ...DEFAULT_MIX })
  return (
    <section className="b-mix" aria-label="How much of each kind of story">
      <div className="b-mix-head">
        <h2>Your mix</h2>
        <p>Drag a strand to nothing to drop it, or to the top to lead on it.</p>
        {!isDefaultMix(mix) && (
          <button type="button" className="b-mix-reset" onClick={reset}>Back to the published day</button>
        )}
      </div>

      <div className="b-mix-rows">
        {STRAND_KEYS.map((k) => {
          const held = counts[k] ?? 0
          return (
            <label key={k} className={`b-mix-row${mix[k] === 0 ? ' off' : ''}`} style={{ '--strand': STRANDS[k].color }}>
              <span className="b-mix-name">
                <i aria-hidden="true" />
                {STRANDS[k].short}
                {/* What is actually available. A slider promising more than
                    the day holds is a control that lies to its reader. */}
                <em>{held}</em>
              </span>
              <input
                type="range"
                min="0"
                max={MIX_MAX}
                step="1"
                value={mix[k]}
                aria-label={`How much ${STRANDS[k].label}`}
                onChange={(e) => onChange({ ...mix, [k]: Number(e.target.value) })}
              />
              <output>{mix[k] === 0 ? 'off' : mix[k]}</output>
            </label>
          )
        })}
      </div>
    </section>
  )
}

export default MixSliders
