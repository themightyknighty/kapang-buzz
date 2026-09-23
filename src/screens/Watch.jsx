/**
 * The Watch screen — a fixed 1920×1080 stage, scaled to whatever screen it is
 * on, running the half-hour show clock from lib/rundown.js on a loop.
 *
 * It plays as a channel, not a slideshow: every change goes behind the
 * Genie wipe, stories carry the lower third (treatment B), and the show is
 * broken up by Market Movers, Fact Blast, Health Minute, the quiz and
 * Weird But True. The tape along the bottom takes turns between what is
 * coming up and how the market is moving, so a viewer joining mid-segment
 * sees both without the frame carrying two of them.
 *
 * Two formats share one show: /watch is 1920×1080 for TV and the web;
 * /vertical is 1080×1920 for TikTok, Reels and Shorts, laid out inside the
 * platforms' safe zones with a faster pace.
 *
 * /watch takes the shape of the screen: on a phone held upright it plays the
 * vertical cut, and turning the phone sideways hands back to the wide one.
 * /vertical is always vertical, because that is how the social cut is
 * recorded on a desktop.
 *
 * QA helpers: ?speed=10 runs the clock ten times faster; ?seg=quiz starts on
 * the first segment of that type; ?guides=1 shows the vertical safe zones;
 * ?format=9x16 pins the cut regardless of the window.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildRundown, freshStories, storyIdsOf } from '../lib/rundown.js'
import { loadPrefs } from '../lib/prefs.js'
import { normaliseMix } from '../lib/mix.js'
import { STRANDS } from '../lib/strands.js'
import { ago, clock, longDate } from '../lib/time.js'
import { LowerThird } from '../ui/LowerThird.jsx'
import { Wipe } from '../ui/Wipe.jsx'
import { GenieLockup, GenieWordmark } from '../brand/Genie.jsx'
import { StoryImage, useFit } from '../components.jsx'
import { showable, playable } from '../lib/imagesrc.js'
import { marketMovers, tapeItems } from '../lib/movers.js'
import { useChart } from '../lib/useChart.js'
import { moveLabel, numberOneLine } from '../../market/chart.mjs'
import { Sparkline } from '../ui/Movement.jsx'
import { whyLine, shapeLine, thinLine, rowLine } from '../lib/narrative.js'
import { usePriceBoard } from '../lib/usePriceBoard.js'
import { ratesFor, priceLabel, scoreLabel } from '../lib/rates.js'
import { formatFor } from '../lib/format.js'
import { joinAt, livePosition, storyIdsIn } from '../lib/showclock.js'
import { loadWatched, saveWatched, markWatched, seenSet, clearWatched } from '../lib/watched.js'
import VerticalStory from './VerticalStory.jsx'

/*
 * The QA switches below come from the query string. The fragment is still read
 * as a fallback, because the show used to live at `#/watch?seg=quiz` and those
 * addresses are written down in scripts, bookmarks and this file's own header
 * — a routing change should not quietly break somebody's recording setup.
 */
const params = (() => {
  /*
   * Both, merged — not one or the other.
   *
   * This used to read `location.search`, falling back to the fragment's
   * query only when the search was empty. So a legacy address with
   * anything at all before the hash — a cache buster, a utm tag,
   * `/?r=0.4#/watch?seg=quiz&speed=8` — dropped every switch on the
   * floor, silently, and the page played an ordinary show while
   * whoever sent that link wondered why. The real search wins where
   * both name the same switch.
   */
  const out = new URLSearchParams(window.location.hash.split('?')[1] || '')
  for (const [k, v] of new URLSearchParams(window.location.search || '')) out.set(k, v)
  return out
})()
const SPEED = Math.max(0.1, Number(params.get('speed')) || 1)
const START_SEG = params.get('seg')
const GUIDES = params.get('guides') === '1'
/** ?format=9x16 or ?format=16x9 pins the cut, for QA and for recording. */
const FORCED_FORMAT = params.get('format')
/*
 * ?bulletin=<video url> drops a presenter into the show without waiting for a
 * pipeline run. It is how a freshly rendered clip gets looked at: the render
 * happens on a machine that can reach revid, and the URL it prints goes
 * straight in here.
 */
const BULLETIN_URL = params.get('bulletin')
/** How long the branded card between segments stays fully on screen. */
const WIPE_CARD_MS = 5000 / SPEED

/* ---------------- stage scaling ---------------- */
export const FORMATS = {
  '16x9': { w: 1920, h: 1080, cls: '', durations: {} },
  // Social video moves faster: shorter stories, same segments.
  '9x16': { w: 1080, h: 1920, cls: 'v916', durations: { top: 40, story: 30, movers: 45, moverStory: 36, healthMinute: 45, quiz: 32, answer: 22, weird: 60, comingUp: 25 } },
}

/**
 * The cut this window wants, kept up to date as the window changes.
 *
 * `orientationchange` as well as `resize` because iOS has historically fired
 * them at different moments, and a show that keeps the wrong shape after a
 * rotation is the whole fault this is here to prevent.
 */
function useAutoFormat(enabled) {
  const read = () => formatFor({ width: window.innerWidth, height: window.innerHeight, forced: FORCED_FORMAT })
  const [fmt, setFmt] = useState(read)
  useEffect(() => {
    if (!enabled) return
    const on = () => setFmt(read())
    on()
    window.addEventListener('resize', on)
    window.addEventListener('orientationchange', on)
    return () => {
      window.removeEventListener('resize', on)
      window.removeEventListener('orientationchange', on)
    }
  }, [enabled]) // eslint-disable-line react-hooks/exhaustive-deps
  return fmt
}

function useStageScale(w, h) {
  const [s, setS] = useState(1)
  useEffect(() => {
    const on = () => setS(Math.min(window.innerWidth / w, window.innerHeight / h))
    on(); window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [w, h])
  return s
}

/**
 * Seconds into the current segment, at show speed. The clock does not start
 * until the wipe has cleared, so nothing animates unseen behind it.
 *
 * It carries its own accumulated time rather than measuring from whenever the
 * effect last ran, because two things now interrupt it: a pause, and joining a
 * segment part way through. Measuring from the last run would restart every
 * animation from zero each time the viewer unpaused.
 */
function useElapsed(key, paused, startAt = 0) {
  const [t, setT] = useState(startAt)
  const acc = useRef(startAt)
  useEffect(() => { acc.current = startAt; setT(startAt) }, [key, startAt])
  useEffect(() => {
    if (paused) return
    const from = Date.now()
    const base = acc.current
    const id = setInterval(() => {
      const v = base + ((Date.now() - from) / 1000) * SPEED
      acc.current = v
      setT(v)
    }, 250)
    return () => clearInterval(id)
  }, [key, paused])
  return t
}

/**
 * How long this segment has left, and the call when it runs out.
 *
 * The segment used to simply run its stated length from the moment it
 * appeared. It now has to survive being paused and being joined half way
 * through, so the time already played is kept and the timer is always set for
 * what remains. Whenever the timer is torn down — a pause, a skip, a
 * handover — it banks what it ran for on the way out.
 */
function useSegmentEnd(seg, { paused, startAt = 0, onEnd }) {
  const played = useRef(startAt)
  const endRef = useRef(onEnd)
  endRef.current = onEnd
  useEffect(() => { played.current = startAt }, [seg?.key, startAt])
  useEffect(() => {
    if (!seg || paused) return
    const remain = Math.max(0.3, (seg.dur || 0) - played.current)
    const from = Date.now()
    const id = setTimeout(() => { played.current = seg.dur || 0; endRef.current?.() }, (remain * 1000) / SPEED)
    return () => {
      clearTimeout(id)
      played.current += ((Date.now() - from) / 1000) * SPEED
    }
  }, [seg?.key, paused]) // eslint-disable-line react-hooks/exhaustive-deps
}

function useClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(id) }, [])
  return now
}

