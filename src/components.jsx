import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { STRANDS } from './lib/strands.js'
import { GenieLockup } from './brand/Genie.jsx'
import { Notices } from './ui/Notices.jsx'
import { longDate } from './lib/time.js'
import { imageSources, showable } from './lib/imagesrc.js'
import { framing, subjectOf } from './lib/framing.js'

/**
 * The shape of each box a picture can land in, so the crop can be worked out
 * rather than guessed. Approximate is fine — what matters is the aspect, and
 * these are the sizes the stylesheets actually draw.
 */
const FRAMES = {
  app: { width: 1200, height: 675 },     // the story page, 16:9
  card: { width: 640, height: 400 },     // the front-page grid
  watch: { width: 900, height: 560 },    // the story box on the wide and vertical stages
  blast: { width: 984, height: 420 },    // the fact-blast band
}

export function StrandBadge({ strand, big = false }) {
  const s = STRANDS[strand]
  if (!s) return null
  return (
    <span className={`b-badge${big ? ' big' : ''}`} style={{ '--strand': s.color }}>
      <span className="ic" aria-hidden="true">{s.icon}</span>{s.label}
    </span>
  )
}

/**
 * Shrinks the text inside its box on one scale until it fits. Text is never
 * cut off — the rule carried over from El Niño Watch.
 */
export function useFit(deps, { min = 0.45, step = 0.04 } = {}) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      let s = 1
      el.style.setProperty('--fit', '1')
      while (s > min && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)) {
        s -= step
        el.style.setProperty('--fit', s.toFixed(2))
      }
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    document.fonts?.ready?.then(fit)
    return () => ro.disconnect()
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  return ref
}

/** The photo-less card: the strand's colour field, the name or number huge. */
export function TypeCard({ story, variant = 'app' }) {
  const s = STRANDS[story.strand]
  const onAir = variant === 'watch'
  const big = story.bigNumber?.value
  const person = story.people?.[0]
  /*
   * On air, the headline is ALREADY in the frame: it is the lower
   * third's kicker, six inches lower and eighty-four points high.
   * Setting it again here at two hundred and thirty said the same
   * sentence twice, and that is most of why a picture-less story
   * looked like a slab with a caption stuck on it.
   *
   * The number and the name are the two things this card can say that
   * the strap does not. When the story has neither, the frame says
   * nothing and is a moving colour field instead — which is a weaker
   * frame than a photograph, but a better one than an echo.
   *
   * Everywhere else (the cards, the story page) there is no strap to
   * repeat, so the headline stays the fallback it always was.
   */
  const hero = big || person || (onAir ? null : story.headline)
  const label = big ? story.bigNumber.label : hero ? s.label : ''
  const fitRef = useFit([hero, variant])
  return (
    <div className={`b-type ${variant}${hero ? '' : ' plain'}`} style={{ '--strand': s.color }}>
      <div className="b-type-glyph" aria-hidden="true">{s.icon}</div>
      {hero ? (
        <div className="b-type-fit" ref={fitRef}>
          <div className="b-type-hero">{hero}</div>
          {label && <div className="b-type-label">{label}</div>}
        </div>
      ) : (
        <div className="b-type-plain">{s.label}</div>
      )}
    </div>
  )
}

/**
 * An <img> that heals itself, and reports when it cannot.
 *
 * Tries each source `imageSources` offers for the URL, and once they are all
 * exhausted renders nothing and tells its parent, so a dead picture can be
 * taken out of a gallery rather than leaving a hole in it.
 */
export function HealingImg({ url, onDead, ...rest }) {
  const [attempt, setAttempt] = useState(0)
  useEffect(() => { setAttempt(0) }, [url])
  const src = imageSources(url)[attempt]
  useEffect(() => { if (!src) onDead?.(url) }, [src, url]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!src) return null
  return <img {...rest} src={src} onError={() => setAttempt((a) => a + 1)} />
}

/**
 * A picture, or the typographic card if there is no picture — or if the
 * picture turns out not to load.
 *
 * Every image we show is hosted by somebody else: Commons files get renamed,
 * NASA renditions disappear, a CDN has a bad afternoon. The pipeline checks
 * each URL before publishing it, but a link that was alive at 6am can be dead
 * by noon, and the reader should get the card we already draw for storyless
 * pictures rather than a browser's broken-image glyph.
 */
/**
 * @param {object} [frame] One picture from the story's gallery, when the caller
 *   is running a reel rather than showing the single lead image. Everything
 *   else — the portrait treatment, the healing sources, the credit, the
 *   fallback card — is identical, which is the point: the wide cut's reel gets
 *   the headshot handling for free rather than reinventing it and getting it
 *   subtly wrong.
 */
