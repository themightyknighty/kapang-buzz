import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verify, buildQuery, clusterArticles, measureNews, hasPhrase, recencyWeight } from './match.mjs'
import { byId, ROSTER } from './roster.mjs'
import { validateCelebrity } from './celebrities.mjs'

const swift = byId('taylor-swift')
const rock = byId('dwayne-johnson')
const pascal = byId('pedro-pascal')
const drake = byId('drake')

/**
 * Hand-labelled headlines, including the traps that a naive string count gets
 * wrong. `true` means the headline really is about that celebrity.
 */
const FIXTURES = [
  // Taylor Swift — the alias is also a bird, a programming language and a satirist
  [swift, 'Taylor Swift announces new album at surprise London show', true],
  [swift, 'Swift confirms Eras Tour will end in December', true],
  [swift, 'Chimney swift population rebounds across the Midwest', false],
  [swift, 'Apple releases Swift 7 with new concurrency model', false],
  [swift, 'Jonathan Swift manuscript discovered in Dublin archive', false],
  [swift, 'Banks adopt new SWIFT code standard for transfers', false],
  [swift, 'Swift moves quickly to deny the rumours', false], // surname with no context
  [swift, 'Taylor spotted at the Chiefs game', false], // first name only

  // Dwayne Johnson — "The Rock" is strong, "Johnson" is not
  [rock, 'Dwayne Johnson joins the cast of the new heist film', true],
  [rock, 'The Rock announces a sequel to his wrestling documentary', true],
  [rock, 'Johnson says the wrestler will return for one more match', true],
  [rock, 'Boris Johnson publishes memoir about his time in office', false],
  [rock, 'Johnson & Johnson reports quarterly earnings', false],
  [rock, 'Rock formations in Utah draw record visitors', false],

  // Pedro Pascal — the surname is a language, a unit and a mathematician
  [pascal, 'Pedro Pascal confirmed for the next season', true],
  [pascal, 'Pascal returns as Joel in The Last of Us finale', true],
  [pascal, 'Blaise Pascal exhibition opens in Paris', false],
  [pascal, 'Pressure reached 200 kilopascal during the test', false],
  [pascal, 'Pascal programming language turns fifty', false],

  // Drake — excludes carry the weight here
  [drake, 'Drake releases surprise mixtape at midnight', true],
  [drake, 'Drake Equation revisited by astronomers', false],
  [drake, 'Sir Francis Drake shipwreck located off Panama', false],
  [drake, 'Drake University announces new scholarship', false],
]

test('entity matching gets the labelled headlines right', () => {
  const wrong = []
  for (const [celeb, headline, expected] of FIXTURES) {
    const got = verify(celeb, headline).ok
    if (got !== expected) wrong.push(`${celeb.displayName}: "${headline}" → ${got}, expected ${expected}`)
  }
  assert.deepEqual(wrong, [], `\n${wrong.join('\n')}`)
})

test('precision and recall stay above threshold', () => {
  let tp = 0, fp = 0, fn = 0
  for (const [celeb, headline, expected] of FIXTURES) {
    const got = verify(celeb, headline).ok
    if (got && expected) tp++
    else if (got && !expected) fp++
    else if (!got && expected) fn++
  }
  const precision = tp / (tp + fp)
  const recall = tp / (tp + fn)
  assert.ok(precision >= 0.95, `precision ${precision}`)
  assert.ok(recall >= 0.9, `recall ${recall}`)
})

test('a rejection explains itself', () => {
  assert.equal(verify(swift, 'Chimney swift numbers rise again').reason, 'excluded')
  assert.equal(verify(swift, 'Swift moves quickly to deny the rumours').reason, 'ambiguous-unconfirmed')
  assert.equal(verify(swift, 'A story about nobody in particular').reason, 'no-alias')
  assert.equal(verify(swift, 'Taylor Swift announces a tour').reason, 'unique')
})

test('whole words only — "rock" must not match "rocket"', () => {
  assert.ok(hasPhrase('The Rock announces a film', 'the rock'))
  assert.ok(!hasPhrase('Rocket launch scrubbed again', 'rock'))
  assert.ok(!hasPhrase('Swifties gather in Kansas City', 'swift'))
})

test('the query never contains an ambiguous alias', () => {
  const q = buildQuery(swift)
  assert.ok(q.includes('"Taylor Swift"'))
  assert.ok(!q.includes('"Swift"'), q)
  assert.ok(buildQuery(rock).includes('"The Rock"'))
})

test('a syndicated story counts once, not 150 times', () => {
  const wire = { title: 'Taylor Swift announces joint stadium tour with surprise guest' }
  const articles = [
    ...Array.from({ length: 150 }, (_, i) => ({ ...wire, url: `https://clone${i}.example.com/a` })),
    { title: 'Taylor Swift spotted leaving a recording studio in Nashville', url: 'https://variety.com/b' },
  ]
  const clusters = clusterArticles(articles, { ignore: ['Taylor Swift'] })
  assert.equal(clusters.length, 2, 'the wire copies should collapse into one story')
  assert.equal(clusters[0].length, 150)
})

test('measureNews counts stories and reports breadth separately', () => {
  const now = Date.parse('2026-09-17T12:00:00Z')
  const at = new Date(now - 3600000).toISOString()
  const articles = [
    { title: 'Taylor Swift announces new album', url: 'https://apnews.com/1', seendate: at, sourcecountry: 'US' },
    { title: 'Taylor Swift announces new album', url: 'https://bbc.co.uk/2', seendate: at, sourcecountry: 'UK' },
    { title: 'Taylor Swift announces new album', url: 'https://variety.com/3', seendate: at, sourcecountry: 'US' },
    { title: 'Taylor Swift seen at a Kansas City restaurant', url: 'https://people.com/4', seendate: at, sourcecountry: 'US' },
    { title: 'Chimney swift numbers rise again', url: 'https://audubon.org/5', seendate: at, sourcecountry: 'US' },
  ]
  const m = measureNews(swift, articles, { now })
  assert.equal(m.mentions, 2, 'two distinct stories')
  assert.equal(m.articles, 4, 'the bird story is rejected')
  assert.equal(m.uniqueSources, 4)
  assert.equal(m.uniqueCountries, 2)
  assert.ok(m.matchRate > 0.7 && m.matchRate < 1)
  assert.ok(m.prominence > 0)
})

test('recency decays and never exceeds 1', () => {
  const now = Date.parse('2026-09-17T12:00:00Z')
  const fresh = recencyWeight(new Date(now).toISOString(), now)
  const old = recencyWeight(new Date(now - 24 * 3600000).toISOString(), now)
  assert.ok(fresh <= 1 && fresh > 0.99)
  assert.ok(old < fresh && old > 0)
})

test('the whole roster is structurally valid and ids are unique', () => {
  const errs = ROSTER.flatMap(validateCelebrity)
  assert.deepEqual(errs, [])
  assert.equal(new Set(ROSTER.map((c) => c.id)).size, ROSTER.length)
  assert.ok(ROSTER.length >= 100, `${ROSTER.length} celebrities`)
})
