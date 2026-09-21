/**
 * Gossip Genie — the editorial constants.
 *
 * Everything a producer might want to change without touching logic lives
 * here: the strands and their daily quota, the run times, where stories are
 * found, and which image licences we accept.
 */

export const UA = 'GossipGenie/0.1 (a Genie app; contact simon@knightvisionstudios.tv)'

/** 30 a day: 12 celebrity, 6 each of the rest. Three runs share it out. */
export const STRANDS = {
  celebrity: { label: 'Celebrity Gossip', short: 'Celebrity', perDay: 12 },
  health:    { label: 'Health',           short: 'Health',    perDay: 6 },
  facts:     { label: 'Fantastic Facts',  short: 'Facts',     perDay: 6 },
  bizarre:   { label: 'Bizarre News',     short: 'Bizarre',   perDay: 6 },
}
export const STRAND_KEYS = Object.keys(STRANDS)
export const RUNS_PER_DAY = 3

/** How long a story stays in the feed, and the most the feed holds. */
export const FEED_WINDOW_HOURS = 72
export const FEED_MAX = 120
/** A cluster we have already covered is not covered again for this long. */
export const SEEN_DAYS = 7

/* ------------------------------------------------------------------
   Where stories are FOUND.

   GDELT gives headlines and links only. We never republish a publisher's
   words or pictures: those sources are for discovery and verification, and
   the writer produces Gossip Genie's own copy from the facts they agree on.

   Domains are deliberately mainstream. Tabloids are left out on purpose —
   they are where unverified gossip starts.
   ------------------------------------------------------------------ */
const domains = (list) => '(' + list.map((d) => `domainis:${d}`).join(' OR ') + ')'

export const GDELT_DOC_API = 'https://api.gdeltproject.org/api/v2/doc/doc'
/** GDELT's own limit is one request every five seconds. */
export const GDELT_GAP_MS = 8000

export const GDELT_QUERIES = {
  celebrity: {
    q: '(actress OR actor OR singer OR "pop star" OR premiere OR "red carpet" OR album OR engaged OR "baby") sourcelang:english '
      + domains(['people.com', 'eonline.com', 'variety.com', 'hollywoodreporter.com', 'billboard.com', 'ew.com',
        'etonline.com', 'usmagazine.com', 'deadline.com', 'rollingstone.com', 'today.com', 'apnews.com', 'bbc.co.uk', 'bbc.com']),
    timespan: '12h', max: 75,
  },
  health: {
    q: '(study OR researchers OR scientists) (sleep OR diet OR exercise OR heart OR brain OR walking OR vitamin OR nutrition) sourcelang:english '
      + domains(['nih.gov', 'sciencedaily.com', 'medicalxpress.com', 'health.harvard.edu', 'bbc.co.uk', 'bbc.com', 'apnews.com', 'cnn.com', 'npr.org']),
    timespan: '24h', max: 50,
  },
  facts: {
    q: '(discovered OR discovery OR scientists OR astronomers OR fossil OR species) sourcelang:english '
      + domains(['smithsonianmag.com', 'nationalgeographic.com', 'livescience.com', 'space.com', 'sciencenews.org', 'phys.org', 'nasa.gov', 'bbc.co.uk', 'bbc.com', 'newscientist.com']),
    timespan: '24h', max: 50,
  },
  bizarre: {
    q: '("world record" OR bizarre OR quirky OR unusual OR "odd news" OR strange) sourcelang:english '
      + domains(['upi.com', 'apnews.com', 'guinnessworldrecords.com', 'bbc.co.uk', 'bbc.com', 'cbsnews.com', 'npr.org', 'wral.com']),
    timespan: '24h', max: 50,
  },
}

/**
 * RSS feeds. `publicDomain: true` marks US-government sources whose text we
 * may lawfully draw on directly (still rewritten, still credited). Everything
 * else is discovery only. A feed that dies shows up as 0 items in /api/status.
 */
