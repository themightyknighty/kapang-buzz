import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatFor, formatForRoute } from './format.js'

test('a phone held upright plays the vertical cut', () => {
  // iPhone 15 / 15 Pro, portrait.
  assert.equal(formatFor({ width: 393, height: 852 }), '9x16')
  // iPhone SE, and an older, smaller one.
  assert.equal(formatFor({ width: 375, height: 667 }), '9x16')
  assert.equal(formatFor({ width: 320, height: 568 }), '9x16')
})

test('turning the phone sideways hands back to the wide cut', () => {
  assert.equal(formatFor({ width: 852, height: 393 }), '16x9')
})

test('a television, a laptop and a desktop all get the wide cut', () => {
  assert.equal(formatFor({ width: 1920, height: 1080 }), '16x9')
  assert.equal(formatFor({ width: 1440, height: 900 }), '16x9')
  assert.equal(formatFor({ width: 3840, height: 2160 }), '16x9')
})

test('it is decided by shape, so every tall device is covered without a device list', () => {
  // iPad portrait, an Android phone, and a browser window dragged narrow.
  assert.equal(formatFor({ width: 820, height: 1180 }), '9x16')
  assert.equal(formatFor({ width: 412, height: 915 }), '9x16')
  assert.equal(formatFor({ width: 600, height: 900 }), '9x16')
  // A perfect square is not portrait; the wide cut is the safer default.
  assert.equal(formatFor({ width: 800, height: 800 }), '16x9')
})

test('the cut can be pinned, for QA and for recording the social version', () => {
  assert.equal(formatFor({ width: 1920, height: 1080, forced: '9x16' }), '9x16')
  assert.equal(formatFor({ width: 393, height: 852, forced: '16x9' }), '16x9')
  // Anything else is ignored rather than trusted.
  assert.equal(formatFor({ width: 393, height: 852, forced: 'portrait' }), '9x16')
  assert.equal(formatFor({ width: 1920, height: 1080, forced: '' }), '16x9')
})

test('a screen we cannot measure gets the wide cut rather than a guess', () => {
  assert.equal(formatFor({}), '16x9')
  assert.equal(formatFor(), '16x9')
  assert.equal(formatFor({ width: 0, height: 0 }), '16x9')
  assert.equal(formatFor({ width: NaN, height: 852 }), '16x9')
})

test('/vertical is always vertical, whatever it is opened on', () => {
  // It is how the social cut is produced and recorded, on a desktop.
  assert.equal(formatForRoute('vertical', { width: 1920, height: 1080 }), '9x16')
  assert.equal(formatForRoute('watch', { width: 1920, height: 1080 }), '16x9')
  assert.equal(formatForRoute('watch', { width: 393, height: 852 }), '9x16')
})
