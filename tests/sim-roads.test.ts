import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Transit, Zone } from '../src/data/types'
import { linkTimes, movingTime } from '../src/sim/assign'
import { busPath, fingerprint } from '../src/sim/bus'
import { digest } from '../src/sim/digest'
import { buildNet } from '../src/sim/graph'
import { linkKmh, simulate, type MonthDetail } from '../src/sim/index'
import { ROAD } from '../src/sim/params'
import { PERIODS, type CityState, type RoutingLink, type RoutingNetwork, type RoutingNode } from '../src/sim/types'
import { asTheyAre, fixtureCity } from './sim-fixture'

const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../public/data/${file}`, import.meta.url), 'utf8')) as T

/** A copy of the network, as the rules make one. */
function copy(roads: RoutingNetwork): { nodes: RoutingNode[]; links: RoutingLink[]; zoneNode: number[] } {
  return { nodes: roads.nodes.map((n) => ({ ...n })), links: roads.links.map((l) => ({ ...l })), zoneNode: roads.zoneNode }
}

/** A road both ways between two junctions, appended. */
function withRoad(roads: RoutingNetwork, a: number, b: number, length: number, flyover = false): RoutingNetwork {
  const out = copy(roads)
  for (const [from, to] of [[a, b], [b, a]] as const) {
    out.links.push({
      id: out.links.length, from, to, length, lanes: 2, kind: flyover ? 'trunk' : 'primary', speed: flyover ? 60 : 50,
      capacity: 2580, signals: 0, drawn: [], forward: [],
    })
  }
  return out
}

function sound(r: MonthDetail, zones: number) {
  expect(Number.isInteger(r.deaths)).toBe(true)
  expect(r.deathsByZone).toBeInstanceOf(Int32Array)
  expect(r.deathsByZone!.length).toBe(zones)
  let sum = 0
  for (const d of r.deathsByZone!) {
    expect(Number.isInteger(d)).toBe(true)
    expect(d).toBeGreaterThanOrEqual(0)
    sum += d
  }
  expect(sum).toBe(r.deaths)
  for (const p of PERIODS) for (const f of r.flow[p]) expect(Number.isFinite(f)).toBe(true)
  expect(Number.isFinite(r.commute)).toBe(true)
}

describe('roads the player builds, in the small city', () => {
  const city = fixtureCity()
  const before = simulate(city)
  // The grid is 12 × 12, a km apart: node y * 12 + x.

  it('sends traffic over a new road', () => {
    // A diagonal flyover from (1, 1) to (6, 6), 7.1 km, where the grid makes traffic go round two sides.
    const roads = withRoad(city.roads, 13, 78, 7071, true)
    const r = simulate({ ...city, roads })
    sound(r, city.zones.length)
    const n = city.roads.links.length
    expect(r.flow.morning[n]! + r.flow.morning[n + 1]!).toBeGreaterThan(0)
  })

  it('takes a link shut to make its opposite one-way: nothing on it, and every place still reached', () => {
    const out = copy(city.roads)
    const l = out.links.find((x) => x.kind === 'secondary')!
    const back = out.links.find((x) => x.from === l.to && x.to === l.from)!
    l.lanes += back.lanes
    l.capacity += back.capacity
    back.to = back.from
    const r = simulate({ ...city, roads: out })
    sound(r, city.zones.length)
    for (const p of PERIODS) expect(r.flow[p][back.id]).toBe(0)
    expect(Math.abs(r.commute - before.commute)).toBeLessThan(0.05 * before.commute)
  })

  it('works on a network rebuilt equal each month as on the one it was given, and knows it by its fingerprint', () => {
    const again = JSON.parse(JSON.stringify(city.roads)) as RoutingNetwork
    expect(fingerprint(again)).toBe(fingerprint(city.roads))
    expect(digest(simulate({ ...city, roads: again }))).toBe(digest(before))
    const line = city.transit.lines[0]!
    expect(busPath(again, line, city.transit.stations)).toEqual(busPath(city.roads, line, city.transit.stations))
    expect(fingerprint(withRoad(city.roads, 13, 78, 7071))).not.toBe(fingerprint(city.roads))
  })
})

describe('speed limits', () => {
  const city = fixtureCity()

  it('hold traffic to the limit on a quiet road, and cost nothing where traffic is slower anyway', () => {
    const limits: Record<number, number> = {}
    for (const l of city.roads.links) if (l.speed > 30) limits[l.id] = 30
    const net = buildNet(city.roads, city.zones, city.roads.zoneNode, undefined, { limits })
    const free = buildNet(city.roads, city.zones, city.roads.zoneNode)
    const l = city.roads.links.find((x) => x.speed > 30)!.id
    const quiet = new Float64Array(net.links)
    const a = new Float64Array(net.links)
    const b = new Float64Array(net.links)
    linkTimes(net, quiet, a)
    linkTimes(free, quiet, b)
    expect(a[l]!).toBeCloseTo((1000 * 3.6) / 30 + net.delay[l]!, 6)
    expect(a[l]!).toBeGreaterThan(b[l]!)
    // Jammed: slower than 30 km/h without the limit, so the limit adds nothing.
    const jam = new Float64Array(net.links)
    jam[l] = 1.4 * net.capacity[l]!
    linkTimes(net, jam, a)
    linkTimes(free, jam, b)
    expect(a[l]!).toBe(b[l]!)
    expect(movingTime(net, l, jam[l]!)).toBe(movingTime(free, l, jam[l]!))
  })

  it('does nothing on a road whose free speed is below the limit', () => {
    const limits: Record<number, number> = {}
    for (const l of city.roads.links) if (l.speed <= 30) limits[l.id] = 40
    const { limits: _, ...r } = simulate({ ...city, limits })
    expect(digest(r)).toBe(digest(simulate(city)))
  })

  it('costs time and saves lives, and shows the limited road at its limit, not as a jam, at night', () => {
    const limits: Record<number, number> = {}
    for (const l of city.roads.links) if (l.speed > 30) limits[l.id] = 30
    const r0 = simulate(city)
    const r = simulate({ ...city, limits })
    sound(r, city.zones.length)
    // Driving takes longer. (The average commute can fall even so, as bus riders, whose buses the limit slows too,
    // take quicker ways: slice 7.)
    expect(r.commuteByMode.car.seconds).toBeGreaterThan(r0.commuteByMode.car.seconds)
    expect(r.commuteByMode.twoWheeler.seconds).toBeGreaterThan(r0.commuteByMode.twoWheeler.seconds)
    expect(r.deaths!).toBeLessThan(r0.deaths!)
    expect(r.limits).toEqual(limits)
    const main = city.roads.links.find((x) => x.speed > 30)!
    expect(r.speed.night[main.id]!).toBeGreaterThan(900)
  })
})

describe('road deaths in Bengaluru', () => {
  // With the roads about as the season starts them, as the model is calibrated (slice 6).
  const state: CityState = asTheyAre({ month: 0, seed: 1, zones: read<Zone[]>('zones.json'), roads: read<RoutingNetwork>('routing.json'), transit: read<Transit>('transit.json') })
  const r = simulate(state)
  const wards = state.zones.filter((z) => z.ward !== undefined).reduce((s, z) => s + r.deathsByZone![z.id]!, 0)

  it('come to the traffic police\'s figure for the city, most of them on foot and on two-wheelers', () => {
    sound(r, state.zones.length)
    // BTP: 878 killed in 2025; 225 on foot; 59% of the killed on two-wheelers (2023).
    expect(wards).toBeGreaterThan(830)
    expect(wards).toBeLessThan(930)
    expect(r.deathsBy.walk + r.deathsBy.twoWheeler).toBeGreaterThan(0.8 * r.deaths!)
    expect(r.deathsBy.twoWheeler).toBeGreaterThan(r.deathsBy.walk)
  })

  it('fall with footpaths, where they are laid, and more people walk', () => {
    const worst = [...r.deathsByZone!].map((d, z) => [d, z] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, 20).map(([, z]) => z)
    const f = simulate({ ...state, footpaths: worst })
    const there = (x: MonthDetail) => worst.reduce((s, z) => s + x.deathsByZone![z]!, 0)
    expect(there(f)).toBeLessThan(0.95 * there(r))
    expect(f.deathsBy.walk).toBeLessThan(r.deathsBy.walk)
    expect(f.trips.walk).toBeGreaterThan(r.trips.walk)
  })

  it('fall as two-wheelers give way to other modes', () => {
    const f = simulate({ ...state, ownership: { car: 1000, twoWheeler: 800 } })
    expect(f.deathsBy.twoWheeler).toBeLessThan(0.9 * r.deathsBy.twoWheeler)
  })

  it('fall with junction work at the junctions worked on', () => {
    const roads = copy(state.roads)
    const into = new Map<number, number>()
    for (const l of state.roads.links) into.set(l.to, (into.get(l.to) ?? 0) + r.flow.night[l.id]!)
    const busiest = [...into].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 30).map(([n]) => n)
    for (const n of busiest) (roads.nodes[n] as RoutingNode & { work?: string }).work = 'redesign'
    const f = simulate({ ...state, roads })
    expect(f.deaths!).toBeLessThan(r.deaths!)
  })
})

describe('roads the player builds, in Bengaluru', () => {
  const state: CityState = { month: 0, seed: 1, zones: read<Zone[]>('zones.json'), roads: read<RoutingNetwork>('routing.json'), transit: read<Transit>('transit.json') }
  const r = simulate(state)
  const kmh = (s: CityState, x: MonthDetail, ids: number[]) => {
    let km = 0, h = 0
    for (const id of ids) {
      const l = s.roads.links[id]!
      for (const p of ['morning', 'evening'] as const) {
        const k = (x.flow[p][id]! * l.length) / 1000 + 1e-9
        km += k
        h += k / linkKmh(s.roads, x, p, l)
      }
    }
    return km / h
  }

  it('relieves a junction with a flyover over it, and sends the traffic over the flyover', () => {
    // Silk Board (node 159): the Outer Ring Road lifted over it, between the junctions either side.
    const into = state.roads.links.filter((l) => l.to === 159)
    const ends = into.filter((l) => l.kind === 'trunk' && l.lanes === 3).map((l) => l.from)
    expect(ends.length).toBe(2)
    const [a, b] = ends.map((k) => state.roads.nodes[k]!.at)
    const metres = Math.round(Math.hypot((a![0] - b![0]) * 0.10848, (a![1] - b![1]) * 0.11057))
    const roads = withRoad(state.roads, ends[0]!, ends[1]!, metres, true)
    const s = { ...state, roads }
    const f = simulate(s)
    const n = state.roads.links.length
    expect(f.flow.evening[n]! + f.flow.evening[n + 1]!).toBeGreaterThan(2000)
    const ids = into.map((l) => l.id)
    // Slice 7: trips are shared among their near-best ways, so fewer leave the junction for the flyover than when each
    // pair took only its quickest way (+3.3 km/h then).
    expect(kmh(s, f, ids)).toBeGreaterThan(kmh(state, r, ids) + 1)
  })

  it('slows the city with signals at every junction without them, and speeds it with more room at every one', () => {
    const signalled = copy(state.roads)
    for (const node of signalled.nodes) {
      if (node.signal || node.gateway) continue
      node.signal = true
      for (const l of signalled.links) if (l.to === node.id) l.signals = (l.signals ?? 0) + 1
    }
    expect(simulate({ ...state, roads: signalled }).commute).toBeGreaterThan(r.commute + 60)
    const roomier = copy(state.roads)
    for (const l of roomier.links) l.capacity = Math.round(l.capacity * 1.15)
    expect(simulate({ ...state, roads: roomier }).commute).toBeLessThan(r.commute - 60)
  })
})

describe('the city as it grows', () => {
  const zones = read<Zone[]>('zones.json')
  const state = (grow: number): CityState => ({
    month: 0, seed: 1, roads: read<RoutingNetwork>('routing.json'), transit: read<Transit>('transit.json'),
    zones: zones.map((z) => ({ ...z, people: Math.round(z.people * grow), jobs: Math.round(z.jobs * grow) })),
  })
  const now = simulate(state(1))
  const later = simulate(state(1.2))

  it('is met by travellers as it is: more of them take the metro as the roads fill', () => {
    expect(later.trips.metro / now.trips.metro).toBeGreaterThan(1.2)
  })

  it('takes work nearer home as the roads fill', () => {
    expect(later.workDistance[0]! + later.workDistance[1]!).toBeGreaterThan(now.workDistance[0]! + now.workDistance[1]!)
    expect(ROAD.most).toBeGreaterThan(1)
  })
})
