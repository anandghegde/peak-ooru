// Builds public/data/network.json, the main-road network, from the OpenStreetMap layers that tools/fetch-city.sh saves.
// Run with: npx vite-node tools/build-network.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import type { LngLat, Network, NetworkLink, NetworkNode, RoadClass } from '../src/data/types'

interface Element {
  type: 'node' | 'way'
  id: number
  lat?: number
  lon?: number
  nodes?: number[]
  tags?: Record<string, string>
}

/** A point along a road: its OpenStreetMap node id, or a made-up negative id where a road is cut at the map's edge. */
interface Point {
  id: number
  at: LngLat
}

interface Road {
  kind: RoadClass
  link: boolean
  lanes: number
  oneway: boolean
  speed: number
  name: string | null
  level: number
}

interface Piece extends Road {
  a: number
  b: number
  points: LngLat[]
  alive: boolean
}

const WEST = 77.35
const SOUTH = 12.75
const EAST = 77.85
const NORTH = 13.2
const CENTRE: LngLat = [77.5946, 12.9716]
/** Metres in a degree of longitude and of latitude, at the middle of the map. */
const MX = 111_320 * Math.cos(((SOUTH + NORTH) / 2) * (Math.PI / 180))
const MY = 110_540
/** How far a line may stray from the road when points are dropped, in metres. */
const TOLERANCE = 1.5
/** Stretches shorter than this are folded into the junction at their end. */
const SHORTEST = 6
/** Where both carriageways of a road leave the map this close together, they leave by one gateway. */
const GATEWAY_PAIR = 80
/** A signal mapped on the approach to a junction belongs to the junction within this distance. */
const SIGNAL_REACH = 40

const CLASSES: RoadClass[] = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']
const DEFAULT_LANES: Record<RoadClass, number> = { motorway: 3, trunk: 3, primary: 2, secondary: 2, tertiary: 1 }
const DEFAULT_SPEED: Record<RoadClass, number> = { motorway: 80, trunk: 60, primary: 50, secondary: 40, tertiary: 30 }

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const layer = (name: string) =>
  JSON.parse(readFileSync(join(root, `tools/data/city.${name}.json`), 'utf8')) as {
    elements: Element[]
    osm3s?: { timestamp_osm_base?: string }
  }

const metres = (p: LngLat, q: LngLat) => Math.hypot((q[0] - p[0]) * MX, (q[1] - p[1]) * MY)
const lengthOf = (points: LngLat[]) => points.reduce((sum, p, i) => (i === 0 ? 0 : sum + metres(points[i - 1]!, p)), 0)
const inside = ([x, y]: LngLat) => x >= WEST && x <= EAST && y >= SOUTH && y <= NORTH

/** The road class for a highway tag, or null for streets that are not modelled. */
function roadClass(highway: string | undefined): { kind: RoadClass; link: boolean } | null {
  if (!highway) return null
  const link = highway.endsWith('_link')
  const kind = (link ? highway.slice(0, -5) : highway) as RoadClass
  return CLASSES.includes(kind) ? { kind, link } : null
}

function describe(tags: Record<string, string>, kind: RoadClass, link: boolean): Road & { reversed: boolean } {
  const oneway =
    tags.oneway === 'yes' || tags.oneway === '1' || tags.oneway === '-1' || tags.junction === 'roundabout' ||
    (kind === 'motorway' && tags.oneway !== 'no')
  // Where lanes are not tagged but the width is, a lane is taken to be about 3.5 m.
  const wide = Math.floor(Number.parseFloat(tags.width ?? '') / 3.5)
  const tagged = Number.parseInt(tags.lanes ?? '', 10) || (wide > 0 ? Math.min(8, wide) : Number.NaN)
  const lanes = link
    ? Math.max(1, Math.min(2, tagged || 1))
    : Number.isFinite(tagged) && tagged > 0
      ? Math.min(6, Math.max(1, oneway ? tagged : Math.round(tagged / 2)))
      : DEFAULT_LANES[kind]
  const limit = Number.parseInt(tags.maxspeed ?? '', 10)
  const layerTag = Number.parseInt(tags.layer ?? '', 10)
  const bridge = !!tags.bridge && tags.bridge !== 'no'
  const tunnel = !!tags.tunnel && tags.tunnel !== 'no'
  const level = bridge ? Math.max(1, layerTag || 1) : tunnel ? Math.min(-1, layerTag || -1) : layerTag || 0
  return {
    kind,
    link,
    oneway,
    reversed: tags.oneway === '-1',
    lanes,
    speed: Number.isFinite(limit) && limit >= 10 ? limit : link ? 30 : DEFAULT_SPEED[kind],
    name: tags.name ?? tags.ref ?? null,
    level,
  }
}

