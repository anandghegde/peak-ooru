import type { Zone } from '../data/types'
import { expNeg } from './fixed'
import { ACCESS, BUS, DEMAND, FOOT, HOURS, ROAD, SAFETY, SURFACE, TIMING, TRAVEL } from './params'
import { bestJourney, prepareJourneys, type TransitSkim } from './transit'
import type { Prices } from './types'

/** Modes in the order of MODES: car, two-wheeler, auto, bus, metro, rail, cycle, walk. */
const CAR = 0, TW = 1, AUTO = 2, BUSM = 3, METRO = 4, RAIL = 5, CYCLE = 6, WALK = 7
const M = 8
const BANDS = [1.5, 5.5, 10.5, 20.5, 30.5, 50.5]
const KEYS = ['car', 'twoWheeler', 'auto', 'bus', 'metro', 'rail', 'cycle', 'walk'] as const

export interface ChoiceInput {
  zones: Zone[]
  prices: Prices
  /** Node-to-node seconds by car in each period's traffic, and by bus; free-flow seconds and metres. Zone by zone. */
  time: Float32Array[]
  bus: Float32Array[]
  free: Float32Array
  length: Float32Array
  /** Rupees of tolls a car pays zone to zone. */
  tolls: Float32Array
  /** Round trips a weekday, zone by zone, for work and for everything else. */
  work: Float64Array
  other: Float64Array
  metro: TransitSkim
  rail: TransitSkim
  /** The player's bus routes. */
  routes: TransitSkim
  /** Where each zone's road trips start, and the stride of a row of `demand`. */
  originOfZone: Int32Array
  stride: number
  /** Passenger-car units a period, origin by destination, added to when choosing. */
  demand: Float64Array[]
  /**
   * Shares of work trips by mode, and minutes by metro, by rail and by the player's bus routes (−1 if none, or if the
   * city's buses are the better), zone by zone: written when choosing, read when reporting.
   */
  shares: Float32Array
  transit: Float32Array
  /**
   * Choosing: travellers choose on these times, and the vehicles go into `demand`. Reporting: the commute and access
   * are worked out on these times with the shares already chosen, and nothing else is done.
   */
  report: boolean
  /** Cars and two-wheelers to hand, as shares of today's. */
  ownership: { car: number; twoWheeler: number }
  /** Share of each zone's people whose streets have footpaths and crossings (0 to 1); none if omitted. */
  foot?: Float64Array
  /** Share of free speed each zone's side streets keep for their state (slice 6); 1 for every zone if omitted. */
  streets?: Float64Array
  /** Estimating: only the riders by metro and by rail are worked out, for the crowding (see transit.ts, crowdSkim). */
  estimate?: boolean
  /**
   * For each pair of places by metro and by rail, the share of would-be riders who get on (see transit.ts, boarding).
   * Those left behind travel the other ways open to them, in the shares they would have chosen among those.
   */
  boarding?: { metro: Float64Array; rail: Float64Array; bus: Float64Array }
  /**
   * Slice 7: the city's own buses as a share of their usual service, 0 to 1 (a strike): they come less often, and carry
   * only that share of those who would ride them; the rest go another way. 1 if omitted.
   */
  busService?: number
}