/* ---------------- furniture ---------------- */
function TopBar({ seg }) {
  const now = useClock()
  const strand = seg?.story ? STRANDS[seg.story.strand] : null
  const label = {
    headlines: 'The Headlines', open: 'The Genie 100', top: 'Top Story',
    chartPos: 'The Genie 100', numberOne: 'Number One', chartRecap: 'The Genie 100',
    factBlast: 'Fact Blast', healthMinute: 'Health Minute',
    quiz: 'Genie Quiz', answer: 'Answer Reveal', weird: 'Weird But True', comingUp: 'Coming Up',
  }[seg?.type]
  return (
    <div className="w-top">
      <div className="w-brand"><GenieLockup descriptor="Gossip" height={50} /></div>
      {(label || strand) && (
        <div className="w-seg" style={{ '--strand': strand?.color || 'var(--genie-violet)' }}>
          {label || strand.label}{label && strand && seg.type !== 'weird' && seg.type !== 'healthMinute' ? <em>{strand.label}</em> : null}
        </div>
      )}
      <div className="w-top-right">
        <span className="k-tag live"><span className="dot" />Live</span>
        <span className="w-time">{clock(now)}</span>
        <span className="w-date">{longDate(now)}</span>
      </div>
    </div>
  )
}

/** How long the tape spends on each of its two jobs. */
const TAPE_PHASE_MS = 18000

/**
 * One tape along the foot of the frame, alternating between what is coming up
 * and how the market is moving.
 *
 * It was briefly two: a market strip under the brand bar and this one at the
 * bottom. Two marquees running in opposite corners, each behind its own block
 * of colour, gave the frame four horizontal bands and set two labels arguing
 * across it — and the top strip cost every panel 52px of height it needed.
 * One band that takes turns says as much and asks a quarter as much of the eye.
 */
function Tape({ segs, idx, movers }) {
  const market = tapeItems(movers, { max: 10 })
  const [phase, setPhase] = useState('next')

  useEffect(() => {
    if (!market.length) { setPhase('next'); return }
    const id = setInterval(() => setPhase((p) => (p === 'next' ? 'market' : 'next')), TAPE_PHASE_MS / SPEED)
    return () => clearInterval(id)
  }, [market.length])

  const after = segs.slice(idx + 1).filter((s) => s.story)
  const upcoming = (after.length >= 3 ? after : [...after, ...segs.filter((s) => s.story)]).slice(0, 6)
  const nextItems = [
    ...upcoming.map((s) => ({ c: STRANDS[s.story.strand].color, t: s.story.headline })),
    { c: 'var(--genie-gold)', t: 'Gossip Genie · new stories all day, every day' },
  ]

  /*
   * The tape complements the picture above it rather than repeating it. While
   * the Market Movers board or the biggest-mover story is on air, the same
   * names scrolling along the bottom add nothing and read as a stutter — so
   * the tape spends those segments telling the audience what is coming up.
   */
  const marketOnScreen = ['open', 'chartPos', 'numberOne', 'chartRecap'].includes(segs[idx]?.type)
  const on = phase === 'market' && market.length && !marketOnScreen ? 'market' : 'next'
  const items = on === 'market' ? market : nextItems
  if (!items.length) return null
  const run = [...items, ...items]

  return (
    <div className={`w-ticker ${on}`} key={on}>
      <span className="w-ticker-label">{on === 'market' ? 'Market' : 'Next'}</span>
      <div className="w-ticker-track">
        <div className="w-ticker-run" style={{ animationDuration: `${Math.max(40, items.length * 12) / SPEED}s` }}>
          {run.map((it, i) => (on === 'market'
            ? (
              <span key={i} className={`w-tick-mv ${it.direction}`}>
                <b>{it.name}</b><i>{Math.round(it.score)}</i>
                {/* The unit is on the board and on the front page; on a tape
                    running past at speed, the arrow and the sign carry it. */}
                <em>{it.direction === 'up' ? '▲' : '▼'} {it.move > 0 ? '+' : ''}{it.move.toFixed(movers.dp)}</em>
              </span>
            )
            : <span key={i}><i className="dot" style={{ background: it.c }} />{it.t}</span>))}
        </div>
      </div>
    </div>
  )
}

function Progress({ t, dur }) {
  return <div className="w-progress"><i style={{ width: `${Math.min(100, (t / dur) * 100)}%` }} /></div>
}

/**
 * The wide cut's picture: footage where we have it, otherwise a reel.
 *
 * The pipeline gathers up to four reviewed frames for every story and, for
 * health, facts and bizarre, a licence-free video clip — all of it under the
 * heading "the vertical screen needs movement". The wide cut was showing the
 * first still and nothing else, so a 60-second top story was one photograph
 * with a slow zoom on it while three more sat unused in the same payload.
 *
 * The rhythm here is deliberately not the vertical's. That one cuts every 3.2
 * seconds with a white flash, which is right for a phone and wrong for a
 * television: this holds each frame for eight to fourteen seconds and
 * dissolves between them.
 */
function Hero({ story, t = 0, dur = 40 }) {
  const videoRef = useRef(null)
  const [videoFailed, setVideoFailed] = useState(false)
  // Frames that turned out not to load. Nobody is watching the console on a
  // channel, so a dead frame leaves the reel rather than showing as a gap.
  const [dead, setDead] = useState(() => new Set())
  useEffect(() => { setDead(new Set()); setVideoFailed(false) }, [story.id])
  useEffect(() => { videoRef.current?.play?.().catch(() => {}) }, [story.id])

  // Unstamped footage does not play: see playable() for why.
  const useVideo = playable(story.video) && !videoFailed
  if (useVideo) {
    return (
      <div className="w-hero" key={story.id}>
        <video ref={videoRef} className="w-video" src={story.video.url} muted loop playsInline autoPlay
          onError={() => setVideoFailed(true)} />
        <div className="b-credit w-video-credit">▶ {story.video.credit}{story.video.licence ? ` · ${story.video.licence}` : ''}</div>
        <div className="w-hero-shade" />
      </div>
    )
  }

  const frames = (story.gallery || []).filter((m) => showable(m) && !dead.has(m.url))
  // One frame, or none, is the old behaviour and stays exactly as it was.
  if (frames.length < 2) {
    return (
      <div className="w-hero" key={story.id}>
        <StoryImage story={story} variant="watch" />
        <div className="w-hero-shade" />
      </div>
    )
  }

  // Long enough to look at, short enough that the frame always changes at
  // least once in the shortest segment we run.
  const hold = Math.min(14, Math.max(8, dur / frames.length))
  const i = Math.floor(t / hold) % frames.length
  return (
    <div className="w-hero reel" key={story.id}>
      {frames.map((m, k) => (
        // ken-0/1/2 give consecutive shots different moves, so a cut reads as
        // a cut rather than as the same push-in starting over.
        <div key={m.url} className={`w-frame ken-${k % 3}${k === i ? ' on' : ''}`}>
          <StoryImage story={story} frame={m} variant="watch" />
        </div>
      ))}
      <div className="w-hero-shade" />
    </div>
  )
}

