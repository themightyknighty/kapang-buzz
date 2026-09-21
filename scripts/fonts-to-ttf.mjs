#!/usr/bin/env node
/**
 * The brand fonts, in the one format the card renderer can read.
 *
 * Share cards are drawn server-side by resvg, which loads fonts from files and
 * understands TTF and OTF only. @fontsource — which the app itself uses —
 * ships woff and woff2, so the two would otherwise be different fonts and the
 * card would not look like the site.
 *
 * WOFF1 is the original sfnt with each table optionally zlib'd, so the
 * conversion is a repack rather than a re-encode: every glyph, every metric
 * and every checksum is the designer's. (woff2 is a different matter — it
 * reorders and re-encodes glyf — which is why the woff files are the source.)
 *
 * Output is committed, because Netlify bundles functions from the repo and a
 * deploy should not depend on this running:
 *
 *   node scripts/fonts-to-ttf.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { unzlibSync } from 'fflate'

const FACES = [
  ['@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff', 'bebas-neue.ttf'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff', 'plex-sans-400.ttf'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff', 'plex-sans-600.ttf'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff', 'plex-mono.ttf'],
]

const convert = (inPath, outPath) => {
  const b = readFileSync(inPath)
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (b.toString('latin1', 0, 4) !== 'wOFF') throw new Error(`${inPath}: not WOFF1`)
  const flavor = dv.getUint32(4)
  const numTables = dv.getUint16(12)

  const entries = []
  for (let i = 0; i < numTables; i++) {
    const o = 44 + i * 20
    entries.push({
      tag: b.toString('latin1', o, o + 4),
      offset: dv.getUint32(o + 4),
      compLength: dv.getUint32(o + 8),
      origLength: dv.getUint32(o + 12),
      origChecksum: dv.getUint32(o + 16),
    })
  }
  // An sfnt table directory is sorted by tag; WOFF's is not required to be.
  entries.sort((x, y) => (x.tag < y.tag ? -1 : 1))

  const datas = entries.map((e) => {
    const raw = b.subarray(e.offset, e.offset + e.compLength)
    return e.compLength < e.origLength ? Buffer.from(unzlibSync(raw)) : Buffer.from(raw)
  })

  const pad4 = (n) => (n + 3) & ~3
  let off = 12 + numTables * 16
  const offsets = datas.map((d) => { const at = off; off = pad4(off + d.length); return at })

  const out = Buffer.alloc(pad4(off))
  const maxPow = Math.floor(Math.log2(numTables))
  out.writeUInt32BE(flavor, 0)
  out.writeUInt16BE(numTables, 4)
  out.writeUInt16BE((2 ** maxPow) * 16, 6)
  out.writeUInt16BE(maxPow, 8)
  out.writeUInt16BE(numTables * 16 - (2 ** maxPow) * 16, 10)

  entries.forEach((e, i) => {
    const o = 12 + i * 16
    out.write(e.tag, o, 4, 'latin1')
    out.writeUInt32BE(e.origChecksum, o + 4)
    out.writeUInt32BE(offsets[i], o + 8)
    out.writeUInt32BE(e.origLength, o + 12)
    datas[i].copy(out, offsets[i])
  })

  writeFileSync(outPath, out)
  console.log(`  ${outPath}  ${out.length} bytes, ${numTables} tables`)
}

mkdirSync('netlify/fonts', { recursive: true })
for (const [from, to] of FACES) convert(`node_modules/${from}`, `netlify/fonts/${to}`)
