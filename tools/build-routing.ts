// Builds public/data/routing.json, the simplified road network that traffic is worked out on, from the drawn one in
// public/data/network.json. Run with: npx vite-node tools/build-routing.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import type { LngLat, Network, RoadClass, Zone } from '../src/data/types'
import type { RoutingLink, RoutingNetwork, RoutingNode } from '../src/sim/types'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const network = JSON.parse(readFileSync(join(root, 'public/data/network.json'), 'utf8')) as Network
const zones = JSON.parse(readFileSync(join(root, 'public/data/zones.json'), 'utf8')) as Zone[]

const MX = 111_320 * Math.cos(12.975 * (Math.PI / 180))
const MY = 110_540

/** Stretches this short are folded into one junction: mostly the gap across the median of a divided road. */
const SHORT = 40
/** No junction made by folding short stretches spans more than this, in metres, so that a dense grid is not swallowed. */
const SPAN = 100
/** Nor one made by folding slip roads, which is how a complex junction such as Silk Board becomes one node. */
const SLIP_SPAN = 150

/** The two carriageways of a divided road are taken to be one road where they run this close, in metres. */
const PAIR = 45
/** A junction on one carriageway is folded with one on the other within this distance along the road; further and a
 * junction is made on the other carriageway. */
const PAIR_SNAP = 30
/** Nor one made by pairing carriageways. */
const PAIR_SPAN = 130

/** A tertiary road on fewer of the quickest routes between zones and gateways than this is dropped. */
const LEAST_USE = 50

const RANK: Record<RoadClass, number> = { motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4 }

// Junctions folded together, each group with the box it covers in metres. Junctions made by cutting a stretch in two,
// to pair it with the other carriageway, are numbered after the drawn ones.
const position: LngLat[] = network.nodes.map((n) => n.at)
const parent = network.nodes.map((n) => n.id)
const box = network.nodes.map((n) => [n.at[0] * MX, n.at[1] * MY, n.at[0] * MX, n.at[1] * MY])
/**
 * The levels of the roads at each junction: '0' on the ground, '1' on a flyover, '0,1' where a flyover comes down.
 * Only junctions alike in this are folded together, so that a flyover or underpass does not gain the turns of the
 * junction it passes over or under, nor its signal.
 */
const levelSets = network.nodes.map(() => new Set<number>())
for (const l of network.links) levelSets[l.a]!.add(l.level), levelSets[l.b]!.add(l.level)
const levels = levelSets.map((found) => [...found].sort((x, y) => x - y).join(','))
/** The flyovers and underpasses that end at each group. A fold that would put both ends of one in a group is refused. */
const raised = network.nodes.map(() => new Set<number>())
for (const l of network.links) if (l.level !== 0) raised[l.a]!.add(l.id), raised[l.b]!.add(l.id)
function addNode(at: LngLat, level: number): number {
  const id = position.length
  position.push(at)
  parent.push(id)
  levels.push(String(level))
  raised.push(new Set())
  box.push([at[0] * MX, at[1] * MY, at[0] * MX, at[1] * MY])
  return id
}
const find = (id: number): number => {
  while (parent[id] !== id) id = parent[id] = parent[parent[id]!]!
  return id
}
function fold(a: number, b: number, span: number): boolean {
  const ra = find(a)
  const rb = find(b)
  if (ra === rb) return true
  if (levels[ra] !== levels[rb]) return false
  for (const id of raised[ra]!) if (raised[rb]!.has(id)) return false
  const p = box[ra]!
  const q = box[rb]!
  const joined = [Math.min(p[0]!, q[0]!), Math.min(p[1]!, q[1]!), Math.max(p[2]!, q[2]!), Math.max(p[3]!, q[3]!)]
  if (Math.hypot(joined[2]! - joined[0]!, joined[3]! - joined[1]!) > span) return false
  // The group keeps the lower id, so that the result does not depend on the order of folding.
  const [keep, drop] = ra < rb ? [ra, rb] : [rb, ra]
  parent[drop] = keep
  box[keep] = joined
  for (const id of raised[drop]!) raised[keep]!.add(id)
  return true
}

const byLength = [...network.links].sort((x, y) => x.length - y.length || x.id - y.id)
// A short flyover or underpass is kept whole, or it would vanish into the junction it passes.
for (const l of byLength) if (l.length <= SHORT && l.level === 0) fold(l.a, l.b, SPAN)