/** What the choice came to. Sums are over person trips (a round trip is two). */
export interface Choice {
  /** Trips a weekday by mode. */
  trips: Float64Array
  /** Work trips, and their seconds door to door: city, and by home zone. */
  workTrips: number
  workSeconds: number
  zoneTrips: Float64Array
  zoneSeconds: Float64Array
  /** Work trips and seconds by mode; and of those seconds, the part lost to traffic. For reasons. */
  modeTrips: Float64Array
  modeSeconds: Float64Array
  delaySeconds: number
  /** The four parts of the cost of every trip, by mode: minutes of time, rupees, minutes of discomfort, minutes of danger. */
  parts: Float64Array
  /** Jobs reachable within the limit, by zone, before dividing by all jobs. */
  access: Float64Array
  /** Rupees of bus fares paid a weekday (those who ride free pay nothing). */
  busFare: number
  /** Vehicles and passenger-car units of residents' road trips, for turning one into the other. */
  vehicles: number
  pcu: number
  /** Person-km a weekday by mode, and work trips by distance band (up to 1, 5, 10, 20, 30, 50 km, and beyond). */
  modeKm: Float64Array
  workBands: Float64Array
  /** Riders between pairs of places, by system. */
  metroPairs: Float64Array
  railPairs: Float64Array
  /** Riders an hour at the busiest hour of the morning and of the evening, from place a to place b (a × places + b). */
  metroHour: [Float64Array, Float64Array]
  railHour: [Float64Array, Float64Array]
  /** Riders between pairs of places, each weighted by the share of their group (by what they have to hand) who chose the system: see crowdSkim. */
  metroShare: Float64Array
  railShare: Float64Array
  /** The same for the player's bus routes. */
  routePairs: Float64Array
  routeHour: [Float64Array, Float64Array]
  routeShare: Float64Array
  /** Person-km a weekday on foot and by cycle in each zone: walking trips, and the walk to and from the bus and trains. */
  walkKm: Float64Array
  cycleKm: Float64Array
  /** Trips a weekday by where the traveller lives (slice 7): all, and clean ones (bus, metro, rail, cycle, on foot). */
  homeTrips: Float64Array
  homeClean: Float64Array
}

/**
 * Each group of travellers (a home zone, a destination and a purpose) chooses among the eight ways of travelling by a
 * cost of time, money, comfort and safety, and the vehicles that result are added to each period's demand.
 */
