import type { Done, Game, Season } from '../rules/types'

/**
 * Raise this when a change to the rules or the model would make a kept game play out differently, so that an old
 * game is not carried on as if nothing had changed.
 */
export const KEEP_VERSION = 1

/** A game as it is kept in the browser between visits. */
export interface Kept {
  version: string
  season: Season
  done: Done[]
  /** The month reached, since the actions alone do not say how far the game was played. */
  month: number
  /** When each month was ended, in milliseconds, for the daily allowance. */
  times: number[]
  /** The game as it stood, so that it need not be played again from the start. */
  game: Game | null
}

const DB = 'peak-ooru'
const STORE = 'games'
/** The one game kept before games were kept by their id on the server (slice 8). */
export const OLD_KEY = 'current'

/** Opens the store, or gives null where the browser will not keep anything (a private window, storage full). */
function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
      // Some browsers never answer at all when storage is refused.
      setTimeout(() => resolve(null), 3000)
    } catch {
      resolve(null)
    }
  })
}

let db: Promise<IDBDatabase | null> | null = null

async function store(mode: IDBTransactionMode): Promise<IDBObjectStore | null> {
  db ??= open()
  const opened = await db
  try {
    return opened?.transaction(STORE, mode).objectStore(STORE) ?? null
  } catch {
    return null
  }
}

/** The kept game, by its id, or null if there is none or it cannot be read. */
export async function readKept(key: string): Promise<Kept | null> {
  const s = await store('readonly')
  if (!s) return null
  return new Promise((resolve) => {
    try {
      const request = s.get(key)
      request.onsuccess = () => resolve((request.result as Kept | undefined) ?? null)
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

/** Keeps the game by its id, or forgets it; says whether it was done. A failure never stops the game. */
export async function writeKept(key: string, kept: Kept | null): Promise<boolean> {
  const s = await store('readwrite')
  if (!s) return false
  return new Promise((resolve) => {
    try {
      const request = kept ? s.put(kept, key) : s.delete(key)
      request.onsuccess = () => resolve(true)
      request.onerror = () => resolve(false)
    } catch {
      resolve(false)
    }
  })
}

/** Whether a kept game's own record of its actions agrees with the list kept beside it. */
export function matches(kept: Kept): boolean {
  const { game } = kept
  return !!game && game.month === kept.month && game.season.id === kept.season.id &&
    JSON.stringify(game.done) === JSON.stringify(kept.done)
}

/** Forgets every game kept in this browser, as when the player deletes everything. */
export async function forgetAll(): Promise<void> {
  const s = await store('readwrite')
  await new Promise<void>((resolve) => {
    try {
      const request = s?.clear()
      if (!request) return resolve()
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}
