import { test } from 'node:test'
import assert from 'node:assert/strict'
import { zipSync } from 'fflate'
import { COL, personsOf, buildPersonIndex, ingestRows, measure, latestFiles, collect, previousWindowUrl, pageTitle, decodeEntities, rowTime, headlines, coverageWeight, countryOf, countriesIn } from './gkg.mjs'
import { byId, activeRoster } from '../roster.mjs'

const swift = byId('taylor-swift')
const rock = byId('dwayne-johnson')
const pascal = byId('pedro-pascal')
const zendaya = byId('zendaya')
const NOW = Date.parse('2026-09-17T21:45:00Z')

/** A GKG row: 27 tab-separated columns, with the ones we read filled in. */
function row({ url = 'https://apnews.com/a', source = 'apnews.com', persons = '', enhanced = '', title = null, date = '20260917214500' } = {}) {
  const cols = new Array(27).fill('')
  cols[COL.date] = date
  cols[COL.sourceName] = source
  cols[COL.documentId] = url
  cols[COL.persons] = persons
  cols[COL.enhancedPersons] = enhanced
  if (title !== null) cols[COL.extras] = `<PAGE_TITLE>${title}</PAGE_TITLE>`
  return cols.join('\t')
}

/* ---------------- what the story said ---------------- */

test('the headline comes out of the extras column we were throwing away', () => {
  const cols = row({ title: 'Zendaya cast in the Dune prequel' }).split('\t')
  assert.equal(pageTitle(cols), 'Zendaya cast in the Dune prequel')
})

test('a headline with no extras is null, not an empty string', () => {
  assert.equal(pageTitle(row().split('\t')), null)
  assert.equal(pageTitle(row({ title: '   ' }).split('\t')), null)
  assert.equal(pageTitle([]), null)
})

test('GDELT escapes every non-ASCII character, so the title must be decoded', () => {
  // Left as-is this reads "Beyonc&#233;s Renaissance" on the front page.
  assert.equal(decodeEntities('Beyonc&#233;s &amp; Jay-Z'), 'Beyoncés & Jay-Z')
  assert.equal(decodeEntities('Chalamet&#x2019;s year'), 'Chalamet\u2019s year')
  assert.equal(decodeEntities('caf&eacute; &mdash; open'), 'caf&eacute; — open')
})

test('decoding happens once, so an escaped entity stays escaped', () => {
  // "&amp;#39;" is a literal ampersand-hash-39, not an apostrophe. Decoding
  // named entities and then numeric ones would invent a character.
  assert.equal(decodeEntities('AT&amp;#39;T'), 'AT&#39;T')
  assert.equal(decodeEntities('&#999999999;'), '&#999999999;', 'nonsense code points are left alone')
})

test('an article is stamped with its own window, not with whenever the job ran', () => {
  assert.equal(rowTime(row({ date: '20260917214500' }).split('\t')), Date.UTC(2026, 8, 17, 21, 45, 0))
  assert.equal(rowTime(row({ date: 'rubbish' }).split('\t')), null)
  assert.equal(rowTime([]), null)
})

/* ---------------- reading the file ---------------- */

test('the current file comes from GDELT, never from a guessed timestamp', async () => {
  const listing = [
    '119543 abc123 http://data.gdeltproject.org/gdeltv2/20260917214500.export.CSV.zip',
    '88211 def456 http://data.gdeltproject.org/gdeltv2/20260917214500.mentions.CSV.zip',
    '6402331 ghi789 http://data.gdeltproject.org/gdeltv2/20260917214500.gkg.csv.zip',
  ].join('\n')
  const r = await latestFiles(async () => ({ ok: true, text: async () => listing }))
  assert.ok(r.ok)
  assert.match(r.gkg.url, /\.gkg\.csv\.zip$/)
  assert.equal(r.gkg.bytes, 6402331)
  assert.equal(r.files.length, 3)

  const bad = await latestFiles(async () => ({ ok: false, status: 503 }))
  assert.equal(bad.ok, false)
  assert.match(bad.error, /503/)
})

/* ---------------- person extraction ---------------- */

test('people are read from both person columns and normalised', () => {
  const names = personsOf(row({ persons: 'Taylor Swift;Travis Kelce', enhanced: 'Zendaya,142;Taylor Swift,88' }).split('\t'))
  assert.ok(names.has('taylor swift'))
  assert.ok(names.has('travis kelce'))
  assert.ok(names.has('zendaya'), 'the enhanced column drops its character offset')
  assert.equal([...names].filter((n) => n === 'taylor swift').length, 1, 'no duplicates across columns')
  assert.equal(personsOf(row().split('\t')).size, 0)
})

