/**
 * Celebrity Attention Index — every tunable number, in one file.
 *
 * The index answers "who is attracting an unusual amount of attention right
 * now?", not "who is most famous?". That distinction is encoded here: the
 * news component is mostly deviation from a celebrity's OWN baseline, and
 * only a little absolute volume.
 *
 * Nothing in market/ may hard-code a weight, threshold or window. Everything
 * lives here, and everything can be overridden by an environment variable so
 * the model can be tuned without a deploy.
 */

/*
 * This file is read by the ingestion run in Node AND imported by the market
 * screens in the browser, where `process` does not exist. Reaching for it
 * unguarded threw at module scope, which took the whole app down before React
 * mounted — invisible in the production build, where the bundler folds the
 * reference away, and fatal in `npm run dev`.
 */
const ENV = typeof process !== 'undefined' && process.env ? process.env : {}

const num = (key, fallback, env = ENV) => {
  const v = Number(env?.[key])
  return Number.isFinite(v) ? v : fallback
}

/** An unset variable means the default; only an explicit word flips it. */
const flag = (key, fallback, env = ENV) => {
  const v = String(env?.[key] ?? '').trim().toLowerCase()
  if (!v) return fallback
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

/* ------------------------------------------------------------------ *
   Scoring
 * ------------------------------------------------------------------ */

/**
 * The three components of the Gossip Score. Must sum to 1 — asserted by a test.
 *
 * Momentum used to be a fourth component at 0.25. It cannot be, because it is
 * a SIGNED quantity folded into an unsigned one: momentum of exactly zero —
 * nothing accelerating at all — scored 50 on that component and therefore
 * handed every celebrity 12.5 points for being alive. For a name with nothing
 * happening that was two thirds of their whole score, which meant the bottom
 * of the chart was ranked largely by a number that means "nothing is
 * happening". It is now a modifier below.
 */
export const WEIGHTS = {
  news: num('MKT_W_NEWS', 0.65),
  wikipedia: num('MKT_W_WIKIPEDIA', 0.20),
  breadth: num('MKT_W_BREADTH', 0.15),
}

/**
 * Momentum as a modifier on the news component.
 *
 * Acceleration should amplify real coverage and damp fading coverage — it
 * should not be able to manufacture a score on its own. So it multiplies the
 * news value rather than adding to the total: a celebrity with no coverage
 * gets no benefit from momentum at all, because there is nothing to multiply,
 * and a celebrity with nothing accelerating is multiplied by exactly 1.
 */
export const MOMENTUM_MODIFIER = {
  /** Momentum at ±100 moves the news component by ±this fraction. */
  gain: num('MKT_MOM_GAIN', 0.25),
  floor: num('MKT_MOM_FLOOR', 0.75),
  ceiling: num('MKT_MOM_CEILING', 1.25),
}

/**
 * Inside the news component: mostly "is this unusual for them", a little
 * "is this big in absolute terms". The absolute term is what keeps a genuine
 * A-lister in a real news cycle above a micro-celebrity having an odd Tuesday.
 */
export const NEWS_MIX = {
  deviation: num('MKT_NEWS_DEVIATION', 0.85),
  absolute: num('MKT_NEWS_ABSOLUTE', 0.15),
}

/**
 * The logistic that maps a z-score to 0-1. Larger k = a gentler curve, so it
 * takes more deviation to reach the top. This is what stops one enormous
 * celebrity permanently owning first place.
 */
export const SQUASH_K = num('MKT_SQUASH_K', 2.5)

/**
 * Deviation alone would crown a nobody: baseline 0.4 mentions, today 6, and
 * the z-score is colossal. Below `floorMentions` the score is heavily damped;
 * by `fullMentions` there is no damping at all.
 */
export const CONFIDENCE = {
  floorMentions: num('MKT_CONF_FLOOR', 5),
  fullMentions: num('MKT_CONF_FULL', 25),
  /** The most a celebrity under the floor can score, as a fraction. */
  floorCap: num('MKT_CONF_FLOOR_CAP', 0.30),
}

/* ------------------------------------------------------------------ *
   Baselines and normalization
 * ------------------------------------------------------------------ */

export const BASELINE = {
  /** The window deviation is measured against. */
  primary: '7d',
  /** Used to notice a celebrity whose whole level has shifted. */
  regime: '30d',
  /** A perfectly flat baseline would divide by zero; this is the floor. */
  madFloor: num('MKT_MAD_FLOOR', 0.35),
  /** Below this many days of history a celebrity is NEW ENTRY. */
  minDaysForOwnBaseline: num('MKT_MIN_BASELINE_DAYS', 7),
}

/** How many snapshots make up each window, at one snapshot per 15 minutes. */
export const WINDOWS = {
  '1h': 4,
  '24h': 96,
  '7d': 7,
  '30d': 30,
}

/** Older coverage counts for less. Half-life in hours. */
export const RECENCY_HALF_LIFE_HOURS = num('MKT_RECENCY_HALF_LIFE', 6)

/* ------------------------------------------------------------------ *
   Momentum
 * ------------------------------------------------------------------ */

export const MOMENTUM = {
  /** Hours in the recent leg and the prior leg of the acceleration comparison. */
  recentHours: num('MKT_MOM_RECENT_H', 3),
  priorHours: num('MKT_MOM_PRIOR_H', 9),
  /** Divides acceleration before tanh. Larger = less twitchy. */
  scale: num('MKT_MOM_SCALE', 0.45),
  /** Momentum is averaged over this many snapshots so one noisy fetch can't flip it. */
  smoothing: num('MKT_MOM_SMOOTHING', 3),
}

/** Labels for the momentum bands, highest first. */
export const MOMENTUM_BANDS = [
  { min: 80, label: 'Exploding' },
  { min: 40, label: 'Rising rapidly' },
  { min: 10, label: 'Gently rising' },
  { min: -9, label: 'Stable' },
  { min: -40, label: 'Cooling' },
  { min: -100, label: 'Collapsing' },
]

/* ------------------------------------------------------------------ *
   Status
 * ------------------------------------------------------------------ */

/**
 * Evaluated in order — the first rule that matches wins. BREAKING needs all
 * three conditions because it is the loudest state in the interface and will
 * eventually drive notifications.
 */
export const STATUS_RULES = [
  { status: 'NEW ENTRY', newEntry: true },
  { status: 'BREAKING', minDeviationPct: num('MKT_BREAK_PCT', 0.99), minMomentum: num('MKT_BREAK_MOM', 60), minConfidence: num('MKT_BREAK_CONF', 0.8) },
  { status: 'SURGING', minMomentum: num('MKT_SURGE_MOM', 40) },
  { status: 'RISING', minMomentum: num('MKT_RISE_MOM', 10) },
  { status: 'COOLING', minScore: num('MKT_COOL_SCORE', 50), maxMomentum: num('MKT_COOL_MOM', -10) },
  { status: 'FALLING', maxMomentum: num('MKT_FALL_MOM', -10) },
  { status: 'DORMANT', maxScore: num('MKT_DORMANT_SCORE', 15), maxAbsMomentum: 10 },
  { status: 'ACTIVE', minScore: num('MKT_ACTIVE_SCORE', 60) },
  { status: 'STABLE' },
]

/** Colour intent per status, for the UI. Never decorative. */
export const STATUS_TONE = {
  BREAKING: 'alert', SURGING: 'up', RISING: 'up', ACTIVE: 'neutral',
  STABLE: 'neutral', COOLING: 'down', FALLING: 'down', DORMANT: 'mute', 'NEW ENTRY': 'new',
}

/* ------------------------------------------------------------------ *
   Attention bands — the "Attention" column
 * ------------------------------------------------------------------ */

export const ATTENTION_BANDS = [
  { min: 90, label: 'Extreme' },
  { min: 75, label: 'Very High' },
  { min: 55, label: 'High' },
  { min: 35, label: 'Moderate' },
  { min: 15, label: 'Low' },
  { min: 0, label: 'Minimal' },
]

/* ------------------------------------------------------------------ *
   Ingestion
 * ------------------------------------------------------------------ */

export const INGEST = {
  /** The roster is swept in this many shards, one per 15-minute tick. */
  shards: num('MKT_SHARDS', 4),
  /** Top movers re-checked on every tick, on top of the shard. */
  hotListSize: num('MKT_HOTLIST', 20),
  /** A run stops cleanly rather than overrunning the function limit. */
  maxCallsPerRun: num('MKT_MAX_CALLS', 60),
  maxRunSeconds: num('MKT_MAX_RUN_S', 600),
}

/** How long a source's last value stays usable before it is treated as stale. */
export const STALE_TOLERANCE_SECONDS = {
  news: num('MKT_STALE_NEWS', 5400),
  wikipedia: num('MKT_STALE_WIKI', 172800),
  wikiedits: num('MKT_STALE_EDITS', 3600),
}

/** Beyond this, a source contributes nothing and its weight is redistributed. */
export const STALE_DROP_SECONDS = {
  news: num('MKT_DROP_NEWS', 21600),
  wikipedia: num('MKT_DROP_WIKI', 604800),
  wikiedits: num('MKT_DROP_EDITS', 10800),
}

/* ------------------------------------------------------------------ *
   GDELT
 * ------------------------------------------------------------------ */

export const GDELT = {
  docApi: 'https://api.gdeltproject.org/api/v2/doc/doc',
  /**
   * GDELT answers a 429 with "Please limit requests to one every 5 seconds".
   * Ten gives real headroom, and the backoff below must never dip under five
   * or a retry earns another 429 by itself.
   */
  gapMs: num('MKT_GDELT_GAP', 10000),
  timespan: '24h',
  maxArticles: num('MKT_GDELT_MAX', 75),
  retries: num('MKT_GDELT_RETRIES', 3),
  backoffMs: num('MKT_GDELT_BACKOFF', 15000),
  /** Consecutive rate-limit responses that trip the adapter off. */
  breakerTrips: num('MKT_GDELT_TRIPS', 3),
  breakerCooldownMs: num('MKT_GDELT_COOLDOWN', 30 * 60000),
}

/**
 * Publisher prominence. A wire service carrying a story means more than an
 * aggregator carrying it, and this is what lets breadth reward independent
 * pickup rather than syndication.
 */
export const PUBLISHER_TIERS = {
  1: ['apnews.com', 'reuters.com', 'bbc.co.uk', 'bbc.com', 'npr.org', 'nytimes.com', 'washingtonpost.com', 'theguardian.com'],
  2: ['variety.com', 'hollywoodreporter.com', 'deadline.com', 'billboard.com', 'rollingstone.com', 'ew.com', 'people.com', 'cnn.com', 'nbcnews.com', 'cbsnews.com', 'abcnews.go.com', 'usatoday.com', 'today.com', 'eonline.com'],
  3: ['etonline.com', 'usmagazine.com', 'pagesix.com', 'tmz.com', 'vulture.com', 'indiewire.com', 'thewrap.com'],
}
export const TIER_WEIGHT = { 1: 1.0, 2: 0.75, 3: 0.5, 0: 0.3 }

/* ------------------------------------------------------------------ *
   GDELT Web News NGrams — the news source

   Static files on a CDN, published every minute. Not rate limited, no key,
   and one download covers every celebrity at once. This is what GDELT's own
   429 told us to use instead of the DOC API.
 * ------------------------------------------------------------------ */

export const GKG = {
  /** GDELT publishes the current file list here, so nothing guesses stamps. */
  lastUpdate: 'http://data.gdeltproject.org/gdeltv2/lastupdate.txt',
  /**
   * One 15-minute window holds ~1,400 articles, so most of the roster appears
   * in none of them. Attention is the rolling sum of this many windows.
   */
  rollingWindows: num('MKT_GKG_WINDOWS', 96),
}

export const NGRAMS = {
  base: 'https://data.gdeltproject.org',
  /** How many one-minute files make up a single snapshot's window. */
  minutesPerSnapshot: num('MKT_NGRAM_MINUTES', 6),
  /** Files land a little behind real time; asking for "now" gets a 404. */
  lagMinutes: num('MKT_NGRAM_LAG', 4),
  /** Share of phrases two documents must have in common to be one story. */
  clusterThreshold: num('MKT_NGRAM_CLUSTER', 0.55),
}

/* ------------------------------------------------------------------ *
   Wikipedia
 * ------------------------------------------------------------------ */

export const WIKIPEDIA = {
  pageviewsApi: 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article',
  project: 'en.wikipedia',
  access: 'all-access',
  agent: 'user',
  /** Per-article pageviews are daily only — there is no public hourly feed. */
  granularity: 'daily',
  lookbackDays: num('MKT_WIKI_LOOKBACK', 60),
  gapMs: num('MKT_WIKI_GAP', 250),
  /*
   * Wikipedia used to be collected only by the 03:00 job. That meant 15% of
   * the score was missing from launch until the first time that job happened
   * to fire — and missing for another whole day if it ever failed, with
   * nothing to recover it. So ordinary runs top up the celebrities whose
   * reading is absent or a day old, a handful at a time: the roster fills
   * within a couple of hours of a cold start, the daily refresh spreads itself
   * across the day instead of arriving as one burst of a hundred requests,
   * and a failed daily job costs nothing.
   */
  perRun: num('MKT_WIKI_PER_RUN', 20),
  refreshHours: num('MKT_WIKI_REFRESH_HOURS', 20),
}

/*
 * Celebrity portraits.
 *
 * A photograph barely changes, so this is a slow backfill rather than a
 * refresh: six names a run fills a 105-name roster inside five hours, and
 * after that almost every run does nothing at all. Three requests per name
 * against Wikipedia, Wikidata and Commons — all free, all rate-limit-friendly
 * at this pace.
 */
export const PORTRAITS = {
  perRun: num('MKT_PORTRAIT_PER_RUN', 6),
  refreshDays: num('MKT_PORTRAIT_REFRESH_DAYS', 30),
  /** Wide enough for the market avatar and the profile header on a phone. */
  width: num('MKT_PORTRAIT_WIDTH', 400),
  gapMs: num('MKT_PORTRAIT_GAP', 200),
  /*
   * Commons flags a lot of celebrity photographs with "personality rights":
   * the copyright licence is free, but the person in the picture has publicity
   * rights the photographer cannot sign away. Measured across the top 50 names
   * on this roster, 13 carry the flag — Messi, Ronaldo, Pedro Pascal, Emma
   * Stone and Dwayne Johnson among them, which is to say most of the names a
   * gossip market wants on its front page.
   *
   * Those rights restrict COMMERCIAL use — endorsement, merchandise,
   * advertising. Showing someone's portrait beside coverage of that same
   * person is editorial use, and Simon has taken the decision that the
   * Celebrity Market counts as editorial for this purpose. So they are used.
   *
   * The flag is still read and still stored with every portrait, so the admin
   * page can say which pictures carry it and the decision can be revisited
   * from evidence rather than from memory. MKT_PORTRAIT_ALLOW_PERSONALITY=0
   * reverses it without a deploy.
   *
   * Every OTHER restriction Commons records — trademark and the rest — is
   * still refused. This decision is about one flag, not about the field.
   */
  allowPersonalityRights: flag('MKT_PORTRAIT_ALLOW_PERSONALITY', true),
}

/* ------------------------------------------------------------------ *
   The Genie 100 — the weekly chart
 * ------------------------------------------------------------------ */

/*
 * The live market answers "who is hot right now". The chart answers "who was
 * hot last week", once, on a Monday — and that is a different and more
 * valuable thing, because a continuous number has no moment and nothing to
 * cite. A chart has a publication, a number one, a climb and a new entry.
 *
 * Chart weeks run Monday 00:00 to Sunday 23:59:59 UTC, which is deliberately
 * the same boundary the daily rollup uses: a week is seven whole rollup days
 * with nothing straddling an edge.
 */
export const CHART = {
  /** The name in a sponsor's contract and a journalist's sentence. */
  name: 'The Genie 100',
  short: 'Genie 100',
  descriptor: 'the gossip chart',
  /** The B2B surface says this instead. No agency puts "gossip" in a deck. */
  b2bName: 'Attention Index',

  size: num('MKT_CHART_SIZE', 100),

  /**
   * Days of MEASURED data a celebrity needs before they may chart.
   *
   * Without a floor, a name added on the Friday charts on two loud days and
   * a name we have watched all week does not. Five of seven is the bar, and
   * an edition records the bar it was built with, so a soft launch that had
   * to use a lower one says so rather than pretending.
   *
   * It went from four to five when absent days stopped being free (see
   * `weekScore`). Four of seven let a name miss three days in a week and
   * still hold a chart place on the strength of the four they turned up for.
   */
  minDays: num('MKT_CHART_MIN_DAYS', 5),

  /**
   * What a day with no reading is worth.
   *
   * It is NOT worth nothing and it is NOT worth carrying yesterday forward.
   * A celebrity who was not measured on Thursday did not have a Thursday at
   * their Wednesday level — they had a Thursday nobody can vouch for. So an
   * absent day is scored at their own trailing normal, damped by this, which
   * is below the level of anyone having a real week and above zero.
   *
   * The whole point: a week is seven days long for everybody. A name present
   * for four loud days used to average only those four and beat a name
   * present for seven ordinary ones, which is precisely "they got a story,
   * so they went up".
   */
  quietDayFactor: num('MKT_CHART_QUIET_DAY', 0.8),

  /**
   * The evidence a rise has to show before the chart treats it as real.
   *
   * A climb backed by one outlet and nothing else is not the same event as a
   * climb backed by thirty outlets in nine countries, and the chart should
   * not present them identically. Names below this bar still chart — the
   * score is the score — but they are marked thin and the card says so.
   */
  CORROBORATION: {
    /** A signal counts as having moved at this fractional change or more. */
    moved: num('MKT_CORROB_MOVED', 0.25),
    /** Independent signals that must agree before a rise is not "thin". */
    signals: num('MKT_CORROB_SIGNALS', 2),
    /** And the coverage behind it, on the week's best day. */
    minOutlets: num('MKT_CORROB_OUTLETS', 3),
    minCountries: num('MKT_CORROB_COUNTRIES', 2),
  },

  /**
   * Publication, in UTC, on the Monday after the week closes.
   *
   * 13:00 UTC is 9am Eastern in summer and 8am in winter. Netlify's scheduler
   * only speaks UTC, so the hour drifts with daylight saving exactly as the
   * news schedule already does — an hour either side of nine is invisible to
   * a reader and not worth a second cron to chase.
   */
  publishHourUtc: num('MKT_CHART_HOUR_UTC', 13),
}

/* ------------------------------------------------------------------ *
   Storage
 * ------------------------------------------------------------------ */

export const STORE_NAME = 'gossip-market'
export const SNAPSHOT_INTERVAL_MINUTES = num('MKT_SNAPSHOT_MINUTES', 15)

/*
 * What is kept, and for how long.
 *
 * These two numbers are not the same kind of number, and the difference is
 * the most consequential decision in this file.
 *
 * Intraday snapshots are working data: one point every fifteen minutes, per
 * celebrity, per day. They are what the 24-hour chart and the momentum
 * calculation read, they are bulky, and once a day has been rolled up they
 * carry almost nothing the rollup does not. They expire.
 *
 * The daily rollup is the ARCHIVE. It is the one thing here that cannot be
 * rebuilt: GDELT's ngram files and Wikipedia's pageview API will both answer
 * about today, and neither will answer about a Tuesday in 2026 that nobody
 * recorded. A year from now the archive is the asset — the thing a chart's
 * "weeks on chart" is counted from, the thing a licensing conversation is
 * actually about — and every day it runs unpruned it gets more valuable.
 *
 * So it is kept indefinitely. The cost of doing so is negligible: one day is
 * about 110 bytes, so a hundred years of one celebrity is under 4 MB and the
 * whole roster over a decade is a few hundred kilobytes per name. The number
 * below is a sanity bound against a corrupt loop appending forever, not a
 * retention policy, and it should not be lowered to save space — there is no
 * meaningful space to save, and what it would delete is irreplaceable.
 */
export const RETENTION = {
  intradayDays: num('MKT_RETAIN_INTRADAY', 35),
  rollupDays: num('MKT_RETAIN_ROLLUP', 36500),
}

export const UA = 'GossipGenie-Market/0.1 (a Genie app; contact simon@knightvisionstudios.tv)'

/* ------------------------------------------------------------------ *
   Categories
 * ------------------------------------------------------------------ */

export const CATEGORIES = {
  film: 'Film',
  tv: 'Television',
  music: 'Music',
  reality: 'Reality',
  sport: 'Sport',
  creators: 'Creators',
  fashion: 'Fashion',
  royalty: 'Royalty',
  comedy: 'Comedy',
  business: 'Business',
  other: 'Other',
}
export const CATEGORY_KEYS = Object.keys(CATEGORIES)

/** Tabs on the market page, in order. */
export const MARKET_TABS = [
  { key: 'top', label: 'Top 100' },
  { key: 'rising', label: 'Rising' },
  { key: 'falling', label: 'Falling' },
  { key: 'breaking', label: 'Breaking' },
  ...['film', 'tv', 'music', 'reality', 'sport', 'creators'].map((k) => ({ key: k, label: CATEGORIES[k] })),
]

/* ------------------------------------------------------------------ *
   The exchange
 * ------------------------------------------------------------------ */

/**
 * Turning an index into a price.
 *
 * The gossip score is bounded 0–100 and mean-reverting, which makes it a
 * terrible price: buy at 90 and the only direction is down, buy at 10 and you
 * can barely lose. Every player would converge on "buy the bottom, sell the
 * top" within a week and the game would be over.
 *
 * So the price is a PATH, not a level. It compounds off how much attention a
 * name is getting RELATIVE TO THEIR OWN NORMAL — which is the same question
 * the index already answers for the chart, asked of a different denominator.
 * A megastar who is permanently enormous flatlines; an unknown going from
 * nowhere to somewhere rockets. That is the game: scouting, not indexing.
 *
 * Every number here is a first-principles starting point, not a calibrated
 * one — at the time of writing the market had four days of history and most
 * names were at zero. `scripts/price-calibrate.mjs` re-runs the model over
 * whatever history exists and prints what it does; these want revisiting
 * once there are weeks rather than days behind them.
 */
export const PRICE = {
  /**
   * How hard a day's surprise moves the price. The whole model's gain.
   * At 0.25, a name getting double their usual attention moves about +17%.
   */
  k: num('MKT_PRICE_K', 0.25),
  /**
   * The most one day may move a price, up or down.
   *
   * A cap, not a target: without it a single freak window on a name with
   * almost no baseline prints a 900% day and the leaderboard is decided by
   * one lucky tick rather than by judgement.
   */
  maxMove: num('MKT_PRICE_MAX_MOVE', 0.18),
  /**
   * Added to both sides of the ratio before the logarithm.
   *
   * This is what stops a division by nearly zero. Most of the roster is at or
   * near zero attention on any given day, and (level / expected) on two small
   * numbers is noise amplified to infinity. Adding a constant makes the ratio
   * compressive where the numbers are small and transparent where they are
   * large, which is exactly the behaviour wanted.
   */
  smoothing: num('MKT_PRICE_SMOOTHING', 12),
  /** How many of their own past days set the expectation. */
  baselineDays: num('MKT_PRICE_BASELINE_DAYS', 14),
  /** A price never reaches zero: a delisted name is worth something to somebody. */
  floor: num('MKT_PRICE_FLOOR', 1),
  /**
   * What a name lists at.
   *
   * Their gossip score on the day they join, floored. It makes the opening
   * of the exchange explainable in one sentence — "everyone listed at their
   * score, and the price is where the market has taken them since" — and it
   * means a cheap name is genuinely cheap rather than arbitrarily so.
   */
  listFloor: num('MKT_PRICE_LIST_FLOOR', 10),
}

/**
 * What counts as coverage OF somebody, rather than a mention of them.
 *
 * GKG reports every person named anywhere in an article, which is not the
 * same question the index is asking. Sampling the live chart the day the
 * headlines went in: of the top twenty names, four had coverage whose
 * headline actually named them. Harry Styles was third on the chart on the
 * strength of a Canadian weather report; Sabrina Carpenter and Ariana Grande
 * were both credited with the same Taylor Swift article; a listicle naming
 * fifteen celebrities was counted once in full for each of them.
 *
 * Both of the numbers needed to fix that were already in the file and
 * already being thrown away: the headline, and how many people the article
 * names. Being in the headline is being the subject; being one of thirty
 * names is being a footnote.
 */
export const COVERAGE = {
  /** Credit for an article whose headline names them. */
  headline: num('MKT_COVER_HEADLINE', 1),
  /** Credit for a name that appears only in the body. */
  body: num('MKT_COVER_BODY', 0.25),
  /**
   * Below this many names, an article is about its subjects; above it, the
   * dilution does the work on its own. Kept as a floor rather than a cliff
   * so a two-hander is not treated as a round-up.
   */
  minNamed: num('MKT_COVER_MIN_NAMED', 2),
  /**
   * The unit, chosen for continuity rather than meaning.
   *
   * Baselines are rebuilt every run from up to thirty days of stored
   * readings. Switching from "articles counted" to "coverage weighed"
   * without this would have every name measured against a month of numbers
   * on a different scale, and the whole market would read as collapsing for
   * weeks until the history rolled over.
   *
   * At 8, a passing mention in a two-hander scores 1 — exactly what one
   * article used to be worth — and being the subject of that story scores 4.
   * Nothing is deflated; the weighting is entirely relative, which is the
   * only part that was ever the point.
   */
  scale: num('MKT_COVER_SCALE', 8),
}
