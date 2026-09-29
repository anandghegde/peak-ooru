import type { Zone } from '../data/types'
import type { RoutingNetwork } from './types'
import { ROAD } from './params'
import { surfaceCapacity, surfaceSpeed } from './surface'

/** A directed graph as flat arrays: the outgoing links of node n are outLink[outStart[n] .. outStart[n + 1]). */
export interface Graph {
  nodes: number
  /** Nodes from this one on are where trips start and end, never passed through. */
  firstZone?: number
  from: Int32Array
  to: Int32Array
  outStart: Int32Array
  outLink: Int32Array
}

/** The routing network as flat arrays, with the month's road condition applied. */
export interface Net extends Graph {
  links: number
  /** Links of the road network proper, which come first; the rest join zones to it. */
  roadLinks: number
  /** The node of zone 0; zone z is node firstZone + z. Trips leave a zone by its links to the junctions it joins. */
  firstZone: number
  /**
   * The junctions each zone joins, for trips arriving: zone z's are joinNode[joinStart[z] .. joinStart[z + 1]), each
   * with the seconds and metres of the side streets from it to the zone's centre.
   */
  joinStart: Int32Array
  joinNode: Int32Array
  joinTime: Float64Array
  joinLength: Float64Array
  /** Metres. */
  length: Float64Array
  /** Seconds to cross at free speed in the month's condition. */
  free: Float64Array
  /** Seconds to cross at the link's own free speed in good repair: what "share of free speed" is measured against. */
  base: Float64Array
  /** Seconds lost at a signal at the end, at light traffic. */
  delay: Float64Array
  /**
   * Seconds to cross at the speed limit set on the link (0 where there is none): traffic is never quicker than that,
   * whatever the road would allow. A jam slower than the limit is not slowed further by it.
   */
  least: Float64Array
  /** Passenger-car units an hour, in the month's condition, less the lanes given to buses or lost to works. */
  capacity: Float64Array
  /** 1 on a link with a bus lane, where buses run at free speed. */
  busLane: Uint8Array
  /**
   * The share of free speed and of capacity each link keeps for the state of its surface (slice 6; 1 on a road in
   * perfect repair and on the joins), already in `free` and `capacity`: kept so that road deaths and the delay a road's
   * surface causes can be worked out against the road in good repair.
   */
  surfaceSpeed: Float64Array
  surfaceCapacity: Float64Array
  /** The share of the month each link is shut (flooded), 0 to 1, already in `free` and `capacity`. */
  shut: Float64Array
  /** Rupees a car pays in tolls to use the link, and the seconds that is worth to a driver choosing a route. */
  toll: Float64Array
  tollSeconds: Float64Array
  /** Incoming links of each node: inLink[inStart[n] .. inStart[n + 1]). */
  inStart: Int32Array
  inLink: Int32Array
}

/** Lays out the outgoing links of each node, given `from` filled in. */
export function indexLinks(g: Graph): void {
  const n = g.nodes
  const m = g.from.length
  g.outStart.fill(0)
  for (let i = 0; i < m; i++) g.outStart[g.from[i]! + 1]!++
  for (let i = 0; i < n; i++) g.outStart[i + 1]! += g.outStart[i]!
  const fill = g.outStart.slice(0, n)
  for (let i = 0; i < m; i++) g.outLink[fill[g.from[i]!]!++] = i
}

/**
 * Links that lose a lane: to works (`works`, as many as listed), and to buses (`bus`); speed limits, km/h by link; the
 * condition of each link's surface, 0 to 100 (100 where missing); links shut for a share of the month, in thousandths;
 * and for each zone, the share of free speed its side streets keep (1 where missing).
 */
export interface Lanes {
  works?: number[]
  bus?: number[]
  limits?: Record<number, number>
  surface?: number[]
  shut?: Record<number, number>
  streets?: Float64Array
}

/** A link shut for all the month is as good as gone: this slow, and this little room. */
const SHUT_TIME = 3600
const SHUT_ROOM = 1e-3

