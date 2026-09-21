/**
 * The daily quiz — separate from the stories, but always about them.
 *
 * After a run publishes, Claude writes a set of multiple-choice questions from
 * the last day's stories. They go one step beyond what the story said: the
 * science behind a fact, the place, the record, the film or song — so the
 * viewer has to think, not just remember the caption they saw ten seconds ago.
 *
 * Because questions lean on general knowledge, a second, separate pass checks
 * every marked answer. Anything it is not sure of is dropped.
 */
import { ANTHROPIC_URL, DEFAULT_MODEL } from './config.mjs'
import { parseModelJson } from './writer.mjs'
import { checkText } from './safety.mjs'

export const QUIZ_SIZE = 6
export const QUIZ_MAX_AGE_HOURS = 8

export const QUIZ_PROMPT = `You write the quiz for Gossip Genie, a family-friendly entertainment and curiosity channel. Children watch.

You get today's published stories. Write ${QUIZ_SIZE} multiple-choice questions for viewers to answer in the comments.

Rules:
1. Every question must be clearly connected to one of the stories, and say which (storyId).
2. Do NOT simply ask back the headline fact. Go one step broader: the science or history behind it, the place, the animal, the record, the show, film or song involved, or a "which of these is also true" style question.
3. Anything beyond the story itself must be well-established, textbook-level knowledge that no reasonable source disputes. If you are not completely sure, base the question on the story instead.
4. Exactly 4 options, short (max 5 words each), one clearly correct, three plausible but clearly wrong. No "all of the above", no trick wording.
5. Nothing about real people's relationships, bodies, health, money, age, legal matters or private lives. Questions about their work (films, songs, shows, awards) are fine.
6. Mix the topics: use as many different stories as you can.
7. "explanation" is the reward when the answer is revealed: one fun, friendly sentence, max 25 words, that says why the answer is right.

Return ONLY JSON:
{"questions":[{"storyId":"...","question":"max 16 words, ends with ?","options":["...","...","...","..."],"answer":0,"explanation":"..."}]}
"answer" is the index (0–3) of the correct option.`

export const VERIFY_PROMPT = `You are a strict fact-checker for a children's quiz. For each question, decide whether the marked answer is definitely correct AND the only correct option, using the story text given and well-established knowledge. If there is any doubt, reject it.

Return ONLY JSON: {"results":[{"i":0,"ok":true|false,"reason":"short"}]}`

async function callClaude(system, user, { apiKey, model, workspaceId, fetchImpl, maxTokens = 2000 }) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  const headers = { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
  if (workspaceId) headers['anthropic-workspace-id'] = workspaceId
  const res = await fetchImpl(ANTHROPIC_URL, {
    method: 'POST', headers,
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0.5, system, messages: [{ role: 'user', content: user }] }),
  })
  if (!res.ok) throw new Error(`quiz writer HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  return parseModelJson((data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''))
}

export function storiesForQuiz(stories, now = Date.now()) {
  const recent = stories.filter((s) => now - Date.parse(s.publishedAt) <= 36 * 3600000)
  return (recent.length >= 4 ? recent : stories).slice(0, 24)
}

const briefing = (stories) => stories.map((s) =>
  `[${s.id}] (${s.strand}) ${s.headline}\n${s.body}\nFacts: ${(s.keyFacts || []).join('; ')}`).join('\n\n')

/** Shape, length and safety. Returns the cleaned question or null. */
export function cleanQuestion(q, storiesById) {
  if (!q || typeof q.question !== 'string' || !Array.isArray(q.options) || q.options.length !== 4) return null
  const answer = Number(q.answer)
  if (!Number.isInteger(answer) || answer < 0 || answer > 3) return null
  const story = storiesById.get(q.storyId)
  if (!story) return null
  const options = q.options.map((o) => String(o).trim())
  if (options.some((o) => !o || o.split(/\s+/).length > 6) || new Set(options.map((o) => o.toLowerCase())).size !== 4) return null
  const question = q.question.trim()
  if (question.split(/\s+/).length > 20) return null
  const explanation = String(q.explanation || '').trim()
  if (!explanation || explanation.split(/\s+/).length > 32) return null
  for (const text of [question, explanation, ...options]) if (!checkText(text, story.strand).ok) return null
  // Asking back the headline word for word is exactly what this quiz is not for.
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '')
  if (norm(question).includes(norm(story.headline))) return null
  return { storyId: story.id, strand: story.strand, headline: story.headline, question, options, answer, explanation }
}

/**
 * @returns {Promise<{generatedAt:string, questions:object[], dropped:number}>}
 */
export async function buildQuiz(stories, { now = new Date(), fetchImpl = fetch, env = process.env, log } = {}) {
  const opts = { apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || DEFAULT_MODEL, workspaceId: env.ANTHROPIC_WORKSPACE_ID, fetchImpl }
  const pool = storiesForQuiz(stories, now.getTime())
  if (pool.length < 2) throw new Error('not enough stories for a quiz')
  const byId = new Map(pool.map((s) => [s.id, s]))

  const draft = await callClaude(QUIZ_PROMPT, `Today's stories:\n\n${briefing(pool)}`, opts)
  const cleaned = (draft.questions || []).map((q) => cleanQuestion(q, byId)).filter(Boolean)
  if (!cleaned.length) throw new Error('quiz writer returned no usable questions')

  const check = await callClaude(VERIFY_PROMPT, cleaned.map((q, i) => {
    const s = byId.get(q.storyId)
    return `#${i}\nStory: ${s.headline} — ${s.body}\nQ: ${q.question}\nOptions: ${q.options.map((o, k) => `${'ABCD'[k]}) ${o}`).join('  ')}\nMarked answer: ${'ABCD'[q.answer]}`
  }).join('\n\n'), { ...opts, maxTokens: 1200 })
  const okSet = new Set((check.results || []).filter((r) => r.ok === true).map((r) => Number(r.i)))
  const questions = cleaned.filter((_, i) => okSet.has(i))
  log?.push(`quiz: ${draft.questions?.length || 0} written, ${cleaned.length} passed checks, ${questions.length} confirmed by the fact-check`)
  if (!questions.length) throw new Error('fact-check confirmed no questions')
  return {
    generatedAt: now.toISOString(),
    questions: questions.map((q, i) => ({ id: `${now.toISOString().slice(0, 13)}-q${i}`, ...q })),
    dropped: (draft.questions?.length || 0) - questions.length,
  }
}

export const quizIsStale = (quiz, now = Date.now()) => !quiz?.questions?.length || now - Date.parse(quiz.generatedAt) > QUIZ_MAX_AGE_HOURS * 3600000
