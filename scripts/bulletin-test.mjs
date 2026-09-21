#!/usr/bin/env node
/**
 * Render one headline bulletin and print the video URL.
 *
 * This exists as a script rather than a pipeline step because revid.ai is not
 * reachable from the sandbox this project is usually worked on from — the
 * egress proxy refuses it outright. It runs on a machine with ordinary
 * internet access, which is the same reason deploys are run by hand.
 *
 *   export REVID_API_KEY=...            # never on the command line: see below
 *   node scripts/bulletin-test.mjs --avatar https://cdn.revid.ai/ai-gen/XXXX.jpg
 *
 * Then watch her read them:
 *
 *   npm run dev
 *   open 'http://localhost:5173/watch?bulletin=<the URL this printed>'
 *
 * Options:
 *   --avatar <url>    the presenter's image. Required. Use an AI-generated
 *                     face from revid's own library — never a photograph of a
 *                     real person.
 *   --ratio 16:9|9:16 which cut to render for. Default 16:9.
 *   --feed <url>      where to read headlines from. Default: the live site.
 *   --voice <id>      a revid voice id, if you have picked one.
 *   --dry             write the script and the request body, send nothing.
 *
 * The key comes from the environment and never from a flag: anything on a
 * command line is in the shell history, in `ps`, and in any crash report the
 * machine happens to write.
 */
import { writeFile } from 'node:fs/promises'
import { bulletinScript, renderBody, requestRender, waitForRender, scrub } from '../pipeline/bulletin.mjs'

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const value = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }

const AVATAR = value('--avatar')
const RATIO = value('--ratio', '16:9')
const FEED = value('--feed', 'https://kapang-buzz.netlify.app/api/feed')
const VOICE = value('--voice')
const DRY = flag('--dry')
const KEY = process.env.REVID_API_KEY || ''

const die = (msg) => { console.error(`\n  ${msg}\n`); process.exit(1) }

const headlines = async () => {
  process.stdout.write(`Reading headlines from ${FEED}\n`)
  const res = await fetch(FEED, { headers: { accept: 'application/json' } })
  if (!res.ok) die(`the feed answered HTTP ${res.status}`)
  const feed = await res.json()
  // Whatever the show would lead with: the most widely reported first.
  return (feed.stories || [])
    .slice()
    .sort((a, b) => (b.outlets || 0) - (a.outlets || 0) || Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
}

const run = async () => {
  if (!AVATAR) {
    die('--avatar is required.\n'
      + '  Open revid.ai/create, pick an AI-generated presenter and copy her image URL.\n'
      + '  It must not be a photograph of a real person.')
  }
  if (!DRY && !KEY) {
    die('REVID_API_KEY is not set.\n'
      + '  export REVID_API_KEY=...   (in the shell, not on this command line)')
  }

  const stories = await headlines()
  const script = bulletinScript(stories)
  if (!script) die('the feed had no headlines to read')

  console.log(`\n── what she says ──\n${script}\n`)
  console.log(`   ${script.split(/\s+/).length} words · roughly ${Math.round(script.split(/\s+/).length / 2.6)}s to read\n`)

  const body = renderBody(script, { avatarUrl: AVATAR, aspectRatio: RATIO, voiceId: VOICE })
  if (DRY) {
    await writeFile('bulletin-request.json', JSON.stringify(body, null, 2))
    console.log('--dry: wrote bulletin-request.json, sent nothing.')
    return
  }

  process.stdout.write(`Rendering ${RATIO}…\n`)
  const started = Date.now()
  const log = []
  const pid = await requestRender(body, { apiKey: KEY })
  console.log(`   job ${pid}`)

  const out = await waitForRender(pid, {
    apiKey: KEY, log, everyMs: 5000, timeoutMs: 10 * 60000,
  })
  // The log is printed rather than streamed so the key-scrubbing in
  // bulletin.mjs is the only path anything from revid takes to a terminal.
  for (const line of log) console.log(`   ${scrub(line, KEY)}`)

  if (!out.ok) die(`render failed: ${scrub(out.error, KEY)}`)

  const secs = Math.round((Date.now() - started) / 1000)
  console.log(`\n── ready in ${secs}s ──\n${out.videoUrl}\n`)
  console.log('Watch her read them:')
  console.log(`  npm run dev`)
  console.log(`  open 'http://localhost:5173/watch?bulletin=${encodeURIComponent(out.videoUrl)}'\n`)

  await writeFile('bulletin.json', JSON.stringify({
    videoUrl: out.videoUrl, pid, script, aspectRatio: RATIO,
    presenter: 'synthetic', provider: 'revid.ai', at: new Date().toISOString(),
    headlines: stories.slice(0, 5).map((s) => s.headline),
  }, null, 2))
  console.log('Saved bulletin.json (no key in it).')
}

run().catch((err) => die(scrub(err.message, KEY)))
