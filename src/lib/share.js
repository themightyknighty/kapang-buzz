/**
 * Where a link can be sent, and what it says when it gets there.
 *
 * Pure apart from two one-line browser checks, so the copy that goes out under
 * the app's name can be tested rather than eyeballed.
 */

/**
 * The places these stories actually get sent.
 *
 * Deliberately short. A row of fourteen network buttons is a decision nobody
 * wants to make, and most of them are for networks this audience does not
 * use. Copy-link covers everything not on the list, and on a phone the
 * operating system's own sheet covers all of it.
 */
export const TARGETS = [
  {
    key: 'whatsapp',
    label: 'WhatsApp',
    glyph: '✆',
    // WhatsApp takes one text field, so the title and the link travel together.
    href: ({ url, title }) => `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`,
  },
  {
    key: 'x',
    label: 'X',
    glyph: '𝕏',
    href: ({ url, title }) =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`,
  },
  {
    key: 'facebook',
    label: 'Facebook',
    glyph: 'f',
    // Facebook reads the page's own tags and ignores anything passed here,
    // which is exactly why the page function writes them.
    href: ({ url }) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  },
  {
    key: 'email',
    label: 'Email',
    glyph: '✉',
    href: ({ url, title, text }) =>
      `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${text ? `${text}\n\n` : ''}${url}`)}`,
  },
]

/** The targets, with their links filled in. */
export function shareTargets({ url, title, text = '' }) {
  return TARGETS.map((t) => ({ key: t.key, label: t.label, glyph: t.glyph, href: t.href({ url, title, text }) }))
}

/**
 * A path turned into the full address somebody can paste anywhere.
 *
 * Relative links are fine inside the app and useless in a message.
 */
export function absolute(path, origin = typeof window === 'undefined' ? '' : window.location.origin) {
  if (/^https?:\/\//i.test(path)) return path
  return `${String(origin).replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

/**
 * Does this browser have the operating system's share sheet?
 *
 * Desktop Safari has `navigator.share` too and it works, but it opens a sheet
 * most Mac users have never seen, so it is only preferred where a touch
 * screen makes it the obvious thing — and the menu is there for everyone else.
 */
export function canNativeShare(nav = typeof navigator === 'undefined' ? null : navigator) {
  if (!nav?.share) return false
  if (typeof window !== 'undefined' && window.matchMedia) {
    try { return window.matchMedia('(pointer: coarse)').matches } catch { /* old browser */ }
  }
  return true
}

/** What the share sheet should say about a story. */
export const storyShare = (story) => ({
  title: story.headline,
  text: story.caption || '',
  path: `/story/${encodeURIComponent(story.id)}`,
})

/** ...and about a celebrity, where the number is the reason to look. */
export const celebrityShare = (row, move) => {
  const score = Number.isFinite(row.gossipScore) ? row.gossipScore.toFixed(1) : null
  const moved = move && Number.isFinite(move.value) && move.value !== 0
    ? `${move.value > 0 ? 'up' : 'down'} ${Math.abs(move.value).toFixed(1)} ${move.label}`
    : null
  return {
    title: `${row.displayName} on the Gossip Genie Celebrity Market`,
    text: [score && `Gossip Score ${score}`, moved].filter(Boolean).join(', '),
    path: `/market/${encodeURIComponent(row.slug)}`,
  }
}

/** ...and about the board as a whole. */
export const marketShare = (movers) => {
  const top = movers?.risers?.[0]
  return {
    title: top
      ? `${top.name} is the biggest riser on the Gossip Genie Celebrity Market`
      : "Who's rising on the Gossip Genie Celebrity Market",
    text: top ? `${top.name} ${top.moveText}${top.reason?.headline ? ` — ${top.reason.headline}` : ''}` : '',
    path: '/market',
  }
}
