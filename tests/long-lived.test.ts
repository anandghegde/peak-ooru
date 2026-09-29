import { describe, expect, it } from 'vitest'
import { gameDigest } from '../src/rules/digest'
import { rules } from '../src/rules/index'
import type { Action, Game, Season } from '../src/rules/types'
import { firstSeason } from '../src/seasons/first'
import { digest } from '../src/sim/digest'
import { simulate } from '../src/sim/index'
import { smallCity, testSeason } from './rules-city'

/*
 * Slice 8: the server keeps one copy of the city and works out months for many games in turn, in one process, for
 * days. Nothing kept from one game may leak into the next: each game played in turn with others comes out as it does
 * alone, to the last figure.
 */

const city = smallCity()
const season: Season = { ...testSeason, marks: firstSeason.marks, openings: [{ line: 'north-south', month: 4, stations: 3 }] }
const at = (x: number, y: number) => ({ at: [77.55 + x / 108.48, 12.93 + y / 110.57] as [number, number] })
const twoLane = city.roads.links.filter((l) => l.lanes >= 2).map((l) => l.id)

/** Three players who change different things: lines, bus lanes and footpaths; fares and tax; nothing at all. */
const PLANS: Record<string, Record<number, Action[]>> = {
  builder: {
    0: [
      { kind: 'borrow', amount: 100_000 },
      { kind: 'build', plan: { kind: 'metro', stops: [at(1, 8), at(6, 8.2), at(10, 8)] } },
      { kind: 'build', plan: { kind: 'busRoute', stops: [at(1, 4), at(8, 4), { station: 3 }], buses: 8 } },
    ],
    1: [{ kind: 'build', plan: { kind: 'busLane', links: twoLane.slice(0, 4) } }],
    2: [{ kind: 'build', plan: { kind: 'footpaths', zone: city.zones[0]!.id } }],
    6: [{ kind: 'vehicles', line: 'player-bus-1', change: 4 }],
  },
  pricer: {
    0: [{ kind: 'fare', mode: 'metro', perKm: 600 }, { kind: 'tax', rate: 11_500 }],
    3: [{ kind: 'fare', mode: 'bus', perKm: 120 }],
  },
  idle: {},
}

const MONTHS = 14

function start(): Game {
  return rules.start(season, city)
}

/** Does the plan's actions for the month the game is in, and ends it. */
function step(g: Game, plan: string): void {
  for (const a of PLANS[plan]![g.month] ?? []) expect([plan, g.month, rules.act(g, city, a)]).toEqual([plan, g.month, { ok: true }])
  rules.endMonth(g, city, simulate(rules.state(g, city)))
}

/** A game played alone from the start: its fingerprint after each month. */
function alone(plan: string): string[] {
  const g = start()
  const out: string[] = []
  for (let m = 0; m < MONTHS; m++) {
    step(g, plan)
    out.push(gameDigest(g))
  }
  return out
}

describe('games worked out in turn in one process', () => {
  const plans = Object.keys(PLANS)
  const each = Object.fromEntries(plans.map((p) => [p, alone(p)]))

  it('come out as each does alone, month by month', () => {
    const games = Object.fromEntries(plans.map((p) => [p, start()]))
    const seen: Record<string, string[]> = Object.fromEntries(plans.map((p) => [p, []]))
    for (let m = 0; m < MONTHS; m++) {
      // A different order each month.
      const order = m % 2 ? [...plans].reverse() : plans
      for (const p of order) {
        step(games[p]!, p)
        seen[p]!.push(gameDigest(games[p]!))
      }
    }
    for (const p of plans) expect(seen[p]).toEqual(each[p])
    // The players did differ.
    expect(new Set(plans.map((p) => each[p]!.at(-1))).size).toBe(plans.length)
  })

  it('come out the same when each month starts from a copy kept as the server keeps it', () => {
    // The server keeps each game's state and loads it again for the next month: a copy through JSON.
    const kept: Record<string, string> = Object.fromEntries(plans.map((p) => [p, JSON.stringify(start())]))
    for (let m = 0; m < MONTHS; m++) {
      for (const p of plans) {
        const g = JSON.parse(kept[p]!) as Game
        step(g, p)
        expect([p, m, gameDigest(g)]).toEqual([p, m, each[p]![m]])
        kept[p] = JSON.stringify(g)
      }
    }
  })

  it('come out the same when played again from the list of actions between others', () => {
    const played = start()
    for (let m = 0; m < MONTHS; m++) step(played, 'builder')
    // Other games in between.
    alone('pricer')
    const again = rules.replay(season, city, played.done, simulate, MONTHS)
    expect(gameDigest(again)).toBe(gameDigest(played))
  })
})

describe('the model worked out for many cities in turn', () => {
  it('gives each city what it gives alone, whatever came before', () => {
    const g = start()
    for (let m = 0; m < 3; m++) step(g, 'builder')
    const built = rules.state(g, city)
    const bare = rules.state(start(), city)
    const a = digest(simulate(built))
    const b = digest(simulate(bare))
    expect(a).not.toBe(b)
    for (let k = 0; k < 3; k++) {
      expect(digest(simulate(bare))).toBe(b)
      expect(digest(simulate(built))).toBe(a)
    }
  })
})

describe('playing a game again at speed, as the server checks it (slice 8)', () => {
  it('runs the model once a month, and without reports comes to the same game', () => {
    const played = start()
    for (let m = 0; m < MONTHS; m++) step(played, 'builder')
    let runs = 0
    const counted = (s: Parameters<typeof simulate>[0]) => {
      runs++
      return simulate(s)
    }
    const full = rules.replay(season, city, played.done, counted, MONTHS)
    expect(runs).toBe(MONTHS)
    runs = 0
    const quick = rules.replay(season, city, played.done, counted, MONTHS, false)
    expect(runs).toBe(MONTHS)
    expect(quick.reports).toEqual([])
    expect(gameDigest(quick)).toBe(gameDigest(played))
    expect(JSON.stringify({ ...quick, reports: [] })).toBe(JSON.stringify({ ...full, reports: [] }))
    expect(JSON.stringify(full)).toBe(JSON.stringify(played))
  })
})