function FactsPanel({ facts, t, at = [5, 13, 21], title = 'Key facts', numbered = false }) {
  return (
    <div className="w-facts">
      <div className="w-facts-title">{title}</div>
      {facts.slice(0, 3).map((f, i) => (
        <div key={f} className={`w-fact${t >= at[i] ? ' on' : ''}`}>
          <span className="n">{numbered ? i + 1 : '•'}</span><span>{f}</span>
        </div>
      ))}
    </div>
  )
}

function BuzzMeter({ outlets = 1, t }) {
  const pct = Math.min(1, outlets / 12) * Math.min(1, t / 3)
  const angle = -90 + pct * 180
  return (
    <div className="w-meter">
      <svg viewBox="0 0 200 116" width="260" height="150" aria-hidden="true">
        <path d="M16 106 A84 84 0 0 1 184 106" fill="none" stroke="rgba(140,163,184,.25)" strokeWidth="16" strokeLinecap="round" />
        <path d="M16 106 A84 84 0 0 1 184 106" fill="none" stroke="url(#mg)" strokeWidth="16" strokeLinecap="round"
          strokeDasharray={`${pct * 264} 999`} />
        <defs><linearGradient id="mg"><stop offset="0" stopColor="#3DA5D9" /><stop offset=".6" stopColor="#FFC145" /><stop offset="1" stopColor="#FF5FA2" /></linearGradient></defs>
        <line x1="100" y1="106" x2="100" y2="34" stroke="#fff" strokeWidth="5" strokeLinecap="round" transform={`rotate(${angle} 100 106)`} />
        <circle cx="100" cy="106" r="9" fill="#fff" />
      </svg>
      <div className="w-meter-label">Buzz meter<b>{outlets} outlets</b></div>
    </div>
  )
}

/* ---------------- segments ---------------- */
function StorySeg({ seg, t, market = null }) {
  const { story } = seg
  const s = STRANDS[story.strand]
  const board = usePriceBoard()
  const tags = [{ label: s.label }]
  if (seg.justIn) tags.unshift({ label: 'Just in', live: true })
  if (seg.type === 'top') tags.unshift({ label: 'Top story', live: true })
  const stats = [
    { k: 'Reported by', v: `${story.outlets} outlet${story.outlets === 1 ? '' : 's'}` },
    { k: 'Updated', v: ago(story.publishedAt) },
  ]
  if (story.bigNumber?.value && story.image?.url) stats.unshift({ k: story.bigNumber.label, v: story.bigNumber.value, tone: 'warm' })

  /*
   * What the name on screen is worth, as you hear it.
   *
   * The channel says a celebrity's name and says nothing about where they
   * stand, which is the one thing this show has that a news bulletin does
   * not. The highest-scoring tracked name takes the slot — a lower third has
   * room for one, and three people's figures on a strap is a table.
   *
   * Capped at three stats in total because this is a fixed pixel canvas: a
   * fourth is what pushes the strap off the bottom of a 1080 frame, and the
   * audits catch that only if somebody runs them.
   */
  const rate = ratesFor(story.people, { market, board })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]
  if (rate && stats.length < 3) {
    const price = priceLabel(rate)
    stats.push({ k: 'On the market', v: `${rate.displayName} ${scoreLabel(rate)}${price ? ` · ${price}` : ''}` })
  }
  return (
    <div className="w-seg-story" style={{ '--strand': s.color }}>
      <Hero story={story} t={t} dur={seg.dur} />
      {seg.type === 'top' && <BuzzMeter outlets={story.outlets} t={t} />}
      <FactsPanel facts={story.keyFacts || []} t={t} at={seg.type === 'top' ? [8, 20, 32] : [6, 14, 22]} />
      {story.whyTrending && t > 28 && seg.type !== 'weird' && <div className="w-why">Why it’s buzzing: {story.whyTrending}</div>}
      {story.strand === 'health' && <div className="w-disclaimer">General information, not medical advice</div>}
      <div className="w-l3">
        <Progress t={t} dur={seg.dur} />
        <LowerThird tags={tags} kicker={story.headline} place={`Gossip Genie · ${s.label}`} line={story.caption} stats={stats} />
      </div>
    </div>
  )
}

function WeirdSeg({ seg, t }) {
  const { story } = seg
  return (
    <div className="w-seg-weird" style={{ '--strand': STRANDS.bizarre.color }}>
      <Hero story={story} t={t} dur={seg.dur} />
      <div className="w-weird-stamp">Weird<br />But<br />True</div>
      <FactsPanel facts={story.keyFacts || []} t={t} at={[12, 30, 48]} title="The strange details" />
      <div className="w-l3">
        <Progress t={t} dur={seg.dur} />
        <LowerThird tags={[{ label: 'Weird But True', live: true }]} kicker={story.headline}
          place={story.whyTrending || 'Gossip Genie · Bizarre News'} line={t < 45 ? story.caption : story.body.split('. ').slice(0, 2).join('. ') + '.'} />
      </div>
    </div>
  )
}

/**
 * The Market Movers board — who is gaining and losing attention, side by side.
 *
 * Two columns rather than one ranked list, because the show is answering two
 * questions at once and a single column of signed numbers makes the eye do the
 * sorting. Rows land one after another so the board assembles on air.
 */
/**
 * A face, at stage size.
 *
 * The chart is the one part of this channel that reliably HAS pictures: every
 * name on it is a celebrity whose portrait was resolved from their own
 * Wikidata entry and licence-checked on the way in. That is why the countdown
 * fixes the channel's oldest problem — most stories have no usable photograph,
 * so the default frame was a name floating in an empty slab.
 */
function Face({ entry, className = '' }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [entry?.imageUrl])
  const initials = String(entry?.displayName || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  return (
    <div className={`w-face ${className}${entry?.imageUrl && !failed ? '' : ' none'}`}>
      {entry?.imageUrl && !failed
        ? <img src={entry.imageUrl} alt="" onError={() => setFailed(true)} />
        : <span>{initials}</span>}
    </div>
  )
}

/** The move, as three characters and a colour, exactly as the web chart says it. */
function MoveChip({ entry, big = false }) {
  const label = moveLabel(entry)
  const tone = entry.status === 'new' || entry.status === 'reentry' ? 'new'
    : entry.status === 'up' ? 'up' : entry.status === 'down' ? 'down' : 'flat'
  return (
    <span className={`w-move ${tone}${big ? ' big' : ''}`}>
      <b>{label}</b>
      {entry.lastWeek != null
        ? <i>last week {entry.lastWeek}</i>
        : <i>{entry.status === 'reentry' ? 're-entry' : 'new entry'}</i>}
    </span>
  )
}

/** The week this countdown is counting, said the way the frame should say it. */
const chartWhen = (chart) => (chart?.live
  ? `This week so far · ${chart.label}`
  : `${chart?.label || ''}`)

/**
 * The title card.
 *
 * Fifteen seconds that say what the next twenty minutes are, because a viewer
 * joining a channel mid-loop has no idea otherwise — and because a format
 * needs a title on the front of it.
 */
