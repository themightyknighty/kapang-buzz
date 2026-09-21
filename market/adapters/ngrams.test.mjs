import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { parseLine, buildIndex, ingestLines, measure, clusterDocs, collect, stampFor, PATTERNS } from './ngrams.mjs'
import { byId, activeRoster } from '../roster.mjs'

const swift = byId('taylor-swift')
const rock = byId('dwayne-johnson')
const pascal = byId('pedro-pascal')
const zendaya = byId('zendaya')
const NOW = Date.parse('2026-09-17T14:20:00Z')

/** A line in the JSON layout, which carries the article URL. */
const j = (url, pre, ngram, post, lang = 'ENGLISH') =>
  JSON.stringify({ url, lang, pre, ngram, post, pos: 1 })

/* ---------------- parsing ---------------- */

test('both file layouts parse, and rubbish is skipped rather than thrown', () => {
  const json = parseLine(j('https://apnews.com/a', 'reports say', 'Taylor Swift announced a', 'tour today'))
  assert.equal(json.url, 'https://apnews.com/a')
  assert.equal(json.lang, 'ENGLISH')
  assert.match(json.text, /Taylor Swift announced a/)
  assert.match(json.text, /reports say/, 'the surrounding words are kept — they disambiguate')

  const tsv = parseLine('doc-42\tZendaya wore a gown\t3')
  assert.equal(tsv.docId, 'doc-42')
  assert.equal(tsv.count, 3)
  assert.equal(tsv.url, null, 'the tab layout has no URL, and must not invent one')

  assert.equal(parseLine(''), null)
  assert.equal(parseLine('   '), null)
  assert.equal(parseLine('{not json'), null)
  assert.equal(parseLine('onlyonecolumn'), null)
})

/* ---------------- the token index ---------------- */

test('the index only offers candidates that share a distinctive word', () => {
  const index = buildIndex(activeRoster())
  assert.ok(index.get('chalamet')?.some((c) => c.id === 'timothee-chalamet'))
  assert.ok(index.get('zendaya')?.some((c) => c.id === 'zendaya'))
  // Short, common words would drag in half the roster on every line.
  assert.equal(index.get('the'), undefined)
  assert.equal(index.get('kim'), undefined)
  assert.ok((index.get('swift') || []).length <= 2, 'a surname should not fan out widely')
})

test('the index makes a full file cheap to scan', () => {
  const roster = activeRoster()
  const index = buildIndex(roster)
  // A line of ordinary news touching nobody costs one lookup per word.
  const before = Date.now()
  const noise = Array.from({ length: 20000 }, (_, i) => j(`https://x.example/${i}`, 'the council said', 'a new bridge will open', 'next spring'))
  const into = ingestLines(noise, roster, { index })
  assert.equal(into.size, 0, 'unrelated coverage matches nobody')
  assert.ok(Date.now() - before < 4000, 'scanning 20k lines must stay fast')
})

/* ---------------- matching, including the traps ---------------- */

test('names are matched from the phrase, and the traps still fail', () => {
  const roster = [swift, rock, pascal, zendaya]
  const lines = [
    j('https://apnews.com/1', 'in a post', 'Taylor Swift announced the', 'dates last night'),
    j('https://variety.com/2', 'sources say', 'Zendaya will star in', 'the sequel'),
    j('https://bbc.co.uk/3', 'actor', 'Pedro Pascal told reporters', 'at the premiere'),
    // The 4-word window disambiguates: this "Pascal" is the mathematician.
    j('https://sciencemag.org/4', 'a study of', 'Blaise Pascal and his', 'early calculating machine'),
    j('https://audubon.org/5', 'the', 'chimney swift population rebounded', 'this year'),
    j('https://politics.example/6', 'former minister', 'Boris Johnson published a', 'memoir this week'),
    j('https://wsj.com/7', 'shares of', 'Johnson & Johnson rose', 'on the news'),
  ]
  const into = ingestLines(lines, roster)
  assert.ok(into.has('taylor-swift'))
  assert.ok(into.has('zendaya'))
  assert.ok(into.has('pedro-pascal'))
  assert.equal(into.get('pedro-pascal').size, 1, 'Blaise Pascal is not Pedro Pascal')
  assert.ok(!into.has('dwayne-johnson'), 'neither Boris nor the pharmaceutical company is The Rock')
  assert.equal(into.get('taylor-swift').size, 1, 'the bird story is not Taylor Swift')
})

test('an ambiguous alias counts when the phrase carries its context', () => {
  const lines = [
    // "Swift" alone, but "Eras" confirms it.
    j('https://billboard.com/1', 'fans at the', 'Swift Eras Tour finale', 'in December'),
    // "Swift" alone with nothing to confirm it.
    j('https://reuters.com/2', 'the company moved', 'swift action was taken', 'by regulators'),
  ]
  const into = ingestLines(lines, [swift])
  assert.equal(into.get('taylor-swift')?.size, 1, 'context confirms one and not the other')
})

/* ---------------- syndication ---------------- */

