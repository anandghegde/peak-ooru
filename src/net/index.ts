import type { Done, Season } from '../rules/types'
import { httpApi } from './http'
import { Outbox, type OutboxHooks } from './outbox'
import { standInApi } from './standin'
import { ApiError, type Api, type GameSummary, type Player, type SeasonInfo } from './types'

export { ApiError } from './types'
export type { Api, Board, BoardRow, Friend, GameSummary, Player, Scope, SeasonInfo } from './types'

/** What the browser remembers of the player and their game between visits. */
interface Session {
  token: string | null
  player: Player | null
  season: SeasonInfo | null
  /** The game being played, by id. Games kept only here have ids beginning `here-`. */
  game: string | null
  /** The last summary the server gave of each game. */
  summaries: Record<string, GameSummary>
  /** The stand-in's token, for practice games kept only here. */
  hereToken: string | null
}

/** A game ready to be played: the season it is in, and the server's list of its actions where the screen needs it. */
export interface Opened {
  season: Season
  game: string
  list: { done: Done[]; month: number } | null
  /** Why this is not the game the player might expect, in words for them, or null. */
  notice: string | null
}

const KEY = 'peakooru.net'
const HERE = 'here-'
/** How long a first visit waits for the server before the game starts as a practice game kept here. */
const FIRST_WAIT_MS = 5_000

const TOO_MANY = 'The game’s server is too busy to take new players just now, so this is a practice game kept in ' +
  'this browser. It does not count on the board.'
export const CANNOT_REACH = 'The game’s server cannot be reached, so this is a practice game kept in this browser. ' +
  'It does not count on the board.'

function read(): Session {
  const empty: Session = { token: null, player: null, season: null, game: null, summaries: {}, hereToken: null }
  try {
    return { ...empty, ...(JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? {}) }
  } catch {
    return empty
  }
}

function within<T>(ms: number, promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new ApiError('offline', 'The server took too long.')), ms)),
  ])
}

export interface NetHooks extends Omit<OutboxHooks, 'api'> {}

/**
 * The screen's side of the server (docs/API.md): who the player is, the game they are playing, and the months on
 * their way. Everything the player does goes first to the worker and is shown at once; the server hears of it after.
 */
export class Net {
  session = read()
  readonly server: Api
  readonly here: Api
  readonly outbox: Outbox
  /** The version of the rules the screen was built with. */
  rules = 0

  constructor(base: string, bundled: Season, hooks: NetHooks, server?: Api) {
    this.server = server ?? httpApi(base)
    this.server.token = this.session.token
    this.here = standInApi({ storage: 'peakooru.here', season: { ...bundled, allowance: false }, rules: 0, prefix: HERE })
    this.here.token = this.session.hereToken
    this.outbox = new Outbox('peakooru.outbox', { ...hooks, api: (game) => this.api(game) })
  }

  /** The interface a game belongs to. */
  api(game: string): Api {
    return game.startsWith(HERE) ? this.here : this.server
  }

  /** Whether a game is kept only in this browser. */
  isHere(game: string | null): boolean {
    return !!game?.startsWith(HERE)
  }

  save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.session))
    } catch {
      // A browser that keeps nothing makes a new player next time; the game plays the same meanwhile.
    }
  }

  get summary(): GameSummary | null {
    return this.session.game ? (this.session.summaries[this.session.game] ?? null) : null
  }

  remember(game: GameSummary): void {
    this.session.summaries[game.id] = game
    this.save()
  }

  /**
   * The game to open. A player who has been here before plays on at once from what the browser kept, and the server
   * is asked afterwards (`refresh`). A new player is made on the server with a game in its season, no question asked;
   * if the server cannot be reached, the game is a practice game kept here.
   */
  async open(): Promise<Opened> {
    const s = this.session
    if (s.token && s.game && s.season && !this.isHere(s.game)) return { season: s.season.season, game: s.game, list: null, notice: null }
    try {
      return await within(FIRST_WAIT_MS, this.join())
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'offline') console.warn(String(error))
      return this.practiceHere(error instanceof ApiError && error.code === 'too-many' ? TOO_MANY : CANNOT_REACH)
    }
  }

  /** Makes a player on the server if there is none, and finds or starts their ranked game in the current season. */
  async join(): Promise<Opened> {
    const s = this.session
    if (!s.token) {
      const { player, token } = await this.server.newPlayer()
      s.token = this.server.token = token
      s.player = player
      this.save()
    }
    const { season } = await this.server.season()
    s.season = season
    const { games } = await this.server.games(season.id)
    let game = games.find((g) => g.ranked && g.status === 'playing') ?? games.find((g) => g.ranked)
    if (!game) game = (await this.server.newGame(season.id, true)).game
    s.game = game.id
    this.remember(game)
    const list = game.month > 0 ? await this.server.game(game.id) : null
    return { season: season.season, game: game.id, list: list && { done: list.done, month: list.game.month }, notice: null }
  }

  /** A practice game kept only in this browser: the one there is (unless `fresh`), or a new one. */
  async practiceHere(notice: string | null, fresh = false): Promise<Opened> {
    const s = this.session
    if (!this.here.token) {
      const { token } = await this.here.newPlayer()
      s.hereToken = this.here.token = token
    }
    const season = (await this.here.season()).season
    const { games } = await this.here.games(season.id).catch(() => ({ games: [] as GameSummary[] }))
    const game = (fresh ? undefined : games.find((g) => g.status === 'playing')) ?? (await this.here.newGame(season.id, false)).game
    s.game = game.id
    this.remember(game)
    return { season: season.season, game: game.id, list: null, notice }
  }

  /**
   * Asks the server how things stand, after the game has opened from what the browser kept: the season (a new one, or
   * newer rules) and the game (further on, if played on another device). Null if the server cannot be reached.
   */
  async refresh(): Promise<{ season: SeasonInfo; game: GameSummary | null; done: Done[] | null } | null> {
    const s = this.session
    if (!s.token) return null
    try {
      const { season } = await this.server.season()
      s.season = season
      this.save()
      if (!s.game || this.isHere(s.game)) return { season, game: null, done: null }
      const { game, done } = await this.server.game(s.game)
      this.remember(game)
      return { season, game, done }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'unauthorised') {
        // The token no longer works (signed out elsewhere, or the player deleted): a new player next time.
        s.token = this.server.token = null
        s.game = null
        this.save()
      }
      return null
    }
  }

  /** Sets the player's token and who they are, after signing in. */
  signedIn(player: Player, token: string): void {
    this.session.token = this.server.token = token
    this.session.player = player
    this.session.game = null
    this.save()
  }

  /** Forgets the player on this device, so that the next visit makes a new one. */
  forget(): void {
    this.session = { token: null, player: null, season: null, game: null, summaries: {}, hereToken: this.session.hereToken }
    this.server.token = null
    for (const game of new Set(this.outbox.queue.map((q) => q.game))) if (!this.isHere(game)) this.outbox.drop(game)
    this.save()
  }
}