export const RSS_FEEDS = [
  // US government — public domain, and a single report is enough
  { id: 'nasa-news',   strand: 'facts',     url: 'https://www.nasa.gov/news-release/feed/', publicDomain: true, credit: 'NASA' },
  { id: 'nasa-iotd',   strand: 'facts',     url: 'https://www.nasa.gov/feeds/iotd-feed',    publicDomain: true, credit: 'NASA' },
  { id: 'nih-news',    strand: 'health',    url: 'https://www.nih.gov/news-releases/feed.xml', publicDomain: true, credit: 'National Institutes of Health' },
  { id: 'nih-nih',     strand: 'health',    url: 'https://newsinhealth.nih.gov/rss',        publicDomain: true, credit: 'NIH News in Health' },
  { id: 'fda-press',   strand: 'health',    url: 'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml', publicDomain: true, credit: 'US Food and Drug Administration' },

  // Discovery only: headlines and links. Never republished; used to find and cross-check stories.
  { id: 'variety',     strand: 'celebrity', url: 'https://variety.com/feed/' },
  { id: 'deadline',    strand: 'celebrity', url: 'https://deadline.com/feed/' },
  { id: 'thr',         strand: 'celebrity', url: 'https://www.hollywoodreporter.com/feed/' },
  { id: 'billboard',   strand: 'celebrity', url: 'https://www.billboard.com/feed/' },
  { id: 'usweekly',    strand: 'celebrity', url: 'https://www.usmagazine.com/feed/' },
  { id: 'rollingstone',strand: 'celebrity', url: 'https://www.rollingstone.com/feed/' },
  { id: 'eonline',     strand: 'celebrity', url: 'https://www.eonline.com/syndication/feeds/rssfeeds/topstories.xml' },
  { id: 'bbc-ent',     strand: 'celebrity', url: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml' },
  { id: 'abc-ent',     strand: 'celebrity', url: 'https://feeds.abcnews.com/abcnews/entertainmentheadlines' },
  { id: 'cbs-ent',     strand: 'celebrity', url: 'https://www.cbsnews.com/latest/rss/entertainment' },
  { id: 'sky-ent',     strand: 'celebrity', url: 'https://feeds.skynews.com/feeds/rss/entertainment.xml' },
  { id: 'nme',         strand: 'celebrity', url: 'https://www.nme.com/news/feed' },
  { id: 'guardian-culture', strand: 'celebrity', url: 'https://www.theguardian.com/culture/rss' },
  { id: 'independent-ent', strand: 'celebrity', url: 'https://www.independent.co.uk/arts-entertainment/rss' },

  { id: 'sd-health',   strand: 'health',    url: 'https://www.sciencedaily.com/rss/health_medicine.xml' },
  { id: 'medxpress',   strand: 'health',    url: 'https://medicalxpress.com/rss-feed/' },
  { id: 'npr-health',  strand: 'health',    url: 'https://feeds.npr.org/1128/rss.xml' },
  { id: 'bbc-health',  strand: 'health',    url: 'https://feeds.bbci.co.uk/news/health/rss.xml' },

  { id: 'sd-science',  strand: 'facts',     url: 'https://www.sciencedaily.com/rss/top/science.xml' },
  { id: 'physorg',     strand: 'facts',     url: 'https://phys.org/rss-feed/' },
  { id: 'livescience', strand: 'facts',     url: 'https://www.livescience.com/feeds/all' },
  { id: 'space',       strand: 'facts',     url: 'https://www.space.com/feeds/all' },
  { id: 'bbc-science', strand: 'facts',     url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml' },

  { id: 'upi-odd',     strand: 'bizarre',   url: 'https://rss.upi.com/news/odd_news.rss', credit: 'UPI' },
  { id: 'sd-offbeat',  strand: 'bizarre',   url: 'https://www.sciencedaily.com/rss/strange_offbeat.xml' },
].map((f) => ({ publicDomain: false, ...f }))

/**
 * Established news and science organisations whose single report is enough
 * for Health, Facts and Bizarre. Never used for Celebrity, which always needs
 * two independent outlets.
 */
export const TRUSTED_SINGLE_SOURCE = {
  health:  ['bbc.co.uk', 'bbc.com', 'npr.org', 'sciencedaily.com', 'medicalxpress.com'],
  facts:   ['bbc.co.uk', 'bbc.com', 'npr.org', 'sciencedaily.com', 'phys.org', 'livescience.com', 'space.com'],
  bizarre: ['upi.com', 'skynews.com', 'sciencedaily.com', 'phys.org', 'bbc.co.uk', 'bbc.com'],
}

/** Official sources a single report is enough from. */
export const OFFICIAL_DOMAINS = ['nasa.gov', 'nih.gov', 'cdc.gov', 'fda.gov', 'noaa.gov', 'usgs.gov', 'si.edu', 'smithsonianmag.com']

/* ------------------------------------------------------------------
   Images. Only these licences are ever shown. Anything else — including
   "unknown" — falls back to a typographic card.
   ------------------------------------------------------------------ */
export const ACCEPTED_LICENCES = [
  /^cc0/i, /^public domain/i, /^pd/i, /^cc by(-sa)? ?[1-4]\.[0-9]/i, /^cc by(-sa)?$/i, /^cc-by(-sa)?-[1-4]\.[0-9]/i,
]

/** The writer. Set ANTHROPIC_API_KEY on the site; override the model with ANTHROPIC_MODEL. */
export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
export const DEFAULT_MODEL = 'claude-sonnet-4-5'
