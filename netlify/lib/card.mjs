/**
 * The picture that shows up when somebody shares us.
 *
 * A link posted to WhatsApp or X is judged in about a second, on one image.
 * So every shareable thing on the site gets a card drawn for it — the
 * headline, the name, the number that moved — rather than the same logo on
 * everything, which is what a site has when nobody has thought about it.
 *
 * Drawn as SVG and rasterised by resvg. SVG rather than a canvas because the
 * card is a layout, and rather than satori because the layouts here are fixed
 * and hand-placing them is fewer moving parts than a flexbox engine.
 *
 * Two rules the drawing code follows throughout:
 *
 *  - Every glyph is measured against the real font (see textmetrics.mjs), so
 *    type wraps and shrinks to the box instead of running off the edge.
 *  - Nothing depends on a symbol existing in the font. The up and down arrows
 *    are drawn paths: Bebas Neue and IBM Plex both lack U+25B2, and a share
 *    card whose headline number sits next to a tofu box is worse than no card.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadFont, wrap, fitLines } from './textmetrics.mjs'

export const WIDTH = 1200
export const HEIGHT = 630

/* ------------------------------------------------------------------ *
 * Brand
 * ------------------------------------------------------------------ */

const C = {
  abyss: '#050B14',
  deck: '#0C1724',
  deck2: '#122234',
  line: '#1E3247',
  ink: '#E9F1F8',
  inkDim: '#8CA3B8',
  inkFaint: '#5C748C',
  gold: '#FFC145',
  pink: '#FF5FA2',
  violet: '#A77BFF',
  up: '#3DDC97',
  down: '#FF6B6B',
}

const STRANDS = {
  celebrity: { label: 'Celebrity Gossip', color: '#FF5FA2' },
  health: { label: 'Health', color: '#3DDC97' },
  facts: { label: 'Fantastic Facts', color: '#FFC145' },
  bizarre: { label: 'Bizarre News', color: '#A77BFF' },
}

/* ------------------------------------------------------------------ *
 * Fonts
 * ------------------------------------------------------------------ */

/**
 * Where the TTFs are once Netlify has bundled us.
 *
 * `included_files` puts them under the project root with their paths kept, and
 * a function runs from that root — but the dev server, the audit scripts and
 * whatever Netlify's runtime layout is next year all differ, so it walks up
 * rather than assuming one path. `GENIE_FONT_DIR` settles it outright.
 */
function fontDir() {
  const candidates = [process.env.GENIE_FONT_DIR, '/var/task/netlify/fonts'].filter(Boolean)
  let at = process.cwd()
  for (let up = 0; up < 5; up++) {
    candidates.push(join(at, 'netlify/fonts'))
    const parent = join(at, '..')
    if (parent === at) break
    at = parent
  }
  for (const dir of candidates) {
    try { if (existsSync(join(dir, 'bebas-neue.ttf'))) return dir } catch { /* unreadable */ }
  }
  return null
}

/**
 * Rough advance widths, for when the font files cannot be found at all.
 *
 * A card drawn with estimated metrics and the host's own fonts is a bit off.
 * A card that throws is no card, and a link with no picture is the thing this
 * whole file exists to prevent — so the bad case degrades rather than fails.
 * The ratios are eyeballed per family: Bebas is condensed, Plex Mono is fixed.
 */
function estimator(ratio) {
  return {
    estimated: true,
    unitsPerEm: 1000,
    width: (text, size, spacing = 0) => String(text).length * (size * ratio + spacing),
    has: () => true,
  }
}

const FILES = {
  display: 'bebas-neue.ttf',
  body: 'plex-sans-400.ttf',
  bold: 'plex-sans-600.ttf',
  mono: 'plex-mono.ttf',
}

const FAMILY = {
  display: 'Bebas Neue',
  body: 'IBM Plex Sans',
  bold: 'IBM Plex Sans',
  mono: 'IBM Plex Mono',
}

/** How wide a character is, per family, when there is no font file to ask. */
const RATIO = { display: 0.40, body: 0.52, bold: 0.54, mono: 0.60 }

let fonts = null

/**
 * The measurers.
 *
 * Always returns something. `estimated` says whether it is reading real font
 * files or guessing, and the rasteriser uses it to decide whether to fall back
 * to the host's own fonts.
 */
export function loadFonts() {
  if (fonts) return fonts
  const dir = fontDir()
  if (!dir) {
    console.warn('card: brand fonts not found; drawing with estimated metrics')
    fonts = { dir: null, files: [], estimated: true }
    for (const key of Object.keys(FILES)) fonts[key] = estimator(RATIO[key])
    return fonts
  }
  const out = { dir, files: [], estimated: false }
  for (const [key, file] of Object.entries(FILES)) {
    const path = join(dir, file)
    try {
      out[key] = loadFont(path)
      out.files.push(path)
    } catch {
      out[key] = estimator(RATIO[key])
      out.estimated = true
    }
  }
  fonts = out
  return fonts
}

/* ------------------------------------------------------------------ *
 * SVG helpers
 * ------------------------------------------------------------------ */

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')

const attrs = (o) => Object.entries(o)
  .filter(([, v]) => v != null && v !== false)
  .map(([k, v]) => `${k}="${esc(v)}"`).join(' ')