/** Where each drawn stretch is cut in two, as metres from its start and the junction made there. */
const cuts = new Map<number, { along: number; node: number }[]>()
/** Drawn stretches found to be one carriageway of a divided road. */
const divided = new Set<number>()
const paired = pairCarriageways()
for (const l of byLength) if (l.link) fold(l.a, l.b, SLIP_SPAN)

/**
 * Gives each junction on one carriageway of a divided road a partner on the other: the junction there if one is near,
 * or else a new one cut into the other carriageway. The two carriageways then run between the same junctions, and
 * become the two directions of one road.
 */
function pairCarriageways(): number {
  const carriageway = (l: Network['links'][number]) => l.oneway && !l.link && l.name !== null
  // Segments of carriageways, filed under every 0.0005 degree cell their box touches.
  const grid = new Map<string, [number, number][]>()
  for (const l of network.links) {
    if (!carriageway(l)) continue
    for (let i = 2; i < l.line.length; i += 2) {
      const [x0, x1] = [l.line[i - 2]!, l.line[i]!].sort((p, q) => p - q) as [number, number]
      const [y0, y1] = [l.line[i - 1]!, l.line[i + 1]!].sort((p, q) => p - q) as [number, number]
      for (let x = Math.floor(x0 * 2000); x <= Math.floor(x1 * 2000); x++) {
        for (let y = Math.floor(y0 * 2000); y <= Math.floor(y1 * 2000); y++) {
          const c = `${x},${y}`
          ;(grid.get(c) ?? grid.set(c, []).get(c)!).push([l.id, i - 2])
        }
      }
    }
  }
  // The way traffic runs on each carriageway at each of its ends.
  const heading = new Map<number, { link: number; name: string; level: number; dx: number; dy: number }>()
  for (const l of network.links) {
    if (!carriageway(l)) continue
    const n = l.line.length
    const at = (i: number) => [l.line[i]! * MX, l.line[i + 1]! * MY]
    for (const [node, p, q] of [[l.a, at(0), at(2)], [l.b, at(n - 4), at(n - 2)]] as [number, number[], number[]][]) {
      if (heading.has(node) || network.nodes[node]!.gateway) continue
      const d = Math.hypot(q[0]! - p[0]!, q[1]! - p[1]!) || 1
      heading.set(node, { link: l.id, name: l.name!, level: l.level, dx: (q[0]! - p[0]!) / d, dy: (q[1]! - p[1]!) / d })
    }
  }
  let count = 0
  for (const [node, h] of [...heading].sort((x, y) => x[0] - y[0])) {
    const [px, py] = [network.nodes[node]!.at[0] * MX, network.nodes[node]!.at[1] * MY]
    let best: { link: number; along: number; distance: number } | null = null
    const [cx, cy] = [Math.floor(network.nodes[node]!.at[0] * 2000), Math.floor(network.nodes[node]!.at[1] * 2000)]
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const [id, i] of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          const l = network.links[id]!
          if (l.name !== h.name || l.level !== h.level || l.a === node || l.b === node) continue
          const ax = l.line[i]! * MX
          const ay = l.line[i + 1]! * MY
          const sx = l.line[i + 2]! * MX - ax
          const sy = l.line[i + 3]! * MY - ay
          const span = Math.hypot(sx, sy)
          // Opposite ways: more than 135 degrees apart.
          if (span === 0 || (sx * h.dx + sy * h.dy) / span > -0.7) continue
          const t = Math.max(0, Math.min(1, ((px - ax) * sx + (py - ay) * sy) / (span * span)))
          const distance = Math.hypot(ax + t * sx - px, ay + t * sy - py)
          if (distance > PAIR || (best && distance >= best.distance)) continue
          let along = t * span
          for (let j = 2; j <= i; j += 2) {
            along += Math.hypot((l.line[j]! - l.line[j - 2]!) * MX, (l.line[j + 1]! - l.line[j - 1]!) * MY)
          }
          best = { link: id, along, distance }
        }
      }
    }
    if (!best) continue
    divided.add(h.link).add(best.link)
    const l = network.links[best.link]!
    const whole = drawnLength(l.line)
    const list = cuts.get(l.id) ?? []
    let target: number | undefined
    if (best.along < PAIR_SNAP) target = l.a
    else if (whole - best.along < PAIR_SNAP) target = l.b
    else target = list.find((c) => Math.abs(c.along - best.along) < PAIR_SNAP)?.node
    if (target === undefined) {
      target = addNode(pointAlong(l.line, best.along), l.level)
      list.push({ along: best.along, node: target })
      cuts.set(l.id, list)
    }
    if (fold(node, target, PAIR_SPAN)) count++
  }
  return count
}

