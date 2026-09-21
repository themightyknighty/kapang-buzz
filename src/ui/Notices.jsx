import { useEffect, useMemo, useRef, useState } from 'react'
import { buildAlerts, unread, followedPeople, followedStrands } from '../lib/alerts.js'
import { loadNotices, markSeen, firstVisit, since } from '../lib/noticestate.js'
import { loadPrefs } from '../lib/prefs.js'
import { ago } from '../lib/time.js'

/**
 * The bell.
 *
 * Everything in it is worked out in the page from the feed and the market the
 * app has already loaded — nothing is polled, nothing is pushed, nothing
 * leaves the browser. A reader who follows nobody gets a quiet bell and one
 * line telling them how to make it useful, rather than a list of things the
 * site would like them to look at.
 *
 * Opening it marks everything read and moves the "since you were last here"
 * mark, which is the only thing that makes the count mean anything.
 */
export function Notices({ feed, market }) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState(() => firstVisit(loadNotices()))
  const [prefs] = useState(loadPrefs)
  const box = useRef(null)

  const alerts = useMemo(
    () => buildAlerts({ feed, market, prefs, since: since(state) }),
    // `state` is deliberately not a dependency: re-reading the mark the moment
    // it moves would empty the panel while it is open, under the reader's hand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feed, market, prefs],
  )
  const count = unread(alerts, state).length

  useEffect(() => {
    if (!open) return undefined
    const away = (e) => { if (!box.current?.contains(e.target)) setOpen(false) }
    const key = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key) }
  }, [open])

  const toggle = () => {
    setOpen((was) => {
      if (!was) setState((s) => markSeen(s, alerts))
      return !was
    })
  }

  const following = followedPeople(prefs).length + followedStrands(prefs).length

  return (
    <div className={`nt${open ? ' open' : ''}`} ref={box}>
      <button
        type="button"
        className="nt-btn"
        onClick={toggle}
        aria-expanded={open}
        aria-label={count ? `Notifications, ${count} new` : 'Notifications'}
      >
        <BellIcon ringing={count > 0} />
        {count > 0 && <span className="nt-count">{count > 9 ? '9+' : count}</span>}
      </button>

      {open && (
        <div className="nt-panel">
          <div className="nt-head">
            <h2>What’s new</h2>
            {alerts.length > 0 && <span>{alerts.length}</span>}
          </div>

          {alerts.length === 0 ? (
            <p className="nt-empty">
              {following
                ? 'Nothing new since you were last here.'
                : 'Nothing yet. Follow a celebrity on a story, or a strand on the front page, and this is where they turn up.'}
            </p>
          ) : (
            <ul className="nt-list">
              {alerts.map((a) => (
                <li key={a.id} className={`nt-item ${a.tone}`}>
                  <a href={a.href} onClick={() => setOpen(false)}>
                    <b>{a.title}</b>
                    {a.text && <span className="nt-text">{a.text}</span>}
                    <span className="nt-when">{ago(new Date(a.at).toISOString())}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}

          {following === 0 && alerts.length > 0 && (
            <p className="nt-foot">Follow a celebrity or a strand and this gets a lot more useful.</p>
          )}
        </div>
      )}
    </div>
  )
}

const BellIcon = ({ ringing }) => (
  <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" focusable="false" className={ringing ? 'ring' : ''}>
    <path
      d="M18 15.5V10a6 6 0 1 0-12 0v5.5L4.5 18h15L18 15.5Z"
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"
    />
    <path d="M10 18a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
)

export default Notices
