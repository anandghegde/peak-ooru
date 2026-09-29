import { createRequire } from 'node:module'
import type { DatabaseSync as Database } from 'node:sqlite'

// Taken by require, since the test runner's module loader does not yet know `node:sqlite` as one of Node's own.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
import type { Action, Season } from '../../src/rules/types'
import type { Kept } from './game'

/*
 * Everything the server keeps, behind one small interface, so that another database (Postgres) could take the place
 * of SQLite by implementing it: every call gives a promise, and every change that must be whole is one call.
 */

export interface PlayerRow {
  id: string
  name: string | null
  email: string | null
  friendCode: string
  zone: number | null
  created: string
}

export interface SeasonRow {
  id: string
  name: string
  twist: string
  opens: string
  closes: string
  rules: number
  season: Season
  closed: string | null
}

export interface GameRow extends Kept {
  id: string
  player: string
  season: string
  ranked: boolean
  restarted: boolean
  started: string
  ended: string | null
  /** The rank fixed when the season closed. */
  rank: number | null
  /** Written by `fill` without being played. */
  filled: boolean
}

export interface MonthRow {
  month: number
  at: string
  actions: Action[]
  digest: string
}

/** What the board is made from: a ranked game of a named player. */
export interface BoardSource {
  game: string
  player: string
  name: string
  zone: number | null
  score: number
  points: number[]
  status: Kept['status']
  month: number
  started: string
  ended: string | null
  rank: number | null
  /** Written by `fill`, not played: not to be looked round. */
  filled: boolean
}

export interface Store {
  addPlayer(p: PlayerRow): Promise<void>
  player(id: string): Promise<PlayerRow | null>
  playerByEmail(email: string): Promise<PlayerRow | null>
  playerByFriendCode(code: string): Promise<PlayerRow | null>
  /** False if another player has a name alike (`key`). */
  setName(id: string, name: string, key: string): Promise<boolean>
  setZone(id: string, zone: number | null): Promise<void>
  setEmail(id: string, email: string): Promise<void>
  /** Deletes the player and everything kept with them. */
  deletePlayer(id: string): Promise<void>
  /**
   * Joins player `from` to `into`, keeping the games of both: where both have a ranked game in the same season,
   * `into`'s stays ranked and `from`'s becomes a practice game. `from` is then deleted.
   */
  merge(from: string, into: string): Promise<void>

  addToken(hash: string, player: string, created: string): Promise<void>
  tokenPlayer(hash: string): Promise<string | null>
  dropToken(hash: string): Promise<void>
  addCode(hash: string, email: string, expires: number): Promise<void>
  /** The email a sign-in code was sent to, if it is good; it is used up either way. */
  takeCode(hash: string, now: number): Promise<string | null>

  addFriend(a: string, b: string): Promise<void>
  dropFriend(a: string, b: string): Promise<void>
  friends(id: string): Promise<PlayerRow[]>

  addSeason(s: SeasonRow): Promise<void>
  season(id: string): Promise<SeasonRow | null>
  seasons(): Promise<SeasonRow[]>
  /** Marks a season closed and fixes the ranks given, by game id. */
  closeSeason(id: string, at: string, ranks: [string, number][]): Promise<void>

  addGame(g: GameRow, state: Uint8Array): Promise<void>
  game(id: string): Promise<GameRow | null>
  games(player: string, season?: string): Promise<GameRow[]>
  seasonGames(season: string): Promise<GameRow[]>
  state(id: string): Promise<Uint8Array | null>
  /** Keeps a month ended: the state and figures, the month's actions and time, and, for a ranked game, the allowance used. */
  endMonth(id: string, kept: Kept, state: Uint8Array, month: MonthRow, ended: string | null, spent: { player: string; season: string; at: number } | null): Promise<void>
  /** Starts a game again from its season's beginning. */
  restart(id: string, kept: Kept, state: Uint8Array, started: string): Promise<void>
  months(id: string): Promise<MonthRow[]>
  /** When the player ended each month of ranked play in a season, in milliseconds. */
  spent(player: string, season: string): Promise<number[]>
  board(season: string): Promise<BoardSource[]>

