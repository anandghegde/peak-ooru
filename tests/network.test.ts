import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type { LngLat, Network } from '../src/data/types'

const text = readFileSync(new URL('../public/data/network.json', import.meta.url), 'utf8')
const { nodes, links } = JSON.parse(text) as Network
const MX = 111_320 * Math.cos(12.975 * (Math.PI / 180))
const MY = 110_540
const metres = (p: LngLat, q: LngLat) => Math.hypot((q[0] - p[0]) * MX, (q[1] - p[1]) * MY)

function lineLength(line: number[]): number {
  let total = 0
  for (let i = 2; i < line.length; i += 2) total += metres([line[i - 2]!, line[i - 1]!], [line[i]!, line[i + 1]!])
  return total
}

describe('the road network', () => {
  it('numbers junctions and stretches by their place in the file', () => {
    nodes.forEach((node, i) => expect(node.id).toBe(i))
    links.forEach((link, i) => expect(link.id).toBe(i))
  })

  it('joins every stretch to junctions that exist, and draws it from one to the other', () => {
    for (const link of links) {
      const a = nodes[link.a]
      const b = nodes[link.b]
      expect(a && b, `stretch ${link.id}`).toBeTruthy()
      expect(link.a).not.toBe(link.b)
      expect(metres(a!.at, [link.line[0]!, link.line[1]!])).toBeLessThan(0.5)
      expect(metres(b!.at, [link.line.at(-2)!, link.line.at(-1)!])).toBeLessThan(0.5)
    }
  })

  it('gives each stretch the length of its line, give or take the points dropped in simplifying it', () => {
    for (const link of links) {
      const drawn = lineLength(link.line)
      expect(drawn, `stretch ${link.id}`).toBeLessThanOrEqual(link.length + 1)
      expect(drawn, `stretch ${link.id}`).toBeGreaterThan(link.length * 0.97 - 2)
    }
  })

  it('has no stretch too short to matter', () => {
    expect(Math.min(...links.map((l) => l.length))).toBeGreaterThanOrEqual(5)
  })

  it('lets every junction be reached from the centre and get back to it', () => {
    let start = 0
    for (const node of nodes) if (metres(node.at, [77.5946, 12.9716]) < metres(nodes[start]!.at, [77.5946, 12.9716])) start = node.id
    const reach = (forward: boolean) => {
      const next: number[][] = nodes.map(() => [])
      for (const { a, b, oneway } of links) {
        if (forward || !oneway) next[a]!.push(b)
        if (!forward || !oneway) next[b]!.push(a)
      }
      const seen = new Uint8Array(nodes.length)
      seen[start] = 1
      const queue = [start]
      let count = 1
      while (queue.length > 0) {
        for (const n of next[queue.pop()!]!) {
          if (!seen[n]) (seen[n] = 1), count++, queue.push(n)
        }
      }
      return count
    }
    expect(reach(true)).toBe(nodes.length)
    expect(reach(false)).toBe(nodes.length)
  })

  it('keeps no junction that only carries one road on unchanged', () => {
    const touching: number[][] = nodes.map(() => [])
    for (const link of links) touching[link.a]!.push(link.id), touching[link.b]!.push(link.id)
    const needless = nodes.filter((node) => {
      const [p, q] = touching[node.id]!.map((id) => links[id]!)
      if (touching[node.id]!.length !== 2 || node.gateway) return false
      const same = p!.kind === q!.kind && p!.lanes === q!.lanes && p!.oneway === q!.oneway && p!.speed === q!.speed &&
        p!.level === q!.level && !!p!.link === !!q!.link && (p!.name === q!.name || !p!.name || !q!.name)
      const through = !p!.oneway || (p!.b === node.id) !== (q!.b === node.id)
      return same && through
    })
    expect(needless.length).toBe(0)
  })

  it('puts gateways on the edge of the map', () => {
    const gateways = nodes.filter((n) => n.gateway)
    expect(gateways.length).toBeGreaterThan(10)
    for (const { at: [x, y] } of gateways) {
      const edge = Math.min(Math.abs(x - 77.35), Math.abs(x - 77.85)) * MX < 100 ||
        Math.min(Math.abs(y - 12.75), Math.abs(y - 13.2)) * MY < 100
      expect(edge).toBe(true)
    }
  })

  it('gives every stretch at least one lane and a free speed', () => {
    for (const link of links) {
      expect(link.lanes).toBeGreaterThanOrEqual(1)
      expect(link.speed).toBeGreaterThanOrEqual(10)
    }
  })

  it('fits in 1.5 MB compressed', () => {
    expect(gzipSync(text).length).toBeLessThan(1.5 * 1024 * 1024)
  })
})
