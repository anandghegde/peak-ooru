import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { LngLat, Station, Transit, TransitLine, Zone } from '../src/data/types'
import { busPath } from '../src/sim/bus'
import { toKm } from '../src/sim/graph'
import { simulate, type MonthDetail } from '../src/sim/index'
import { defaultVehicles } from '../src/sim/transit'
import { MODES, PERIODS, type CityState, type RoutingNetwork } from '../src/sim/types'
import { asTheyAre, fixtureCity } from './sim-fixture'

// A km east and north in the small city, as in its fixture.
const at = (x: number, y: number): LngLat => [77.55 + x / 108.48, 12.93 + y / 110.57]

/** The small city with a line of the player's added: new stations at the places given, or stations there by id. */
function withLine(city: CityState, id: string, kind: 'metro' | 'bus' | 'rail', stops: (LngLat | number)[], extra: Partial<CityState> = {}) {
  const stations: Station[] = [...city.transit.stations]
  const ids = stops.map((s) => {
    if (typeof s === 'number') return s
    stations.push({ id: 1000 + stations.length, name: 'new', nameKn: null, at: s, kind })
    return 1000 + stations.length - 1
  })
  const line: TransitLine = { id, name: id, kind, colour: '#123456', status: 'open', stations: ids, path: [] }
  const state: CityState = { ...city, ...extra, transit: { stations, lines: [...city.transit.lines, line] } }
  return { state, line }
}

/** Every number of a month is a finite number. */
function sound(r: MonthDetail) {
  expect(Number.isFinite(r.commute)).toBe(true)
  expect(Number.isFinite(r.access)).toBe(true)
  for (const m of MODES) expect(Number.isFinite(r.trips[m])).toBe(true)
  for (const v of Object.values(r.riders)) expect(Number.isFinite(v)).toBe(true)
  for (const p of PERIODS) for (const f of r.flow[p]) expect(Number.isFinite(f)).toBe(true)
  for (const z of r.commuteByZone) expect(Number.isFinite(z)).toBe(true)
}

describe("the player's metro lines", () => {
  const city = fixtureCity()
  const before = simulate(city)

  it('carries riders on a new line that joins nothing', () => {
    const { state } = withLine(city, 'mine', 'metro', [at(1, 1), at(3, 3), at(5, 5), at(6, 6), at(10, 10)])
    const r = simulate(state)
    sound(r)
    expect(r.riders.mine).toBeGreaterThan(0)
    // Slice 7: in the small city the new line takes riders from the old one as well as from the roads, and the metro's
    // trips in all may fall a little (not understood; see docs/MODEL.md, "Slice 7").
    expect(r.trips.metro).toBeGreaterThan(0.75 * before.trips.metro)
    // Some take it for comfort or money rather than time: the small city's commute may move a trace either way.
    expect(r.commute).toBeLessThan(before.commute * 1.01)
  })

  it('joins the city\'s line where it shares a station, and riders change there', () => {
    // Station 3 is on the east-west line in service.
    const { state } = withLine(city, 'mine', 'metro', [at(5.5, 11), at(5.5, 8), 3])
    const r = simulate(state)
    sound(r)
    expect(r.riders.mine).toBeGreaterThan(0)
    expect(r.riders['east-west']).toBeGreaterThan(before.riders['east-west']!)
  })

  it('takes a line of two stations, stations far from any road, stations that do not exist, and one of none', () => {
    const cases: (LngLat | number)[][] = [
      [at(1, 1), at(10, 10)],
      [at(-30, -30), at(-25, -30), at(-20, -30)],
      [at(1, 1), 99_999, at(10, 10)],
      [at(1, 1), at(1, 1)],
      [],
    ]
    for (const stops of cases) {
      const r = simulate(withLine(city, 'mine', 'metro', stops).state)
      sound(r)
      expect(r.riders.mine).toBeGreaterThanOrEqual(0)
    }
  })

  it('carries no one on a line with no trains, and more on one with more', () => {
    const line = withLine(city, 'mine', 'metro', [at(1, 1), at(3, 3), at(5, 5), at(6, 6), at(10, 10)])
    const trains = defaultVehicles(line.state.transit, 'mine')
    expect(trains).toBeGreaterThan(0)
    const none = simulate({ ...line.state, vehicles: { mine: 0 } }) as MonthDetail
    expect(none.riders.mine).toBe(0)
    const few = simulate({ ...line.state, vehicles: { mine: 2 } }) as MonthDetail
    const many = simulate({ ...line.state, vehicles: { mine: 4 * trains } }) as MonthDetail
    const usual = simulate(line.state) as MonthDetail
    expect(few.headway.mine).toBeGreaterThan(usual.headway.mine!)
    expect(many.headway.mine).toBeLessThan(usual.headway.mine!)
    expect(many.riders.mine).toBeGreaterThan(few.riders.mine!)
  })

  it('runs a city line at its published headway with its usual trains, and closer with more', () => {
    const usual = before as MonthDetail
    const trains = defaultVehicles(city.transit, 'east-west')
    const same = simulate({ ...city, vehicles: { 'east-west': trains } }) as MonthDetail
    expect(same.headway['east-west']).toBe(usual.headway['east-west'])
    const more = simulate({ ...city, vehicles: { 'east-west': 2 * trains } }) as MonthDetail
    expect(more.headway['east-west']).toBeLessThan(usual.headway['east-west']!)
  })
})