/** A place on a flat map of the city, in km east and north of a point near its centre. */
export function toKm(lng: number, lat: number, out: Float64Array, at: number): void {
  // 111.32 km a degree of longitude at the equator, times the cosine of 12.97° (0.97449); 110.57 km a degree of latitude.
  out[at] = (lng - 77.6) * 108.48
  out[at + 1] = (lat - 12.97) * 110.57
}

/**
 * Flattens the network, with the month's road condition (share of free speed by link, 1 when omitted), and joins
 * each zone to the junctions nearest its centre, so that a zone's traffic enters and leaves the main roads at several
 * places, as it does by the side streets, rather than all at one. A zone is a node with links out to its junctions
 * (node `firstZone + z`, links from `roadLinks` on); trips arriving are shared among its junctions.
 */
export function buildNet(roads: RoutingNetwork, zones: Zone[], zoneNode: number[], condition?: number[], lanes?: Lanes): Net {
  const n0 = roads.nodes.length
  const m0 = roads.links.length
  const Z = zones.length
  // The junctions each zone joins: its own node, and the nearest others within reach, up to ROAD.joins in all.
  const at = new Float64Array(n0 * 2)
  for (const node of roads.nodes) toKm(node.at[0] / 1e6, node.at[1] / 1e6, at, 2 * node.id)
  // Side streets do not meet an expressway between its interchanges: a junction where only motorways meet is not joined.
  const ordinary = new Uint8Array(n0)
  for (const l of roads.links) {
    if (l.kind === 'motorway') continue
    ordinary[l.from] = 1
    ordinary[l.to] = 1
  }
  // A junction only of one-lane roads is a poor way in for a zone that has a bigger road near: it counts as further off.
  const strength = new Float64Array(n0)
  for (const l of roads.links) {
    if (l.capacity > strength[l.from]!) strength[l.from] = l.capacity
    if (l.capacity > strength[l.to]!) strength[l.to] = l.capacity
  }
  const weak = (v: number) => (strength[v]! < ROAD.joinStrong ? ROAD.joinWeak : 0)
  const joins: number[] = []
  const joinKm: number[] = []
  const centre = new Float64Array(2)
  const near: number[] = []
  const nearKm = new Float64Array(n0)
  for (const z of zones) {
    toKm(z.centre[0], z.centre[1], centre, 0)
    const own = zoneNode[z.id]!
    const reach = Math.max(ROAD.joinReach, 0.7 * Math.sqrt(z.area))
    // A large zone reaches the main roads at more places, spread over it, as its side streets do.
    const count = Math.min(ROAD.mostJoins, Math.max(ROAD.joins, Math.round(z.area / ROAD.joinArea)))
    const apart = ROAD.joinApart * reach
    near.length = 0
    for (const node of roads.nodes) {
      if (node.gateway || !ordinary[node.id]) continue
      const dx = at[2 * node.id]! - centre[0]!
      const dy = at[2 * node.id + 1]! - centre[1]!
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d > reach && node.id !== own) continue
      nearKm[node.id] = d
      near.push(node.id)
    }
    near.sort((a, b) => nearKm[a]! + weak(a) - nearKm[b]! - weak(b) || a - b)
    // The zone's own junction first (unless it is only of one-lane roads), then the nearest others not too close to one
    // already taken.
    const picked: number[] = ordinary[own] && !weak(own) ? [own] : []
    for (const v of near) {
      if (picked.length === count) break
      if (v === own && picked.includes(own)) continue
      let clear = true
      for (const u of picked) {
        const dx = at[2 * u]! - at[2 * v]!
        const dy = at[2 * u + 1]! - at[2 * v + 1]!
        if (dx * dx + dy * dy < apart * apart) clear = false
      }
      if (clear) picked.push(v)
    }
    // Where too few are far enough apart, the nearest of the rest.
    for (const v of near) {
      if (picked.length >= Math.min(count, ROAD.joins)) break
      if (!picked.includes(v)) picked.push(v)
    }
    if (picked.length === 0) {
      const dx = at[2 * own]! - centre[0]!
      const dy = at[2 * own + 1]! - centre[1]!
      nearKm[own] = Math.sqrt(dx * dx + dy * dy)
      picked.push(own)
    }
    for (const v of picked) {
      joins.push(z.id, v)
      joinKm.push(nearKm[v]!)
    }
  }
  const n = n0 + Z
  const J = joinKm.length
  const m = m0 + J
  const net: Net = {
    nodes: n,
    links: m,
    roadLinks: m0,
    firstZone: n0,
    joinStart: new Int32Array(Z + 1),
    joinNode: new Int32Array(J),
    joinTime: new Float64Array(J),
    joinLength: new Float64Array(J),
    from: new Int32Array(m),
    to: new Int32Array(m),
    length: new Float64Array(m),
    free: new Float64Array(m),
    base: new Float64Array(m),
    delay: new Float64Array(m),
    least: new Float64Array(m),
    capacity: new Float64Array(m),
    busLane: new Uint8Array(m),
    surfaceSpeed: new Float64Array(m).fill(1),
    surfaceCapacity: new Float64Array(m).fill(1),
    shut: new Float64Array(m),
    toll: new Float64Array(m),
    tollSeconds: new Float64Array(m),
    inStart: new Int32Array(n + 1),
    inLink: new Int32Array(m),
    outStart: new Int32Array(n + 1),
    outLink: new Int32Array(m),
  }
  const signal = new Uint8Array(n0)
  for (const node of roads.nodes) signal[node.id] = node.signal ? 1 : 0
  // Lanes lost to works (a link listed twice loses two), and bus lanes, only where a road has two lanes or more.
  const lost = new Float64Array(m0)
  for (const id of lanes?.works ?? []) if (id >= 0 && id < m0) lost[id]! += 1
  for (const id of lanes?.bus ?? []) {
    if (id < 0 || id >= m0 || net.busLane[id] || roads.links[id]!.lanes < 2) continue
    net.busLane[id] = 1
    lost[id]! += 1
  }
  for (const l of roads.links) {
    const i = l.id
    const c = condition?.[i] ?? 1
    const len = l.length > 1 ? l.length : 1
    net.from[i] = l.from
    net.to[i] = l.to
    net.length[i] = len
    net.base[i] = (len * 3.6) / (l.speed * ROAD.speedScale)
    net.free[i] = net.base[i]! / c
    // Poor repair cuts capacity by about half as much as it cuts speed (PRD ROAD-3).
    net.capacity[i] = l.capacity * ROAD.capacityScale * (1 - ROAD.capacityPerSpeedLost * (1 - c))
    // The surface (slice 6): potholes slow a road and narrow it, smoothly with its condition; at 100 it is exactly as built.
    const s = lanes?.surface?.[i]
    if (s !== undefined && s < 100) {
      const ks = surfaceSpeed(s)
      const kc = surfaceCapacity(s)
      net.surfaceSpeed[i] = ks
      net.surfaceCapacity[i] = kc
      net.free[i] = net.free[i]! / ks
      net.capacity[i]! *= kc
    }
    // Shut for a share of the month (a flood): the month is that share with the link gone and the rest with it as it
    // is, taken as one month in which the link carries the rest's share of what it would (capacity × open share) and
    // takes as long as it would on the days it is open, stretched by the days it is not (free ÷ open share), so that
    // routes go round it in proportion. Shut all month: as good as gone.
    const sh = lanes?.shut?.[i]
    if (sh !== undefined && sh > 0) {
      const share = sh < 1000 ? sh / 1000 : 1
      net.shut[i] = share
      if (share < 1) {
        net.free[i] = net.free[i]! / (1 - share)
        net.capacity[i]! *= 1 - share
      } else {
        net.free[i] = SHUT_TIME
        net.capacity[i] = SHUT_ROOM
      }
    }
    // Traffic squeezes past works that take every lane, as by half a lane.
    if (lost[i]! > 0) {
      const left = l.lanes - lost[i]!
      net.capacity[i]! *= (left > 0.5 ? left : 0.5) / (l.lanes > 1 ? l.lanes : 1)
    }
    // Signals along the link, counted by the network where it gives them, else the one at its end.
    net.delay[i] = ROAD.signalDelay * (l.signals ?? signal[l.to]!)
    // A speed limit below what the road allows holds traffic to it (drivers keep to it on average: signs and cameras).
    const limit = lanes?.limits?.[i]
    if (limit !== undefined && limit > 0 && limit < l.speed * ROAD.speedScale) net.least[i] = (len * 3.6) / limit
    // Bengaluru's expressways are tolled (NICE, the Electronic City flyover, the Nelamangala, Mysuru and Chennai roads).
    if (l.kind === 'motorway') {
      net.toll[i] = (ROAD.toll * len) / 1000
      net.tollSeconds[i] = (net.toll[i]! * 3600) / ROAD.tollValue
    }
  }
  // The joins: the side streets at their own speed, never congested here.
  for (let k = 0; k < J; k++) {
    const z = joins[2 * k]!
    const len = joinKm[k]! * 1000 * ROAD.joinDetour
    const i = m0 + k
    net.from[i] = n0 + z
    net.to[i] = joins[2 * k + 1]!
    net.length[i] = len
    net.base[i] = net.free[i] = (len * 3.6) / ROAD.joinSpeed
    // Poor side streets slow the first and last stretch of every trip from or to the zone (slice 6).
    const keep = lanes?.streets?.[z]
    if (keep !== undefined && keep < 1) net.free[i] = net.free[i]! / keep
    net.capacity[i] = 1e9
    net.joinStart[z + 1]!++
    net.joinNode[k] = joins[2 * k + 1]!
    net.joinTime[k] = net.free[i]!
    net.joinLength[k] = len
  }
  for (let z = 0; z < Z; z++) net.joinStart[z + 1]! += net.joinStart[z]!
  indexLinks(net)
  indexLinks({ nodes: n, from: net.to, to: net.from, outStart: net.inStart, outLink: net.inLink })
  return net
}

