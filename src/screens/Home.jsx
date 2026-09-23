import { useState } from 'react'
import { STRANDS, STRAND_KEYS, DAILY_TARGET } from '../lib/strands.js'
import { MixSliders } from '../ui/MixSliders.jsx'
import { mixStories, normaliseMix, DEFAULT_MIX } from '../lib/mix.js'
import { StrandBadge, StoryImage } from '../components.jsx'
import { ago } from '../lib/time.js'
import { loadPrefs, savePrefs } from '../lib/prefs.js'
import { ChartStrip } from '../ui/ChartStrip.jsx'

function WatchTile({ feed }) {
  const next = feed.stories.slice(0, 4)
  return (
    <a href="/watch" className="b-watch-tile">
      <div className="b-watch-bg" aria-hidden="true">
        {next.map((s, i) => <span key={s.id} style={{ '--strand': STRANDS[s.strand].color, '--i': i }}>{s.headline}</span>)}
      </div>
      <div className="b-watch-copy">
        <span className="b-live"><span className="dot" />Live now</span>
        <strong>Watch Gossip Genie</strong>
        <span className="b-watch-next">Up next: {feed.stories[0]?.headline}</span>
      </div>
      <span className="b-watch-play" aria-hidden="true">▶</span>
    </a>
  )
}

function TodayCounter({ feed }) {
  const total = feed.counts?.total ?? feed.stories.length
  return (
    <div className="b-today">
      <div className="b-today-num"><b>{Math.min(total, 99)}</b><span>/ {DAILY_TARGET}</span></div>
      <div className="b-today-copy">
        <strong>stories in the last 24 hours</strong>
        <div className="b-pips">
          {STRAND_KEYS.map((k) => (
            <span key={k} style={{ '--strand': STRANDS[k].color }}>
              <i />{STRANDS[k].short} {feed.counts?.[k] ?? feed.stories.filter((s) => s.strand === k).length}
            </span>
          ))}
        </div>
        <em>New stories land at 6am, noon and 5pm Pacific</em>
      </div>
    </div>
  )
}

export function StoryCard({ story, followed }) {
  return (
    <a href={`/story/${story.id}`} className={`b-card${followed ? ' followed' : ''}`} style={{ '--strand': STRANDS[story.strand].color }}>
      <StoryImage story={story} variant="card" />
      <div className="b-card-body">
        <div className="b-card-meta"><StrandBadge strand={story.strand} /><span>{ago(story.publishedAt)}</span></div>
        <h3>{story.headline}</h3>
        <p>{story.caption}</p>
        {story.whyTrending && <div className="b-why">Why it’s buzzing: {story.whyTrending}</div>}
      </div>
    </a>
  )
}

export default function Home({ feed, strand }) {
  const [prefs, setPrefs] = useState(loadPrefs)
  const active = STRANDS[strand] ? strand : 'all'
  const mix = normaliseMix(prefs.mix)
  /*
   * The tab is a filter and the mix is a lean, so they compose rather than
   * compete: on one strand the tab has already answered the question and the
   * mix has nothing left to weigh.
   */
  const list = active === 'all'
    ? mixStories(feed.stories, mix)
    : feed.stories.filter((s) => s.strand === active)
  const isFollowed = (s) => prefs.follows.includes(`strand:${s.strand}`) || (s.people || []).some((p) => prefs.follows.includes(`person:${p}`))
  const ordered = [...list.filter(isFollowed), ...list.filter((s) => !isFollowed(s))]

  const setMix = (next) => {
    const p = { ...prefs, mix: normaliseMix(next) }
    setPrefs(p)
    savePrefs(p)
  }

  const counts = Object.fromEntries(
    STRAND_KEYS.map((k) => [k, feed.stories.filter((s) => s.strand === k).length]),
  )

  const toggleStrand = (k) => {
    const key = `strand:${k}`
    const follows = prefs.follows.includes(key) ? prefs.follows.filter((f) => f !== key) : [...prefs.follows, key]
    const next = { ...prefs, follows }
    setPrefs(next); savePrefs(next)
  }

  return (
    <div className="b-wrap b-home">
      {/* The chart leads. It is the one thing here nobody else publishes, and
          for most of this app's life it was a tab. */}
      <ChartStrip />

      <section className="b-hero-row">
        <WatchTile feed={feed} />
        <TodayCounter feed={feed} />
      </section>

      <nav className="b-tabs" aria-label="Choose a topic">
        <a href="/" className={active === 'all' ? 'on' : ''}>All stories</a>
        {STRAND_KEYS.map((k) => (
          <a key={k} href={`/strand/${k}`} className={active === k ? 'on' : ''} style={{ '--strand': STRANDS[k].color }}>
            <span aria-hidden="true">{STRANDS[k].icon}</span>{STRANDS[k].label}
          </a>
        ))}
      </nav>

      {active !== 'all' && (
        <button className={`b-follow${prefs.follows.includes(`strand:${active}`) ? ' on' : ''}`} onClick={() => toggleStrand(active)}>
          {prefs.follows.includes(`strand:${active}`) ? '✓ Following' : '+ Follow'} {STRANDS[active].label}
        </button>
      )}

      {/* Under the tabs, because the tab is the blunt question and this is
          the one most people actually mean. Only where there is a mix to
          make: on a single strand the tab has already decided. */}
      {active === 'all' && <MixSliders mix={mix} onChange={setMix} counts={counts} />}

      <section className="b-grid">
        {ordered.map((s) => <StoryCard key={s.id} story={s} followed={isFollowed(s)} />)}
        {!ordered.length && <p className="b-empty">No {STRANDS[active]?.label} stories yet today — check back after the next update.</p>}
      </section>

      <a href="/quiz" className="b-quiz-tile">
        <strong>Genie Quiz</strong>
        <span>Five questions sparked by today’s stories — how much do you really know? Keep your streak going.</span>
        <b>Play ▶</b>
      </a>
    </div>
  )
}
