/**
 * How often one player or one address may ask, counted in memory only: nothing here is written down, and every
 * count is forgotten once its window has passed (addresses within the hour; PRD MP-23).
 */
export class Limit {
  private seen = new Map<string, number[]>()

  constructor(
    private most: number,
    private window: number,
  ) {}

  /** Counts one more for `key` at `now`; false if that is more than allowed in the window. */
  take(key: string, now: number): boolean {
    const times = (this.seen.get(key) ?? []).filter((t) => t > now - this.window)
    if (times.length >= this.most) {
      this.seen.set(key, times)
      return false
    }
    times.push(now)
    this.seen.set(key, times)
    return true
  }

  /** Forgets every key whose window has passed. */
  sweep(now: number): void {
    for (const [key, times] of this.seen) if (!times.some((t) => t > now - this.window)) this.seen.delete(key)
  }

  get size(): number {
    return this.seen.size
  }
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** The limits of docs/API.md, and a few more against scripts. */
export function limits(opts: { playersPerHour?: number; requestsPerMinute?: number } = {}) {
  return {
    /** Months ended by one player (docs/API.md). */
    months: new Limit(30, MINUTE),
    /**
     * New players from one address. Generous, since mobile carriers put thousands of phones behind one address
     * (NEW_PLAYERS_PER_HOUR).
     */
    players: new Limit(opts.playersPerHour ?? 200, HOUR),
    /** Requests of any kind from one address. */
    requests: new Limit(opts.requestsPerMinute ?? 600, MINUTE),
    /** Sign-in links asked for, by address and by email address. */
    mailsByAddress: new Limit(5, HOUR),
    mailsByEmail: new Limit(3, HOUR),
    /** Tries at a sign-in code or a friend code from one address, against guessing. */
    guesses: new Limit(20, HOUR),
    /** New games by one player, practice included. */
    games: new Limit(30, HOUR),
  }
}
