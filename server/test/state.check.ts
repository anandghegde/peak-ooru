import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { gameDigest } from '../../src/rules/digest'
import { rules } from '../../src/rules/index'
import type { Action, Game } from '../../src/rules/types'
import { firstSeason } from '../../src/seasons/first'
import { simulate } from '../../src/sim/index'
import { canonical, endMonth, load, loadCity, replayMonths, startGame } from '../src/game'

const city = loadCity(resolve(__dirname, '../../public/data'))

/** A few months of play that touch money, loans, building and the roads. */
const PLAN: Action[][] = [
  [{ kind: 'tax', rate: 10500 }, { kind: 'borrow', amount: 50_000 }],
  [{ kind: 'fare', mode: 'bus', perKm: 120 }, { kind: 'upkeep', level: 'generous' }],
  [],
  [{ kind: 'build', plan: { kind: 'footpaths', zone: city.zones[5]!.id } }],
]

/** The game but its reports, with every typed array in a buffer of its own, for comparing by value. */
const bare = (g: Game) => canonical({ ...g, reports: [] })

describe('the state kept between months', () => {
  it('goes on exactly as a game never saved, month after month', () => {
    const never = rules.start(firstSeason, city)
    let kept = startGame(firstSeason, city).state
    for (let m = 0; m < PLAN.length; m++) {
      for (const a of PLAN[m]!) expect(rules.act(never, city, a)).toEqual({ ok: true })
      rules.endMonth(never, city, simulate(rules.state(never, city)))
      const out = endMonth(kept, city, m, PLAN[m]!)
      if (!out.ok) throw new Error(out.message)
      kept = out.state
      const loaded = load(kept)
      // Every byte of the game but its reports, the last month's flows and speeds (typed arrays) included.
      expect(bare(loaded)).toStrictEqual(bare(never))
      expect(out.kept.digest).toBe(gameDigest(never))
    }
  })

  it('is the same when played again from the list of actions, and when two games are worked in turn', () => {
    const other: Action[][] = [[{ kind: 'tax', rate: 9000 }], [{ kind: 'borrow', amount: 100_000 }], [], []]
    let a = startGame(firstSeason, city).state
    let b = startGame(firstSeason, city).state
    const digests: string[] = []
    for (let m = 0; m < PLAN.length; m++) {
      const x = endMonth(a, city, m, PLAN[m]!)
      const y = endMonth(b, city, m, other[m]!)
      if (!x.ok || !y.ok) throw new Error('refused')
      a = x.state
      b = y.state
      digests.push(x.kept.digest)
    }
    expect(replayMonths(firstSeason, city, PLAN).digests).toEqual(digests)
    expect(bare(replayMonths(firstSeason, city, PLAN).game)).toStrictEqual(bare(load(a)))
  })

  it('is small enough to keep for every game', () => {
    const out = endMonth(startGame(firstSeason, city).state, city, 0, [])
    if (!out.ok) throw new Error(out.message)
    // Measured at about 250 KB compressed; a megabyte would be a sign that something grows that should not.
    expect(out.state.length).toBeLessThan(1_000_000)
    console.log(`kept state after a month: ${(out.state.length / 1024).toFixed(0)} KB`)
  })
})

describe('a month', () => {
  it('refuses an action the rules refuse, keeping nothing, and names it', () => {
    const start = startGame(firstSeason, city).state
    const out = endMonth(start, city, 0, [{ kind: 'tax', rate: 10500 }, { kind: 'tax', rate: 11000 }])
    expect(out).toMatchObject({ ok: false, code: 'refused', action: 1 })
  })

  it('refuses a month out of step', () => {
    expect(endMonth(startGame(firstSeason, city).state, city, 1, [])).toMatchObject({ ok: false, code: 'out-of-step' })
  })

  it('refuses things that are not actions without failing', () => {
    const start = startGame(firstSeason, city).state
    for (const bad of [null, 7, 'tax', [], { kind: 'tax' }, { kind: 'tax', rate: 1e300 }, { kind: 'borrow', amount: -5 },
      { kind: 'build', plan: null }, { kind: 'build', plan: { kind: 'metro', stops: 'x' } }, { kind: 'repay', loan: { valueOf: 1 } },
      { kind: 'build', plan: { kind: 'busLane', links: [1e9] } }, { kind: 'score', total: 1000 }, { __proto__: { kind: 'tax' } }]) {
      expect(endMonth(start, city, 0, [bad])).toMatchObject({ ok: false, code: 'refused', action: 0 })
    }
  })

  it('records the rules\' own clean copy of each action, not what was sent', () => {
    const out = endMonth(startGame(firstSeason, city).state, city, 0, [{ kind: 'tax', rate: 10500, score: 1000, extra: { a: 1 } }])
    if (!out.ok) throw new Error(out.message)
    expect(out.actions).toEqual([{ kind: 'tax', rate: 10500 }])
  })
})