/**
 * One line of type.
 *
 * `weight` is not set: each weight is its own file with its own family alias,
 * so resvg picks the face by name and never synthesises a bold.
 */
const text = (s, { x, y, font = 'body', size, fill = C.ink, spacing = 0, anchor = 'start', opacity }) =>
  `<text ${attrs({
    x, y, fill, 'font-family': FAMILY[font], 'font-size': size,
    'letter-spacing': spacing || null, 'text-anchor': anchor === 'start' ? null : anchor,
    opacity: opacity ?? null,
  })}>${esc(s)}</text>`

const rect = (o) => `<rect ${attrs(o)} />`
const path = (d, o = {}) => `<path ${attrs({ d, ...o })} />`

/** A triangle, drawn rather than typed. `dir` is 'up' or 'down'. */
export const triangle = (x, y, w, h, dir, fill) => path(
  dir === 'down' ? `M${x} ${y} L${x + w} ${y} L${x + w / 2} ${y + h} Z`
    : `M${x + w / 2} ${y} L${x + w} ${y + h} L${x} ${y + h} Z`,
  { fill },
)

/** A flat line, for a mover that did not move. */
export const dash = (x, y, w, h, fill) => rect({ x, y: y + h / 2 - 2, width: w, height: 4, rx: 2, fill })

/* ------------------------------------------------------------------ *
 * Data marks
 *
 * A share card used to be type on a colour field: a name, a number and a
 * headline. That is a poster, not evidence — somebody looking at it on a
 * timeline had no way to see whether the rise behind it was a week or an
 * afternoon. These three marks put the actual measurement on the card.
 *
 * The data hue is the chart's own #5EC8E8, the same one the score bars use
 * on the site, because it is the same measure. Against the de-emphasis grey
 * on this ground it clears CVD separation and the normal-vision floor with
 * room to spare, and every mark is labelled besides, so nothing a reader
 * needs rests on colour alone.
 * ------------------------------------------------------------------ */

const DATA = '#5EC8E8'

/**
 * The week, as a shape.
 *
 * Scaled to its own range, not to zero. Zero-anchoring is the rule for the
 * score bars, where length is the encoding; a line encodes position, and
 * anchoring one at zero turned a leader whose week ran 93 to 99 into a flat
 * rule pinned to the top of the box — indistinguishable from a leader who
 * never moved at all. The absolute level is in the caption beside it.
 */
export function sparkline(series = [], { x = 0, y = 0, w = 300, h = 90, stroke = DATA, peak = null } = {}) {
  const pts = series.filter((p) => p && Number.isFinite(p.level))
  if (pts.length < 2) return ''
  const levels = pts.map((p) => p.level)
  const lo = Math.min(...levels)
  const hi = Math.max(...levels)
  const pad = Math.max(1, (hi - lo) * 0.18)
  const from = Math.max(0, lo - pad)
  const to = hi + pad
  const px = (i) => x + (series.length < 2 ? 0 : (i / (series.length - 1)) * w)
  const py = (v) => y + h - ((v - from) / Math.max(0.001, to - from)) * h

  const runs = []
  let run = []
  series.forEach((p, i) => {
    if (p && Number.isFinite(p.level)) run.push(`${px(i)},${py(p.level)}`)
    else if (run.length) { runs.push(run); run = [] }
  })
  if (run.length) runs.push(run)

  const parts = [rect({ x, y: y + h, width: w, height: 2, rx: 1, fill: 'rgba(140,163,184,.3)' })]
  for (const r of runs) {
    // A day measured between two gaps is a run of one, and a polyline of one
    // point draws nothing at all — so the card silently lost the very days a
    // patchy week most needs to show. It gets a dot.
    if (r.length === 1) {
      const [cx, cy] = r[0].split(',')
      parts.push(`<circle ${attrs({ cx, cy, r: 5, fill: stroke })} />`)
      continue
    }
    parts.push(`<polyline ${attrs({
      points: r.join(' '), fill: 'none', stroke, 'stroke-width': 4,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    })} />`)
  }
  const at = peak ? series.findIndex((p) => p?.day === peak.day) : -1
  if (at >= 0 && Number.isFinite(peak.level)) {
    parts.push(`<circle ${attrs({ cx: px(at), cy: py(peak.level), r: 8, fill: stroke, stroke: C.abyss, 'stroke-width': 3 })} />`)
  }
  return parts.join('')
}

/**
 * What moved, as bars.
 *
 * Emphasis rather than categories: the signals that moved carry the data
 * hue and the ones that did not are grey, because the reader's question is
 * which of them moved. Each bar is labelled with its own figure.
 */
