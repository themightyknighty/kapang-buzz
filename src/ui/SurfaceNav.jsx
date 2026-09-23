import { NAV } from '../lib/nav.js'
import { GenieLockup } from '../brand/Genie.jsx'
import { Notices } from './Notices.jsx'
import './surfacenav.css'

/**
 * The way out of a surface that carries no app chrome.
 *
 * The chart, the market and the exchange are routed before the header is
 * built, deliberately — they have their own cadence and a hundred-row page
 * does not want a date line and a legal footnote wrapped round it. What they
 * did not want either was to be places you cannot leave, and between them
 * they had four different ideas of the way out: the chart an unlabelled
 * lockup, the market a "← Stories" link, the channel an "Exit", the exchange
 * nothing whatsoever.
 *
 * So: one bar, the same six destinations as the header, in the same order and
 * the same words, marking where you are. It is a row rather than a chrome
 * block, and it sits inside whatever wrapper the surface already uses, so it
 * inherits that page's measure instead of arguing with it.
 */
export function SurfaceNav({ current = null, feed = null, market = null }) {
  return (
    <nav className="sn" aria-label="Sections">
      <a href="/" className="sn-mark" aria-label="Gossip Genie home">
        <GenieLockup descriptor="Gossip" height={22} />
      </a>
      <div className="sn-links">
        {NAV.map((item) => (
          <a
            key={item.section}
            href={item.href}
            className={[item.tone, item.live && 'live', item.section === current && 'on']
              .filter(Boolean).join(' ') || undefined}
            aria-current={item.section === current ? 'page' : undefined}
          >
            {item.live && <span className="dot" />}
            {item.label}
          </a>
        ))}
      </div>
      {/* The bell comes too. It used to exist only where the header did, so
          a reader on the chart or the market could not see an alert at all —
          and, because it sits to the right of the links, its absence moved
          the whole menu 56px between one section and the next. */}
      <Notices feed={feed} market={market} />
    </nav>
  )
}

export default SurfaceNav