test('accented names survive, because GDELT ships latin1 not UTF-8', () => {
  const names = personsOf(row({ persons: 'Timothée Chalamet' }).split('\t'))
  assert.ok(names.has('timothee chalamet'), [...names].join('|'))
})

/* ---------------- the index, and the traps ---------------- */

test('only full names index — a bare surname is not evidence', () => {
  const index = buildPersonIndex(activeRoster())
  assert.ok(index.get('dwayne johnson')?.some((c) => c.id === 'dwayne-johnson'))
  assert.ok(index.get('the rock')?.some((c) => c.id === 'dwayne-johnson'))
  // "Johnson" alone would match the wrong person the moment GDELT extracts one,
  // and here there is no surrounding sentence to confirm it from.
  assert.equal(index.get('johnson'), undefined)
  assert.equal(index.get('swift'), undefined)
  assert.equal(index.get('pascal'), undefined)
  // A one-word celebrity is still indexed, because that IS their whole name.
  assert.ok(index.get('zendaya')?.some((c) => c.id === 'zendaya'))
  assert.ok(index.get('adele'))
})

test('the traps that broke text matching cannot arise here', () => {
  const roster = [swift, rock, pascal, zendaya]
  const rows = [
    row({ persons: 'Taylor Swift', url: 'https://apnews.com/1', source: 'apnews.com' }),
    row({ persons: 'Boris Johnson', url: 'https://bbc.co.uk/2', source: 'bbc.co.uk' }),
    row({ persons: 'Blaise Pascal', url: 'https://sciencemag.org/3', source: 'sciencemag.org' }),
    row({ persons: 'Jonathan Swift', url: 'https://irishtimes.com/4', source: 'irishtimes.com' }),
    row({ persons: 'Pedro Pascal;Zendaya', url: 'https://variety.com/5', source: 'variety.com' }),
  ]
  const { into, articles } = ingestRows(rows, roster)
  assert.equal(articles, 5)
  assert.equal(into.get('taylor-swift').docs.size, 1, 'Jonathan Swift is not Taylor Swift')
  assert.ok(!into.has('dwayne-johnson'), 'Boris Johnson is not The Rock')
  assert.equal(into.get('pedro-pascal').docs.size, 1, 'Blaise Pascal is not Pedro Pascal')
  assert.equal(into.get('zendaya').docs.size, 1)
})

test('one article naming several celebrities counts for each of them', () => {
  const { into } = ingestRows([row({ persons: 'Zendaya;Taylor Swift', url: 'https://people.com/1' })], [swift, zendaya])
  assert.equal(into.get('zendaya').docs.size, 1)
  assert.equal(into.get('taylor-swift').docs.size, 1)
})

test('the same URL seen twice is one article, not two', () => {
  const { into } = ingestRows([
    row({ persons: 'Zendaya', url: 'https://people.com/1' }),
    row({ persons: 'Zendaya', url: 'https://people.com/1' }),
  ], [zendaya])
  assert.equal(into.get('zendaya').docs.size, 1)
})

test('short or malformed rows are skipped rather than throwing', () => {
  const { into, articles } = ingestRows(['', 'a\tb\tc', null, row({ persons: 'Zendaya' })], [zendaya])
  assert.equal(articles, 1)
  assert.equal(into.get('zendaya').docs.size, 1)
})

/* ---------------- measurement ---------------- */

test('measure counts articles and publishers, and invents no countries', () => {
  const { into } = ingestRows([
    row({ persons: 'Zendaya', url: 'https://apnews.com/1', source: 'apnews.com' }),
    row({ persons: 'Zendaya', url: 'https://bbc.co.uk/2', source: 'bbc.co.uk' }),
    row({ persons: 'Zendaya', url: 'https://apnews.com/3', source: 'apnews.com' }),
  ], [zendaya])
  const m = measure(into.get('zendaya'), { now: NOW })
  // Three articles, none of which put her in the headline, each naming one
  // person: body credit (0.25), floored share (1/2). Coverage is weighed
  // now, not counted — the raw count is kept alongside it.
  assert.equal(m.windowArticlesSeen, 3, 'three articles were seen')
  assert.equal(m.windowMentions, 3, 'worth three passing mentions, none of them about her')
  assert.equal(m.headlineMentions, 0)
  assert.equal(m.uniqueSources, 2)
  // bbc.co.uk is a ccTLD and apnews.com is not, so one country is known and
  // one is unknown. Under-reporting is the safe direction for a number the
  // corroboration rule rests on.
  assert.equal(m.uniqueCountries, 1, 'read from the outlets, not invented and not hardcoded to zero')
  assert.deepEqual([...m.sourceDomains].sort(), ['apnews.com', 'bbc.co.uk'], 'the day needs the outlets, not just the count')
  assert.equal(m.largestCluster, 2)
  assert.ok(m.prominence > 0)
  assert.equal(m.drivers.length, 3)
})