function OpenSeg({ seg, t }) {
  const { chart } = seg
  return (
    <div className="w-seg-open">
      <div className="w-open-body">
        <span className={`w-open-kicker${t > 0.5 ? ' on' : ''}`}>{chartWhen(chart)}</span>
        <h1 className={t > 1 ? 'on' : ''}>The Genie 100</h1>
        <p className={t > 2.2 ? 'on' : ''}>Counting down the ten names the world is talking about most</p>
        <div className={`w-open-from${t > 3.4 ? ' on' : ''}`}>
          <span>From</span><b>10</b><span>to</span><b>1</b>
        </div>
      </div>
      <Progress t={t} dur={seg.dur} />
    </div>
  )
}

/**
 * One position in the countdown.
 *
 * The rank is the largest thing in the frame, because the rank is what a
 * countdown is. Everything else arrives behind it a beat at a time: the face,
 * the name, the number, and last the reason — which is the part worth waiting
 * for and the part a scoreboard never has.
 */
function ChartPosSeg({ seg, t }) {
  const { entry, place, chart } = seg
  const fitRef = useFit([entry.id])
  /*
   * What moved, not which article mentioned them.
   *
   * A countdown position gets one line for this, and it used to be a
   * headline looked up after the fact — frequently about something other
   * than the thing that put them at this number. This is the same sentence
   * the chart page and the share card use, built from the same record.
   */
  const why = rowLine(entry.movement, { max: 110 })
  return (
    <div className={`w-seg-pos ${entry.status}`}>
      <div className={`w-pos-num${t > 0.3 ? ' on' : ''}`}>{place}</div>
      <Face entry={entry} className={t > 0.8 ? 'on' : ''} />
      <div className="w-pos-body" ref={fitRef}>
        <div className={`w-pos-name${t > 1.4 ? ' on' : ''}`}>{entry.displayName}</div>
        <div className={`w-pos-figs${t > 2.4 ? ' on' : ''}`}>
          <span className="w-pos-score">
            <i>Gossip score</i>
            <b>{entry.score.toFixed(1)}</b>
            {/* The bar is the score out of a hundred, the same scale the site
                uses, so a viewer who has seen one recognises the other. */}
            <span className="w-pos-bar"><span style={{ width: `${Math.max(2, Math.round(entry.score))}%` }} /></span>
          </span>
          <MoveChip entry={entry} />
          {entry.weeksOn > 0 && <span className="w-pos-weeks"><i>Weeks on chart</i><b>{entry.weeksOn}</b></span>}
        </div>
        {why && <div className={`w-pos-why${t > 4 ? ' on' : ''}`}>{why}</div>}
      </div>
      {/* The week as a shape. The one thing on air that shows the chart is
          a measurement rather than a list, and it costs no words. */}
      {entry.movement?.week?.series?.length > 0 && (
        <div className={`w-pos-week-spark${t > 3.2 ? ' on' : ''}`}>
          <span>This week</span>
          <Sparkline series={entry.movement.week.series} peak={entry.movement.week.peak} w={300} h={70} />
        </div>
      )}
      <div className="w-pos-week">{chartWhen(chart)}</div>
      <Progress t={t} dur={seg.dur} />
    </div>
  )
}

/**
 * Number one.
 *
 * The climax of the show, and the one name the whole half hour has been
 * building to — so it gets the full frame, the picture bled behind it, and
 * fifty seconds rather than twenty-six.
 */
function NumberOneSeg({ seg, t }) {
  const { entry, chart } = seg
  const fitRef = useFit([entry.id])
  // The climax gets the full explanation: what moved, and whether it held.
  const why = whyLine(entry.movement)
  const held = shapeLine(entry.movement)
  const thin = thinLine(entry.movement)
  return (
    <div className="w-seg-one">
      <Face entry={entry} className={`bleed${t > 0.6 ? ' on' : ''}`} />
      <div className="w-one-shade" />
      <div className="w-one-body" ref={fitRef}>
        <span className={`w-one-kicker${t > 0.3 ? ' on' : ''}`}>Number one</span>
        <div className={`w-one-name${t > 1.2 ? ' on' : ''}`}>{entry.displayName}</div>
        <div className={`w-one-line${t > 2.6 ? ' on' : ''}`}>{numberOneLine(entry)}</div>
        {why && <div className={`w-one-why${t > 5 ? ' on' : ''}`}>{why}</div>}
        {(held || thin) && <div className={`w-one-held${t > 6 ? ' on' : ''}`}>{thin || held}</div>}
        <dl className={`w-one-figs${t > 7 ? ' on' : ''}`}>
          <div><dt>Gossip score</dt><dd>{entry.score.toFixed(1)}</dd></div>
          <div><dt>Peak</dt><dd>{entry.peak}</dd></div>
          <div><dt>Weeks on chart</dt><dd>{entry.weeksOn}</dd></div>
          {entry.weeksAtOne > 0 && <div><dt>Weeks at one</dt><dd>{entry.weeksAtOne}</dd></div>}
        </dl>
      </div>
      <div className="w-pos-week">{chartWhen(chart)}</div>
      <Progress t={t} dur={seg.dur} />
    </div>
  )
}

/**
 * The ten, back to back, as the show signs off.
 *
 * A countdown that never shows its own list leaves a viewer who joined at
 * number four with four names and no idea what the other six were.
 */
function ChartRecapSeg({ seg, t }) {
  const { entries, chart } = seg
  const fitRef = useFit([entries.length])
  const each = Math.max(0.35, (seg.dur * 0.6) / Math.max(1, entries.length))
  return (
    <div className="w-seg-recap">
      <div className="w-panel-head">
        <h2>The Genie 100 this week</h2>
        <p>{chartWhen(chart)}{chart?.live ? ' · freezes Monday' : ''}</p>
      </div>
      <ol className="w-recap" ref={fitRef}>
        {entries.map((e, i) => (
          <li key={e.id} className={t > 1 + i * each ? 'on' : ''}>
            <span className="n">{e.rank}</span>
            <span className="nm">{e.displayName}</span>
            <span className={`mv ${e.status}`}>{moveLabel(e)}</span>
          </li>
        ))}
      </ol>
      <div className="w-watchline"><GenieWordmark height={56} /><span>New stories all day, every day</span></div>
      <Progress t={t} dur={seg.dur} />
    </div>
  )
}

function FactBlastSeg({ seg, t }) {
  const n = seg.stories.length
  const each = seg.dur / n
  const i = Math.min(n - 1, Math.floor(t / each))
  const s = seg.stories[i]
  const big = s.bigNumber?.value
  const fitRef = useFit([s.id])
  return (
    <div className="w-seg-blast" style={{ '--strand': STRANDS.facts.color }}>
      <div className="w-blast-count">Fact {i + 1} of {n}</div>
      <div className="w-blast-card" key={s.id}>
        <div className="w-blast-fit" ref={fitRef}>
          {big && <div className="w-blast-big">{big}</div>}
          {big && <div className="w-blast-label">{s.bigNumber.label}</div>}
          <div className="w-blast-head">{s.headline}</div>
          <div className="w-blast-line">{s.caption}</div>
        </div>
        {s.image?.url && <div className="w-blast-img"><StoryImage story={s} variant="blast" /></div>}
      </div>
      <div className="w-dots">{seg.stories.map((x, k) => <i key={x.id} className={k === i ? 'on' : k < i ? 'done' : ''} />)}</div>
      <Progress t={t} dur={seg.dur} />
    </div>
  )
}