/** Where the segment from an inside point to an outside one crosses the map's edge. */
function crossing(a: LngLat, b: LngLat): LngLat {
  let t = 1
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  if (b[0] < WEST) t = Math.min(t, (WEST - a[0]) / dx)
  if (b[0] > EAST) t = Math.min(t, (EAST - a[0]) / dx)
  if (b[1] < SOUTH) t = Math.min(t, (SOUTH - a[1]) / dy)
  if (b[1] > NORTH) t = Math.min(t, (NORTH - a[1]) / dy)
  return [a[0] + dx * t, a[1] + dy * t]
}

/** Drops points that lie within the tolerance of the line through their neighbours. */
function simplify(points: LngLat[]): LngLat[] {
  if (points.length < 3) return points
  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = keep[points.length - 1] = true
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [first, last] = stack.pop()!
    const ax = points[first]![0] * MX
    const ay = points[first]![1] * MY
    const bx = points[last]![0] * MX
    const by = points[last]![1] * MY
    const span = Math.hypot(bx - ax, by - ay)
    let worst = 0
    let index = -1
    for (let i = first + 1; i < last; i++) {
      const px = points[i]![0] * MX
      const py = points[i]![1] * MY
      const off = span === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / span
      if (off > worst) {
        worst = off
        index = i
      }
    }
    if (worst > TOLERANCE && index > 0) {
      keep[index] = true
      stack.push([first, index], [index, last])
    }
  }
  return points.filter((_, i) => keep[i])
}

const sameRoad = (p: Road, q: Road) =>
  p.kind === q.kind && p.link === q.link && p.lanes === q.lanes && p.oneway === q.oneway && p.speed === q.speed &&
  p.level === q.level && (p.name === q.name || p.name === null || q.name === null)

// Cut every way at the map's edge.
const roadLayer = layer('roads')
const position = new Map<number, LngLat>()
const ways: Element[] = []
for (const e of roadLayer.elements) {
  if (e.type === 'node') position.set(e.id, [e.lon!, e.lat!])
  else ways.push(e)
}
let madeUp = -1
const gatewayIds = new Set<number>()
const parts: { points: Point[]; road: Road }[] = []
for (const way of ways) {
  const found = roadClass(way.tags?.highway)
  if (!found || way.tags?.area === 'yes') continue
  const { reversed, ...road } = describe(way.tags ?? {}, found.kind, found.link)
  const ids = reversed ? [...way.nodes!].reverse() : way.nodes!
  const points = ids.filter((id) => position.has(id)).map((id) => ({ id, at: position.get(id)! }))
  const edge = (at: LngLat): Point => {
    const id = madeUp--
    gatewayIds.add(id)
    return { id, at }
  }
  let current: Point[] = []
  points.forEach((point, i) => {
    const previous = points[i - 1]
    if (inside(point.at)) {
      if (previous && !inside(previous.at)) current.push(edge(crossing(point.at, previous.at)))
      current.push(point)
    } else if (previous && inside(previous.at)) {
      current.push(edge(crossing(previous.at, point.at)))
      if (current.length > 1) parts.push({ points: current, road })
      current = []
    }
  })
  if (current.length > 1) parts.push({ points: current, road })
}