test('prominent outlets lift breadth above content farms', () => {
  const mk = (domains) => {
    const { into } = ingestRows(domains.map((d, i) => row({ persons: 'Zendaya', url: `https://${d}/${i}`, source: d })), [zendaya])
    return measure(into.get('zendaya'))
  }
  assert.ok(mk(['apnews.com', 'bbc.co.uk', 'nytimes.com']).prominence > mk(['spam1.example', 'spam2.example', 'spam3.example']).prominence)
})

/* ---------------- the whole collect ---------------- */

const zipOf = (rows) => zipSync({ '20260917214500.gkg.csv': Buffer.from(rows.join('\n'), 'latin1') })

test('collect downloads one file and measures everyone from it', async () => {
  const listing = '6402331 ghi789 http://data.gdeltproject.org/gdeltv2/20260917214500.gkg.csv.zip'
  const archive = zipOf([
    row({ persons: 'Taylor Swift', url: 'https://apnews.com/1', source: 'apnews.com' }),
    row({ persons: 'Zendaya', url: 'https://variety.com/2', source: 'variety.com' }),
    row({ persons: 'Mahmoud Abbas', url: 'https://reuters.com/3', source: 'reuters.com' }),
  ])
  const seen = []
  const fetchImpl = async (url) => {
    seen.push(url)
    if (url.endsWith('lastupdate.txt')) return { ok: true, text: async () => listing }
    return { ok: true, arrayBuffer: async () => archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) }
  }
  const log = []
  const r = await collect([swift, zendaya, rock], { now: NOW, fetchImpl, log })

  assert.equal(r.calls, 2, 'the whole roster costs two requests')
  assert.equal(r.files, 1)
  assert.equal(r.articles, 3)
  assert.equal(r.signals.length, 2, 'only the two who appear')
  assert.ok(!r.signals.some((s) => s.celebrityId === 'dwayne-johnson'))
  for (const s of r.signals) {
    assert.equal(s.source, 'news')
    assert.equal(s.raw, 1, 'raw is THIS window, weighed rather than counted')
    assert.equal(s.freshnessSeconds, 0)
    assert.equal(s.series, null)
  }
  assert.equal(seen.length, 2)
  assert.ok(log.join(' ').includes('3 articles'))
})

test('a failure at any step leaves the run able to continue', async () => {
  const noListing = await collect([swift], { now: NOW, log: [], fetchImpl: async () => ({ ok: false, status: 500 }) })
  assert.deepEqual(noListing.signals, [])
  assert.equal(noListing.files, 0)

  const listing = '1 x http://data.gdeltproject.org/gdeltv2/20260917214500.gkg.csv.zip'
  const log = []
  const corrupt = await collect([swift], {
    now: NOW, log,
    fetchImpl: async (url) => url.endsWith('lastupdate.txt')
      ? { ok: true, text: async () => listing }
      : { ok: true, arrayBuffer: async () => new TextEncoder().encode('not a zip').buffer },
  })
  assert.deepEqual(corrupt.signals, [])
  assert.ok(log.some((l) => l.includes('could not read')))
})

/* ---------------- an announced file that is not on the CDN yet ---------------- */

test('the previous window is a subtraction, not a guess', () => {
  const base = 'http://data.gdeltproject.org/gdeltv2/'
  assert.equal(previousWindowUrl(`${base}20260917220000.gkg.csv.zip`), `${base}20260917214500.gkg.csv.zip`)
  // Across an hour, a day and a month boundary.
  assert.equal(previousWindowUrl(`${base}20260917000000.gkg.csv.zip`), `${base}20260916234500.gkg.csv.zip`)
  assert.equal(previousWindowUrl(`${base}20261001000000.gkg.csv.zip`), `${base}20260930234500.gkg.csv.zip`)
  assert.equal(previousWindowUrl('nonsense'), null)
})