export function driverBars(drivers = [], { f, x = 0, y = 0, w = 300, rowH = 44 } = {}) {
  const shown = drivers.filter((d) => d && (d.moved || Number.isFinite(d.now))).slice(0, 3)
  if (!shown.length) return ''
  const widest = Math.max(...shown.map((d) => Math.abs(d.change || 0)), 0.5)
  const labelW = 132
  const valueW = 150
  const trackW = Math.max(60, w - labelW - valueW)
  const parts = []
  shown.forEach((d, i) => {
    const ry = y + i * rowH
    const fill = d.moved ? DATA : C.inkFaint
    parts.push(text(String(d.label).toUpperCase(), { x, y: ry + 15, font: 'mono', size: 17, fill: C.inkFaint, spacing: 1.4 }))
    parts.push(rect({ x: x + labelW, y: ry + 3, width: trackW, height: 14, rx: 7, fill: 'rgba(30,50,71,.75)' }))
    const fw = Math.max(6, (Math.abs(d.change || 0) / widest) * trackW)
    parts.push(rect({ x: x + labelW, y: ry + 3, width: fw, height: 14, rx: 7, fill }))
    const value = d.moved ? sizeOfChange(d.change) : (Number.isFinite(d.before) ? 'flat' : 'no history')
    parts.push(text(value, {
      x: x + labelW + trackW + 16, y: ry + 16, font: 'mono', size: 20,
      fill: d.moved ? C.ink : C.inkFaint,
    }))
  })
  return parts.join('')
}

/** A change, said the same way the site says it. */
export function sizeOfChange(change) {
  if (!Number.isFinite(change)) return ''
  const ratio = 1 + change
  if (change < 0) return `down ${Math.round(Math.abs(change) * 100)}%`
  // A LATIN SMALL LETTER X rather than the multiplication sign the site
  // uses: this string is rasterised by resvg against whatever face loaded,
  // and a card that renders a tofu box where the number should be is worse
  // than one that is a character off the house style.
  if (ratio >= 2) return `${Math.round(ratio * 10) / 10}x last week`
  return `up ${Math.round(change * 100)}%`
}

/**
 * Where they were and where they are — a dumbbell, the form for a
 * before-and-after on one item. One hue, two weights: last week hollow,
 * this week solid, so the direction reads without the arrow.
 */
export function rankTrack(move, { f, x = 0, y = 0, w = 300 } = {}) {
  if (!move || !Number.isFinite(move.from) || !Number.isFinite(move.to)) return ''
  const worst = Math.max(move.from, move.to, 10)
  const at = (r) => x + w - ((r - 1) / Math.max(1, worst - 1)) * w
  const from = at(move.from)
  const to = at(move.to)
  const up = move.to < move.from
  const colour = up ? C.up : C.down
  return [
    rect({ x: Math.min(from, to), y: y + 7, width: Math.abs(to - from), height: 6, rx: 3, fill: colour }),
    `<circle ${attrs({ cx: from, cy: y + 10, r: 9, fill: C.abyss, stroke: C.inkFaint, 'stroke-width': 3 })} />`,
    `<circle ${attrs({ cx: to, cy: y + 10, r: 11, fill: colour })} />`,
    text(`${move.from}`, { x: from, y: y + 44, font: 'mono', size: 19, fill: C.inkFaint, anchor: 'middle' }),
    text(`${move.to}`, { x: to, y: y + 44, font: 'mono', size: 19, fill: colour, anchor: 'middle' }),
  ].join('')
}

/* ------------------------------------------------------------------ *
 * Furniture
 * ------------------------------------------------------------------ */

const PAD = 64
const COL = 640 // the text column, left of the picture

/** The ground every card is drawn on. Goes down first, under the picture. */
const ground = () =>
  rect({ x: 0, y: 0, width: WIDTH, height: HEIGHT, fill: C.abyss })
  + rect({ x: 0, y: 0, width: WIDTH, height: HEIGHT, fill: 'url(#glow)' })

/**
 * Gradient strip, wordmark, footer — the parts every card shares.
 *
 * Painted LAST, over the picture. A photograph bled off the right edge would
 * otherwise cover the end of the footer, and a strapline that stops mid-word
 * is the kind of detail that makes a card look like nobody checked.
 */
function chrome({ f, eyebrow, eyebrowColor = C.gold, footer, footerColor = C.inkFaint, footerWidth = COL - 40 }) {
  const parts = [rect({ x: 0, y: 0, width: WIDTH, height: 10, fill: 'url(#genie)' })]

  // Wordmark. Bebas has no small caps, so the tracking does the work.
  parts.push(text('GOSSIP GENIE', { x: PAD, y: 86, font: 'display', size: 40, fill: C.ink, spacing: 3 }))
  const markWidth = f.display.width('GOSSIP GENIE', 40) + 3 * 12
  parts.push(rect({ x: PAD + markWidth + 18, y: 64, width: 2, height: 26, fill: C.line }))
  parts.push(text(eyebrow, {
    x: PAD + markWidth + 34, y: 84, font: 'mono', size: 19, fill: eyebrowColor, spacing: 1.6,
  }))

  if (footer) {
    parts.push(rect({ x: PAD, y: HEIGHT - 92, width: footerWidth, height: 1, fill: C.line }))
    const [line] = wrap(footer, { font: f.mono, size: 20, spacing: 0.8, width: footerWidth, maxLines: 1 })
    parts.push(text(line, { x: PAD, y: HEIGHT - 52, font: 'mono', size: 20, fill: footerColor, spacing: 0.8 }))
  }
  return parts.join('')
}

/**
 * The picture panel on the right.
 *
 * Bled off the right edge and feathered into the background on the left, so a
 * portrait shot at any aspect ratio sits in the card rather than being framed
 * by it. The crop is anchored to the TOP of the photograph rather than its
 * middle: a head-and-shoulders shot centred in a tall box loses the chin, and
 * every portrait the market resolves is head-and-shoulders.
 */