// Split at shared points, which is how OpenStreetMap marks a junction. A flyover shares no point with the road
// beneath it, so the two stay apart.
const uses = new Map<number, number>()
for (const { points } of parts) {
  points.forEach((p, i) => uses.set(p.id, (uses.get(p.id) ?? 0) + (i === 0 || i === points.length - 1 ? 2 : 1)))
}
const where = new Map<number, LngLat>()
const pieces: Piece[] = []
for (const { points, road } of parts) {
  let start = 0
  for (let i = 1; i < points.length; i++) {
    if ((uses.get(points[i]!.id) ?? 0) < 2 && i < points.length - 1) continue
    const stretch = points.slice(start, i + 1)
    start = i
    const first = stretch[0]!
    const last = stretch.at(-1)!
    where.set(first.id, first.at)
    where.set(last.id, last.at)
    pieces.push({ ...road, a: first.id, b: last.id, points: stretch.map((p) => p.at), alive: true })
  }
}
const rawPieces = pieces.length

// Junctions that are folded together: the two carriageways of a road leaving the map, and the ends of stretches
// too short to matter.
const parent = new Map<number, number>()
const find = (id: number): number => {
  let r = id
  while (parent.has(r)) r = parent.get(r)!
  if (r !== id) parent.set(id, r)
  return r
}
const fold = (keep: number, drop: number) => {
  const r = find(keep)
  const d = find(drop)
  if (r !== d) parent.set(d, r)
}
const gatewayList = [...gatewayIds].filter((id) => where.has(id))
for (let i = 0; i < gatewayList.length; i++) {
  for (let j = i + 1; j < gatewayList.length; j++) {
    if (metres(where.get(gatewayList[i]!)!, where.get(gatewayList[j]!)!) < GATEWAY_PAIR) fold(gatewayList[i]!, gatewayList[j]!)
  }
}

/** Points every piece's ends at the junction its ends were folded into, and drops pieces that became loops. */
function refold() {
  for (const piece of pieces) {
    if (!piece.alive) continue
    piece.a = find(piece.a)
    piece.b = find(piece.b)
    piece.points[0] = where.get(piece.a)!
    piece.points[piece.points.length - 1] = where.get(piece.b)!
    if (piece.a === piece.b) piece.alive = false
  }
}

function foldShort() {
  for (const piece of pieces) {
    if (!piece.alive || lengthOf(piece.points) >= SHORTEST) continue
    // A gateway stays where it is, on the edge.
    if (gatewayIds.has(find(piece.b))) fold(piece.b, piece.a)
    else fold(piece.a, piece.b)
    piece.alive = false
  }
  refold()
}

/** Joins the two pieces at a junction that only carries a road on, where they are the same road. */
function mergeChains() {
  const at = new Map<number, Set<Piece>>()
  const touch = (id: number, piece: Piece) => {
    if (!at.has(id)) at.set(id, new Set())
    at.get(id)!.add(piece)
  }
  for (const piece of pieces) {
    if (!piece.alive) continue
    touch(piece.a, piece)
    touch(piece.b, piece)
  }
  for (const [id, touching] of at) {
    if (touching.size !== 2 || gatewayIds.has(id)) continue
    const [p, q] = [...touching] as [Piece, Piece]
    if (p.a === p.b || q.a === q.b || !sameRoad(p, q)) continue
    // Orient so that p ends here and q starts here; a one-way piece cannot be turned round.
    let first = p
    let second = q
    if (p.oneway) {
      if (p.b === id && q.a === id) [first, second] = [p, q]
      else if (q.b === id && p.a === id) [first, second] = [q, p]
      else continue
    } else {
      if (p.b !== id) p.points.reverse(), ([p.a, p.b] = [p.b, p.a])
      if (q.a !== id) q.points.reverse(), ([q.a, q.b] = [q.b, q.a])
    }
    first.points = [...first.points, ...second.points.slice(1)]
    first.b = second.b
    first.name ??= second.name
    second.alive = false
    at.get(second.b)!.delete(second)
    at.get(second.b)!.add(first)
    if (first.a === first.b) {
      first.alive = false
      at.get(first.a)!.delete(first)
    }
  }
}

