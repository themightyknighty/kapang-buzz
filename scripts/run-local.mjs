/**
 * Run the pipeline on this machine, storing to ./.data instead of Netlify.
 *   ANTHROPIC_API_KEY=... npm run run:local
 * Writes .data/feed.json, which `npm run dev` serves at /api/feed.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { runPipeline } from '../pipeline/run.mjs'

const dir = new URL('../.data/', import.meta.url)
await mkdir(dir, { recursive: true })
const store = {
  getJSON: async (k) => { try { return JSON.parse(await readFile(new URL(k, dir), 'utf8')) } catch { return null } },
  setJSON: async (k, v) => writeFile(new URL(k, dir), JSON.stringify(v, null, 2)),
}
const r = await runPipeline({ store, trigger: 'local' })
console.log(r.lines.join('\n'))
console.log(`\n${r.ok ? 'OK' : 'FAILED'} — published ${r.published}`, r.byStrand)
if (r.dropped.length) console.log('\nDropped:\n' + r.dropped.map((d) => `  [${d.stage}] ${d.strand}: ${d.title} — ${d.reason}`).join('\n'))
