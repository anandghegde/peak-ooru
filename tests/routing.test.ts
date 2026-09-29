import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { LngLat, Network, Zone } from '../src/data/types'
import type { RoutingNetwork } from '../src/sim/types'

const read = <T>(file: string) => JSON.parse(readFileSync(new URL(`../public/data/${file}`, import.meta.url), 'utf8')) as T
const routing = read<RoutingNetwork>('routing.json')
const drawn = read<Network>('network.json')
const zones = read<Zone[]>('zones.json')
const { nodes, links } = routing
const MX = 111_320 * Math.cos(12.975 * (Math.PI / 180))
const MY = 110_540
const metres = (p: LngLat, q: LngLat) => Math.hypot((q[0] - p[0]) * MX, (q[1] - p[1]) * MY)

/** Nodes that can be reached from the start, following links forwards or, if `back`, backwards. */
function reach(start: number, back: boolean): Uint8Array {
  const next: number[][] = nodes.map(() => [])
  for (const l of links) back ? next[l.to]!.push(l.from) : next[l.from]!.push(l.to)
  const seen = new Uint8Array(nodes.length)
  seen[start] = 1
  const queue = [start]
  while (queue.length > 0) {
    for (const n of next[queue.pop()!]!) if (!seen[n]) (seen[n] = 1), queue.push(n)
  }
  return seen
}

