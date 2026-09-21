/** Per-viewer conveniences only. Every read and write survives storage being blocked. */
const KEY = 'gossip-genie-prefs'
export function loadPrefs() {
  try { return { follows: [], quizBest: 0, quizStreak: 0, lastQuizDay: null, ...JSON.parse(localStorage.getItem(KEY) || '{}') } }
  catch { return { follows: [], quizBest: 0, quizStreak: 0, lastQuizDay: null } }
}
export function savePrefs(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* private mode */ }
}
