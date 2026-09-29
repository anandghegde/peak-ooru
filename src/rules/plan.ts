import type { LngLat, Station, TransitLine } from '../data/types'
import { busSegments } from '../sim/bus'
import { costIndex } from './money'
import { east, type Entry, latOf, lngOf, metres, micro, nearestNode, nearestOnLink, north, roadIndex, type RoadIndex, shortest } from './geo'
import type { RoutingNetwork } from '../sim/types'
import { builtOf, cycleMinutes, lineLength } from './lines'
import { BUS_LANE, BUS_ROUTE, METRO, RAIL_SERVICE, ROAD, RUNNING, RUN_DAYS } from './params'
import { densityQuote, footpathQuote, isShut, junctionQuote, limitQuote, networkOf, oneWayQuote, onRoadsOf, roadQuote, snapRoad } from './roads'
import type { CityData, Game, Lakh, Plan, Quote, Stop } from './types'
import { makeGoodCost, repairProblem, repairQuote, streetsQuote } from './upkeep'

/*
 * Planning (PRD UI-7a, UI-7b): a plan is the places the player tapped, kept as given. Each is snapped to the roads,
 * and the line is laid between them, the same way every time from the same city. Nothing here changes the game.
 */

const whole = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && Math.abs(x) <= 1e9
const isLngLat = (a: unknown): a is LngLat =>
  Array.isArray(a) && a.length === 2 && a.every((v) => typeof v === 'number' && Number.isFinite(v)) &&
  a[0] >= 76 && a[0] <= 79 && a[1] >= 11.5 && a[1] <= 14.5

/** A place on a line once snapped: where, how it joins the roads, and the station it is, if one is there. */
interface Placed {
  x: number
  y: number
  existing?: number
  /** Ways onto the roads, in metres (metro) or tenths of a second (bus). */
  entries: Entry[]
  /** The node it stands on, if it stands on one. */
  node?: number
  /** A road it stands on part-way along. */
  link?: number
  /** Tapped by the player, rather than put in between. */
  tapped: boolean
  /** Which of the plan's places it came from, if tapped. */
  stop?: number
}

const refuse = (reason: string, major = false): Quote => ({
  ok: false, reason, cost: 0, months: 0, running: 0, length: 0, stations: [], path: [], disrupted: [], major,
})

/**
 * Metres within which a tap finds a station that is there; a junction or a straight road (the tap moves to it, and
 * the quote shows where); a junction where a bus may stop; a road for a station off the roads.
 */
const REACH = { station: 300, node: 2000, link: 2000, busNode: 2000, stationRoad: 800 }

