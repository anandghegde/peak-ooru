import type { Zone } from '../data/types'
import { goodLightTime, goodMovingTime } from './assign'
import { fingerprint } from './bus'
import { toKm, type Net } from './graph'
import { FOOT, HOURS, SAFETY, TRAVEL } from './params'
import { PERIODS, type CityState, type RoutingNetwork } from './types'
import type { ModelZones } from './zones'

/** Road deaths a year at a month's rate: for the city, by zone, and by who was killed. */
export interface Deaths {
  total: number
  byZone: Int32Array
  /** Deaths a year, unrounded: people on foot, two-wheeler riders, and everyone else (in cars, autos, buses, lorries, on cycles). */
  walk: number
  twoWheeler: number
  other: number
}

/** What the month's travel came to, for road deaths. */
export interface Exposure {
  /** Person-km a weekday by two-wheeler, and by car, auto and bus, from the choice of modes. */
  twoWheelerKm: number
  /** Person-km a weekday on foot and by cycle, by model zone. */
  walkKm: Float64Array
  cycleKm: Float64Array
}

/**
 * The chance that a person on foot struck by a vehicle at v km/h dies: v⁴ / (v⁴ + 68⁴) (fitted to Tefft 2011: 10% at
 * 37 km/h, 25% at 51, 50% at 68, 75% at 80, 90% at 93).
 */
function struckAt(v: number): number {
  const v2 = v * v
  const v4 = v2 * v2
  const m2 = SAFETY.walkSpeed * SAFETY.walkSpeed
  return v4 / (v4 + m2 * m2)
}

/**
 * The risk to those riding, per km, as it rises with the speed of traffic: v² / (v² + m²). Nilsson's power model gives
 * deaths as the fourth power of the mean speed on a road when that speed changes; across the hours of the day, where
 * much else changes with the speed, a second power (his figure for injuries) is taken, so that the peaks, slow as they
 * are, keep a share of the deaths.
 */
function ridingAt(v: number, m: number): number {
  const v2 = v * v
  return v2 / (v2 + m * m)
}

/**
 * For each routing link, the game zone it lies in (the nearest centre to its middle), kept for each network and set of
 * zones: by the network object, else by its fingerprint and the zones' centres.
 */
const zonesOf = new WeakMap<RoutingNetwork, { key: string; of: Int32Array }>()
let lastZones: { key: string; of: Int32Array } | null = null

export function linkZones(roads: RoutingNetwork, zones: Zone[]): Int32Array {
  let where = 0
  for (const z of zones) where = (Math.imul(where, 31) + Math.round(z.centre[0] * 1e6) + Math.round(z.centre[1] * 1e6)) | 0
  const byObject = zonesOf.get(roads)
  if (byObject && byObject.key.endsWith(`#${zones.length}/${where}`)) return byObject.of
  const key = `${fingerprint(roads)}#${zones.length}/${where}`
  if (lastZones?.key === key) {
    zonesOf.set(roads, lastZones)
    return lastZones.of
  }
  const Z = zones.length
  const xy = new Float64Array(2 * Z)
  for (let z = 0; z < Z; z++) toKm(zones[z]!.centre[0], zones[z]!.centre[1], xy, 2 * z)
  const a = new Float64Array(2)
  const b = new Float64Array(2)
  const of = new Int32Array(roads.links.length)
  for (const l of roads.links) {
    const p = roads.nodes[l.from]!.at
    const q = roads.nodes[l.to]!.at
    toKm(p[0] / 1e6, p[1] / 1e6, a, 0)
    toKm(q[0] / 1e6, q[1] / 1e6, b, 0)
    const x = (a[0]! + b[0]!) / 2
    const y = (a[1]! + b[1]!) / 2
    let best = 0
    let near = Infinity
    for (let z = 0; z < Z; z++) {
      const dx = xy[2 * z]! - x
      const dy = xy[2 * z + 1]! - y
      const d = dx * dx + dy * dy
      if (d < near) {
        near = d
        best = z
      }
    }
    of[l.id] = best
  }
  lastZones = { key, of }
  zonesOf.set(roads, lastZones)
  return of
}

/**
 * Road deaths a year at the month's rate (PRD SCORE-4, ROAD-4, BLD-6, BLD-7, POL-3). Three parts, each calibrated to
 * the Bengaluru Traffic Police's figures (docs/MODEL.md, "Road deaths"):
 *
 * - **Two-wheeler riders:** the km ridden, spread over the roads as the traffic is, each link's share weighted by the
 *   risk at the speed two-wheelers ride there (they filter through part of a jam), its junction, and its repair.
 * - **Everyone else riding** (cars, autos, buses, lorries): the car units' km on each link, weighted likewise.
 * - **People on foot:** in each zone and part of the day, the square root of the km walked there times the km driven
 *   there weighted by the risk to someone struck at that speed (crashes grow with both, each less than in proportion:
 *   "safety in numbers"); cut by `FOOT.deaths` where the zone has footpaths and crossings. Expressways carry no one on
 *   foot.
 *
 * A jam kills fewer people than free-moving traffic: at the 5 km/h crawl the risk is next to nothing. That is so in
 * life (fatal crashes are at night and on the free fringes, BTP), but it means that a city jammed solid is shown as
 * safer. Speed limits act through the speed; junction work through `SAFETY.junction`; transit by taking two-wheeler
 * km off the roads.
 */
