import type { Zone } from '../data/types'
import type { RoutingLink, RoutingNetwork, RoutingNode } from '../sim/types'
import { costIndex } from './money'
import { east, latOf, lngOf, metres, micro, nearestNode, north, roadIndex, type RoadIndex } from './geo'
import { builtOf } from './lines'
import { DENSITY, FOOTPATHS, JUNCTION, LIMITS, ONE_WAY, ROAD, UPKEEP } from './params'
import type { Built, CityData, Game, Lakh, Plan, Quote, Setup, Stop } from './types'

/*
 * Roads (slice 5): the network the model is given, made from the city's and what the player has built and set on it,
 * and the planning of roads, flyovers, junction work, footpaths, one-way streets, speed limits and taller building.
 *
 * New links are appended after the city's, in the order the roads opened, so that no id the game has kept (bus lanes,
 * one-way streets, works) ever moves. A new road joins the network only at junctions that are there already: each
 * place tapped snaps to the nearest, and a road on the ground meets a road it crosses at that road's nearer junction.
 * So no link is ever split, and nothing that refers to one has to follow it (at a median link of 480 m the road bends
 * at most a couple of hundred metres to meet a junction). A link made one-way keeps its lanes and capacity in the
 * direction left open and adds its opposite's; the opposite is shut by making it run from its start to its start, a
 * link that no route can use and that carries nothing, which the model takes as it is.
 */

export type OnRoads = NonNullable<Setup['onRoads']>
type Work = 'signal' | 'redesign' | 'overpass'
type RoadPlan = Extract<Plan, { kind: 'road' }>

const whole = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && Math.abs(x) <= 1e9
const refuse = (reason: string, major = false): Quote => ({
  ok: false, reason, cost: 0, months: 0, running: 0, length: 0, stations: [], path: [], disrupted: [], major,
})
/** The money a plan costs to build at this month's prices. */
const priced = (game: Game, lakh: number): Lakh => Math.round((lakh * costIndex(game.month)) / 10_000)
const km = (m: number) => `${Math.round(m / 100) / 10} km`

/** What the player has built and set on the roads, as the model's network is made from it. */
export function onRoadsOf(built: Built): OnRoads {
  return {
    roads: built.roads ?? [],
    junctions: built.junctions ?? [],
    footpaths: built.footpaths ?? [],
    limits: built.limits ?? [],
    oneWay: built.oneWay ?? [],
  }
}

/** A shut link: one the network keeps for its id, running from its start back to its start. */
export const isShut = (l: RoutingLink) => l.from === l.to

// ------------------------------------------------------------------------------------------------ the network

const made = new WeakMap<RoutingNetwork, Map<string, RoutingNetwork>>()

/**
 * The city's routing network with what the player has built and set on it: new roads appended, junctions worked on,
 * roads narrowed a little for footpaths, one-way streets. The same object for the same roads, kept for the last few,
 * so that the model and planning find their indexes ready.
 */
export function networkOf(city: CityData, on: OnRoads | undefined): RoutingNetwork {
  if (!on || (!on.roads?.length && !on.junctions?.length && !on.footpaths?.length && !on.oneWay?.length)) return city.roads
  const key = JSON.stringify([(on.roads ?? []).map((r) => [r.nodes, r.lanes, r.flyover]), on.junctions ?? [], on.footpaths ?? [], on.oneWay ?? []])
  let kept = made.get(city.roads)
  if (!kept) made.set(city.roads, (kept = new Map()))
  const found = kept.get(key)
  if (found) {
    kept.delete(key)
    kept.set(key, found)
    return found
  }
  const net = build(city, on)
  kept.set(key, net)
  if (kept.size > 8) kept.delete(kept.keys().next().value!)
  return net
}

