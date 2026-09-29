import type { Station, Transit, TransitLine, Zone } from '../data/types'
import { indexLinks, toKm, Tree, type Graph } from './graph'
import { expNeg } from './fixed'
import { BUS, DEMAND, FOOT, SURFACE, TRANSIT, TRAVEL } from './params'

export type System = 'metro' | 'rail' | 'bus'

/** Minutes between the city's buses on a corridor, as the wait the city's bus service is given in the wards. */
const CITY_BUS_HEADWAY = 2 * BUS.wait

/**
 * For each bus route, by line id: the minutes and km riding from each stop to the next along the roads (one fewer
 * than its stops), in the month's traffic.
 */
export type Rides = Map<string, { minutes: number[]; km: number[] }>

/** Km a line runs from end to end, stop to stop in straight lines, with a little for curves. */
function straightKm(line: TransitLine, stations: Map<number, Station>): number {
  const a = new Float64Array(4)
  let km = 0
  let prev: Station | undefined
  for (const id of line.stations) {
    const s = stations.get(id)
    if (!s) continue
    if (prev) {
      toKm(prev.at[0], prev.at[1], a, 0)
      toKm(s.at[0], s.at[1], a, 2)
      const dx = a[2]! - a[0]!
      const dy = a[3]! - a[1]!
      km += Math.sqrt(dx * dx + dy * dy) * 1.1
    }
    prev = s
  }
  return km
}

/**
 * The trains or buses a line runs by default: enough for its published headway (or the system's) over a round trip
 * with a turn at each end. For a bus route, at `BUS.routeHeadway` and `BUS.routeSpeed`. Whole, at least one.
 */
export function defaultVehicles(transit: Transit, lineId: string): number {
  const line = transit.lines.find((l) => l.id === lineId)
  if (!line) return 0
  const stations = new Map(transit.stations.map((s) => [s.id, s]))
  const system = line.kind
  const run = (straightKm(line, stations) / (system === 'bus' ? BUS.routeSpeed : TRANSIT.speed[system])) * 60
  const headway = system === 'bus' ? BUS.routeHeadway : TRANSIT.lineHeadway[line.id] ?? TRANSIT.headway[system]
  return Math.max(1, Math.round((2 * run + 2 * TRANSIT.turn[system]) / headway))
}

/**
 * Minutes between trains or buses at the peak, from the vehicles on the line (`vehicles`, if the city gives them) and
 * the minutes it takes end to end (`run`). A metro or rail line with its default vehicles runs at its published
 * headway, and more or fewer vehicles shorten or lengthen it in proportion; a bus route runs as often as its buses
 * can over a round trip. Never closer than the system allows. Infinity if the line has no vehicles.
 */
function headwayOf(transit: Transit, line: TransitLine, run: number, vehicles: number | undefined): number {
  const system = line.kind
  const least = TRANSIT.leastHeadway[system]
  if (vehicles !== undefined && !(vehicles > 0)) return Infinity
  let headway: number
  if (system === 'bus') {
    headway = vehicles === undefined ? BUS.routeHeadway : (2 * run + 2 * TRANSIT.turn.bus) / vehicles
  } else {
    headway = TRANSIT.lineHeadway[line.id] ?? TRANSIT.headway[system]
    if (vehicles !== undefined) headway = (headway * defaultVehicles(transit, line.id)) / vehicles
  }
  return headway > least ? headway : least
}

/**
 * The lines of a system in service: open, with vehicles if the city gives a number, and two stations or more that
 * exist. Stations that do not exist are passed over, and a station listed twice running is one stop.
 */
export function serviceLines(transit: Transit, system: System, vehicles?: Record<string, number>): TransitLine[] {
  const known = new Set(transit.stations.map((s) => s.id))
  const lines: TransitLine[] = []
  const seen = new Set<string>()
  for (const l of transit.lines) {
    if (l.kind !== system || l.status !== 'open' || seen.has(l.id)) continue
    const v = vehicles?.[l.id]
    if (v !== undefined && !(v > 0)) continue
    const real = l.stations.filter((id) => known.has(id))
    const ids = real.filter((id, k) => id !== real[k - 1])
    if (ids.length < 2) continue
    seen.add(l.id)
    lines.push(ids.length === l.stations.length ? l : { ...l, stations: ids })
  }
  return lines
}

/**
 * One transit system (metro, suburban rail, or the player's bus routes) worked out between every pair of its
 * stations, and each zone's ways to reach its stations. Stations of an interchange are one place.
 */
