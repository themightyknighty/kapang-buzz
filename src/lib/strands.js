/** Strand identity, shared by the app and the Watch screen. */
export const STRANDS = {
  celebrity: { label: 'Celebrity Gossip', short: 'Celebrity', color: '#FF5FA2', icon: '★' },
  health:    { label: 'Health',           short: 'Health',    color: '#3DDC97', icon: '♥' },
  facts:     { label: 'Fantastic Facts',  short: 'Facts',     color: '#FFC145', icon: '✦' },
  bizarre:   { label: 'Bizarre News',     short: 'Bizarre',   color: '#A77BFF', icon: '?' },
}
export const STRAND_KEYS = Object.keys(STRANDS)
export const DAILY_TARGET = 30