function build(city: CityData, on: OnRoads): RoutingNetwork {
  const base = city.roads
  const ix = roadIndex(base)
  const nodes: RoutingNode[] = base.nodes.map((n) => ({ ...n }))
  const links: RoutingLink[] = base.links.map((l) => ({ ...l }))
  const signalAt = new Set<number>()

  // New roads, in the order they opened.
  for (const r of on.roads ?? []) {
    const ns = r.nodes ?? []
    for (let i = 1; i < ns.length; i++) {
      const a = ns[i - 1]!
      const b = ns[i]!
      const length = Math.max(1, metres(ix.x[a]!, ix.y[a]!, ix.x[b]!, ix.y[b]!))
      for (const [from, to] of [[a, b], [b, a]] as const) links.push(newLink(links.length, from, to, length, r.lanes, r.flyover, nodes[to]!.signal))
    }
    if (!r.flyover) for (const n of ns) signalAt.add(n)
  }

  // Work at junctions: the strongest done at each.
  const works = new Map<number, Set<Work>>()
  for (const j of on.junctions ?? []) {
    if (!nodes[j.node]) continue
    let set = works.get(j.node)
    if (!set) works.set(j.node, (set = new Set()))
    set.add(j.work)
    if (j.work !== 'overpass') signalAt.add(j.node)
  }

  const into: number[][] = nodes.map(() => [])
  for (const l of links) if (!isShut(l)) into[l.to]!.push(l.id)

  // Signals where a road on the ground meets others, and where the player put them: a signal more on every road in.
  for (const n of [...signalAt].sort((a, b) => a - b)) {
    if (nodes[n]!.signal) continue
    nodes[n]!.signal = true
    for (const id of into[n]!) links[id]!.signals = (links[id]!.signals ?? 0) + 1
  }

  for (const [n, set] of [...works].sort((a, b) => a[0] - b[0])) {
    const factor = set.has('redesign') ? JUNCTION.redesign.capacity : set.has('signal') ? JUNCTION.signal.capacity : 1000
    if (factor !== 1000) for (const id of into[n]!) links[id]!.capacity = Math.round((links[id]!.capacity * factor) / 1000)
    nodes[n]!.work = set.has('overpass') ? 'overpass' : set.has('redesign') ? 'redesign' : 'signal'
    if (set.has('overpass')) {
      const main = mainRoad(links, into, nodes, n)
      for (const id of main?.into ?? []) {
        const l = links[id]!
        l.capacity = Math.round((l.capacity * JUNCTION.overpass.capacity) / 1000)
        if (nodes[n]!.signal) l.signals = Math.max(0, (l.signals ?? 1) - 1)
      }
    }
  }

  if (on.footpaths?.length) {
    const zoneOf = linkZones(city, { nodes, links, zoneNode: base.zoneNode })
    const laid = new Set(on.footpaths)
    for (const l of links) {
      if (l.kind === 'motorway' || isFlyover(l) || !laid.has(zoneOf[l.id]!)) continue
      l.capacity = Math.round((l.capacity * FOOTPATHS.capacity) / 1000)
    }
  }

  for (const id of on.oneWay ?? []) {
    const l = links[id]
    if (!l || isShut(l)) continue
    const back = opposite(links, into, l)
    if (!back) continue
    l.lanes += back.lanes
    l.capacity += back.capacity
    back.to = back.from
  }
  return { nodes, links, zoneNode: base.zoneNode }
}

/** A link of a flyover the player built: every link of the city's network has a drawn stretch; new ones have none. */
const isFlyover = (l: RoutingLink) => l.drawn.length === 0 && l.kind === 'trunk' && l.speed === ROAD.flyoverSpeed

function newLink(id: number, from: number, to: number, length: number, lanes: number, flyover: boolean, signalled: boolean): RoutingLink {
  const one = lanes < 2 && !flyover
  return {
    id,
    from,
    to,
    length,
    kind: flyover ? 'trunk' : one ? 'secondary' : 'primary',
    lanes,
    speed: flyover ? ROAD.flyoverSpeed : one ? ROAD.speedOneLane : ROAD.speed,
    capacity: lanes * (one ? ROAD.capacityOneLane : ROAD.capacity),
    signals: signalled ? 1 : 0,
    drawn: [],
    forward: [],
  }
}

/** The link running the other way along the same road, open, the lowest id if there are several. */
function opposite(links: RoutingLink[], into: number[][], l: RoutingLink): RoutingLink | null {
  for (const id of into[l.from] ?? []) {
    const b = links[id]!
    if (b.from === l.to && !isShut(b)) return b
  }
  return null
}

