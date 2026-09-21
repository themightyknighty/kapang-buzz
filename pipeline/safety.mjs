/**
 * The family-friendly gate.
 *
 * Auto-publish means nobody reads a story before it airs, so this runs twice:
 * on the source headlines before anything is written, and again on Gossip Genie's
 * finished copy. The writer model gives its own verdict in between. A story
 * has to pass all three.
 *
 * Deliberately blunt. A blocked good story costs one slot; an aired bad one
 * costs the channel. When in doubt it says no.
 */

/** Blocked for every strand. Word-boundary matched, case-insensitive. */
const ALWAYS = [
  // crime, violence, death
  'arrest(ed|s)?', 'charged', 'indict(ed|ment)?', 'convict(ed|ion)?', 'sentenced', 'jail(ed)?', 'prison', 'police',
  'lawsuit', 'sued', 'suing', 'court', 'on trial', 'custody', 'restraining order',
  'murder(ed|er)?', 'kill(ed|ing|s)?', 'shoot(ing|er)?', 'shot dead', 'stab(bed|bing)?', 'assault(ed)?', 'attack(ed)?',
  'dead', 'death', 'dies', 'died', 'dying', 'funeral', 'obituary', 'passed away', 'tribute to the late', 'remains found',
  'suicide', 'overdose', 'self-harm', 'abuse(d)?', 'rape(d)?', 'harass(ed|ment)?', 'kidnap(ped)?', 'trafficking',
  'war', 'terror(ist|ism)?', 'bomb(ing)?', 'gun(s|man)?', 'weapon', 'hostage',
  // sex, drugs, alcohol, gambling
  'sex(ual|ually|y)?', 'nude', 'naked', 'topless', 'porn', 'onlyfans', 'explicit', 'lingerie', 'steamy', 'raunchy',
  'affair', 'cheat(ed|ing)?', 'hookup', 'drunk', 'alcohol(ic)?', 'vodka', 'beer', 'wine', 'cocaine', 'heroin', 'fentanyl',
  'marijuana', 'cannabis', 'weed', 'vape', 'vaping', 'rehab', 'addiction', 'casino', 'betting', 'gambl(e|ing)',
  // cruelty and body shaming
  'feud', 'slam(s|med)?', 'blast(s|ed)?', 'meltdown', 'humiliat(ed|ing)', 'fat', 'ugly', 'body-?sham(e|ing)',
  // politics
  'trump', 'biden', 'election', 'gaza', 'israel(i)?', 'palestin(e|ian|ians)', 'netanyahu', 'hamas', 'genocide', 'ukraine', 'russia(n)?',
  'politician(s)?', 'legislation', 'legislative', 'lawmaker(s)?', 'humanitarian crisis', 'refugee(s)?', 'protest(s|ers)?', 'democrat(s|ic)?', 'republican(s)?', 'congress', 'senator', 'maga', 'abortion',
]

/** Extra blocks per strand. */
const BY_STRAND = {
  celebrity: [
    'divorc(e|ed|ing)', 'split(s)?', 'break-?up', 'breaks up', 'dumped', 'rumou?r(s|ed)?', 'allegedly', 'alleged', 'claims',
    'insiders?', 'sources say', 'reportedly', 'pregnan(t|cy) rumou?rs?', 'hospitali[sz]ed', 'diagnos(is|ed)', 'cancer',
    'surgery', 'weight loss', 'ozempic', 'plastic surgery', 'scandal', 'controvers(y|ial)', 'backlash', 'cancel(l)?ed', 'fired',
  ],
  health: [
    'weight loss', 'ozempic', 'wegovy', 'diet pill', 'detox', 'fasting', 'calorie', 'anorexi(a|c)', 'bulimi(a|c)', 'eating disorder',
    'cancer', 'tumou?r', 'dementia', 'terminal', 'fatal', 'outbreak', 'pandemic', 'mortality', 'recall(ed|s)?', 'contaminat(ed|ion)',
    'miracle cure', 'cures?',
  ],
  facts: ['extinct(ion)? crisis', 'catastroph(e|ic)', 'disaster'],
  bizarre: ['injur(y|ed|ies)', 'hospital', 'crash(ed)?', 'fire', 'blood', 'corpse', 'body found', 'bite(s|n)?', 'mauled'],
}

const compile = (words) => new RegExp(`\\b(?:${words.join('|')})\\b`, 'i')
const ALWAYS_RE = compile(ALWAYS)
const STRAND_RE = Object.fromEntries(Object.entries(BY_STRAND).map(([k, v]) => [k, compile(v)]))

/**
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function checkText(text, strand) {
  const t = String(text || '')
  let m = t.match(ALWAYS_RE)
  if (m) return { ok: false, reason: `blocked word "${m[0]}"` }
  const re = STRAND_RE[strand]
  if (re && (m = t.match(re))) return { ok: false, reason: `blocked for ${strand}: "${m[0]}"` }
  return { ok: true }
}

/** Check every text field of a finished story. */
export function checkStory(story) {
  const fields = [story.headline, story.caption, story.body, story.whyTrending,
    ...(story.keyFacts || []), story.quiz?.statement, story.chatPrompt?.question, story.chatPrompt?.a, story.chatPrompt?.b]
  for (const f of fields) {
    const r = checkText(f, story.strand)
    if (!r.ok) return r
  }
  return { ok: true }
}
