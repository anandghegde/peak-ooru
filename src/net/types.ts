import type { Action, Done, Season } from '../rules/types'

/** The shapes of docs/API.md, as the screen reads them. */

export interface Player {
  id: string
  name: string | null
  /** Whether an email address or a Google account is joined, so that the player can play on another device. */
  signedIn: boolean
  friendCode: string
  zone: number | null
}

export interface Friend {
  id: string
  name: string | null
}

export interface SeasonInfo {
  id: string
  name: string
  twist: string
  opens: string
  closes: string
  /** The version of the rules the season is played by. */
  rules: number
  season: Season
}

export type GameStatus = 'playing' | 'finished' | 'default' | 'replaced'

export interface GameSummary {
  id: string
  season: string
  ranked: boolean
  /** The month the player is acting in: 0 to 120. */
  month: number
  status: GameStatus
  score: number
  /** Points for the seven measures: access, commute, clean, safety, fairness, money, approval. */
  points: number[]
  restarted: boolean
  allowance: { on: boolean; left: number; more: string | null }
  started: string
  ended: string | null
}

export interface BoardRow {
  rank: number
  player: { id: string; name: string }
  game: string
  score: number
  points: number[]
  status: GameStatus
  year: number
  open: boolean
}

export type Scope = 'all' | 'friends' | 'zone'

export interface Board {
  rows: BoardRow[]
  total: number
  mine: BoardRow | null
}

/** A month as sent: the month the player was in, what they did in it, and the screen's fingerprint after it ended. */
export interface MonthSent {
  month: number
  actions: Action[]
  digest: string
}

/**
 * A refusal, or a failure to reach the server at all (`offline`). `game` comes with `out-of-step`, `action` with
 * `refused`.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
    readonly game?: GameSummary,
    readonly action?: number,
  ) {
    super(message)
  }
}

/** The server's interface, as the screen calls it: over the network, or answered in the browser by the stand-in. */
export interface Api {
  newPlayer(): Promise<{ player: Player; token: string }>
  me(): Promise<{ player: Player }>
  setName(name: string): Promise<{ player: Player }>
  setZone(zone: number | null): Promise<{ player: Player }>
  signInEmail(email: string): Promise<{ sent: true }>
  confirmEmail(code: string): Promise<{ player: Player; token: string }>
  signInGoogle(credential: string): Promise<{ player: Player; token: string }>
  signOut(): Promise<unknown>
  deleteMe(): Promise<unknown>
  addFriend(code: string): Promise<{ friends: Friend[] }>
  dropFriend(id: string): Promise<{ friends: Friend[] }>
  friends(): Promise<{ friends: Friend[] }>
  season(): Promise<{ season: SeasonInfo }>
  newGame(season: string, ranked: boolean): Promise<{ game: GameSummary }>
  games(season: string): Promise<{ games: GameSummary[] }>
  game(id: string): Promise<{ game: GameSummary; done: Done[] }>
  endMonth(id: string, month: MonthSent): Promise<{ game: GameSummary; digest: string }>
  restart(id: string): Promise<{ game: GameSummary }>
  /** `state`: the finished game as kept (src/rules/wire.ts), so that it need not be played again; absent or null if not. */
  city(id: string): Promise<{ game: GameSummary; done: Done[]; player: { id: string; name: string | null }; state?: unknown }>
  board(season: string, scope: Scope, from: number, count: number): Promise<Board>
  /**
   * Slice 9: sends the share picture of the player's own finished game (PNG), for the link's preview. A picture the
   * server already keeps (409) counts as sent. Absent where there is no server to send it to.
   */
  picture?(id: string, png: Blob): Promise<void>
  /** The token requests are made with, or null for none. */
  token: string | null
  /** The version of the rules the screen works months out by, sent with each month (`X-Rules`); 0 until known. */
  rules?: number
}