test('a window announced but not yet published falls back rather than reading zero', async () => {
  // This is the real failure: lastupdate.txt named 20260917220000, the CDN
  // 404d it, and every celebrity in the market went to zero.
  const listing = '6402331 ghi789 http://data.gdeltproject.org/gdeltv2/20260917220000.gkg.csv.zip'
  const archive = zipOf([row({ persons: 'Taylor Swift', url: 'https://apnews.com/1', source: 'apnews.com' })])
  const tried = []
  const fetchImpl = async (url) => {
    if (url.endsWith('lastupdate.txt')) return { ok: true, text: async () => listing }
    tried.push(url.split('/').pop())
    if (url.includes('20260917220000')) return { ok: false, status: 404 }
    return { ok: true, arrayBuffer: async () => archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) }
  }
  const log = []
  const r = await collect([swift, zendaya], { now: NOW, fetchImpl, log, sleep: async () => {} })

  assert.equal(r.ok, true, 'the run got a window')
  assert.equal(r.file, '20260917214500.gkg.csv.zip', 'the one before the missing one')
  assert.equal(r.signals.length, 1)
  assert.deepEqual(tried, ['20260917220000.gkg.csv.zip', '20260917220000.gkg.csv.zip', '20260917214500.gkg.csv.zip'],
    'it retries the newest once before stepping back')
  assert.ok(log.some((l) => l.includes('not published yet')))
})

test('a retry alone is enough when the file arrives a moment later', async () => {
  const listing = '1 x http://data.gdeltproject.org/gdeltv2/20260917220000.gkg.csv.zip'
  const archive = zipOf([row({ persons: 'Zendaya', url: 'https://variety.com/1', source: 'variety.com' })])
  let n = 0
  const r = await collect([zendaya], {
    now: NOW, log: [], sleep: async () => {},
    fetchImpl: async (url) => {
      if (url.endsWith('lastupdate.txt')) return { ok: true, text: async () => listing }
      return ++n === 1
        ? { ok: false, status: 404 }
        : { ok: true, arrayBuffer: async () => archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) }
    },
  })
  assert.equal(r.file, '20260917220000.gkg.csv.zip', 'the newest window, not the fallback')
  assert.equal(r.signals.length, 1)
})

test('when no window can be read at all, it says so instead of reporting silence', async () => {
  const listing = '1 x http://data.gdeltproject.org/gdeltv2/20260917220000.gkg.csv.zip'
  const log = []
  const r = await collect([swift], {
    now: NOW, log, sleep: async () => {},
    fetchImpl: async (url) => url.endsWith('lastupdate.txt')
      ? { ok: true, text: async () => listing }
      : { ok: false, status: 404 },
  })
  assert.equal(r.ok, false, 'an unread window is a failure, not an empty market')
  assert.deepEqual(r.signals, [])
  assert.match(r.error, /no GKG window could be read/)
})

test('a window already counted is reported as a repeat, never re-ingested', async () => {
  const listing = '1 x http://data.gdeltproject.org/gdeltv2/20260917214500.gkg.csv.zip'
  const archive = zipOf([row({ persons: 'Taylor Swift', url: 'https://apnews.com/1', source: 'apnews.com' })])
  let downloads = 0
  const r = await collect([swift], {
    now: NOW, log: [], sleep: async () => {},
    alreadyIngested: '20260917214500.gkg.csv.zip',
    fetchImpl: async (url) => {
      if (url.endsWith('lastupdate.txt')) return { ok: true, text: async () => listing }
      downloads++
      return { ok: true, arrayBuffer: async () => archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) }
    },
  })
  assert.equal(r.repeat, true)
  assert.equal(r.ok, true, 'a repeat is a known-empty tick, not a failure')
  assert.deepEqual(r.signals, [], 'nothing is counted a second time')
  assert.equal(downloads, 1, 'the file is fetched but never ingested twice')
})


/* ---------------- the drivers explain something ---------------- */

