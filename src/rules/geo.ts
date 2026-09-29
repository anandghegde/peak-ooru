import type { RoutingNetwork } from '../sim/types'

/*
 * Places and distances for planning, in whole metres east and north of 77°E 12.5°N: a millionth of a degree is
 * 0.10848 m east and 0.11057 m north at Bengaluru's latitude (the same scale as `lineMetres`). Only addition,
 * multiplication, division, rounding and square roots, which every machine does alike.
 */

const EAST = 108_480
const NORTH = 110_570
const LNG0 = 77_000_000
const LAT0 = 12_500_000

/** Degrees to whole millionths of a degree. */
export const micro = (deg: number) => Math.round(deg * 1e6)

/** Whole metres east and north, from millionths of a degree. */
export const east = (lngMicro: number) => Math.round(((lngMicro - LNG0) * EAST) / 1e6)
export const north = (latMicro: number) => Math.round(((latMicro - LAT0) * NORTH) / 1e6)
/** Millionths of a degree back from metres, whole. */
export const lngOf = (x: number) => LNG0 + Math.round((x * 1e6) / EAST)
export const latOf = (y: number) => LAT0 + Math.round((y * 1e6) / NORTH)

/** Whole metres between two points given in metres. */
export function metres(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx
  const dy = ay - by
  return Math.round(Math.sqrt(dx * dx + dy * dy))
}

const CELL = 500

/** The routing network arranged for planning. */
export interface RoadIndex {
  roads: RoutingNetwork
  x: Int32Array
  y: Int32Array
  /** Links leaving and entering each node. */
  out: number[][]
  into: number[][]
  /** The link from a to b, by `a * nodes + b`. */
  between: Map<number, number>
  /** Nodes on at least one road that is not a motorway: where a bus can stop. */
  street: Uint8Array
  /** Nodes by grid cell of 500 m. */
  cells: Map<number, number[]>
  /** Links by every grid cell their straight line passes near. */
  linkCells: Map<number, number[]>
}

const cellKey = (cx: number, cy: number) => cx * 100_000 + cy
const cellOf = (v: number) => Math.floor(v / CELL)

const indexes = new WeakMap<RoutingNetwork, RoadIndex>()

export function roadIndex(roads: RoutingNetwork): RoadIndex {
  let ix = indexes.get(roads)
  if (ix) return ix
  const n = roads.nodes.length
  const x = new Int32Array(n)
  const y = new Int32Array(n)
  const out: number[][] = Array.from({ length: n }, () => [])
  const into: number[][] = Array.from({ length: n }, () => [])
  const street = new Uint8Array(n)
  const cells = new Map<number, number[]>()
  const linkCells = new Map<number, number[]>()
  const between = new Map<number, number>()
  for (const node of roads.nodes) {
    x[node.id] = east(node.at[0])
    y[node.id] = north(node.at[1])
    const key = cellKey(cellOf(x[node.id]!), cellOf(y[node.id]!))
    const list = cells.get(key)
    if (list) list.push(node.id)
    else cells.set(key, [node.id])
  }
  for (const link of roads.links) {
    out[link.from]!.push(link.id)
    into[link.to]!.push(link.id)
    between.set(link.from * n + link.to, link.id)
    if (link.kind !== 'motorway') street[link.from] = street[link.to] = 1
    const x0 = Math.min(x[link.from]!, x[link.to]!)
    const x1 = Math.max(x[link.from]!, x[link.to]!)
    const y0 = Math.min(y[link.from]!, y[link.to]!)
    const y1 = Math.max(y[link.from]!, y[link.to]!)
    for (let cx = cellOf(x0); cx <= cellOf(x1); cx++) {
      for (let cy = cellOf(y0); cy <= cellOf(y1); cy++) {
        const key = cellKey(cx, cy)
        const list = linkCells.get(key)
        if (list) list.push(link.id)
        else linkCells.set(key, [link.id])
      }
    }
  }
  ix = { roads, x, y, out, into, between, street, cells, linkCells }
  indexes.set(roads, ix)
  return ix
}

/** The nearest node within `reach` metres that `ok` allows, or -1; ties to the lower id. */
export function nearestNode(ix: RoadIndex, px: number, py: number, reach: number, ok?: (node: number) => boolean) {
  let best = -1
  let bestD = reach + 1
  const r = Math.ceil(reach / CELL)
  const cx = cellOf(px)
  const cy = cellOf(py)
  for (let i = cx - r; i <= cx + r; i++) {
    for (let j = cy - r; j <= cy + r; j++) {
      for (const node of ix.cells.get(cellKey(i, j)) ?? []) {
        const d = metres(px, py, ix.x[node]!, ix.y[node]!)
        if (d < bestD || (d === bestD && node < best)) {
          if (ok && !ok(node)) continue
          best = node
          bestD = d
        }
      }
    }
  }
  return { node: best, metres: best < 0 ? Infinity : bestD }
}

/**
 * The nearest point on the straight line of a link within `reach`, for links that run nearly straight (at most a
 * tenth longer than the line between their ends), or null. The point is given with its metres from each end.
 */