function picture({ dataUri, initials, tint, f }) {
  const x = 700
  const w = WIDTH - x
  const parts = []

  if (dataUri) {
    parts.push(`<clipPath id="pic"><rect x="${x}" y="10" width="${w}" height="${HEIGHT - 10}"/></clipPath>`)
    parts.push(`<g clip-path="url(#pic)">${`<image ${attrs({
      href: dataUri, x, y: 10, width: w, height: HEIGHT - 10,
      preserveAspectRatio: `xMidYMin slice`,
    })} />`}</g>`)
    // The fade is what stops the join being a hard edge; the bottom wash keeps
    // a bright photo from fighting the footer.
    parts.push(rect({ x, y: 10, width: 260, height: HEIGHT - 10, fill: 'url(#fadeL)' }))
    parts.push(rect({ x, y: HEIGHT - 220, width: w, height: 210, fill: 'url(#fadeB)' }))
    return { svg: parts.join('') }
  }

  // No photograph: a tinted panel with initials. Better than a grey box, and
  // it is the same treatment the site uses when a portrait is unavailable.
  parts.push(rect({ x, y: 10, width: w, height: HEIGHT - 10, fill: C.deck }))
  parts.push(rect({ x, y: 10, width: w, height: HEIGHT - 10, fill: tint || 'url(#genie-soft)', opacity: 0.22 }))
  parts.push(rect({ x, y: 10, width: 220, height: HEIGHT - 10, fill: 'url(#fadeL)' }))
  if (initials) {
    const size = 210
    parts.push(text(initials, {
      x: x + w / 2, y: HEIGHT / 2 + size * 0.34, font: 'display', size,
      fill: C.ink, opacity: 0.18, anchor: 'middle', spacing: 4,
    }))
  }
  return { svg: parts.join('') }
}

const defs = () => `<defs>
  <linearGradient id="genie" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="${C.gold}"/><stop offset="52%" stop-color="${C.pink}"/><stop offset="100%" stop-color="${C.violet}"/>
  </linearGradient>
  <linearGradient id="genie-soft" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="${C.pink}"/><stop offset="100%" stop-color="${C.violet}"/>
  </linearGradient>
  <radialGradient id="glow" cx="0.82" cy="0.12" r="0.9">
    <stop offset="0%" stop-color="${C.violet}" stop-opacity="0.20"/>
    <stop offset="100%" stop-color="${C.abyss}" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="fadeL" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="${C.abyss}" stop-opacity="1"/>
    <stop offset="100%" stop-color="${C.abyss}" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="fadeB" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${C.abyss}" stop-opacity="0"/>
    <stop offset="100%" stop-color="${C.abyss}" stop-opacity="0.85"/>
  </linearGradient>
</defs>`

/** A rounded chip with a label in it — the strand badge, the delta pill. */
function chip(label, { x, y, f, color, size = 20, fill = null }) {
  const w = f.mono.width(label, size) + (label.length - 1) * 1.6 + 34
  const h = size + 22
  return {
    width: w,
    svg: rect({ x, y, width: w, height: h, rx: h / 2, fill: fill || 'none', stroke: color, 'stroke-width': 2, opacity: fill ? 1 : 0.9 })
      + text(label, { x: x + 17, y: y + h / 2 + size * 0.36, font: 'mono', size, fill: color, spacing: 1.6 }),
  }
}

/* ------------------------------------------------------------------ *
 * The cards
 * ------------------------------------------------------------------ */

const initialsOf = (name) => String(name || '').trim().split(/\s+/).slice(0, 2)
  .map((w) => w[0]).join('').toUpperCase() || '?'

