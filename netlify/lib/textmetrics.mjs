/**
 * How wide is this line, really?
 *
 * The share card is drawn as SVG and rasterised by resvg, which will happily
 * render a headline straight off the edge of the image. Nothing in that chain
 * measures text for us, and guessing an average character width gets Bebas
 * Neue — a condensed face where "I" and "W" differ by a factor of five —
 * comically wrong.
 *
 * So we read the advance widths out of the font file itself: `cmap` to turn a
 * character into a glyph id, `hmtx` to get that glyph's advance, `head` for
 * the units-per-em they are expressed in. Kerning and shaping are ignored,
 * which for Latin text at card sizes is a fraction of a pixel per pair and
 * never the difference between fitting and not.
 *
 * Fonts are small and parsed once per cold start.
 */
import { readFileSync } from 'node:fs'

const u16 = (b, o) => b.readUInt16BE(o)
const i16 = (b, o) => b.readInt16BE(o)
const u32 = (b, o) => b.readUInt32BE(o)

/** The sfnt table directory: tag → { offset, length }. */
function tables(buf) {
  const out = new Map()
  const n = u16(buf, 4)
  for (let i = 0; i < n; i++) {
    const p = 12 + i * 16
    out.set(buf.toString('ascii', p, p + 4), { offset: u32(buf, p + 8), length: u32(buf, p + 12) })
  }
  return out
}

/**
 * A character → glyph map from the best Unicode subtable on offer.
 *
 * Format 4 is what a latin-subset web font ships; format 12 turns up on fonts
 * with anything above the BMP. Anything else we do not read, and the caller
 * falls back to the notdef advance — a slightly wrong width, never a crash.
 */
