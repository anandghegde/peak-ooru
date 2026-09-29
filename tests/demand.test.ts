import { describe, expect, it } from 'vitest'
import { makeTours } from '../src/sim/demand'
import { DEMAND, GROUPING } from '../src/sim/params'
import { modelZones } from '../src/sim/zones'
import { fixtureCity } from './sim-fixture'

describe('trips between zones', () => {
  const city = fixtureCity()
  const zones = city.zones
  const Z = zones.length
  const { work, other } = makeTours(zones)
  const jobs = zones.reduce((s, z) => s + z.jobs, 0)
  const people = zones.reduce((s, z) => s + z.people, 0)
  const row = (t: Float64Array, i: number) => t.slice(i * Z, i * Z + Z).reduce((s, x) => s + x, 0)

  it('sends to work a share of the people, from where they live', () => {
    const total = work.reduce((s, x) => s + x, 0)
    expect(total / (DEMAND.workersPerPerson * people)).toBeCloseTo(1, 6)
    // Each zone's workers in proportion to its people.
    for (let i = 0; i < Z; i++) expect(row(work, i) / total).toBeCloseTo(zones[i]!.people / people, 4)
  })

  it('draws work trips to where the jobs are', () => {
    // The zone with the most jobs draws more work trips than the one with the fewest.
    const col = (j: number) => Array.from({ length: Z }, (_, i) => work[i * Z + j]!).reduce((s, x) => s + x, 0)
    const most = zones.reduce((a, b) => (b.jobs > a.jobs ? b : a))
    const least = zones.reduce((a, b) => (b.jobs < a.jobs ? b : a))
    expect(col(most.id)).toBeGreaterThan(col(least.id))
  })

  it('makes other trips in proportion to people, mostly near home', () => {
    for (let i = 0; i < Z; i++) expect(row(other, i)).toBeCloseTo(DEMAND.otherPerPerson * zones[i]!.people, 3)
    // More of a zone's other trips stay in it than go to any one other zone.
    for (let i = 0; i < Z; i++) {
      for (let j = 0; j < Z; j++) if (j !== i) expect(other[i * Z + i]!).toBeGreaterThan(other[i * Z + j]!)
    }
  })
})

describe('the zones the model works on', () => {
  const city = fixtureCity()
  const grouped = modelZones(city.zones, city.roads.zoneNode)

  it('groups wards into the set share as many, and leaves the zones outside the wards alone', () => {
    const wards = city.zones.filter((z) => z.ward).length
    const groups = new Set(city.zones.filter((z) => z.ward).map((z) => grouped.of[z.id]))
    expect(groups.size).toBe(Math.ceil(wards * GROUPING.share))
    for (const z of city.zones.filter((z) => !z.ward)) {
      expect(city.zones.filter((y) => grouped.of[y.id] === grouped.of[z.id]).length).toBe(1)
    }
  })

  it('keeps every person and job', () => {
    const sum = (list: { people: number; jobs: number }[]) => list.reduce((s, z) => [s[0]! + z.people, s[1]! + z.jobs], [0, 0])
    expect(sum(grouped.zones)).toEqual(sum(city.zones))
  })
})