/**
 * The main road through a junction: the busiest road in (most capacity, then the lower id) and the road out most
 * nearly straight ahead of it, within 60 degrees; with the links the other way. Null if nothing runs on straight.
 */
function mainRoad(links: RoutingLink[], into: number[][], nodes: RoutingNode[], n: number): { into: number[]; path: number[] } | null {
  const x = (k: number) => east(nodes[k]!.at[0])
  const y = (k: number) => north(nodes[k]!.at[1])
  let first: RoutingLink | null = null
  for (const id of into[n]!) {
    const l = links[id]!
    if (!first || l.capacity > first.capacity) first = l
  }
  if (!first) return null
  const a = first.from
  const ax = x(n) - x(a)
  const ay = y(n) - y(a)
  let best: RoutingLink | null = null
  let bestCos = 0.5
  for (const l of links) {
    if (l.from !== n || isShut(l) || l.to === a) continue
    const bx = x(l.to) - x(n)
    const by = y(l.to) - y(n)
    const len = Math.sqrt((ax * ax + ay * ay) * (bx * bx + by * by))
    if (len === 0) continue
    const cos = (ax * bx + ay * by) / len
    if (cos > bestCos || (cos === bestCos && best && l.id < best.id)) {
      best = l
      bestCos = cos
    }
  }
  if (!best) return null
  const b = best.to
  const ins = into[n]!.filter((id) => links[id]!.from === a || links[id]!.from === b)
  return { into: ins, path: [a, n, b] }
}

const zoneSpots = new WeakMap<Zone[], { x: Int32Array; y: Int32Array }>()
function spots(zones: Zone[]) {
  let s = zoneSpots.get(zones)
  if (!s) {
    s = { x: Int32Array.from(zones, (z) => east(micro(z.centre[0]))), y: Int32Array.from(zones, (z) => north(micro(z.centre[1]))) }
    zoneSpots.set(zones, s)
  }
  return s
}

/** The zone whose centre is nearest a place in metres, the lower id on a tie. */
export function nearestZone(city: CityData, x: number, y: number): number {
  const s = spots(city.zones)
  let best = 0
  let bestD = Infinity
  for (let k = 0; k < city.zones.length; k++) {
    const dx = s.x[k]! - x
    const dy = s.y[k]! - y
    const d = dx * dx + dy * dy
    if (d < bestD) {
      bestD = d
      best = k
    }
  }
  return city.zones[best]!.id
}

const zonesOfLinks = new WeakMap<RoutingNetwork, Int32Array>()
/** The zone each link runs through, by the zone whose centre is nearest its middle. */
export function linkZones(city: CityData, roads: RoutingNetwork): Int32Array {
  let z = zonesOfLinks.get(roads)
  if (z) return z
  // The city's own links keep the zones worked out for the city's network.
  const baseZones = roads === city.roads ? null : linkZones(city, city.roads)
  z = new Int32Array(roads.links.length)
  for (const l of roads.links) {
    if (baseZones && l.id < baseZones.length) {
      z[l.id] = baseZones[l.id]!
      continue
    }
    const a = roads.nodes[l.from]!.at
    const b = roads.nodes[l.to]!.at
    z[l.id] = nearestZone(city, (east(a[0]) + east(b[0])) >> 1, (north(a[1]) + north(b[1])) >> 1)
  }
  zonesOfLinks.set(roads, z)
  return z
}

/** Metres of main road in each zone, counting each direction as one side of the street; expressways left out. */
export function sidesIn(city: CityData, roads: RoutingNetwork, zone: number): number {
  const zoneOf = linkZones(city, roads)
  let m = 0
  for (const l of roads.links) if (zoneOf[l.id] === zone && !isShut(l) && l.kind !== 'motorway' && !isFlyover(l)) m += l.length
  return m
}

/**
 * Speed limits on links, km/h, by link id: each limit set on a zone, on the main roads through it that run faster
 * than it, expressways and flyovers left out. For the model's `limits`.
 */
