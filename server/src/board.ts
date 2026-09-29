import type { BoardSource, Store } from './store'

/** A row of the board as docs/API.md gives it. */
export interface BoardRow {
  rank: number
  player: { id: string; name: string }
  game: string
  score: number
  points: number[]
  status: BoardSource['status']
  year: number
  open: boolean
}

/** Higher score first; at the same score the earlier finish; then the earlier start. */
export function order(a: BoardSource, b: BoardSource): number {
  if (a.score !== b.score) return b.score - a.score
  if (a.ended !== b.ended) {
    if (a.ended === null) return 1
    if (b.ended === null) return -1
    return a.ended < b.ended ? -1 : 1
  }
  if (a.started !== b.started) return a.started < b.started ? -1 : 1
  return a.game < b.game ? -1 : a.game > b.game ? 1 : 0
}

/** The year a game has reached, 2026 to 2036. */
export const yearOf = (month: number) => 2026 + Math.floor(month / 12)

interface Ranked {
  rows: BoardRow[]
  byGame: Map<string, BoardRow>
  byPlayer: Map<string, BoardRow>
  byZone: Map<number, BoardRow[]>
  zoneOf: Map<string, number | null>
  made: number
  closed: boolean
}

/** A board is made again after this long whatever happens, for changes made by the commands, in another process. */
const LONGEST = 60_000

/**
 * The board of each season, kept in memory and made again from the store at most once every `fresh` milliseconds
 * after a change, so that reading it costs a slice of an array however many read it. Ranks are over everyone named
 * in the season; the friends and zone boards are the same ranks, filtered. A closed season's ranks are those fixed.
 */
export class Board {
  private made = new Map<string, Ranked>()
  private stale = new Set<string>()

  constructor(
    private store: Store,
    private now: () => number,
    private fresh = 2000,
  ) {}

  /** Something on a season's board changed: a month ended, a name, a zone, a player gone. */
  touch(season?: string): void {
    if (season === undefined) for (const s of this.made.keys()) this.stale.add(s)
    else this.stale.add(season)
  }

  /**
   * A player's name or zone changed: every board is made again at its next reading, at once, so that a player who
   * has just named themselves finds their row.
   */
  drop(): void {
    this.made.clear()
    this.stale.clear()
  }

  async ranked(season: string, closed: boolean): Promise<Ranked> {
    const had = this.made.get(season)
    const age = had ? this.now() - had.made : Infinity
    if (had && had.closed === closed && age < LONGEST && (!this.stale.has(season) || age < this.fresh)) return had
    this.stale.delete(season)
    const source = await this.store.board(season)
    const sorted = closed
      ? source.filter((r) => r.rank !== null).sort((a, b) => a.rank! - b.rank!)
      : source.sort(order)
    const ranked: Ranked = { rows: [], byGame: new Map(), byPlayer: new Map(), byZone: new Map(), zoneOf: new Map(), made: this.now(), closed }
    sorted.forEach((r, i) => {
      const row: BoardRow = {
        rank: closed ? r.rank! : i + 1,
        player: { id: r.player, name: r.name },
        game: r.game,
        score: r.score,
        points: r.points,
        status: r.status,
        year: yearOf(r.month),
        open: !r.filled && (closed || r.status !== 'playing'),
      }
      ranked.rows.push(row)
      ranked.byGame.set(r.game, row)
      ranked.byPlayer.set(r.player, row)
      ranked.zoneOf.set(r.player, r.zone)
      if (r.zone !== null) {
        const list = ranked.byZone.get(r.zone) ?? []
        list.push(row)
        ranked.byZone.set(r.zone, list)
      }
    })
    this.made.set(season, ranked)
    return ranked
  }

  /** A page of a season's board for one player. */
  async page(
    season: string,
    closed: boolean,
    scope: 'all' | 'friends' | 'zone',
    from: number,
    count: number,
    me: { id: string; zone: number | null; friends: string[] },
  ): Promise<{ rows: BoardRow[]; total: number; mine: BoardRow | null }> {
    const ranked = await this.ranked(season, closed)
    let rows: BoardRow[]
    if (scope === 'all') rows = ranked.rows
    else if (scope === 'zone') rows = me.zone === null ? [] : (ranked.byZone.get(me.zone) ?? [])
    else {
      const ids = new Set([me.id, ...me.friends])
      rows = [...ids].map((id) => ranked.byPlayer.get(id)).filter((r): r is BoardRow => !!r).sort((a, b) => a.rank - b.rank)
    }
    return { rows: rows.slice(from, from + count), total: rows.length, mine: ranked.byPlayer.get(me.id) ?? null }
  }
}