export interface TransitSkim {
  system: System
  /** Places: a station, or the stations of one interchange. */
  places: number
  /** Between places a (row) and b: weighted minutes, actual minutes, and km riding. Infinity if not joined. */
  cost: Float64Array
  time: Float64Array
  km: Float64Array
  /** Line ids in service, and minutes between their vehicles at the peak; for each link of the graph the line boarded on it, or -1. */
  lines: string[]
  headway: Float64Array
  /** For each line, the share of those riding its course who board its own vehicles: 1 but for a bus route (see buildSkim). */
  own: Float64Array
  boardLine: Int32Array
  /** The graph and, for each place as a start, the link each node was reached by: for counting riders by line. */
  graph: Graph
  pred: Int32Array
  /** For each place as a start, the nodes in the order its tree reached them, and how many it reached. */
  order: Int32Array
  reached: Int32Array
  /**
   * For each link of the graph: its weighted seconds when trains are not crowded; for a ride between stations, its
   * minutes and the riders an hour its trains can carry (trains an hour × a train's crush load; Infinity for the other
   * links); and the extra weight crowding puts on each minute of riding it.
   */
  linkCost: Float64Array
  rideMinutes: Float64Array
  capacity: Float64Array
  crowd: Float64Array
  linkTime: Float64Array
  linkKm: Float64Array
  /** For each ride between stations, its line; -1 for the other links. */
  rideLine: Int32Array
  /**
   * For each zone, up to `TRANSIT.choices` places to board (-1 if fewer): the nearest on each line, cheapest first; and
   * for each the weighted minutes, actual minutes and rupees to reach it.
   */
  access: Int32Array
  accessCost: Float64Array
  /** The same weighted minutes without the rupees. */
  accessFelt: Float64Array
  /** Each place, in km east and north (see graph.ts, toKm). */
  xy: Float64Array
  accessTime: Float64Array
  accessMoney: Float64Array
}

/**
 * Builds the skim of one system from the lines in service: those open, with two stations or more that exist, and
 * vehicles if the city gives any. Bus routes ride the roads (`rides`); the rest run straight at their system's speed.
 */
