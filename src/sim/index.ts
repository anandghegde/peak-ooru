import { holdBack, lightTime, linkTimes, movingTime, goodMovingTime } from './assign'
import { makeTours, type Tours } from './demand'
import { buildNet, toKm, type Net } from './graph'
import { WayFinder, Ways } from './spread'
import { chooseModes, type Choice } from './modes'
import { ASSIGNMENT, BUS, BUSY, DEFAULT_PRICES, DEMAND, GUESS, HOURS, ROAD, SPREAD, SURFACE, TIMING, TRAVEL } from './params'
import { busSegments } from './bus'
import { boarding, buildSkim, countRiders, crowdSkim, feeders, lineFigures, serviceLines, type Rides, type TransitSkim } from './transit'
import { MODES, PERIODS, type CityState, type Mode, type MonthResult, type Period, type Prices, type RoutingLink, type RoutingNetwork } from './types'
import { expNeg } from './fixed'
import { modelZones, type ModelZones } from './zones'
import { roadDeaths } from './safety'
import { grade, surfaceSpeed } from './surface'
import type { Transit, Zone } from '../data/types'

/** The parts of a traveller's cost, averaged over trips: minutes of time, rupees, minutes of discomfort and of danger. */
export interface CostParts {
  time: number
  money: number
  comfort: number
  danger: number
}

/**
 * A month's result with what is kept for explaining it (PRD SCORE-13). Every field beyond MonthResult is optional
 * to the interface and may be ignored.
 */
export interface MonthDetail extends MonthResult {
  /** Work trips a weekday by mode, and their average door-to-door seconds. */
  commuteByMode: Record<Mode, { trips: number; seconds: number }>
  /** Of the average commute, the seconds lost to traffic on the roads. */
  commuteDelay: number
  /** Average cost of a trip by each mode, in its four parts, over all trips by that mode. */
  costParts: Record<Mode, CostParts>
  /** Average km of a trip by each mode. */
  tripKm: Record<Mode, number>
  /** Shares of work trips, in thousandths, by distance: up to 1, 5, 10, 20, 30, 50 km, and beyond (the census's bands). */
  workDistance: number[]
  /** Vehicles for each passenger-car unit of flow, by period: `flow` is in vehicles, the model works in car units. */
  vehiclesPerPcu: Record<Period, number>
  /** Rupees of fares paid a weekday, by mode: bus, metro and rail; 0 for the rest, which pay no fare to the city. */
  fares: Record<Mode, number>
  /** Passenger-km a weekday by mode; for metro and rail, the km ridden on the trains. */
  passengerKm: Record<Mode, number>
  /** For each transit line in service, by id: passenger-km a weekday, and rupees of fares (a journey's fare shared among its lines by km). */
  lineKm: Record<string, number>
  lineFare: Record<string, number>
  /** For each line in service: riders an hour where it is most crowded at the busier peak, in thousandths of what its trains carry. */
  crowding: Record<string, number>
  /** For each line in service: minutes between its trains or buses at the peak, to a tenth. */
  headway: Record<string, number>
  /** Road deaths a year at the month's rate by who was killed: on foot or cycling, riding a two-wheeler, and the rest (slice 5). */
  deathsBy: { walk: number; twoWheeler: number; other: number }
  /**
   * The speed limits the month was worked out with, km/h by link, as `CityState.limits` (slice 5): `speed` is a share
   * of the speed at light traffic held to the limit, and `linkKmh` reads them from here.
   */
  limits?: Record<number, number>
  /**
   * Slice 6, for the rules' wear of the roads (PRD ROAD-2): vehicles a weekday on each routing link, by id, all four
   * parts of the day; and of them the heavy ones, buses (the city's and the player's routes) and goods vehicles.
   */
  vehiclesByLink?: Int32Array
  heavyByLink?: Int32Array
  /**
   * Slice 6, for the cost of running buses (PRD ROAD-5): bus-km a weekday on main roads whose surface is good, fair,
   * poor and broken (the grades of `grade` in surface.ts), the city's buses and the player's routes together.
   */
  busKmByGrade?: [number, number, number, number]
  /**
   * Slice 6, for naming the worst roads (PRD ROAD-6): vehicle-minutes a weekday lost on each routing link to the state of
   * its surface: the traffic it passed, at the time it took against the time the same traffic would take on the road in
   * perfect repair (queues before it left out; traffic that went another way for it not counted).
   */
  surfaceDelay?: Int32Array
}

/**
 * Km an hour on a routing link in a period of a month. The result gives speed as a share of the speed at light
 * traffic with the stops at signals; this puts the signals' seconds back.
 */
export function linkKmh(roads: RoutingNetwork, result: MonthResult, period: Period, link: RoutingLink): number {
  const signals = link.signals ?? (roads.nodes[link.to]!.signal ? 1 : 0)
  const limit = (result as Partial<MonthDetail>).limits?.[link.id]
  const kmh = limit !== undefined && limit > 0 && limit < link.speed * ROAD.speedScale ? limit : link.speed * ROAD.speedScale
  const free = (link.length * 3.6) / kmh + ROAD.signalDelay * signals
  return (link.length * 3.6 * result.speed[period][link.id]!) / (free * 1000)
}

/** Milliseconds each stage of the last month took, for finding where the time goes. Not part of any result. */
export const stages: Record<string, number> = {}
/** For each period, the car units a unit of the first guess was scaled to, in the last month worked out: for tuning `GUESS`. */
export const guessScale: number[] = [0, 0, 0, 0]


/** The clock, only for the time a month took. */
function now(): number {
  return performance.now()
}

/** Gateways on main roads, where traffic from beyond the map enters, and how much road meets each. */
function mainGateways(roads: RoutingNetwork): { node: number; at: [number, number]; weight: number }[] {
  const weight = new Map<number, number>()
  const main = new Set<number>()
  for (const l of roads.links) {
    for (const n of [l.from, l.to]) {
      if (!roads.nodes[n]!.gateway) continue
      weight.set(n, (weight.get(n) ?? 0) + l.capacity)
      if (l.kind === 'motorway' || l.kind === 'trunk' || l.kind === 'primary') main.add(n)
    }
  }
  return roads.nodes.filter((n) => main.has(n.id)).map((n) => ({ node: n.id, at: n.at, weight: weight.get(n.id)! }))
}