export function StoryImage({ story, variant = 'app', frame = null }) {
  // An illustration nobody has looked at is not shown at all.
  const pick = frame || story.image
  const img = showable(pick) ? pick : null
  // Where we are in the list of things worth trying for this picture. A new
  // picture starts again at the top, even if the last one exhausted its list.
  const [attempt, setAttempt] = useState(0)
  useEffect(() => { setAttempt(0) }, [img?.url])
  const sources = imageSources(img?.url)
  const src = sources[attempt]
  const onError = () => setAttempt((a) => a + 1)

  if (!src) return <TypeCard story={story} variant={variant} />
  // A headshot filling a 16:9 TV frame becomes a giant crop of a face. On the
  // Watch screen people get a framed portrait over a blurred wash of the photo.
  // People and tall pictures are never cropped to fit a wide box: the whole
  // picture sits in the middle over a blurred wash of itself.
  const tall = img.kind === 'person' || (img.width && img.height && img.height > img.width * 0.9)
  if (tall && variant !== 'watch' && variant !== 'blast') {
    return (
      <figure className={`b-img ${variant} fit`}>
        <img className="b-wash" src={src} alt="" aria-hidden="true" loading="lazy" />
        <img className="b-whole" src={src} alt={img.alt || ''} loading="lazy" onError={onError} />
        <figcaption className="b-credit">
          {img.filePhoto && <b>File photo · </b>}
          {img.credit}{img.licence ? ` · ${img.licence}` : ''}
        </figcaption>
      </figure>
    )
  }
  if (variant === 'watch' && tall) {
    return (
      <figure className="b-img watch portrait" style={{ '--strand': STRANDS[story.strand].color }}>
        <img className="b-wash" src={src} alt="" aria-hidden="true" />
        <div className="b-frame"><img src={src} alt={img.alt || ''} onError={onError} /></div>
        <figcaption className="b-credit">
          {img.filePhoto && <b>File photo · </b>}
          {img.credit}{img.licence ? ` · ${img.licence}` : ''}{img.provider ? ` · ${img.provider}` : ''}
        </figcaption>
      </figure>
    )
  }
  /*
   * The remaining boxes crop to fill. They are all far closer to the picture's
   * own shape than the 9:16 stage is, so the crop is a trim — but a trim taken
   * from the dead centre still slices heads off, because photographs put their
   * subject above the middle. The subject box places it where one is known,
   * and the default sits high where one is not.
   */
  const box = FRAMES[variant] || FRAMES.app
  const f = framing(img, box, { subject: subjectOf(img) })
  return (
    <figure className={`b-img ${variant}${f.mode === 'fit' ? ' fit' : ''}`}>
      {f.mode === 'fit' && <img className="b-wash" src={src} alt="" aria-hidden="true" />}
      <img className={f.mode === 'fit' ? 'b-whole' : undefined}
        src={src} alt={img.alt || ''} loading={variant === 'watch' ? 'eager' : 'lazy'} onError={onError}
        style={f.mode === 'cover' ? { objectPosition: f.position } : undefined} />
      <figcaption className="b-credit">
        {img.filePhoto && <b>File photo · </b>}
        {img.credit}{img.licence ? ` · ${img.licence}` : ''}{img.provider ? ` · ${img.provider}` : ''}
      </figcaption>
    </figure>
  )
}

export function Sparkline({ series = [], color = 'var(--genie-violet)', w = 120, h = 32 }) {
  if (series.length < 2) return null
  const max = Math.max(...series), min = Math.min(...series)
  const pts = series.map((v, i) => [(i / (series.length - 1)) * w, h - 3 - ((v - min) / (max - min || 1)) * (h - 6)])
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const last = pts.at(-1)
  return (
    <svg className="b-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="3" fill={color} />
    </svg>
  )
}

export const Arrow = ({ direction }) => (
  <span className={`b-arrow ${direction}`} aria-label={direction}>
    {direction === 'rising' ? '▲' : direction === 'cooling' ? '▼' : '▶'}
  </span>
)

export function Header({ feed, market }) {
  return (
    <header className="b-head">
      <div className="b-wrap b-head-row">
        <a href="/" className="b-title" aria-label="Gossip Genie home">
          <GenieLockup descriptor="Gossip" height={38} />
        </a>
        <nav className="b-nav">
          <a href="/">Stories</a>
          <a href="/chart" className="chart">Genie 100</a>
          <a href="/market">Market</a>
          <a href="/quiz">Quiz</a>
          <a href="/watch" className="live"><span className="dot" />Watch</a>
        </nav>
        {/* Outside the nav on purpose: the nav styles every anchor inside it
            as a tracked-out uppercase link, which is not what a panel full of
            headlines should look like. */}
        <Notices feed={feed} market={market} />
      </div>
      <div className="b-wrap b-sub">
        <span>{longDate()}</span>
        {feed?.sample && <span className="b-sample">Sample stories — the live feed starts after the first publishing run</span>}
      </div>
    </header>
  )
}

export function Footer() {
  return (
    <footer className="b-foot">
      <div className="b-wrap">
        <GenieLockup descriptor="Gossip" height={44} />
        <p>Gossip Genie writes every story in its own words and links to its sources. Celebrity stories need at least two independent outlets; health, facts and bizarre stories come from official bodies or established news and science organisations. Photos are shown only under an open licence and are credited. Health stories are general information, not medical advice. Spotted a problem? Use “Report a problem” on any story.</p>
      </div>
    </footer>
  )
}
