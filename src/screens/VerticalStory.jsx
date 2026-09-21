/**
 * The vertical (9:16) story — built for TikTok, not re-laid from TV.
 *
 * One story is three beats, and something moves on screen the whole time:
 *
 *   HOOK     0–3 s   the headline slams in word by word over the picture
 *   REEL     3 s →   video, or the photo gallery with punch-in cuts; facts pop
 *                    in as stickers; a number counts up
 *   CHAT     last 9 s  a big comment call-to-action with an A / B answer,
 *                    so viewers have something to type
 *
 * Every photo keeps its credit on screen. Nothing here invents reactions:
 * the floating emoji are decoration, not fake comments.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { STRANDS } from '../lib/strands.js'
import { useFit, HealingImg } from '../components.jsx'
import { showable, playable } from '../lib/imagesrc.js'
import { framing, subjectOf } from '../lib/framing.js'

/** The vertical stage, in the pixels the reel is actually drawn at. */
const FRAME_916 = { width: 1080, height: 1920 }

export const HOOK_S = 3
export const CHAT_S = 9

const EMOJI = {
  celebrity: ['⭐', '🎤', '💃', '🎬', '✨'],
  health: ['💚', '🏃', '🥦', '💧', '✨'],
  facts: ['🤯', '🚀', '🌍', '🔭', '✨'],
  bizarre: ['😲', '🦄', '👀', '🌀', '✨'],
}

/** A comment prompt for every story, even ones published before prompts existed. */
export function chatFor(story) {
  if (story.chatPrompt?.question) return story.chatPrompt
  const fallback = {
    celebrity: { question: 'Are you excited about this?', a: 'So excited', b: 'Not for me' },
    health: { question: 'Would you give this a try?', a: 'Trying it today', b: 'Maybe later' },
    facts: { question: 'Did you already know this?', a: 'Knew it', b: 'Mind blown' },
    bizarre: { question: 'Weird or wonderful?', a: 'Weird', b: 'Wonderful' },
  }
  return fallback[story.strand] || fallback.facts
}

/** "3,000+" → { n: 3000, prefix: '', suffix: '+' } so it can count up. */
export function parseCount(value) {
  const m = /^([^\d]*)([\d,.]+)(.*)$/.exec(String(value || ''))
  if (!m) return null
  const n = Number(m[2].replace(/,/g, ''))
  return Number.isFinite(n) ? { n, prefix: m[1], suffix: m[3], decimals: (m[2].split('.')[1] || '').length } : null
}

function Counter({ value, t, start }) {
  const p = parseCount(value)
  if (!p) return <b>{value}</b>
  const k = Math.max(0, Math.min(1, (t - start) / 1.6))
  const eased = 1 - Math.pow(1 - k, 3)
  const shown = (p.n * eased).toLocaleString('en-US', { minimumFractionDigits: p.decimals, maximumFractionDigits: p.decimals })
  return <b>{p.prefix}{shown}{p.suffix}</b>
}

/** Pictures to cycle through: the gallery, else the single image. */
function mediaList(story) {
  // Same rule as the app: only pictures whose contents are established.
  const g = (story.gallery || []).filter(showable)
  if (g.length) return g
  return showable(story.image) ? [story.image] : []
}

function Reel({ story, t, slide }) {
  const videoRef = useRef(null)
  const [videoFailed, setVideoFailed] = useState(false)
  // Unstamped footage does not play: see playable() for why.
  const useVideo = playable(story.video) && !videoFailed
  // Pictures that turned out not to load. On a channel nobody is watching the
  // console, so a frame that fails leaves the reel entirely rather than
  // showing as a blank slide on its way past.
  const [dead, setDead] = useState(() => new Set())
  useEffect(() => { setDead(new Set()) }, [story.id])
  const list = mediaList(story).filter((m) => !dead.has(m.url))
  const markDead = (url) => setDead((d) => (d.has(url) ? d : new Set(d).add(url)))

  useEffect(() => { videoRef.current?.play?.().catch(() => {}) }, [story.id])

  if (useVideo) {
    return (
      <div className="vs-media">
        <video ref={videoRef} className="vs-video" src={story.video.url} muted loop playsInline autoPlay
          onError={() => setVideoFailed(true)} />
        <div className="vs-credit">▶ {story.video.credit} · {story.video.licence}</div>
      </div>
    )
  }
  if (!list.length) {
    const s = STRANDS[story.strand]
    return (
      <div className="vs-media vs-gfx" style={{ '--strand': s.color }}>
        <div className="vs-gfx-glyph" aria-hidden="true">{s.icon}</div>
        <div className="vs-gfx-rings" aria-hidden="true"><i /><i /><i /></div>
      </div>
    )
  }
  const i = slide % list.length
  const img = list[i]
  return (
    <div className="vs-media">
      {list.map((m, k) => {
        /*
         * Framed one picture at a time.
         *
         * This used to work out the treatment from whichever slide happened to
         * be showing and then apply it to all of them, so in a gallery a
         * portrait's positioning was handed to the landscape frames either side
         * of it. Each picture is its own shape and gets its own answer.
         */
        const f = framing(m, FRAME_916, { subject: subjectOf(m) })
        return (
          <div key={m.url} className={`vs-slide${k === i ? ' on' : ''}${k % 2 ? ' pan-r' : ' pan-l'}${f.mode === 'fit' ? ' whole' : ''}${f.anchored ? ' anchored' : ''}`}>
            <HealingImg className="vs-wash" url={m.url} alt="" aria-hidden="true" />
            <HealingImg className="vs-photo" url={m.url} alt={m.alt || ''} onDead={markDead}
              style={f.mode === 'cover' ? { objectPosition: f.position } : undefined} />
          </div>
        )
      })}
      <div className="vs-flash" key={`flash-${i}`} />
      <div className="vs-credit">{img.filePhoto ? 'File photo · ' : ''}{img.credit}{img.licence ? ` · ${img.licence}` : ''}</div>
    </div>
  )
}