export function buildSkim(
  transit: Transit,
  zones: Zone[],
  system: System,
  vehicles?: Record<string, number>,
  rides?: Rides,
  feeders?: Feeder[],
  foot?: Float64Array,
  streets?: Float64Array,
): TransitSkim {
  const stationById = new Map(transit.stations.map((s) => [s.id, s]))
  const lines = serviceLines(transit, system, vehicles).filter((l) => system !== 'bus' || rides?.has(l.id))
  // Places: an interchange, or a single station, used by a line in service.
  const placeOf = new Map<number, number>()
  const placeAt: number[] = []
  const keyOf = (id: number) => {
    const s = stationById.get(id)!
    return s.interchange !== undefined ? -1 - s.interchange : id
  }
  const placeByKey = new Map<number, number>()
  for (const line of lines) {
    for (const id of line.stations) {
      const key = keyOf(id)
      let p = placeByKey.get(key)
      if (p === undefined) {
        p = placeAt.length / 2
        placeByKey.set(key, p)
        const s = stationById.get(id)!
        placeAt.push(s.at[0], s.at[1])
      }
      placeOf.set(id, p)
    }
  }
  const places = placeAt.length / 2
  const xy = new Float64Array(places * 2)
  for (let p = 0; p < places; p++) toKm(placeAt[2 * p]!, placeAt[2 * p + 1]!, xy, 2 * p)

  // The graph: places, then one node per line and station. Links: board, alight, and ride each way.
  const from: number[] = []
  const to: number[] = []
  const cost: number[] = []
  const time: number[] = []
  const km: number[] = []
  const board: number[] = []
  const add = (a: number, b: number, c: number, t: number, k: number, line: number) => {
    from.push(a), to.push(b), cost.push(c), time.push(t), km.push(k), board.push(line)
  }
  let nodes = places
  const speed = system === 'bus' ? BUS.routeSpeed : TRANSIT.speed[system]
  const ride = TRAVEL.rideWeight[system]
  const rideMinutes: number[] = []
  const capacity: number[] = []
  const rideLine: number[] = []
  const headways: number[] = []
  const shares: number[] = []
  lines.forEach((line, li) => {
    // Minutes and km from each station to the next: along the roads for a bus, else straight with a little for curves.
    const along = rides?.get(line.id)
    const minutes: number[] = []
    const km: number[] = []
    let run = 0
    for (let k = 1; k < line.stations.length; k++) {
      const p = placeOf.get(line.stations[k]!)!
      const q = placeOf.get(line.stations[k - 1]!)!
      const dx = xy[2 * p]! - xy[2 * q]!
      const dy = xy[2 * p + 1]! - xy[2 * q + 1]!
      const d = along ? along.km[k - 1]! : Math.sqrt(dx * dx + dy * dy) * 1.1
      const t = along ? along.minutes[k - 1]! : (d / speed) * 60
      minutes.push(t)
      km.push(d)
      run += t
    }
    const headway = headwayOf(transit, line, run, vehicles?.[line.id])
    headways.push(headway)
    let carries = (60 / headway) * (TRANSIT.lineTrain[line.id] ?? TRANSIT.train[system])
    let wait = Math.min(headway / 2, TRANSIT.mostWait[system])
    // A bus route runs where the city's buses run too, and riders take whichever comes first that goes their way: the
    // wait is on both together, the city's buses carry their share, and the route's buses the rest.
    const own = system === 'bus' ? CITY_BUS_HEADWAY / (CITY_BUS_HEADWAY + headway) : 1
    shares.push(own)
    if (system === 'bus') {
      const both = (headway * CITY_BUS_HEADWAY) / (headway + CITY_BUS_HEADWAY)
      wait = Math.min(both / 2, TRANSIT.mostWait.bus)
      carries = carries / own
    }
    const first = nodes
    line.stations.forEach((id, k) => {
      const p = placeOf.get(id)!
      const n = first + k
      add(p, n, TRAVEL.waitWeight * wait, wait, 0, li)
      add(n, p, TRAVEL.walkWeight * TRANSIT.change, TRANSIT.change, 0, -1)
      if (k > 0) {
        const d = km[k - 1]!
        const t = minutes[k - 1]!
        add(n - 1, n, ride * t, t, d, -1)
        add(n, n - 1, ride * t, t, d, -1)
        rideMinutes[from.length - 2] = rideMinutes[from.length - 1] = t
        capacity[from.length - 2] = capacity[from.length - 1] = carries
        rideLine[from.length - 2] = rideLine[from.length - 1] = li
      }
    })
    nodes += line.stations.length
  })
  const m = from.length
  const graph: Graph = {
    nodes,
    from: Int32Array.from(from),
    to: Int32Array.from(to),
    outStart: new Int32Array(nodes + 1),
    outLink: new Int32Array(m),
  }
  indexLinks(graph)
  const skim: TransitSkim = {
    system,
    places,
    cost: new Float64Array(places * places),
    time: new Float64Array(places * places),
    km: new Float64Array(places * places),
    lines: lines.map((l) => l.id),
    headway: Float64Array.from(headways),
    own: Float64Array.from(shares),
    boardLine: Int32Array.from(board),
    graph,
    pred: new Int32Array(places * nodes),
    order: new Int32Array(places * nodes),
    reached: new Int32Array(places),
    // In seconds for the tree, which finds paths on whole units.
    linkCost: Float64Array.from(cost, (c) => c * 60),
    rideMinutes: Float64Array.from({ length: m }, (_, l) => rideMinutes[l] ?? 0),
    capacity: Float64Array.from({ length: m }, (_, l) => capacity[l] ?? Infinity),
    crowd: new Float64Array(m),
    linkTime: Float64Array.from(time),
    linkKm: Float64Array.from(km),
    rideLine: Int32Array.from({ length: m }, (_, l) => rideLine[l] ?? -1),
    xy,
    ...zoneAccess(zones, xy, places, lines.map((l) => l.stations.map((id) => placeOf.get(id)!)), system !== 'bus', feeders, placeOf, foot, streets),
  }
  solveSkim(skim)
  return skim
}

/** A way from a zone to a station by one of the player's bus routes: its cost (felt minutes and rupees), felt minutes, minutes and rupees. */
export interface Feeder {
  zone: number
  station: number
  cost: number
  felt: number
  time: number
  money: number
}

/**
 * Ways to the stations given (metro or rail) by the player's bus routes (`routes`, uncrowded), for zones that reach
 * a route's stops on foot: to a stop within `TRANSIT.feederWalk` km of the station, on by the route, the bus fare paid,
 * and the walk to the platform.
 */
export function feeders(routes: TransitSkim, stations: Station[], zones: Zone[], busPerKm: number, least: number): Feeder[] {
  const out: Feeder[] = []
  const P = routes.places
  if (P === 0) return out
  const n = TRANSIT.choices
  const at = new Float64Array(2)
  for (const s of stations) {
    toKm(s.at[0], s.at[1], at, 0)
    // The route's stops near the station, and the minutes on foot from each.
    const near: [number, number][] = []
    for (let b = 0; b < P; b++) {
      const dx = routes.xy[2 * b]! - at[0]!
      const dy = routes.xy[2 * b + 1]! - at[1]!
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d <= TRANSIT.feederWalk) near.push([b, ((d * DEMAND.detour) / TRAVEL.walkSpeed) * 60])
    }
    if (near.length === 0) continue
    for (const z of zones) {
      const perRupee = 60 / TRAVEL.valueOfTime[z.income - 1]!
      let best: Feeder | null = null
      for (let x = 0; x < n; x++) {
        const a = routes.access[z.id * n + x]!
        if (a < 0) break
        for (const [b, walk] of near) {
          const ab = a * P + b
          if (a === b || routes.cost[ab] === Infinity) continue
          const fare = fareOf('bus', busPerKm, least, routes.km[ab]!)
          const felt = routes.accessFelt[z.id * n + x]! + routes.cost[ab]! + TRAVEL.walkWeight * walk
          const cost = felt + fare * perRupee
          if (best && cost >= best.cost) continue
          best = { zone: z.id, station: s.id, cost, felt, time: routes.accessTime[z.id * n + x]! + routes.time[ab]! + walk, money: fare }
        }
      }
      if (best) out.push(best)
    }
  }
  return out
}