  meta(key: string): Promise<string | null>
  setMeta(key: string, value: string): Promise<void>
  /** A consistent copy of the whole store in one file, taken while it runs. */
  backup(file: string): Promise<void>
  close(): Promise<void>
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY, name TEXT, name_key TEXT UNIQUE, email TEXT UNIQUE, friend_code TEXT NOT NULL UNIQUE,
  zone INTEGER, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tokens (
  hash TEXT PRIMARY KEY, player TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE, created TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS tokens_player ON tokens(player);
CREATE TABLE IF NOT EXISTS codes (hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS friends (
  player TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  friend TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE, PRIMARY KEY (player, friend));
CREATE INDEX IF NOT EXISTS friends_friend ON friends(friend);
CREATE TABLE IF NOT EXISTS seasons (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, twist TEXT NOT NULL, opens TEXT NOT NULL, closes TEXT NOT NULL,
  rules INTEGER NOT NULL, setup TEXT NOT NULL, closed TEXT);
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY, player TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  season TEXT NOT NULL REFERENCES seasons(id), ranked INTEGER NOT NULL, restarted INTEGER NOT NULL DEFAULT 0,
  month INTEGER NOT NULL, status TEXT NOT NULL, score INTEGER NOT NULL, points TEXT NOT NULL, digest TEXT NOT NULL,
  started TEXT NOT NULL, ended TEXT, rank INTEGER, filled INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS games_player ON games(player, season);
CREATE INDEX IF NOT EXISTS games_season ON games(season, ranked);
CREATE TABLE IF NOT EXISTS states (game TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE, blob BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS months (
  game TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE, month INTEGER NOT NULL, at TEXT NOT NULL,
  actions TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY (game, month));
CREATE TABLE IF NOT EXISTS spent (
  player TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE, season TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS spent_player ON spent(player, season);
`

type Row = Record<string, unknown>

const playerOf = (r: Row | undefined): PlayerRow | null =>
  r
    ? {
        id: r.id as string,
        name: (r.name as string | null) ?? null,
        email: (r.email as string | null) ?? null,
        friendCode: r.friend_code as string,
        zone: (r.zone as number | null) ?? null,
        created: r.created as string,
      }
    : null

const seasonOf = (r: Row | undefined): SeasonRow | null =>
  r
    ? {
        id: r.id as string,
        name: r.name as string,
        twist: r.twist as string,
        opens: r.opens as string,
        closes: r.closes as string,
        rules: r.rules as number,
        season: JSON.parse(r.setup as string) as Season,
        closed: (r.closed as string | null) ?? null,
      }
    : null

const gameOf = (r: Row | undefined): GameRow | null =>
  r
    ? {
        id: r.id as string,
        player: r.player as string,
        season: r.season as string,
        ranked: r.ranked === 1,
        restarted: r.restarted === 1,
        month: r.month as number,
        status: r.status as GameRow['status'],
        score: r.score as number,
        points: JSON.parse(r.points as string) as number[],
        digest: r.digest as string,
        started: r.started as string,
        ended: (r.ended as string | null) ?? null,
        rank: (r.rank as number | null) ?? null,
        filled: r.filled === 1,
      }
    : null

/** The store in one SQLite file, by Node's own `node:sqlite`, with write-ahead logging. */
export class SqliteStore implements Store {
  readonly db: Database

  constructor(file: string) {
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
    this.db.exec(SCHEMA)
  }

  private get(sql: string, ...args: (string | number | null | Uint8Array)[]): Row | undefined {
    return this.db.prepare(sql).get(...args) as Row | undefined
  }

  private all(sql: string, ...args: (string | number | null | Uint8Array)[]): Row[] {
    return this.db.prepare(sql).all(...args) as Row[]
  }

  private run(sql: string, ...args: (string | number | null | Uint8Array)[]): number {
    return Number(this.db.prepare(sql).run(...args).changes)
  }

  private whole<T>(f: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const out = f()
      this.db.exec('COMMIT')
      return out
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  async addPlayer(p: PlayerRow) {
    this.run('INSERT INTO players (id, name, email, friend_code, zone, created) VALUES (?, ?, ?, ?, ?, ?)', p.id, p.name, p.email, p.friendCode, p.zone, p.created)
  }

  async player(id: string) {
    return playerOf(this.get('SELECT * FROM players WHERE id = ?', id))
  }

  async playerByEmail(email: string) {
    return playerOf(this.get('SELECT * FROM players WHERE email = ?', email))
  }

  async playerByFriendCode(code: string) {
    return playerOf(this.get('SELECT * FROM players WHERE friend_code = ?', code))
  }

  async setName(id: string, name: string, key: string) {
    try {
      this.run('UPDATE players SET name = ?, name_key = ? WHERE id = ?', name, key, id)
      return true
    } catch (e) {
      if (String(e).includes('UNIQUE')) return false
      throw e
    }
  }

  async setZone(id: string, zone: number | null) {
    this.run('UPDATE players SET zone = ? WHERE id = ?', zone, id)
  }

  async setEmail(id: string, email: string) {
    this.run('UPDATE players SET email = ? WHERE id = ?', email, id)
  }

  async deletePlayer(id: string) {
    this.whole(() => {
      // States, months and tokens go with the games and the player (ON DELETE CASCADE).
      this.run('DELETE FROM players WHERE id = ?', id)
    })
  }

  async merge(from: string, into: string) {
    if (from === into) return
    this.whole(() => {
      this.run(
        `UPDATE games SET ranked = 0 WHERE player = ? AND ranked = 1 AND season IN
          (SELECT season FROM games WHERE player = ? AND ranked = 1)`,
        from,
        into,
      )
      this.run('UPDATE games SET player = ? WHERE player = ?', into, from)
      this.run('UPDATE spent SET player = ? WHERE player = ?', into, from)
      this.run(
        'INSERT OR IGNORE INTO friends (player, friend) SELECT ?, friend FROM friends WHERE player = ? AND friend != ?',
        into,
        from,
        into,
      )
      this.run(
        'INSERT OR IGNORE INTO friends (player, friend) SELECT player, ? FROM friends WHERE friend = ? AND player != ?',
        into,
        from,
        into,
      )
      const a = this.get('SELECT name, name_key, zone FROM players WHERE id = ?', from)
      const b = this.get('SELECT name, zone FROM players WHERE id = ?', into)
      this.run('DELETE FROM players WHERE id = ?', from)
      if (a && b && b.name === null && a.name !== null) this.run('UPDATE players SET name = ?, name_key = ? WHERE id = ?', a.name as string, a.name_key as string, into)
      if (a && b && b.zone === null && a.zone !== null) this.run('UPDATE players SET zone = ? WHERE id = ?', a.zone as number, into)
    })
  }

  async addToken(hash: string, player: string, created: string) {
    this.run('INSERT INTO tokens (hash, player, created) VALUES (?, ?, ?)', hash, player, created)
  }

  async tokenPlayer(hash: string) {
    return (this.get('SELECT player FROM tokens WHERE hash = ?', hash)?.player as string | undefined) ?? null
  }

  async dropToken(hash: string) {
    this.run('DELETE FROM tokens WHERE hash = ?', hash)
  }

  async addCode(hash: string, email: string, expires: number) {
    this.run('INSERT INTO codes (hash, email, expires) VALUES (?, ?, ?)', hash, email, expires)
  }

  async takeCode(hash: string, now: number) {
    return this.whole(() => {
      this.run('DELETE FROM codes WHERE expires < ?', now)
      const r = this.get('SELECT email FROM codes WHERE hash = ?', hash)
      this.run('DELETE FROM codes WHERE hash = ?', hash)
      return (r?.email as string | undefined) ?? null
    })
  }

  async addFriend(a: string, b: string) {
    this.whole(() => {
      this.run('INSERT OR IGNORE INTO friends (player, friend) VALUES (?, ?)', a, b)
      this.run('INSERT OR IGNORE INTO friends (player, friend) VALUES (?, ?)', b, a)
    })
  }

  async dropFriend(a: string, b: string) {
    this.whole(() => {
      this.run('DELETE FROM friends WHERE player = ? AND friend = ?', a, b)
      this.run('DELETE FROM friends WHERE player = ? AND friend = ?', b, a)
    })
  }

  async friends(id: string) {
    return this.all('SELECT p.* FROM friends f JOIN players p ON p.id = f.friend WHERE f.player = ? ORDER BY p.name, p.id', id).map((r) => playerOf(r)!)
  }

  async addSeason(s: SeasonRow) {
    this.run(
      'INSERT INTO seasons (id, name, twist, opens, closes, rules, setup, closed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      s.id, s.name, s.twist, s.opens, s.closes, s.rules, JSON.stringify(s.season), s.closed,
    )
  }

  async season(id: string) {
    return seasonOf(this.get('SELECT * FROM seasons WHERE id = ?', id))
  }

  async seasons() {
    return this.all('SELECT * FROM seasons ORDER BY opens DESC, id DESC').map((r) => seasonOf(r)!)
  }

  async closeSeason(id: string, at: string, ranks: [string, number][]) {
    this.whole(() => {
      this.run('UPDATE seasons SET closed = ? WHERE id = ?', at, id)
      const set = this.db.prepare('UPDATE games SET rank = ? WHERE id = ?')
      for (const [game, rank] of ranks) set.run(rank, game)
    })
  }

  async addGame(g: GameRow, state: Uint8Array) {
    this.whole(() => {
      this.run(
        `INSERT INTO games (id, player, season, ranked, restarted, month, status, score, points, digest, started, ended, rank, filled)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        g.id, g.player, g.season, g.ranked ? 1 : 0, g.restarted ? 1 : 0, g.month, g.status, g.score, JSON.stringify(g.points),
        g.digest, g.started, g.ended, g.rank, g.filled ? 1 : 0,
      )
      this.run('INSERT INTO states (game, blob) VALUES (?, ?)', g.id, state)
    })
  }