export function limitsOf(city: CityData, roads: RoutingNetwork, limits: { zone: number; limit: number }[]): Record<number, number> | undefined {
  if (!limits.length) return undefined
  const byZone = new Map(limits.map((l) => [l.zone, l.limit]))
  const zoneOf = linkZones(city, roads)
  const out: Record<number, number> = {}
  let any = false
  for (const l of roads.links) {
    const limit = byZone.get(zoneOf[l.id]!)
    if (limit === undefined || isShut(l) || l.kind === 'motorway' || isFlyover(l) || l.speed <= limit) continue
    out[l.id] = limit
    any = true
  }
  return any ? out : undefined
}

/** How many nodes can reach `root` and be reached from it, with the links open in `roads`. */
function reachedBothWays(roads: RoutingNetwork, root: number): number {
  const n = roads.nodes.length
  const out: number[][] = Array.from({ length: n }, () => [])
  const inn: number[][] = Array.from({ length: n }, () => [])
  for (const l of roads.links) {
    if (isShut(l)) continue
    out[l.from]!.push(l.to)
    inn[l.to]!.push(l.from)
  }
  const walk = (next: number[][]) => {
    const seen = new Uint8Array(n)
    const stack = [root]
    seen[root] = 1
    while (stack.length) for (const v of next[stack.pop()!]!) if (!seen[v]) {
      seen[v] = 1
      stack.push(v)
    }
    return seen
  }
  const a = walk(out)
  const b = walk(inn)
  let count = 0
  for (let k = 0; k < n; k++) if (a[k] && b[k]) count++
  return count
}

// ------------------------------------------------------------------------------------------------ planning

/** Names a junction after the nearest zone, in English and Kannada. */
function junctionName(city: CityData, ix: RoadIndex, node: number) {
  const zone = city.zones.find((z) => z.id === nearestZone(city, ix.x[node]!, ix.y[node]!))!
  return { name: zone.name, nameKn: zone.nameKn }
}

const atNode = (ix: RoadIndex, node: number): [number, number] => [lngOf(ix.x[node]!) / 1e6, latOf(ix.y[node]!) / 1e6]

/** Links in and out of a node, open, and how many other junctions they reach. */
function around(roads: RoutingNetwork, ix: RoadIndex, node: number) {
  const links = [...ix.out[node]!, ...ix.into[node]!].filter((id) => !isShut(roads.links[id]!))
  const others = new Set(links.map((id) => (roads.links[id]!.from === node ? roads.links[id]!.to : roads.links[id]!.from)))
  others.delete(node)
  return { links: [...new Set(links)].sort((a, b) => a - b), others: others.size }
}

/**
 * Where a straight road on the ground from a to b meets the roads it crosses: for each crossing of a road that is not
 * an expressway, that road's nearer junction if it is within `ROAD.meet` of the crossing; in order along the way.
 */
function meetings(roads: RoutingNetwork, ix: RoadIndex, a: number, b: number): number[] {
  const ax = ix.x[a]!
  const ay = ix.y[a]!
  const bx = ix.x[b]!
  const by = ix.y[b]!
  const found: { t: number; node: number }[] = []
  const seen = new Set<number>()
  const x0 = Math.floor(Math.min(ax, bx) / 500)
  const x1 = Math.floor(Math.max(ax, bx) / 500)
  const y0 = Math.floor(Math.min(ay, by) / 500)
  const y1 = Math.floor(Math.max(ay, by) / 500)
  const rx = bx - ax
  const ry = by - ay
  for (let cx = x0; cx <= x1; cx++) {
    for (let cy = y0; cy <= y1; cy++) {
      for (const id of ix.linkCells.get(cx * 100_000 + cy) ?? []) {
        if (seen.has(id)) continue
        seen.add(id)
        const l = roads.links[id]!
        if (isShut(l) || l.kind === 'motorway' || l.from === a || l.from === b || l.to === a || l.to === b) continue
        const px = ix.x[l.from]!
        const py = ix.y[l.from]!
        const sx = ix.x[l.to]! - px
        const sy = ix.y[l.to]! - py
        const d = rx * sy - ry * sx
        if (d === 0) continue
        const t = ((px - ax) * sy - (py - ay) * sx) / d
        const u = ((px - ax) * ry - (py - ay) * rx) / d
        if (!(t > 0 && t < 1 && u >= 0 && u <= 1)) continue
        const qx = ax + Math.round(rx * t)
        const qy = ay + Math.round(ry * t)
        const dFrom = metres(qx, qy, px, py)
        const dTo = metres(qx, qy, ix.x[l.to]!, ix.y[l.to]!)
        const node = dFrom < dTo || (dFrom === dTo && l.from < l.to) ? l.from : l.to
        if (Math.min(dFrom, dTo) <= ROAD.meet) found.push({ t, node })
      }
    }
  }
  found.sort((p, q) => p.t - q.t || p.node - q.node)
  const out: number[] = []
  for (const f of found) if (!out.includes(f.node)) out.push(f.node)
  return out
}

