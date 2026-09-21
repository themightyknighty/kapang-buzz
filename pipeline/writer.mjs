/**
 * Step 5 — Gossip Genie writes the story.
 *
 * The model gets the headlines and short published summaries of every outlet
 * in the cluster, and must report ONLY what they agree on, in our own words.
 * It also gives a family-safety verdict; a "no" drops the story.
 */
import { ANTHROPIC_URL, DEFAULT_MODEL, STRANDS } from './config.mjs'

export const SYSTEM_PROMPT = `You are the writer for Gossip Genie, a family-friendly entertainment and curiosity news channel that plays on TV screens and phones. Your audience includes children.

Write ONE story from the source material. Rules — these are hard constraints:
1. Report only facts that the sources state. For Celebrity Gossip, only facts stated by at least two different outlets, or by the celebrity/their representative directly. For Health, Fantastic Facts and Bizarre News, one source is enough: it has already been checked as an official body or an established news or science organisation, so do not reject a story for having a single source. Never add details, numbers, dates or quotes that are not in the sources.
2. Write entirely in your own words. Never copy a sentence or distinctive phrase from a source. Any direct quote must be under 12 words, attributed, and must be a public statement by the person themselves.
3. Warm, upbeat, kind. No sarcasm about real people, no speculation, no rumours, no "sources say", nothing about relationships ending, bodies, weight, health conditions of named people, legal trouble, alcohol, drugs, sex, violence or death.
4. Plain language a 10-year-old can follow. Explain any jargon or remove it.
5. Health stories give general information only and must not tell anyone to start or stop a treatment.
6. If the material cannot meet these rules, set "familySafe" to false and explain why in "safetyNote". Being cautious is correct.
7. Always return every key below. If "familySafe" is false you may leave the other text fields as empty strings.

Return ONLY a JSON object, no prose, with exactly these keys:
{
  "familySafe": true|false,
  "safetyNote": "one short sentence",
  "headline": "max 8 words, no clickbait, no question marks",
  "caption": "max 25 words for the TV lower third",
  "body": "60-90 words for the app story page",
  "keyFacts": ["3 short facts, max 10 words each"],
  "whyTrending": "max 14 words: why people are talking about this today",
  "people": ["full names of the famous people the story is mainly about, most important first, max 2, or empty"],
  "imageQuery": "2-4 words to search a public-domain photo library for an illustrative image (not a person)",
  "bigNumber": {"value": "a striking number from the sources, or empty string", "label": "what it counts, max 5 words"},
  "chatPrompt": {"question": "a fun, light question viewers will want to answer in the comments, max 12 words, about THEIR opinion or experience, never asking them to judge a real person's looks, relationships or private life", "a": "short answer option A, max 4 words", "b": "short answer option B, max 4 words"}
}`

export function buildUserPrompt(cluster) {
  const lines = [
    `Strand: ${STRANDS[cluster.strand].label}`,
    `Number of independent outlets: ${new Set(cluster.domains).size}`,
    '',
    'Sources:',
  ]
  cluster.items.slice(0, 6).forEach((it, i) => {
    lines.push(`[${i + 1}] ${it.domain}${it.publicDomain ? ' (US government, public domain)' : ''}`)
    lines.push(`Headline: ${it.title}`)
    if (it.summary) lines.push(`Summary: ${it.summary.slice(0, it.publicDomain ? 3000 : 400)}`)
    lines.push('')
  })
  return lines.join('\n')
}

/** Pull the first JSON object out of a model reply, tolerating code fences. */
export function parseModelJson(text) {
  const s = String(text || '').replace(/```(?:json)?/gi, '')
  const start = s.indexOf('{'), end = s.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('writer returned no JSON')
  return JSON.parse(s.slice(start, end + 1))
}

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length

/** Shape and length checks. Returns a list of problems; empty means valid. */
export function validateDraft(d) {
  const p = []
  if (typeof d.familySafe !== 'boolean') p.push('familySafe missing')
  if (!d.headline || words(d.headline) > 10) p.push('headline missing or too long')
  if (!d.caption || words(d.caption) > 32) p.push('caption missing or too long')
  if (!d.body || words(d.body) < 30 || words(d.body) > 130) p.push('body length out of range')
  if (!Array.isArray(d.keyFacts) || d.keyFacts.length < 2) p.push('keyFacts missing')
  return p
}

/**
 * Does the draft lift wording from a source? Any run of 8+ consecutive words
 * shared with a source summary or headline counts as copying.
 */
export function copiesSource(draft, cluster, run = 8) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  const grams = new Set()
  for (const it of cluster.items) {
    if (it.publicDomain) continue // government text is ours to use; we still rewrite, but it is not a breach
    for (const src of [it.title, it.summary]) {
      const w = norm(src)
      for (let i = 0; i + run <= w.length; i++) grams.add(w.slice(i, i + run).join(' '))
    }
  }
  const mine = norm([draft.headline, draft.caption, draft.body].join(' '))
  for (let i = 0; i + run <= mine.length; i++) if (grams.has(mine.slice(i, i + run).join(' '))) return true
  return false
}

export async function writeStory(cluster, {
  apiKey = process.env.ANTHROPIC_API_KEY, model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
  workspaceId = process.env.ANTHROPIC_WORKSPACE_ID, fetchImpl = fetch,
} = {}) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  const headers = { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
  // Keys not scoped to a workspace must name one on every request.
  if (workspaceId) headers['anthropic-workspace-id'] = workspaceId
  const res = await fetchImpl(ANTHROPIC_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model, max_tokens: 1200, temperature: 0.4,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(cluster) }],
    }),
  })
  if (!res.ok) throw new Error(`writer HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')
  return parseModelJson(text)
}