/**
 * Shortest-path trees over a graph, one root at a time, reusing the same arrays. Paths are found on link costs in
 * whole seconds with a bucket queue (Dial's method), which is twice as fast as a heap here; the seconds reported
 * are then added up exactly along the tree. After `grow`, `order` lists the nodes reached from nearest to furthest
 * (`count` of them), `pred` gives the link each was reached by, and `time` the seconds to reach it.
 */
export class Tree {
  readonly time: Float64Array
  readonly pred: Int32Array
  readonly order: Int32Array
  count = 0
  /** Link costs and distances from the root in whole seconds, as the paths were found on. */
  readonly whole: Int32Array
  readonly dist: Int32Array
  /** Entries of the bucket queue: a node, and the next entry in its bucket. */
  private readonly entryNode: Int32Array
  private readonly entryNext: Int32Array
  /** For each outgoing slot of the graph, the node it leads to and its cost: read in order as the tree grows. */
  private readonly slotTo: Int32Array
  private readonly slotCost: Int32Array
  private head = new Int32Array(1).fill(-1)
  private mask = 0
  private cost: Float64Array | null = null

  constructor(private readonly graph: Graph) {
    const n = graph.nodes
    this.time = new Float64Array(n)
    this.pred = new Int32Array(n)
    this.order = new Int32Array(n)
    this.whole = new Int32Array(graph.from.length)
    this.dist = new Int32Array(n)
    this.entryNode = new Int32Array(graph.from.length + 1)
    this.entryNext = new Int32Array(graph.from.length + 1)
    this.slotTo = Int32Array.from(graph.outLink, (l) => graph.to[l]!)
    this.slotCost = new Int32Array(graph.outLink.length)
  }

