import type { Station, TransitLine } from '../data/types'
import { indexLinks, toKm, Tree, type Graph } from './graph'
import { ROAD } from './params'
import type { RoutingNetwork } from './types'

/**
 * A cheap fingerprint of a network: what finding bus routes reads from it (its ends, lengths, speeds, signals, kinds
 * and where buses may stop). The rules pass the same object while the roads are unchanged, and a new one when the
 * player builds; one built afresh but equal is known by this and finds what was kept for the first.
 */
export function fingerprint(roads: RoutingNetwork): string {
  let h = 0x811c9dc5
  const mix = (x: number) => {
    h = Math.imul(h ^ (x | 0), 0x01000193)
  }
  for (const l of roads.links) {
    mix(l.from)
    mix(l.to)
    mix(l.length)
    mix(l.speed)
    mix(l.lanes)
    mix(l.signals ?? -1)
    mix(l.kind.length)
    mix(l.kind.charCodeAt(0))
  }
  for (const n of roads.nodes) mix((n.signal ? 1 : 0) + (n.gateway ? 2 : 0) + n.at[0] + n.at[1])
  return `${roads.nodes.length}/${roads.links.length}/${(h >>> 0).toString(16)}`
}

type Kept<T> = { byObject: WeakMap<RoutingNetwork, T>; byPrint: Map<string, T> }
const keep = <T>(): Kept<T> => ({ byObject: new WeakMap(), byPrint: new Map() })
/** What was kept for this network, or for an equal one; else made now and kept (the last four by fingerprint). */
function kept<T>(store: Kept<T>, roads: RoutingNetwork, make: () => T): T {
  let x = store.byObject.get(roads)
  if (x) return x
  const print = fingerprint(roads)
  x = store.byPrint.get(print)
  if (!x) {
    x = make()
    store.byPrint.set(print, x)
    if (store.byPrint.size > 4) store.byPrint.delete(store.byPrint.keys().next().value!)
  }
  store.byObject.set(roads, x)
  return x
}

/** The roads as a graph for finding bus routes, with each link's seconds at free speed; kept for each network. */
const graphs = keep<{ graph: Graph; cost: Float64Array; xy: Float64Array; stop: Uint8Array }>()

function roadGraph(roads: RoutingNetwork) {
  return kept(graphs, roads, () => makeRoadGraph(roads))
}

function makeRoadGraph(roads: RoutingNetwork) {
  const n = roads.nodes.length
  const m = roads.links.length
  const graph: Graph = {
    nodes: n,
    from: Int32Array.from(roads.links, (l) => l.from),
    to: Int32Array.from(roads.links, (l) => l.to),
    outStart: new Int32Array(n + 1),
    outLink: new Int32Array(m),
  }
  indexLinks(graph)
  const cost = Float64Array.from(roads.links, (l) => {
    const signals = l.signals ?? (roads.nodes[l.to]!.signal ? 1 : 0)
    return ((l.length > 1 ? l.length : 1) * 3.6) / (l.speed > 0 ? l.speed : 1) + ROAD.signalDelay * signals
  })
  const xy = new Float64Array(2 * n)
  for (const node of roads.nodes) toKm(node.at[0] / 1e6, node.at[1] / 1e6, xy, 2 * node.id)
  // A bus stops only on a road that side streets meet: not at a gateway, nor where only motorways meet.
  const stop = new Uint8Array(n)
  for (const l of roads.links) {
    if (l.kind === 'motorway') continue
    stop[l.from] = 1
    stop[l.to] = 1
  }
  for (const node of roads.nodes) if (node.gateway) stop[node.id] = 0
  return { graph, cost, xy, stop }
}

/** The junction a bus stop at this place is served from: the nearest where a bus may stop. */
export function stopNode(roads: RoutingNetwork, lng: number, lat: number): number {
  const { xy, stop } = roadGraph(roads)
  const p = new Float64Array(2)
  toKm(lng, lat, p, 0)
  let best = -1
  let near = Infinity
  for (let v = 0; v < roads.nodes.length; v++) {
    if (!stop[v]) continue
    const dx = xy[2 * v]! - p[0]!
    const dy = xy[2 * v + 1]! - p[1]!
    const d = dx * dx + dy * dy
    if (d < near) {
      near = d
      best = v
    }
  }
  return best
}

/** Ways found between junctions, kept for each network: they never change, and months ask for the same ones. */
const ways = keep<{ tree: Tree; stops: Map<string, number>; links: Map<number, number[]> }>()

/**
 * The routing links a bus route runs along, from each stop to the next (one list for each pair of stops), by the
 * quickest way at free speed, as the rules lay a route out. Stops at the same junction, or a stop that does not
 * exist, give an empty list. The same stops on the same roads always give the same links.
 */
export function busSegments(roads: RoutingNetwork, line: TransitLine, stations: Map<number, Station>): number[][] {
  const { graph, cost } = roadGraph(roads)
  const { tree, stops, links } = kept(ways, roads, () => {
    const tree = new Tree(graph)
    tree.setCost(cost)
    return { tree, stops: new Map<string, number>(), links: new Map<number, number[]>() }
  })
  const n = roads.nodes.length
  const nodes = line.stations.map((id) => {
    const s = stations.get(id)
    if (!s) return -1
    const key = `${s.at[0]},${s.at[1]}`
    let v = stops.get(key)
    if (v === undefined) {
      v = stopNode(roads, s.at[0], s.at[1])
      stops.set(key, v)
    }
    return v
  })
  const segments: number[][] = []
  for (let k = 1; k < nodes.length; k++) {
    const a = nodes[k - 1]!
    const b = nodes[k]!
    let way = links.get(a * n + b)
    if (!way) {
      way = []
      if (a >= 0 && b >= 0 && a !== b) {
        tree.grow(a)
        if (tree.time[b]! < Infinity) {
          for (let v = b; v !== a; v = graph.from[tree.pred[v]!]!) way.push(tree.pred[v]!)
          way.reverse()
        }
      }
      if (a >= 0 && b >= 0) links.set(a * n + b, way)
    }
    segments.push(way)
  }
  return segments
}

/** Every routing link a bus route runs along, in order. */
export function busPath(roads: RoutingNetwork, line: TransitLine, stations: Station[]): number[] {
  return busSegments(roads, line, new Map(stations.map((s) => [s.id, s]))).flat()
}
