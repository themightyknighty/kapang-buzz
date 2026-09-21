/**
 * How to fit a photograph into a frame that is the wrong shape for it.
 *
 * The vertical show is 1080×1920. Press photography is almost all landscape.
 * Filling a 9:16 frame with a 16:9 photograph keeps 32% of it — the middle
 * third — and throws away everything else, which is how a picture of three
 * people at a premiere reaches the viewer as a shoulder and a bit of wall.
 * That is not a styling quibble: the picture stops being a picture of anything.
 *
 * So the rule here is that the subject decides the crop, and where the subject
 * cannot survive a crop, there is no crop. Three outcomes:
 *
 *   cover  — the subject fits in the window, so fill the frame and move the
 *            window over the subject.
 *   fit    — it does not, so show the whole picture over a blurred wash of
 *            itself. Letterboxing is not a failure; cutting the subject in
 *            half is.
 *
 * Everything here is pure arithmetic on fractions, so it can be reasoned about
 * and tested without a browser. `subject` is a box in image fractions —
 * {x, y, w, h}, origin top-left — as the picture desk review reports it.
 */

/** How much of the source survives `object-fit: cover` in this frame. */
export function coverWindow(image, frame) {
  const ia = image?.width / image?.height
  const fa = frame?.width / frame?.height
  if (!Number.isFinite(ia) || !Number.isFinite(fa) || ia <= 0 || fa <= 0) return null
  // Wider than the frame: the full height shows and the sides are cut. Taller:
  // the full width shows and the top and bottom are cut.
  return { w: Math.min(1, fa / ia), h: Math.min(1, ia / fa) }
}

/**
 * Where to put the window along one axis so it holds the subject.
 *
 * Returns the object-position fraction (0 = flush left/top, 1 = flush
 * right/bottom), or null when the subject is simply wider than the window and
 * no position can hold it.
 */
function positionFor(start, size, windowSize) {
  if (!(windowSize > 0)) return null
  if (windowSize >= 1) return 0.5 // nothing is cut on this axis
  if (size > windowSize + 1e-6) return null // the subject cannot fit, at any offset
  const slack = 1 - windowSize
  // Centre the subject in the window, then keep the window inside the picture.
  const ideal = start + size / 2 - windowSize / 2
  return Math.min(1, Math.max(0, Math.min(slack, Math.max(0, ideal)) / slack))
}

/**
 * The fallback when nobody has told us where the subject is.
 *
 * Centred horizontally, because there is nothing better to go on. Held high
 * vertically, because photographs put their subject above the middle far more
 * often than below it — faces, horizons and headlines all sit in the upper
 * half, and dead centre reliably crops heads off.
 */
export const DEFAULT_FOCUS = { x: 0.5, y: 0.35 }

/**
 * How much of a picture may be thrown away before showing it whole is better.
 *
 * At 0.5 a 16:9 photograph in a 9:16 frame (32% kept) is letterboxed, while the
 * same photograph in the show's 900×560 story box (90% kept) is still cropped,
 * which is right: a trim is a crop, and a third is a different picture.
 */
export const MIN_KEPT = 0.5

/**
 * How to render one picture in one frame.
 *
 * @returns {{mode: 'cover'|'fit', position?: string, kept: number, reason: string}}
 */
export function framing(image, frame, { subject = null, minKept = MIN_KEPT, focus = DEFAULT_FOCUS } = {}) {
  const win = coverWindow(image, frame)
  // Without the picture's dimensions there is nothing to reason about, and
  // guessing is what produced the bad crops. Fill the frame from the default
  // focal point and let the picture be what it is.
  if (!win) return { mode: 'cover', position: pct(focus.x, focus.y), kept: 1, reason: 'no dimensions known' }

  const kept = win.w * win.h

  if (subject && isBox(subject)) {
    const px = positionFor(subject.x, subject.w, win.w)
    const py = positionFor(subject.y, subject.h, win.h)
    if (px != null && py != null) {
      // `anchored` tells the caller this position was earned rather than
      // guessed — which matters because a drifting pan would slide the window
      // straight back off the subject it was just placed on.
      return { mode: 'cover', position: pct(px, py), kept, anchored: true, reason: 'framed on the subject' }
    }
    // The subject is wider or taller than anything this frame can show, so any
    // crop cuts it. Show all of it instead.
    return { mode: 'fit', kept: 1, reason: 'the subject is wider than the frame can hold' }
  }

  // No subject box — the picture has not been through the desk, or the desk
  // could not place it. Fall back on how much would be lost.
  if (kept < minKept) {
    return { mode: 'fit', kept: 1, reason: `cropping would discard ${Math.round((1 - kept) * 100)}% of the picture` }
  }
  return { mode: 'cover', position: pct(focus.x, focus.y), kept, reason: 'trimmed to fit' }
}

const isBox = (b) =>
  Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.w) && Number.isFinite(b.h) &&
  b.w > 0 && b.h > 0 && b.x >= 0 && b.y >= 0 && b.x + b.w <= 1.0001 && b.y + b.h <= 1.0001

const pct = (x, y) => `${round(x * 100)}% ${round(y * 100)}%`
const round = (n) => Math.round(n * 10) / 10

/** The subject box a reviewed picture carries, if it has a usable one. */
export function subjectOf(img) {
  const s = img?.review?.subject
  return s && isBox(s) ? s : null
}
