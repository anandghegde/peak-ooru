import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deserialize, serialize } from 'node:v8'
import { deflateSync, inflateSync } from 'node:zlib'
import type { Transit, Zone } from '../../src/data/types'
import { gameDigest } from '../../src/rules/digest'
import { rules } from '../../src/rules/index'
import { MEASURES } from '../../src/rules/score'
import type { Action, CityData, Game, Season } from '../../src/rules/types'
import { simulate } from '../../src/sim/index'
import type { RoutingNetwork } from '../../src/sim/types'

/*
 * One game, as the server keeps and works it: the state kept between months, and a month ended by the rules and the
 * model, imported as they are from ../src. Used by the worker threads, the commands and the tests alike.
 */

/** The city as the rules take it, read from the game's data folder (public/data, or the built game's data/). */
export function loadCity(dir: string): CityData {
  const read = <T>(file: string): T => JSON.parse(readFileSync(join(dir, file), 'utf8')) as T
  return { zones: read<Zone[]>('zones.json'), roads: read<RoutingNetwork>('routing.json'), transit: read<Transit>('transit.json') }
}

/**
 * The state kept: the whole game but its reports, which are words for the player that the screen works out for
 * itself and which decide nothing that follows. Serialised by V8, which keeps typed arrays (the last month's flows)
 * exactly, and compressed.
 */
export function save(game: Game): Buffer {
  return deflateSync(serialize(canonical({ ...game, reports: [] })), { level: 1 })
}

/**
 * The game with each typed array in a buffer of its own: V8 writes a typed array's whole buffer, and the model's (or
 * a loaded game's) may be views into larger ones. So the same game always gives the same bytes, and no more of them.
 */
export function canonical<T>(x: T): T {
  if (ArrayBuffer.isView(x)) return (x as unknown as Int32Array).slice() as unknown as T
  if (Array.isArray(x)) return x.map(canonical) as unknown as T
  if (x && typeof x === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(x)) out[k] = canonical(v)
    return out as T
  }
  return x
}

export function load(blob: Uint8Array): Game {
  return deserialize(inflateSync(blob)) as Game
}

export const digestOf = gameDigest

/** The seven measures' points, 0 to 100 to a tenth (the rules keep tenths), in the order of docs/API.md. */
export function pointsOf(game: Game): number[] {
  const measures = game.score?.measures ?? []
  return MEASURES.map((key) => (measures.find((m) => m.key === key)?.points ?? 0) / 10)
}

/** What the store keeps beside the state, so that lists and the board never open it. */
export interface Kept {
  month: number
  status: Game['status']
  score: number
  points: number[]
  digest: string
}

export function keptOf(game: Game): Kept {
  return { month: game.month, status: game.status, score: game.score?.total ?? 0, points: pointsOf(game), digest: gameDigest(game) }
}

export type MonthOutcome =
  | { ok: true; state: Buffer; kept: Kept; actions: Action[] }
  | { ok: false; code: 'refused'; action: number; message: string }
  | { ok: false; code: 'out-of-step'; message: string }

/** A new game of a season, as kept. */
export function startGame(season: Season, city: CityData): { state: Buffer; kept: Kept } {
  const game = rules.start(season, city)
  return { state: save(game), kept: keptOf(game) }
}

/**
 * Ends a month: the actions done in order by the rules, the month worked out by the model, ended, and kept. Nothing
 * from the request is trusted: the rules check every action, and what is recorded is the rules' own clean copy.
 */
export function endMonth(state: Uint8Array, city: CityData, month: number, actions: unknown[]): MonthOutcome {
  const game = load(state)
  if (game.status !== 'playing') return { ok: false, code: 'out-of-step', message: 'This game is over.' }
  if (game.month !== month) return { ok: false, code: 'out-of-step', message: 'That month does not follow the game as it is kept.' }
  const from = game.done.length
  for (let i = 0; i < actions.length; i++) {
    let outcome
    try {
      outcome = rules.act(game, city, actions[i] as Action)
    } catch {
      outcome = { ok: false as const, reason: 'That is not something the city can do.' }
    }
    if (!outcome.ok) return { ok: false, code: 'refused', action: i, message: outcome.reason }
  }
  rules.endMonth(game, city, simulate(rules.state(game, city)))
  return { ok: true, state: save(game), kept: keptOf(game), actions: game.done.slice(from).map((d) => d.action) }
}

/**
 * Plays a game again from its season and its months' actions, one model run a month, and gives the digest after each
 * month, so that a difference can be put to the month it began in.
 */
export function replayMonths(season: Season, city: CityData, months: Action[][]): { game: Game; digests: string[] } {
  const game = rules.start(season, city)
  const digests: string[] = []
  for (let m = 0; m < months.length; m++) {
    for (const action of months[m]!) {
      const outcome = rules.act(game, city, action)
      if (!outcome.ok) throw new Error(`Month ${m}: an action is not allowed: ${outcome.reason}`)
    }
    rules.endMonth(game, city, simulate(rules.state(game, city)))
    game.reports = []
    digests.push(gameDigest(game))
  }
  return { game, digests }
}

/** What a worker thread is asked to do. */
export type Job =
  | { kind: 'start'; season: Season }
  | { kind: 'month'; state: Uint8Array; month: number; actions: unknown[] }
  | { kind: 'replay'; season: Season; months: Action[][] }

export function doJob(job: Job, city: CityData): unknown {
  if (job.kind === 'start') return startGame(job.season, city)
  if (job.kind === 'month') return endMonth(job.state, city, job.month, job.actions)
  const { game, digests } = replayMonths(job.season, city, job.months)
  return { digests, month: game.month, status: game.status }
}