/** Works out a weekday of the month: demand, modes, and traffic over the roads for the four parts of the day. */
export function simulate(state: CityState): MonthDetail {
  const started = now()
  let mark = started
  const stage = (name: string) => {
    const t = now()
    stages[name] = (stages[name] ?? 0) + t - mark
    mark = t
  }
  const { roads, transit } = state
  const grouped = modelZones(state.zones, roads.zoneNode)
  const zones = grouped.zones
  const Z = zones.length
  const prices = monthPrices(state, grouped)
  const streets = streetShare(state, grouped)
  const net = buildNet(roads, zones, grouped.node, state.condition, {
    works: state.works, bus: state.busLanes, limits: state.limits, surface: state.surface, shut: state.shut, streets,
  })
  const N = net.nodes
  const L = net.links
  const od = origins(roads, net, Z)
  const { O, stride, rootNode, gateways } = od
  const G = gateways.length
  const { joinStart, joinNode, joinTime, joinLength } = net

  // Demand: work and other round trips, what does not choose a mode, and a first guess at the rest.
  const tours = makeTours(zones)
  const external = externalDemand(zones, od)
  const goods = goodsDemand(Z, tours, od)
  // A month of festivals or a big match (slice 7): more trips than usual, work and other alike; the goods and the
  // traffic from beyond the map as usual.
  const surge = state.surge !== undefined && state.surge > 0 && state.surge < Infinity ? state.surge / 1000 : 1
  surged(tours, surge)
  const fixed = PERIODS.map((_, p) => {
    const e = external[p]!, g = goods[p]!, out = new Float64Array(e.length)
    for (let k = 0; k < e.length; k++) out[k] = e[k]! + g[k]!
    return out
  })
  // The routes are found for residents' and goods traffic of this month's pattern but of the size the roads usually
  // carry, with the traffic from beyond the map as it is: so that a small change in the city (a few more people, all
  // alike) cannot reshuffle the routes, and its effect is small and in one direction.
  let demand = goods.map((g) => g.slice())
  guessDemand(Z, tours, demand, stride)
  // Sized to the city's roads as built, so that works, bus lanes or repair on a few links do not move routes
  // everywhere: by their lanes, so that more room at a junction does not load the guess more; and only the city's own
  // roads (those drawn on the map; the player's have no drawn stretch), so that a new road does not either.
  let lanes = 0
  for (const l of roads.links) if (l.drawn.length > 0 && l.from !== l.to) lanes += l.lanes
  const capacity = lanes * GUESS.perLane
  // What travellers meet on the roads is that pattern at the month's own size: `GUESS.perUnit` car units for each unit
  // of it, the size at which Bengaluru's roads carried the guess in 2026, loaded on the routes found at the network's
  // size. So the roads fill as the city grows, and travellers see it; the routes stay put.
  const grow = [1, 1, 1, 1]
  for (let p = 0; p < 3; p++) {
    const d = demand[p]!
    const e = external[p]!
    let sum = 0
    for (let k = 0; k < d.length; k++) sum += d[k]!
    const scale = sum > 0 ? (GUESS.load[p]! * capacity * HOURS[PERIODS[p]!]) / sum : 0
    guessScale[p] = scale
    // Never below the network's usual load: a city smaller than that (the small test city, or one that has shrunk)
    // is met as the routes were found.
    if (scale > 0 && GUESS.perUnit[p]! > scale) grow[p] = GUESS.perUnit[p]! / scale
    for (let k = 0; k < d.length; k++) d[k] = e[k]! + d[k]! * scale
  }
  stage('demand')

  const J = joinNode.length
  const cost = new Float64Array(L)
  const route = new Float64Array(L)
  const freeCost = new Float64Array(L)
  const busCost = new Float64Array(L)
  const busAt = new Float64Array(N)
  const nodeTime = new Float64Array(N)
  const ffTime = new Float32Array(Z * Z)
  const ffLength = new Float32Array(Z * Z)
  const time = PERIODS.map(() => new Float32Array(Z * Z))
  const bus = PERIODS.map(() => new Float32Array(Z * Z))
  const flow = PERIODS.map(() => new Float64Array(L))
  const tolls = new Float32Array(Z * Z)
  const noJoin = new Float64Array(J)
  const atNode = new Float64Array(N)
  const mid = PERIODS.indexOf('midday')
  const night = PERIODS.indexOf('night')
  /** The ways each period's traffic takes: the night's are the midday's. */
  const waysOf = (p: number) => byPeriod[p === night ? mid : p]!
  /** Writes the times from root o (a zone), the quickest of its ways at the costs given, into period p's table. */
  const write = (o: number, p: number, at: Float64Array) => {
    if (o >= Z) return
    waysOf(p).times(o, at, nodeTime, true)
    waysOf(p).arrivals(o, nodeTime, joinTime, time[p]!, o * Z, true)
  }
  /**
   * The city's buses keep to their routes whatever the traffic: in every period they are read along the midday
   * ways (as the midday's traffic shares them), at period p's times, arriving by whichever junction of a zone is
   * quickest for them. So a bus lane keeps its buses though the cars it slows go round.
   */
  const writeBus = (o: number, p: number) => {
    if (o >= Z) return
    waysOf(mid).times(o, busCost, busAt)
    const bk = bus[p]!
    const row = o * Z
    for (let z = 0; z < Z; z++) {
      let best = Infinity
      for (let k = joinStart[z]!, b = joinStart[z + 1]!; k < b; k++) {
        const x = busAt[joinNode[k]!]! + joinTime[k]!
        if (x < best) best = x
      }
      bk[row + z] = best
    }
  }
  /** Puts period p's demand from root o, times `weight`, onto its ways, into `out`. */
  const load = (o: number, p: number, out: Float64Array, weight = 1, from: Float64Array[] = demand) => {
    place(o, p, weight, from, atNode)
    waysOf(p).load(o, atNode, out)
  }
  /** Puts period p's demand from root o (of `from`, times `weight`, an hour) at the nodes where it ends, into `at`. */
  const place = (o: number, p: number, weight: number, from: Float64Array[], at: Float64Array) => {
    const d = from[p]!
    const perHour = weight / HOURS[PERIODS[p]!]
    const row = o * stride
    waysOf(p).place(o, d, row, perHour, at)
    for (let g = 0; g < G; g++) at[gateways[g]!.node]! += d[row + Z + g]! * perHour
  }
  const atNode2 = new Float64Array(N)
  const setCost = (f: Float64Array) => {
    linkTimes(net, f, cost)
    setBusCost(net, cost, busCost)
  }
  /** Several values a link, interleaved for `Ways.sweep`, and what it gives by node. */
  const packed = new Float64Array(L * 6)
  const nodeMany = new Float64Array(N * 6)
  const pack = (k: number, values: Float64Array[]) => {
    for (let i = 0; i < k; i++) {
      const v = values[i]!
      for (let l = 0; l < L; l++) packed[l * k + i] = v[l]!
    }
  }
  /** As `writeBus`, from the `i`th of `k` values by node that `Ways.sweep` gave. */
  const busFrom = (o: number, p: number, k: number, i: number) => {
    const bk = bus[p]!
    const row = o * Z
    for (let z = 0; z < Z; z++) {
      let best = Infinity
      for (let q = joinStart[z]!, b = joinStart[z + 1]!; q < b; q++) {
        const x = nodeMany[joinNode[q]! * k + i]! + joinTime[q]!
        if (x < best) best = x
      }
      bk[row + z] = best
    }
  }

  // Each period's guess is loaded, a root at a time in a fixed mixed order, each shared among its ways on the
  // times the roots before it left. The traffic from beyond the map is loaded apart as well, so that the rest can be
  // brought to the month's size.
  const outside = PERIODS.map(() => new Float64Array(L))
  const c = new Float64Array(L)
  const assign = (p: number) => {
    const f = flow[p]!
    const e = outside[p]!
    for (let k = 0; k < O; k++) {
      const o = turn[k]!
      if (k % ASSIGNMENT.refresh === 0) {
        linkTimes(net, f, c)
        for (let l = 0; l < L; l++) route[l] = c[l]! + net.tollSeconds[l]!
        finder.setCost(route)
      }
      // The first roots of every period are found on the roads empty, the same costs each time: the midday's ways.
      if (p !== mid && k < ASSIGNMENT.refresh) waysOf(p).copy(o, waysOf(mid))
      else waysOf(p).find(o, rootNode[o]!, finder)
      // The guess and the traffic from beyond the map, in one pass.
      place(o, p, 1, demand, atNode)
      place(o, p, 1, external, atNode2)
      waysOf(p).load2(o, atNode, f, atNode2, e)
    }
  }
  /** Period p's loading brought to the month's size: the traffic from beyond the map as it is, the rest grown. */
  const sized = PERIODS.map(() => new Float64Array(L))
  const toSize = (p: number) => {
    const f = flow[p]!, e = outside[p]!, out = sized[p]!, g = grow[p]!
    for (let l = 0; l < L; l++) out[l] = e[l]! + g * (f[l]! - e[l]!)
  }
  // Each root's ways are found as it is loaded, on the times the roots before it left (see `assign`).
  const turn = Array.from({ length: O }, (_, o) => o).sort((a, b) => mix(a) - mix(b) || a - b)
  const finder = new WayFinder(net)
  const byPeriod = [0, 1, 2].map((p) => Ways.for(O, net, p))
  // Midday first; its ways are the night's too, and give the distances and the free-flow times between zones.
  setCost(flow[night]!)
  freeCost.set(cost)
  const busFree = busCost.slice()
  assign(mid)
  toSize(mid)
  setCost(sized[mid]!)
  // Read along the midday ways from each zone in one pass: the quickest times at free flow (the night's for now, and
  // the free-flow times) and at midday; the distances; and the city's buses at free flow and at midday.
  pack(5, [freeCost, cost, net.length, busFree, busCost])
  for (let o = 0; o < Z; o++) {
    waysOf(mid).sweep(o, 5, 2, packed, nodeMany)
    waysOf(mid).arrivalsOf(o, nodeMany, 5, 0, joinTime, time[night]!, o * Z, true)
    ffTime.set(time[night]!.subarray(o * Z, o * Z + Z), o * Z)
    waysOf(mid).arrivalsOf(o, nodeMany, 5, 1, joinTime, time[mid]!, o * Z, true)
    waysOf(mid).arrivalsOf(o, nodeMany, 5, 2, joinLength, ffLength, o * Z)
    busFrom(o, night, 5, 3)
    busFrom(o, mid, 5, 4)
  }
  stage('midday loading')

  // The busy periods: each one's quickest times along its own ways (and the tolls, as the morning's drivers go);
  // then the city's buses at each one's times, along the midday ways, in one pass.
  const busyBus: Float64Array[] = []
  for (let p = 0; p < 4; p++) {
    if (!BUSY.includes(PERIODS[p]!)) continue
    assign(p)
    toSize(p)
    setCost(sized[p]!)
    if (p === 0) {
      pack(2, [cost, net.toll])
      for (let o = 0; o < Z; o++) {
        waysOf(0).sweep(o, 2, 1, packed, nodeMany)
        waysOf(0).arrivalsOf(o, nodeMany, 2, 0, joinTime, time[0]!, o * Z, true)
        waysOf(0).arrivalsOf(o, nodeMany, 2, 1, noJoin, tolls, o * Z)
      }
    } else for (let o = 0; o < Z; o++) write(o, p, cost)
    busyBus.push(busCost.slice())
  }
  const busy0 = PERIODS.map((p, k) => (BUSY.includes(p) ? k : -1)).filter((k) => k >= 0)
  pack(busy0.length, busyBus)
  for (let o = 0; o < Z; o++) {
    waysOf(mid).sweep(o, busy0.length, 0, packed, nodeMany)
    busy0.forEach((p, i) => busFrom(o, p, busy0.length, i))
  }
  stage('first loading')
  // Where people go, again, now that the month's roads are known.
  const went = surged(makeTours(zones, slowness(Z, time[0]!, time[mid]!, ffTime, tours)), surge)
  stage('demand again')

  // Transit: the player's bus routes ride the roads at the busy periods' speeds, or free in their bus lanes.
  const busy = PERIODS.map((p, k) => (BUSY.includes(p) ? k : -1)).filter((k) => k >= 0)
  const routeSeconds = new Float64Array(net.roadLinks)
  for (const p of busy) {
    linkTimes(net, sized[p]!, cost)
    for (let l = 0; l < net.roadLinks; l++) {
      const t = net.busLane[l] ? lightTime(net, l) + net.delay[l]! : cost[l]!
      routeSeconds[l]! += t / busy.length
    }
  }
  const { rides, busFlow, links: routeLinks, transit: routeTransit } = busRoutes(state, net, routeSeconds)
  // The player's bus routes first: they feed the stations near their stops.
  const foot = footShare(state, grouped)
  const routes = buildSkim(routeTransit, zones, 'bus', state.vehicles, rides, undefined, foot, streets)
  const fed = (system: 'metro' | 'rail') =>
    feeders(routes, stationsOf(transit, system, state.vehicles), zones, prices.busPerKm, prices.leastFare)
  const metro = buildSkim(transit, zones, 'metro', state.vehicles, undefined, fed('metro'), foot, streets)
  const rail = buildSkim(transit, zones, 'rail', state.vehicles, undefined, fed('rail'), foot, streets)
  addBuses(net, routes, routeLinks, busFlow)
  stage('transit')

  // Travellers choose their modes on those times.
  const shares = new Float32Array(Z * Z * 8)
  const transitTimes = new Float32Array(Z * Z * 3)
  demand = PERIODS.map((_, p) => fixed[p]!.slice())
  const input = {
    zones, prices, time, bus, free: ffTime, length: ffLength, tolls, work: went.work, other: went.other,
    metro, rail, routes, originOfZone: od.originOfZone, stride, demand, shares, transit: transitTimes, report: false, foot, streets,
    busService: state.busService !== undefined && state.busService >= 0 ? state.busService / 1000 : 1,
    ownership: {
      car: rupees(state.ownership?.car, 1000) / 1000,
      twoWheeler: rupees(state.ownership?.twoWheeler, 1000) / 1000,
    },
  }
  // Who would ride the trains were they never crowded, and so the crowding they would meet; who would ride them so
  // crowded, and so how many are left behind where trains are full; then the choice for good.
  const uncrowded = chooseModes({ ...input, estimate: true })
  stage('modes: uncrowded')
  crowdSkim(metro, uncrowded.metroHour, uncrowded.metroPairs, uncrowded.metroShare, TRAVEL.scale)
  crowdSkim(rail, uncrowded.railHour, uncrowded.railPairs, uncrowded.railShare, TRAVEL.scale)
  if (routes.places > 0) crowdSkim(routes, uncrowded.routeHour, uncrowded.routePairs, uncrowded.routeShare, TRAVEL.scale)
  stage('modes: crowding')
  const crowded = chooseModes({ ...input, estimate: true })
  stage('modes: crowded')
  const choice = chooseModes({
    ...input,
    boarding: { metro: boarding(metro, crowded.metroHour), rail: boarding(rail, crowded.railHour), bus: boarding(routes, crowded.routeHour) },
  })
  stage('modes: the choice')

  // The chosen demand goes onto the routes the assignment found, each set of routes carrying its share. Goods vehicles
  // for the whole day go onto the midday routes besides, for the heavy traffic on each link (slice 6).
  const goodsDay = new Float64Array(goods[0]!.length)
  for (let p = 0; p < 4; p++) for (let k = 0; k < goodsDay.length; k++) goodsDay[k]! += goods[p]![k]!
  const goodsFrom = [goodsDay, goodsDay, goodsDay, goodsDay]
  const goodsFlow = new Float64Array(L)
  // What each link passes in the busiest hour, the rest held back into the shoulders of the peak, and what would
  // enter it: the flows the month's times are worked out on. What each root's entries carried as the chosen demand
  // was loaded is kept for holding back, a period at a time.
  const gatewayNodes = Int32Array.from(gateways, (g) => g.node)
  const inflow = PERIODS.map(() => new Float64Array(L))
  const pass = PERIODS.map(() => new Float64Array(L))
  for (let p = 0; p < 4; p++) {
    const f = flow[p]!
    f.fill(0)
    const kept = keptBuffer(waysOf(p).entries)
    for (let o = 0; o < O; o++) {
      place(o, p, 1, demand, atNode)
      waysOf(p).loadKeep(o, atNode, f, kept)
      if (p === mid && o < Z) load(o, p, goodsFlow, HOURS.midday, goodsFrom)
    }
    stage('loading the choice')
    let over = false
    for (let l = 0; l < L; l++) if (f[l]! > ROAD.most * net.capacity[l]!) over = true
    if (!over) {
      inflow[p]!.set(f)
      pass[p]!.set(f)
    } else holdBack(net, waysOf(p), demand[p]!, 1 / HOURS[PERIODS[p]!], O, stride, gatewayNodes, f, inflow[p]!, pass[p]!, kept)
    stage('holding back')
  }
  // The player's buses run on their routes whatever the traffic (in their own lane where they have one).
  for (let p = 0; p < 4; p++) {
    const b = busFlow[p]!
    for (let l = 0; l < net.roadLinks; l++) {
      if (b[l] === 0) continue
      inflow[p]![l]! += b[l]!
      pass[p]![l]! += b[l]!
    }
  }
  stage('holding back')

  // The times the month's traffic comes to, read along the last routes, and the commute and access on them: along the
  // midday ways, the night's and the midday's quickest times and the city's buses in every period, in one pass; and
  // each busy period's along its own.
  const costs = PERIODS.map(() => new Float64Array(L))
  const busCosts = PERIODS.map(() => new Float64Array(L))
  for (let p = 0; p < 4; p++) {
    linkTimes(net, inflow[p]!, costs[p]!)
    setBusCost(net, costs[p]!, busCosts[p]!)
  }
  pack(6, [costs[night]!, costs[mid]!, ...busCosts])
  for (let o = 0; o < Z; o++) {
    waysOf(mid).sweep(o, 6, 2, packed, nodeMany)
    waysOf(mid).arrivalsOf(o, nodeMany, 6, 0, joinTime, time[night]!, o * Z, true)
    waysOf(mid).arrivalsOf(o, nodeMany, 6, 1, joinTime, time[mid]!, o * Z, true)
    for (let p = 0; p < 4; p++) busFrom(o, p, 6, 2 + p)
  }
  for (let p = 0; p < 4; p++) {
    if (p === mid || p === night) continue
    for (let o = 0; o < Z; o++) write(o, p, costs[p]!)
  }
  stage('quiet periods and final times')
  const report = chooseModes({ ...input, report: true })
  stage('report')
  const result = finish(state, prices, grouped, net, pass, choice, report, metro, rail, routes, started)
  wear(state, net, result, flow, pass, { goods: goodsFlow, outside, routes, routeLinks, busKm: choice.modeKm[3]! })
  stage('result')
  return result
}