const signed = (n, dp = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(dp)}`

/**
 * A story: strand, headline, caption, how widely it was reported.
 *
 * @param {{headline:string, caption?:string, strand?:string, outlets?:number, publishedAt?:string}} story
 * @param {{image?:string|null}} opts  image is a data: URI, already fetched
 */
export function storyCard(story, { image = null } = {}) {
  const f = loadFonts()
  const strand = STRANDS[story.strand] || STRANDS.celebrity

  const pic = picture({ dataUri: image, initials: null, tint: strand.color, f })
  const parts = [defs(), ground(), pic.svg]

  // The chip is pinned, not flowed. A three-line headline and a two-line deck
  // is the worst case, and letting the chip follow the copy is how it ends up
  // sitting on top of the last line of the deck.
  const CHIP_TOP = 478
  let y = 190

  const head = fitLines(story.headline, {
    font: f.bold, sizes: [62, 56, 50, 45, 40, 36], width: COL, maxLines: 3,
  })
  for (const line of head.lines) {
    parts.push(text(line, { x: PAD, y, font: 'bold', size: head.size, fill: C.ink }))
    y += Math.round(head.size * 1.16)
  }

  // Whatever room the headline left, the deck gets — down to none at all.
  const room = Math.floor((CHIP_TOP - 22 - (y + 14)) / 36)
  if (story.caption && room > 0) {
    y += 14
    const deck = wrap(story.caption, { font: f.body, size: 26, width: COL, maxLines: Math.min(room, 2) })
    for (const line of deck) {
      parts.push(text(line, { x: PAD, y, font: 'body', size: 26, fill: C.inkDim }))
      y += 36
    }
  }

  const outlets = Number(story.outlets) || 0
  if (outlets > 0) {
    const c = chip(`REPORTED BY ${outlets} OUTLET${outlets === 1 ? '' : 'S'}`, {
      x: PAD, y: CHIP_TOP, f, color: strand.color, size: 18,
    })
    parts.push(c.svg)
  }

  parts.push(chrome({
    f, eyebrow: strand.label.toUpperCase(), eyebrowColor: strand.color,
    footer: '30 family-friendly stories a day, told kindly',
  }))
  return frame(parts.join(''))
}

/**
 * A celebrity: name, gossip score, today's move, rank.
 *
 * The move is the reason anybody shares this, so it is the biggest thing on
 * the card after the name, and its colour and its arrow both say the same
 * thing — a card gets read at thumbnail size where a minus sign disappears.
 *
 * @param {{displayName:string, gossipScore?:number, rank?:number, change?:number|null,
 *          changeLabel?:string, tracked?:number, reason?:string}} row
 */
export function celebrityCard(row, { image = null } = {}) {
  const f = loadFonts()

  const pic = picture({ dataUri: image, initials: initialsOf(row.displayName), f })
  const parts = [defs(), ground(), pic.svg]

  /*
   * The figures sit on a fixed baseline and the name hangs off the bottom of
   * its own block upwards. Laying it out the other way — name first, then
   * whatever room is left — leaves a short name floating in a field of empty
   * card, which is exactly what a one-word celebrity name usually is.
   */
  const LABELS = 400
  const FIGURES = 462

  // One line if it will take one, and a smaller ceiling if it will not: two
  // lines of 150pt Bebas reach up into the wordmark. `fitLines` will cheerfully
  // return a truncated single line as a fit, so the test is whether the whole
  // name came back — not whether something fitted.
  const whole = row.displayName.trim().split(/\s+/).join(' ')
  const one = fitLines(row.displayName, {
    font: f.display, sizes: [150, 130, 112], width: COL, maxLines: 1, spacing: 1,
  })
  const name = one.lines.join(' ') === whole
    ? one
    : fitLines(row.displayName, {
      font: f.display, sizes: [112, 96, 84, 72, 62], width: COL, maxLines: 2, spacing: 1,
    })

  const step = Math.round(name.size * 0.92)
  let y = 316 - step * (name.lines.length - 1)
  for (const line of name.lines) {
    parts.push(text(line, { x: PAD, y, font: 'display', size: name.size, fill: C.ink, spacing: 1 }))
    y += step
  }

  // Gossip score: label above, figure below, so the number is the thing you
  // see and the word only explains it once you are already reading.
  const score = Number.isFinite(row.gossipScore) ? row.gossipScore.toFixed(1) : '—'
  parts.push(text('GOSSIP SCORE', { x: PAD, y: LABELS, font: 'mono', size: 19, fill: C.inkFaint, spacing: 2 }))
  parts.push(text(score, { x: PAD, y: FIGURES, font: 'bold', size: 62, fill: C.ink }))

  // ...and the move, beside it.
  const change = Number.isFinite(row.change) ? row.change : null
  const moveX = PAD + Math.max(f.bold.width(score, 62) + 72, 190)
  parts.push(text((row.changeLabel || 'TODAY').toUpperCase(), {
    x: moveX, y: LABELS, font: 'mono', size: 19, fill: C.inkFaint, spacing: 2,
  }))
  if (change == null) {
    parts.push(text('—', { x: moveX, y: FIGURES, font: 'bold', size: 62, fill: C.inkFaint }))
  } else {
    const colour = change > 0 ? C.up : change < 0 ? C.down : C.inkDim
    const label = signed(change, 1)
    if (change === 0) parts.push(dash(moveX, FIGURES - 40, 34, 40, colour))
    else parts.push(triangle(moveX, FIGURES - 42, 34, 40, change > 0 ? 'up' : 'down', colour))
    parts.push(text(label, { x: moveX + 50, y: FIGURES, font: 'bold', size: 62, fill: colour }))
  }

  if (Number.isFinite(row.rank)) {
    parts.push(text(`#${row.rank}${row.tracked ? ` of ${row.tracked} tracked` : ''}`, {
      x: PAD, y: FIGURES + 46, font: 'mono', size: 22, fill: C.inkDim, spacing: 1,
    }))
  }

  parts.push(chrome({
    f, eyebrow: 'CELEBRITY MARKET', eyebrowColor: C.gold,
    // The card's whole argument is a number nobody has seen before, so the
    // footer spends its one line saying what the number means.
    footer: 'gossip score: how loudly the world is talking',
  }))
  return frame(parts.join(''))
}

/**
 * One name on the chart, and why they are there.
 *
 * The card this replaced was a name, a score and a headline — a poster. It
 * could not show whether a rise was a week or an afternoon, which is the one
 * thing anybody seeing it on a timeline would want to know, and the headline
 * on it was looked up by name after the fact rather than derived from the
 * move. This one is the measurement: where they came from, the shape of the
 * week, and which signals actually moved, all drawn from the same record the
 * rank was computed from.
 *
 * @param {object} entry   the chart entry — name, rank, score, portrait
 * @param {object} record  its movement record
 */
