/**
 * Run `fn` over `items`, with a bounded number in flight at once.
 *
 * Every job in here is a few hundred small calls — blob reads, Wikipedia
 * lookups, portrait resolutions — where doing them one at a time wastes the
 * whole run waiting, and doing them all at once trips a rate limit or
 * exhausts the function's sockets. A fixed width is the whole answer.
 *
 * Results come back in the order of `items`, not the order they finished, so
 * a caller can zip them against the input. Errors are not swallowed: a chart
 * built from a roster where a third of the reads quietly failed is worse than
 * no chart.
 */
export async function pool(items, size, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k) }
  }))
  return out
}

export default pool
