import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bulletinScript, greeting, renderBody, requestRender, readStatus, waitForRender, makeBulletin, scrub } from './bulletin.mjs'

const story = (headline) => ({ id: headline, headline })
const NOON = new Date('2026-09-18T13:00:00')

/* ---------------- what she says ---------------- */

test('the bulletin reads the headlines and nothing else', () => {
  const s = bulletinScript([story('Elk jumps on a car'), story('Painting bought for $30')], { now: NOON })
  assert.match(s, /Here are today's headlines/)
  assert.match(s, /Elk jumps on a car/)
  assert.match(s, /And finally, painting bought for \$30/, 'the last one is signalled as the last')
  assert.match(s, /coming up/)
  // The stories that follow carry their own captions and key facts; a
  // bulletin that summarised them would be the channel saying it all twice.
  assert.ok(!s.includes('caption'), 'headlines only')
})

test('she says good morning in the morning', () => {
  assert.equal(greeting(8), 'Good morning')
  assert.equal(greeting(13), 'Good afternoon')
  assert.equal(greeting(19), 'Good evening')
  assert.match(bulletinScript([story('A thing happened')], { now: new Date('2026-09-18T07:00:00') }), /^Good morning/)
})

test('a single headline is not introduced as a list of one', () => {
  const s = bulletinScript([story('One thing happened')], { now: NOON })
  assert.ok(!s.includes('And finally'), 'there is no finally when there is only one')
})

test('a headline written to be read is tidied before it is spoken', () => {
  // "Alan Ritchson May Star in Helldivers Movie." read aloud with the full
  // stop already on it lands like a shrug.
  const s = bulletinScript([story('A thing happened.   ')], { now: NOON })
  assert.ok(!s.includes('happened..'))
  assert.match(s, /A thing happened\./)
})

test('no headlines means no bulletin, not an empty one', () => {
  assert.equal(bulletinScript([], { now: NOON }), null)
  assert.equal(bulletinScript(null, { now: NOON }), null)
  assert.equal(bulletinScript([{ headline: '   ' }], { now: NOON }), null)
})

test('the bulletin is capped, however long the feed is', () => {
  const many = Array.from({ length: 30 }, (_, i) => story(`Story number ${i}`))
  const s = bulletinScript(many, { now: NOON, max: 5 })
  // Case-insensitive: "And finally" lowercases the headline that follows it.
  assert.equal((s.match(/story number/gi) || []).length, 5)
})

/* ---------------- the request ---------------- */

test('the render asks for the cut the caller wants, with our own captions off', () => {
  const b = renderBody('Hello.', { avatarUrl: 'https://cdn/x.jpg', aspectRatio: '16:9' })
  assert.equal(b.workflow, 'avatar-to-video')
  assert.equal(b.source.text, 'Hello.')
  assert.equal(b.avatar.url, 'https://cdn/x.jpg')
  assert.equal(b.aspectRatio, '16:9')
  // The show draws its own headline furniture; burnt-in captions would collide.
  assert.equal(b.captions.enabled, false)
  assert.equal(renderBody('Hi.', { avatarUrl: 'https://cdn/x.jpg', aspectRatio: '9:16' }).aspectRatio, '9:16')
})

test('a render without an avatar is refused rather than guessed at', () => {
  assert.throws(() => renderBody('Hello.', {}), /no avatar image/)
  assert.throws(() => renderBody(null, { avatarUrl: 'https://cdn/x.jpg' }), /nothing to read/)
})

test('the key travels in a header, never in the URL', async () => {
  const seen = []
  const fetchImpl = async (url, init) => {
    seen.push({ url, headers: init?.headers || {} })
    return { ok: true, text: async () => JSON.stringify({ pid: 'p1' }) }
  }
  const pid = await requestRender(renderBody('Hi.', { avatarUrl: 'https://cdn/x.jpg' }), { apiKey: 'SECRET', fetchImpl })
  assert.equal(pid, 'p1')
  assert.ok(!seen[0].url.includes('SECRET'), 'a key in a URL is a key in every log and history file')
  assert.equal(seen[0].headers.key, 'SECRET')
})

test('a missing key is caught before anything is sent', async () => {
  let called = false
  await assert.rejects(
    () => requestRender({}, { apiKey: '', fetchImpl: async () => { called = true } }),
    /REVID_API_KEY/,
  )
  assert.equal(called, false)
})

test('a key echoed back in an error never reaches the log', async () => {
  // Some APIs quote the request back at you when they reject it.
  const fetchImpl = async () => ({ ok: false, status: 400, text: async () => 'bad request with key SECRET in it' })
  await assert.rejects(
    () => requestRender({}, { apiKey: 'SECRET', fetchImpl }),
    (err) => !err.message.includes('SECRET') && /«key»/.test(err.message),
  )
  assert.equal(scrub('a SECRET b', 'SECRET'), 'a «key» b')
  assert.equal(scrub('nothing here', null), 'nothing here')
})

/* ---------------- waiting ---------------- */

const statusRun = (sequence) => {
  let i = 0
  return async () => ({ ok: true, text: async () => JSON.stringify(sequence[Math.min(i++, sequence.length - 1)]) })
}

test('it waits for the render and hands back the video', async () => {
  const log = []
  const out = await waitForRender('p1', {
    apiKey: 'k', log, everyMs: 0, sleep: async () => {},
    fetchImpl: statusRun([
      { status: 'building', progress: 10 },
      { status: 'rendering', progress: 60 },
      { status: 'ready', videoUrl: 'https://cdn/out.mp4' },
    ]),
  })
  assert.deepEqual(out, { ok: true, videoUrl: 'https://cdn/out.mp4' })
  assert.equal(log.filter((l) => l.includes('rendering')).length, 1, 'one line per change of state, not one per poll')
})

test('a failed render is reported, not waited out', async () => {
  const out = await waitForRender('p1', {
    apiKey: 'k', everyMs: 0, sleep: async () => {},
    fetchImpl: statusRun([{ status: 'error', errorMessage: 'avatar unusable' }]),
  })
  assert.deepEqual(out, { ok: false, error: 'avatar unusable' })
})

test('a render that never finishes gives up rather than hanging the run', async () => {
  // A feed run must never wait on somebody else's queue.
  let clock = 0
  const out = await waitForRender('p1', {
    apiKey: 'k', everyMs: 1000, timeoutMs: 10_000,
    sleep: async () => { clock += 1000 }, now: () => clock,
    fetchImpl: statusRun([{ status: 'rendering', progress: 5 }]),
  })
  assert.equal(out.ok, false)
  assert.match(out.error, /not ready after 10s/)
})

test('a status reply with no video is not treated as ready', async () => {
  let clock = 0
  const out = await waitForRender('p1', {
    apiKey: 'k', everyMs: 1000, timeoutMs: 3000, sleep: async () => { clock += 1000 }, now: () => clock,
    fetchImpl: statusRun([{ status: 'ready' }]),
  })
  assert.equal(out.ok, false)
})

test('the status call carries the job id and the key', async () => {
  const seen = []
  await readStatus('p 1', { apiKey: 'k', fetchImpl: async (url, init) => { seen.push({ url, init }); return { ok: true, text: async () => '{"status":"ready","videoUrl":"u"}' } } })
  assert.match(seen[0].url, /pid=p%201/, 'the id is encoded, not pasted')
  assert.equal(seen[0].init.headers.key, 'k')
})

/* ---------------- the whole job ---------------- */

test('a bulletin carries what it says and that the presenter is not a person', async () => {
  const out = await makeBulletin([story('A thing happened'), story('Another thing')], {
    apiKey: 'k', avatarUrl: 'https://cdn/a.jpg', everyMs: 0, sleep: async () => {}, now: NOON,
    fetchImpl: async (url) => (url.includes('/render')
      ? { ok: true, text: async () => '{"pid":"p1"}' }
      : { ok: true, text: async () => '{"status":"ready","videoUrl":"https://cdn/out.mp4"}' }),
  })
  assert.equal(out.videoUrl, 'https://cdn/out.mp4')
  assert.equal(out.presenter, 'synthetic', 'the screen says so, so the data had better')
  assert.deepEqual(out.headlines, ['A thing happened', 'Another thing'])
  assert.match(out.script, /Here are today's headlines/)
})

test('a bulletin that cannot be made costs the show nothing', async () => {
  // No presenter this cycle is a missing nicety. A pipeline run that throws
  // is a missing feed.
  const log = []
  const out = await makeBulletin([story('A thing happened')], {
    apiKey: 'k', avatarUrl: 'https://cdn/a.jpg', log, everyMs: 0, sleep: async () => {},
    fetchImpl: async () => { throw new Error('revid is down') },
  })
  assert.equal(out, null)
  assert.match(log.join(' '), /runs without a presenter/)
})