function drawnLength(line: number[]): number {
  let sum = 0
  for (let i = 2; i < line.length; i += 2) sum += Math.hypot((line[i]! - line[i - 2]!) * MX, (line[i + 1]! - line[i - 1]!) * MY)
  return sum
}

function pointAlong(line: number[], along: number): LngLat {
  for (let i = 2; i < line.length; i += 2) {
    const step = Math.hypot((line[i]! - line[i - 2]!) * MX, (line[i + 1]! - line[i - 1]!) * MY)
    if (along <= step && step > 0) {
      const t = along / step
      return [line[i - 2]! + t * (line[i]! - line[i - 2]!), line[i - 1]! + t * (line[i + 1]! - line[i - 1]!)]
    }
    along -= step
  }
  return [line[line.length - 2]!, line[line.length - 1]!]
}

/** A directed piece of road between two groups, standing for one or more drawn stretches. */
interface Arc {
  from: number
  to: number
  length: number
  /** Seconds at free speed. */
  time: number
  lanes: number
  capacity: number
  /** Signalled junctions passed, counting the one at the end. */
  signals: number
  kind: RoadClass
  drawn: number[]
  forward: boolean[]
  /** Drawn stretches inside the groups this arc leaves, shown with it. */
  shown: number[]
  alive: boolean
}

// Lanes, free speed and capacity for each drawn stretch. The drawn network keeps lanes and speed but not whether they
// were mapped or guessed, so each stretch is matched back to the OpenStreetMap way it came from to find out.

interface Way {
  tags: Record<string, string>
}
/** A drawn stretch's lanes, free speed and capacity, and where each came from. */
interface RoadFacts {
  lanes: number
  speed: number
  /** Car equivalents an hour this direction, between junctions and at a signal at its end. */
  capacity: number
  atSignal: number
}

const osm = JSON.parse(readFileSync(join(root, 'tools/data/city.roads.json'), 'utf8')) as {
  elements: { type: string; id: number; lat?: number; lon?: number; nodes?: number[]; tags?: Record<string, string> }[]
}
const wayAt = new Map<string, Way[]>()
{
  const at = new Map<number, string>()
  for (const e of osm.elements) if (e.type === 'node') at.set(e.id, `${Math.round(e.lon! * 1e6)},${Math.round(e.lat! * 1e6)}`)
  for (const e of osm.elements) {
    if (e.type !== 'way' || !e.tags?.highway) continue
    for (const n of e.nodes ?? []) {
      const key = at.get(n)
      if (key) (wayAt.get(key) ?? wayAt.set(key, []).get(key)!).push(e as Way)
    }
  }
}

/** The way a drawn stretch came from: the one of its class that most of its points lie on. */
function wayOf(l: Network['links'][number]): Way | null {
  const highway = l.link ? `${l.kind}_link` : l.kind
  const votes = new Map<Way, number>()
  for (let i = 0; i < l.line.length; i += 2) {
    // Points inside the stretch count more than its ends, which are shared by every road at the junction.
    const weight = i === 0 || i === l.line.length - 2 ? 1 : 3
    for (const w of wayAt.get(`${Math.round(l.line[i]! * 1e6)},${Math.round(l.line[i + 1]! * 1e6)}`) ?? []) {
      if (w.tags.highway === highway) votes.set(w, (votes.get(w) ?? 0) + weight + (w.tags.name === l.name ? 1 : 0))
    }
  }
  let best: Way | null = null
  let most = 0
  for (const [w, n] of votes) if (n > most) [best, most] = [w, n]
  return best
}

