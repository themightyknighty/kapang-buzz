/**
 * Three publishing runs a day: 6am, noon and 5pm Pacific (daylight time).
 * In winter (PST) they land an hour earlier — 5am, 11am, 4pm.
 */
import { kickRun, json } from './_store.mjs'

export default async () => json(await kickRun('schedule'))

export const config = { schedule: '0 0,13,19 * * *' }