/**
 * What each root's entries carried, for holding back (see `Ways.loadKeep`): one array for every month, grown as needed
 * (a month would otherwise make megabytes to throw away). Everything in it is written before it is read.
 */
let keptStore = new Float64Array(0)
function keptBuffer(size: number): Float64Array {
  if (keptStore.length < size) keptStore = new Float64Array(Math.ceil(size * 1.25))
  return keptStore
}

/** The last month's ratio of road times to free-flow times, weighted by trips, at the morning peak and midday: for tuning `DEMAND.slow`. */
export const slowRatio: number[] = [0, 0]

/**
 * How much slower than usual the roads between each pair of zones are, in minutes one way: the time at the morning peak
 * (for work) and at midday (for the rest), less `DEMAND.slow` times the time at free flow, which is what Bengaluru's
 * roads came to on average in January 2026. Faster than usual gives less than nothing. Shifted by `DEMAND.slowShift`
 * so that it is never below nothing; a shift alike for every pair changes nothing in where people go.
 */
function slowness(Z: number, morning: Float32Array, midday: Float32Array, free: Float32Array, tours: Tours) {
  const work = new Float32Array(Z * Z)
  const other = new Float32Array(Z * Z)
  const [kw, ko] = DEMAND.slow
  let tw = 0, fw = 0, to = 0, fo = 0
  for (let ij = 0; ij < Z * Z; ij++) {
    const f = free[ij]!
    const w = (morning[ij]! - kw! * f) / 60 + DEMAND.slowShift
    const o = (midday[ij]! - ko! * f) / 60 + DEMAND.slowShift
    work[ij] = w > 0 ? w : 0
    other[ij] = o > 0 ? o : 0
    tw += tours.work[ij]! * morning[ij]!
    fw += tours.work[ij]! * f
    to += tours.other[ij]! * midday[ij]!
    fo += tours.other[ij]! * f
  }
  slowRatio[0] = fw > 0 ? tw / fw : 0
  slowRatio[1] = fo > 0 ? to / fo : 0
  return { work, other }
}