  /**
   * Sets the link costs, in seconds, for the trees that follow: the routes are the cheapest by `cost`, and `time` is
   * what is added up along them (the cost itself unless given: a toll is a cost but takes no time).
   */
  setCost(cost: Float64Array, time: Float64Array = cost): void {
    this.cost = time
    // Whole seconds. A link slower than 18 hours is as good as shut, and is held there so that the queue stays short.
    let most = 0
    for (let l = 0; l < cost.length; l++) {
      const c = Math.min(Math.round(cost[l]! / ROAD.pathUnit), 65535)
      this.whole[l] = c
      if (c > most) most = c
    }
    const { outLink } = this.graph
    for (let k = 0; k < outLink.length; k++) this.slotCost[k] = this.whole[outLink[k]!]!
    let size = 1024
    while (size <= most) size *= 2
    // Every bucket is empty again at the end of a tree, so the queue is cleared only when it is made.
    if (this.head.length < size) this.head = new Int32Array(size).fill(-1)
    this.mask = this.head.length - 1
  }

  grow(root: number): void {
    const { pred, order, dist, head, mask, slotTo, slotCost, entryNode, entryNext, time } = this
    const { outStart, outLink, from } = this.graph
    const cost = this.cost!
    const through = this.graph.firstZone ?? this.graph.nodes
    dist.fill(0x7fffffff)
    time.fill(Infinity)
    pred[root] = -1
    dist[root] = 0
    // Each bucket is a list of entries; a node whose distance falls is entered again, and its old entry is passed over
    // (its distance is no longer the bucket's). A node is taken once: an entry is made only for a shorter distance, so
    // a node taken has no other entry at its own distance, and none is made for it after.
    entryNode[0] = root
    entryNext[0] = -1
    head[0] = 0
    let entries = 1
    let used = 1
    let now = 0
    let count = 0
    while (entries > 0) {
      let b = now & mask
      while (head[b] === -1) b = ++now & mask
      const e = head[b]!
      head[b] = entryNext[e]!
      entries--
      const u = entryNode[e]!
      if (dist[u] !== now) continue
      order[count++] = u
      // The seconds to it, added up exactly along the tree: its link's start was taken before it.
      const pl = pred[u]!
      time[u] = pl < 0 ? 0 : time[from[pl]!]! + cost[pl]!
      if (u >= through && u !== root) continue
      for (let k: number = outStart[u]!, end: number = outStart[u + 1]!; k < end; k++) {
        const v = slotTo[k]!
        const d = now + slotCost[k]!
        // A node taken already is never further than now.
        if (d >= dist[v]!) continue
        dist[v] = d
        pred[v] = outLink[k]!
        const at = d & mask
        entryNode[used] = v
        entryNext[used] = head[at]!
        head[at] = used++
        entries++
      }
    }
    this.count = count
  }

