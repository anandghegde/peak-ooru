import { existsSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type { LngLat, Network, Zone } from '../src/data/types'
import type { ZoneOutlines } from '../src/data/zones'

const read = (file: string) => readFileSync(new URL(`../public/data/${file}`, import.meta.url), 'utf8')
const zones = JSON.parse(read('zones.json')) as Zone[]
const outlinesText = read('zones.geojson')
const outlines = JSON.parse(outlinesText) as ZoneOutlines
const networkFile = new URL('../public/data/network.json', import.meta.url)

type Ring = number[][]
const polygons = (geometry: ZoneOutlines['features'][number]['geometry']) =>
  (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates) as Ring[][]

function inRing([x, y]: LngLat, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number]
    const [xj, yj] = ring[j] as [number, number]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const inOutline = (point: LngLat, rings: Ring[][]) =>
  rings.some(([outer, ...holes]) => inRing(point, outer!) && !holes.some((hole) => inRing(point, hole)))

const outlineOf = new Map(outlines.features.map((feature) => [feature.properties.id, polygons(feature.geometry)]))
const total = (key: 'people' | 'jobs') => zones.reduce((sum, zone) => sum + zone[key], 0)

describe('the zones', () => {
  it('number zones by their place in the file, and give each one outline', () => {
    zones.forEach((zone, i) => expect(zone.id).toBe(i))
    expect(outlines.features).toHaveLength(zones.length)
    expect(new Set(outlineOf.keys()).size).toBe(zones.length)
  })

  it('come to between 200 and 450, the ward zones among them 369', () => {
    expect(zones.length).toBeGreaterThanOrEqual(200)
    expect(zones.length).toBeLessThanOrEqual(450)
    expect(zones.filter((zone) => zone.ward !== undefined)).toHaveLength(369)
  })

  it('place each centre inside its own outline', () => {
    for (const zone of zones) expect(inOutline(zone.centre, outlineOf.get(zone.id)!), zone.name).toBe(true)
  })

  it('cover the whole game area between them', () => {
    const area = zones.reduce((sum, zone) => sum + zone.area, 0)
    const game = 0.5 * 111.32 * Math.cos((12.975 * Math.PI) / 180) * 0.45 * 110.57
    expect(area / game).toBeGreaterThan(0.99)
    expect(area / game).toBeLessThan(1.01)
  })

  it('give every zone a name, figures that are whole and not negative, and an income from 1 to 5', () => {
    for (const zone of zones) {
      expect(zone.name.length, `zone ${zone.id}`).toBeGreaterThan(0)
      expect(Number.isInteger(zone.people) && zone.people >= 0, zone.name).toBe(true)
      expect(Number.isInteger(zone.jobs) && zone.jobs >= 0, zone.name).toBe(true)
      expect([1, 2, 3, 4, 5]).toContain(zone.income)
    }
  })

  it('hold the people and jobs of a city of about fourteen million', () => {
    expect(total('people')).toBeGreaterThan(12_000_000)
    expect(total('people')).toBeLessThan(18_000_000)
    expect(total('jobs')).toBeGreaterThan(0.35 * total('people'))
    expect(total('jobs')).toBeLessThan(0.55 * total('people'))
  })

  it('put more people to the square kilometre in the wards than in the country outside them', () => {
    const density = (list: Zone[]) =>
      list.reduce((s, z) => s + z.people, 0) / list.reduce((s, z) => s + z.area, 0)
    const wards = zones.filter((zone) => zone.ward !== undefined)
    const outer = zones.filter((zone) => zone.ward === undefined)
    expect(density(wards)).toBeGreaterThan(4 * density(outer))
  })

  it('keep the outlines small enough to load at once', () => {
    expect(gzipSync(outlinesText).length).toBeLessThan(600_000)
    expect(outlinesText).not.toMatch(/\d\.\d{6,}/)
  })

  it('join each zone to a junction of the road network inside it', () => {
    if (!existsSync(networkFile)) return
    const { nodes } = JSON.parse(readFileSync(networkFile, 'utf8')) as Network
    const outside = zones.filter((zone) => {
      const node = nodes[zone.node]
      return !node || !inOutline(node.at, outlineOf.get(zone.id)!)
    })
    // A zone with no main road in it is joined to the nearest junction; there should be few.
    expect(zones.every((zone) => nodes[zone.node] !== undefined)).toBe(true)
    expect(outside.length).toBeLessThan(zones.length * 0.05)
  })
})