export function roadDeaths(
  state: CityState,
  grouped: ModelZones,
  net: Net,
  pass: Float64Array[],
  exposure: Exposure,
): Deaths {
  const roads = state.roads
  const zones = state.zones
  const Z = zones.length
  const L = net.roadLinks
  const where = linkZones(roads, zones)
  const laid = new Uint8Array(Z)
  for (const id of state.footpaths ?? []) if (id >= 0 && id < Z) laid[id] = 1
  // Junction work at the end of a link (the rules mark the node).
  const junction = new Float64Array(L).fill(1)
  for (const l of roads.links) {
    if (l.id >= L) continue
    const work = (roads.nodes[l.to] as { work?: string } | undefined)?.work
    if (work === 'signal' || work === 'redesign' || work === 'overpass') junction[l.id] = SAFETY.junction[work]
  }
  const filter = 1 - TRAVEL.twoWheelerFilter
  // Walking and cycling by game zone: each group's km shared among its wards by their people.
  const walk = new Float64Array(Z)
  const cycle = new Float64Array(Z)
  zones.forEach((z, k) => {
    const g = grouped.of[k]!
    const people = grouped.zones[g]!.people
    if (people <= 0) return
    walk[k] = (exposure.walkKm[g]! * z.people) / people
    cycle[k] = (exposure.cycleKm[g]! * z.people) / people
  })

  let pcuKmAll = 0
  const twoByZone = new Float64Array(Z)
  const otherByZone = new Float64Array(Z)
  const walkByZone = new Float64Array(Z)
  const struck = new Float64Array(Z)
  for (let p = 0; p < PERIODS.length; p++) {
    const hours = HOURS[PERIODS[p]!]
    const f = pass[p]!
    struck.fill(0)
    for (let l = 0; l < L; l++) {
      const flow = f[l]!
      if (flow <= 0 || net.from[l] === net.to[l]) continue
      const km = net.length[l]! / 1000
      // The speed of traffic as it would be on the road in good repair: a road slowed by potholes is not made safer
      // by them (slice 6). Its surface's danger is the factor below instead.
      const light = goodLightTime(net, l)
      // Time moving, the signals' share of the delay taken out; a two-wheeler loses only part of the delay.
      const moving = (goodMovingTime(net, l, flow) * light) / (light + net.delay[l]!)
      const car = (km * 3600) / moving
      const two = (km * 3600) / (light + filter * (moving - light))
      const c = state.condition?.[l]
      const repair = c !== undefined && c >= 0 && c < 1 ? 1 - c : 0
      // The surface: potholes and broken edges, above all for two-wheelers (PRD ROAD-4), by the share of speed it costs.
      const rough = 1 - net.surfaceSpeed[l]!
      const pcuKm = flow * hours * km
      const z = where[l]!
      let x2 = pcuKm * ridingAt(two, SAFETY.twoWheelerSpeed) * junction[l]! * (1 + SAFETY.repairTwoWheeler * repair)
      let xo = pcuKm * ridingAt(car, SAFETY.otherSpeed) * junction[l]! * (1 + SAFETY.repairOther * repair)
      if (rough > 0) {
        x2 *= 1 + SAFETY.surfaceTwoWheeler * rough
        xo *= 1 + SAFETY.surfaceOther * rough
      }
      pcuKmAll += pcuKm
      twoByZone[z]! += x2
      otherByZone[z]! += xo
      if (roads.links[l]!.kind !== 'motorway') struck[z]! += flow * km * struckAt(car) * junction[l]!
    }
    for (let z = 0; z < Z; z++) {
      if (struck[z] === 0) continue
      const onFoot = ((walk[z]! + SAFETY.cycleAsWalk * cycle[z]!) * SAFETY.walkTiming[p]!) / hours
      const k = hours * Math.sqrt(onFoot * struck[z]!) * (laid[z] ? 1 - FOOT.deaths : 1)
      walkByZone[z]! += k
    }
  }
  // Two-wheeler riders: the km they ride, at the average risk of the km driven. Everyone else: the car units' km.
  const two = pcuKmAll > 0 ? (SAFETY.perTwoWheelerKm * exposure.twoWheelerKm) / pcuKmAll : 0
  const other = SAFETY.perCarUnitKm
  let w = 0, t = 0, o = 0
  const exact = new Float64Array(Z)
  for (let z = 0; z < Z; z++) {
    const a = SAFETY.onFoot * walkByZone[z]!
    const b = two * twoByZone[z]!
    const c = other * otherByZone[z]!
    w += a
    t += b
    o += c
    exact[z] = a + b + c
  }
  const total = Math.round(w + t + o)
  lastDeaths.walk = walkByZone.map((x) => SAFETY.onFoot * x)
  lastDeaths.twoWheeler = twoByZone.map((x) => two * x)
  lastDeaths.other = otherByZone.map((x) => other * x)
  return { total, byZone: apportion(exact, total), walk: w, twoWheeler: t, other: o }
}

/** The last month's deaths a year by zone and part, unrounded: for calibrating and explaining. Not part of any result. */
export const lastDeaths = { walk: new Float64Array(0), twoWheeler: new Float64Array(0), other: new Float64Array(0) }

/** Whole numbers in proportion to `exact` that add up to `total`: the largest remainders, then the lower zone, get the rest. */
function apportion(exact: Float64Array, total: number): Int32Array {
  const n = exact.length
  const out = new Int32Array(n)
  let sum = 0
  for (let z = 0; z < n; z++) {
    out[z] = Math.floor(exact[z]!)
    sum += out[z]!
  }
  const order = Array.from({ length: n }, (_, z) => z).sort((a, b) => exact[b]! - out[b]! - (exact[a]! - out[a]!) || a - b)
  for (let k = 0; k < n && sum < total; k++) {
    out[order[k]!]!++
    sum++
  }
  return out
}