function Hook({ story, label }) {
  const words = story.headline.split(/\s+/)
  const fitRef = useFit([story.id])
  return (
    <div className="vs-hook">
      <div className="vs-sticker">{label}</div>
      <div className="vs-hook-fit" ref={fitRef}>
        <h1>{words.map((w, i) => <span key={i} style={{ animationDelay: `${0.12 + i * 0.11}s` }}>{w}</span>)}</h1>
      </div>
    </div>
  )
}

function Card({ story, label }) {
  const fitRef = useFit([story.id])
  return (
    <div className="vs-card">
      <div className="vs-card-tag">{label}</div>
      <div className="vs-card-fit" ref={fitRef}>
        <h2>{story.headline}</h2>
        <p>{story.caption}</p>
      </div>
    </div>
  )
}

function Chat({ story, t, start }) {
  const c = chatFor(story)
  const fitRef = useFit([story.id, c.question])
  const pick = Math.floor((t - start) / 1.2) % 2
  return (
    <div className="vs-chat">
      <div className="vs-chat-pill"><span className="vs-bubble">💬</span> Comment below</div>
      <div className="vs-chat-fit" ref={fitRef}><h2>{c.question}</h2></div>
      <div className="vs-choices">
        <div className={`vs-choice a${pick === 0 ? ' hot' : ''}`}><i>A</i><span>{c.a}</span></div>
        <div className={`vs-choice b${pick === 1 ? ' hot' : ''}`}><i>B</i><span>{c.b}</span></div>
      </div>
      <div className="vs-chat-hint">Type <b>A</b> or <b>B</b> in the comments 👇</div>
    </div>
  )
}

function Floaters({ strand, on }) {
  const set = EMOJI[strand] || EMOJI.facts
  const items = useMemo(() => Array.from({ length: 14 }, (_, i) => ({
    e: set[i % set.length], left: 6 + ((i * 53) % 80), delay: (i * 0.45) % 5, dur: 4.5 + ((i * 7) % 4), size: 54 + ((i * 11) % 40),
  })), [strand]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={`vs-floaters${on ? ' on' : ''}`} aria-hidden="true">
      {items.map((x, i) => (
        <span key={i} style={{ left: `${x.left}%`, animationDelay: `${x.delay}s`, animationDuration: `${x.dur}s`, fontSize: x.size }}>{x.e}</span>
      ))}
    </div>
  )
}

export default function VerticalStory({ seg, t }) {
  const { story } = seg
  const s = STRANDS[story.strand]
  const label = seg.type === 'weird' ? 'Weird but true' : seg.type === 'top' ? 'Top story' : seg.justIn ? 'Just in' : s.short
  const dur = seg.dur
  const chatAt = Math.max(HOOK_S + 8, dur - CHAT_S)
  const phase = t < HOOK_S ? 'hook' : t < chatAt ? 'reel' : 'chat'

  // One picture change every 3.2 s through the reel; the hook holds the first.
  const slide = t < HOOK_S ? 0 : 1 + Math.floor((t - HOOK_S) / 3.2)

  // Facts take turns as stickers, evenly across the reel.
  const facts = (story.keyFacts || []).slice(0, 3)
  const reelLen = chatAt - HOOK_S - 1
  const factIdx = phase === 'reel' && facts.length ? Math.min(facts.length - 1, Math.floor((t - HOOK_S - 0.8) / (reelLen / facts.length))) : -1
  const counterStart = HOOK_S + 0.6
  const segProgress = [
    Math.min(1, t / HOOK_S),
    Math.max(0, Math.min(1, (t - HOOK_S) / (chatAt - HOOK_S))),
    Math.max(0, Math.min(1, (t - chatAt) / (dur - chatAt))),
  ]

  return (
    <div className={`vs phase-${phase}`} style={{ '--strand': s.color }}>
      <Reel story={story} t={t} slide={slide} />
      <div className="vs-shade" />
      <div className="vs-bars">{segProgress.map((p, i) => <i key={i}><b style={{ width: `${p * 100}%` }} /></i>)}</div>

      {phase === 'hook' && <Hook story={story} label={label} />}

      {phase === 'reel' && (
        <>
          {story.bigNumber?.value && t >= counterStart && (
            <div className="vs-count" key="count"><Counter value={story.bigNumber.value} t={t} start={counterStart} /><em>{story.bigNumber.label}</em></div>
          )}
          {factIdx >= 0 && t >= HOOK_S + 0.8 && (
            <div className={`vs-fact r${factIdx}`} key={`fact-${factIdx}`}><span>{['👉', '💡', '🔥'][factIdx]}</span>{facts[factIdx]}</div>
          )}
          <Card story={story} label={label} />
          {story.strand === 'health' && <div className="vs-disclaimer">General information, not medical advice</div>}
        </>
      )}

      {phase === 'chat' && <Chat story={story} t={t} start={chatAt} />}
      <Floaters strand={story.strand} on={phase === 'chat'} />
    </div>
  )
}
