// What a line does: opens it at once and compares the month with and without it, for the whole city and for the zones
// within reach of its stops.
//   npx vite-node tools/measure-line.ts            every case below, as a table in Markdown
//   npx vite-node tools/measure-line.ts orr-metro  one case, or several, by name
//   npx vite-node tools/measure-line.ts --load     the time a month takes with ten more metro lines and twenty bus routes
//   npx vite-node tools/measure-line.ts --works    a lane lost to works along the Outer Ring Road: delay there and round it
import { readFileSync } from 'node:fs'
import type { LngLat, Station, Transit, TransitLine, Zone } from '../src/data/types'
import { busPath } from '../src/sim/bus'
import { toKm } from '../src/sim/graph'
import { linkKmh, simulate, stages, type MonthDetail } from '../src/sim/index'
import { GROUPING } from '../src/sim/params'
import { defaultVehicles } from '../src/sim/transit'
import { MODES, type CityState, type RoutingNetwork } from '../src/sim/types'
import { loaded } from './measure-city'

const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../public/data/${file}`, import.meta.url), 'utf8')) as T

/** The city as it stands in January 2026, from the data files. */
function loadCity(): CityState {
  return { month: 0, seed: 1, zones: read<Zone[]>('zones.json'), roads: read<RoutingNetwork>('routing.json'), transit: read<Transit>('transit.json') }
}

/**
 * A line to try: its stops (a station that is there, by id, or a place), and what goes with it; or a line of the
 * season's data opened (`open`).
 */
interface Case {
  name: string
  what: string
  kind: 'metro' | 'bus'
  stops: (number | LngLat)[]
  /** Buses or trains on it; the default if left out. None: only its bus lanes are laid. */
  vehicles?: number
  /** Bus lanes, both ways, on every link of the route with two lanes or more in its direction. */
  lanes?: boolean
  open?: string
  /** Bus lanes on this many of the emptiest links of two lanes or more at the morning peak, and nothing else. */
  quiet?: number
  /** More trains on a line that is there: this many times its usual number. */
  trains?: { line: string; times: number }
}

const at = (lat: number, lng: number): LngLat => [lng, lat]
// The Blue Line's course along the Outer Ring Road, Silk Board to KR Puram, as the season's data has it.
const orr = [79, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111]
const orrPlaces: LngLat[] = [
  at(12.9166, 77.6206), at(12.9165, 77.6331), at(12.9207, 77.6437), at(12.921, 77.6631), at(12.9278, 77.6804),
  at(12.9322, 77.6876), at(12.9452, 77.6981), at(12.958, 77.7013), at(12.969, 77.7011), at(12.9756, 77.697),
  at(12.9859, 77.6908), at(12.9937, 77.6855), at(13.0001, 77.6774),
]
const cases: Case[] = [
  { name: 'orr-metro', what: 'Metro, Outer Ring Road, Silk Board to KR Puram (the Blue Line\'s course)', kind: 'metro', stops: orr },
  {
    name: 'sarjapur-metro',
    what: 'Metro, MG Road to Sarjapura by Koramangala and Sarjapur Road',
    kind: 'metro',
    stops: [
      18, at(12.964, 77.616), at(12.953, 77.623), at(12.942, 77.625), at(12.933, 77.631), at(12.925, 77.64),
      at(12.921, 77.6631), at(12.913, 77.674), at(12.909, 77.688), at(12.905, 77.705), at(12.896, 77.725),
      at(12.883, 77.749), at(12.87, 77.768), at(12.858, 77.787),
    ],
  },
  {
    name: 'empty-metro',
    what: 'Metro through empty country, north-west of the city',
    kind: 'metro',
    stops: [at(13.13, 77.4), at(13.14, 77.42), at(13.15, 77.44), at(13.16, 77.46), at(13.17, 77.48), at(13.18, 77.5)],
  },
  { name: 'blue', what: 'The Blue Line, Silk Board to the airport, as the season will open it', kind: 'metro', stops: [], open: 'blue' },
  { name: 'pink', what: 'The Pink Line, Kalena Agrahara to Nagawara, as the season will open it', kind: 'metro', stops: [], open: 'pink' },
  {
    name: 'rail-trains',
    what: 'Three times the trains on the suburban line from the city station to Devangonthi',
    kind: 'metro',
    stops: [],
    trains: { line: 'rail-krantivira-sangolli-rayanna-bengaluru-devangonthi', times: 3 },
  },
  { name: 'orr-bus', what: 'Bus route, Outer Ring Road, Silk Board to KR Puram, 40 buses', kind: 'bus', stops: orrPlaces, vehicles: 40 },
  { name: 'orr-lanes', what: 'Bus lanes both ways along that route, and no route', kind: 'bus', stops: orrPlaces, vehicles: 0, lanes: true },
  { name: 'orr-bus-lanes', what: 'The route, 40 buses, in those bus lanes', kind: 'bus', stops: orrPlaces, vehicles: 40, lanes: true },
  { name: 'orr-bus-lanes-100', what: 'The route, 100 buses, in those bus lanes', kind: 'bus', stops: orrPlaces, vehicles: 100, lanes: true },
  { name: 'empty-lanes', what: 'Bus lanes on the 40 emptiest main-road links of two lanes or more', kind: 'bus', stops: [], quiet: 40 },
  {
    name: 'feeder-bus',
    what: 'Feeder bus, Varthur to the Purple Line at Kundalahalli, 12 buses',
    kind: 'bus',
    stops: [at(12.939, 77.747), at(12.948, 77.742), at(12.957, 77.736), at(12.966, 77.728), at(12.9776, 77.7156)],
    vehicles: 12,
  },
]

/** The city with the case's line open, and its bus lanes. */
export function withLine(state: CityState, c: Case, today?: MonthDetail): { state: CityState; line: TransitLine } {
  if (c.quiet && today) {
    const quiet = state.roads.links
      .filter((l) => l.lanes >= 2 && l.kind !== 'motorway')
      .sort((a, b) => today.flow.morning[a.id]! - today.flow.morning[b.id]! || a.id - b.id)
      .slice(0, c.quiet)
      .map((l) => l.id)
    return { state: { ...state, busLanes: quiet }, line: { id: c.name, name: c.what, kind: 'bus', colour: '', status: 'open', stations: [], path: [] } }
  }
  if (c.trains) {
    const usual = defaultVehicles(state.transit, c.trains.line)
    const line = state.transit.lines.find((l) => l.id === c.trains!.line)!
    return { state: { ...state, vehicles: { [line.id]: usual * c.trains.times } }, line }
  }
  if (c.open) {
    const lines = state.transit.lines.map((l) => (l.id === c.open ? { ...l, status: 'open' as const } : l))
    return { state: { ...state, transit: { ...state.transit, lines } }, line: lines.find((l) => l.id === c.open)! }
  }
  const stations: Station[] = [...state.transit.stations]
  let next = stations.reduce((m, s) => Math.max(m, s.id), -1) + 1
  const ids = c.stops.map((s) => {
    if (typeof s === 'number') return s
    stations.push({ id: next, name: `${c.name} ${next}`, nameKn: null, at: s, kind: c.kind })
    return next++
  })
  const byId = new Map(stations.map((s) => [s.id, s]))
  const line: TransitLine = {
    id: c.name,
    name: c.what,
    kind: c.kind,
    colour: '#888888',
    status: 'open',
    stations: ids,
    path: ids.flatMap((id) => byId.get(id)!.at),
  }
  const transit: Transit = { stations, lines: [...state.transit.lines, line] }
  const out: CityState = { ...state, transit }
  if (c.vehicles !== undefined) out.vehicles = { ...state.vehicles, [c.name]: c.vehicles }
  if (c.lanes) {
    const back = { ...line, stations: [...ids].reverse() }
    const lanes = [...busPath(state.roads, line, stations), ...busPath(state.roads, back, stations)]
    out.busLanes = [...(state.busLanes ?? []), ...lanes.filter((l) => state.roads.links[l]!.lanes >= 2)]
  }
  return { state: out, line }
}

/** Game zones whose centre lies within `km` of a stop of the line, straight. */
function zonesNear(state: CityState, line: TransitLine, km: number): number[] {
  const byId = new Map(state.transit.stations.map((s) => [s.id, s]))
  const a = new Float64Array(2)
  const b = new Float64Array(2)
  return state.zones
    .filter((z) => {
      toKm(z.centre[0], z.centre[1], a, 0)
      return line.stations.some((id) => {
        const s = byId.get(id)!
        toKm(s.at[0], s.at[1], b, 0)
        return (a[0]! - b[0]!) ** 2 + (a[1]! - b[1]!) ** 2 <= km * km
      })
    })
    .map((z) => z.id)
}

/** The commute and access of some zones, weighted by their people: minutes and share of jobs. */
function zonesFigures(state: CityState, r: MonthDetail, ids: number[]) {
  let p = 0, c = 0, a = 0
  for (const id of ids) {
    const n = state.zones[id]!.people
    p += n
    c += n * r.commuteByZone[id]!
    a += n * r.accessByZone[id]!
  }
  return { commute: c / p / 60, access: a / p / 10, people: p }
}

/** Average speed at the peaks on main roads within 600 m of the line's stops: km/h, vehicle-km over vehicle-hours. */
function corridorSpeed(state: CityState, line: TransitLine, r: MonthDetail): number {
  const byId = new Map(state.transit.stations.map((s) => [s.id, s]))
  const stops = line.stations.map((id) => {
    const xy = new Float64Array(2)
    toKm(byId.get(id)!.at[0], byId.get(id)!.at[1], xy, 0)
    return xy
  })
  const p = new Float64Array(2)
  let km = 0, h = 0
  for (const l of state.roads.links) {
    if (l.kind === 'tertiary' || l.kind === 'secondary') continue
    const n = state.roads.nodes[l.from]!.at
    toKm(n[0] / 1e6, n[1] / 1e6, p, 0)
    if (!stops.some((s) => (s[0]! - p[0]!) ** 2 + (s[1]! - p[1]!) ** 2 < 0.36)) continue
    for (const period of ['morning', 'evening'] as const) {
      const f = r.flow[period][l.id]!
      const k = (f * l.length) / 1000
      km += k
      h += k / linkKmh(state.roads, r, period, l)
    }
  }
  return km / h
}

function load() {
  const base = loadCity()
  const state = loaded(base)
  for (const [name, s] of [['As it is', base], ['With ten more metro lines and twenty bus routes', state]] as const) {
    const times: number[] = []
    let r = simulate(s)
    for (const k of Object.keys(stages)) delete stages[k]
    for (let k = 0; k < 6; k++) {
      r = simulate(s)
      times.push(r.took)
    }
    times.sort((a, b) => a - b)
    const riders = Object.entries(r.riders).filter(([id]) => /^(metro|bus)-/.test(id)).reduce((a, [, v]) => a + v, 0)
    console.log(`${name}: least ${times[0]!.toFixed(0)} ms, median ${times[3]!.toFixed(0)}; commute ${(r.commute / 60).toFixed(1)} min; riders on the new lines ${(riders / 1000).toFixed(0)} k`)
    console.log('  stages, per run: ' + Object.entries(stages).map(([k, v]) => `${k} ${(v / 6).toFixed(0)}`).join(', '))
  }
}

/**
 * Works on the Outer Ring Road from Silk Board to KR Puram, a lane lost both ways: the speed at the peaks on those links,
 * on the other main roads within 3 km (the ways round), and the commute.
 */
function works() {
  const base = loadCity()
  const line: TransitLine = { id: 'w', name: 'w', kind: 'bus', colour: '', status: 'open', stations: orr, path: [] }
  const back = { ...line, stations: [...orr].reverse() }
  const links = [...busPath(base.roads, line, base.transit.stations), ...busPath(base.roads, back, base.transit.stations)]
  const on = new Set(links)
  const xy = new Float64Array(2)
  const pts = links.map((l) => {
    const n = base.roads.nodes[base.roads.links[l]!.from]!.at
    const p = new Float64Array(2)
    toKm(n[0] / 1e6, n[1] / 1e6, p, 0)
    return p
  })
  const round = base.roads.links.filter((l) => {
    if (on.has(l.id) || l.kind === 'secondary' || l.kind === 'tertiary') return false
    const n = base.roads.nodes[l.from]!.at
    toKm(n[0] / 1e6, n[1] / 1e6, xy, 0)
    return pts.some((p) => (p[0]! - xy[0]!) ** 2 + (p[1]! - xy[1]!) ** 2 < 9)
  })
  const speed = (r: MonthDetail, list: number[]) => {
    let km = 0, h = 0
    for (const id of list) {
      const l = base.roads.links[id]!
      for (const period of ['morning', 'evening'] as const) {
        const k = (r.flow[period][id]! * l.length) / 1000
        km += k
        h += k / linkKmh(base.roads, r, period, l)
      }
    }
    return `${(km / h).toFixed(1)} km/h, ${(km / 1000).toFixed(0)} k vehicle-km an hour`
  }
  const r0 = simulate(base)
  const cases: [string, number[]][] = [['a lane lost both ways', links], ['two lanes lost both ways', [...links, ...links]]]
  for (const [name, w] of cases) {
    const r = simulate({ ...base, works: w })
    console.log(`Works on the Outer Ring Road, ${links.length} links, ${name}:`)
    console.log(`  on the links:   ${speed(r0, links)} → ${speed(r, links)}`)
    console.log(`  the ways round: ${speed(r0, round.map((l) => l.id))} → ${speed(r, round.map((l) => l.id))} (${round.length} main-road links within 3 km)`)
    console.log(`  commute ${(r0.commute / 60).toFixed(2)} → ${(r.commute / 60).toFixed(2)} min; lost to traffic ${(r0.commuteDelay / 60).toFixed(2)} → ${(r.commuteDelay / 60).toFixed(2)}`)
  }
}

function main() {
  if (process.argv.includes('--load')) return load()
  if (process.argv.includes('--works')) return works()
  const share = process.argv.find((a) => a.startsWith('--share='))
  if (share) GROUPING.share = Number(share.slice(8))
  const base = loadCity()
  const want = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  const r0 = simulate(base)
  console.log(`As it is: commute ${(r0.commute / 60).toFixed(2)} min, access ${(r0.access / 10).toFixed(1)}%, ${r0.took.toFixed(0)} ms`)
  console.log(
    '| Line | City commute, min | Zones within 1 km: commute, min | within 2 km | Access, city / 2 km, points | Riders a weekday (k), headway, fullest | ' +
      'Trips by mode (k): car, 2-wh., auto, bus, metro | Fares on it, lakh ₹ a weekday | Corridor speed at the peaks, km/h | ms |',
  )
  console.log('|' + ' --- |'.repeat(10))
  for (const c of cases) {
    if (want.length && !want.includes(c.name)) continue
    const { state, line } = withLine(base, c, r0)
    const before = r0
    const r = simulate(state)
    const near1 = zonesNear(state, line, 1)
    const near2 = zonesNear(state, line, 2)
    const z1 = [zonesFigures(state, before, near1), zonesFigures(state, r, near1)]
    const z2 = [zonesFigures(state, before, near2), zonesFigures(state, r, near2)]
    const pct = (a: number, b: number) => `${(((b - a) / a) * 100).toFixed(1)}%`
    const d = (m: (typeof MODES)[number]) => ((r.trips[m] - before.trips[m]) / 1000).toFixed(0)
    const fare = r.lineFare[line.id] ?? 0
    console.log(
      `| ${c.what} | ${(before.commute / 60).toFixed(2)} → ${(r.commute / 60).toFixed(2)} (${pct(before.commute, r.commute)}) | ` +
        `${z1[0]!.commute.toFixed(1)} → ${z1[1]!.commute.toFixed(1)} (${pct(z1[0]!.commute, z1[1]!.commute)}; ${near1.length} zones, ${(z1[0]!.people / 1e6).toFixed(2)} M people) | ` +
        `${z2[0]!.commute.toFixed(1)} → ${z2[1]!.commute.toFixed(1)} (${pct(z2[0]!.commute, z2[1]!.commute)}; ${near2.length}, ${(z2[0]!.people / 1e6).toFixed(2)} M) | ` +
        `${((r.access - before.access) / 10).toFixed(2)} / ${(z2[1]!.access - z2[0]!.access).toFixed(2)} | ` +
        `${((r.riders[line.id] ?? 0) / 1000).toFixed(0)} (every ${r.headway[line.id] ?? '-'} min, ${((r.crowding[line.id] ?? 0) / 10).toFixed(0)}% full) | ${['car', 'twoWheeler', 'auto', 'bus', 'metro'].map((m) => d(m as never)).join(', ')} | ` +
        `${(fare / 1e5).toFixed(2)} | ${corridorSpeed(state, line, before).toFixed(1)} → ${corridorSpeed(state, line, r).toFixed(1)} | ${r.took.toFixed(0)} |`,
    )
  }
}

main()
