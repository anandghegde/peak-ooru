import { describe, expect, it } from 'vitest'
import type { Transit, Zone } from '../src/data/types'
import { LINE_COLOURS, openInto, standInQuote, withBuilding } from '../src/game/build'
import { STANDIN_SEASON, standInRules } from '../src/game/standin-rules'
import { JAM_COLOURS } from '../src/map/traffic'
import type { CityData } from '../src/rules/types'
import type { RoutingNetwork } from '../src/sim/types'
import { duration, insertAt, nearestGap } from '../src/ui/build'
import { fullness } from '../src/ui/lines'

/** A small city: a main road east to west, with junctions every kilometre or so. */
function smallCity(): CityData {
  const nodes = Array.from({ length: 8 }, (_, i) => ({
    id: i, at: [Math.round((77.55 + i * 0.01) * 1e6), Math.round(12.97 * 1e6)] as [number, number], gateway: false, signal: false,
  }))
  const links: RoutingNetwork['links'] = []
  for (let i = 0; i < 7; i++) {
    const base = { length: 1085, kind: 'primary' as const, lanes: 2, speed: 40, capacity: 2400, drawn: [i], forward: [true] }
    links.push({ ...base, id: links.length, from: i, to: i + 1 })
    links.push({ ...base, id: links.length, from: i + 1, to: i, forward: [false] })
  }
  const zones: Zone[] = [
    { id: 0, name: 'West', nameKn: null, node: 0, centre: [77.55, 12.97], area: 2, people: 1000, jobs: 100, income: 3 },
    { id: 1, name: 'East', nameKn: null, node: 7, centre: [77.62, 12.97], area: 2, people: 1000, jobs: 900, income: 3 },
  ]
  const transit: Transit = {
    stations: [{ id: 0, name: 'Old', nameKn: null, at: [77.58, 12.972], kind: 'metro' }],
    lines: [{ id: 'purple', name: 'Purple', kind: 'metro', colour: '#8e3a9d', status: 'open', stations: [0], path: [] }],
  }
  return { zones, transit, roads: { nodes, links, zoneNode: [0, 7] } }
}

describe('placing a line', () => {
  it('puts a stop between two others at the gap nearest the tap', () => {
    const points: [number, number][] = [[77.55, 12.97], [77.6, 12.97], [77.6, 13.02]]
    expect(nearestGap(points, [77.575, 12.971])).toBe(1)
    expect(nearestGap(points, [77.601, 13.0])).toBe(2)
    expect(insertAt([{ station: 1 }, { station: 2 }], 1, { station: 9 })).toEqual([{ station: 1 }, { station: 9 }, { station: 2 }])
  })

  it('says how long in years and months', () => {
    expect(duration(38)).toBe('3 years 2 months')
    expect(duration(24)).toBe('2 years')
    expect(duration(1)).toBe('1 month')
  })
})

describe('the stand-in quote', () => {
  const city = smallCity()
  const game = standInRules.start(STANDIN_SEASON, city)

  it('snaps stops to junctions and prices the line', () => {
    const q = standInQuote(game, city, { kind: 'metro', stops: [{ at: [77.551, 12.971] }, { at: [77.589, 12.969] }] })
    expect(q.ok).toBe(true)
    expect(q.stations[0]!.at).toEqual([77.55, 12.97])
    expect(q.cost).toBeGreaterThan(0)
    expect(q.months).toBeGreaterThan(30)
  })

  it('refuses stations closer than 600 m and taps far from any road', () => {
    expect(standInQuote(game, city, { kind: 'metro', stops: [{ at: [77.55, 12.97] }, { at: [77.553, 12.97] }] }).ok).toBe(false)
    const far = standInQuote(game, city, { kind: 'metro', stops: [{ at: [77.55, 12.97] }, { at: [77.6, 13.1] }] })
    expect(far.ok).toBe(false)
    expect(far.reason).toMatch(/main road/)
  })

  it('routes a bus along the roads', () => {
    const q = standInQuote(game, city, { kind: 'busRoute', stops: [{ at: [77.55, 12.97] }, { at: [77.6, 12.97] }], buses: 20 })
    expect(q.ok).toBe(true)
    expect(q.path.length).toBeGreaterThan(4)
  })
})

describe('building with the stand-in', () => {
  const city = smallCity()
  const rules = withBuilding(standInRules, city, STANDIN_SEASON)

  it('is used while the rules refuse building, and a line ordered opens after its months', () => {
    expect(rules.standIn).toBe(true)
    const game = rules.start(STANDIN_SEASON, city)
    const outcome = rules.act(game, city, {
      kind: 'build', plan: { kind: 'busRoute', stops: [{ at: [77.55, 12.97] }, { at: [77.6, 12.97] }], buses: 20 },
    })
    expect(outcome.ok).toBe(true)
    expect(game.projects).toHaveLength(1)
    const month = { month: 0, flow: {} as never, speed: {} as never, commute: 3000, commuteByZone: new Int32Array(2),
      trips: { car: 0, twoWheeler: 0, auto: 0, bus: 0, metro: 0, rail: 0, cycle: 0, walk: 0 }, access: 500,
      accessByZone: new Int16Array(2), riders: {}, took: 0 }
    rules.endMonth(game, city, month)
    rules.endMonth(game, city, { ...month, month: 1 })
    expect(game.projects).toHaveLength(0)
    expect(game.built!.lines).toHaveLength(1)
    expect(rules.state(game, city).transit.lines.some((l) => l.kind === 'bus')).toBe(true)
  })

  it('opens a plan into a copy of the game, for the forecast, joining a station that is there', () => {
    const game = rules.start(STANDIN_SEASON, city)
    const plan = { kind: 'metro' as const, stops: [{ station: 0 }, { at: [77.62, 12.97] as [number, number] }] }
    const q = rules.quote(game, city, plan)
    expect(q.ok).toBe(true)
    openInto(game, city, plan, q, 'planned')
    const line = game.built!.lines[0]!
    expect(line.stations[0]).toBe(0)
    expect(game.built!.stations).toHaveLength(1)
  })
})

describe('the player’s lines', () => {
  it('have colours unlike the city’s lines and the traffic', () => {
    const taken = ['#8e3a9d', '#2e9b47', '#e3b505', '#e0579a', '#2f6fc0', ...JAM_COLOURS]
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
    for (const { colour } of LINE_COLOURS) {
      for (const t of taken) {
        const [a, b] = [rgb(colour), rgb(t)]
        expect(Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)).toBeGreaterThan(60)
      }
    }
  })

  it('are fuller with more riders and fewer vehicles', () => {
    const line = { id: 'x', name: 'X', kind: 'bus' as const, colour: '', status: 'open' as const, stations: [], path: [77.55, 12.97, 77.6, 12.97] }
    expect(fullness(line, 20_000, 10)).toBeGreaterThan(fullness(line, 20_000, 40))
  })
})
