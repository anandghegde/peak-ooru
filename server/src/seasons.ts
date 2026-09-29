import { version } from '../../src/rules/index'
import type { Season } from '../../src/rules/types'
import { firstSeason } from '../../src/seasons/first'
import { openSeason as openSetup } from '../../src/seasons/open'
import { order } from './board'
import type { SeasonRow, Store } from './store'

/** The set-ups a season can be opened with, by name (`npm run season -- open <name>`). */
export const SETUPS: Record<string, { season: Season; twist: string }> = {
  first: { season: firstSeason, twist: 'Bengaluru as it stands in January 2026.' },
  open: { season: openSetup, twist: 'Bengaluru as it stands in January 2026. Twelve months a day.' },
}

export const DAY = 86_400_000
/** Four weeks (PRD MP-1). */
export const LENGTH = 28 * DAY

/** Whether a season's ranked play is over: closed, or past its closing time. */
export const over = (s: SeasonRow, now: number) => s.closed !== null || now >= Date.parse(s.closes)

/**
 * The season a new player is put in: the newest that has opened and not closed; failing that, the newest that has
 * opened, which stays open for practice (PRD MP-5).
 */
export async function current(store: Store, now: number): Promise<SeasonRow | null> {
  const opened = (await store.seasons()).filter((s) => Date.parse(s.opens) <= now)
  return opened.find((s) => !over(s, now)) ?? opened[0] ?? null
}

export async function openSeason(
  store: Store,
  setup: string,
  opts: { id?: string; name?: string; twist?: string; opens?: number; days?: number },
  now: number,
): Promise<SeasonRow> {
  const chosen = SETUPS[setup]
  if (!chosen) throw new Error(`No set-up called ${setup}. There are: ${Object.keys(SETUPS).join(', ')}.`)
  const opens = opts.opens ?? now
  const iso = new Date(opens).toISOString()
  const row: SeasonRow = {
    id: opts.id ?? `${setup}-${iso.slice(0, 10)}`,
    name: opts.name ?? chosen.season.name,
    twist: opts.twist ?? chosen.twist,
    opens: iso,
    closes: new Date(opens + (opts.days ? opts.days * DAY : LENGTH)).toISOString(),
    rules: version,
    season: chosen.season,
    closed: null,
  }
  if (await store.season(row.id)) throw new Error(`A season called ${row.id} is there already.`)
  await store.addSeason(row)
  return row
}

/**
 * Closes a season: ranks are fixed over the named players' ranked games, as they stand, finished or not (PRD MP-11).
 * Games in progress are left as they are, and can no longer be played for rank.
 */
export async function closeSeason(store: Store, id: string, now: number): Promise<number> {
  const s = await store.season(id)
  if (!s) throw new Error(`There is no season called ${id}.`)
  if (s.closed) throw new Error(`The season ${id} closed at ${s.closed}.`)
  const rows = (await store.board(id)).sort(order)
  await store.closeSeason(id, new Date(now).toISOString(), rows.map((r, i) => [r.game, i + 1]))
  return rows.length
}

/** Closes every season whose time is up. */
export async function closeDue(store: Store, now: number): Promise<string[]> {
  const due = (await store.seasons()).filter((s) => s.closed === null && now >= Date.parse(s.closes))
  for (const s of due) await closeSeason(store, s.id, now)
  return due.map((s) => s.id)
}