/** Rupees a m² for land in a zone, from the people and jobs a km² there. */
function landPrice(zone: Zone): number {
  const dense = zone.area > 0 ? Math.round((zone.people + zone.jobs) / zone.area) : 0
  return Math.min(ROAD.landMost, ROAD.landBase + ROAD.landDense * dense)
}

/** Each place of a plan snapped to the nearest junction within reach, or why not. */
function snapToJunctions(game: Game, city: CityData, ix: RoadIndex, stops: Stop[]): { node: number; stop: number }[] | string {
  const stations = [...city.transit.stations, ...builtOf(game).stations]
  const out: { node: number; stop: number }[] = []
  for (const [k, stop] of stops.entries()) {
    let x: number
    let y: number
    if ('station' in stop) {
      const s = stations.find((t) => t.id === stop.station)
      if (!s) return 'There is no such station.'
      x = east(micro(s.at[0]))
      y = north(micro(s.at[1]))
    } else {
      x = east(micro(stop.at[0]))
      y = north(micro(stop.at[1]))
    }
    const near = nearestNode(ix, x, y, ROAD.reach, (n) => ix.out[n]!.some((id) => !isShut(ix.roads.links[id]!)))
    if (near.node < 0) return 'There is no main road within 2 km of that place. Choose a place nearer the roads.'
    if (out.at(-1)?.node !== near.node) out.push({ node: near.node, stop: k })
  }
  return out
}

/** Where one place of a road would go before there is a road: the junction it snaps to, named, or why not. */
export function snapRoad(game: Game, city: CityData, roads: RoutingNetwork, stop: Stop): Quote['stations'][number] | { reason: string } {
  const ix = roadIndex(roads)
  const placed = snapToJunctions(game, city, ix, [stop])
  if (typeof placed === 'string') return { reason: placed }
  const node = placed[0]!.node
  return { at: atNode(ix, node), ...junctionName(city, ix, node), stop: 0 }
}