/** Checks the shape of a plan, which comes from outside and is not trusted. */
export function planProblem(plan: unknown): string | null {
  const p = plan as Plan
  if (!p || typeof p !== 'object') return 'That is not a plan.'
  if ((p.kind === 'metro' || p.kind === 'road' || p.kind === 'junction') && p.makeGood !== undefined && typeof p.makeGood !== 'boolean') {
    return 'Say whether to make good the roads dug up.'
  }
  switch (p.kind) {
    case 'metro':
    case 'busRoute':
    case 'road':
      if (!Array.isArray(p.stops) || p.stops.length < 2) return 'Choose at least two places.'
      if (p.stops.length > (p.kind === 'road' ? ROAD.most : 40)) return `Choose at most ${p.kind === 'road' ? ROAD.most : 40} places.`
      for (const s of p.stops as unknown[]) {
        const stop = s as Stop
        if (!stop || typeof stop !== 'object') return 'A place on the line is not a proper one.'
        if ('station' in stop ? !whole(stop.station) : !('at' in stop) || !isLngLat(stop.at)) {
          return 'A place on the line is not a proper one.'
        }
      }
      if (p.kind === 'busRoute' && (!whole(p.buses) || p.buses < BUS_ROUTE.fewest || p.buses > BUS_ROUTE.most)) {
        return `A bus route runs ${BUS_ROUTE.fewest} to ${BUS_ROUTE.most} buses.`
      }
      if (p.kind === 'road') {
        if (p.lanes !== 1 && p.lanes !== 2 && p.lanes !== 3) return 'A road has 1, 2 or 3 lanes each way.'
        if (typeof p.flyover !== 'boolean') return 'Say whether it is a flyover.'
      }
      return null
    case 'busLane':
      if (!Array.isArray(p.links) || p.links.length < 1) return 'Choose at least one stretch of road.'
      if (p.links.length > 500) return 'Choose at most 500 stretches of road at once.'
      if (!p.links.every(whole)) return 'A stretch of road is not a proper one.'
      if (new Set(p.links).size !== p.links.length) return 'A stretch of road is chosen twice.'
      return null
    case 'railService':
      if (typeof p.line !== 'string') return 'Choose a suburban line.'
      if (!whole(p.trains) || p.trains < 1 || p.trains > RAIL_SERVICE.perOrder) {
        return `Order 1 to ${RAIL_SERVICE.perOrder} trains at a time.`
      }
      return null
    case 'junction':
      if (!whole(p.node)) return 'Choose a junction.'
      if (p.work !== 'signal' && p.work !== 'redesign' && p.work !== 'overpass') return 'Choose signals, a redesign or an overpass.'
      return null
    case 'footpaths':
      return whole(p.zone) ? null : 'Choose a zone.'
    case 'speedLimit':
      if (!whole(p.zone)) return 'Choose a zone.'
      return p.limit === null || whole(p.limit) ? null : 'A speed limit is a whole number of km/h, or none.'
    case 'oneWay':
      if (!whole(p.link)) return 'Choose a stretch of road.'
      return typeof p.on === 'boolean' ? null : 'Say whether to make it one-way or two-way.'
    case 'density':
      if (!whole(p.zone)) return 'Choose a zone.'
      return typeof p.on === 'boolean' ? null : 'Say whether to allow taller building or not.'
    case 'repair':
    case 'streets':
      return repairProblem(p)
    default:
      return 'That is not something the city can build.'
  }
}

/** A clean copy of a plan, with nothing that rode along with it. */
export function cleanPlan(plan: Plan): Plan {
  const stops = (s: Stop[]) => s.map((t): Stop => ('station' in t ? { station: t.station } : { at: [t.at[0], t.at[1]] }))
  switch (plan.kind) {
    case 'metro':
      return { kind: 'metro', stops: stops(plan.stops), ...(plan.makeGood ? { makeGood: true } : {}) }
    case 'busRoute':
      return { kind: 'busRoute', stops: stops(plan.stops), buses: plan.buses }
    case 'busLane':
      return { kind: 'busLane', links: [...plan.links] }
    case 'railService':
      return { kind: 'railService', line: plan.line, trains: plan.trains }
    case 'road':
      return { kind: 'road', stops: stops(plan.stops), lanes: plan.lanes, flyover: plan.flyover, ...(plan.makeGood ? { makeGood: true } : {}) }
    case 'junction':
      return { kind: 'junction', node: plan.node, work: plan.work, ...(plan.makeGood ? { makeGood: true } : {}) }
    case 'footpaths':
      return { kind: 'footpaths', zone: plan.zone }
    case 'oneWay':
      return { kind: 'oneWay', link: plan.link, on: plan.on }
    case 'speedLimit':
      return { kind: 'speedLimit', zone: plan.zone, limit: plan.limit }
    case 'density':
      return { kind: 'density', zone: plan.zone, on: plan.on }
    case 'repair':
      return { kind: 'repair', links: [...plan.links], work: plan.work }
    case 'streets':
      return { kind: 'streets', zone: plan.zone, work: plan.work }
  }
}

/** Kinds of plan that are major actions whatever their size. */
const MAJOR = new Set(['metro', 'railService', 'road'])

export function quote(game: Game, city: CityData, plan: Plan): Quote {
  const problem = planProblem(plan)
  if (problem) {
    const p = plan as Plan
    return refuse(problem, MAJOR.has(p?.kind) || (p?.kind === 'junction' && p.work === 'overpass') || (p?.kind === 'density' && p.on === true) ||
      (p?.kind === 'repair' && p.work === 'concrete'))
  }
  const q = quoteOf(game, city, plan)
  // Making good the roads a work digs up (slice 6, PRD UPK-12): resurfacing them as the work hands them back.
  if (q.ok && 'makeGood' in plan && plan.makeGood && q.disrupted.length) {
    const extra = makeGoodCost(game, city, roadsNow(game, city), q.disrupted)
    return { ...q, cost: q.cost + extra, makeGood: extra }
  }
  return q
}