/** Works out the best way between every pair of places, with the crowding in `skim.crowd`. */
export function solveSkim(skim: TransitSkim): void {
  const { graph, places } = skim
  const nodes = graph.nodes
  const ride = TRAVEL.rideWeight[skim.system]
  const cost = Float64Array.from(skim.linkCost, (c, l) => c + ride * skim.rideMinutes[l]! * skim.crowd[l]! * 60)
  const tree = new Tree(graph)
  const t = new Float64Array(nodes)
  const k = new Float64Array(nodes)
  // Every trip alights once more than it changes: the last alighting is part of the walk out, counted in access.
  const lastCost = TRAVEL.walkWeight * TRANSIT.change
  tree.setCost(cost)
  for (let a = 0; a < places; a++) {
    tree.grow(a)
    tree.sum(skim.linkTime, t)
    tree.sum(skim.linkKm, k)
    skim.pred.set(tree.pred, a * nodes)
    skim.order.set(tree.order.subarray(0, tree.count), a * nodes)
    skim.reached[a] = tree.count
    for (let b = 0; b < places; b++) {
      const i = a * places + b
      const c = tree.time[b]! / 60
      if (a === b || c === Infinity) {
        skim.cost[i] = Infinity
        continue
      }
      skim.cost[i] = c - lastCost
      skim.time[i] = t[b]! - TRANSIT.change
      skim.km[i] = k[b]!
    }
  }
}

/**
 * Riders an hour on each link of the graph, from riders an hour between pairs of places (a × places + b, travelling
 * from a to b), each along its best way.
 */
export function linkLoads(s: TransitSkim, pairRiders: Float64Array): Float64Array {
  const P = s.places
  const N = s.graph.nodes
  const load = new Float64Array(s.graph.from.length)
  for (let a = 0; a < P; a++) {
    for (let b = 0; b < P; b++) {
      const f = pairRiders[a * P + b]!
      if (f === 0) continue
      let v = b
      while (v !== a) {
        const l = s.pred[a * N + v]!
        load[l]! += f
        v = s.graph.from[l]!
      }
    }
  }
  return load
}

/**
 * Crowding: the extra weight on each minute of riding a link at a load of y times what its trains can carry. It rises
 * with the square of the load up to `TRANSIT.crowd` when trains are full; beyond, riders are left on the platform,
 * which costs `TRANSIT.refuse` more for each further share of capacity that would board.
 */
export function crowding(y: number): number {
  return y <= 1 ? TRANSIT.crowd * y * y : TRANSIT.crowd + TRANSIT.refuse * (y - 1)
}

/**
 * Sets the crowding on each ride from the riders an hour who would travel between each pair of places were the trains
 * never crowded (`hour`: the morning and the evening peak). Riders between a pair are put off by the crowding they
 * would meet both ways, as a logit puts them off: a share p who chose the system falls to p e / (1 − p + p e), where
 * e = e^(−scale × extra minutes), p being the average share of those riders (`pairs`, riders a day between places, and
 * `shares`, the same weighted by their share). The crowding and the riders it leaves
 * are found together: each round the loads are worked out at the crowding so far, and the crowding set by the average
 * of the loads of all rounds, for `TRANSIT.crowdRounds` rounds. Then works the best ways out again.
 */