export function movementCard(entry, { image = null, record = null, name = 'The Genie 100', line = null } = {}) {
  const f = loadFonts()
  if (!entry || !record) return siteCard()

  const pic = picture({ dataUri: image, initials: initialsOf(entry.displayName), f })
  const parts = [defs(), ground(), pic.svg]

  /* ---- who, and where ---- */
  const rank = Number.isFinite(entry.rank) ? `NO.${entry.rank}` : ''
  if (rank) parts.push(text(rank, { x: PAD, y: 142, font: 'mono', size: 20, fill: C.gold, spacing: 3 }))

  const whole = String(entry.displayName || '').trim().split(/\s+/).join(' ')
  const oneLine = fitLines(entry.displayName, { font: f.display, sizes: [104, 92, 80], width: COL, maxLines: 1, spacing: 1 })
  const nameFit = oneLine.lines.join(' ') === whole
    ? oneLine
    : fitLines(entry.displayName, { font: f.display, sizes: [72, 62, 54], width: COL, maxLines: 2, spacing: 1 })
  const step = Math.round(nameFit.size * 0.92)
  let y = 232 - step * (nameFit.lines.length - 1)
  for (const l of nameFit.lines) {
    parts.push(text(l, { x: PAD, y, font: 'display', size: nameFit.size, fill: C.ink, spacing: 1 }))
    y += step
  }

  /*
   * The sentence, in the site's own words.
   *
   * Three lines at 23, not two at 25: the move and the reason together run
   * past two lines for most names, and a card that ends "across 22
   * newsroom…" has thrown away the corroborating half of its own argument.
   */
  if (line) {
    for (const [i, l] of wrap(line, { font: f.body, size: 23, width: COL, maxLines: 3 }).entries()) {
      parts.push(text(l, { x: PAD, y: 272 + i * 29, font: 'body', size: 23, fill: C.inkDim }))
    }
  }

  /* ---- the week ---- */
  const series = record.week?.series || []
  if (series.length) {
    parts.push(text('THIS WEEK', { x: PAD, y: 372, font: 'mono', size: 17, fill: C.inkFaint, spacing: 2 }))
    parts.push(sparkline(series, { x: PAD, y: 386, w: 300, h: 86, peak: record.week.peak }))
    const measured = record.week.days
    const span = record.week.span || 7
    const caption = Number.isFinite(measured) && measured < span
      ? `${measured} of ${span} days measured`
      : `${span} days measured`
    parts.push(text(caption, { x: PAD, y: 502, font: 'mono', size: 17, fill: C.inkFaint }))
  }

  /* ---- where they came from ---- */
  if (Number.isFinite(record.move?.from)) {
    parts.push(text('LAST WEEK / NOW', { x: PAD + 348, y: 372, font: 'mono', size: 17, fill: C.inkFaint, spacing: 2 }))
    parts.push(rankTrack(record.move, { f, x: PAD + 348, y: 386, w: 250 }))
  }

  /* ---- what moved ---- */
  const drivers = (record.drivers || []).filter((d) => d.moved || Number.isFinite(d.now))
  if (drivers.length) {
    /*
     * The right column's budget, top to bottom: the label at 372, the rank
     * track at 386, its own end labels on a baseline at 430, then three
     * driver rows. At 32 apiece the last value lands on 526 and the footer
     * rule is at 538 — the track labels and the first driver row were
     * overlapping at anything tighter.
     */
    parts.push(driverBars(drivers, { f, x: PAD + 348, y: 446, w: 470, rowH: 32 }))
  }

  /*
   * A thin rise says so on its own card. Somebody sharing it is entitled to
   * the same caveat the site gives them, and a card that quietly drops it is
   * the version of us that ends up on a timeline.
   */
  const footer = record.thin
    ? 'thin evidence so far — one outlet, no wider pickup'
    : `${name.toLowerCase()} · ${record.evidence?.outlets || 0} outlets${record.evidence?.countries >= 2 ? ` in ${record.evidence.countries} countries` : ''}`

  parts.push(chrome({
    f, eyebrow: name.toUpperCase(), eyebrowColor: C.gold, footer, footerWidth: 820,
    // A caveat in the same grey as everything else is a caveat nobody reads.
    footerColor: record.thin ? C.gold : C.inkFaint,
  }))
  return frame(parts.join(''))
}

/**
 * The board itself: who is rising, right now.
 *
 * @param {{movers:Array<{displayName:string, change:number|null}>, basis?:string, tracked?:number}} board
 */
export function marketCard(board) {
  const f = loadFonts()

  // No photograph here, and no picture panel either: this card is a list, and
  // a list wants the full width. Four faces at thumbnail size is mush anyway.
  const parts = [defs(), ground()]
  parts.push(text("WHO'S MOVING", { x: PAD, y: 190, font: 'display', size: 104, fill: C.ink, spacing: 2 }))
  parts.push(text(board.basis || 'change in gossip score today', {
    x: PAD, y: 228, font: 'mono', size: 20, fill: C.inkFaint, spacing: 1.4,
  }))

  const rows = (board.movers || []).slice(0, 4)
  let y = 288
  for (const m of rows) {
    const change = Number.isFinite(m.change) ? m.change : null
    const colour = change == null ? C.inkFaint : change > 0 ? C.up : change < 0 ? C.down : C.inkDim
    if (change == null || change === 0) parts.push(dash(PAD, y - 24, 26, 30, colour))
    else parts.push(triangle(PAD, y - 24, 26, 30, change > 0 ? 'up' : 'down', colour))

    const nameW = WIDTH - PAD - 180 - (PAD + 46)
    const [line] = wrap(m.displayName, { font: f.bold, size: 38, width: nameW, maxLines: 1 })
    parts.push(text(line, { x: PAD + 46, y, font: 'bold', size: 38, fill: C.ink }))
    parts.push(text(change == null ? '—' : signed(change, 1), {
      x: WIDTH - PAD, y, font: 'bold', size: 38, fill: colour, anchor: 'end',
    }))
    y += 66
  }

  parts.push(chrome({
    f, eyebrow: 'CELEBRITY MARKET', eyebrowColor: C.gold,
    footer: board.tracked ? `tracking ${board.tracked} names · updated every 15 minutes` : 'updated every 15 minutes',
    footerWidth: WIDTH - PAD * 2,
  }))
  return frame(parts.join(''))
}