/**
 * Design service volumes a lane from IRC:106-1990, Guidelines for Capacity of Urban Roads in Plain Areas, Table 2,
 * in car equivalents an hour: arterial 4-, 6- and 8-lane divided 3,600, 5,400 and 7,200 (900 a lane), 2-lane two-way
 * 1,500 and 4-lane undivided 3,000 (750 a lane), 2-lane one-way 2,400 (1,200 a lane); sub-arterial 2,900 and 4,300
 * divided (725 and 717 a lane, taken as 725), 1,200 and 2,400 undivided (600 a lane), 1,900 one-way (950 a lane);
 * collector 900 and 1,800 undivided (450 a lane), 1,400 one-way (700 a lane). They are for level of service C, which
 * the guideline puts at about 0.70 of capacity, so capacity is taken as the volume divided by 0.70.
 */
const DESIGN_VOLUME = {
  arterial: { divided: 900, undivided: 750, oneway: 1200 },
  subArterial: { divided: 725, undivided: 600, oneway: 950 },
  // IRC gives no divided collector; a divided tertiary road is taken to carry what a one-way one does.
  collector: { divided: 700, undivided: 450, oneway: 700 },
}
/** Which IRC:106 type each class is taken to be: a judgement, since the map's classes are not IRC's. */
const IRC_TYPE: Record<Exclude<RoadClass, 'motorway'>, keyof typeof DESIGN_VOLUME> = {
  trunk: 'arterial',
  primary: 'arterial',
  secondary: 'subArterial',
  tertiary: 'collector',
}
/**
 * IRC:106 covers no access-controlled road. A lane of a multi-lane divided highway in India was measured at 2,233 to
 * 2,250 car equivalents an hour (Sharma, Sarkar and Velmurugan, CRRI, "Estimation of capacity for multi-lane divided
 * inter-urban highways using videography"); 2,000 is taken for the city's expressways, which have merges every few
 * kilometres. A judgement.
 */
const MOTORWAY_LANE = 2000
/**
 * Saturation flow at a signal, car equivalents an hour a metre of approach width, from Indo-HCM (CSIR-CRRI, 2017),
 * signalised intersections: 630 below 7 m, 1,140 − 60w from 7 to 10.5 m, 500 above. A lane is taken as 3.5 m.
 */
const saturation = (lanes: number) => {
  const w = lanes * 3.5
  return w * (w < 7 ? 630 : w <= 10.5 ? 1140 - 60 * w : 500)
}
/** Share of the signal's cycle a road of each class gets green: a judgement, the main road getting the larger share. */
const GREEN: Record<RoadClass, number> = { motorway: 0.5, trunk: 0.5, primary: 0.45, secondary: 0.4, tertiary: 0.35 }

/**
 * Free speed, km/h, where the road's limit is not lower: what a car keeps up on an empty road, a judgement. Mapped
 * limits are only used to lower it, since a limit is not a speed that mixed traffic keeps (the airport road has 80 in
 * the right lane and 50 in the others; Deccan Herald, 15 July 2024).
 */
const FREE_SPEED: Record<RoadClass, { divided: number; undivided: number; oneway: number }> = {
  // NICE Road's limits are 120 for cars and 80 for motorcycles and goods vehicles (Deccan Herald, 3 August 2024).
  motorway: { divided: 80, undivided: 80, oneway: 80 },
  trunk: { divided: 60, undivided: 45, oneway: 50 },
  primary: { divided: 50, undivided: 35, oneway: 40 },
  secondary: { divided: 40, undivided: 30, oneway: 35 },
  tertiary: { divided: 30, undivided: 25, oneway: 25 },
}
const SLIP_SPEED = 30

/** Lanes a direction where the map does not say, by class and form: a judgement from how Bengaluru's roads are built. */
const DEFAULT_LANES: Record<RoadClass, { divided: number; undivided: number; oneway: number }> = {
  motorway: { divided: 2, undivided: 2, oneway: 2 },
  trunk: { divided: 3, undivided: 1, oneway: 2 },
  primary: { divided: 2, undivided: 2, oneway: 2 },
  secondary: { divided: 2, undivided: 1, oneway: 2 },
  tertiary: { divided: 1, undivided: 1, oneway: 1 },
}