describe("the player's bus routes and bus lanes", () => {
  const city = fixtureCity()
  const before = simulate(city)
  // Along the main road at y = 4, west to east.
  const stops = [at(0, 4), at(3, 4), at(6, 4), at(9, 4), at(11, 4)]

  it('runs a route on the roads between its stops', () => {
    const { state, line } = withLine(city, 'route', 'bus', stops)
    const path = busPath(state.roads, line, state.transit.stations)
    expect(path.length).toBeGreaterThanOrEqual(10)
    for (let k = 1; k < path.length; k++) expect(state.roads.links[path[k]!]!.from).toBe(state.roads.links[path[k - 1]!]!.to)
  })

  it('carries riders, as buses, and more with more buses, which run more often', () => {
    const few = simulate(withLine(city, 'route', 'bus', stops, { vehicles: { route: 2 } }).state) as MonthDetail
    const many = simulate(withLine(city, 'route', 'bus', stops, { vehicles: { route: 20 } }).state) as MonthDetail
    sound(few)
    sound(many)
    expect(few.riders.route).toBeGreaterThan(0)
    expect(many.riders.route).toBeGreaterThan(few.riders.route!)
    expect(many.headway.route).toBeLessThan(few.headway.route!)
    expect(many.trips.bus).toBeGreaterThan(before.trips.bus)
    expect(many.lineFare.route).toBeGreaterThan(0)
  })

  it('takes a route of two stops, one with all its stops at one junction, and one with no buses', () => {
    for (const s of [[at(0, 4), at(11, 4)], [at(3, 4), at(3.01, 4)], [at(-40, 4), at(-30, 4)]]) {
      sound(simulate(withLine(city, 'route', 'bus', s, { vehicles: { route: 5 } }).state))
    }
    const none = simulate(withLine(city, 'route', 'bus', stops, { vehicles: { route: 0 } }).state)
    expect(none.riders.route).toBe(0)
  })

  it('speeds the buses in a bus lane and takes a lane from the rest', () => {
    const { state, line } = withLine(city, 'route', 'bus', stops, { vehicles: { route: 10 } })
    const lanes = busPath(state.roads, line, state.transit.stations)
    const plain = simulate(state) as MonthDetail
    const laned = simulate({ ...state, busLanes: lanes }) as MonthDetail
    sound(laned)
    expect(laned.riders.route).toBeGreaterThan(plain.riders.route!)
    expect(laned.headway.route).toBeLessThanOrEqual(plain.headway.route!)
    expect(laned.trips.bus).toBeGreaterThan(plain.trips.bus)
  })

  it('does nothing much with a bus lane on an empty road', () => {
    // A side road at the northern edge, which carries little.
    const quiet = city.roads.links.filter((l) => l.lanes >= 2 && before.flow.morning[l.id]! < 50).map((l) => l.id).slice(0, 4)
    expect(quiet.length).toBeGreaterThan(0)
    const r = simulate({ ...city, busLanes: quiet })
    expect(Math.abs(r.commute - before.commute)).toBeLessThan(0.002 * before.commute)
  })
})