/**
 * A chart edition: the number one, and the four names under them.
 *
 * The number one is the whole point of a chart, so it gets the size — and
 * their picture, because a face is what stops a thumbnail being a table.
 * Everything else is four rows of evidence that this is a ranking of a
 * hundred people rather than one person's press release.
 *
 * @param {{id:string,label:string,entries:Array,summary:object}} edition
 */
export function chartCard(edition, { image = null, name = 'The Genie 100', headline = null } = {}) {
  const f = loadFonts()
  const one = edition?.entries?.[0]
  if (!one) return siteCard()

  const pic = picture({ dataUri: image, initials: initialsOf(one.displayName), f })
  const parts = [defs(), ground(), pic.svg]

  parts.push(text('NO.1', { x: PAD, y: 142, font: 'mono', size: 20, fill: C.gold, spacing: 3 }))

  /*
   * One line if the whole name will take one, and a much smaller ceiling if
   * it will not. "Zendaya" and "Jeremy Allen White" are both plausible number
   * ones, and two lines of 128pt Bebas reach up through the eyebrow and into
   * the wordmark. `fitLines` returns a truncated single line as a fit, so the
   * test is whether the whole name came back.
   */
  const whole = one.displayName.trim().split(/\s+/).join(' ')
  const oneLine = fitLines(one.displayName, {
    font: f.display, sizes: [128, 110, 96], width: COL, maxLines: 1, spacing: 1,
  })
  const nameFit = oneLine.lines.join(' ') === whole
    ? oneLine
    : fitLines(one.displayName, {
      font: f.display, sizes: [78, 68, 60, 52], width: COL, maxLines: 2, spacing: 1,
    })

  const step = Math.round(nameFit.size * 0.92)
  let y = 292 - step * (nameFit.lines.length - 1)
  for (const line of nameFit.lines) {
    parts.push(text(line, { x: PAD, y, font: 'display', size: nameFit.size, fill: C.ink, spacing: 1 }))
    y += step
  }

  /*
   * The leader's week, as a shape.
   *
   * The card used to prove it was a chart by listing four more names, which
   * proves it is a list. This proves it is a measurement: seven days, zero
   * anchored, the peak marked.
   */
  const series = one.movement?.week?.series || []
  if (series.length >= 2) {
    parts.push(sparkline(series, { x: PAD, y: 330, w: 300, h: 64, peak: one.movement.week.peak }))
    const moved = (one.movement.drivers || []).filter((d) => d.moved).sort((a, b) => b.share - a.share)[0]
    if (moved) {
      parts.push(text(`${String(moved.label).toUpperCase()} ${sizeOfChange(moved.change).toUpperCase()}`, {
        x: PAD, y: 424, font: 'mono', size: 18, fill: C.inkDim, spacing: 1.4,
      }))
    }
  }

  /*
   * What the week was about, where the also-rans used to go.
   *
   * The list was this card's proof that it is a chart, and the sparkline
   * above does that job better — the comment beside it says as much. A
   * headline says the one thing no other element on the card can: what
   * actually happened. So when the edition has decided on one, it takes the
   * block, and the list stays for the editions published before it did.
   *
   * The same block was also overflowing. Three rows under a sparkline ran to
   * y=558 while `chrome` puts its rule at 538 and the date at 578, so the
   * third name was printed through the rule and into the date on every card
   * with a week series — which is every card, because the number one always
   * has one. Two rows end at 516 and clear it.
   */
  const blockY = series.length >= 2 ? 474 : 348

  if (headline) {
    const said = fitLines(headline, {
      font: f.body, sizes: [30, 27, 24], width: COL - 40, maxLines: 2, spacing: 0,
    })
    let hy = blockY
    for (const line of said.lines) {
      parts.push(text(line, { x: PAD, y: hy, font: 'body', size: said.size, fill: C.ink }))
      hy += Math.round(said.size * 1.25)
    }
    parts.push(chrome({
      f, eyebrow: name.toUpperCase(), eyebrowColor: C.gold,
      footer: edition.label ? `week of ${edition.label.toLowerCase()}` : 'published every Monday',
    }))
    return frame(parts.join(''))
  }

  // The names behind them, small, as a list — proof of a chart.
  let rowY = blockY
  for (const e of edition.entries.slice(1, series.length >= 2 ? 3 : 5)) {
    parts.push(text(String(e.rank), { x: PAD, y: rowY, font: 'mono', size: 20, fill: C.inkFaint }))
    const [nm] = wrap(e.displayName, { font: f.body, size: 24, width: COL - 190, maxLines: 1 })
    parts.push(text(nm, { x: PAD + 46, y: rowY, font: 'body', size: 24, fill: C.inkDim }))
    // The move sits left of where the photograph starts bleeding in, and the
    // label runs rightwards from its arrow rather than backwards into it —
    // "NEW" is three characters wider than "−1" and would otherwise collide.
    const m = moveMark(e)
    if (m) {
      const moveX = PAD + COL - 116
      if (m.dir === 'flat') parts.push(dash(moveX, rowY - 16, 20, 18, m.colour))
      else parts.push(triangle(moveX, rowY - 18, 20, 18, m.dir, m.colour))
      parts.push(text(m.label, { x: moveX + 30, y: rowY, font: 'mono', size: 20, fill: m.colour }))
    }
    rowY += 42
  }

  parts.push(chrome({
    f, eyebrow: name.toUpperCase(), eyebrowColor: C.gold,
    footer: edition.label ? `week of ${edition.label.toLowerCase()}` : 'published every Monday',
  }))
  return frame(parts.join(''))
}

