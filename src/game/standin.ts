import type { Network, RoadClass, Transit, Zone } from '../data/types'
import { MODES, PERIODS, type CityState, type Mode, type MonthResult, type Period, type RoutingNetwork } from '../sim/types'

/*
 * Stand-ins for what the others are building, so that the screen can be built and measured before their work
 * lands: a routing network that treats every drawn stretch as its own link, and a month of made-up traffic that is
 * slow where Bengaluru is slow. Neither is a model of anything. The worker uses them only while the real ones are
 * missing.
 */

/** Vehicles an hour a lane can carry, by class: rough figures, for the stand-in only. */
const LANE_CAPACITY: Record<RoadClass, number> = {
  motorway: 1800,
  trunk: 1500,
  primary: 1200,
  secondary: 900,
  tertiary: 600,
}

/** A routing network with one link for each drawn stretch and direction of travel. */
export function standInRouting(network: Network, zones: Zone[]): RoutingNetwork {
  const links: RoutingNetwork['links'] = []
  for (const l of network.links) {
    const base = { length: Math.round(l.length), kind: l.kind, lanes: l.lanes, speed: Math.round(l.speed) }
    const capacity = l.lanes * LANE_CAPACITY[l.kind]
    links.push({ ...base, id: links.length, from: l.a, to: l.b, capacity, drawn: [l.id], forward: [true] })
    if (!l.oneway) links.push({ ...base, id: links.length, from: l.b, to: l.a, capacity, drawn: [l.id], forward: [false] })
  }
  return {
    nodes: network.nodes.map((n) => ({
      id: n.id,
      at: [Math.round(n.at[0] * 1e6), Math.round(n.at[1] * 1e6)],
      gateway: !!n.gateway,
      signal: !!n.signal,
    })),
    links,
    zoneNode: zones.map((z) => z.node),
  }
}

/** Where the city's worst jams are, with how far each reaches (km) and how bad it is. */
const JAMS: { at: [number, number]; km: number; strength: number }[] = [
  { at: [77.623, 12.917], km: 2.2, strength: 1.1 }, // Silk Board
  { at: [77.699, 12.956], km: 2.0, strength: 0.9 }, // Marathahalli, Outer Ring Road
  { at: [77.678, 12.926], km: 2.0, strength: 0.9 }, // Bellandur, Outer Ring Road
  { at: [77.592, 13.04], km: 1.8, strength: 1.0 }, // Hebbal
  { at: [77.696, 13.006], km: 1.8, strength: 0.9 }, // KR Puram
  { at: [77.67, 12.996], km: 1.5, strength: 0.8 }, // Tin Factory
  { at: [77.54, 12.953], km: 2.5, strength: 0.7 }, // Mysore Road
  { at: [77.645, 12.89], km: 3.0, strength: 0.7 }, // Hosur Road
  { at: [77.6, 12.89], km: 2.5, strength: 0.7 }, // Bannerghatta Road
  { at: [77.575, 12.975], km: 2.0, strength: 0.6 }, // Majestic
]
const CENTRE: [number, number] = [77.595, 12.972]
const LOAD: Record<Period, number> = { morning: 0.85, midday: 0.5, evening: 1, night: 0.12 }

/** Kilometres between two points, near enough at Bengaluru's latitude. */
function km(a: [number, number], b: [number, number]): number {
  return Math.hypot((a[0] - b[0]) * 108.5, (a[1] - b[1]) * 110.6)
}

/** A month of made-up traffic in the agreed shape: slow near the centre and at the known jams at the peaks. */
export function standInSimulate(state: CityState): MonthResult {
  const started = performance.now()
  const { roads, zones, transit } = state
  const flow = {} as Record<Period, Int32Array>
  const speed = {} as Record<Period, Int16Array>
  const pressure = roads.links.map((l) => {
    const a = roads.nodes[l.from]!.at
    const b = roads.nodes[l.to]!.at
    const mid: [number, number] = [(a[0] + b[0]) / 2e6, (a[1] + b[1]) / 2e6]
    let p = Math.max(0, 0.55 - km(mid, CENTRE) / 30)
    for (const j of JAMS) p += j.strength * Math.max(0, 1 - km(mid, j.at) / j.km)
    // Big roads fill up; the small ones are quieter.
    const weight = { motorway: 0.9, trunk: 1, primary: 1, secondary: 0.8, tertiary: 0.6 }[l.kind]
    return (0.35 + p) * weight
  })
  for (const period of PERIODS) {
    flow[period] = new Int32Array(roads.links.length)
    speed[period] = new Int16Array(roads.links.length)
    roads.links.forEach((l, i) => {
      const ratio = pressure[i]! * LOAD[period]
      flow[period][i] = Math.round(Math.min(ratio, 1.1) * l.capacity)
      speed[period][i] = Math.round(1000 / (1 + 0.8 * ratio ** 4))
    })
  }
  const commuteByZone = new Int32Array(zones.length)
  const accessByZone = new Int16Array(zones.length)
  let people = 0
  let commute = 0
  let access = 0
  zones.forEach((z, i) => {
    const d = km(z.centre, [77.63, 12.95])
    commuteByZone[i] = Math.round((30 + d * 1.4) * 60)
    accessByZone[i] = Math.round(Math.max(40, 700 - d * 32))
    people += z.people
    commute += z.people * commuteByZone[i]!
    access += z.people * accessByZone[i]!
  })
  const trips = Object.fromEntries(MODES.map((m) => [m, 0])) as Record<Mode, number>
  Object.assign(trips, {
    car: 2_100_000, twoWheeler: 5_600_000, auto: 1_500_000, bus: 4_100_000,
    metro: 850_000, rail: 40_000, cycle: 350_000, walk: 3_600_000,
  })
  return {
    month: state.month,
    flow,
    speed,
    commute: Math.round(commute / Math.max(1, people)),
    commuteByZone,
    trips,
    access: Math.round(access / Math.max(1, people)),
    accessByZone,
    riders: ridersByLine(transit),
    took: Math.round(performance.now() - started),
  }
}

function ridersByLine(transit: Transit): Record<string, number> {
  const riders: Record<string, number> = {}
  for (const line of transit.lines) {
    if (line.status !== 'open') continue
    riders[line.id] = line.kind === 'metro' ? line.stations.length * 9_000 : line.stations.length * 800
  }
  return riders
}
