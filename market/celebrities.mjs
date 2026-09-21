/**
 * The canonical celebrity table, and the alias model that stops the index
 * counting the wrong people.
 *
 * Naive string counting is the failure mode to design against. "Swift" is a
 * bird, "Johnson" is half a phone book and "Pascal" is a programming
 * language. So every alias carries a strength that decides how it may be
 * used, and only the safe ones are ever put into a search query.
 *
 * Pure: no network, no storage, no clock.
 */
import { CATEGORY_KEYS } from './config.mjs'

/**
 * unique     — identifies the person on its own ("Timothée Chalamet")
 * strong     — near-unique inside entertainment coverage ("The Rock")
 * ambiguous  — only counts alongside one of its `requires` terms ("Swift")
 */
export const STRENGTHS = ['unique', 'strong', 'ambiguous']

export const slugify = (name) => name.toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** Build one full record from the terse seed form. */
export function makeCelebrity(seed, now = '2026-09-17T00:00:00.000Z') {
  const slug = seed.slug || slugify(seed.name)
  const aliases = [
    { text: seed.name, strength: 'unique' },
    ...(seed.aliases || []).map((a) => (Array.isArray(a)
      ? { text: a[0], strength: a[1] || 'unique', ...(a[2] ? { requires: a[2] } : {}) }
      : a)),
  ]
  return {
    id: seed.id || slug,
    displayName: seed.name,
    slug,
    aliases,
    excludes: seed.excludes || [],
    occupation: seed.occupation || '',
    primaryCategory: seed.cat,
    secondaryCategories: seed.also || [],
    country: seed.country || 'US',
    // Resolved at ingestion from Wikimedia Commons under a free licence only.
    imageUrl: null, imageCredit: null, imageLicence: null,
    wikipediaPageTitle: seed.page,
    wikipediaUrl: `https://en.wikipedia.org/wiki/${seed.page}`,
    wikidataId: null, tmdbId: null, imdbId: null, dateOfBirth: null,
    active: seed.active !== false,
    createdAt: now, updatedAt: now,
  }
}

/** Every alias safe to put in a search query — the ambiguous ones are not. */
export const queryAliases = (c) => c.aliases.filter((a) => a.strength !== 'ambiguous')

/** Aliases that need corroborating text before they count. */
export const weakAliases = (c) => c.aliases.filter((a) => a.strength === 'ambiguous')

/**
 * Which shard a celebrity is swept in. Stable across runs and independent of
 * roster order, so adding a celebrity does not reshuffle everyone else.
 */
export function shardOf(id, shards) {
  let h = 7
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h % shards
}

/** Structural check — run over the roster by a test, not at runtime. */
export function validateCelebrity(c) {
  const errs = []
  if (!c.id) errs.push('missing id')
  if (!c.displayName) errs.push('missing displayName')
  if (!c.wikipediaPageTitle) errs.push(`${c.id}: missing wikipediaPageTitle`)
  if (!CATEGORY_KEYS.includes(c.primaryCategory)) errs.push(`${c.id}: bad category ${c.primaryCategory}`)
  if (!c.aliases?.length) errs.push(`${c.id}: no aliases`)
  for (const a of c.aliases || []) {
    if (!STRENGTHS.includes(a.strength)) errs.push(`${c.id}: bad alias strength ${a.strength}`)
    if (a.strength === 'ambiguous' && !a.requires?.length) errs.push(`${c.id}: ambiguous alias "${a.text}" has no requires`)
  }
  return errs
}