/**
 * Drops tertiary roads that lead nowhere: a dead end carries only the trips to its own end, and trips join the
 * network on roads of secondary class and above. Main roads that end, such as the one to the airport, stay.
 */
function pruneSpurs(): number {
  let pruned = 0
  for (let found = true; found; ) {
    found = false
    const next = new Map<number, Set<number>>()
    for (const p of pieces) {
      if (!p.alive) continue
      ;(next.get(p.a) ?? next.set(p.a, new Set()).get(p.a)!).add(p.b)
      ;(next.get(p.b) ?? next.set(p.b, new Set()).get(p.b)!).add(p.a)
    }
    for (const p of pieces) {
      if (!p.alive || p.kind !== 'tertiary') continue
      if ([p.a, p.b].some((end) => next.get(end)!.size === 1 && !gatewayIds.has(end))) {
        p.alive = false
        pruned++
        found = true
      }
    }
  }
  return pruned
}

/** Junctions that can both be reached from the one nearest the centre and get back to it. */
function joinedUp(): Set<number> {
  const alive = pieces.filter((p) => p.alive)
  let start = alive[0]!.a
  let best = Infinity
  for (const p of alive) {
    for (const id of [p.a, p.b]) {
      const d = metres(where.get(id)!, CENTRE)
      if (d < best) [best, start] = [d, id]
    }
  }
  const reach = (forward: boolean) => {
    const next = new Map<number, number[]>()
    const add = (x: number, y: number) => (next.get(x) ?? next.set(x, []).get(x)!).push(y)
    for (const { a, b, oneway } of alive) {
      if (forward || !oneway) add(a, b)
      if (!forward || !oneway) add(b, a)
    }
    const seen = new Set([start])
    const queue = [start]
    while (queue.length > 0) {
      for (const n of next.get(queue.pop()!) ?? []) {
        if (!seen.has(n)) seen.add(n), queue.push(n)
      }
    }
    return seen
  }
  const back = reach(false)
  return new Set([...reach(true)].filter((n) => back.has(n)))
}

/**
 * Puts on the ground every bridge or tunnel that passes over or under no other main road. Most are short bridges
 * over drains and streams; keeping their level would cut a road in three for nothing.
 */
function groundBridges(): number {
  // Segments are filed under every cell of a 500 m grid that their box touches.
  const cells = (a: LngLat, b: LngLat) => {
    const found: string[] = []
    for (let x = Math.floor(Math.min(a[0], b[0]) * 200); x <= Math.floor(Math.max(a[0], b[0]) * 200); x++) {
      for (let y = Math.floor(Math.min(a[1], b[1]) * 200); y <= Math.floor(Math.max(a[1], b[1]) * 200); y++) found.push(`${x},${y}`)
    }
    return found
  }
  const grid = new Map<string, [LngLat, LngLat, Piece][]>()
  for (const p of pieces) {
    for (let i = 1; i < p.points.length; i++) {
      const a = p.points[i - 1]!
      const b = p.points[i]!
      for (const c of cells(a, b)) (grid.get(c) ?? grid.set(c, []).get(c)!).push([a, b, p])
    }
  }
  const side = (a: LngLat, b: LngLat, c: LngLat) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
  const cross = (a: LngLat, b: LngLat, c: LngLat, d: LngLat) =>
    side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0
  let grounded = 0
  for (const p of pieces) {
    if (p.level === 0) continue
    let over = false
    for (let i = 1; i < p.points.length && !over; i++) {
      const a = p.points[i - 1]!
      const b = p.points[i]!
      for (const c of cells(a, b)) {
        for (const [x, y, q] of grid.get(c) ?? []) {
          if (q !== p && q.level !== p.level && cross(a, b, x, y)) over = true
        }
      }
    }
    if (!over) (p.level = 0), grounded++
  }
  return grounded
}