function HealthSeg({ seg, t }) {
  const { story } = seg
  // Space the steps across the segment so the last one is never a flash.
  const step = Math.max(6, (seg.dur - 14) / 3)
  return (
    <div className="w-seg-health" style={{ '--strand': STRANDS.health.color }}>
      <div className="w-panel-head"><h2>Health Minute</h2><p>{story.headline}</p></div>
      <div className="w-steps">
        {story.keyFacts.slice(0, 3).map((f, i) => (
          <div key={f} className={`w-step${t >= 4 + i * step ? ' on' : ''}`}><b>{i + 1}</b><span>{f}</span></div>
        ))}
      </div>
      <p className="w-health-line">{story.caption}</p>
      <div className="w-disclaimer big">General information, not medical advice</div>
      <Progress t={t} dur={seg.dur} />
    </div>
  )
}

function TrueFalseSeg({ seg, t }) {
  const { story } = seg
  const COUNT_FROM = 8, COUNT_LEN = 15
  const left = Math.max(0, Math.ceil(COUNT_FROM + COUNT_LEN - t))
  const reveal = t >= COUNT_FROM + COUNT_LEN
  const fitRef = useFit([story.id])
  return (
    <div className="w-seg-quiz" style={{ '--strand': STRANDS[story.strand].color }}>
      <div className="w-panel-head"><h2>Quiz Break</h2><p>True or false? Play along at home</p></div>
      <div className="w-quiz-q" ref={fitRef}><span>{story.quiz.statement}</span></div>
      <div className="w-quiz-row">
        <div className={`w-quiz-opt${reveal ? (story.quiz.answer ? ' right' : ' wrong') : ''}`}>True</div>
        <div className="w-quiz-timer">{reveal ? '' : t < COUNT_FROM ? '?' : left}</div>
        <div className={`w-quiz-opt${reveal ? (!story.quiz.answer ? ' right' : ' wrong') : ''}`}>False</div>
      </div>
      {reveal && <div className="w-quiz-answer">It’s <b>{story.quiz.answer ? 'TRUE' : 'FALSE'}</b> — {story.headline}</div>}
      <Progress t={t} dur={seg.dur} />
    </div>
  )
}

/*
 * Whether this viewer has interacted at all yet. Module-level on purpose: once
 * a browser has let sound through it stays let through, and the presenter
 * should not go mute again at the top of the next loop.
 */
let soundUnlocked = false

/**
 * The presenter reading the headlines.
 *
 * Her clip is rendered in the pipeline once per feed run and stored on the
 * feed, so nothing here waits on a render queue. The headlines come up beside
 * her, a beat apart, as she reads them — the show's own type rather than
 * burnt-in captions, which is why the render asks for captions off.
 *
 * The label is not decoration. She is a generated person reading real news,
 * and a channel that does not say so is one bad screenshot from having to
 * explain itself. It stays on screen for the whole segment.
 */
function HeadlinesSeg({ seg, t, format }) {
  const videoRef = useRef(null)
  const [failed, setFailed] = useState(false)
  const b = seg.bulletin

  /*
   * She starts muted, and stays muted until the viewer touches something.
   *
   * Every browser blocks autoplay of video WITH SOUND on a page nobody has
   * interacted with — and refuses the play() call entirely, so an unmuted
   * presenter does not play silently, she does not play at all. A presenter
   * reading the headlines is the one thing on this channel that is worth
   * hearing, so the answer is not to give up on the sound: she plays muted,
   * the frame says sound is a tap away, and the first tap turns her on and is
   * remembered for the rest of the session.
   */
  const [muted, setMuted] = useState(() => !soundUnlocked)
  useEffect(() => {
    if (!muted) return
    const on = () => { soundUnlocked = true; setMuted(false) }
    window.addEventListener('pointerdown', on, { once: true })
    window.addEventListener('keydown', on, { once: true })
    return () => {
      window.removeEventListener('pointerdown', on)
      window.removeEventListener('keydown', on)
    }
  }, [muted])

  useEffect(() => { setFailed(false) }, [b?.videoUrl])
  useEffect(() => { videoRef.current?.play?.().catch(() => {}) }, [b?.videoUrl, muted])

  const heads = (seg.stories || []).map((s) => s.headline).filter(Boolean).slice(0, 5)
  // Paced across the clip rather than at fixed seconds, so they keep step
  // with a bulletin of any length.
  const each = Math.max(2.5, (seg.dur - 4) / Math.max(1, heads.length))
  return (
    <div className={`w-seg-headlines${failed ? ' no-presenter' : ''}`}>
      {!failed && b?.videoUrl && (
        <video ref={videoRef} className="w-presenter" src={b.videoUrl} autoPlay playsInline
          muted={muted} onError={() => setFailed(true)} />
      )}
      <div className="w-presenter-shade" />
      <div className="w-hl-panel">
        <div className="w-panel-head"><h2>The Headlines</h2><p>{format === '9x16' ? 'Today on Gossip Genie' : 'Today’s top stories on Gossip Genie'}</p></div>
        <ol className="w-hl-list">
          {heads.map((h, i) => (
            <li key={h} className={t >= 2 + i * each ? 'on' : ''}><span className="n">{i + 1}</span><span>{h}</span></li>
          ))}
        </ol>
      </div>
      <div className="w-ai-label" title="This presenter is generated, not a real person">
        <i aria-hidden="true">●</i> AI presenter
      </div>
      {/* Not a nag: without it a viewer assumes the presenter has no voice. */}
      {muted && !failed && b?.videoUrl && <div className="w-sound-hint">🔇 Tap anywhere for sound</div>}
      <Progress t={t} dur={seg.dur} />
    </div>
  )
}

const LETTERS = ['A', 'B', 'C', 'D']

/** Multiple choice from the daily quiz. It asks — the answer comes later, in AnswerSeg. */
function QuizSeg({ seg, t, format }) {
  if (!seg.question) return <TrueFalseSeg seg={seg} t={t} />
  const q = seg.question
  const s = STRANDS[q.strand] || STRANDS.facts
  const COUNT_FROM = 5, COUNT_LEN = 15
  const left = Math.max(0, Math.ceil(COUNT_FROM + COUNT_LEN - t))
  const done = t >= COUNT_FROM + COUNT_LEN
  const fitRef = useFit([q.id])
  return (
    <div className="w-seg-quiz mc" style={{ '--strand': s.color }}>
      <div className="w-panel-head"><h2>Genie Quiz</h2><p>From today’s story: {q.headline}</p></div>
      <div className="w-mc-q" ref={fitRef}><span>{q.question}</span></div>
      <div className="w-mc-opts">
        {q.options.map((o, i) => (
          <div key={i} className={`w-mc-opt${t >= 1.5 + i * 0.5 ? ' on' : ''}`}><i>{LETTERS[i]}</i><span>{o}</span></div>
        ))}
      </div>
      <div className="w-mc-foot">
        {!done
          ? <><div className="w-mc-timer" key={left}>{t < COUNT_FROM ? '?' : left}</div><div className="w-mc-cta">{format === '9x16' ? 'Comment A, B, C or D' : 'Lock in your answer'}</div></>
          : <div className="w-mc-later">👀 The answer is coming up after the next stories — stay tuned</div>}
      </div>
      <Progress t={t} dur={seg.dur} />
    </div>
  )
}

