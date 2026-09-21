import { useEffect, useRef, useState } from 'react'
import { shareTargets, absolute, canNativeShare } from '../lib/share.js'

/**
 * The share control.
 *
 * On a phone this is one tap into the operating system's own share sheet,
 * which is where people actually want to be: their thread, their group, their
 * notes app. On a desktop, where that sheet mostly does not exist, it opens a
 * short list — copy the link first, because copying is what people do — and
 * the handful of places these stories genuinely get sent.
 *
 * The link it shares is a real URL to a real page with its own preview card
 * (see netlify/functions/page.mjs). Nothing is tracked onto the end of it: a
 * link with a campaign parameter stapled on is a link that does not match the
 * one the next person shares, and the two stop being the same story.
 */
export function Share({ title, text = '', path, label = 'Share', compact = false, tone = null }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const box = useRef(null)
  const url = absolute(path)

  useEffect(() => {
    if (!open) return undefined
    const away = (e) => { if (!box.current?.contains(e.target)) setOpen(false) }
    const key = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key) }
  }, [open])

  // The "copied" note clears itself; nobody needs to dismiss a confirmation.
  useEffect(() => {
    if (!copied) return undefined
    const t = setTimeout(() => setCopied(false), 2400)
    return () => clearTimeout(t)
  }, [copied])

  const copy = async () => {
    const ok = await copyText(url)
    setCopied(ok)
    if (!ok) window.prompt('Copy this link', url)
  }

  const onClick = async () => {
    if (canNativeShare()) {
      try {
        await navigator.share({ title, text, url })
        return
      } catch (err) {
        // A cancelled share is not a failure and must not fall through to the
        // menu — the person just said no.
        if (err?.name === 'AbortError') return
      }
    }
    setOpen((v) => !v)
  }

  return (
    <div className={`sh${compact ? ' compact' : ''}${open ? ' open' : ''}`} ref={box} style={tone ? { '--sh-tone': tone } : undefined}>
      <button
        type="button"
        className="sh-btn"
        onClick={onClick}
        aria-expanded={open}
        aria-haspopup={canNativeShare() ? undefined : 'menu'}
        aria-label={compact ? `${label}: ${title}` : undefined}
      >
        <ShareIcon />
        {!compact && <span>{copied ? 'Link copied' : label}</span>}
      </button>

      {open && (
        <div className="sh-menu" role="menu">
          <button type="button" role="menuitem" className="sh-item" onClick={copy}>
            <span className="sh-ico" aria-hidden="true">⧉</span>
            {copied ? 'Link copied' : 'Copy link'}
          </button>
          {shareTargets({ url, title, text }).map((t) => (
            <a
              key={t.key}
              role="menuitem"
              className="sh-item"
              href={t.href}
              target="_blank"
              rel="noopener noreferrer external"
              onClick={() => setOpen(false)}
            >
              <span className="sh-ico" aria-hidden="true">{t.glyph}</span>
              {t.label}
            </a>
          ))}
          <p className="sh-url">{url.replace(/^https?:\/\//, '')}</p>
        </div>
      )}
    </div>
  )
}

/**
 * Put text on the clipboard, one way or another.
 *
 * The modern API needs a secure context and a permission that Safari grants
 * only inside the click it was called from, so there is an older path behind
 * it. When both fail the caller shows the link for the person to copy by
 * hand, which always works.
 */
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true }
  } catch { /* fall through */ }
  try {
    const el = document.createElement('textarea')
    el.value = text
    el.setAttribute('readonly', '')
    el.style.cssText = 'position:fixed;top:-1000px;opacity:0'
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(el)
    return ok
  } catch { return false }
}

const ShareIcon = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
    <path
      d="M12 3v11M12 3 8.2 6.8M12 3l3.8 3.8M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    />
  </svg>
)

export default Share