/** The roots of the trees: each zone, then the gateways on main roads, which are also where trips end. */
function origins(roads: RoutingNetwork, net: Net, Z: number) {
  const gateways = mainGateways(roads)
  const rootNode: number[] = []
  for (let z = 0; z < Z; z++) rootNode.push(net.firstZone + z)
  for (const g of gateways) rootNode.push(g.node)
  const originOfZone = Int32Array.from({ length: Z }, (_, z) => z)
  return { O: rootNode.length, stride: Z + gateways.length, rootNode, originOfZone, gateways }
}
type Origins = ReturnType<typeof origins>

/** Passenger-car units a day by period of the traffic from beyond the map, which does not choose a mode. */
function externalDemand(zones: Zone[], od: Origins): Float64Array[] {
  const Z = zones.length
  const { O, stride, originOfZone, gateways } = od
  const G = gateways.length
  const fixed = PERIODS.map(() => new Float64Array(O * stride))
  let totalWeight = 0
  for (const g of gateways) totalWeight += g.weight
  // Distance from each gateway to each zone, in a straight line.
  const gatewayKm = new Float64Array(G * Z)
  const a = new Float64Array(2)
  const b = new Float64Array(2)
  for (let g = 0; g < G; g++) {
    const node = gateways[g]!.at
    toKm(node[0] / 1e6, node[1] / 1e6, a, 0)
    for (let j = 0; j < Z; j++) {
      toKm(zones[j]!.centre[0], zones[j]!.centre[1], b, 0)
      const dx = a[0]! - b[0]!
      const dy = a[1]! - b[1]!
      gatewayKm[g * Z + j] = Math.sqrt(dx * dx + dy * dy) * DEMAND.detour
    }
  }
  for (let g = 0; g < G; g++) {
    const og = Z + g
    const share = gateways[g]!.weight / totalWeight
    for (let h = 0; h < G; h++) {
      if (h === g) continue
      const through = (DEMAND.external * DEMAND.through * share * gateways[h]!.weight) / (totalWeight - gateways[g]!.weight)
      for (let p = 0; p < 4; p++) fixed[p]![og * stride + Z + h]! += through * TIMING.external[p]!
    }
    let pull = 0
    for (let j = 0; j < Z; j++) pull += (zones[j]!.jobs + zones[j]!.people) * expNeg(DEMAND.externalDecay * gatewayKm[g * Z + j]!)
    for (let j = 0; j < Z; j++) {
      const v = (DEMAND.external * (1 - DEMAND.through) * share * (zones[j]!.jobs + zones[j]!.people) *
        expNeg(DEMAND.externalDecay * gatewayKm[g * Z + j]!)) / pull
      const oj = originOfZone[j]!
      for (let p = 0; p < 4; p++) {
        fixed[p]![og * stride + j]! += v * TIMING.external[p]!
        fixed[p]![oj * stride + Z + g]! += v * TIMING.external[p]!
      }
    }
  }
  return fixed
}

