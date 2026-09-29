import { describe, expect, it } from 'vitest'
import type { Network, NetworkLink } from '../src/data/types'
import {
  gradeOf, linkDelays, linksOfRun, namedRun, patchesShort, roadKm, worstRoads, type LinkDelay,
} from '../src/game/upkeep'
import { alongside } from '../src/map/build'
import { deathRates } from '../src/map/zones'
import { crore } from '../src/ui/format'
import { fixtureCity } from './sim-fixture'

/** A drawn network of stretches in a row, each joined to the next, with the names given. */
function row(names: (string | null)[]): Network {
  const links: NetworkLink[] = names.map((name, i) => ({
    id: i, a: i, b: i + 1, line: [77.5 + i * 0.01, 12.9, 77.51 + i * 0.01, 12.9], length: 1000, kind: 'primary',
    lanes: 2, oneway: false, speed: 50, name, level: 0,
  }))
  return { nodes: names.map((_, i) => ({ id: i, at: [77.5 + i * 0.01, 12.9] })), links }
}

describe('the state of the roads on the screen', () => {
  it('grades a condition as the brief does: good from 75, fair from 50, poor from 25, broken under', () => {
    expect([100, 75, 74, 50, 49, 25, 24, 0].map(gradeOf)).toEqual([0, 0, 1, 1, 2, 2, 3, 3])
  })

  it('says a patch is short-lived when laid from May to September', () => {
    expect([3, 4, 5, 8, 9].map(patchesShort)).toEqual([false, true, true, true, false])
    expect(patchesShort(12 + 6)).toBe(true)
  })

  it('offers only the connected run of a named road, not every road of that name in the city', () => {
    const net = row(['Hosur Road', 'Hosur Road', 'Hosur Road', 'Bannerghatta Road', 'Hosur Road', 'Main Road'])
    expect(namedRun(net, 1)).toEqual([0, 1, 2])
    expect(namedRun(net, 4)).toEqual([4])
    expect(namedRun(net, 5)).toEqual([5])
  })

  it('carries a road through the flyovers and unnamed pieces that cut it, and not far along another road', () => {
    const net = row(['Outer Ring Road', null, 'Silk Board Flyover', 'Outer Ring Road Underpass', 'Outer Ring Road', null, null, null, null, 'Outer Ring Road'])
    expect(namedRun(net, 0)).toEqual([0, 1, 2, 3, 4])
    expect(namedRun(net, 1)).toEqual([])
  })

  it('takes the links of a run that are under a condition, and counts a two-way road once in km', () => {
    const links = [
      { id: 0, drawn: [0], length: 1000 }, { id: 1, drawn: [0], length: 1000 },
      { id: 2, drawn: [1], length: 800 }, { id: 3, drawn: [5], length: 500 },
    ]
    const chosen = linksOfRun([0, 1], links, [30, 30, 80, 10], 50)
    expect(chosen.map((l) => l.id)).toEqual([0, 1])
    expect(roadKm(chosen)).toBe(1)
  })

  it('counts a divided road, mapped as two one-way carriageways, once', () => {
    const net = row(['Hosur Road', 'Hosur Road', 'Hosur Road'])
    net.links[1]!.oneway = true
    net.links[2]!.oneway = true
    expect(roadKm([{ drawn: [0], length: 1000 }, { drawn: [1], length: 1000 }, { drawn: [2], length: 1000 }], net)).toBe(2)
  })

  it('ranks the worst roads by the time their surface costs, and names them by their run', () => {
    const net = row(['Hosur Road', 'Hosur Road', 'Old Madras Road', null])
    const d = (id: number, drawn: number[], hours: number): LinkDelay =>
      ({ id, drawn, condition: 30, hours, seconds: 20, evening: 1000, length: 1000, lanes: 2 })
    const worst = worstRoads(net, [d(0, [0], 50), d(1, [1], 40), d(2, [2], 70), d(3, [3], 500)])
    expect(worst.map((w) => w.name)).toEqual(['Hosur Road', 'Old Madras Road'])
    expect(worst[0]!.hours).toBe(90)
    expect(worst[0]!.links).toEqual([0, 1])
  })

  it('finds no delay on a good road and more on a worse one with the same traffic', () => {
    const state = fixtureCity()
    const n = state.roads.links.length
    const flat = (v: number) => ({ morning: new Int32Array(n).fill(v), midday: new Int32Array(n).fill(v), evening: new Int32Array(n).fill(v), night: new Int32Array(n).fill(v) })
    const speed = { morning: new Int16Array(n).fill(800), midday: new Int16Array(n).fill(800), evening: new Int16Array(n).fill(800), night: new Int16Array(n).fill(800) }
    const result = { flow: flat(1000), speed } as never
    const condition = state.roads.links.map((l) => (l.id === 0 ? 20 : l.id === 1 ? 45 : 90))
    const delays = linkDelays(state.roads, result, condition)
    expect(delays.map((x) => x.id)).toEqual([0, 1])
    expect(delays[0]!.hours).toBeGreaterThan(delays[1]!.hours)
  })

  it('shades road deaths by people living there, leaving zones with few people clear', () => {
    const zones = [{ id: 0, people: 100_000 }, { id: 1, people: 400_000 }, { id: 2, people: 500 }] as never
    expect(deathRates(zones, [10, 10, 3])).toEqual([10, 2.5, -1])
  })

  it('draws a flyover beside a railway it runs along, and not one that only crosses it', () => {
    const track = [77.5, 12.9, 77.6, 12.9]
    expect(alongside([77.52, 12.9001, 77.56, 12.9001], [track])).toBe(true)
    expect(alongside([77.55, 12.85, 77.55, 12.95], [track])).toBe(false)
  })

  it('says a patch that costs a few lakh in lakh, not as nothing', () => {
    expect(crore(1)).toBe('₹1 lakh')
    expect(crore(450)).toBe('₹4.5 crore')
  })
})