/** Roads everyone knows, where the map gives no lanes: lanes a direction on the main carriageway. */
const NAMED: [RegExp, number][] = [
  [/outer ring road/i, 3],
  [/hosur road/i, 3],
  // Three lanes each way: overtaking, middle and heavy vehicles (Deccan Herald, 15 July 2024).
  [/bellary road|ballari road/i, 3],
  [/mysore road|mysuru road/i, 3],
  [/old madras road/i, 3],
  [/tumkur road|tumakuru road/i, 3],
  [/nice road|nice expressway/i, 2],
  [/electronic city flyover|elevated/i, 2],
]

const roadCounts = { lanesMapped: 0, lanesByName: 0, lanesByClass: 0, speedByLimit: 0, speedByClass: 0, noWay: 0 }
const roads: RoadFacts[] = network.links.map((l) => {
  const way = wayOf(l)
  if (!way) roadCounts.noWay++
  const tags = way?.tags ?? {}
  const form = l.link ? 'oneway' : divided.has(l.id) || (l.oneway && tags.dual_carriageway === 'yes') ? 'divided' : l.oneway ? 'oneway' : 'undivided'
  const mapped = !!(tags.lanes || tags['lanes:forward'] || tags.width)
  const named = !l.link && form === 'divided' ? NAMED.find(([re]) => re.test(l.name ?? '')) : undefined
  const lanes = mapped ? l.lanes : l.link ? 1 : named ? named[1] : DEFAULT_LANES[l.kind][form]
  if (mapped) roadCounts.lanesMapped++
  else if (named) roadCounts.lanesByName++
  else roadCounts.lanesByClass++
  const free = l.link ? SLIP_SPEED : FREE_SPEED[l.kind][form]
  const limit = Number.parseInt(tags.maxspeed ?? '', 10)
  const speed = Number.isFinite(limit) && limit >= 10 && limit < free ? limit : free
  if (speed < free) roadCounts.speedByLimit++
  else roadCounts.speedByClass++
  const perLane =
    l.kind === 'motorway' ? MOTORWAY_LANE : Math.round(DESIGN_VOLUME[IRC_TYPE[l.kind]][form] / 0.7 / 10) * 10
  return {
    lanes,
    speed,
    capacity: lanes * perLane,
    atSignal: Math.round((saturation(lanes) * GREEN[l.kind]) / 10) * 10,
  }
})
console.log('lanes and speeds:', roadCounts)

const signalled = new Set(network.nodes.filter((n) => n.signal).map((n) => find(n.id)))
const arcs: Arc[] = []
const loose: number[] = []
for (const l of network.links) {
  // A stretch cut to pair it with the other carriageway runs through the junctions made in it, in order.
  const whole = drawnLength(l.line) || 1
  const stops = [
    { along: 0, node: l.a },
    ...(cuts.get(l.id) ?? []).sort((x, y) => x.along - y.along),
    { along: whole, node: l.b },
  ]
  let inGroup = true
  for (let i = 1; i < stops.length; i++) {
    const from = find(stops[i - 1]!.node)
    const to = find(stops[i]!.node)
    if (from === to) continue
    inGroup = false
    const length = (l.length * (stops[i]!.along - stops[i - 1]!.along)) / whole
    const r = roads[l.id]!
    const make = (f: number, t: number, forward: boolean): Arc => ({
      from: f,
      to: t,
      length,
      time: length / (r.speed / 3.6),
      lanes: r.lanes,
      // A signal at the end of a piece limits what it can pass on.
      capacity: signalled.has(t) ? Math.min(r.capacity, r.atSignal) : r.capacity,
      signals: signalled.has(t) ? 1 : 0,
      kind: l.kind,
      drawn: [l.id],
      forward: [forward],
      shown: [],
      alive: true,
    })
    arcs.push(make(from, to, true))
    if (!l.oneway) arcs.push(make(to, from, false))
  }
  if (inGroup) loose.push(l.id)
}

// Stretches folded inside a group, such as the slip roads of a complex junction, are shown with the best road that
// leaves it.
const leaving = new Map<number, Arc>()
for (const a of arcs) {
  const best = leaving.get(a.from)
  if (!best || RANK[a.kind] < RANK[best.kind] || (a.kind === best.kind && a.capacity > best.capacity)) leaving.set(a.from, a)
}
for (const id of loose) leaving.get(find(network.links[id]!.a))?.shown.push(id)