describe('works on the roads', () => {
  const city = asTheyAre(fixtureCity())
  const before = simulate(city)

  it('slow a busy road that loses a lane, and send traffic round it', () => {
    // The busiest main road not already at a crawl.
    let busiest = -1
    for (const l of city.roads.links) {
      if (l.lanes < 2 || before.speed.morning[l.id]! < 400) continue
      if (busiest < 0 || before.flow.morning[l.id]! > before.flow.morning[busiest]!) busiest = l.id
    }
    const r = simulate({ ...city, works: [busiest] })
    sound(r)
    expect(r.speed.morning[busiest]!).toBeLessThan(before.speed.morning[busiest]!)
    expect(r.flow.morning[busiest]!).toBeLessThan(before.flow.morning[busiest]!)
    // Works along every main road slow driving and riding. (The average commute, and the average time lost to traffic,
    // can fall even so, as the slowest way, the bus in traffic, loses riders to quicker ways: slice 7.)
    const everywhere = simulate({ ...city, works: city.roads.links.filter((l) => l.lanes >= 2).map((l) => l.id) }) as MonthDetail
    const b = before as MonthDetail
    for (const m of ['car', 'twoWheeler'] as const) expect(everywhere.commuteByMode[m].seconds).toBeGreaterThan(b.commuteByMode[m].seconds)
  })

  it('take any list of links, even ones that do not exist', () => {
    sound(simulate({ ...city, works: [-1, 1e9, 0, 0, 0, 0], busLanes: [-5, 1e9, 3] }))
  })
})

describe('lines in Bengaluru', () => {
  const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../public/data/${file}`, import.meta.url), 'utf8')) as T
  const city: CityState = asTheyAre({ month: 0, seed: 1, zones: read<Zone[]>('zones.json'), roads: read<RoutingNetwork>('routing.json'), transit: read<Transit>('transit.json') })
  const before = simulate(city)
  // The Blue Line's course along the Outer Ring Road, Silk Board to KR Puram, by its stations in the data.
  const orr = [79, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111]
  const byId = new Map(city.transit.stations.map((s) => [s.id, s]))
  const near = (km: number) => {
    const a = new Float64Array(2)
    const b = new Float64Array(2)
    return city.zones.filter((z) => {
      toKm(z.centre[0], z.centre[1], a, 0)
      return orr.some((id) => {
        toKm(byId.get(id)!.at[0], byId.get(id)!.at[1], b, 0)
        return (a[0]! - b[0]!) ** 2 + (a[1]! - b[1]!) ** 2 <= km * km
      })
    })
  }
  const served = near(1)
  const commute = (r: MonthDetail) => served.reduce((s, z) => s + z.people * r.commuteByZone[z.id]!, 0) / served.reduce((s, z) => s + z.people, 0)

  it('cuts the commute of the zones a metro line on the Outer Ring Road serves by a tenth or more', () => {
    const r = simulate({ ...city, transit: { ...city.transit, lines: [...city.transit.lines, { id: 'orr', name: 'orr', kind: 'metro', colour: '#000', status: 'open', stations: orr, path: [] }] } })
    expect(r.riders.orr).toBeGreaterThan(200_000)
    expect(commute(r)).toBeLessThan(0.9 * commute(before))
    expect(r.commute).toBeLessThan(before.commute)
  })

  it('makes a bus route in bus lanes there clearly worth having, and bus lanes on empty roads worth nothing', () => {
    const line: TransitLine = { id: 'orr-bus', name: 'orr', kind: 'bus', colour: '#000', status: 'open', stations: orr, path: [] }
    const state: CityState = { ...city, transit: { ...city.transit, lines: [...city.transit.lines, line] }, vehicles: { 'orr-bus': 40 } }
    const lanes = [...busPath(city.roads, line, city.transit.stations), ...busPath(city.roads, { ...line, stations: [...orr].reverse() }, city.transit.stations)]
    const r = simulate({ ...state, busLanes: lanes.filter((l) => city.roads.links[l]!.lanes >= 2) })
    expect(r.riders['orr-bus']).toBeGreaterThan(20_000)
    expect(commute(r)).toBeLessThan(0.95 * commute(before))
    const quiet = city.roads.links
      .filter((l) => l.lanes >= 2 && l.kind !== 'motorway')
      .sort((a, b) => before.flow.morning[a.id]! - before.flow.morning[b.id]! || a.id - b.id)
      .slice(0, 40)
      .map((l) => l.id)
    const empty = simulate({ ...city, busLanes: quiet })
    expect(Math.abs(empty.commute - before.commute)).toBeLessThan(0.002 * before.commute)
  })
})
