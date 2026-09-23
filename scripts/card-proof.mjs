#!/usr/bin/env node
/**
 * Draw every share card, so somebody can look at them.
 *
 * Cards are the one part of the site nobody on the site ever sees: they exist
 * inside somebody else's chat app. So they get rendered here, to files, with
 * the awkward cases included on purpose — the two-line name, the headline that
 * runs long, the story with no photograph, the mover that did not move.
 *
 *   node scripts/card-proof.mjs --out out/cards
 *
 * Checks that do not need eyes live in scripts/share-audit.mjs; this one is
 * for the eyes.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { storyCard, celebrityCard, marketCard, chartCard, movementCard, siteCard, toPng } from '../netlify/lib/card.mjs'
import { shareLine } from '../src/lib/narrative.js'

/** A movement record, in the shape market/evidence.mjs produces. */
const MOVEMENT = (over = {}) => ({
  move: { direction: 'up', from: 23, to: 8, places: 15 },
  week: {
    score: 41.2, previousScore: 12.4, change: 28.8, days: 7, span: 7, shape: 'sustained',
    series: [30, 34, 40, 46, 44, 48, 46].map((level, i) => ({ day: `2026-09-${14 + i}`, level, measured: true })),
    peak: { day: '2026-09-19', level: 48 },
  },
  drivers: [
    { key: 'coverage', label: 'Coverage', now: 130, before: 42, change: 2.095, moved: true, share: 0.5 },
    { key: 'breadth', label: 'Outlets', now: 22, before: 3, change: 6.333, moved: true, share: 0.42 },
    { key: 'search', label: 'Search', now: 18400, before: 15200, change: 0.21, moved: false, share: 0 },
  ],
  corroboration: 2,
  thin: false,
  evidence: { outlets: 22, countries: 7, topTier: 3, mentions: 130, story: null },
  ...over,
})

const argv = process.argv.slice(2)
const value = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const OUT = value('--out', 'out/cards')

/**
 * A stand-in portrait.
 *
 * Fetching a real one needs the open internet, which the sandbox this is
 * usually run in does not have — and the point of the fixture is the
 * compositing (the bleed, the left fade, the wash under the footer), which a
 * synthetic image proves exactly as well as a photograph.
 */