function quoteOf(game: Game, city: CityData, plan: Plan): Quote {
  const roads = roadsNow(game, city)
  switch (plan.kind) {
    case 'metro':
      return metro(game, city, roads, plan.stops)
    case 'busRoute':
      return busRoute(game, city, roads, plan.stops, plan.buses)
    case 'busLane':
      return busLane(game, roads, plan.links)
    case 'railService':
      return railService(game, city, plan.line, plan.trains)
    case 'road':
      return roadQuote(game, city, roads, plan)
    case 'junction':
      return junctionQuote(game, city, roads, plan.node, plan.work)
    case 'footpaths':
      return footpathQuote(game, city, roads, plan.zone)
    case 'speedLimit':
      return limitQuote(game, city, roads, plan.zone, plan.limit)
    case 'oneWay':
      return oneWayQuote(game, city, roads, plan.link, plan.on)
    case 'density':
      return densityQuote(game, city, plan.zone, plan.on)
    case 'repair':
      return repairQuote(game, city, roads, plan)
    case 'streets':
      return streetsQuote(game, city, plan)
  }
}

/** The roads as they stand, with what the player has built and set on them. */
export const roadsNow = (game: Game, city: CityData): RoutingNetwork => networkOf(city, onRoadsOf(builtOf(game)))

/** Stations of a system that a plan may join: the city's (open or being built) and the player's. */
function stationsOf(game: Game, city: CityData, kind: Station['kind'] | null): Station[] {
  const all = [...city.transit.stations, ...builtOf(game).stations]
  return kind ? all.filter((s) => s.kind === kind) : all
}

const sx = (s: Station) => east(micro(s.at[0]))
const sy = (s: Station) => north(micro(s.at[1]))

/** The money a plan costs to build at this month's prices. */
const priced = (game: Game, lakh: number): Lakh => Math.round((lakh * costIndex(game.month)) / 10_000)

// ------------------------------------------------------------------------------------------------ metro lines

function placeMetro(ix: RoadIndex, stations: Station[], stop: Stop): Placed | string {
  if ('station' in stop) {
    const s = stations.find((t) => t.id === stop.station)
    if (!s) return 'There is no such metro station.'
    return atStation(ix, s, true)
  }
  const px = east(micro(stop.at[0]))
  const py = north(micro(stop.at[1]))
  let near: Station | null = null
  let nearD = REACH.station + 1
  for (const s of stations) {
    const d = metres(px, py, sx(s), sy(s))
    if (d < nearD || (d === nearD && near && s.id < near.id)) {
      near = s
      nearD = d
    }
  }
  if (near) return atStation(ix, near, true)
  const node = nearestNode(ix, px, py, REACH.node)
  const onLink = nearestOnLink(ix, px, py, REACH.link)
  if (onLink && (node.node < 0 || onLink.metres + 150 < node.metres)) {
    const link = ix.roads.links[onLink.link]!
    if (onLink.fromEnd === 0) return atNode(ix, link.from)
    if (onLink.toEnd === 0) return atNode(ix, link.to)
    return { x: onLink.x, y: onLink.y, entries: [[link.from, onLink.fromEnd], [link.to, onLink.toEnd]], link: link.id, tapped: true }
  }
  if (node.node >= 0) return atNode(ix, node.node)
  return 'There is no main road within 2 km of that place. Choose a place nearer the roads.'
}

const atNode = (ix: RoadIndex, node: number): Placed => ({ x: ix.x[node]!, y: ix.y[node]!, entries: [[node, 0]], node, tapped: true })

function atStation(ix: RoadIndex, s: Station, tapped: boolean): Placed {
  const x = sx(s)
  const y = sy(s)
  const node = nearestNode(ix, x, y, REACH.stationRoad)
  return { x, y, existing: s.id, entries: node.node >= 0 ? [[node.node, node.metres]] : [], tapped }
}

interface Leg {
  /** Places along the leg after its start, with their metres from it; stations among them are marked. */
  points: { x: number; y: number; at: number; node?: number }[]
  metres: number
  tunnel: boolean
  links: number[]
}

