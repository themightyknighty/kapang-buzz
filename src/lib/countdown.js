/**
 * How long is left, in words.
 *
 * Its own module rather than living beside the component, because it is the
 * part with edge cases worth testing and node cannot import a .jsx file.
 *
 * The grain coarsens with distance: a seconds counter on a five-day wait is a
 * fidget rather than information, and "0 min" at the last moment reads as
 * broken, so the floor is one minute.
 */
export function remaining(ms) {
  const mins = Math.floor(ms / 60000)
  const days = Math.floor(mins / 1440)
  const hours = Math.floor((mins % 1440) / 60)
  const rest = mins % 60
  if (days > 0) return `${days} day${days === 1 ? '' : 's'}${hours ? ` ${hours} hr${hours === 1 ? '' : 's'}` : ''}`
  if (hours > 0) return `${hours} hr${hours === 1 ? '' : 's'}${rest ? ` ${rest} min` : ''}`
  return `${Math.max(1, rest)} min`
}