const grounded = groundBridges()
refold()
foldShort()
mergeChains()
const merged = pieces.filter((p) => p.alive).length
const keep = joinedUp()
let dropped = 0
for (const p of pieces) {
  if (p.alive && !(keep.has(p.a) && keep.has(p.b))) (p.alive = false), dropped++
}
const spurs = pruneSpurs()
for (let round = 0; round < 3; round++) {
  foldShort()
  mergeChains()
}
const kept = pieces.filter((p) => p.alive)

// Number the junctions, and give each its signal: a signal is often mapped just before the junction on each
// approach, so it goes to the junction nearest it within reach.
const nodeIndex = new Map<number, number>()
const nodes: NetworkNode[] = []
const round = (v: number) => Math.round(v * 1e6) / 1e6
const nodeFor = (id: number) => {
  let index = nodeIndex.get(id)
  if (index === undefined) {
    index = nodes.length
    const at = where.get(id)!
    nodes.push({ id: index, at: [round(at[0]), round(at[1])], ...(gatewayIds.has(id) ? { gateway: true } : {}) })
    nodeIndex.set(id, index)
  }
  return index
}
const links: NetworkLink[] = kept.map((p, id) => ({
  id,
  a: nodeFor(p.a),
  b: nodeFor(p.b),
  line: simplify(p.points).flatMap(([x, y]) => [round(x), round(y)]),
  length: Math.max(1, Math.round(lengthOf(p.points))),
  kind: p.kind,
  ...(p.link ? { link: true } : {}),
  lanes: p.lanes,
  oneway: p.oneway,
  speed: p.speed,
  name: p.name,
  level: p.level,
}))

const cell = (at: LngLat) => `${Math.floor(at[0] * 500)},${Math.floor(at[1] * 500)}`
const grid = new Map<string, number[]>()
for (const node of nodes) {
  if (!node.gateway) (grid.get(cell(node.at)) ?? grid.set(cell(node.at), []).get(cell(node.at))!).push(node.id)
}
let signals = 0
for (const e of layer('signals').elements) {
  const at: LngLat = [e.lon!, e.lat!]
  let best = -1
  let bestDistance = SIGNAL_REACH
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (const n of grid.get(cell([at[0] + dx / 500, at[1] + dy / 500])) ?? []) {
        const d = metres(at, nodes[n]!.at)
        if (d < bestDistance) [best, bestDistance] = [n, d]
      }
    }
  }
  if (best >= 0 && !nodes[best]!.signal) (nodes[best]!.signal = true), signals++
}

const network: Network = { nodes, links }
const path = join(root, 'public/data/network.json')
const text = JSON.stringify(network)
writeFileSync(path, text)

const byKind = Object.fromEntries(CLASSES.map((k) => [k, links.filter((l) => l.kind === k).length]))
const lengths = links.map((l) => l.length).sort((x, y) => x - y)
console.log(`data of ${roadLayer.osm3s?.timestamp_osm_base ?? 'unknown date'}`)
console.log(`${rawPieces} pieces split at shared points; ${merged} after folding short ones and merging chains;`)
console.log(`${grounded} bridges and tunnels over or under no main road put on the ground`)
console.log(`${dropped} dropped as not joined both ways to the centre, ${spurs} tertiary dead ends dropped;`)
console.log(`${links.length} stretches, ${nodes.length} junctions`)
console.log('by class:', byKind, 'slip roads:', links.filter((l) => (l as { link?: boolean }).link).length)
console.log(`${nodes.filter((n) => n.gateway).length} gateways, ${signals} signalled junctions`)
console.log(`length: shortest ${lengths[0]} m, median ${lengths[lengths.length >> 1]} m, total ${Math.round(lengths.reduce((s, l) => s + l, 0) / 1000)} km`)
console.log(`one-way ${links.filter((l) => l.oneway).length}, above ground ${links.filter((l) => l.level > 0).length}, below ${links.filter((l) => l.level < 0).length}`)
console.log(`${Math.round(text.length / 1024)} KB, ${Math.round(gzipSync(text).length / 1024)} KB compressed`)