/** Lays a metro line between two stops: along the roads where they lead the right way, otherwise straight. */
function legBetween(ix: RoadIndex, a: Placed, b: Placed): Leg {
  const straight = metres(a.x, a.y, b.x, b.y)
  const most = Math.round((straight * METRO.detour) / 1000) + METRO.slack
  const road = a.entries.length && b.entries.length
    ? shortest(ix, a.entries, b.entries, (l) => ix.roads.links[l]!.length, true, most)
    : null
  if (road) {
    const points: Leg['points'] = []
    let at = 0
    let px = a.x
    let py = a.y
    const add = (x: number, y: number, node?: number) => {
      const d = metres(px, py, x, y)
      if (d === 0 && points.length) return
      at += d
      points.push({ x, y, at, node })
      px = x
      py = y
    }
    for (const node of road.nodes) add(ix.x[node]!, ix.y[node]!, node)
    add(b.x, b.y)
    const links = new Set<number>()
    const both = (u: number, v: number) => {
      const n = ix.roads.nodes.length
      const f = ix.between.get(u * n + v)
      const r = ix.between.get(v * n + u)
      if (f !== undefined) links.add(f)
      if (r !== undefined) links.add(r)
    }
    for (let i = 1; i < road.nodes.length; i++) both(road.nodes[i - 1]!, road.nodes[i]!)
    for (const p of [a, b]) {
      if (p.link === undefined) continue
      const l = ix.roads.links[p.link]!
      both(l.from, l.to)
    }
    return { points, metres: at, tunnel: false, links: [...links].sort((x, y) => x - y) }
  }
  return { points: [{ x: b.x, y: b.y, at: straight }], metres: straight, tunnel: true, links: [] }
}

function metro(game: Game, city: CityData, roads: RoutingNetwork, stops: Stop[]): Quote {
  const ix = roadIndex(roads)
  const stations = stationsOf(game, city, 'metro')
  const placed: Placed[] = []
  for (const [k, stop] of stops.entries()) {
    const p = placeMetro(ix, stations, stop)
    if (typeof p === 'string') return refuse(p, true)
    placed.push({ ...p, stop: k })
  }
  for (let i = 1; i < placed.length; i++) {
    const d = metres(placed[i - 1]!.x, placed[i - 1]!.y, placed[i]!.x, placed[i]!.y)
    if (d < METRO.apart) {
      return refuse(`Stations must be at least ${METRO.apart} m apart. Two of the places chosen are ${d} m apart.`, true)
    }
  }

  // The line, leg by leg, with stations put in between those tapped where they are far apart.
  const line: Placed[] = [placed[0]!]
  const path: { x: number; y: number }[] = [{ x: placed[0]!.x, y: placed[0]!.y }]
  let viaduct = 0
  let tunnel = 0
  const disrupted = new Set<number>()
  for (let i = 1; i < placed.length; i++) {
    const a = placed[i - 1]!
    const b = placed[i]!
    const leg = legBetween(ix, a, b)
    const between = Math.max(0, Math.round(leg.metres / METRO.every) - 1)
    if (leg.tunnel) {
      // Stations at the junctions nearest evenly spaced spots; the tunnel bends through them.
      let prev = a
      for (let j = 1; j <= between; j++) {
        const tx = a.x + Math.round(((b.x - a.x) * j) / (between + 1))
        const ty = a.y + Math.round(((b.y - a.y) * j) / (between + 1))
        const mid = midStation(ix, stations, tx, ty, prev, b)
        if (!mid) continue
        tunnel += metres(prev.x, prev.y, mid.x, mid.y)
        line.push(mid)
        path.push({ x: mid.x, y: mid.y })
        prev = mid
      }
      tunnel += metres(prev.x, prev.y, b.x, b.y)
      path.push({ x: b.x, y: b.y })
    } else {
      viaduct += leg.metres
      for (const l of leg.links) disrupted.add(l)
      // Stations at the junctions along the way nearest evenly spaced spots.
      let lastAt = 0
      for (let j = 1; j <= between; j++) {
        const target = Math.round((leg.metres * j) / (between + 1))
        let best: Leg['points'][number] | null = null
        for (const p of leg.points) {
          if (p.node === undefined || p.at - lastAt < METRO.apart || leg.metres - p.at < METRO.apart) continue
          if (!best || Math.abs(p.at - target) < Math.abs(best.at - target)) best = p
        }
        if (!best || Math.abs(best.at - target) > METRO.every / 2) continue
        line.push(stationOrNode(ix, stations, best.node!))
        lastAt = best.at
      }
      for (const p of leg.points) path.push({ x: p.x, y: p.y })
    }
    line.push(b)
  }
  // A station put in between that came too near a neighbour (an interchange found nearby) is left out.
  for (let k = line.length - 2; k > 0; k--) {
    const s = line[k]!
    if (s.tapped) continue
    const prev = line[k - 1]!
    const next = line[k + 1]!
    if (metres(s.x, s.y, prev.x, prev.y) < METRO.apart || metres(s.x, s.y, next.x, next.y) < METRO.apart) line.splice(k, 1)
  }

  const tappedStations = new Set(placed.flatMap((p) => (p.existing === undefined ? [] : [p.existing])))
  if (tappedStations.size < placed.filter((p) => p.existing !== undefined).length) {
    return refuse('The line passes the same station twice.', true)
  }
  const seen = new Set<number>()
  for (let k = 0; k < line.length; k++) {
    const s = line[k]!
    if (s.existing === undefined) continue
    if (seen.has(s.existing) || (!s.tapped && tappedStations.has(s.existing))) line.splice(k--, 1)
    else seen.add(s.existing)
  }
  const length = viaduct + tunnel
  if (length < METRO.shortest) return refuse(`A metro line must be at least ${km(METRO.shortest)} long.`, true)
  if (length > METRO.longest) return refuse(`A metro line may be at most ${km(METRO.longest)} long. Build it in parts.`, true)

  const cost = priced(game, Math.round((Math.round((viaduct * METRO.viaductKm + tunnel * METRO.tunnelKm) / 1000) * METRO.share) / 10_000))
  const months = Math.max(METRO.least, Math.min(METRO.most, METRO.base + Math.round(viaduct / METRO.viaductPerMonth) + Math.round(tunnel / METRO.tunnelPerMonth)))
  const trains = trainsAtOpening(length)
  return {
    ok: true,
    cost,
    months,
    running: metroRunning(game, length, trains),
    length,
    stations: named(game, city, line, 'metro'),
    path: path.flatMap((p) => [lngOf(p.x) / 1e6, latOf(p.y) / 1e6]),
    disrupted: [...disrupted].sort((a, b) => a - b),
    major: true,
  }
}

