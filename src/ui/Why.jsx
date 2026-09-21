/**
 * Why a celebrity is moving — the one sentence, and the way to go and read it.
 *
 * Every surface that says "X is rising" has to be able to answer "says who?",
 * so this is the single place that turns a `reason` from lib/movers.js into
 * something on screen. Three cases, and they are not interchangeable:
 *
 *  - We published a story: the headline, linking to our own page for it.
 *  - We did not, but outlets are covering it: who they are, linking out to
 *    the article itself. That link leaves the app, so it opens in a new tab
 *    and carries rel="noopener".
 *  - Neither: it says so. The score is moving on coverage volume with nothing
 *    behind it we can name, and pretending otherwise is how a market becomes
 *    a rumour mill.
 *
 * The classes are shared across the news app and the market, which load the
 * same stylesheet, so a change to how a reason reads happens once.
 */
import { shortReason } from '../lib/movers.js'

const verb = (direction) => (direction === 'down' ? 'is sliding' : 'is climbing')

/** The href, and whether following it leaves Gossip Genie. */
export function reasonLink(reason) {
  if (!reason?.href) return null
  const external = reason.kind !== 'story'
  return { href: reason.href, external, label: external ? 'Read the coverage' : 'Read the story' }
}

/**
 * The full block: who is moving, why, and the link. Used where there is room
 * to explain — the front page's lead, a celebrity's own page.
 */
export function Why({ reason, name, direction, showName = true, className = '' }) {
  if (!reason) return null
  const link = reasonLink(reason)
  return (
    <div className={`why ${reason.kind}${className ? ` ${className}` : ''}`}>
      {showName && name && <b className="why-who">{name} {verb(direction)}</b>}
      {reason.kind === 'story' && (
        <>
          <span className="why-head">{reason.headline}</span>
          {reason.text && <span className="why-text">{reason.text}</span>}
        </>
      )}
      {reason.kind === 'coverage' && (
        <span className="why-text">{reason.text}. We have not published a story on this one yet.</span>
      )}
      {reason.kind === 'none' && (
        <span className="why-text">{reason.text} — the score is moving on coverage volume alone.</span>
      )}
      {link && (
        <a className="why-link" href={link.href}
          {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
          {link.label} {link.external ? '↗' : '→'}
        </a>
      )}
    </div>
  )
}

/**
 * The one-line version, for a row on a board. It is the link itself, because
 * a row has no room for a separate "read this" and the headline is the thing
 * you want to click.
 */
export function WhyLine({ reason, max = 72, className = '' }) {
  const text = shortReason(reason, { max })
  if (!text) return null
  const link = reasonLink(reason)
  const cls = `why-line ${reason.kind}${className ? ` ${className}` : ''}`
  if (!link) return <span className={cls}>{text}</span>
  return (
    <a className={cls} href={link.href}
      {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      {text}
    </a>
  )
}

/** The same line without any link, for the Watch screen — nothing on air is clickable. */
export function WhyCaption({ reason, max = 64 }) {
  const text = shortReason(reason, { max })
  return text ? <span className="why-cap">{text}</span> : null
}
