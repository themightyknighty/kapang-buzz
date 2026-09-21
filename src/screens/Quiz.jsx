import { useMemo, useState } from 'react'
import { StrandBadge } from '../components.jsx'
import { loadPrefs, savePrefs } from '../lib/prefs.js'

const today = () => new Date().toISOString().slice(0, 10)
const LETTERS = ['A', 'B', 'C', 'D']

/** Same questions, same order, for everyone on the same day. */
function seeded(list, day, n) {
  let seed = [...day].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  return list.map((x) => [rand(), x]).sort((a, b) => a[0] - b[0]).slice(0, n).map(([, x]) => x)
}

/**
 * Today's questions. The daily Genie Quiz when there is one; otherwise the
 * older true-or-false statements attached to stories, shaped the same way.
 */
export function pickQuiz(feed, day = today(), n = 5) {
  const mc = feed.quiz?.questions || []
  if (mc.length) return seeded(mc, day, n)
  return seeded(feed.stories.filter((s) => s.quiz?.statement), day, n).map((s) => ({
    id: s.id, storyId: s.id, strand: s.strand, headline: s.headline, question: `True or false? ${s.quiz.statement}`,
    options: ['True', 'False'], answer: s.quiz.answer ? 0 : 1, explanation: s.caption,
  }))
}

export default function Quiz({ feed }) {
  const qs = useMemo(() => pickQuiz(feed), [feed])
  const [i, setI] = useState(0)
  const [picked, setPicked] = useState(null)
  const [score, setScore] = useState(0)
  const [prefs, setPrefs] = useState(loadPrefs)

  if (!qs.length) return <div className="b-wrap b-empty">Today’s Genie Quiz appears once stories are published.</div>

  if (i >= qs.length) {
    return (
      <div className="b-wrap b-quiz done">
        <h1>You scored {score} / {qs.length}</h1>
        <p className="b-lede">{score === qs.length ? 'Perfect! The Genie is impressed.' : score >= Math.ceil(qs.length / 2) ? 'Great work — new questions arrive with the next stories.' : 'Catch up on today’s stories and try again tomorrow.'}</p>
        <p className="b-streak">Daily streak: <b>{prefs.quizStreak}</b> · Best score: <b>{prefs.quizBest}</b></p>
        <a className="b-btn" href="/">Back to stories</a>
      </div>
    )
  }

  const q = qs[i]
  const answer = (k) => {
    if (picked !== null) return
    setPicked(k)
    const nextScore = score + (k === q.answer ? 1 : 0)
    setScore(nextScore)
    if (i === qs.length - 1) {
      const d = today()
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
      const streak = prefs.lastQuizDay === d ? prefs.quizStreak : prefs.lastQuizDay === yesterday ? prefs.quizStreak + 1 : 1
      const next = { ...prefs, quizStreak: streak, lastQuizDay: d, quizBest: Math.max(prefs.quizBest, nextScore) }
      setPrefs(next); savePrefs(next)
    }
  }

  return (
    <div className="b-wrap b-quiz">
      <div className="b-quiz-top"><span>Question {i + 1} of {qs.length}</span><span>Score {score}</span></div>
      <StrandBadge strand={q.strand} big />
      <p className="b-quiz-from">From the story: <a href={`/story/${q.storyId}`}>{q.headline}</a></p>
      <h1 className="b-quiz-q">{q.question}</h1>
      <div className={`b-quiz-mc${q.options.length === 2 ? ' two' : ''}`}>
        {q.options.map((o, k) => (
          <button key={k} onClick={() => answer(k)}
            className={picked === null ? '' : k === q.answer ? 'right' : picked === k ? 'wrong' : 'dim'}>
            <i>{LETTERS[k]}</i><span>{o}</span>
          </button>
        ))}
      </div>
      {picked !== null && (
        <div className="b-quiz-reveal">
          <p className="b-quiz-verdict">{picked === q.answer ? '🎉 Correct!' : `Not quite — it’s ${LETTERS[q.answer]}, ${q.options[q.answer]}.`}</p>
          <p>{q.explanation}</p>
          <button className="b-btn" onClick={() => { setI(i + 1); setPicked(null) }}>{i === qs.length - 1 ? 'See your score' : 'Next question →'}</button>
        </div>
      )}
    </div>
  )
}