export function crowdSkim(s: TransitSkim, hour: [Float64Array, Float64Array], pairs: Float64Array, shares: Float64Array, scale: number): void {
  const P = s.places
  const N = s.graph.nodes
  const M = s.graph.from.length
  const ride = TRAVEL.rideWeight[s.system]
  // Felt minutes of crowding along each way, and the load it leaves on each link at each peak.
  const along = new Float64Array(P * P)
  const load = [new Float64Array(M), new Float64Array(M)]
  const felt = new Float64Array(M)
  const mean = new Float64Array(M)
  s.crowd.fill(0)
  const at = new Float64Array(N)
  const node = new Float64Array(N)
  // Places that riders travel to or from at a peak: only their trees matter.
  const active = new Uint8Array(P)
  for (let a = 0; a < P; a++) {
    for (let b = 0; b < P; b++) {
      if (hour[0]![a * P + b]! > 0 || hour[1]![a * P + b]! > 0 || hour[0]![b * P + a]! > 0 || hour[1]![b * P + a]! > 0) {
        active[a] = 1
        break
      }
    }
  }
  for (let round = 1; round <= TRANSIT.crowdRounds; round++) {
    for (let l = 0; l < M; l++) felt[l] = ride * s.rideMinutes[l]! * s.crowd[l]!
    // Along each tree, from its start outward.
    for (let a = 0; a < P; a++) {
      if (!active[a]) continue
      const base = a * N
      const count = s.reached[a]!
      at[s.order[base]!] = 0
      for (let k = 1; k < count; k++) {
        const v = s.order[base + k]!
        const l = s.pred[base + v]!
        at[v] = at[s.graph.from[l]!]! + felt[l]!
      }
      for (let b = 0; b < P; b++) along[a * P + b] = a === b || s.cost[a * P + b] === Infinity ? 0 : at[b]!
    }
    load[0]!.fill(0)
    load[1]!.fill(0)
    // The riders each start sends, put off by the crowding both ways, gathered back along its tree.
    for (let h = 0; h < 2; h++) {
      const out = load[h]!
      for (let a = 0; a < P; a++) {
        if (!active[a]) continue
        const base = a * N
        let any = false
        for (let b = 0; b < P; b++) {
          const ab = a * P + b
          const r = hour[h]![ab]!
          node[b] = 0
          if (r === 0) continue
          const ba = b * P + a
          const n = pairs[ab]! + pairs[ba]!
          const p = n > 0 ? (shares[ab]! + shares[ba]!) / n : 0
          const e = expNeg(scale * (along[ab]! + along[ba]!))
          const d = 1 - p + p * e
          node[b] = r * (d > 0 ? e / d : 1)
          any = true
        }
        if (!any) continue
        for (let k = s.reached[a]! - 1; k > 0; k--) {
          const v = s.order[base + k]!
          const f = node[v]!
          if (f === 0) continue
          node[v] = 0
          const l = s.pred[base + v]!
          out[l]! += f
          node[s.graph.from[l]!]! += f
        }
        node[a] = 0
      }
    }
    // The average of the loads so far sets the crowding (the method of successive averages).
    for (let l = 0; l < M; l++) {
      const c = s.capacity[l]!
      if (c === Infinity) continue
      const y = (load[0]![l]! > load[1]![l]! ? load[0]![l]! : load[1]![l]!) / c
      mean[l]! += (y - mean[l]!) / round
      s.crowd[l] = crowding(mean[l]!)
    }
  }
  recost(s)
}

/**
 * The weighted minutes between places with the crowding, along the ways found without it (slice 7). Were the ways found
 * again with the crowding, a small change in who rides could tip a journey from one interchange to another all at once,
 * and move riders, and so traffic, far from the change: crowding weighs on the ways riders take, and does not move them.
 */
function recost(skim: TransitSkim): void {
  const { graph, places } = skim
  const nodes = graph.nodes
  const ride = TRAVEL.rideWeight[skim.system]
  const at = new Float64Array(nodes)
  const lastCost = TRAVEL.walkWeight * TRANSIT.change
  for (let a = 0; a < places; a++) {
    const base = a * nodes
    const count = skim.reached[a]!
    at.fill(Infinity)
    at[skim.order[base]!] = 0
    for (let k = 1; k < count; k++) {
      const v = skim.order[base + k]!
      const l = skim.pred[base + v]!
      at[v] = at[graph.from[l]!]! + skim.linkCost[l]! + ride * skim.rideMinutes[l]! * skim.crowd[l]! * 60
    }
    for (let b = 0; b < places; b++) {
      const i = a * places + b
      if (skim.cost[i] === Infinity) continue
      skim.cost[i] = at[b]! / 60 - lastCost
    }
  }
}

/**
 * Each zone's nearest places by the cost of reaching them on foot, or by auto or two-wheeler if `ride` (not to a bus
 * stop), or by one of the player's bus routes (`feeders`, to stations by id).
 */