/** Passenger-car units a day by period of goods vehicles, both ways, in proportion to other trips. */
function goodsDemand(Z: number, tours: Tours, od: Origins): Float64Array[] {
  const { O, stride, originOfZone } = od
  const fixed = PERIODS.map(() => new Float64Array(O * stride))
  const g = TIMING.goods
  const [f0, f1, f2, f3] = fixed as [Float64Array, Float64Array, Float64Array, Float64Array]
  for (let i = 0; i < Z; i++) {
    const oi = originOfZone[i]!
    for (let j = 0; j < Z; j++) {
      const v = DEMAND.goods * tours.other[i * Z + j]! * ROAD.pcu.goods
      if (v === 0 || i === j) continue
      const a = oi * stride + j
      const b = originOfZone[j]! * stride + i
      f0[a]! += v * g[0]
      f1[a]! += v * g[1]
      f2[a]! += v * g[2]
      f3[a]! += v * g[3]
      f0[b]! += v * g[0]
      f1[b]! += v * g[1]
      f2[b]! += v * g[2]
      f3[b]! += v * g[3]
    }
  }
  return fixed
}

/** A first guess at the road traffic of residents in every period but the night, before anyone has chosen, in passenger-car units. */
function guessDemand(Z: number, tours: Tours, demand: Float64Array[], stride: number): void {
  for (let p = 0; p < 3; p++) {
    const d = demand[p]!
    const wo = GUESS.work * TIMING.workOut[p]!
    const wb = GUESS.work * TIMING.workBack[p]!
    const xo = GUESS.other * TIMING.otherOut[p]!
    const xb = GUESS.other * TIMING.otherBack[p]!
    for (let i = 0; i < Z; i++) {
      for (let j = 0; j < Z; j++) {
        if (i === j) continue
        const w = tours.work[i * Z + j]!
        const x = tours.other[i * Z + j]!
        d[i * stride + j]! += w * wo + x * xo
        d[j * stride + i]! += w * wb + x * xb
      }
    }
  }
}