  /** Takes back a tree kept in `store` as root `k`, with times at the costs given. */
  restore(store: TreeStore, k: number, cost: Float64Array): void {
    this.routes(store, k)
    this.time.fill(Infinity)
    this.sum(cost, this.time)
  }

  /** Takes back the routes of a tree kept in `store` as root `k`, without its times. */
  routes(store: TreeStore, k: number): void {
    const n = this.graph.nodes
    const count = store.count[k]!
    this.count = count
    for (let i = 0; i < count; i++) {
      const v = store.order[k * n + i]!
      this.order[i] = v
      this.pred[v] = store.pred[k * n + v]!
    }
  }

  /** Adds up `value` of each link along the tree's paths, into `out` by node. */
  sum(value: Float64Array, out: Float64Array): void {
    const { pred, order, count } = this
    const from = this.graph.from
    out[order[0]!] = 0
    for (let k = 1; k < count; k++) {
      const v = order[k]!
      const l = pred[v]!
      out[v] = out[from[l]!]! + value[l]!
    }
  }
}

/** Trees kept for later, packed small: for each root, the nodes in the order reached and the link each was reached by. */
export class TreeStore {
  readonly order: Uint16Array | Int32Array
  readonly pred: Uint16Array | Int32Array
  readonly count: Int32Array

  constructor(
    roots: number,
    private readonly nodes: number,
    links: number,
  ) {
    const small = nodes < 65536 && links < 65536
    this.order = small ? new Uint16Array(roots * nodes) : new Int32Array(roots * nodes)
    this.pred = small ? new Uint16Array(roots * nodes) : new Int32Array(roots * nodes)
    this.count = new Int32Array(roots)
  }

  keep(k: number, tree: Tree): void {
    const at = k * this.nodes
    const n = tree.count
    this.count[k] = n
    for (let i = 0; i < n; i++) {
      const v = tree.order[i]!
      this.order[at + i] = v
      this.pred[at + v] = i === 0 ? 0 : tree.pred[v]!
    }
  }
}