describe('the roads for traffic', () => {
  it('numbers nodes and links by their place in the file, and joins links to nodes that exist', () => {
    nodes.forEach((node, i) => expect(node.id).toBe(i))
    links.forEach((link, i) => {
      expect(link.id).toBe(i)
      expect(nodes[link.from] && nodes[link.to], `link ${i}`).toBeTruthy()
      expect(link.from).not.toBe(link.to)
    })
  })

  it('keeps positions, lengths, speeds, lanes and capacities as whole numbers that make sense', () => {
    for (const node of nodes) node.at.forEach((v) => expect(Number.isInteger(v)).toBe(true))
    for (const l of links) {
      for (const v of [l.length, l.speed, l.lanes, l.capacity]) expect(Number.isInteger(v) && v > 0, `link ${l.id}`).toBe(true)
      expect(l.speed).toBeLessThanOrEqual(80)
      expect(l.lanes).toBeLessThanOrEqual(8)
      // Capacity a lane is somewhere between a signalled city street and an expressway.
      expect(l.capacity / l.lanes).toBeGreaterThanOrEqual(300)
      expect(l.capacity / l.lanes).toBeLessThanOrEqual(2000)
    }
  })

  it('is of the size the brief asks for', () => {
    expect(links.length).toBeLessThanOrEqual(5500)
    expect(links.length).toBeGreaterThan(3000)
  })

  it('lists for each link the drawn stretches it stands for, all of which exist', () => {
    for (const l of links) {
      expect(l.drawn.length, `link ${l.id}`).toBeGreaterThan(0)
      expect(l.forward.length).toBe(l.drawn.length)
      for (const id of l.drawn) expect(drawn.links[id], `stretch ${id}`).toBeTruthy()
    }
  })

  it('stands for nearly every drawn stretch of secondary class and above', () => {
    const shown = new Set(links.flatMap((l) => l.drawn))
    const main = drawn.links.filter((l) => l.kind !== 'tertiary')
    expect(main.filter((l) => shown.has(l.id)).length / main.length).toBeGreaterThan(0.99)
  })

  it('gives every zone a node, near its node on the drawn roads', () => {
    expect(routing.zoneNode.length).toBe(zones.length)
    zones.forEach((zone, i) => {
      const node = nodes[routing.zoneNode[i]!]!
      const at: LngLat = [node.at[0] / 1e6, node.at[1] / 1e6]
      expect(metres(at, drawn.nodes[zone.node]!.at), zone.name).toBeLessThan(200)
    })
  })

  it('lets every zone and gateway reach every other, and be reached from it', () => {
    const start = routing.zoneNode[0]!
    const out = reach(start, false)
    const back = reach(start, true)
    const ends = [...routing.zoneNode, ...nodes.filter((n) => n.gateway).map((n) => n.id)]
    for (const n of ends) expect(out[n] && back[n], `node ${n}`).toBeTruthy()
    expect(nodes.filter((n) => n.gateway).length).toBe(drawn.nodes.filter((n) => n.gateway).length)
  })

  it('works out a shortest-path tree from every zone in a small fraction of a second', () => {
    const count = new Int32Array(nodes.length + 1)
    for (const l of links) count[l.from + 1]!++
    for (let i = 0; i < nodes.length; i++) count[i + 1]! += count[i]!
    const to = new Int32Array(links.length)
    const cost = new Int32Array(links.length)
    const place = count.slice()
    for (const l of links) {
      const k = place[l.from]!++
      to[k] = l.to
      cost[k] = Math.round((l.length * 36) / l.speed)
    }
    const time = new Int32Array(nodes.length)
    const heap = new Int32Array(links.length + nodes.length)
    const key = new Int32Array(heap.length)
    const tree = (start: number) => {
      time.fill(0x7fffffff)
      time[start] = 0
      let size = 0
      const push = (v: number, k: number) => {
        let i = size++
        while (i > 0 && key[(i - 1) >> 1]! > k) (heap[i] = heap[(i - 1) >> 1]!), (key[i] = key[(i - 1) >> 1]!), (i = (i - 1) >> 1)
        heap[i] = v
        key[i] = k
      }
      push(start, 0)
      while (size > 0) {
        const v = heap[0]!
        const k = key[0]!
        const lastV = heap[--size]!
        const lastK = key[size]!
        let i = 0
        for (let c = 1; c < size; c = 2 * i + 1) {
          if (c + 1 < size && key[c + 1]! < key[c]!) c++
          if (key[c]! >= lastK) break
          heap[i] = heap[c]!
          key[i] = key[c]!
          i = c
        }
        heap[i] = lastV
        key[i] = lastK
        if (k > time[v]!) continue
        for (let e = count[v]!; e < count[v + 1]!; e++) {
          if (k + cost[e]! < time[to[e]!]!) (time[to[e]!] = k + cost[e]!), push(to[e]!, k + cost[e]!)
        }
      }
    }
    for (const z of routing.zoneNode) tree(z)
    const begun = performance.now()
    for (const z of routing.zoneNode) tree(z)
    const took = performance.now() - begun
    console.log(`${routing.zoneNode.length} shortest-path trees on ${links.length} links: ${Math.round(took)} ms`)
    expect(took).toBeLessThan(300)
  })

  it('does not join a flyover to the road it passes over where they cross', () => {
    // Find where drawn stretches at different levels cross without meeting.
    const cell = (x: number, y: number) => `${Math.floor(x * 200)},${Math.floor(y * 200)}`
    const grid = new Map<string, [number, number][]>()
    for (const l of drawn.links) {
      for (let i = 2; i < l.line.length; i += 2) {
        const key = cell(l.line[i]!, l.line[i + 1]!)
        ;(grid.get(key) ?? grid.set(key, []).get(key)!).push([l.id, i])
      }
    }
    const side = (a: number[], b: number[], c: number[]) =>
      Math.sign((b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!))
    const ends = new Map<number, Set<number>>()
    for (const l of links) {
      for (const id of l.drawn) (ends.get(id) ?? ends.set(id, new Set()).get(id)!).add(l.from).add(l.to)
    }
    let crossings = 0
    let joined = 0
    for (const segments of grid.values()) {
      for (let x = 0; x < segments.length; x++) {
        for (let y = x + 1; y < segments.length; y++) {
          const [p, i] = segments[x]!
          const [q, j] = segments[y]!
          const [f, g] = [drawn.links[p]!, drawn.links[q]!]
          if (f.level === g.level || [f.a, f.b].some((n) => n === g.a || n === g.b)) continue
          const a = [f.line[i - 2]!, f.line[i - 1]!]
          const b = [f.line[i]!, f.line[i + 1]!]
          const c = [g.line[j - 2]!, g.line[j - 1]!]
          const d = [g.line[j]!, g.line[j + 1]!]
          if (side(a, b, c) * side(a, b, d) >= 0 || side(c, d, a) * side(c, d, b) >= 0) continue
          crossings++
          const over: LngLat = [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2]
          const shared = [...(ends.get(p) ?? [])].filter((n) => ends.get(q)?.has(n))
          if (shared.some((n) => metres([nodes[n]!.at[0] / 1e6, nodes[n]!.at[1] / 1e6], over) < 30)) joined++
        }
      }
    }
    expect(crossings).toBeGreaterThan(500)
    // A few short flyovers and underpasses come down within a few tens of metres of a junction and so meet it there.
    expect(joined).toBeLessThanOrEqual(12)
  })
})