  async game(id: string) {
    return gameOf(this.get('SELECT * FROM games WHERE id = ?', id))
  }

  async games(player: string, season?: string) {
    const rows = season === undefined
      ? this.all('SELECT * FROM games WHERE player = ? ORDER BY started DESC, id', player)
      : this.all('SELECT * FROM games WHERE player = ? AND season = ? ORDER BY started DESC, id', player, season)
    return rows.map((r) => gameOf(r)!)
  }

  async seasonGames(season: string) {
    return this.all('SELECT * FROM games WHERE season = ? ORDER BY id', season).map((r) => gameOf(r)!)
  }

  async state(id: string) {
    return (this.get('SELECT blob FROM states WHERE game = ?', id)?.blob as Uint8Array | undefined) ?? null
  }

  async endMonth(id: string, kept: Kept, state: Uint8Array, month: MonthRow, ended: string | null, spent: { player: string; season: string; at: number } | null) {
    this.whole(() => {
      this.run(
        'UPDATE games SET month = ?, status = ?, score = ?, points = ?, digest = ?, ended = ? WHERE id = ?',
        kept.month, kept.status, kept.score, JSON.stringify(kept.points), kept.digest, ended, id,
      )
      this.run('UPDATE states SET blob = ? WHERE game = ?', state, id)
      this.run('INSERT INTO months (game, month, at, actions, digest) VALUES (?, ?, ?, ?, ?)', id, month.month, month.at, JSON.stringify(month.actions), month.digest)
      if (spent) this.run('INSERT INTO spent (player, season, at) VALUES (?, ?, ?)', spent.player, spent.season, spent.at)
    })
  }