test('drivers carry the headline and the article\u2019s own timestamp', () => {
  const zendaya = byId('zendaya')
  const { into } = ingestRows([
    row({ persons: 'Zendaya', url: 'https://apnews.com/1', source: 'apnews.com', title: 'Zendaya cast in the Dune prequel', date: '20260917214500' }),
  ], [zendaya])
  const [d] = measure(into.get('zendaya'), { now: Date.parse('2026-09-18T09:00:00Z') }).drivers
  assert.equal(d.title, 'Zendaya cast in the Dune prequel')
  assert.equal(d.firstSeen, '2026-09-17T21:45:00.000Z', 'the window it came from, not the run')
})

test('an article we can name is offered before one we cannot', () => {
  /*
   * This list is what the chart reads from when it has to say why somebody
   * moved. A nameless URL explains nothing, so it must not be first.
   */
  const zendaya = byId('zendaya')
  const { into } = ingestRows([
    row({ persons: 'Zendaya', url: 'https://nowhere.test/1', source: 'nowhere.test' }),
    row({ persons: 'Zendaya', url: 'https://apnews.com/2', source: 'apnews.com', title: 'Zendaya takes the lead' }),
  ], [zendaya])
  const { drivers } = measure(into.get('zendaya'))
  assert.equal(drivers[0].title, 'Zendaya takes the lead')
  assert.equal(drivers.length, 2, 'the nameless one is kept, just not led on')
})

test('a row too short to have extras still measures, with no headline', () => {
  // Older rows and malformed ones must not take the window down with them:
  // just enough columns to carry a person, and nothing after.
  const zendaya = byId('zendaya')
  const short = new Array(COL.persons + 1).fill('')
  short[COL.date] = '20260917214500'
  short[COL.sourceName] = 'a.test'
  short[COL.documentId] = 'https://a.test/1'
  short[COL.persons] = 'Zendaya'
  const { into } = ingestRows([short.join('\t')], [zendaya])
  const [d] = measure(into.get('zendaya')).drivers
  assert.equal(d.title, null, 'no extras column is no headline, not a crash')
  assert.equal(d.firstSeen, '2026-09-17T21:45:00.000Z', 'the date column is still there')
})

/* ---------------- coverage of somebody, not a mention ---------------- */

test('a headline naming them is worth far more than a passing mention', () => {
  /*
   * The whole point. Sampled on the day this went in, four of the top twenty
   * chart entries had coverage whose headline actually named them — Harry
   * Styles was third on a Canadian weather report.
   */
  const zendaya = byId('zendaya')
  const subject = ingestRows([row({ persons: 'Zendaya', url: 'https://apnews.com/1', title: 'Zendaya cast in the Dune prequel' })], [zendaya])
  const passing = ingestRows([row({ persons: 'Zendaya', url: 'https://apnews.com/2', title: 'Ten films to watch this autumn' })], [zendaya])
  const w = (r) => measure(r.into.get('zendaya')).windowMentions
  assert.ok(w(subject) >= w(passing) * 4, `${w(subject)} vs ${w(passing)}`)
  assert.equal(measure(subject.into.get('zendaya')).headlineMentions, 1)
  assert.equal(measure(passing.into.get('zendaya')).headlineMentions, 0)
})

test('a round-up naming thirty people is not thirty stories', () => {
  // A listicle counted once in full for each name is what put one at the
  // top of the chart. Each of them gets a thirtieth of it.
  const zendaya = byId('zendaya')
  const crowd = new Array(30).fill(0).map((_, i) => `Person ${i}`).join(';')
  const solo = ingestRows([row({ persons: 'Zendaya', url: 'https://x.test/1' })], [zendaya])
  const listicle = ingestRows([row({ persons: `Zendaya;${crowd}`, url: 'https://x.test/2' })], [zendaya])
  const w = (r) => measure(r.into.get('zendaya')).windowMentions
  assert.ok(w(listicle) < w(solo) / 5, `listicle ${w(listicle)} should be far under solo ${w(solo)}`)
})

test('a two-hander splits rather than dissolves', () => {
  // Kelce and Swift in one story is half a story each, not a rounding error.
  const swift = byId('taylor-swift')
  const r = ingestRows([row({ persons: 'Taylor Swift;Travis Kelce', url: 'https://x.test/1', title: 'Travis Kelce reacts to Taylor Swift sketch' })], [swift])
  const m = measure(r.into.get('taylor-swift'))
  assert.equal(m.windowMentions, 4, 'headline credit, halved between the two of them')
})

