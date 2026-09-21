/**
 * What to try when a published image will not load.
 *
 * The pipeline checks every URL before it publishes it, so this is the second
 * line: links that were alive when the story was written and are not any more,
 * and — for a few hours after a fix ships — links that were published before
 * the pipeline started checking.
 *
 * Only rewrites we can justify. NASA's library stores an item under a fixed
 * set of renditions and generates only some of them, so when `~large` is
 * missing the others are worth trying and cost nothing. Everything else gets
 * one attempt: guessing at another host's URL scheme would be inventing links.
 */

const NASA = /^(https:\/\/images-assets\.nasa\.gov\/image\/[^/]+\/[^/]+)~(orig|large|medium|small|thumb)\.jpg(\?.*)?$/i

/** The ordered list of URLs to try for this picture, starting with the one given. */
export function imageSources(url) {
  if (!url) return []
  const m = NASA.exec(url)
  if (!m) return [url]
  const [, base, size, query = ''] = m
  // Biggest usable first, then down. `orig` can be large but it is the one
  // rendition NASA always keeps, so it is the reliable last resort.
  const order = ['large', 'medium', 'orig', 'small', 'thumb']
  return [size, ...order.filter((s) => s !== size)].map((s) => `${base}~${s}.jpg${query}`)
}

/**
 * May this picture be shown?
 *
 * A story's photograph is only safe to publish if something established what
 * is in it. There are two ways that happens, and no third:
 *
 *  - It is a celebrity portrait (`kind: 'person'`), resolved from that
 *    person's own Wikidata entry. The identity comes from the lookup.
 *  - It is an illustration that the picture review has actually looked at and
 *    stamped.
 *
 * Anything else is a keyword search result nobody has seen, and a keyword
 * search result was how a photograph of a child came to sit under a headline
 * about a Maryland woman. Those show the typographic card instead — which is
 * a good-looking outcome, and an honest one.
 *
 * This lives in the app as well as the pipeline on purpose: it means pictures
 * published before the review existed stop being shown the moment this ships,
 * rather than at the next publishing run hours later.
 */
export function showable(img) {
  if (!img?.url) return false
  if (img.kind === 'person') return true
  return Boolean(img.review?.version)
}

/**
 * The same rule for footage, and there is no portrait exception.
 *
 * A wrong still reads as a stock illustration. A wrong clip fills the frame
 * for a minute and reads as footage OF THE STORY — which is how a report
 * about an elk jumping on a car came to be illustrated with ducks. Clips are
 * now put through the same picture desk the stills pass, and this is what
 * makes that stick for the ones already published: stories stay in the feed
 * for three days, so without it the clips on air today would keep playing
 * until Sunday. Anything unstamped simply does not play, and the story runs
 * on its pictures instead.
 */
export function playable(video) {
  return Boolean(video?.url && video.review?.version)
}