/** What goes beside a name in the chart card's list. */
function moveMark(e) {
  if (e.status === 'new') return { dir: 'up', colour: C.violet, label: 'NEW' }
  if (e.status === 'reentry') return { dir: 'up', colour: C.violet, label: 'RE' }
  if (!Number.isFinite(e.move) || e.move === 0) return { dir: 'flat', colour: C.inkFaint, label: '—' }
  return {
    dir: e.move > 0 ? 'up' : 'down',
    colour: e.move > 0 ? C.up : C.down,
    label: `${e.move > 0 ? '+' : '−'}${Math.abs(e.move)}`,
  }
}

/**
 * The card for the site itself — the front page, the quiz, the channel.
 *
 * It is what a link previews as when there is nothing specific to say, so it
 * says what the site is rather than apologising for what it is not.
 */
export function siteCard({ eyebrow = 'CELEBRITY · HEALTH · FACTS · BIZARRE', line = 'Thirty stories a day. All of them safe to read out loud.' } = {}) {
  const f = loadFonts()

  const parts = [defs(), ground()]
  parts.push(rect({ x: 0, y: 0, width: WIDTH, height: HEIGHT, fill: 'url(#genie-soft)', opacity: 0.07 }))

  parts.push(text('GOSSIP', { x: PAD, y: 300, font: 'display', size: 190, fill: C.ink, spacing: 2 }))
  parts.push(text('GENIE', { x: PAD, y: 448, font: 'display', size: 190, fill: 'url(#genie)', spacing: 2 }))

  const deck = wrap(line, { font: f.body, size: 28, width: WIDTH - PAD * 2 - 420, maxLines: 3 })
  let y = 300
  for (const l of deck) {
    parts.push(text(l, { x: WIDTH - PAD, y, font: 'body', size: 28, fill: C.inkDim, anchor: 'end' }))
    y += 40
  }

  parts.push(chrome({ f, eyebrow, footer: 'a 24/7 channel, and a market for who the world is talking about', footerWidth: WIDTH - PAD * 2 }))
  return frame(parts.join(''))
}

const frame = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">${body}</svg>`

/* ------------------------------------------------------------------ *
 * Rasterising
 * ------------------------------------------------------------------ */

/**
 * SVG → PNG.
 *
 * resvg is a native module, so it is imported lazily: a function that only
 * ever serves meta tags should not pay for loading it, and a card endpoint
 * that cannot load it should fail with something readable rather than at
 * module scope where the answer is a 502 and no log line.
 */
export async function toPng(svg) {
  const f = loadFonts()
  const { Resvg } = await import('@resvg/resvg-js')
  return new Resvg(svg, {
    fitTo: { mode: 'width', value: WIDTH },
    font: {
      // System fonts are off when we have our own — they are slow to
      // enumerate and they are not the brand. They are the safety net for the
      // case where the brand files are missing and something must still draw.
      loadSystemFonts: f.files.length === 0,
      fontFiles: f.files,
      defaultFontFamily: FAMILY.body,
    },
  }).render().asPng()
}

/**
 * Fetch a picture and inline it, or give up quietly.
 *
 * Quietly matters: a share card with no photograph still reads, and a share
 * card that takes eight seconds because a CDN is slow has already lost — the
 * crawler gave up. Anything not obviously an image is refused rather than
 * handed to the rasteriser.
 */
export async function inlineImage(url, { timeoutMs = 3500, maxBytes = 6_000_000 } = {}) {
  if (!url || !/^https:\/\//i.test(url)) return null
  const stop = AbortSignal.timeout(timeoutMs)
  try {
    const res = await fetch(url, { signal: stop, headers: { 'user-agent': 'GossipGenie/1.0 (share cards)' } })
    if (!res.ok) return null
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length || buf.length > maxBytes) return null
    // resvg decodes JPEG, PNG and GIF. WebP it does not, and a WebP handed to
    // it is a blank panel, so it is dropped here where the fallback is drawn.
    if (type === 'image/webp') return null
    return `data:${type};base64,${buf.toString('base64')}`
  } catch { return null }
}

export { C as CARD_COLORS }
