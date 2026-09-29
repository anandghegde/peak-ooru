import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { LngLat, Transit } from '../src/data/types'

const { stations, lines } = JSON.parse(
  readFileSync(new URL('../public/data/transit.json', import.meta.url), 'utf8'),
) as Transit
const MX = 111_320 * Math.cos(12.975 * (Math.PI / 180))
const MY = 110_540
const metres = (p: LngLat, q: LngLat) => Math.hypot((q[0] - p[0]) * MX, (q[1] - p[1]) * MY)
const line = (id: string) => lines.find((l) => l.id === id)!
const names = (id: string) => line(id).stations.map((s) => stations[s]!.name)

/** How far a point is from a path given as lng, lat, lng, lat…, and how far along the path it comes. */
function onPath(path: number[], at: LngLat): { off: number; along: number } {
  let best = { off: Infinity, along: 0 }
  let travelled = 0
  for (let i = 2; i < path.length; i += 2) {
    const a: LngLat = [path[i - 2]!, path[i - 1]!]
    const dx = (path[i]! - a[0]) * MX
    const dy = (path[i + 1]! - a[1]) * MY
    const px = (at[0] - a[0]) * MX
    const py = (at[1] - a[1]) * MY
    const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy || 1)))
    const off = Math.hypot(px - dx * t, py - dy * t)
    if (off < best.off) best = { off, along: travelled + Math.hypot(dx, dy) * t }
    travelled += Math.hypot(dx, dy)
  }
  return best
}

describe('transit', () => {
  it('has the three metro lines in service and the two being built', () => {
    for (const id of ['purple', 'green', 'yellow']) expect(line(id).status).toBe('open')
    for (const id of ['pink', 'blue']) expect(line(id).status).toBe('building')
  })

  it('runs the metro lines through their published stations, in order', () => {
    // Counts and ends from the published lists of Namma Metro's lines, as on Wikipedia in September 2026.
    expect(names('purple')).toHaveLength(37)
    expect(names('green')).toHaveLength(32)
    expect(names('yellow')).toHaveLength(16)
    expect(`${names('purple')[0]} ${names('purple').at(-1)}`).toMatch(/Challaghatta.*Whitefield|Whitefield.*Challaghatta/)
    expect(`${names('green')[0]} ${names('green').at(-1)}`).toMatch(/Madavara.*Silk Institute|Silk Institute.*Madavara/)
    expect(names('pink')).toHaveLength(18)
    expect(names('blue')).toHaveLength(29)
    expect(`${names('yellow')[0]} ${names('yellow').at(-1)}`).toMatch(/Rashtreeya Vidyalaya.*Bommasandra|Bommasandra.*Rashtreeya Vidyalaya/)
  })

  it('places every station of a line on its track, in order along it', () => {
    for (const l of lines) {
      let last = -1
      for (const s of l.stations) {
        const { off, along } = onPath(l.path, stations[s]!.at)
        expect(off, `${l.name}: ${stations[s]!.name}`).toBeLessThan(150)
        expect(along, `${l.name}: ${stations[s]!.name}`).toBeGreaterThanOrEqual(last)
        last = along
      }
    }
  })

  it('makes Majestic one interchange of the Purple and Green lines', () => {
    const majestic = stations.filter((s) => /majestic/i.test(s.name) && s.kind === 'metro')
    expect(majestic.length).toBeGreaterThan(0)
    const numbers = new Set(majestic.map((s) => s.interchange))
    expect(numbers.size).toBe(1)
    expect([...numbers][0]).toBeDefined()
  })

  it('gives stations their Kannada names where the map has them', () => {
    const metro = stations.filter((s) => s.kind === 'metro')
    expect(metro.filter((s) => s.nameKn).length).toBeGreaterThan(metro.length * 0.9)
  })

  it('has suburban railway with stations', () => {
    const rail = lines.filter((l) => l.kind === 'rail')
    expect(rail.length).toBeGreaterThan(3)
    for (const l of rail) expect(l.stations.length).toBeGreaterThan(1)
  })
})
