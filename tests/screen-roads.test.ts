import { describe, expect, it } from 'vitest'
import { planName } from '../src/game/build'
import { sameName } from '../src/map/transit'
import type { Figure, Game, Quote } from '../src/rules/types'
import { heading, topZones } from '../src/ui/build'
import { figureLine } from '../src/ui/report'

const quote = (names: string[]): Quote => ({
  ok: true, cost: 0, months: 0, running: 0, length: 0, path: [], disrupted: [], major: false,
  stations: names.map((name) => ({ at: [77.6, 12.9], name, nameKn: null })),
})
const game = { done: [] } as unknown as Game

describe('roads and streets on the screen', () => {
  it('knows two spellings of one station as the same place', () => {
    expect(sameName('Nagavara', 'Nagawara')).toBe(true)
    expect(sameName('Whitefield (Kadugodi)', 'Whitefield')).toBe(true)
    expect(sameName('Hebbal', 'Hennur')).toBe(false)
  })

  it('names the way a stretch of road runs by the compass', () => {
    expect(heading([77.6, 12.9, 77.6, 12.95])).toBe('north')
    expect(heading([77.6, 12.9, 77.55, 12.9])).toBe('west')
    expect(heading([77.6, 12.9, 77.65, 12.85])).toBe('south-east')
  })

  it('shades the zones with the most deaths darkest, and none with none', () => {
    const deaths = [0, 9, 1, 2, 3, 4, 5, 6, 7, 8]
    const levels = topZones(deaths)
    expect(levels.get(1)).toBe(3)
    expect(levels.get(0)).toBeUndefined()
    expect(levels.get(9)).toBe(2)
    expect(topZones(deaths, new Set([1])).get(1)).toBeUndefined()
  })

  it('names each new kind of plan for the player', () => {
    const zones = [{ id: 4, name: 'Jayanagar' }] as never
    expect(planName({ kind: 'road', stops: [], lanes: 2, flyover: true }, quote(['Silk Board', 'Agara']), game, null)).toBe('Flyover, Silk Board to Agara')
    expect(planName({ kind: 'junction', node: 1, work: 'overpass' }, quote(['Hebbal']), game, null)).toBe('Overpass at Hebbal')
    expect(planName({ kind: 'speedLimit', zone: 4, limit: 40 }, quote([]), game, null, zones)).toBe('40 km/h limit in Jayanagar')
    expect(planName({ kind: 'footpaths', zone: 4 }, quote([]), game, null, zones)).toBe('Footpaths in Jayanagar')
  })

  it('says road deaths in whole people, without saying "a year" twice', () => {
    const f: Figure = { key: 'safety', name: 'Road deaths a year', now: 892, before: 885, unit: 'a year', causes: [] }
    expect(figureLine(f)).toBe('Road deaths a year 892, up 7')
  })
})