/** The reward: the reveal, a little celebration, and why. */
function AnswerSeg({ seg, t }) {
  const q = seg.question
  const s = STRANDS[q.strand] || STRANDS.facts
  const revealed = t >= 2.2
  const fitRef = useFit([q.id])
  const confetti = useMemo(() => Array.from({ length: 36 }, (_, i) => ({
    left: (i * 37) % 100, delay: (i % 12) * 0.12, dur: 2.4 + ((i * 7) % 10) / 10, rot: (i * 47) % 360,
    c: ['#FFC145', '#FF5FA2', '#A77BFF', '#3DDC97'][i % 4],
  })), [])
  return (
    <div className={`w-seg-quiz answer${revealed ? ' revealed' : ''}`} style={{ '--strand': s.color }}>
      <div className="w-answer-slam">Answer time!</div>
      <div className="w-mc-q small" ref={fitRef}><span>{q.question}</span></div>
      <div className="w-mc-opts">
        {q.options.map((o, i) => (
          <div key={i} className={`w-mc-opt on${revealed ? (i === q.answer ? ' right' : ' wrong') : ''}`}><i>{LETTERS[i]}</i><span>{o}</span></div>
        ))}
      </div>
      {revealed && <div className="w-answer-why"><b>It’s {LETTERS[q.answer]} — {q.options[q.answer]}!</b> {q.explanation}</div>}
      {revealed && <div className="w-confetti" aria-hidden="true">{confetti.map((p, i) => (
        <i key={i} style={{ left: `${p.left}%`, background: p.c, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, transform: `rotate(${p.rot}deg)` }} />
      ))}</div>}
      <Progress t={t} dur={seg.dur} />
    </div>
  )
}

function ComingUpSeg({ seg, t }) {
  // Long headlines used to push the sign-off off the bottom of the frame;
  // the list shrinks to its box instead.
  const fitRef = useFit([seg.stories.map((s) => s.id).join()])
  return (
    <div className="w-seg-next">
      <div className="w-panel-head"><h2>Coming up on Gossip Genie</h2><p>Stay with us — the show starts again</p></div>
      <ol className="w-next" ref={fitRef}>
        {seg.stories.map((s, i) => (
          <li key={s.id} className={t > 1 + i * 2 ? 'on' : ''} style={{ '--strand': STRANDS[s.strand].color }}>
            <span className="strand">{STRANDS[s.strand].label}</span>{s.headline}
          </li>
        ))}
      </ol>
      <div className="w-watchline"><GenieWordmark height={64} /><span>New stories all day, every day</span></div>
      <Progress t={t} dur={seg.dur} />
    </div>
  )
}