export function nearestOnLink(ix: RoadIndex, px: number, py: number, reach: number) {
  let best: { link: number; x: number; y: number; metres: number; fromEnd: number; toEnd: number } | null = null
  const r = Math.ceil(reach / CELL)
  const cx = cellOf(px)
  const cy = cellOf(py)
  const seen = new Set<number>()
  for (let i = cx - r; i <= cx + r; i++) {
    for (let j = cy - r; j <= cy + r; j++) {
      for (const id of ix.linkCells.get(cellKey(i, j)) ?? []) {
        if (seen.has(id)) continue
        seen.add(id)
        const link = ix.roads.links[id]!
        const ax = ix.x[link.from]!
        const ay = ix.y[link.from]!
        const bx = ix.x[link.to]!
        const by = ix.y[link.to]!
        const chord2 = (bx - ax) * (bx - ax) + (by - ay) * (by - ay)
        if (chord2 === 0) continue
        const chord = Math.sqrt(chord2)
        if (link.length * 10 > chord * 11) continue
        // Where along the line the point falls, in millionths, kept inside the ends.
        const t = Math.max(0, Math.min(1_000_000, Math.round((((px - ax) * (bx - ax) + (py - ay) * (by - ay)) * 1_000_000) / chord2)))
        const qx = ax + Math.round(((bx - ax) * t) / 1_000_000)
        const qy = ay + Math.round(((by - ay) * t) / 1_000_000)
        const d = metres(px, py, qx, qy)
        if (d > reach) continue
        if (!best || d < best.metres || (d === best.metres && id < best.link)) {
          const fromEnd = Math.round((link.length * t) / 1_000_000)
          best = { link: id, x: qx, y: qy, metres: d, fromEnd, toEnd: link.length - fromEnd }
        }
      }
    }
  }
  return best
}

/** A way onto the network from a place: a node, and the metres (or seconds) to reach it. */
export type Entry = [node: number, cost: number]

/**
 * Shortest paths from the entries `from` to the entries `to`, over links weighted by `weight` (a whole number, or
 * Infinity to leave the link out), following links forward, or either way when `bothWays`. Returns the least total
 * and the nodes along the way, first to last, or null if there is no way within `most`.
 */
export function shortest(
  ix: RoadIndex,
  from: Entry[],
  to: Entry[],
  weight: (link: number) => number,
  bothWays: boolean,
  most = Infinity,
): { cost: number; nodes: number[]; links: number[] } | null {
  const n = ix.roads.nodes.length
  const dist = new Float64Array(n).fill(Infinity)
  const via = new Int32Array(n).fill(-1)
  const done = new Uint8Array(n)
  const heap = new Heap()
  for (const [node, cost] of from) {
    if (cost < dist[node]!) {
      dist[node] = cost
      heap.push(cost, node)
    }
  }
  const targets = new Map<number, number>()
  for (const [node, cost] of to) targets.set(node, Math.min(targets.get(node) ?? Infinity, cost))
  let left = targets.size
  let best = Infinity
  let bestNode = -1
  while (heap.size) {
    const [d, u] = heap.pop()
    if (done[u] || d > dist[u]!) continue
    if (d > most || d >= best) break
    done[u] = 1
    const end = targets.get(u)
    if (end !== undefined) {
      if (d + end < best || (d + end === best && u < bestNode)) {
        best = d + end
        bestNode = u
      }
      if (--left === 0) break
    }
    const relax = (link: number, v: number) => {
      const w = weight(link)
      if (w === Infinity) return
      const nd = d + w
      if (nd < dist[v]!) {
        dist[v] = nd
        via[v] = link
        heap.push(nd, v)
      }
    }
    for (const link of ix.out[u]!) relax(link, ix.roads.links[link]!.to)
    if (bothWays) for (const link of ix.into[u]!) relax(link, ix.roads.links[link]!.from)
  }
  if (bestNode < 0 || best > most) return null
  const nodes: number[] = []
  const links: number[] = []
  let v = bestNode
  while (via[v]! >= 0) {
    const link = ix.roads.links[via[v]!]!
    nodes.push(v)
    links.push(link.id)
    v = link.to === v ? link.from : link.to
  }
  nodes.push(v)
  return { cost: best, nodes: nodes.reverse(), links: links.reverse() }
}

/** A binary heap of (cost, node), least cost first, ties to the lower node: the same order everywhere. */
class Heap {
  private c: number[] = []
  private n: number[] = []
  get size() {
    return this.c.length
  }
  private less(i: number, j: number) {
    return this.c[i]! < this.c[j]! || (this.c[i] === this.c[j] && this.n[i]! < this.n[j]!)
  }
  private swap(i: number, j: number) {
    const c = this.c[i]!
    const n = this.n[i]!
    this.c[i] = this.c[j]!
    this.n[i] = this.n[j]!
    this.c[j] = c
    this.n[j] = n
  }
  push(cost: number, node: number) {
    this.c.push(cost)
    this.n.push(node)
    let i = this.c.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!this.less(i, p)) break
      this.swap(i, p)
      i = p
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.c[0]!, this.n[0]!]
    const lastC = this.c.pop()!
    const lastN = this.n.pop()!
    if (this.c.length) {
      this.c[0] = lastC
      this.n[0] = lastN
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < this.c.length && this.less(l, m)) m = l
        if (r < this.c.length && this.less(r, m)) m = r
        if (m === i) break
        this.swap(i, m)
        i = m
      }
    }
    return top
  }
}