/** Round trips times `k`, in place. */
function surged(t: Tours, k: number): Tours {
  if (k === 1) return t
  for (let i = 0; i < t.work.length; i++) t.work[i]! *= k
  for (let i = 0; i < t.other.length; i++) t.other[i]! *= k
  return t
}

/** A fixed scrambling of whole numbers, for an order of work that is mixed but the same everywhere. */
function mix(k: number): number {
  return Math.imul(k + 1, 0x9e3779b1) >>> 0
}

/** For each model zone, the share of its people who live in wards with footpaths and crossings laid. */
function footShare(state: CityState, grouped: ModelZones): Float64Array {
  const out = new Float64Array(grouped.zones.length)
  if (!state.footpaths?.length) return out
  const laid = new Set(state.footpaths)
  state.zones.forEach((z, k) => {
    if (laid.has(z.id)) out[grouped.of[k]!]! += z.people
  })
  grouped.zones.forEach((z, g) => (out[g] = z.people > 0 ? out[g]! / z.people : 0))
  return out
}

/**
 * For each model zone, the share of free speed its side streets keep for their state (slice 6): the average over its
 * wards, weighted by their people, of what each ward's streets keep. Undefined when the city gives no streets.
 */
function streetShare(state: CityState, grouped: ModelZones): Float64Array | undefined {
  const given = state.streets
  if (!given) return undefined
  const out = new Float64Array(grouped.zones.length)
  const weight = new Float64Array(grouped.zones.length)
  state.zones.forEach((z, k) => {
    const g = grouped.of[k]!
    const c = given[z.id]
    // Each ward counts at least a little, so that a group of empty wards still takes its streets' state.
    const w = z.people + 1
    out[g]! += w * (c !== undefined && c < 100 ? surfaceSpeed(c) : 1)
    weight[g]! += w
  })
  for (let g = 0; g < out.length; g++) out[g] = weight[g]! > 0 ? out[g]! / weight[g]! : 1
  return out
}

/** Parking charges by model zone: the average over its wards, weighted by their jobs, where drivers park. */
function groupParking(state: CityState, grouped: ModelZones): number[] {
  const given = state.prices?.parking
  const sum = new Array<number>(grouped.zones.length).fill(0)
  if (!given) return sum
  state.zones.forEach((z, k) => (sum[grouped.of[k]!]! += rupees(given[k], 0) * z.jobs))
  return sum.map((s, g) => (grouped.zones[g]!.jobs > 0 ? s / grouped.zones[g]!.jobs : 0))
}

/** A price (or other amount) as given, or `otherwise` where it is missing, negative or not a number. */
function rupees(x: number | undefined, otherwise: number): number {
  return x !== undefined && x >= 0 && x < Infinity ? x : otherwise
}

/** The month's prices: the defaults where none is given, and none below nothing. */
function monthPrices(state: CityState, grouped: ModelZones): Prices {
  const given = state.prices ?? {}
  const d = DEFAULT_PRICES
  return {
    fuel: rupees(given.fuel, d.fuel),
    metroPerKm: rupees(given.metroPerKm, d.metroPerKm),
    busPerKm: rupees(given.busPerKm, d.busPerKm),
    railPerKm: rupees(given.railPerKm, d.railPerKm),
    leastFare: rupees(given.leastFare, d.leastFare),
    parking: groupParking(state, grouped),
  }
}

function total(a: Float64Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]!
  return s
}

/** The stations of a system's lines in service. */
function stationsOf(transit: Transit, system: 'metro' | 'rail', vehicles?: Record<string, number>) {
  const ids = new Set(serviceLines(transit, system, vehicles).flatMap((l) => l.stations))
  return transit.stations.filter((s) => ids.has(s.id))
}

/** The city's buses: in the traffic, or at free speed in a bus lane, and slowed by stopping. */
function setBusCost(net: Net, cost: Float64Array, out: Float64Array): void {
  for (let l = 0; l < net.links; l++) {
    const t = net.busLane[l] ? lightTime(net, l) + net.delay[l]! : cost[l]!
    out[l] = t + BUS.stopPerMetre * net.length[l]!
  }
}

/**
 * The player's bus routes on the roads. A bus stops wherever there is a stop along its way, as the city's do, not only
 * at the places the player chose: so each route is given further stops at junctions about `BUS.stopSpacing` apart
 * between the player's. For each route: its stops so (in a transit of the routes alone, the further stops with ids
 * below nothing), the minutes and km from each to the next (at `seconds` a link, and `BUS.stopPerMetre` for stopping,
 * as the city's buses; each the average of the two ways, which one-way streets can make differ), and the links its
 * buses run on both ways.
 */