/** Moving colour and sparkles behind the vertical panels. */
function VFx() {
  const stars = [[12, 18], [78, 12], [40, 34], [86, 46], [20, 62], [64, 70], [34, 84], [90, 80]]
  return (
    <div className="v-fx" aria-hidden="true">
      <i /><i /><i />
      {stars.map(([x, y], k) => <b key={k} style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${k * 0.4}s` }}>✦</b>)}
    </div>
  )
}

const CHAT_LINES = {
  chartPos: '💬 Too high? Too low? Comment',
  numberOne: '💬 Agree with number one?',
  chartRecap: '👉 Follow — new chart every Monday',
  factBlast: '💬 Which fact got you? Comment 1, 2 or 3',
  healthMinute: '💬 Will you try it? Comment YES or NO',
  quiz: '💬 Comment A, B, C or D now!',
  answer: '🎉 Got it right? Comment 🎉',
  comingUp: '👉 Follow for more Gossip Genie',
}

function Segment({ seg, paused, format, startAt = 0, market = null }) {
  /*
   * The animation clock is given the same offset as the end timer.
   *
   * They used to disagree: joining forty seconds into a story started its
   * reveals from zero while its remaining length was correctly forty seconds
   * shorter, so the viewer saw the opening of a segment that then ended
   * under them. A joined segment should look as far through as it is.
   */
  const t = useElapsed(seg.key, paused, startAt)
  if (format === '9x16') {
    if (seg.type === 'headlines') return <HeadlinesSeg seg={seg} t={t} format={format} />
    if (seg.type === 'top' || seg.type === 'story' || seg.type === 'weird') return <VerticalStory seg={seg} t={t} />
    return (
      <>
        <VFx />
        <PanelSegment seg={seg} t={t} format={format} market={market} />
        {CHAT_LINES[seg.type] && <div className="v-chatpill">{seg.type === 'quiz' && !seg.question ? '💬 Comment TRUE or FALSE now!' : CHAT_LINES[seg.type]}</div>}
      </>
    )
  }
  return <PanelSegment seg={seg} t={t} format={format} market={market} />
}

function PanelSegment({ seg, t, format, market = null }) {
  switch (seg.type) {
    case 'headlines': return <HeadlinesSeg seg={seg} t={t} format={format} />
    case 'top': case 'story': return <StorySeg seg={seg} t={t} market={market} />
    case 'weird': return <WeirdSeg seg={seg} t={t} />
    case 'open': return <OpenSeg seg={seg} t={t} />
    case 'chartPos': return <ChartPosSeg seg={seg} t={t} />
    case 'numberOne': return <NumberOneSeg seg={seg} t={t} />
    case 'chartRecap': return <ChartRecapSeg seg={seg} t={t} />
    case 'factBlast': return <FactBlastSeg seg={seg} t={t} />
    case 'healthMinute': return <HealthSeg seg={seg} t={t} />
    case 'quiz': return <QuizSeg seg={seg} t={t} format={format} />
    case 'answer': return <AnswerSeg seg={seg} t={t} />
    case 'comingUp': return <ComingUpSeg seg={seg} t={t} />
    default: return null
  }
}

/** Is this running order the chart show, or the news fallback? */
const hasChart = (segs) => segs.some((s) => s.type === 'chartPos' || s.type === 'numberOne')

const wipeCopy = (seg) => {
  if (!seg) return {}
  const map = {
    open: ['Up next', 'The Genie 100'],
    top: ['Top Story', seg.story?.headline],
    story: [STRANDS[seg.story?.strand]?.label, seg.story?.headline],
    // The wipe announces the position without naming who is in it — a
    // countdown that gives the next name away on the way into it is not a
    // countdown.
    chartPos: ['The Genie 100', `At number ${seg.place}`],
    numberOne: ['The Genie 100', 'And number one is…'],
    chartRecap: ['The Genie 100', 'This week in full'],
    weird: ['Weird But True', seg.story?.headline],
    factBlast: ['Up next', 'Fact Blast'],
    healthMinute: ['Up next', 'Health Minute'],
    quiz: ['Up next', 'Genie Quiz'],
    answer: ['Up next', 'Answer time'],
    comingUp: ['Gossip Genie', 'Coming up'],
  }
  const [cue, place] = map[seg.type] || ['Next', '']
  return { cue: seg.justIn ? 'Just in' : cue, place }
}

/* ---------------- the player ---------------- */
/** The feed the show actually runs, with a QA bulletin folded in if one was asked for. */
const withBulletin = (f) => (BULLETIN_URL && f && !f.bulletin
  ? { ...f, bulletin: { videoUrl: BULLETIN_URL, presenter: 'synthetic', provider: 'revid.ai' } }
  : f)

export default function Watch({ feed, market, format = 'auto' }) {
  // 'auto' follows the screen; an explicit format (the /vertical route) does not.
  const auto = useAutoFormat(format === 'auto')
  const shape = format === 'auto' ? auto : format
  const F = FORMATS[shape] || FORMATS['16x9']
  const scale = useStageScale(F.w, F.h)
  // The board and the tape read the same movers the front page does, so the
  // channel and the site can never be telling different stories about who is
  // climbing.
  const movers = useMemo(() => marketMovers(market, feed), [market, feed])
  /*
   * The countdown's spine. The live standings by preference, because the
   * channel should be showing the week that is happening — and the published
   * edition as a fallback for the hours after a freeze when the live one has
   * not been rebuilt yet. Either way the frame says which it is.
   */
  const liveChart = useChart('live')
  const publishedChart = useChart()
  const chart = liveChart.chart || publishedChart.chart || null
  /*
   * The reader's mix follows them onto the channel. Read once on mount
   * rather than watched: the running order is a half-hour programme and
   * reshuffling it under somebody mid-story is worse than honouring a
   * setting from thirty seconds ago.
   */
  const mix = useMemo(() => normaliseMix(loadPrefs().mix), [])
  const rundown = (f, c) => buildRundown(withBulletin(f), { durations: F.durations, chart: c, mix })
  const feedRef = useRef(feed)
  feedRef.current = feed
  const moversRef = useRef(movers)
  moversRef.current = movers
  // The loop rebuilds from the latest standings, so a new position — or a new
  // week entirely, on a Monday — is on air by the top of the next show rather
  // than at the next page load.
  const chartRef = useRef(chart)
  chartRef.current = chart
  const [segs, setSegs] = useState([])
  const [idx, setIdx] = useState(0)
  const [wiping, setWiping] = useState(false)
  // What the wipe has promised. Decided before the wipe starts so the card
  // and the segment that follows it can never disagree.
  const [pending, setPending] = useState(null)

  /*
   * Where this viewer is, relative to the channel.
   *
   *   live    — joined where the channel actually is, by the clock
   *   catchup — moved forward past what they had already watched, so now
   *             running ahead of the live point
   *   shifted — they have taken the controls themselves
   *
   * `into` is how far into the opening segment to begin, which is what makes
   * joining a broadcast feel like joining a broadcast rather than starting a
   * video.
   */
  const [mode, setMode] = useState('live')
  const [into, setInto] = useState(0)
  const [paused, setPaused] = useState(false)
  // A short crossfade for moves the viewer made. The branded wipe is five
  // seconds; using it for a skip would make skipping slower than watching.
  const [cutting, setCutting] = useState(false)
  const [hint, setHint] = useState(false)

  const feedAt = feed?.generatedAt || null
  const [watched, setWatched] = useState(() => loadWatched(feedAt))
  // A new feed means a new show and a clean slate.
  useEffect(() => { setWatched(loadWatched(feedAt)) }, [feedAt])
  const watchedRef = useRef(watched)
  watchedRef.current = watched

  /*
   * Build the first rundown as soon as there is a feed — and build it again if
   * the chart turns up afterwards.
   *
   * The two fetches do not land together: the feed usually wins, and a rundown
   * built in that moment has no countdown in it at all — it is the news
   * fallback. Left alone that gap lasts a full half-hour cycle, so every
   * viewer arriving on a cold page gets the wrong programme. The rebuild
   * happens once, and only while we are still on the opening segment, so a
   * running order is never rewritten under a viewer mid-show.
   */
  const rebuiltForChart = useRef(false)
  // The stories the feed held when this running order was built. Anything that
  // turns up later is genuinely new; anything already here is not.
  const baselineRef = useRef(new Set())
  useEffect(() => {
    if (!feed) return
    const chartReady = (chart?.entries?.length || 0) >= 3
    /*
     * Rebuild when what is on air is the WRONG PROGRAMME, not when the
     * viewer happens to be at the top of it.
     *
     * This used to refuse to rebuild once idx had moved past zero, to
     * avoid rewriting a running order under somebody mid-show. But the
     * position comes from the wall clock, so almost every viewer joins
     * at idx > 0 — and the running order they joined was the news
     * fallback built in the second before the chart landed. The guard
     * meant most people got the wrong show for a full half hour.
     *
     * The chart arrives a beat after the feed, so the interruption is
     * a second of the opening at worst, and the re-join below puts the
     * viewer at the clock's position in the new order rather than
     * dumping them back at the top.
     */
    if (segs.length && (rebuiltForChart.current || !chartReady || hasChart(segs))) return
    if (chartReady) rebuiltForChart.current = true
    baselineRef.current = storyIdsOf(feed)
    const r = rundown(feed, chart)
    setSegs(r)

    /*
     * Join the channel rather than start it.
     *
     * The position comes from the clock against the feed's own publication
     * time, so opening the page at 2:14 puts you where the channel is at 2:14
     * — and if that happens to be something you already watched this morning,
     * you are moved forward to the first thing you have not. Both halves of
     * "I don't want to see that again" are answered here.
     */
    const j = joinAt(r, seenSet(watchedRef.current), { now: Date.now(), epoch: feed.generatedAt })
    if (j) { setIdx(j.idx); setInto(j.into); setMode(j.mode === 'catchup' ? 'catchup' : 'live') }
    // The QA hooks still win, so ?seg= and recording behave as they always did.
    if (START_SEG) {
      const k = r.findIndex((s) => s.type === START_SEG)
      if (k >= 0) { setIdx(k); setInto(0); setMode('shifted') }
    }
  }, [feed, segs.length, chart])

  // Shown once, briefly, so the controls are discoverable without a manual.
  useEffect(() => {
    if (!segs.length || START_SEG) return
    setHint(true)
    const id = setTimeout(() => setHint(false), 4200)
    return () => clearTimeout(id)
  }, [segs.length])

  const seg = segs[idx]

  /**
   * Work out the whole of what comes next — the running order and the place in
   * it — in one go, so the wipe can name it and then play exactly that.
   */
  const planNext = () => {
    const f = feedRef.current
    const queued = new Set(segs.flatMap((s) => [s.story?.id, ...(s.stories || []).map((x) => x.id)]).filter(Boolean))
    const fresh = freshStories(f, baselineRef.current, { max: 4, queued })
    // End of the show: rebuild from the latest feed and go again.
    if (idx + 1 >= segs.length) { const r = rundown(f, chartRef.current); return { segs: r.length ? r : segs, idx: 0, rebuilt: true } }
    // New stories landed mid-show: they jump the queue with a Just In sting.
    if (fresh.length) {
      const ins = fresh.map((s, i) => ({ type: 'story', dur: F.durations.story || 40, story: s, justIn: true, key: `just-${s.id}-${i}` }))
      // Counted as seen, so the same story is never "just in" twice.
      for (const s of fresh) baselineRef.current.add(s.id)
      return { segs: [...segs.slice(0, idx + 1), ...ins, ...segs.slice(idx + 1)], idx: idx + 1 }
    }
    return { segs, idx: idx + 1 }
  }

  // Each segment runs out its remaining length after the wipe clears, then
  // hands over. Pausing holds it; joining part way through shortens it.
  useSegmentEnd(seg, {
    paused: wiping || paused,
    startAt: into,
    onEnd: () => { setPending(planNext()); setWiping(true) },
  })

  /*
   * A segment counts as watched a few seconds in.
   *
   * Not at the very end, because a viewer who skips past something has decided
   * they do not want it and should not be shown it again tomorrow either; and
   * not instantly, because a segment glimpsed for half a second while tapping
   * through is not watched in any sense that matters.
   */
  useEffect(() => {
    if (!seg || wiping) return
    const ids = storyIdsIn(seg)
    if (!ids.length) return
    const id = setTimeout(() => {
      setWatched((w) => {
        const next = markWatched(w, ids, { feedAt })
        if (next !== w) saveWatched(next)
        return next
      })
    }, 3000 / SPEED)
    return () => clearTimeout(id)
  }, [seg?.key, wiping, feedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * The viewer taking the controls.
   *
   * Manual moves bypass the branded wipe: it holds for five seconds, which is
   * fine as the channel's own punctuation and absurd as the cost of skipping
   * something. A short crossfade stands in, and the viewer is marked as
   * time-shifted because they are no longer where the channel is.
   */
  const move = (delta) => {
    if (!segs.length || cutting) return
    setCutting(true)
    setHint(false)
    setPending(null)
    setWiping(false)
    const plan = delta > 0 ? planNext() : { segs, idx: (idx - 1 + segs.length) % segs.length }
    setTimeout(() => {
      if (plan.rebuilt) baselineRef.current = storyIdsOf(feedRef.current)
      setSegs(plan.segs)
      setIdx(plan.idx)
      setInto(0)
      setMode('shifted')
      setTimeout(() => setCutting(false), 180)
    }, 150)
  }

  /** Back to wherever the channel actually is. */
  const goLive = () => {
    const p = livePosition(segs, { now: Date.now(), epoch: feedAt })
    if (!p) return
    setCutting(true)
    setPending(null); setWiping(false)
    setTimeout(() => {
      setIdx(p.idx); setInto(p.into); setMode('live')
      setTimeout(() => setCutting(false), 180)
    }, 150)
  }

  // Keyboard, for the desktop and for recording the social cut.
  useEffect(() => {
    const on = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowRight') { e.preventDefault(); move(1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1) }
      else if (e.key === ' ') { e.preventDefault(); setPaused((p) => !p) }
      else if (e.key === 'l' || e.key === 'L') { e.preventDefault(); goLive() }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }) // re-bound each render so it always closes over the current position

  // Swipe up for the next segment, down for the last — the gesture every
  // vertical video app has trained people to expect.
  const touch = useRef(null)
  const onTouchStart = (e) => { touch.current = { y: e.touches[0].clientY, t: Date.now() } }
  const onTouchEnd = (e) => {
    const s = touch.current
    touch.current = null
    if (!s) return
    const dy = (e.changedTouches?.[0]?.clientY ?? s.y) - s.y
    if (Date.now() - s.t > 800 || Math.abs(dy) < 60) return
    move(dy < 0 ? 1 : -1)
  }

  // The wipe has covered the screen: put on the air whatever it just promised.
  const advance = () => {
    if (!pending) return
    // A new show starts from the feed as it stands now.
    if (pending.rebuilt) baselineRef.current = storyIdsOf(feedRef.current)
    setSegs(pending.segs)
    setIdx(pending.idx)
    /*
     * And it starts at the top of it.
     *
     * `into` is the offset for the ONE segment the viewer joined part way
     * through. Leaving it set meant it was then subtracted from every
     * segment that followed for the rest of the session, and since a join
     * lands a minute or so into the show, almost every subsequent segment
     * fell through to the 0.3s floor in useSegmentEnd: the channel wiped,
     * showed a chart position for a third of a second, and wiped again.
     * The join offset belongs to the join, not to the player.
     */
    setInto(0)
  }

  const now = new Date()
  const upcoming = pending ? pending.segs[pending.idx] : segs[idx + 1] || segs[0]
  const allSeen = segs.length > 0 && segs.every((s) => { const ids = storyIdsIn(s); return ids.length && ids.every((i) => seenSet(watched).has(i)) })
  return (
    <div className="w-viewport" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* What is on air and how long it is booked for, on the element itself.
          A running order is only correct if the show actually runs to it, and
          that is not something any static check can see — scripts/watch-timing
          -audit.mjs watches the channel and times each segment against the
          length declared here. Two attributes, no behaviour. */}
      <div
        className={`w-stage ${F.cls}${cutting ? ' cutting' : ''}`.trim()}
        data-seg={seg?.type || ''}
        data-dur={seg?.dur ?? ''}
        style={{ width: F.w, height: F.h, transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        {!seg && <div className="w-empty"><div className="w-brand big"><GenieLockup descriptor="Gossip" height={180} /></div><p>Tuning in…</p></div>}
        {seg && <Segment key={seg.key} seg={seg} paused={wiping || paused} format={shape} startAt={into} market={market} />}
        <TopBar seg={seg} />
        {segs.length > 0 && <Tape segs={segs} idx={idx} movers={movers} />}

        {/* The controls. Real buttons rather than a bare overlay, so the show
            can be driven from a keyboard and read by a screen reader — and
            they sit under the Exit link, which must stay clickable. */}
        {segs.length > 0 && (
          <div className="w-taps">
            <button className="w-tap back" onClick={() => move(-1)} aria-label="Previous segment" />
            <button className="w-tap hold" onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Resume' : 'Pause'} />
            <button className="w-tap fwd" onClick={() => move(1)} aria-label="Next segment" />
          </div>
        )}

        {segs.length > 0 && (
          <div className="w-state">
            {/* Everything that says what you are watching lives in one
                stack. The sample flag used to be its own badge pinned a
                few pixels away, which meant two right-aligned overlays
                competing for the only clear strip in the frame. */}
            {feed?.sample && <span className="w-chip sample">Sample stories</span>}
            {mode === 'live'
              ? <span className="w-chip live"><i />Live</span>
              : <button className="w-chip shifted" onClick={goLive} title="Back to the live point (L)">
                  {mode === 'catchup' ? 'Catch-up' : 'Time-shifted'} · back to live
                </button>}
            {allSeen && (
              <button className="w-chip seen" onClick={() => setWatched(clearWatched(feedAt))}>
                You’re all caught up · watch it again
              </button>
            )}
            {paused && <span className="w-chip paused">Paused</span>}
          </div>
        )}

        {hint && <div className="w-hint">Tap the right to skip · left to go back · middle to pause</div>}
        <Wipe show={wiping} ready minHoldMs={WIPE_CARD_MS} brand={<GenieLockup descriptor="Gossip" height={shape === '9x16' ? 90 : 72} />} {...wipeCopy(upcoming)}
          sub={upcoming?.story ? `${upcoming.story.outlets} outlets · ${ago(upcoming.story.publishedAt)}` : 'Gossip Genie'}
          date={longDate(now) + ' · ' + clock(now)}
          onCovered={advance} onDone={() => { setWiping(false); setPending(null) }} />
        {GUIDES && shape === '9x16' && <div className="v-guides" aria-hidden="true"><i className="t" /><i className="b" /><i className="r" /></div>}
        <a href="/" className="w-exit">Exit</a>
      </div>
    </div>
  )
}