const fixturePhoto = async () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0%" stop-color="#F6C89F"/><stop offset="55%" stop-color="#C2617A"/><stop offset="100%" stop-color="#2B1B3D"/>
    </linearGradient></defs>
    <rect width="800" height="1000" fill="url(#g)"/>
    <circle cx="400" cy="330" r="190" fill="#3A2440" opacity="0.55"/>
    <rect x="150" y="560" width="500" height="440" rx="180" fill="#3A2440" opacity="0.55"/>
  </svg>`
  return `data:image/png;base64,${Buffer.from(await toPng(svg)).toString('base64')}`
}

const run = async () => {
  await mkdir(OUT, { recursive: true })
  const photo = await fixturePhoto()

  const cards = [
    ['celebrity-photo', celebrityCard(
      { displayName: 'Zendaya', gossipScore: 62.1, change: 18.4, changeLabel: 'today', rank: 3, tracked: 240 },
      { image: photo },
    )],
    ['celebrity-initials', celebrityCard(
      { displayName: 'Zendaya', gossipScore: 62.1, change: 18.4, changeLabel: 'today', rank: 3, tracked: 240 },
    )],
    ['celebrity-two-line-name', celebrityCard(
      { displayName: 'Benedict Cumberbatch', gossipScore: 41.7, change: -6.2, changeLabel: 'today', rank: 28, tracked: 240 },
    )],
    ['celebrity-flat', celebrityCard(
      { displayName: 'Dua Lipa', gossipScore: 55.0, change: 0, changeLabel: 'today', rank: 11, tracked: 240 },
    )],
    ['celebrity-no-change', celebrityCard(
      { displayName: 'Florence Pugh', gossipScore: 48.3, change: null, changeLabel: 'today', rank: 19, tracked: 240 },
    )],
    ['story-long', storyCard({
      strand: 'bizarre',
      headline: 'Elk jumps on the bonnet of a parked car in Colorado and refuses to get off for forty minutes',
      caption: 'Rangers waited for the animal to lose interest. The car was, eventually, fine.',
      outlets: 23,
    }, { image: photo })],
    ['story-short', storyCard({
      strand: 'health',
      headline: 'Strength training twice a week is enough',
      caption: 'A large review finds the benefit plateaus sooner than expected.',
      outlets: 9,
    })],
    ['story-no-caption', storyCard({
      strand: 'facts',
      headline: 'A galaxy has been found spinning two different ways at once',
      outlets: 4,
    })],
    ['story-one-outlet', storyCard({
      strand: 'celebrity',
      headline: 'Pop star announces forty tour dates across five continents',
      caption: 'Her first shows in South America are in the running order.',
      outlets: 1,
    })],
    ['chart', chartCard({
      id: '2026-W38',
      label: '14–20 September 2026',
      entries: [
        { rank: 1, displayName: 'Zendaya', slug: 'zendaya', score: 62.1, status: 'up', move: 3, weeksOn: 9, peak: 1 },
        { rank: 2, displayName: 'Pedro Pascal', slug: 'pedro-pascal', score: 58.4, status: 'down', move: -1 },
        { rank: 3, displayName: 'Benedict Cumberbatch', slug: 'bc', score: 55.0, status: 'new', move: null },
        { rank: 4, displayName: 'Dua Lipa', slug: 'dua-lipa', score: 51.2, status: 'same', move: 0 },
        { rank: 5, displayName: 'Florence Pugh', slug: 'fp', score: 49.8, status: 'up', move: 12 },
      ],
      summary: { numberOne: { displayName: 'Zendaya' }, charted: 100 },
    }, { image: photo })],
    ['chart-no-photo', chartCard({
      id: '2026-W39',
      label: '21–27 September 2026',
      entries: [
        { rank: 1, displayName: 'Jeremy Allen White', slug: 'jaw', score: 71.4, status: 'new', move: null },
        { rank: 2, displayName: 'Zendaya', slug: 'zendaya', score: 62.1, status: 'down', move: -1 },
        { rank: 3, displayName: 'Adele', slug: 'adele', score: 60.0, status: 'reentry', move: null },
        { rank: 4, displayName: 'LeBron James', slug: 'lj', score: 57.7, status: 'up', move: 24 },
        { rank: 5, displayName: 'Dua Lipa', slug: 'dua-lipa', score: 51.2, status: 'same', move: 0 },
      ],
      summary: { numberOne: { displayName: 'Jeremy Allen White' }, charted: 100 },
    })],
    /* The production shape: the number one always has a week series, so the
       sparkline and the headline are what a real chart card carries. */
    ['chart-headline', chartCard({
      id: '2026-W38',
      label: '14–20 September 2026',
      entries: [
        {
          rank: 1, displayName: 'Zendaya', slug: 'zendaya', score: 62.1, status: 'up', move: 3, weeksOn: 9, peak: 1,
          movement: {
            week: {
              series: [40, 48, 61, 72, 66, 58, 62].map((level, i) => ({ day: `2026-09-${14 + i}`, level })),
              peak: { day: '2026-09-17', level: 72 },
            },
            drivers: [{ label: 'search', moved: true, share: 0.6, change: 0.8 }],
          },
        },
        { rank: 2, displayName: 'Pedro Pascal', slug: 'pedro-pascal', score: 58.4, status: 'down', move: -1 },
        { rank: 3, displayName: 'Benedict Cumberbatch', slug: 'bc', score: 55.0, status: 'new', move: null },
      ],
      summary: { numberOne: { displayName: 'Zendaya' }, charted: 100 },
    }, { headline: 'Zendaya takes the top' })],

    /* ---- the card that explains a move ---- */
    ['movement', movementCard(
      { rank: 8, displayName: 'Zendaya', slug: 'zendaya', score: 41.2 },
      { image: photo, record: MOVEMENT(), line: shareLine(MOVEMENT(), 'Zendaya') },
    )],
    ['movement-thin', movementCard(
      { rank: 44, displayName: 'Jeremy Allen White', slug: 'jaw', score: 18.1 },
      {
        record: MOVEMENT({
          move: { direction: 'up', from: 61, to: 44, places: 17 },
          // A thin week looks like a thin week: barely off the floor.
          week: {
            score: 18.1, days: 7, span: 7, shape: 'steady',
            series: [14, 13, 15, 14, 16, 22, 18].map((level, i) => ({ day: `2026-09-${14 + i}`, level, measured: true })),
            peak: { day: '2026-09-19', level: 22 },
          },
          thin: true, corroboration: 1,
          evidence: { outlets: 1, countries: 1, topTier: 0, mentions: 14, story: null },
          drivers: [
            { key: 'coverage', label: 'Coverage', now: 14, before: 10, change: 0.4, moved: true, share: 1 },
            { key: 'breadth', label: 'Outlets', now: 1, before: 1, change: 0, moved: false, share: 0 },
            { key: 'search', label: 'Search', now: 1010, before: 1000, change: 0.01, moved: false, share: 0 },
          ],
        }),
        line: 'Jeremy Allen White is up 17 to number 44. Coverage up 40% — 14 mentions a day against 10.',
      },
    )],
    ['movement-gaps', movementCard(
      { rank: 12, displayName: 'Bad Bunny', slug: 'bad-bunny', score: 33.4 },
      {
        image: photo,
        record: MOVEMENT({
          move: { direction: 'new', from: null, to: 12, places: null },
          week: {
            score: 33.4, days: 5, span: 7, shape: 'building',
            series: [
              { day: '2026-09-14', level: 12, measured: true },
              { day: '2026-09-15', level: null, measured: false },
              { day: '2026-09-16', level: 26, measured: true },
              { day: '2026-09-17', level: null, measured: false },
              { day: '2026-09-18', level: 38, measured: true },
              { day: '2026-09-19', level: 44, measured: true },
              { day: '2026-09-20', level: 52, measured: true },
            ],
            peak: { day: '2026-09-20', level: 52 },
          },
        }),
        line: 'Bad Bunny is a new entry at 12. Picked up by 22 newsrooms, 7.3× last week.',
      },
    )],
    ['site', siteCard()],
    ['market', marketCard({
      tracked: 240,
      basis: 'change in gossip score vs 24 hours ago',
      movers: [
        { displayName: 'Zendaya', change: 18.4 },
        { displayName: 'Pedro Pascal', change: 11.2 },
        { displayName: 'Benedict Cumberbatch', change: -6.2 },
        { displayName: 'Dua Lipa', change: -9.8 },
      ],
    })],
  ]

  for (const [name, svg] of cards) {
    await writeFile(`${OUT}/${name}.png`, await toPng(svg))
    console.log(`  ${OUT}/${name}.png`)
  }
  console.log(`\n${cards.length} cards drawn.`)
}

run().catch((err) => { console.error(err); process.exit(1) })