/** A station put in a tunnel: at the junction nearest the spot, if it is far enough from its neighbours. */
function midStation(ix: RoadIndex, stations: Station[], tx: number, ty: number, prev: Placed, next: Placed): Placed | null {
  const near = nearestNode(ix, tx, ty, 600)
  if (near.node < 0) return null
  const p = stationOrNode(ix, stations, near.node, false)
  if (metres(p.x, p.y, prev.x, prev.y) < METRO.apart || metres(p.x, p.y, next.x, next.y) < METRO.apart) return null
  return p
}

/** A station at a junction, or the station that is there already, within 300 m, for an interchange. */
function stationOrNode(ix: RoadIndex, stations: Station[], node: number, tapped = false): Placed {
  const x = ix.x[node]!
  const y = ix.y[node]!
  for (const s of stations) if (metres(x, y, sx(s), sy(s)) <= REACH.station) return atStation(ix, s, tapped)
  return { x, y, entries: [[node, 0]], node, tapped }
}

/** Trains a new line starts with: enough for a train every five minutes at the peak. */
export function trainsAtOpening(lengthM: number): number {
  return Math.ceil(cycleMinutes(lengthM, 'metro') / METRO.headway)
}

/** Trains each way a day on a line of `vehicles` trains: 18 hours at one and a half times the peak headway. */
export function trainsEachWay(lengthM: number, kind: 'metro' | 'rail', vehicles: number): number {
  return Math.round((720 * vehicles) / cycleMinutes(lengthM, kind))
}

/** Running a metro line of `trains` trains for a month, in lakh, at this month's prices. */
export function metroRunning(game: Game, lengthM: number, trains: number): Lakh {
  const each = trainsEachWay(lengthM, 'metro', trains)
  return priced(game, Math.round((lengthM * 2 * each * RUN_DAYS * RUNNING.metroTrainKm) / 100_000_000))
}