function readCmap(buf, t) {
  if (!t) return new Map()
  const base = t.offset
  const n = u16(buf, base + 2)
  let best = null
  for (let i = 0; i < n; i++) {
    const p = base + 4 + i * 8
    const platform = u16(buf, p)
    const encoding = u16(buf, p + 2)
    const sub = base + u32(buf, p + 4)
    const format = u16(buf, sub)
    const unicode = (platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0
    if (!unicode) continue
    const rank = format === 12 ? 2 : format === 4 ? 1 : 0
    if (rank && (!best || rank > best.rank)) best = { sub, format, rank }
  }
  if (!best) return new Map()

  const map = new Map()
  if (best.format === 4) {
    const s = best.sub
    const segs = u16(buf, s + 6) / 2
    const ends = s + 14
    const starts = ends + segs * 2 + 2
    const deltas = starts + segs * 2
    const ranges = deltas + segs * 2
    for (let i = 0; i < segs; i++) {
      const end = u16(buf, ends + i * 2)
      const start = u16(buf, starts + i * 2)
      if (start === 0xffff) continue
      const delta = i16(buf, deltas + i * 2)
      const rangeOffset = u16(buf, ranges + i * 2)
      for (let c = start; c <= end && c !== 0x10000; c++) {
        let g
        if (rangeOffset === 0) g = (c + delta) & 0xffff
        else {
          const at = ranges + i * 2 + rangeOffset + (c - start) * 2
          if (at + 1 >= buf.length) continue
          g = u16(buf, at)
          if (g) g = (g + delta) & 0xffff
        }
        if (g) map.set(c, g)
      }
    }
  } else {
    const s = best.sub
    const groups = u32(buf, s + 12)
    for (let i = 0; i < groups; i++) {
      const p = s + 16 + i * 12
      const start = u32(buf, p)
      const end = u32(buf, p + 4)
      const glyph = u32(buf, p + 8)
      // A single group can span a whole plane; card text does not, so the
      // expansion is capped rather than allowed to eat the heap.
      for (let c = start; c <= end && c - start < 0x2000; c++) map.set(c, glyph + (c - start))
    }
  }
  return map
}

/** Advance widths in font units, one per glyph id. */
function readHmtx(buf, hhea, hmtx, numGlyphs) {
  const widths = new Array(numGlyphs).fill(0)
  if (!hhea || !hmtx) return widths
  const long = u16(buf, hhea.offset + 34)
  let last = 0
  for (let g = 0; g < numGlyphs; g++) {
    if (g < long) last = u16(buf, hmtx.offset + g * 4)
    widths[g] = last
  }
  return widths
}

const cache = new Map()

/**
 * A measurer for one font file.
 *
 * `width(text, size)` answers in the same pixels the SVG is drawn in, so a
 * line fits when `width(line, size) <= boxWidth` and not before.
 */
export function loadFont(path) {
  if (cache.has(path)) return cache.get(path)
  const buf = readFileSync(path)
  const t = tables(buf)
  const head = t.get('head')
  const maxp = t.get('maxp')
  const unitsPerEm = head ? u16(buf, head.offset + 18) || 1000 : 1000
  const numGlyphs = maxp ? u16(buf, maxp.offset + 4) : 0
  const cmap = readCmap(buf, t.get('cmap'))
  const widths = readHmtx(buf, t.get('hhea'), t.get('hmtx'), numGlyphs)
  const fallback = widths[cmap.get(0x20) ?? 0] || unitsPerEm * 0.5

  const advance = (code) => {
    const g = cmap.get(code)
    return g == null ? fallback : widths[g] ?? fallback
  }

  const font = {
    path,
    unitsPerEm,
    /**
     * Width of `text` set at `size` pixels, with optional letter-spacing.
     *
     * SVG adds letter-spacing after every glyph including the last, which is
     * how a tracked-out strapline that "fits" by a hair ends up overhanging.
     */
    width(text, size, spacing = 0) {
      const s = String(text)
      let units = 0
      let count = 0
      for (const ch of s) { units += advance(ch.codePointAt(0)); count++ }
      return (units * size) / unitsPerEm + count * spacing
    },
    /** Does this font have a glyph for this character at all? */
    has: (ch) => cmap.has(String(ch).codePointAt(0)),
  }
  cache.set(path, font)
  return font
}

/**
 * Break `text` into at most `maxLines` lines that each fit `width`.
 *
 * Greedy, which is what a headline wants: the first line as full as it goes.
 * A single word longer than the box is broken mid-word rather than allowed to
 * overhang, because a card with type running off the edge looks broken in a
 * way that a hyphen-less split does not.
 */
export function wrap(text, { font, size, width, maxLines = 3, spacing = 0, ellipsis = '…' }) {
  const w = (s) => font.width(s, size, spacing)
  const words = String(text).trim().split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''

  const push = () => { if (line) lines.push(line); line = '' }

  for (let i = 0; i < words.length; i++) {
    let word = words[i]
    const candidate = line ? `${line} ${word}` : word
    if (w(candidate) <= width) { line = candidate; continue }
    push()
    while (w(word) > width && word.length > 1) {
      let cut = word.length - 1
      while (cut > 1 && w(word.slice(0, cut)) > width) cut--
      lines.push(word.slice(0, cut))
      word = word.slice(cut)
      if (lines.length >= maxLines) break
    }
    line = word
    if (lines.length >= maxLines) break
  }
  push()

  if (lines.length <= maxLines) return lines

  const kept = lines.slice(0, maxLines)
  let tail = kept[maxLines - 1]
  while (tail && w(`${tail}${ellipsis}`) > width) tail = tail.slice(0, -1).trimEnd()
  kept[maxLines - 1] = `${tail}${ellipsis}`
  return kept
}

/**
 * The largest size from `sizes` at which `text` fits in `maxLines`.
 *
 * Card copy is not a fixed length — "Zendaya" and a 90-character headline go
 * in the same box — so the type shrinks a step at a time rather than the box
 * overflowing or the copy being cut at a character count that has nothing to
 * do with how wide the words actually are.
 */
export function fitLines(text, { font, sizes, width, maxLines = 3, spacing = 0 }) {
  const words = String(text).trim().split(/\s+/).filter(Boolean)
  for (const size of sizes) {
    const lines = wrap(text, { font, size, width, spacing, maxLines: maxLines + 1 })
    const fits = lines.length <= maxLines && words.length > 0
      && lines.every((l) => font.width(l, size, spacing) <= width)
    if (fits) return { size, lines }
  }
  const size = sizes[sizes.length - 1]
  return { size, lines: wrap(text, { font, size, width, spacing, maxLines }) }
}