export function chooseModes(input: ChoiceInput): Choice {
  const { zones, prices, time, bus, free, length, tolls, work, other, metro, rail, routes, originOfZone, stride, demand, shares, transit, report, estimate, boarding, ownership } = input
  // The city's buses in a strike: as often as they run, and as many as they carry.
  const service = input.busService !== undefined && input.busService < 1 ? Math.max(0, input.busService) : 1
  const slower = service < 1 ? Math.min(BUS.mostSlower, 1 / Math.max(service, 1e-9)) : 1
  const foot = input.foot ?? new Float64Array(zones.length)
  const Z = zones.length
  const out: Choice = {
    trips: new Float64Array(M),
    workTrips: 0,
    workSeconds: 0,
    zoneTrips: new Float64Array(Z),
    zoneSeconds: new Float64Array(Z),
    modeTrips: new Float64Array(M),
    modeSeconds: new Float64Array(M),
    delaySeconds: 0,
    parts: new Float64Array(M * 4),
    access: new Float64Array(Z),
    busFare: 0,
    vehicles: 0,
    pcu: 0,
    modeKm: new Float64Array(M),
    workBands: new Float64Array(BANDS.length + 1),
    metroPairs: new Float64Array(metro.places * metro.places),
    railPairs: new Float64Array(rail.places * rail.places),
    metroHour: [new Float64Array(metro.places * metro.places), new Float64Array(metro.places * metro.places)],
    railHour: [new Float64Array(rail.places * rail.places), new Float64Array(rail.places * rail.places)],
    metroShare: new Float64Array(metro.places * metro.places),
    railShare: new Float64Array(rail.places * rail.places),
    routePairs: new Float64Array(routes.places * routes.places),
    routeHour: [new Float64Array(routes.places * routes.places), new Float64Array(routes.places * routes.places)],
    routeShare: new Float64Array(routes.places * routes.places),
    walkKm: new Float64Array(Z),
    cycleKm: new Float64Array(Z),
    homeTrips: new Float64Array(Z),
    homeClean: new Float64Array(Z),
  }
  // Per mode, for the current pair: minutes of each leg, rupees for the round trip, felt minutes, danger minutes.
  const tOut = new Float64Array(M)
  const tBack = new Float64Array(M)
  const money = new Float64Array(M)
  const felt = new Float64Array(M)
  const danger = new Float64Array(M)
  const g = new Float64Array(M)
  const p = new Float64Array(M)
  const metroWay = new Float64Array(6)
  const railWay = new Float64Array(6)
  const routeWay = new Float64Array(6)
  const spread = new Float64Array(Z)
  const outer = new Uint8Array(Z)
  // Poor side streets: a trip within a zone drives them at a share of the speed, and the walk to the bus is slower.
  const streetKeep = new Float64Array(Z).fill(1)
  const walkKeep = new Float64Array(Z).fill(1)
  for (let i = 0; i < Z; i++) {
    spread[i] = DEMAND.intraZone * Math.sqrt(zones[i]!.area)
    outer[i] = zones[i]!.ward === undefined ? 1 : 0
    const k = input.streets ? input.streets[i]! : 1
    streetKeep[i] = k
    walkKeep[i] = 1 - SURFACE.walkShare * (1 - k)
  }
  const jobs = Float64Array.from(zones, (z) => z.jobs)
  const parking = prices.parking
  const fuel = prices.fuel
  const pcuCar = ROAD.pcu.car / TRAVEL.carOccupancy
  const pcuTw = ROAD.pcu.twoWheeler / TRAVEL.twoWheelerOccupancy
  const pcuAuto = (ROAD.pcu.auto * TRAVEL.autoEmpty) / TRAVEL.autoOccupancy
  const pcuBus = ROAD.pcu.bus / BUS.load
  const vehCar = 1 / TRAVEL.carOccupancy
  const vehTw = 1 / TRAVEL.twoWheelerOccupancy
  const vehAuto = TRAVEL.autoEmpty / TRAVEL.autoOccupancy
  const vehBus = 1 / BUS.load
  const dangerTw = 2 * TRAVEL.dangerPerKm.twoWheeler
  const dangerAuto = 2 * TRAVEL.dangerPerKm.auto
  const dangerCycle = 2 * TRAVEL.dangerPerKm.cycle
  const dangerWalk = 2 * TRAVEL.dangerPerKm.walk
  const bother = Float64Array.from(KEYS, (k) => 2 * TRAVEL.constant[k])
  const rw = TRAVEL.rideWeight
  const ww = TRAVEL.walkWeight
  const wait = TRAVEL.waitWeight
  const scale = TRAVEL.scale
  // How much each mode's rupees weigh: fares more than fuel (see TRAVEL.fareWeight).
  const weigh = Float64Array.from(KEYS, (k) => (k === 'bus' || k === 'metro' || k === 'rail' ? TRAVEL.fareWeight[k] : 1))
  // e^(−scale × x), never quite nothing, so that every group always has some way to go however dear the rest.
  const odds = (x: number) => expNeg(scale * x < 50 ? scale * x : 50)
  const filter = 1 - TRAVEL.twoWheelerFilter
  const tiring = TRAVEL.tiring
  const ramp = ACCESS.minutes + ACCESS.soft
  const autoLeast = TRAVEL.autoLeast, autoLeastKm = TRAVEL.autoLeastKm, autoPerKm = TRAVEL.autoPerKm
  const [mo, md, ev, ni] = time as [Float32Array, Float32Array, Float32Array, Float32Array]
  const [bmo, bmd, bev, bni] = bus as [Float32Array, Float32Array, Float32Array, Float32Array]
  // The way back, j to i, read as rows so that the loop below reads memory in order.
  const [rmo, rmd, rev, rni] = time.map((t) => transpose(t, Z)) as [Float32Array, Float32Array, Float32Array, Float32Array]
  const [rbmo, rbmd, rbev, rbni] = bus.map((t) => transpose(t, Z)) as [Float32Array, Float32Array, Float32Array, Float32Array]
  const metroWays = report ? null : prepareJourneys(metro, zones, prices.metroPerKm, prices.leastFare)
  const railWays = report ? null : prepareJourneys(rail, zones, prices.railPerKm, prices.leastFare)
  const routeWays = report || routes.places === 0 ? null : prepareJourneys(routes, zones, prices.busPerKm, prices.leastFare)
  const [d0, d1, d2, d3] = demand as [Float64Array, Float64Array, Float64Array, Float64Array]
  const { trips, modeKm, parts, modeTrips, modeSeconds, access, zoneTrips, zoneSeconds, workBands } = out
  let workTrips = 0, workSeconds = 0, delaySeconds = 0, vehicles = 0, pcuAll = 0
  let held = 0, eMetroKept = 0, eRailKept = 0, eBusKept = 0
  let hasMetro = false, hasRail = false, hasRoute = false
  /** Whether the pair in hand goes by the player's bus route rather than the city's buses, and the share who get on it. */
  let onRoute = false, getsRoute = 1
  let busMoney = 0
  /** Riders by metro and by rail between the pair in hand, for counting riders and crowding. */
  const riders = (tours: number, sOut: readonly number[], sBack: readonly number[]) => {
    if (hasMetro) {
      out.metroPairs[metroWay[4]!]! += 2 * tours * p[METRO]!
      out.metroShare[metroWay[4]!]! += 2 * tours * eMetroKept * eMetroKept * held
      atPeak(out.metroHour, metro.places, metroWay[4]!, tours * p[METRO]!, sOut, sBack)
    }
    if (hasRail) {
      out.railPairs[railWay[4]!]! += 2 * tours * p[RAIL]!
      out.railShare[railWay[4]!]! += 2 * tours * eRailKept * eRailKept * held
      atPeak(out.railHour, rail.places, railWay[4]!, tours * p[RAIL]!, sOut, sBack)
    }
    if (onRoute) {
      const n = tours * p[BUSM]! * getsRoute
      out.routePairs[routeWay[4]!]! += 2 * n
      out.routeShare[routeWay[4]!]! += 2 * tours * eBusKept * eBusKept * held
      atPeak(out.routeHour, routes.places, routeWay[4]!, n, sOut, sBack)
    }
  }

  for (let i = 0; i < Z; i++) {
    const inc = zones[i]!.income - 1
    const perRupee = 60 / TRAVEL.valueOfTime[inc]!
    const dread = TRAVEL.dangerDread[inc]!
    const c = Math.min(1, TRAVEL.hasCar[inc]! * ownership.car)
    const w = Math.min(1, TRAVEL.hasTwoWheeler[inc]! * ownership.twoWheeler)
    const sBoth = c * w, sCar = c * (1 - w), sTw = (1 - c) * w, sNone = (1 - c) * (1 - w)
    const oi = originOfZone[i]!
    let reachAll = 0, rowTrips = 0, rowSeconds = 0
    for (let j = 0; j < Z; j++) {
      const ij = i * Z + j
      const same = i === j
      // The roads' times run from zone node to zone node, the side streets at each end included; a zone's own trips
      // cross its spread on its side streets.
      const km = same ? spread[i]! * DEMAND.detour : length[ij]! / 1000
      const local = same ? (km / (TRAVEL.localSpeed * streetKeep[i]!)) * 60 : 0
      const freeMin = (same ? 0 : free[ij]! / 60) + local
      const walkEndsKm = (2 * BUS.walkBase) / 1000 + BUS.walkSpread * (spread[i]! + spread[j]!)
      const walkEnds = streetKeep[i] === 1 && streetKeep[j] === 1
        ? (walkEndsKm / TRAVEL.walkSpeed) * 60
        : (((BUS.walkBase / 1000 + BUS.walkSpread * spread[i]!) / walkKeep[i]! + (BUS.walkBase / 1000 + BUS.walkSpread * spread[j]!) / walkKeep[j]!) /
            TRAVEL.walkSpeed) * 60
      // Footpaths and crossings at either end make walking safer and pleasanter (and the walk to a station lighter:
      // transit.ts). The city's buses, a stand-in whose stops are anywhere along the main roads, are left as they are.
      const paved = (foot[i]! + foot[j]!) / 2
      let busWait = (outer[i] || outer[j] ? BUS.outerWait : BUS.wait) * slower
      if (km > BUS.changeBeyond) busWait *= 2
      const hasBus = !same
      // What does not depend on the time of day: money, danger, and the ways that do not use the roads.
      if (report) {
        const tm = transit[3 * ij]!
        const tr = transit[3 * ij + 1]!
        hasMetro = tm >= 0
        hasRail = tr >= 0
        hasRoute = false
        tOut[METRO] = tBack[METRO] = tm
        tOut[RAIL] = tBack[RAIL] = tr
      } else {
        hasMetro = !same && bestJourney(metroWays!, i, j, inc, metroWay)
        hasRail = !same && bestJourney(railWays!, i, j, inc, railWay)
        hasRoute = !same && routeWays !== null && bestJourney(routeWays, i, j, inc, routeWay)
        tOut[METRO] = tBack[METRO] = metroWay[1]!
        tOut[RAIL] = tBack[RAIL] = railWay[1]!
        transit[3 * ij] = hasMetro ? metroWay[1]! : -1
        transit[3 * ij + 1] = hasRail ? railWay[1]! : -1
        transit[3 * ij + 2] = -1
        const toll = same ? 0 : tolls[ij]! + tolls[j * Z + i]!
        money[CAR] = (2 * km * fuel) / TRAVEL.carKmPerLitre + parking[j]! + toll
        money[TW] = (2 * km * fuel) / TRAVEL.twoWheelerKmPerLitre + ROAD.twoWheelerToll * toll
        money[AUTO] = 2 * (autoLeast + (km > autoLeastKm ? (km - autoLeastKm) * autoPerKm : 0))
        busMoney = 2 * Math.max(prices.leastFare, Math.min(BUS.mostFare, prices.busPerKm * km)) * BUS.paying
        money[METRO] = 2 * metroWay[2]!
        money[RAIL] = 2 * railWay[2]!
        // The ride to the station is paid as other money is, not as a fare: its rupees weigh once, not `fareWeight` times.
        felt[METRO] = 2 * metroWay[0]! + bother[METRO]! + 2 * metroWay[5]! * perRupee * (1 - weigh[METRO]!)
        felt[RAIL] = 2 * railWay[0]! + bother[RAIL]! + 2 * railWay[5]! * perRupee * (1 - weigh[RAIL]!)
        danger[TW] = dangerTw * km * dread
        danger[AUTO] = dangerAuto * km * dread
        danger[CYCLE] = dangerCycle * km * dread
        danger[WALK] = dangerWalk * km * dread * (1 - FOOT.safer * paved)
      }
      const cycle = (km / TRAVEL.cycleSpeed) * 60
      const walk = (km / TRAVEL.walkSpeed) * 60
      tOut[CYCLE] = tBack[CYCLE] = cycle
      tOut[WALK] = tBack[WALK] = walk
      // Walking and cycling tire: each minute feels worse the longer the trip.
      felt[CYCLE] = rw.cycle * 2 * cycle * (1 + cycle / tiring) + bother[CYCLE]!
      felt[WALK] = rw.walk * 2 * walk * (1 + walk / tiring) * (1 - FOOT.pleasant * paved)

      if (estimate && !hasMetro && !hasRail && !hasRoute) continue
      for (let q = 0; q < 2; q++) {
        const tours = q === 0 ? work[ij]! : other[ij]!
        if (q === 1 && (report || tours === 0)) continue
        if (estimate && tours === 0) continue
        const sOut = q === 0 ? TIMING.workOut : TIMING.otherOut
        const sBack = q === 0 ? TIMING.workBack : TIMING.otherBack
        let carOut = local, carBack = local, busOut = local, busBack = local
        if (!same) {
          carOut += (sOut[0] * mo[ij]! + sOut[1] * md[ij]! + sOut[2] * ev[ij]! + sOut[3] * ni[ij]!) / 60
          carBack += (sBack[0] * rmo[ij]! + sBack[1] * rmd[ij]! + sBack[2] * rev[ij]! + sBack[3] * rni[ij]!) / 60
          busOut += (sOut[0] * bmo[ij]! + sOut[1] * bmd[ij]! + sOut[2] * bev[ij]! + sOut[3] * bni[ij]!) / 60
          busBack += (sBack[0] * rbmo[ij]! + sBack[1] * rbmd[ij]! + sBack[2] * rbev[ij]! + sBack[3] * rbni[ij]!) / 60
        }
        tOut[CAR] = carOut + TRAVEL.carEnds
        tBack[CAR] = carBack + TRAVEL.carEnds
        // A two-wheeler filters through part of the delay.
        tOut[TW] = freeMin + filter * (carOut - freeMin) + TRAVEL.twoWheelerEnds
        tBack[TW] = freeMin + filter * (carBack - freeMin) + TRAVEL.twoWheelerEnds
        tOut[AUTO] = carOut + TRAVEL.autoWait
        tBack[AUTO] = carBack + TRAVEL.autoWait
        tOut[BUSM] = busOut + walkEnds + busWait
        tBack[BUSM] = busBack + walkEnds + busWait
        onRoute = false
        if (report) {
          const tb = transit[3 * ij + 2]!
          if (tb >= 0) tOut[BUSM] = tBack[BUSM] = tb
        } else {
          money[BUSM] = busMoney
          felt[BUSM] = rw.bus * (busOut + busBack) + 2 * (ww * walkEnds + wait * busWait) + bother[BUSM]!
          // The player's bus route, where it is the better way by bus. Those its full buses leave behind take the city's.
          if (hasRoute) {
            const rFelt = 2 * routeWay[0]! + bother[BUSM]!
            const rMoney = 2 * routeWay[2]!
            if (rFelt + rMoney * perRupee * weigh[BUSM]! < felt[BUSM]! + busMoney * perRupee * weigh[BUSM]!) {
              onRoute = true
              getsRoute = boarding ? boarding.bus[routeWay[4]!]! : 1
              const g = getsRoute
              tOut[BUSM] = g * routeWay[1]! + (1 - g) * tOut[BUSM]!
              tBack[BUSM] = g * routeWay[1]! + (1 - g) * tBack[BUSM]!
              felt[BUSM] = g * rFelt + (1 - g) * felt[BUSM]!
              money[BUSM] = g * rMoney + (1 - g) * busMoney
              if (q === 0) transit[3 * ij + 2] = (tOut[BUSM]! + tBack[BUSM]!) / 2
            }
          }
        }

        // Pairs with no trips, too far apart to matter for access, are left out.
        if (tours === 0) {
          let quickest = Math.min(tOut[CAR]!, tOut[TW]!, walk, cycle)
          if (hasBus) quickest = Math.min(quickest, tOut[BUSM]!)
          if (hasMetro) quickest = Math.min(quickest, tOut[METRO]!)
          if (quickest > ramp + 10) continue
        }
        if (report) {
          for (let m = 0; m < M; m++) p[m] = shares[ij * M + m]!
        } else {
          felt[CAR] = tOut[CAR] + tBack[CAR] + bother[CAR]!
          felt[TW] = rw.twoWheeler * (tOut[TW] + tBack[TW]) + bother[TW]!
          felt[AUTO] = rw.auto * (carOut + carBack) + 2 * wait * TRAVEL.autoWait + bother[AUTO]!
          // Shares, by logit over what each traveller has to hand.
          let least = Infinity
          for (let m = 0; m < M; m++) {
            const x = felt[m]! + money[m]! * perRupee * weigh[m]! + danger[m]!
            g[m] = x
            if (x < least && (m !== BUSM || hasBus) && (m !== METRO || hasMetro) && (m !== RAIL || hasRail)) least = x
          }
          const eCar = odds(g[CAR]! - least)
          const eTw = odds(g[TW]! - least)
          const eAuto = odds(g[AUTO]! - least)
          const eBus = hasBus ? odds(g[BUSM]! - least) : 0
          const eMetro = hasMetro ? odds(g[METRO]! - least) : 0
          const eRail = hasRail ? odds(g[RAIL]! - least) : 0
          eMetroKept = eMetro
          eRailKept = eRail
          eBusKept = eBus
          const eCycle = odds(g[CYCLE]! - least)
          const eWalk = odds(g[WALK]! - least)
          const base = eAuto + eBus + eMetro + eRail + eCycle + eWalk
          const aBoth = sBoth / (base + eCar + eTw)
          const aCar = sCar / (base + eCar)
          const aTw = sTw / (base + eTw)
          const all = aBoth + aCar + aTw + sNone / base
          // Riders left behind by full trains take the other ways in each group's proportions: each group's other
          // ways grow by k.
          let gets = 1, getsRail = 1
          if (boarding) {
            if (hasMetro) gets = boarding.metro[metroWay[4]!]!
            if (hasRail) getsRail = boarding.rail[railWay[4]!]!
          }
          // In a strike the city's buses carry only their share of those who would ride them (those on the player's
          // route, where it is the better way, get on it as before), and the rest go the other ways, as those left
          // behind by full trains do.
          const limited = service < 1 && hasBus
          const room = service * BUS.spare < 1 ? service * BUS.spare : 1
          const getsBus = limited ? (onRoute ? getsRoute + (1 - getsRoute) * room : room) : 1
          const eBusOut = limited ? eBus : 0
          const kept = (d: number) => {
            const rest = d - eMetro - eRail - eBusOut
            return rest > 0 ? (d - gets * eMetro - getsRail * eRail - getsBus * eBusOut) / rest : 1
          }
          const kBoth = kept(base + eCar + eTw), kCar = kept(base + eCar), kTw = kept(base + eTw), kNone = kept(base)
          const others = aBoth * kBoth + aCar * kCar + aTw * kTw + (sNone / base) * kNone
          // Each group's share of a way open to all is e × (its a) / (its size): this sums size × share² over groups,
          // divided by e², for how firmly those who chose transit hold to it.
          held = (sBoth > 0 ? (aBoth * aBoth) / sBoth : 0) + (sCar > 0 ? (aCar * aCar) / sCar : 0) +
            (sTw > 0 ? (aTw * aTw) / sTw : 0) + sNone / (base * base)
          p[CAR] = eCar * (aBoth * kBoth + aCar * kCar)
          p[TW] = eTw * (aBoth * kBoth + aTw * kTw)
          p[AUTO] = eAuto * others
          p[BUSM] = limited ? getsBus * eBus * all : eBus * others
          p[METRO] = gets * eMetro * all
          p[RAIL] = getsRail * eRail * all
          p[CYCLE] = eCycle * others
          p[WALK] = eWalk * others
          if (q === 0) for (let m = 0; m < M; m++) shares[ij * M + m] = p[m]!
        }
        if (estimate) {
          riders(tours, sOut, sBack)
          continue
        }

        if (q === 0) {
          // Access: the jobs at j count by the share who would get there within the limit, the way they would travel.
          let reach = 0
          for (let m = 0; m < M; m++) {
            const t = tOut[m]!
            const pm = p[m]!
            if (pm === 0 || t >= ramp) continue
            reach += t <= ACCESS.minutes ? pm : (pm * (ramp - t)) / ACCESS.soft
          }
          reachAll += jobs[j]! * reach
          if (tours === 0) continue
          const lost = (carOut + carBack - 2 * freeMin) * 60
          const busInTraffic = onRoute ? p[BUSM]! * (1 - getsRoute) : p[BUSM]!
          delaySeconds += tours * (p[CAR]! + p[AUTO]! + busInTraffic + p[TW]! * filter) * lost
          let seconds = 0
          for (let m = 0; m < M; m++) {
            const x = p[m]! * (tOut[m]! + tBack[m]!) * 60
            seconds += x
            modeTrips[m]! += 2 * tours * p[m]!
            modeSeconds[m]! += tours * x
          }
          rowTrips += 2 * tours
          rowSeconds += tours * seconds
          let band = 0
          while (band < BANDS.length && km > BANDS[band]!) band++
          workBands[band]! += 2 * tours
          if (report) continue
        }

        // Trips, and their parts.
        for (let m = 0; m < M; m++) {
          const n = 2 * tours * p[m]!
          if (n === 0) continue
          trips[m]! += n
          modeKm[m]! += n * km
          const k = m * 4
          parts[k]! += (n * (tOut[m]! + tBack[m]!)) / 2
          parts[k + 1]! += (n * money[m]!) / 2
          parts[k + 2]! += (n * (felt[m]! - tOut[m]! - tBack[m]!)) / 2
          parts[k + 3]! += (n * danger[m]!) / 2
        }
        out.busFare += tours * p[BUSM]! * money[BUSM]!
        out.homeTrips[i]! += 2 * tours
        out.homeClean[i]! += 2 * tours * (p[BUSM]! + p[METRO]! + p[RAIL]! + p[CYCLE]! + p[WALK]!)
        // On foot and by cycle, for road deaths: half of each trip at each end; the walk to the bus and the trains.
        const walked = 2 * tours * (p[WALK]! * km + p[BUSM]! * walkEndsKm + (p[METRO]! + p[RAIL]!) * 2 * SAFETY.stationWalk)
        out.walkKm[i]! += walked / 2
        out.walkKm[j]! += walked / 2
        const cycled = 2 * tours * p[CYCLE]! * km
        out.cycleKm[i]! += cycled / 2
        out.cycleKm[j]! += cycled / 2
        riders(tours, sOut, sBack)
        if (same) continue
        // Vehicles onto the roads: out in the outward periods, back in the return periods.
        // Riders of the player's routes add no buses here: the route's buses run on it whatever (see index.ts).
        const onBus = onRoute ? p[BUSM]! * (1 - getsRoute) : p[BUSM]!
        const pcu = tours * (pcuCar * p[CAR]! + pcuTw * p[TW]! + pcuAuto * p[AUTO]! + pcuBus * onBus)
        vehicles += 2 * tours * (vehCar * p[CAR]! + vehTw * p[TW]! + vehAuto * p[AUTO]! + vehBus * onBus)
        pcuAll += 2 * pcu
        const a = oi * stride + j
        const b = originOfZone[j]! * stride + i
        d0[a]! += pcu * sOut[0]
        d1[a]! += pcu * sOut[1]
        d2[a]! += pcu * sOut[2]
        d3[a]! += pcu * sOut[3]
        d0[b]! += pcu * sBack[0]
        d1[b]! += pcu * sBack[1]
        d2[b]! += pcu * sBack[2]
        d3[b]! += pcu * sBack[3]
      }
    }
    access[i] = reachAll
    zoneTrips[i] = rowTrips
    zoneSeconds[i] = rowSeconds
    workTrips += rowTrips
    workSeconds += rowSeconds
  }
  out.workTrips = workTrips
  out.workSeconds = workSeconds
  out.delaySeconds = delaySeconds
  out.vehicles = vehicles
  out.pcu = pcuAll
  return out
}

/** Adds round trips between a pair of places to the riders an hour at the morning and evening peaks, each way. */
function atPeak(hour: [Float64Array, Float64Array], places: number, ab: number, tours: number, sOut: readonly number[], sBack: readonly number[]) {
  const a = Math.floor(ab / places)
  const b = ab - a * places
  const ba = b * places + a
  const [m, e] = hour
  m[ab]! += (tours * sOut[0]!) / HOURS.morning
  m[ba]! += (tours * sBack[0]!) / HOURS.morning
  e[ab]! += (tours * sOut[2]!) / HOURS.evening
  e[ba]! += (tours * sBack[2]!) / HOURS.evening
}

/** A square table of side n, turned so that its rows become columns, a block at a time. */
function transpose(a: Float32Array, n: number): Float32Array {
  const out = new Float32Array(n * n)
  for (let i0 = 0; i0 < n; i0 += 16) {
    for (let j0 = 0; j0 < n; j0 += 16) {
      for (let i = i0; i < Math.min(i0 + 16, n); i++) {
        for (let j = j0; j < Math.min(j0 + 16, n); j++) out[j * n + i] = a[i * n + j]!
      }
    }
  }
  return out
}