function zoneAccess(
  zones: Zone[],
  xy: Float64Array,
  places: number,
  linePlaces: number[][],
  ride: boolean,
  feeders: Feeder[] | undefined,
  placeOf: Map<number, number>,
  foot?: Float64Array,
  streets?: Float64Array,
) {
  const byZone = new Map<number, Feeder[]>()
  for (const f of feeders ?? []) if (placeOf.has(f.station)) (byZone.get(f.zone) ?? byZone.set(f.zone, []).get(f.zone)!).push(f)
  const n = TRANSIT.choices
  const access = new Int32Array(zones.length * n).fill(-1)
  const accessCost = new Float64Array(zones.length * n).fill(Infinity)
  const accessFelt = new Float64Array(zones.length * n)
  const accessTime = new Float64Array(zones.length * n)
  const accessMoney = new Float64Array(zones.length * n)
  const at = new Float64Array(2)
  const cost = new Float64Array(places)
  const felt = new Float64Array(places)
  const time = new Float64Array(places)
  const money = new Float64Array(places)
  const picked = new Uint8Array(places)
  for (const z of zones) {
    toKm(z.centre[0], z.centre[1], at, 0)
    const spread = DEMAND.intraZone * Math.sqrt(z.area)
    const perRupee = 60 / TRAVEL.valueOfTime[z.income - 1]!
    // Footpaths and crossings: the walk to a station or stop is lighter, and people walk further to one.
    const paved = foot ? foot[z.id]! : 0
    const walkWeight = TRAVEL.walkWeight - (TRAVEL.walkWeight - FOOT.walkWeight) * paved
    const walkReach = TRANSIT.walkReach * (1 + (FOOT.reach - 1) * paved)
    // Poor side streets slow the walk and the ride to a station or stop (slice 6): a walk loses part of what a ride does.
    const keep = streets ? streets[z.id]! : 1
    const walkKeep = 1 - SURFACE.walkShare * (1 - keep)
    for (let p = 0; p < places; p++) {
      const dx = xy[2 * p]! - at[0]!
      const dy = xy[2 * p + 1]! - at[1]!
      // To a station, from anywhere in the zone. To a bus stop, as to the city's buses (whose stops line the main
      // roads) where the route passes through the zone, and further by as much as it passes beyond it.
      let d: number
      if (ride) d = Math.sqrt(dx * dx + dy * dy + spread * spread) * DEMAND.detour
      else {
        const beyond = Math.sqrt(dx * dx + dy * dy) - spread
        d = BUS.walkBase / 1000 + BUS.walkSpread * spread + (beyond > 0 ? beyond * DEMAND.detour : 0)
      }
      cost[p] = Infinity
      if (d > (ride ? TRANSIT.rideReach : walkReach)) continue
      time[p] = (d / (TRAVEL.walkSpeed * walkKeep)) * 60
      cost[p] = felt[p] = walkWeight * time[p]!
      money[p] = 0
      if (!ride) continue
      const rideTime = TRANSIT.rideWait + (d / (TRANSIT.rideSpeed * keep)) * 60
      const rideFelt = TRAVEL.waitWeight * TRANSIT.rideWait + (d / (TRANSIT.rideSpeed * keep)) * 60
      const rideFare = TRANSIT.rideFareShare * (TRAVEL.autoLeast + Math.max(0, d - TRAVEL.autoLeastKm) * TRAVEL.autoPerKm)
      const rideCost = rideFelt + rideFare * perRupee
      if (d > walkReach || rideCost < cost[p]!) {
        time[p] = rideTime
        cost[p] = rideCost
        felt[p] = rideFelt
        money[p] = rideFare
      }
    }
    for (const f of byZone.get(z.id) ?? []) {
      const p = placeOf.get(f.station)!
      if (f.cost >= cost[p]!) continue
      cost[p] = f.cost
      felt[p] = f.felt
      time[p] = f.time
      money[p] = f.money
    }
    // The nearest place on each line, so that a new line does not hide an old one, then the cheapest of those.
    picked.fill(0)
    for (const list of linePlaces) {
      let best = -1
      for (const p of list) if (cost[p]! < Infinity && (best < 0 || cost[p]! < cost[best]!)) best = p
      if (best >= 0) picked[best] = 1
    }
    for (let p = 0; p < places; p++) {
      if (!picked[p]) continue
      let k = z.id * n + n - 1
      if (cost[p]! >= accessCost[k]!) continue
      while (k > z.id * n && accessCost[k - 1]! > cost[p]!) {
        access[k] = access[k - 1]!
        accessCost[k] = accessCost[k - 1]!
        accessFelt[k] = accessFelt[k - 1]!
        accessTime[k] = accessTime[k - 1]!
        accessMoney[k] = accessMoney[k - 1]!
        k--
      }
      access[k] = p
      accessCost[k] = cost[p]!
      accessFelt[k] = felt[p]!
      accessTime[k] = time[p]!
      accessMoney[k] = money[p]!
    }
  }
  return { access, accessCost, accessFelt, accessTime, accessMoney }
}

/**
 * For each zone as a destination, each place as a boarding point and each income, the best way on to that zone: the
 * cost from boarding there, and which of the zone's places to leave by. Worked out once a month, so that the best
 * journey between two zones is then a look at the few places near the start.
 */