function busRoutes(state: CityState, net: Net, seconds: Float64Array) {
  const rides: Rides = new Map()
  const lines = serviceLines(state.transit, 'bus', state.vehicles)
  const busFlow = PERIODS.map(() => new Float64Array(net.roadLinks))
  const links = new Map<string, number[]>()
  const transit: Transit = { stations: [], lines: [] }
  if (lines.length === 0) return { rides, busFlow, links, transit }
  const stations = new Map(state.transit.stations.map((s) => [s.id, s]))
  const used = new Set<number>()
  const extra = new Map<number, number>()
  const time = (l: number) => seconds[l]! + BUS.stopPerMetre * net.length[l]!
  for (const line of lines) {
    const out = busSegments(state.roads, line, stations)
    const back = busSegments(state.roads, { ...line, stations: [...line.stations].reverse() }, stations).reverse()
    const stops: number[] = [line.stations[0]!]
    used.add(line.stations[0]!)
    const minutes: number[] = []
    const km: number[] = []
    const all: number[] = []
    for (let k = 0; k < out.length; k++) {
      const way = out[k]!
      let t = 0, m = 0, tb = 0
      for (const l of way) {
        t += time(l)
        m += net.length[l]!
        all.push(l)
      }
      for (const l of back[k]!) {
        tb += time(l)
        all.push(l)
      }
      // Minutes each way are scaled so that the way out and the way back come to their average.
      const scale = t > 0 ? (t + tb) / (2 * t) : 1
      let since = 0, sinceTime = 0, gone = 0
      for (const l of way) {
        since += net.length[l]!
        sinceTime += time(l)
        gone += net.length[l]!
        if (since < BUS.stopSpacing || m - gone < BUS.stopSpacing / 2) continue
        const node = net.to[l]!
        let id = extra.get(node)
        if (id === undefined) {
          id = -1 - extra.size
          extra.set(node, id)
        }
        stops.push(id)
        minutes.push((sinceTime * scale) / 60)
        km.push(since / 1000)
        since = sinceTime = 0
      }
      stops.push(line.stations[k + 1]!)
      used.add(line.stations[k + 1]!)
      minutes.push((sinceTime * scale) / 60 + (way.length === 0 ? tb / 60 : 0))
      km.push(since / 1000)
    }
    rides.set(line.id, { minutes, km })
    links.set(line.id, all)
    transit.lines.push({ ...line, stations: stops })
  }
  for (const id of used) transit.stations.push(stations.get(id)!)
  for (const [node, id] of extra) {
    const at = state.roads.nodes[node]!.at
    transit.stations.push({ id, name: '', nameKn: null, at: [at[0] / 1e6, at[1] / 1e6], kind: 'bus' })
  }
  return { rides, busFlow, links, transit }
}

/**
 * Puts each bus route's buses on its links, but for those with a bus lane: buses an hour each way, in car units, at
 * every period alike.
 */
function addBuses(net: Net, routes: TransitSkim, links: Map<string, number[]>, busFlow: Float64Array[]): void {
  routes.lines.forEach((id, k) => {
    const pcu = (60 / routes.headway[k]!) * ROAD.pcu.bus
    for (const l of links.get(id) ?? []) if (!net.busLane[l]) for (const f of busFlow) f[l]! += pcu
  })
}

/**
 * What the rules need to wear the roads and charge for running buses over them, and to name the roads whose surface
 * costs most (slice 6): vehicles and heavy vehicles a weekday by link, bus-km by the grade of the road, and the
 * vehicle-minutes each link's surface costs. Heavy vehicles are the goods vehicles of the commercial traffic (loaded for
 * the whole day on the midday routes), `SURFACE.outsideHeavy` of the traffic from beyond the map, and the buses: the
 * player's routes on their own links, and the city's (a stand-in with no routes) spread over the roads other than
 * expressways as the traffic is. Each link's goods and outside traffic are cut by the share of its day's traffic that
 * was held back.
 */
function wear(
  state: CityState,
  net: Net,
  result: MonthDetail,
  raw: Float64Array[],
  pass: Float64Array[],
  x: { goods: Float64Array; outside: Float64Array[]; routes: TransitSkim; routeLinks: Map<string, number[]>; busKm: number },
): void {
  const L = net.roadLinks
  const vehicles = new Int32Array(L)
  const heavy = new Int32Array(L)
  const delay = new Int32Array(L)
  const day = new Float64Array(L)
  const busDay = new Float64Array(L)
  const grade = new Uint8Array(L)
  const main = new Uint8Array(L)
  for (const l of state.roads.links) {
    if (l.id >= L) continue
    grade[l.id] = gradeOf(state.surface?.[l.id])
    main[l.id] = l.kind === 'motorway' || l.from === l.to ? 0 : 1
  }
  // The player's routes: buses a weekday on each link they run on, both ways, whatever the period.
  let dayHours = 0
  for (const p of PERIODS) dayHours += HOURS[p]
  x.routes.lines.forEach((id, k) => {
    const buses = (60 / x.routes.headway[k]!) * dayHours
    for (const l of x.routeLinks.get(id) ?? []) busDay[l]! += buses
  })
  let pcuKmMain = 0
  for (let l = 0; l < L; l++) {
    let passed = 0, entered = 0, out = 0, lost = 0
    for (let p = 0; p < 4; p++) {
      const h = HOURS[PERIODS[p]!]
      const ratio = result.vehiclesPerPcu[PERIODS[p]!]
      passed += pass[p]![l]! * h
      entered += raw[p]![l]! * h
      out += x.outside[p]![l]! * h
      const v = pass[p]![l]!
      if (v > 0 && net.surfaceSpeed[l]! < 1) lost += (v * h * ratio * (movingTime(net, l, v) - goodMovingTime(net, l, v))) / 60
      vehicles[l]! += pass[p]![l]! * h * ratio
    }
    day[l] = passed
    const held = entered > passed && entered > 0 ? passed / entered : 1
    heavy[l] = Math.round((held * (SURFACE.goodsHeavy * x.goods[l]! + SURFACE.outsideHeavy * out)) / ROAD.pcu.goods)
    delay[l] = Math.round(lost)
    vehicles[l] = Math.round(vehicles[l]!)
    if (main[l]) pcuKmMain += (passed * net.length[l]!) / 1000
  }
  // The city's buses: the bus-km of their riders over the riders a bus carries, less the player's routes' share.
  let routePkm = 0
  for (const id of x.routes.lines) routePkm += result.lineKm[id] ?? 0
  const cityKm = (x.busKm > routePkm ? x.busKm - routePkm : 0) / BUS.load
  const byGrade: [number, number, number, number] = [0, 0, 0, 0]
  for (let l = 0; l < L; l++) {
    const km = net.length[l]! / 1000
    const city = main[l] && pcuKmMain > 0 ? (cityKm * day[l]!) / pcuKmMain : 0
    const buses = city + busDay[l]!
    heavy[l]! += Math.round(buses)
    if (heavy[l]! > vehicles[l]!) vehicles[l] = heavy[l]!
    byGrade[grade[l]!]! += buses * km
  }
  result.vehiclesByLink = vehicles
  result.heavyByLink = heavy
  result.busKmByGrade = byGrade.map(Math.round) as [number, number, number, number]
  result.surfaceDelay = delay
}

