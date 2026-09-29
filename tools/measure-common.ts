// Helpers the slice 7 measures share (B): January 2026 as the first season starts it, stretches of named roads, and
// what a stretch carries.
import { readFileSync } from 'node:fs'
import type { Transit, Zone } from '../src/data/types'
import { rules } from '../src/rules/index'
import { firstSeason } from '../src/seasons/first'
import { toKm } from '../src/sim/graph'
import { linkKmh } from '../src/sim/index'
import type { CityState, MonthResult, Period, RoutingNetwork } from '../src/sim/types'

const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../public/data/${file}`, import.meta.url), 'utf8')) as T

/** January 2026, its roads and streets as the first season starts them. */
export function january(): CityState {
  const city = { zones: read<Zone[]>('zones.json'), roads: read<RoutingNetwork>('routing.json'), transit: read<Transit>('transit.json') }
  const s = rules.state(rules.start(firstSeason, city), city)
  return { month: 0, seed: 1, ...city, surface: s.surface, streets: s.streets }
}

/** Links of a named road whose middle is within `m` metres of a place, both ways. */
export function stretch(state: CityState, name: RegExp, lat: number, lng: number, m: number): number[] {
  const names = new Map(read<{ links: { id: number; name?: string }[] }>('network.json').links.map((l) => [l.id, l.name ?? '']))
  const p = new Float64Array(2)
  const q = new Float64Array(2)
  toKm(lng, lat, p, 0)
  return state.roads.links
    .filter((l) => {
      if (l.from === l.to || !l.drawn.some((d) => name.test(names.get(d) ?? ''))) return false
      const a = state.roads.nodes[l.from]!.at
      const b = state.roads.nodes[l.to]!.at
      toKm((a[0] + b[0]) / 2e6, (a[1] + b[1]) / 2e6, q, 0)
      return Math.hypot(q[0]! - p[0]!, q[1]! - p[1]!) * 1000 < m
    })
    .map((l) => l.id)
}

/** The stretch at a period: km/h as the screen's forecast reads it (by length), vehicles an hour, minutes a vehicle. */
export function along(state: CityState, r: MonthResult, ids: number[], period: Period = 'evening') {
  let metres = 0, hours = 0, veh = 0, vehMin = 0, vkm = 0, vh = 0
  for (const id of ids) {
    const l = state.roads.links[id]!
    const kmh = Math.max(1, linkKmh(state.roads, r, period, l))
    const f = r.flow[period][id]!
    metres += l.length
    hours += l.length / kmh
    veh += f
    vehMin += (f * (l.length / 1000 / kmh)) * 60
    vkm += (f * l.length) / 1000
    vh += (f * l.length) / 1000 / kmh
  }
  const km = metres / 1000
  // Minutes to travel the whole stretch one way (half its length, the links being both ways) at each link's speed.
  return { kmh: metres / hours, perVehicleKmh: vh > 0 ? vkm / vh : 0, vehicles: veh / ids.length, minutes: ((hours / 1000) * 60) / 2, km: km / 2, vehMin }
}

/** Links whose flow at a period moved by more than `share` and 50 vehicles an hour, of those carrying any. */
export function moved(a: MonthResult, b: MonthResult, period: Period, share = 0.05): number {
  let n = 0
  const fa = a.flow[period], fb = b.flow[period]
  for (let l = 0; l < fa.length; l++) {
    const d = Math.abs(fa[l]! - fb[l]!)
    if (d > 50 && d > share * Math.max(fa[l]!, fb[l]!)) n++
  }
  return n
}