export interface Journeys {
  skim: TransitSkim
  perKm: number
  least: number
  best: Float64Array
  via: Int32Array
}

/**
 * The fare of a ride of `km` by this system, rupees, at the fare per km and least fare given: at most `TRANSIT.mostFare`
 * by metro or rail; by bus at most `BUS.mostFare`, and on average only what the share who pay pay (Shakti).
 */
export function fareOf(system: System, perKm: number, least: number, km: number): number {
  if (system === 'bus') return Math.max(least, Math.min(BUS.mostFare, perKm * km)) * BUS.paying
  return Math.min(TRANSIT.mostFare, Math.max(least, perKm * km))
}

export function prepareJourneys(s: TransitSkim, zones: Zone[], perKm: number, least: number): Journeys {
  const n = TRANSIT.choices
  const P = s.places
  const Z = zones.length
  const best = new Float64Array(Z * P * 5).fill(Infinity)
  const via = new Int32Array(Z * P * 5).fill(-1)
  for (let j = 0; j < Z; j++) {
    for (let y = 0; y < n; y++) {
      const b = s.access[j * n + y]!
      if (b < 0) break
      const egress = s.accessCost[j * n + y]!
      for (let a = 0; a < P; a++) {
        const ab = a * P + b
        const c = s.cost[ab]!
        if (c === Infinity) continue
        const fare = fareOf(s.system, perKm, least, s.km[ab]!)
        for (let inc = 0; inc < 5; inc++) {
          const total = c + egress + (fare * 60 * TRAVEL.fareWeight[s.system]) / TRAVEL.valueOfTime[inc]!
          const k = (j * P + a) * 5 + inc
          if (total < best[k]!) {
            best[k] = total
            via[k] = y
          }
        }
      }
    }
  }
  return { skim: s, perKm, least, best, via }
}

/**
 * The best way by this system from zone i (of income `inc`, 0–4) to zone j: written to `out` as [weighted minutes
 * without money, minutes, rupees, km, pair of places, of the rupees those for the ride to and from the stations
 * (which is not a fare, and weighs as other money)]. False if there is none.
 */
export function bestJourney(J: Journeys, i: number, j: number, inc: number, out: Float64Array): boolean {
  const s = J.skim
  const n = TRANSIT.choices
  const P = s.places
  let best = Infinity
  let bx = -1
  let by = -1
  for (let x = 0; x < n; x++) {
    const a = s.access[i * n + x]!
    if (a < 0) break
    const k = (j * P + a) * 5 + inc
    const total = s.accessCost[i * n + x]! + J.best[k]!
    if (total < best) {
      best = total
      bx = x
      by = J.via[k]!
    }
  }
  if (best === Infinity) return false
  const a = s.access[i * n + bx]!
  const b = s.access[j * n + by]!
  const ab = a * P + b
  const km = s.km[ab]!
  const fare = fareOf(s.system, J.perKm, J.least, km)
  out[0] = s.accessFelt[i * n + bx]! + s.cost[ab]! + s.accessFelt[j * n + by]!
  out[1] = s.accessTime[i * n + bx]! + s.time[ab]! + s.accessTime[j * n + by]!
  out[5] = s.accessMoney[i * n + bx]! + s.accessMoney[j * n + by]!
  out[2] = fare + out[5]
  out[3] = km
  out[4] = ab
  return true
}

/**
 * Riders left behind: for each pair of places (a × places + b), the share of those who would ride between them who
 * get on (`hour`: riders an hour between places at the morning and the evening peak). Each ride passes at most what
 * its trains carry at the busier peak; those it cannot take are left behind before it and so do not crowd the rides
 * after it. The share each ride passes is set by the riders who reach it, found in `TRANSIT.boardRounds` rounds. A
 * round trip gets on in the lesser of its two ways' shares.
 */