test('only aliases safe for a query may match a headline', () => {
  /*
   * A headline match is the heaviest signal here, so it is the last place
   * to start trusting an ambiguous alias. "Swift" is a bird.
   */
  const swift = byId('taylor-swift')
  assert.equal(headlines('Taylor Swift announces tour', swift), true)
  assert.equal(headlines('Swift action taken by council', swift), false, 'the ambiguous alias must not fire')
  assert.equal(headlines('', swift), false)
  assert.equal(headlines(null, swift), false)
})

test('a headline matches on whole words only', () => {
  const zendaya = byId('zendaya')
  assert.equal(headlines('Zendaya wins', zendaya), true)
  assert.equal(headlines('ZENDAYAS new film', zendaya), false, 'not a prefix match')
})

test('drivers lead on the article they were the subject of', () => {
  const zendaya = byId('zendaya')
  const { into } = ingestRows([
    row({ persons: 'Zendaya', url: 'https://x.test/1', title: 'Ten films to watch' }),
    row({ persons: 'Zendaya', url: 'https://x.test/2', title: 'Zendaya takes the lead' }),
  ], [zendaya])
  const { drivers } = measure(into.get('zendaya'))
  assert.equal(drivers[0].title, 'Zendaya takes the lead')
  assert.equal(drivers[0].inHeadline, true)
  assert.equal(drivers[1].inHeadline, false)
})

/* ---------------- which country's press ---------------- */

test('a ccTLD names a country and a generic one names nothing', () => {
  assert.equal(countryOf('bbc.co.uk'), 'UK')
  assert.equal(countryOf('smh.com.au'), 'AU')
  assert.equal(countryOf('lemonde.fr'), 'FR')
  assert.equal(countryOf('apnews.com'), null, 'most of the American press is unplaceable, and that is fine')
  assert.equal(countryOf('theverge.io'), null, 'a startup TLD is not Indian Ocean Territory')
  assert.equal(countryOf('example.co'), null, 'nor is .co Colombia in practice')
  assert.equal(countryOf(''), null)
  assert.equal(countryOf(null), null)
})

test('counting countries can only ever under-report', () => {
  /*
   * The direction matters more than the accuracy. `uniqueCountries` was
   * hardcoded to zero, so the rule wanting two countries could never pass
   * and every single name came out flagged thin — a warning that fires
   * always is a warning nobody reads.
   */
  assert.equal(countriesIn(['bbc.co.uk', 'apnews.com', 'lemonde.fr', 'cnn.com']), 2)
  assert.equal(countriesIn(['bbc.co.uk', 'theguardian.co.uk']), 1, 'two British outlets are one country')
  assert.equal(countriesIn([]), 0)
})

test('a run of missing windows is ridden out, not given up on', async () => {
  /*
   * The live failure this was written for. GDELT announces a file in
   * lastupdate.txt before the CDN has it, and when the window before that
   * is missing too — which happens — the old code tried exactly one step
   * back and then published a zero for the entire market.
   */
  const listing = ['119543 abc http://data.gdeltproject.org/gdeltv2/20260922020000.gkg.csv.zip'].join('\n')
  const served = '20260922011500.gkg.csv.zip'
  const tried = []
  const fetchImpl = async (url) => {
    if (url.includes('lastupdate')) return { ok: true, text: async () => listing }
    tried.push(url.split('/').pop())
    if (!url.endsWith(served)) return { ok: false, status: 404 }
    return { ok: true, arrayBuffer: async () => zipSync({ 'x.csv': new TextEncoder().encode('') }).buffer }
  }
  const r = await collect([byId('zendaya')], { fetchImpl, sleep: async () => {}, now: Date.parse('2026-09-22T02:01:00Z') })
  assert.ok(tried.includes(served), `walked back to ${served}; tried ${tried.join(', ')}`)
  assert.equal(r.ok, true, 'a slightly older window beats reading nothing')
})

test('it still gives up rather than walking back forever', async () => {
  const listing = '1 a http://data.gdeltproject.org/gdeltv2/20260922020000.gkg.csv.zip'
  let calls = 0
  const fetchImpl = async (url) => {
    if (url.includes('lastupdate')) return { ok: true, text: async () => listing }
    calls++
    return { ok: false, status: 404 }
  }
  const r = await collect([byId('zendaya')], { fetchImpl, sleep: async () => {}, now: Date.parse('2026-09-22T02:01:00Z') })
  assert.equal(r.ok, false)
  assert.ok(calls <= 8, `tried ${calls} times, which is bounded`)
  assert.match(r.error, /no GKG window/)
})