const km = (m: number) => `${Math.round(m / 100) / 10} km`

// ------------------------------------------------------------------------------------------------ bus routes

function placeBus(ix: RoadIndex, stations: Station[], stop: Stop): { node: number; name?: Station } | string {
  let x: number
  let y: number
  let name: Station | undefined
  if ('station' in stop) {
    const s = stations.find((t) => t.id === stop.station)
    if (!s) return 'There is no such station.'
    x = sx(s)
    y = sy(s)
    name = s
  } else {
    x = east(micro(stop.at[0]))
    y = north(micro(stop.at[1]))
  }
  // A bus stops where side streets meet a main road: not on an expressway, nor where a road leaves the map.
  const ok = (n: number) => ix.street[n] === 1 && !ix.roads.nodes[n]!.gateway
  const near = nearestNode(ix, x, y, REACH.busNode, ok)
  if (near.node < 0) return 'There is no road a bus can stop on within 2 km of that place. Choose a place nearer the roads.'
  return { node: near.node, name }
}

function busRoute(game: Game, city: CityData, roads: RoutingNetwork, stops: Stop[], buses: number): Quote {
  const ix = roadIndex(roads)
  const stations = stationsOf(game, city, null)
  const calls: { node: number; name?: Station; stop: number }[] = []
  for (const [k, stop] of stops.entries()) {
    const p = placeBus(ix, stations, stop)
    if (typeof p === 'string') return refuse(p)
    if (calls.at(-1)?.node !== p.node) calls.push({ ...p, stop: k })
  }
  if (calls.length < 2) return refuse('Those places are at the same junction. Choose places further apart.')
  // The route as the model runs it: from stop to stop by the quickest way at free speed (src/sim/bus.ts).
  const at = (node: number): LngLat => [roads.nodes[node]!.at[0] / 1e6, roads.nodes[node]!.at[1] / 1e6]
  const temp: Station[] = calls.map((c, k) => ({ id: k, name: '', nameKn: null, at: at(c.node), kind: 'bus' }))
  const line: TransitLine = { id: 'plan', name: '', kind: 'bus', colour: '', status: 'open', stations: temp.map((t) => t.id), path: [] }
  const segments = busSegments(roads, line, new Map(temp.map((t) => [t.id, t])))
  if (segments.some((seg) => !seg.length)) return refuse('No road leads from one of the places chosen to the next.')
  const nodes = [calls[0]!.node]
  let length = 0
  for (const seg of segments) {
    for (const id of seg) {
      const link = roads.links[id]!
      nodes.push(link.to)
      length += link.length
    }
  }
  if (length < BUS_ROUTE.shortest) return refuse(`A bus route must be at least ${km(BUS_ROUTE.shortest)} long.`)
  if (length > BUS_ROUTE.longest) return refuse(`A bus route may be at most ${km(BUS_ROUTE.longest)} long.`)
  // The stops are where the player chose; the buses pick up about every kilometre between (as the model has it),
  // and each of those stops is paid for.
  const placed: Placed[] = calls.map((c) => ({ x: ix.x[c.node]!, y: ix.y[c.node]!, entries: [], node: c.node, tapped: true, stop: c.stop }))
  const shelters = Math.max(calls.length, Math.round(length / BUS_ROUTE.every) + 1)
  const names = named(game, city, placed, 'bus').map((st, k) => {
    const s = calls[k]!.name
    return s ? { ...st, name: s.name, nameKn: s.nameKn } : st
  })
  return {
    ok: true,
    cost: priced(game, buses * BUS_ROUTE.bus + shelters * BUS_ROUTE.stop),
    months: BUS_ROUTE.months,
    running: busRunning(game, buses),
    length,
    stations: names.map((st, k) => ({ ...st, at: at(calls[k]!.node) })),
    path: nodes.flatMap((n) => at(n)),
    disrupted: [],
    major: false,
  }
}

/** Running a route's buses for a month, in lakh, at this month's prices. */
export function busRunning(game: Game, buses: number): Lakh {
  return priced(game, Math.round((buses * BUS_ROUTE.kmPerDay * RUN_DAYS * RUNNING.busKm) / 100_000))
}

// ------------------------------------------------------------------------------------------------ bus lanes