const zoneGroup = zones.map((z) => find(z.node))
const kept = new Set<number>(zoneGroup)
for (const n of network.nodes) if (n.gateway) kept.add(find(n.id))

/** Joins arcs that run between the same two groups the same way: a flyover and the road beneath, say. */
function mergeParallel(): number {
  const seen = new Map<string, Arc>()
  let merged = 0
  for (const arc of arcs) {
    if (!arc.alive) continue
    const key = `${arc.from},${arc.to}`
    const other = seen.get(key)
    if (!other) {
      seen.set(key, arc)
      continue
    }
    const [main, minor] = other.capacity >= arc.capacity ? [other, arc] : [arc, other]
    main.capacity += minor.capacity
    main.lanes += minor.lanes
    main.drawn.push(...minor.drawn)
    main.forward.push(...minor.forward)
    main.shown.push(...minor.shown)
    if (RANK[minor.kind] < RANK[main.kind]) main.kind = minor.kind
    minor.alive = false
    if (main !== other) seen.set(key, main)
    merged++
  }
  return merged
}

/** Joins two arcs end to end, through a group that only carries one road on. */
function join2(first: Arc, second: Arc) {
  const kind = first.length >= second.length ? first.kind : second.kind
  first.to = second.to
  first.length += second.length
  first.time += second.time
  first.lanes = Math.min(first.lanes, second.lanes)
  first.capacity = Math.min(first.capacity, second.capacity)
  first.signals += second.signals
  first.kind = kind
  first.drawn.push(...second.drawn)
  first.forward.push(...second.forward)
  first.shown.push(...second.shown)
  second.alive = false
}

/** Removes groups where only two others meet and traffic can only pass through. */
function mergeChains(): number {
  const into = new Map<number, Arc[]>()
  const out = new Map<number, Arc[]>()
  for (const arc of arcs) {
    if (!arc.alive) continue
    ;(into.get(arc.to) ?? into.set(arc.to, []).get(arc.to)!).push(arc)
    ;(out.get(arc.from) ?? out.set(arc.from, []).get(arc.from)!).push(arc)
  }
  let merged = 0
  const groups = [...new Set([...into.keys(), ...out.keys()])].sort((x, y) => x - y)
  for (const v of groups) {
    if (kept.has(v)) continue
    const ins = (into.get(v) ?? []).filter((a) => a.alive)
    const outs = (out.get(v) ?? []).filter((a) => a.alive)
    const others = new Set([...ins.map((a) => a.from), ...outs.map((a) => a.to)])
    if (others.size !== 2 || ins.length === 0 || ins.length !== outs.length || ins.length > 2) continue
    const [u, w] = [...others] as [number, number]
    const pairs: [Arc, Arc][] = []
    for (const a of ins) {
      const onward = outs.find((b) => b.to === (a.from === u ? w : u))
      if (!onward) break
      pairs.push([a, onward])
    }
    if (pairs.length !== ins.length) continue
    for (const [a, b] of pairs) {
      join2(a, b)
      // The arc that was swallowed may be listed at its far end; point that end at the one that took it over.
      const list = into.get(a.to)!
      list[list.indexOf(b)] = a
    }
    merged++
  }
  return merged
}

for (let changed = true; changed; ) changed = mergeParallel() + mergeChains() > 0

/**
 * For each arc, how many of the quickest routes at free speed between zones and gateways use it. A tertiary road that
 * few use only duplicates a better road nearby; one that is a zone's way to the rest is used by all of that zone's.
 */
function usage(): Map<Arc, number> {
  const live = arcs.filter((a) => a.alive)
  const out = new Map<number, Arc[]>()
  for (const a of live) (out.get(a.from) ?? out.set(a.from, []).get(a.from)!).push(a)
  const used = new Map<Arc, number>(live.map((a) => [a, 0]))
  const ends = [...kept].sort((x, y) => x - y)
  for (const origin of ends) {
    const time = new Map<number, number>([[origin, 0]])
    const via = new Map<number, Arc>()
    const order: number[] = []
    const heap: [number, number][] = [[0, origin]]
    const done = new Set<number>()
    while (heap.length > 0) {
      const [t, v] = popMin(heap)
      if (done.has(v)) continue
      done.add(v)
      order.push(v)
      for (const a of out.get(v) ?? []) {
        const next = t + a.time
        if (next < (time.get(a.to) ?? Infinity)) time.set(a.to, next), via.set(a.to, a), pushMin(heap, [next, a.to])
      }
    }
    // Routes through each group, counted from the far ends back towards the origin.
    const below = new Map<number, number>()
    for (let i = order.length - 1; i > 0; i--) {
      const v = order[i]!
      const n = (below.get(v) ?? 0) + (kept.has(v) ? 1 : 0)
      const a = via.get(v)!
      used.set(a, used.get(a)! + n)
      below.set(a.from, (below.get(a.from) ?? 0) + n)
    }
  }
  return used
}