function gradeOf(c: number | undefined): 0 | 1 | 2 | 3 {
  return c === undefined || !(c < 100) ? 0 : grade(c)
}

/** Turns the model's working into the month's result: whole numbers and fixed-point, by the agreed interface. */
function finish(
  state: CityState,
  prices: Prices,
  grouped: ModelZones,
  net: Net,
  flow: Float64Array[],
  choice: Choice,
  report: Choice,
  metro: TransitSkim,
  rail: TransitSkim,
  routes: TransitSkim,
  started: number,
): MonthDetail {
  const L = net.roadLinks
  const flowOut = {} as Record<Period, Int32Array>
  const speedOut = {} as Record<Period, Int16Array>
  // Vehicles for each car unit, from the mix of residents' road trips (goods and through traffic taken alike).
  const vehiclesPerPcu = {} as Record<Period, number>
  PERIODS.forEach((period, p) => {
    const ratio = choice.vehicles / choice.pcu
    vehiclesPerPcu[period] = ratio
    const f = new Int32Array(L)
    const s = new Int16Array(L)
    for (let l = 0; l < L; l++) {
      f[l] = Math.round(flow[p]![l]! * ratio)
      // Against the time at light traffic, stopping at the signals included.
      // A speed limit is part of the road at light traffic: a limited road runs at its limit, not slow, at night.
      const base = net.least[l]! > net.base[l]! ? net.least[l]! : net.base[l]!
      const share = Math.round(((base + net.delay[l]!) * 1000) / movingTime(net, l, flow[p]![l]!))
      s[l] = share > 1000 ? 1000 : share
    }
    flowOut[period] = f
    speedOut[period] = s
  })

  const trips = {} as Record<Mode, number>
  const commuteByMode = {} as Record<Mode, { trips: number; seconds: number }>
  const costParts = {} as Record<Mode, CostParts>
  const tripKm = {} as Record<Mode, number>
  MODES.forEach((m, k) => {
    tripKm[m] = choice.trips[k]! > 0 ? Math.round((choice.modeKm[k]! * 10) / choice.trips[k]!) / 10 : 0
    const t = choice.trips[k]!
    trips[m] = Math.round(t)
    const w = report.modeTrips[k]!
    commuteByMode[m] = { trips: Math.round(w), seconds: w > 0 ? Math.round(report.modeSeconds[k]! / w) : 0 }
    const q = choice.parts
    const per = (x: number) => (t > 0 ? Math.round((x * 10) / t) / 10 : 0)
    costParts[m] = { time: per(q[k * 4]!), money: per(q[k * 4 + 1]!), comfort: per(q[k * 4 + 2]!), danger: per(q[k * 4 + 3]!) }
  })

  // Each zone of the game takes the figures of the group of wards it was worked out in.
  const zones = state.zones
  const commuteByZone = new Int32Array(zones.length)
  const accessByZone = new Int16Array(zones.length)
  let jobs = 0
  let people = 0
  for (const z of zones) {
    jobs += z.jobs
    people += z.people
  }
  let reach = 0
  const cleanByZone = new Int16Array(zones.length)
  zones.forEach((z, k) => {
    const i = grouped.of[k]!
    const all = choice.homeTrips[i]!
    cleanByZone[k] = all > 0 ? Math.round((choice.homeClean[i]! * 1000) / all) : 0
    const n = report.zoneTrips[i]!
    commuteByZone[k] = n > 0 ? Math.round(report.zoneSeconds[i]! / n) : 0
    accessByZone[k] = Math.round((report.access[i]! * 1000) / jobs)
    reach += (z.people * report.access[i]!) / jobs
  })

  const deaths = roadDeaths(state, grouped, net, flow, { twoWheelerKm: choice.modeKm[1]!, walkKm: choice.walkKm, cycleKm: choice.cycleKm })

  const riders: Record<string, number> = {}
  for (const line of state.transit.lines) riders[line.id] = 0
  countRiders(metro, choice.metroPairs, riders)
  countRiders(rail, choice.railPairs, riders)
  countRiders(routes, choice.routePairs, riders)
  const m = lineFigures(metro, choice.metroPairs, prices.metroPerKm, prices.leastFare, choice.metroHour)
  const r = lineFigures(rail, choice.railPairs, prices.railPerKm, prices.leastFare, choice.railHour)
  const b = lineFigures(routes, choice.routePairs, prices.busPerKm, prices.leastFare, choice.routeHour)
  const headway: Record<string, number> = {}
  for (const s of [metro, rail, routes]) s.lines.forEach((id, k) => (headway[id] = Math.round(s.headway[k]! * 10) / 10))
  const sum = (x: Record<string, number>) => Object.values(x).reduce((a, b) => a + b, 0)
  const fares = {} as Record<Mode, number>
  const passengerKm = {} as Record<Mode, number>
  MODES.forEach((mode, k) => {
    fares[mode] = 0
    passengerKm[mode] = Math.round(choice.modeKm[k]!)
  })
  fares.bus = Math.round(choice.busFare)
  fares.metro = sum(m.fare)
  fares.rail = sum(r.fare)
  passengerKm.metro = sum(m.km)
  passengerKm.rail = sum(r.km)

  return {
    month: state.month,
    flow: flowOut,
    speed: speedOut,
    commute: Math.round(report.workSeconds / report.workTrips),
    commuteByZone,
    trips,
    access: Math.round((reach * 1000) / people),
    accessByZone,
    cleanByZone,
    deaths: deaths.total,
    deathsByZone: deaths.byZone,
    riders,
    took: now() - started,
    commuteByMode,
    commuteDelay: Math.round(report.delaySeconds / report.workTrips),
    costParts,
    tripKm,
    workDistance: Array.from(report.workBands, (b) => Math.round((b * 1000) / report.workTrips)),
    vehiclesPerPcu,
    fares,
    passengerKm,
    lineKm: { ...m.km, ...r.km, ...b.km },
    lineFare: { ...m.fare, ...r.fare, ...b.fare },
    crowding: { ...m.crowding, ...r.crowding, ...b.crowding },
    headway,
    deathsBy: { walk: Math.round(deaths.walk), twoWheeler: Math.round(deaths.twoWheeler), other: Math.round(deaths.other) },
    ...(state.limits ? { limits: state.limits } : {}),
  }
}

