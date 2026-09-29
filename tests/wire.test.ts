import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Transit, Zone } from '../src/data/types'
import { rules } from '../src/rules/index'
import type { CityData, Game } from '../src/rules/types'
import { fromWire, toWire } from '../src/rules/wire'
import { firstSeason } from '../src/seasons/first'
import { simulate } from '../src/sim/index'
import type { RoutingNetwork } from '../src/sim/types'

const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../public/data/${file}`, import.meta.url), 'utf8')) as T
const city: CityData = { zones: read<Zone[]>('zones.json'), roads: read<RoutingNetwork>('routing.json'), transit: read<Transit>('transit.json') }

describe('a game on the wire', () => {
  it('comes back strictly equal after several months, reports aside, typed arrays and all', () => {
    const game: Game = rules.start(firstSeason, city)
    const plan = [[{ kind: 'tax', rate: 10500 }, { kind: 'borrow', amount: 50_000 }], [{ kind: 'upkeep', level: 'generous' }], [], []] as const
    for (const actions of plan) {
      for (const a of actions) expect(rules.act(game, city, a as never).ok).toBe(true)
      rules.endMonth(game, city, simulate(rules.state(game, city)))
    }
    const text = JSON.stringify(toWire(game))
    const back = fromWire(JSON.parse(text))
    expect(back).toStrictEqual({ ...game, reports: [] })
    expect(back.last!.flow.morning).toBeInstanceOf(Int32Array)
  })
})