export function boarding(s: TransitSkim, hour: [Float64Array, Float64Array]): Float64Array {
  const P = s.places
  const N = s.graph.nodes
  const M = s.graph.from.length
  const passes = new Float64Array(M).fill(1)
  const through = new Float64Array(P * P)
  const at = new Float64Array(N)
  const node = new Float64Array(N)
  const reach = [new Float64Array(M), new Float64Array(M)]
  for (let round = 0; round <= TRANSIT.boardRounds; round++) {
    const last = round === TRANSIT.boardRounds
    reach[0]!.fill(0)
    reach[1]!.fill(0)
    for (let a = 0; a < P; a++) {
      // The share of this start's riders that gets through to each node.
      const base = a * N
      at[s.order[base]!] = 1
      for (let k = 1; k < s.reached[a]!; k++) {
        const v = s.order[base + k]!
        const l = s.pred[base + v]!
        at[v] = at[s.graph.from[l]!]! * passes[l]!
      }
      for (let b = 0; b < P; b++) through[a * P + b] = s.cost[a * P + b] === Infinity ? 1 : at[b]!
      if (last) continue
      // The riders who reach each ride from this start, those left behind before it taken away.
      for (let h = 0; h < 2; h++) {
        const into = reach[h]!
        let any = false
        for (let b = 0; b < P; b++) {
          node[b] = hour[h]![a * P + b]!
          if (node[b]! > 0) any = true
        }
        if (!any) continue
        for (let k = s.reached[a]! - 1; k > 0; k--) {
          const v = s.order[base + k]!
          const f = node[v]!
          if (f === 0) continue
          node[v] = 0
          const l = s.pred[base + v]!
          const u = s.graph.from[l]!
          node[u]! += f
          into[l]! += f * at[u]!
        }
        node[a] = 0
      }
    }
    if (last) break
    for (let l = 0; l < M; l++) {
      const y = (reach[0]![l]! > reach[1]![l]! ? reach[0]![l]! : reach[1]![l]!) / s.capacity[l]!
      passes[l] = y > 1 ? 1 / y : 1
    }
  }
  const out = new Float64Array(P * P)
  for (let a = 0; a < P; a++) {
    for (let b = 0; b < P; b++) {
      const x = through[a * P + b]!
      const y = through[b * P + a]!
      out[a * P + b] = x < y ? x : y
    }
  }
  return out
}

/** What each line of a system carried in a weekday. */
export interface LineFigures {
  /** Passenger-km, and rupees of fares, by line id; the fare of a journey over several lines shared by its km on each. */
  km: Record<string, number>
  fare: Record<string, number>
  /** At the busier peak, the riders an hour where the line is most crowded, as a share of what its trains carry. */
  crowding: Record<string, number>
}

/**
 * Passenger-km and fares by line, from riders between pairs of places (both legs of a round trip, each along the best
 * way from a to b), at the fare per km and least fare given; and how crowded each line is at its busiest.
 */
export function lineFigures(s: TransitSkim, pairRiders: Float64Array, perKm: number, least: number, hour: [Float64Array, Float64Array]): LineFigures {
  const P = s.places
  const N = s.graph.nodes
  const lineKm = new Float64Array(s.lines.length)
  const lineFare = new Float64Array(s.lines.length)
  const onLine = new Float64Array(s.lines.length)
  for (let a = 0; a < P; a++) {
    for (let b = 0; b < P; b++) {
      const f = pairRiders[a * P + b]!
      if (f === 0) continue
      onLine.fill(0)
      let v = b
      while (v !== a) {
        const l = s.pred[a * N + v]!
        const line = s.rideLine[l]!
        if (line >= 0) onLine[line]! += s.linkKm[l]!
        v = s.graph.from[l]!
      }
      const km = s.km[a * P + b]!
      const fare = fareOf(s.system, perKm, least, km)
      for (let k = 0; k < s.lines.length; k++) {
        if (onLine[k] === 0) continue
        lineKm[k]! += f * s.own[k]! * onLine[k]!
        lineFare[k]! += (f * s.own[k]! * fare * onLine[k]!) / km
      }
    }
  }
  const morning = linkLoads(s, hour[0])
  const evening = linkLoads(s, hour[1])
  const most = new Float64Array(s.lines.length)
  for (let l = 0; l < morning.length; l++) {
    const line = s.rideLine[l]!
    if (line < 0) continue
    const y = (morning[l]! > evening[l]! ? morning[l]! : evening[l]!) / s.capacity[l]!
    if (y > most[line]!) most[line] = y
  }
  const out: LineFigures = { km: {}, fare: {}, crowding: {} }
  s.lines.forEach((id, k) => {
    out.km[id] = Math.round(lineKm[k]!)
    out.fare[id] = Math.round(lineFare[k]!)
    out.crowding[id] = Math.round(most[k]! * 1000)
  })
  return out
}

/** Adds riders between pairs of places to the boardings of each line they ride. */
export function countRiders(s: TransitSkim, pairRiders: Float64Array, riders: Record<string, number>): void {
  const P = s.places
  const N = s.graph.nodes
  const byLine = new Float64Array(s.lines.length)
  for (let a = 0; a < P; a++) {
    for (let b = 0; b < P; b++) {
      const f = pairRiders[a * P + b]!
      if (f === 0) continue
      let v = b
      while (v !== a) {
        const l = s.pred[a * N + v]!
        const line = s.boardLine[l]!
        if (line >= 0) byLine[line]! += f * s.own[line]!
        v = s.graph.from[l]!
      }
    }
  }
  s.lines.forEach((id, k) => (riders[id] = Math.round(byLine[k]!)))
}