  async restart(id: string, kept: Kept, state: Uint8Array, started: string) {
    this.whole(() => {
      this.run(
        'UPDATE games SET restarted = 1, month = ?, status = ?, score = ?, points = ?, digest = ?, started = ?, ended = NULL WHERE id = ?',
        kept.month, kept.status, kept.score, JSON.stringify(kept.points), kept.digest, started, id,
      )
      this.run('UPDATE states SET blob = ? WHERE game = ?', state, id)
      this.run('DELETE FROM months WHERE game = ?', id)
    })
  }

  async months(id: string) {
    return this.all('SELECT month, at, actions, digest FROM months WHERE game = ? ORDER BY month', id).map((r) => ({
      month: r.month as number,
      at: r.at as string,
      actions: JSON.parse(r.actions as string) as Action[],
      digest: r.digest as string,
    }))
  }

  async spent(player: string, season: string) {
    return this.all('SELECT at FROM spent WHERE player = ? AND season = ?', player, season).map((r) => r.at as number)
  }

  async board(season: string) {
    return this.all(
      `SELECT g.id, g.player, p.name, p.zone, g.score, g.points, g.status, g.month, g.started, g.ended, g.rank, g.filled
        FROM games g JOIN players p ON p.id = g.player
        WHERE g.season = ? AND g.ranked = 1 AND p.name IS NOT NULL`,
      season,
    ).map((r) => ({
      game: r.id as string,
      player: r.player as string,
      name: r.name as string,
      zone: (r.zone as number | null) ?? null,
      score: r.score as number,
      points: JSON.parse(r.points as string) as number[],
      status: r.status as Kept['status'],
      month: r.month as number,
      started: r.started as string,
      ended: (r.ended as string | null) ?? null,
      rank: (r.rank as number | null) ?? null,
      filled: r.filled === 1,
    }))
  }

  async meta(key: string) {
    return (this.get('SELECT value FROM meta WHERE key = ?', key)?.value as string | undefined) ?? null
  }

  async setMeta(key: string, value: string) {
    this.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, value)
  }

  async backup(file: string) {
    this.db.prepare('VACUUM INTO ?').run(file)
  }

  async close() {
    this.db.close()
  }
}
