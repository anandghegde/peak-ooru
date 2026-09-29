import { describe, expect, it } from 'vitest'
import type { Network } from '../src/data/types'
import { standInRouting, standInSimulate } from '../src/game/standin'
import { level, slot, trafficView } from '../src/game/traffic'
import { DAY_SECONDS, phase } from '../src/map/playback'
import { dots, resample } from '../src/map/vehicles'
import type { CityState } from '../src/sim/types'

// Two stretches: a two-way road 1 km long running east, and a one-way road 500 m long running north from its end.
const network: Network = {
  nodes: [
    { id: 0, at: [77.59, 12.97] },
    { id: 1, at: [77.5992, 12.97] },
    { id: 2, at: [77.5992, 12.9745] },
  ],
  links: [
    { id: 0, a: 0, b: 1, line: [77.59, 12.97, 77.595, 12.97, 77.5992, 12.97], length: 1000, kind: 'primary', lanes: 2,
      oneway: false, speed: 50, name: 'Hosur Road', level: 0 },
    { id: 1, a: 1, b: 2, line: [77.5992, 12.97, 77.5992, 12.9745], length: 500, kind: 'tertiary', lanes: 1,
      oneway: true, speed: 30, name: null, level: 0 },
  ],
}
const zones = [
  { id: 0, name: 'A', nameKn: null, node: 0, centre: [77.59, 12.97], area: 1, people: 1000, jobs: 100, income: 3 },
  { id: 1, name: 'B', nameKn: null, node: 2, centre: [77.5992, 12.9745], area: 1, people: 500, jobs: 900, income: 3 },
] as CityState['zones']
const roads = standInRouting(network, zones)
const month = standInSimulate({ month: 0, seed: 1, zones, roads, transit: { stations: [], lines: [] } })
const view = trafficView(roads, month)

describe('the stand-in routing network', () => {
  it('makes a link for each direction a stretch can be driven, each standing for its stretch', () => {
    expect(roads.links).toHaveLength(3)
    expect(roads.links.map((l) => [l.drawn[0], l.forward[0]])).toEqual([[0, true], [0, false], [1, true]])
  })
})

describe('the traffic view', () => {
  it('grades speed into moving well, slow, very slow and jammed', () => {
    expect([level(900), level(500), level(350), level(100)]).toEqual([0, 1, 2, 3])
  })

  it('has a level for every drawn stretch in every part of the day, and no traffic against a one-way road', () => {
    expect(view.stretches).toBe(2)
    for (const p of ['morning', 'midday', 'evening', 'night'] as const) expect(view.level[p]).toHaveLength(2)
    for (let p = 0; p < 4; p++) expect(view.density[slot(1, 1, p)]).toBe(0)
    expect(view.density[slot(0, 1, 2)]).toBeGreaterThan(0)
  })

  it('shows the evening peak busier than the night', () => {
    expect(view.density[slot(0, 0, 2)]).toBeGreaterThan(view.density[slot(0, 0, 3)]!)
  })
})

describe('the playback', () => {
  it('plays the four parts of the day in turn, one at a time with a short blend between', () => {
    expect(phase(0)).toEqual({ period: 0, weight: [1, 0, 0, 0] })
    expect(phase(DAY_SECONDS * 0.6).period).toBe(2)
    expect(phase(DAY_SECONDS).period).toBe(3)
    for (let t = 0; t < DAY_SECONDS; t += 0.1) {
      const sum = phase(t).weight.reduce((a, b) => a + b, 0)
      expect(sum).toBeCloseTo(1, 6)
    }
  })

  it('resamples each stretch to even steps no longer than 30 m, ending where the line ends', () => {
    const path = resample(network, [0, 0])
    expect(path.count[0]).toBe(35)
    expect(path.spacing[0]! * (path.count[0]! - 1)).toBeCloseTo(1000, 3)
    const last = path.first[0]! + path.count[0]! - 1
    const next = path.first[1]!
    // The first stretch's last point is the second stretch's first.
    expect(path.points[last * 2]).toBeCloseTo(path.points[next * 2]!, 6)
    expect(path.points[last * 2 + 1]).toBeCloseTo(path.points[next * 2 + 1]!, 6)
  })

  it('shares out the dots by the traffic on each stretch, keeping to the budget', () => {
    const path = resample(network, [0, 0])
    const data = dots(network, view, path, 100, [true, false])
    const n = data.length / 16
    expect(n).toBeGreaterThan(90)
    expect(n).toBeLessThanOrEqual(100)
    // No dot runs against the one-way road.
    for (let i = 0; i < n; i++) {
      const start = data[i * 16]!
      if (start === path.first[1]) expect(data[i * 16 + 13]).toBe(1)
    }
  })
})