function busLane(game: Game, roads: RoutingNetwork, links: number[]): Quote {
  const built = builtOf(game)
  const taken = new Set([...built.busLanes, ...(game.projects ?? []).flatMap((p) => (p.plan.kind === 'busLane' ? p.plan.links : []))])
  let length = 0
  const path: number[] = []
  for (const id of links) {
    const link = roads.links[id]
    if (!link) return refuse('One of the stretches chosen is not a main road.')
    if (isShut(link)) return refuse('One of the stretches chosen is shut: the road is one-way the other way.')
    if (link.lanes < 2) return refuse('A bus lane needs a road with at least two lanes each way. One of the stretches chosen has one.')
    if (taken.has(id)) return refuse('One of the stretches chosen has a bus lane already, or one is being made.')
    length += link.length
    const a = roads.nodes[link.from]!.at
    const b = roads.nodes[link.to]!.at
    path.push(a[0] / 1e6, a[1] / 1e6, b[0] / 1e6, b[1] / 1e6)
  }
  const major = length > BUS_LANE.major
  return {
    ok: true,
    cost: priced(game, Math.round((length * BUS_LANE.km) / 1000)),
    months: length > BUS_LANE.long ? BUS_LANE.longMonths : BUS_LANE.months,
    running: priced(game, Math.round((length * BUS_LANE.upkeepKm) / 1000)),
    length,
    stations: [],
    path,
    disrupted: [],
    major,
  }
}

// ------------------------------------------------------------------------------------------------ suburban trains

/** Trains the player has added to a suburban line, open and ordered. */
export function railAdded(game: Game, line: string): number {
  const open = builtOf(game).vehicles[line] ?? 0
  const ordered = (game.projects ?? []).reduce((n, p) => n + (p.plan.kind === 'railService' && p.plan.line === line ? p.plan.trains : 0), 0)
  return open + ordered
}

function railService(game: Game, city: CityData, lineId: string, trains: number): Quote {
  const line = city.transit.lines.find((l) => l.id === lineId && l.kind === 'rail' && l.status === 'open')
  if (!line) return refuse('There is no such suburban line.', true)
  const added = railAdded(game, lineId)
  if (added + trains > RAIL_SERVICE.most) {
    return refuse(`A suburban line can take at most ${RAIL_SERVICE.most} more trains. This one has ${added} more already.`, true)
  }
  const length = lineLength(line)
  const byId = new Map(city.transit.stations.map((s) => [s.id, s]))
  return {
    ok: true,
    cost: priced(game, RAIL_SERVICE.works + trains * RAIL_SERVICE.train),
    months: RAIL_SERVICE.months,
    running: railRunning(game, length, trains),
    length,
    stations: line.stations.map((id) => {
      const s = byId.get(id)!
      return { at: s.at, name: s.name, nameKn: s.nameKn, existing: id }
    }),
    path: line.path,
    disrupted: [],
    major: true,
  }
}

/** Running `trains` more trains on a suburban line for a month, in lakh, at this month's prices. */
export function railRunning(game: Game, lengthM: number, trains: number): Lakh {
  return priced(game, Math.round((lengthM * 2 * trains * RAIL_SERVICE.trips * RUN_DAYS * RUNNING.railTrainKm) / 100_000_000))
}

// ------------------------------------------------------------------------------------------------ names

/** Metres within which a nearby zone may lend a new station its name. */
const NAME_REACH = 1500

const DIRECTIONS = [
  { en: 'North', kn: 'ಉತ್ತರ' },
  { en: 'South', kn: 'ದಕ್ಷಿಣ' },
  { en: 'East', kn: 'ಪೂರ್ವ' },
  { en: 'West', kn: 'ಪಶ್ಚಿಮ' },
]

const zoneSpots = new WeakMap<object, { x: Int32Array; y: Int32Array }>()
/** Zones by the distance of their centres from a place, nearest first, those within `reach` m (at least one). */
function zonesNear(city: CityData, x: number, y: number, reach: number) {
  let spots = zoneSpots.get(city.zones)
  if (!spots) {
    spots = {
      x: Int32Array.from(city.zones, (z) => east(micro(z.centre[0]))),
      y: Int32Array.from(city.zones, (z) => north(micro(z.centre[1]))),
    }
    zoneSpots.set(city.zones, spots)
  }
  const s = spots
  const all = city.zones.map((zone, k) => ({ zone, dx: x - s.x[k]!, dy: y - s.y[k]!, d: metres(x, y, s.x[k]!, s.y[k]!) }))
  all.sort((a, b) => a.d - b.d || a.zone.id - b.zone.id)
  return all.filter((z, k) => k === 0 || z.d <= reach)
}