/** A road or a flyover: where it runs, what it meets, and what it costs, takes and does to the roads meanwhile. */
export function roadQuote(game: Game, city: CityData, roads: RoutingNetwork, plan: RoadPlan): Quote {
  const ix = roadIndex(roads)
  const placed = snapToJunctions(game, city, ix, plan.stops)
  if (typeof placed === 'string') return refuse(placed, true)
  if (placed.length < 2) return refuse('Those places are at the same junction. Choose places further apart.', true)
  if (new Set(placed.map((p) => p.node)).size < placed.length) return refuse('The road passes the same junction twice.', true)
  const path: number[] = [placed[0]!.node]
  const tapped = new Map<number, number>([[placed[0]!.node, placed[0]!.stop]])
  for (let i = 1; i < placed.length; i++) {
    const a = placed[i - 1]!.node
    const b = placed[i]!.node
    if (!plan.flyover) {
      for (const m of meetings(roads, ix, a, b)) {
        if (!path.includes(m) && !placed.some((p) => p.node === m)) path.push(m)
      }
    }
    path.push(b)
    tapped.set(b, placed[i]!.stop)
  }
  let length = 0
  let land = 0
  const widthDm = plan.lanes * 2 * ROAD.widthDm + ROAD.vergeDm
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!
    const b = path[i]!
    const m = metres(ix.x[a]!, ix.y[a]!, ix.x[b]!, ix.y[b]!)
    length += m
    if (!plan.flyover) {
      const zone = city.zones.find((z) => z.id === nearestZone(city, (ix.x[a]! + ix.x[b]!) >> 1, (ix.y[a]! + ix.y[b]!) >> 1))!
      land += Math.round((m * widthDm * landPrice(zone)) / 1_000_000)
    }
  }
  const what = plan.flyover ? 'A flyover' : 'A road'
  if (length < ROAD.shortest) return refuse(`${what} must be at least ${km(ROAD.shortest)} long.`, true)
  const longest = plan.flyover ? ROAD.flyoverLongest : ROAD.longest
  if (length > longest) return refuse(`${what} may be at most ${km(longest)} long. Build it in parts.`, true)

  const works = Math.round((length * plan.lanes * 2 * (plan.flyover ? ROAD.flyoverLaneKm : ROAD.laneKm)) / 1000)
  const t = plan.flyover ? ROAD.flyoverMonths : ROAD.months
  const months = Math.max(t.least, Math.min(t.most, t.base + Math.floor(length / t.perMonth)))
  // The roads at its ends lose a lane while it is built.
  const disrupted = new Set<number>()
  for (const end of [path[0]!, path.at(-1)!]) for (const id of around(roads, ix, end).links) disrupted.add(id)
  const q: Quote = {
    ok: true,
    cost: priced(game, works + land),
    months,
    running: upkeep(game, length * plan.lanes * 2),
    length,
    stations: path.map((node) => {
      const st: Quote['stations'][number] = { at: atNode(ix, node), ...junctionName(city, ix, node) }
      const stop = tapped.get(node)
      return stop === undefined ? st : { ...st, stop }
    }),
    path: path.flatMap((n) => atNode(ix, n)),
    disrupted: [...disrupted].sort((a, b) => a - b),
    major: true,
  }
  if (!plan.flyover) q.land = priced(game, land)
  return q
}

/** Lane-metres of the roads, flyovers and overpasses the player has opened: they add to the upkeep for good. */
export function builtLaneMetres(city: CityData, built: Built): number {
  const ix = roadIndex(city.roads)
  let m = 0
  for (const r of built.roads ?? []) {
    const ns = r.nodes ?? []
    for (let i = 1; i < ns.length; i++) m += metres(ix.x[ns[i - 1]!]!, ix.y[ns[i - 1]!]!, ix.x[ns[i]!]!, ix.y[ns[i]!]!) * r.lanes * 2
  }
  for (const j of built.junctions ?? []) if (j.work === 'overpass') m += JUNCTION.overpass.length * JUNCTION.overpass.lanes * 2
  return m
}

/** The nodes a quoted road runs through, from its path. */
export function roadNodes(roads: RoutingNetwork, q: Quote): number[] {
  const ix = roadIndex(roads)
  const out: number[] = []
  for (let i = 0; i + 1 < q.path.length; i += 2) {
    out.push(nearestNode(ix, east(micro(q.path[i]!)), north(micro(q.path[i + 1]!)), 1).node)
  }
  return out
}

/** Upkeep of main road for a month, in lakh at this month's prices: `laneMetres` of lane. */
/** Upkeep of new road a month at the upkeep budget as set (slice 6: the budget's rate a lane-km). */
const upkeep = (game: Game, laneMetres: number): Lakh => priced(game, Math.round((laneMetres * UPKEEP.laneKm[game.upkeep ?? 'steady']!) / 100_000_000))

