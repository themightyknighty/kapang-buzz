import { useState } from 'react'
import { STRANDS } from '../lib/strands.js'
import { StrandBadge, StoryImage } from '../components.jsx'
import { StoryCard } from './Home.jsx'
import { ago } from '../lib/time.js'
import { loadPrefs, savePrefs } from '../lib/prefs.js'
import { Share } from '../ui/Share.jsx'
import { storyShare } from '../lib/share.js'
import { ChartPlace } from '../ui/ChartPlace.jsx'
import { MarketRate } from '../ui/MarketRate.jsx'

function Report({ id, sample }) {
  const [state, setState] = useState('idle') // idle | open | sent | error
  const [reason, setReason] = useState('')
  const send = async () => {
    if (sample) { setState('sent'); return }
    try {
      const res = await fetch('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, reason }) })
      setState(res.ok ? 'sent' : 'error')
    } catch { setState('error') }
  }
  if (state === 'sent') return <p className="b-report-done">Thanks — we’ll take a look.</p>
  if (state === 'idle') return <button className="b-report" onClick={() => setState('open')}>Report a problem</button>
  return (
    <div className="b-report-box">
      <label htmlFor="reason">What’s wrong with this story?</label>
      <textarea id="reason" rows="3" maxLength="300" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div><button onClick={send}>Send report</button><button className="ghost" onClick={() => setState('idle')}>Cancel</button></div>
      {state === 'error' && <p className="b-err">Couldn’t send that — please try again.</p>}
    </div>
  )
}

export default function Story({ feed, market = null, id }) {
  const story = feed.stories.find((s) => s.id === id)
  const [prefs, setPrefs] = useState(loadPrefs)
  if (!story) return <div className="b-wrap b-empty">That story is no longer in the feed. <a href="/">See today’s stories</a></div>

  const more = feed.stories.filter((s) => s.id !== story.id && s.strand === story.strand).slice(0, 3)
  const togglePerson = (p) => {
    const key = `person:${p}`
    const follows = prefs.follows.includes(key) ? prefs.follows.filter((f) => f !== key) : [...prefs.follows, key]
    const next = { ...prefs, follows }; setPrefs(next); savePrefs(next)
  }

  return (
    <article className="b-wrap b-story" style={{ '--strand': STRANDS[story.strand].color }}>
      <div className="b-story-top">
        <a href="/" className="b-back">← All stories</a>
        <Share {...storyShare(story)} tone={STRANDS[story.strand].color} />
      </div>
      <div className="b-story-meta"><StrandBadge strand={story.strand} big /><span>Updated {ago(story.publishedAt)}</span></div>
      <h1>{story.headline}</h1>
      <p className="b-lede">{story.caption}</p>
      <StoryImage story={story} variant="story" />

      <div className="b-story-cols">
        <div>
          <p className="b-body">{story.body}</p>
          {story.strand === 'health' && <p className="b-disclaimer">General information, not medical advice.</p>}
          {/* The return leg: the market has always linked out to stories,
              and until now nothing linked back. */}
          <ChartPlace people={story.people} />
          {/* The other half of the return leg: where they sit on the chart,
              and what they are worth on the market as you read this. */}
          <MarketRate people={story.people} market={market} />
          {story.people?.length > 0 && (
            <div className="b-people">
              {story.people.map((p) => (
                <button key={p} className={prefs.follows.includes(`person:${p}`) ? 'on' : ''} onClick={() => togglePerson(p)}>
                  {prefs.follows.includes(`person:${p}`) ? '✓' : '+'} {p}
                </button>
              ))}
            </div>
          )}
        </div>
        <aside>
          <h2>Key facts</h2>
          <ol className="b-facts">{story.keyFacts.map((f) => <li key={f}>{f}</li>)}</ol>
          {story.whyTrending && <><h2>Why it’s buzzing</h2><p>{story.whyTrending}</p></>}
          <h2>Sources</h2>
          <ul className="b-sources">
            {story.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a></li>)}
          </ul>
          <p className="b-small">Reported by {story.outlets} outlet{story.outlets === 1 ? '' : 's'}. Written by Gossip Genie in its own words.</p>
          <Report id={story.id} sample={feed.sample} />
        </aside>
      </div>

      {/* The second one is the one that gets used: people decide to pass a
          story on once they have finished reading it, not before. */}
      <div className="b-story-end">
        <p>Know someone who’d like this?</p>
        <Share {...storyShare(story)} tone={STRANDS[story.strand].color} label="Share this story" />
      </div>

      {more.length > 0 && (
        <section className="b-more">
          <h2>More {STRANDS[story.strand].label}</h2>
          <div className="b-grid">{more.map((s) => <StoryCard key={s.id} story={s} />)}</div>
        </section>
      )}
    </article>
  )
}
