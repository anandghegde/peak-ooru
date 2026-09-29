import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Transit, Zone } from '../src/data/types'
import { digest } from '../src/sim/digest'
import { simulate, type MonthDetail } from '../src/sim/index'
import { LOWLAND, UNDERPASSES } from '../src/sim/lowland'
import { grade, surfaceCapacity, surfaceSpeed } from '../src/sim/surface'
import { PERIODS, type CityState, type RoutingNetwork } from '../src/sim/types'
import { asTheyAre, fixtureCity } from './sim-fixture'

const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../public/data/${file}`, import.meta.url), 'utf8')) as T

/** Vehicles a weekday and vehicle-km, over the links given. */
const vehicles = (r: MonthDetail, ids: number[]) => ids.reduce((s, id) => s + r.vehiclesByLink![id]!, 0)

/** The busiest link of two lanes or more at the morning peak, not already at a crawl. */
function busiest(state: CityState, r: MonthDetail): number {
  let best = -1
  for (const l of state.roads.links) {
    if (l.lanes < 2 || l.from === l.to || r.speed.morning[l.id]! < 400) continue
    if (best < 0 || r.flow.morning[l.id]! > r.flow.morning[best]!) best = l.id
  }
  return best
}

describe('what a surface keeps', () => {
  it('meets the PRD\'s marks in the middle of each grade, smoothly, and nothing is lost at 100', () => {
    expect(surfaceSpeed(100)).toBe(1)
    expect(surfaceCapacity(100)).toBe(1)
    expect(surfaceSpeed(62.5)).toBeCloseTo(0.95, 10)
    expect(surfaceSpeed(37.5)).toBeCloseTo(0.8, 10)
    expect(surfaceCapacity(37.5)).toBeCloseTo(0.9, 10)
    expect(surfaceSpeed(12.5)).toBeCloseTo(0.6, 10)
    expect(surfaceCapacity(12.5)).toBeCloseTo(0.75, 10)
    // Every point is worth something.
    for (let c = 1; c <= 100; c++) {
      expect(surfaceSpeed(c)).toBeGreaterThan(surfaceSpeed(c - 1))
      expect(surfaceCapacity(c)).toBeGreaterThan(surfaceCapacity(c - 1))
    }
    expect(surfaceSpeed(-5)).toBe(surfaceSpeed(0))
    expect(surfaceSpeed(Number.NaN)).toBe(surfaceSpeed(0))
    expect([grade(80), grade(74), grade(50), grade(49), grade(25), grade(24)]).toEqual([0, 1, 1, 2, 2, 3])
  })
})

describe('the state of the roads, in the small city', () => {
  const city = fixtureCity()
  const r0 = simulate(city)

  it('changes nothing at all when every road and street is at 100', () => {
    const r = simulate({ ...city, surface: city.roads.links.map(() => 100), streets: city.zones.map(() => 100), shut: {} })
    expect(digest(r)).toBe(digest(r0))
  })

  it('gives the rules the traffic each link carried, the heavy part of it, and bus-km by grade', () => {
    const L = city.roads.links.length
    expect(r0.vehiclesByLink).toBeInstanceOf(Int32Array)
    expect(r0.vehiclesByLink!.length).toBe(L)
    expect(r0.heavyByLink!.length).toBe(L)
    let all = 0, heavy = 0
    for (let l = 0; l < L; l++) {
      expect(Number.isInteger(r0.vehiclesByLink![l])).toBe(true)
      expect(r0.heavyByLink![l]).toBeGreaterThanOrEqual(0)
      expect(r0.heavyByLink![l]).toBeLessThanOrEqual(r0.vehiclesByLink![l]!)
      all += r0.vehiclesByLink![l]!
      heavy += r0.heavyByLink![l]!
    }
    expect(heavy).toBeGreaterThan(0)
    expect(heavy).toBeLessThan(0.3 * all)
    const k = r0.busKmByGrade!
    expect(k[0]).toBeGreaterThan(0)
    expect(k[1] + k[2] + k[3]).toBe(0)
    // All poor: the buses run on poor roads.
    const poor = simulate({ ...city, surface: city.roads.links.map(() => 30) })
    expect(poor.busKmByGrade![2]).toBeGreaterThan(0)
    expect(poor.busKmByGrade![0] + poor.busKmByGrade![1] + poor.busKmByGrade![3]).toBe(0)
    for (let l = 0; l < L; l++) expect(r0.surfaceDelay![l]).toBe(0)
  })

  it('slows a busy road in poor repair, sends traffic off it, and says what it costs; mending it gives all that back', () => {
    const b = busiest(city, r0)
    const surface = city.roads.links.map((l) => (l.id === b ? 20 : 100))
    const r = simulate({ ...city, surface })
    expect(r.speed.morning[b]!).toBeLessThan(r0.speed.morning[b]!)
    expect(r.speed.night[b]!).toBeLessThan(r0.speed.night[b]!)
    expect(r.vehiclesByLink![b]!).toBeLessThan(r0.vehiclesByLink![b]!)
    expect(r.surfaceDelay![b]!).toBeGreaterThan(0)
    expect(r.commute).toBeGreaterThanOrEqual(r0.commute)
    // Every road poor: the city is slower still.
    const all = simulate({ ...city, surface: city.roads.links.map(() => 30) })
    expect(all.commute).toBeGreaterThan(r.commute)
  })

  it('kills more on broken roads, though traffic is slower on them', () => {
    const broken = simulate({ ...city, surface: city.roads.links.map(() => 10) })
    expect(broken.deaths!).toBeGreaterThan(r0.deaths!)
    expect(broken.deathsBy.twoWheeler).toBeGreaterThanOrEqual(r0.deathsBy.twoWheeler)
  })

  it('slows the trips of a zone whose streets are poor', () => {
    const z = 0
    const r = simulate({ ...city, streets: city.zones.map((x) => (x.id === z ? 10 : 100)) })
    expect(r.commuteByZone[z]!).toBeGreaterThan(r0.commuteByZone[z]!)
  })

  it('carries nothing on a road shut all month, and less on one shut for part of it', () => {
    const b = busiest(city, r0)
    const all = simulate({ ...city, shut: { [b]: 1000 } })
    for (const p of PERIODS) expect(all.flow[p][b]!).toBeLessThan(Math.max(1, 0.01 * r0.flow[p][b]!))
    const part = simulate({ ...city, shut: { [b]: 300 } })
    expect(part.vehiclesByLink![b]!).toBeLessThan(r0.vehiclesByLink![b]!)
    expect(part.vehiclesByLink![b]!).toBeGreaterThan(all.vehiclesByLink![b]!)
    // In the small city the average commute moves by a few seconds either way: who drives, and who takes the bus, moves
    // with it (slice 7).
    expect(Math.abs(all.commute - r0.commute)).toBeLessThan(15)
    // Ids that are not links, and shares beyond the month, are taken in stride.
    expect(Number.isFinite(simulate({ ...city, shut: { [-3]: 500, 1e9: 500, [b]: 5000 } }).commute)).toBe(true)
  })
})

describe('the state of the roads, in Bengaluru', () => {
  const city: CityState = asTheyAre({ month: 0, seed: 1, zones: read<Zone[]>('zones.json'), roads: read<RoutingNetwork>('routing.json'), transit: read<Transit>('transit.json') })
  const r0 = simulate(city)
  const names = new Map(read<{ links: { id: number; name?: string }[] }>('network.json').links.map((l) => [l.id, l.name ?? '']))
  const ring = city.roads.links.filter((l) => l.drawn.some((d) => /Outer Ring Road/.test(names.get(d) ?? ''))).map((l) => l.id)

  it('makes mending the Outer Ring Road, busy and poor, clearly worth having', () => {
    const surface = [...city.surface!]
    for (const id of ring) surface[id] = 100
    const r = simulate({ ...city, surface })
    expect(vehicles(r, ring)).toBeGreaterThan(1.05 * vehicles(r0, ring))
    expect(r.commute).toBeLessThan(r0.commute - 18)
    expect(r.deaths!).toBeLessThan(r0.deaths!)
    // Two-wheeler riders gain most.
    expect(r0.deathsBy.twoWheeler - r.deathsBy.twoWheeler).toBeGreaterThan(r0.deathsBy.other - r.deathsBy.other)
  })

  it('lists the low-lying links by id, the underpasses among them', () => {
    const L = city.roads.links.length
    expect(LOWLAND.length).toBeGreaterThan(0.05 * L)
    expect(LOWLAND.length).toBeLessThan(0.25 * L)
    for (let k = 0; k < LOWLAND.length; k++) {
      expect(LOWLAND[k]).toBeGreaterThanOrEqual(0)
      expect(LOWLAND[k]).toBeLessThan(L)
      if (k > 0) expect(LOWLAND[k]).toBeGreaterThan(LOWLAND[k - 1]!)
    }
    const low = new Set(LOWLAND)
    for (const id of UNDERPASSES) expect(low.has(id)).toBe(true)
  })
})