/** Work at a junction: signals, a redesign, or lifting the main road over it. */
export function junctionQuote(game: Game, city: CityData, roads: RoutingNetwork, node: number, work: Work): Quote {
  const major = work === 'overpass'
  const n = roads.nodes[node]
  if (!n) return refuse('There is no such junction.', major)
  if (n.gateway) return refuse('That is where a road leaves the map, not a junction.', major)
  const ix = roadIndex(roads)
  const near = around(roads, ix, node)
  if (near.others < 3) return refuse('Only a place where three roads or more meet can be worked on.', major)
  const done = (builtOf(game).junctions ?? []).filter((j) => j.node === node).map((j) => j.work)
  if ((game.projects ?? []).some((p) => p.plan.kind === 'junction' && p.plan.node === node)) {
    return refuse('Work at this junction is under way already.', major)
  }
  if (done.includes('overpass')) return refuse('The main road is lifted over this junction already.', major)
  if (work === 'signal' && n.signal) return refuse('This junction has signals already.', major)
  if (work !== 'overpass' && done.includes('redesign')) return refuse('This junction has been redesigned already.', major)
  const into: number[][] = roads.nodes.map(() => [])
  let path = [node]
  let disrupted: number[] = []
  let cost = 0
  let length = 0
  let running = 0
  if (work === 'overpass') {
    for (const l of roads.links) if (!isShut(l)) into[l.to]!.push(l.id)
    const main = mainRoad(roads.links, into, roads.nodes, node)
    if (!main) return refuse('No main road runs straight through this junction.', major)
    const lanes = JUNCTION.overpass.lanes
    length = JUNCTION.overpass.length
    cost = Math.round((length * lanes * 2 * ROAD.flyoverLaneKm) / 1000)
    running = upkeep(game, length * lanes * 2)
    path = main.path
    const set = new Set<number>()
    for (const l of roads.links) {
      if (isShut(l)) continue
      const onMain = (l.from === node && (l.to === path[0] || l.to === path[2])) || (l.to === node && (l.from === path[0] || l.from === path[2]))
      if (onMain) set.add(l.id)
    }
    disrupted = [...set].sort((a, b) => a - b)
  } else cost = JUNCTION[work].cost
  return {
    ok: true,
    cost: priced(game, cost),
    months: JUNCTION[work].months,
    running,
    length,
    stations: [{ at: atNode(ix, node), ...junctionName(city, ix, node) }],
    path: path.flatMap((k) => atNode(ix, k)),
    disrupted,
    major,
  }
}

const zoneById = (city: CityData, id: unknown) => (whole(id) ? city.zones.find((z) => z.id === id) : undefined)

/** Footpaths and crossings along every main road in a zone. */
export function footpathQuote(game: Game, city: CityData, roads: RoutingNetwork, zoneId: number): Quote {
  const zone = zoneById(city, zoneId)
  if (!zone) return refuse('There is no such zone.')
  if ((builtOf(game).footpaths ?? []).includes(zone.id)) return refuse(`${zone.name} has footpaths already.`)
  if ((game.projects ?? []).some((p) => p.plan.kind === 'footpaths' && p.plan.zone === zone.id)) {
    return refuse(`Footpaths are being laid in ${zone.name} already.`)
  }
  const m = sidesIn(city, roads, zone.id)
  if (m === 0) return refuse(`${zone.name} has no main road to lay footpaths along.`)
  return {
    ok: true,
    cost: priced(game, Math.round((m * FOOTPATHS.km) / 1000)),
    months: Math.min(FOOTPATHS.most, FOOTPATHS.months + Math.floor(m / FOOTPATHS.perMonth)),
    running: priced(game, Math.round((m * FOOTPATHS.upkeepTenKm) / 10_000)),
    length: m,
    stations: [{ at: zone.centre, name: zone.name, nameKn: zone.nameKn }],
    path: [],
    disrupted: [],
    major: false,
  }
}

/** A speed limit on the main roads of a zone, or none. Done at once. */
export function limitQuote(game: Game, city: CityData, roads: RoutingNetwork, zoneId: number, limit: number | null): Quote {
  const zone = zoneById(city, zoneId)
  if (!zone) return refuse('There is no such zone.')
  const now = (builtOf(game).limits ?? []).find((l) => l.zone === zone.id)
  if (limit === null) {
    if (!now) return refuse(`${zone.name} has no speed limit of yours to lift.`)
  } else {
    if (!(LIMITS.allowed as readonly number[]).includes(limit)) return refuse(`A speed limit may be ${LIMITS.allowed.join(', ')} km/h.`)
    if (now?.limit === limit) return refuse(`The limit in ${zone.name} is ${limit} km/h already.`)
  }
  const on = limitsOf(city, roads, limit === null ? [] : [{ zone: zone.id, limit }]) ?? {}
  let length = 0
  for (const id of Object.keys(on)) length += roads.links[Number(id)]!.length
  if (limit !== null && length === 0) return refuse(`No main road in ${zone.name} runs faster than ${limit} km/h.`)
  return {
    ok: true,
    cost: limit === null ? 0 : priced(game, LIMITS.cost),
    months: 0,
    running: 0,
    length,
    stations: [{ at: zone.centre, name: zone.name, nameKn: zone.nameKn }],
    path: [],
    disrupted: [],
    major: false,
  }
}