function pushMin(heap: [number, number][], item: [number, number]) {
  let i = heap.push(item) - 1
  while (i > 0) {
    const p = (i - 1) >> 1
    if (heap[p]![0] < item[0] || (heap[p]![0] === item[0] && heap[p]![1] <= item[1])) break
    heap[i] = heap[p]!
    i = p
  }
  heap[i] = item
}

function popMin(heap: [number, number][]): [number, number] {
  const top = heap[0]!
  const last = heap.pop()!
  if (heap.length > 0) {
    let i = 0
    for (;;) {
      let c = 2 * i + 1
      if (c >= heap.length) break
      const less = (x: [number, number], y: [number, number]) => x[0] < y[0] || (x[0] === y[0] && x[1] < y[1])
      if (c + 1 < heap.length && less(heap[c + 1]!, heap[c]!)) c++
      if (!less(heap[c]!, last)) break
      heap[i] = heap[c]!
      i = c
    }
    heap[i] = last
  }
  return top
}

const use = usage()
const before = arcs.filter((a) => a.alive).length
// Both directions of a tertiary road go or stay together, by the busier.
const roadUse = new Map<string, number>()
const roadKey = (a: Arc) => (a.from < a.to ? `${a.from},${a.to}` : `${a.to},${a.from}`)
for (const [a, n] of use) roadUse.set(roadKey(a), Math.max(roadUse.get(roadKey(a)) ?? 0, n))
let droppedTertiary = 0
for (const a of arcs) {
  const minor = a.drawn.every((d) => network.links[d]!.kind === 'tertiary')
  if (a.alive && minor && roadUse.get(roadKey(a))! < LEAST_USE) (a.alive = false), droppedTertiary++
}
for (let changed = true; changed; ) changed = mergeParallel() + mergeChains() > 0
console.log(`${before} arcs; ${droppedTertiary} tertiary arcs used by fewer than ${LEAST_USE} routes dropped`)

// Number what is left.
const alive = arcs.filter((a) => a.alive)
smoothDips(alive)
const used = [...new Set(alive.flatMap((a) => [a.from, a.to]).concat(zoneGroup))].sort((x, y) => x - y)
const index = new Map(used.map((g, i) => [g, i]))
const members = new Map<number, number[]>()
for (let n = 0; n < position.length; n++) {
  const g = find(n)
  if (index.has(g)) (members.get(g) ?? members.set(g, []).get(g)!).push(n)
}
const nodes: RoutingNode[] = used.map((g, id) => {
  const ms = members.get(g)!
  const drawn = ms.filter((m) => m < network.nodes.length).map((m) => network.nodes[m]!)
  const gateway = drawn.find((n) => n.gateway)
  // A gateway stays on the map's edge; other groups sit at the middle of their junctions.
  const at = gateway
    ? gateway.at
    : ms.reduce<LngLat>((s, m) => [s[0] + position[m]![0] / ms.length, s[1] + position[m]![1] / ms.length], [0, 0])
  return {
    id,
    at: [Math.round(at[0] * 1e6), Math.round(at[1] * 1e6)],
    gateway: !!gateway,
    signal: drawn.some((n) => n.signal),
  }
})

/**
 * A main road whose lanes drop for a short way and come back, as the Outer Ring Road does under the Silk Board flyover
 * (one lane for 680 m westbound, between three before and two after), is taken to keep its lanes: the drop is how a
 * stretch was mapped (a lane under a flyover, a ramp's width), not a narrowing of the road. For each run of links along
 * a road of one name, motorway to primary, of at most `DIP_LENGTH` metres, with more lanes both before and after it,
 * the run is given the lesser of the two (at most `DIP_MOST`), and capacity in proportion. Only lanes and capacity
 * change: which links there are, and their numbers, do not.
 */
