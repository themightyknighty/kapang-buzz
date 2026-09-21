/**
 * Which cut of the Watch show suits the screen it is on.
 *
 * Decided by the SHAPE of the viewport, not by sniffing for "iPhone". A phone
 * held upright, an Android, an iPad in portrait and a narrow browser window are
 * all the same problem — a 16:9 stage letterboxed into a tall window wastes
 * most of the screen — and a device list would have to be maintained forever
 * to answer a question the window size already answers.
 *
 * It follows the device too: turn the phone sideways and the wide cut takes
 * over, which is what a viewer expects and what makes the picture fill the
 * screen either way.
 */

/** A window taller than it is wide wants the vertical show. */
export function formatFor({ width, height, forced } = {}) {
  if (forced === '16x9' || forced === '9x16') return forced
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '16x9'
  return height > width ? '9x16' : '16x9'
}

/**
 * /vertical always means the vertical show — it is how the social cut is
 * produced and recorded on a desktop, so it must not follow the window.
 * /watch is the channel, and takes the shape of whatever it is playing on.
 */
export const formatForRoute = (route, screen) => (route === 'vertical' ? '9x16' : formatFor(screen))