/** Makes a road one-way the way of the link given, or two-way again. Done at once. */
export function oneWayQuote(game: Game, city: CityData, roads: RoutingNetwork, linkId: number, on: boolean): Quote {
  const l = whole(linkId) ? roads.links[linkId] : undefined
  if (!l) return refuse('That is not a main road.')
  const set = builtOf(game).oneWay ?? []
  const ix = roadIndex(roads)
  const path = [...atNode(ix, l.from), ...atNode(ix, l.to)]
  const quote = (): Quote => ({
    ok: true, cost: on ? priced(game, ONE_WAY.cost) : 0, months: 0, running: 0, length: l.length, stations: [], path, disrupted: [], major: false,
  })
  if (!on) {
    if (!set.includes(l.id)) return refuse('That road is not one-way by your order.')
    return quote()
  }
  if (isShut(l)) return refuse('That road is one-way the other way already.')
  if (set.includes(l.id)) return refuse('That road is one-way already.')
  if (l.kind === 'motorway') return refuse('An expressway cannot be made one-way.')
  const into: number[][] = roads.nodes.map(() => [])
  for (const x of roads.links) if (!isShut(x)) into[x.to]!.push(x.id)
  const back = opposite(roads.links, into, l)
  if (!back) return refuse('That road is one-way already.')
  const after = networkOf(city, { ...onRoadsOf(builtOf(game)), oneWay: [...set, l.id] })
  if (reachedBothWays(after, l.from) < reachedBothWays(roads, l.from)) {
    return refuse('That would leave some junctions that could not be reached, or left. Choose another road.')
  }
  return quote()
}

/** Metro and suburban stations, open, being built, the player's and those ordered, in metres. */
function stationSpots(game: Game, city: CityData): [number, number][] {
  const out: [number, number][] = []
  for (const s of [...city.transit.stations, ...builtOf(game).stations]) {
    if (s.kind === 'metro' || s.kind === 'rail') out.push([east(micro(s.at[0])), north(micro(s.at[1]))])
  }
  for (const p of game.projects ?? []) {
    if (p.plan.kind === 'metro') for (const s of p.quote.stations) out.push([east(micro(s.at[0])), north(micro(s.at[1]))])
  }
  return out
}

/** Whether a zone's centre is within reach of a metro or suburban station. */
export function nearStation(game: Game, city: CityData, zone: Zone): boolean {
  const x = east(micro(zone.centre[0]))
  const y = north(micro(zone.centre[1]))
  return stationSpots(game, city).some(([sx, sy]) => metres(x, y, sx, sy) <= DENSITY.reach)
}

/** Lets people build taller in a zone near a station, or no longer. Done at once; a major action to allow. */
export function densityQuote(game: Game, city: CityData, zoneId: number, on: boolean): Quote {
  const zone = zoneById(city, zoneId)
  if (!zone) return refuse('There is no such zone.', on)
  const dense = builtOf(game).dense ?? []
  if (!on) {
    if (!dense.includes(zone.id)) return refuse(`Taller building is not allowed in ${zone.name} by your order.`)
  } else {
    if (dense.includes(zone.id)) return refuse(`Taller building is allowed in ${zone.name} already.`, true)
    if (zone.people === 0) return refuse(`No one lives in ${zone.name} to build for.`, true)
    if (!nearStation(game, city, zone)) {
      return refuse(`There is no metro or suburban station within ${km(DENSITY.reach)} of ${zone.name}.`, true)
    }
  }
  return {
    ok: true, cost: 0, months: 0, running: 0, length: 0,
    stations: [{ at: zone.centre, name: zone.name, nameKn: zone.nameKn }], path: [], disrupted: [], major: on,
  }
}