function smoothDips(live: Arc[]) {
  const DIP_LENGTH = 2000
  // Wider stretches are mostly a main road and its service road taken as one: a dip between them is left alone.
  const DIP_MOST = 3
  const main = (a: Arc) => a.kind === 'motorway' || a.kind === 'trunk' || a.kind === 'primary'
  const nameOf = (a: Arc) => {
    const by = new Map<string, number>()
    for (const d of a.drawn) {
      const l = network.links[d]!
      if (l.name) by.set(l.name, (by.get(l.name) ?? 0) + l.length)
    }
    let best: string | null = null
    for (const [n, len] of by) if (best === null || len > by.get(best)!) best = n
    return best
  }
  const names = new Map(live.map((a) => [a, nameOf(a)]))
  const into = new Map<number, Arc[]>()
  const out = new Map<number, Arc[]>()
  for (const a of live) {
    ;(into.get(a.to) ?? into.set(a.to, []).get(a.to)!).push(a)
    ;(out.get(a.from) ?? out.set(a.from, []).get(a.from)!).push(a)
  }
  // Along the same road: the neighbour of the same name with the most lanes, not the way back.
  const along = (list: Arc[] | undefined, a: Arc, back: number) =>
    (list ?? [])
      .filter((b) => b !== a && main(b) && names.get(b) === names.get(a) && (back < 0 || b.from !== back && b.to !== back))
      .sort((x, y) => y.lanes - x.lanes)[0]
  const fixed: string[] = []
  // A dip in steps (three lanes, one, two, three) comes up a step each pass.
  for (let pass = 0; pass < 3; pass++) {
    for (const a of live) {
      if (!main(a) || !names.get(a) || a.lanes >= DIP_MOST) continue
      const before = along(into.get(a.from), a, a.to)
      if (!before || before.lanes <= a.lanes) continue
      // The run at this level or below, to where the road widens again.
      const run = [a]
      let length = a.length
      let after = along(out.get(a.to), a, a.from)
      while (after && after.lanes <= a.lanes && run.length < 8 && !run.includes(after)) {
        run.push(after)
        length += after.length
        after = along(out.get(after.to), after, after.from)
      }
      if (!after || after.lanes <= a.lanes || length > DIP_LENGTH) continue
      const lanes = Math.min(before.lanes, after.lanes, DIP_MOST)
      for (const r of run) {
        if (r.lanes >= lanes) continue
        const at = position[r.from]!.map((x) => x.toFixed(4)).reverse().join(', ')
        fixed.push(`${names.get(r)} ${r.lanes}→${lanes} (${Math.round(r.length)} m at ${at})`)
        r.capacity = (r.capacity * lanes) / r.lanes
        r.lanes = lanes
      }
    }
  }
  console.log(`lanes that dip and come back, raised: ${fixed.length}`)
  for (const f of fixed) console.log(`  ${f}`)
}

const links: RoutingLink[] = alive.map((a, id) => {
  // A stretch cut in two and joined up again is listed once.
  const all = [...a.drawn, ...a.shown]
  const forward = [...a.forward, ...a.shown.map(() => true)]
  const once = all.map((d, i) => all.indexOf(d) === i)
  return {
    id,
    from: index.get(a.from)!,
    to: index.get(a.to)!,
    length: Math.max(1, Math.round(a.length)),
    kind: a.kind,
    lanes: a.lanes,
    speed: Math.max(5, Math.round((a.length / a.time) * 3.6)),
    capacity: Math.round(a.capacity),
    signals: a.signals,
    drawn: all.filter((_, i) => once[i]),
    forward: forward.filter((_, i) => once[i]),
  }
})

const routing: RoutingNetwork = { nodes, links, zoneNode: zoneGroup.map((g) => index.get(g)!) }
const text = JSON.stringify(routing)
writeFileSync(join(root, 'public/data/routing.json'), text)
console.log(`${paired} carriageway junctions paired; ${nodes.length} nodes, ${links.length} links, ${nodes.filter((n) => n.gateway).length} gateways`)
console.log(`${Math.round(text.length / 1024)} KB, ${Math.round(gzipSync(text).length / 1024)} KB compressed`)
