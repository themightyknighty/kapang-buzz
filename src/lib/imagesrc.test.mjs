import { test } from 'node:test'
import assert from 'node:assert/strict'
import { imageSources } from './imagesrc.js'

test('an ordinary image gets one attempt and no invented alternatives', () => {
  const u = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Thing.jpg'
  assert.deepEqual(imageSources(u), [u])
  assert.deepEqual(imageSources(null), [])
  assert.deepEqual(imageSources(''), [])
})

test('a NASA rendition falls back through the others, itself first', () => {
  const base = 'https://images-assets.nasa.gov/image/PIA25432/PIA25432'
  const got = imageSources(`${base}~large.jpg`)
  assert.equal(got[0], `${base}~large.jpg`, 'what the feed asked for is still tried first')
  assert.deepEqual(got.map((u) => u.split('~')[1].replace('.jpg', '')), ['large', 'medium', 'orig', 'small', 'thumb'])
  assert.equal(new Set(got).size, got.length, 'no duplicates')
})

test('the size in the URL is never tried twice', () => {
  const base = 'https://images-assets.nasa.gov/image/x/x'
  const got = imageSources(`${base}~orig.jpg`)
  assert.equal(got[0], `${base}~orig.jpg`)
  assert.equal(got.filter((u) => u.endsWith('~orig.jpg')).length, 1)
  assert.equal(got.length, 5)
})

test('the exact live failures resolve to a rendition NASA actually holds', () => {
  // Both of these shipped in the feed as ~large and 404'd. NASA generated only
  // ~orig and ~thumb for them, so ~orig has to be in the list.
  for (const id of ['GSFC_20171208_Archive_e000749', '9021167']) {
    const got = imageSources(`https://images-assets.nasa.gov/image/${id}/${id}~large.jpg`)
    assert.ok(got.includes(`https://images-assets.nasa.gov/image/${id}/${id}~orig.jpg`))
    assert.ok(got.includes(`https://images-assets.nasa.gov/image/${id}/${id}~thumb.jpg`))
  }
})

test('a query string survives the rewrite', () => {
  const got = imageSources('https://images-assets.nasa.gov/image/x/x~large.jpg?v=2')
  assert.ok(got.every((u) => u.endsWith('?v=2')))
})

test('a lookalike URL from another host is left alone', () => {
  const u = 'https://evil.test/images-assets.nasa.gov/image/x/x~large.jpg'
  assert.deepEqual(imageSources(u), [u])
})

import { showable } from './imagesrc.js'

test('a picture is shown only when something established what is in it', () => {
  // The exact file that ran under the Maryland lottery headline: a Commons
  // search result, plausible metadata, nobody had looked at it.
  assert.equal(showable({ url: 'https://upload.wikimedia.org/…/Lottery_Tickets,_Ethiopia.jpg', kind: 'illustration', credit: 'Rod Waddington', licence: 'CC BY-SA 2.0' }), false)

  // The same file once the review has looked at it.
  assert.equal(showable({ url: 'https://upload.wikimedia.org/x.jpg', kind: 'illustration', review: { version: 'vision-1' } }), true)

  // A celebrity portrait: identity comes from their own Wikidata entry.
  assert.equal(showable({ url: 'https://upload.wikimedia.org/p.jpg', kind: 'person' }), true)

  assert.equal(showable(null), false)
  assert.equal(showable({ kind: 'person' }), false, 'no URL, no picture')
  assert.equal(showable({ url: 'x', kind: 'illustration', review: {} }), false, 'a stamp with no version is not a stamp')
})

/* ---------------- footage ---------------- */
import { playable } from './imagesrc.js'

test('a clip only plays once the picture desk has passed it', () => {
  // A wrong still reads as a stock illustration; a wrong clip fills the frame
  // for a minute and reads as footage of the story. This is what stopped the
  // ducks playing under a story about an elk.
  assert.equal(playable({ url: 'https://x/v.webm', review: { version: 'vision-1' } }), true)
  assert.equal(playable({ url: 'https://x/v.webm' }), false, 'unvetted footage never plays')
  assert.equal(playable({ url: 'https://x/v.webm', review: {} }), false)
  assert.equal(playable({ review: { version: 'vision-1' } }), false, 'a stamp is not a clip')
  assert.equal(playable(null), false)
  assert.equal(playable(undefined), false)
})

test('footage has no portrait exception', () => {
  // showable() lets a celebrity portrait through unreviewed because its
  // identity came from that person's own Wikidata entry. There is no
  // equivalent for footage, so kind means nothing here.
  assert.equal(playable({ url: 'https://x/v.webm', kind: 'person' }), false)
})