test('a wire story carried everywhere counts once, with breadth', () => {
  const phrases = ['Taylor Swift announced a', 'announced a joint stadium', 'a joint stadium tour']
  const lines = []
  for (let i = 0; i < 40; i++) {
    for (const p of phrases) lines.push(j(`https://clone${i}.example.com/a`, 'reports say', p, 'today'))
  }
  // A genuinely different story about the same person.
  lines.push(j('https://people.com/z', 'she was', 'Taylor Swift spotted leaving a', 'studio in Nashville'))

  const into = ingestLines(lines, [swift])
  const m = measure(swift, into.get('taylor-swift'), { now: NOW })
  assert.equal(m.documents, 41, 'every copy is seen')
  assert.equal(m.mentions, 2, 'but they collapse into two stories')
  assert.equal(m.largestCluster, 40)
  assert.equal(m.uniqueSources, 41, 'breadth still counts every publisher')
})

test('clustering needs real overlap, not just one shared phrase', () => {
  const docs = new Map([
    ['a', { phrases: new Set(['one two three four', 'two three four five', 'three four five six']), url: 'https://a.test/1' }],
    ['b', { phrases: new Set(['one two three four', 'nothing else in common', 'entirely different words']), url: 'https://b.test/1' }],
  ])
  assert.equal(clusterDocs(docs).length, 2, 'one phrase in common is not the same story')
})

/* ---------------- measurement ---------------- */

test('measure reports publishers honestly when the layout has no URLs', () => {
  const docs = new Map([
    ['doc-1', { phrases: new Set(['Zendaya wore a gown']), url: null, lang: null }],
    ['doc-2', { phrases: new Set(['Zendaya attended the premiere']), url: null, lang: null }],
  ])
  const m = measure(zendaya, docs, { now: NOW })
  assert.equal(m.mentions, 2)
  assert.equal(m.uniqueSources, 0, 'no URLs means no publishers claimed, not fabricated ones')
  assert.equal(m.drivers.length, 2)
  assert.equal(m.drivers[0].url, null)
})

test('prominent outlets lift breadth above content farms', () => {
  const wide = new Map(['https://apnews.com/1', 'https://bbc.co.uk/2', 'https://nytimes.com/3']
    .map((u, i) => [`d${i}`, { phrases: new Set([`story ${i} words here`]), url: u, lang: 'ENGLISH' }]))
  const farm = new Map(['https://spam1.example/1', 'https://spam2.example/2', 'https://spam3.example/3']
    .map((u, i) => [`d${i}`, { phrases: new Set([`story ${i} words here`]), url: u, lang: 'ENGLISH' }]))
  assert.ok(measure(zendaya, wide).prominence > measure(zendaya, farm).prominence)
})

/* ---------------- fetching ---------------- */

const gz = (lines) => gzipSync(Buffer.from(lines.join('\n')))

test('collect reads the window, matches everyone, and reports what it did', async () => {
  const roster = [swift, zendaya, rock]
  const seen = []
  const fetchImpl = async (url) => {
    seen.push(url)
    if (!url.includes('webngrams')) return { ok: false, status: 404 }
    const body = gz([
      j('https://apnews.com/1', 'in a post', 'Taylor Swift announced the', 'dates last night'),
      j('https://variety.com/2', 'sources say', 'Zendaya will star in', 'the sequel'),
      j('https://bbc.co.uk/3', 'the actor', 'Dwayne Johnson joins the', 'cast of the film'),
    ])
    return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) }
  }
  const log = []
  const r = await collect(roster, { now: NOW, fetchImpl, log, minutes: 3 })
  assert.equal(r.files, 3)
  assert.equal(r.signals.length, 3, 'all three measured from one pass')
  for (const s of r.signals) {
    assert.equal(s.source, 'news')
    assert.ok(s.raw >= 1)
    assert.equal(s.series, null, 'these files are a slice of now, not a history')
    assert.ok(s.freshnessSeconds > 0, 'the lag is reported, not hidden')
  }
  assert.ok(log.join(' ').includes('3 files'))
  // Once a pattern answers it is reused, so three minutes cost three
  // requests rather than probing every layout again each time.
  assert.equal(seen.length, 3, `expected one request per minute, got ${seen.length}`)
  assert.ok(seen.every((u) => u.includes('webngrams')))
})

test('a missing file is skipped, and a run with no files at all says so', async () => {
  const log = []
  const r = await collect([swift], { now: NOW, fetchImpl: async () => ({ ok: false, status: 404 }), log, minutes: 2 })
  assert.deepEqual(r.signals, [])
  assert.equal(r.files, 0)
  assert.ok(log.some((l) => l.includes('no files could be read')))
})

test('a corrupt file does not take the run down', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('not gzip at all, just text here').buffer })
  const log = []
  const r = await collect([swift], { now: NOW, fetchImpl, log, minutes: 1 })
  assert.equal(r.files, 0)
  assert.ok(Array.isArray(r.signals))
})

test('file stamps are UTC minutes and the patterns build real URLs', () => {
  assert.equal(stampFor(new Date('2026-09-17T14:07:00Z')), '20260917140700')
  assert.equal(stampFor(new Date('2026-01-02T03:04:00Z')), '20260102030400')
  for (const p of PATTERNS) {
    const u = p.url('20260917140700')
    assert.match(u, /^https:\/\/data\.gdeltproject\.org\//)
    assert.match(u, /20260917140700/)
    assert.match(u, /\.gz$/)
  }
})