/**
 * Names for the stations of a plan: a station that is there keeps its name; a new one takes the nearest zone's, in
 * English and Kannada, with North, South, East or West where two would share a name (among the metro's stations for
 * a metro line, along the route for a bus route), and a number after that.
 */
function named(game: Game, city: CityData, line: Placed[], kind: 'metro' | 'bus'): Quote['stations'] {
  const all = stationsOf(game, city, null)
  const byId = new Map(all.map((s) => [s.id, s]))
  const used = new Set<string>()
  if (kind === 'metro') {
    for (const s of all) if (s.kind === 'metro') used.add(s.name.toLowerCase())
    for (const p of game.projects ?? []) {
      if (p.plan.kind === 'metro') for (const s of p.quote.stations) used.add(s.name.toLowerCase())
    }
  }
  for (const p of line) if (p.existing !== undefined) used.add(byId.get(p.existing)!.name.toLowerCase())
  const withStop = (q: Quote['stations'][number], p: Placed) => (p.stop === undefined ? q : { ...q, stop: p.stop })
  return line.map((p) => {
    const at: LngLat = [lngOf(p.x) / 1e6, latOf(p.y) / 1e6]
    if (p.existing !== undefined) {
      const s = byId.get(p.existing)!
      return withStop({ at: s.at, name: s.name, nameKn: s.nameKn, existing: s.id }, p)
    }
    const near = zonesNear(city, p.x, p.y, NAME_REACH)
    // The nearest zone's name, or the next nearest's that is free, within reach; else the nearest's with a direction.
    const free = near.find((z) => !used.has(z.zone.name.toLowerCase()))
    const { zone, dx, dy } = free ?? near[0]!
    let name = zone.name
    let nameKn = zone.nameKn
    if (used.has(name.toLowerCase())) {
      const d = Math.abs(dx) > Math.abs(dy) ? DIRECTIONS[dx > 0 ? 2 : 3]! : DIRECTIONS[dy > 0 ? 0 : 1]!
      name = `${zone.name} ${d.en}`
      nameKn = zone.nameKn ? `${zone.nameKn} ${d.kn}` : null
      for (let k = 2; used.has(name.toLowerCase()); k++) {
        name = `${zone.name} ${k}`
        nameKn = zone.nameKn ? `${zone.nameKn} ${k}` : null
      }
    }
    used.add(name.toLowerCase())
    return withStop({ at, name, nameKn }, p)
  })
}

/**
 * Where one place would go as a stop of a line of this kind, before there is a line: the station that is there, or
 * the junction or road it snaps to, named as it would be. For the screen to show a first tap at once.
 */
export function snap(game: Game, city: CityData, kind: 'metro' | 'busRoute' | 'road', stop: Stop): Quote['stations'][number] | { reason: string } {
  const problem = planProblem({ kind, stops: [stop, stop], buses: 1, lanes: 1, flyover: false })
  if (problem) return { reason: problem }
  const roads = roadsNow(game, city)
  if (kind === 'road') return snapRoad(game, city, roads, stop)
  const ix = roadIndex(roads)
  if (kind === 'metro') {
    const p = placeMetro(ix, stationsOf(game, city, 'metro'), stop)
    if (typeof p === 'string') return { reason: p }
    return named(game, city, [{ ...p, stop: 0 }], 'metro')[0]!
  }
  const c = placeBus(ix, stationsOf(game, city, null), stop)
  if (typeof c === 'string') return { reason: c }
  const at: LngLat = [roads.nodes[c.node]!.at[0] / 1e6, roads.nodes[c.node]!.at[1] / 1e6]
  const st = named(game, city, [{ x: ix.x[c.node]!, y: ix.y[c.node]!, entries: [], node: c.node, tapped: true, stop: 0 }], 'bus')[0]!
  return { ...st, at, ...(c.name ? { name: c.name.name, nameKn: c.name.nameKn } : {}) }
}

