import { describe, expect, it } from 'vitest'
import { rules } from '../src/rules/index'
import { costIndex } from '../src/rules/money'
import { JUNCTION, ROAD } from '../src/rules/params'
import { isShut, networkOf, onRoadsOf } from '../src/rules/roads'
import type { Action, Game, Plan, Stop } from '../src/rules/types'
import { simulate } from '../src/sim/index'
import { smallCity, testSeason } from './rules-city'

const city = smallCity()
const fresh = (money = testSeason.money) => rules.start({ ...testSeason, money }, city)
const end = (g: Game) => rules.endMonth(g, city, simulate(rules.state(g, city)))
/** A place on the small city's grid: x km east and y km north of its corner. */
const at = (x: number, y: number): Stop => ({ at: [77.55 + x / 108.48, 12.93 + y / 110.57] })
const node = (x: number, y: number) => y * 12 + x
const road = (stops: Stop[], lanes: 1 | 2 | 3 = 2, flyover = false): Plan => ({ kind: 'road', stops, lanes, flyover })
const links = city.roads.links.length
/** The link from one grid junction to the next. */
const link = (a: number, b: number) => city.roads.links.find((l) => l.from === a && l.to === b)!.id

function refused(g: Game, action: unknown): string {
  const before = JSON.stringify(g)
  const outcome = rules.act(g, city, action as Action)
  expect(outcome.ok).toBe(false)
  expect(JSON.stringify(g)).toBe(before)
  return outcome.ok ? '' : outcome.reason
}

/** Orders a plan and plays on until it has opened. */
function build(g: Game, plan: Plan) {
  expect(rules.act(g, city, { kind: 'build', plan })).toEqual({ ok: true })
  const p = g.projects!.at(-1)!
  while (g.month < p.opens) end(g)
  return p
}

describe('planning a road or a flyover', () => {
  it('snaps each place to a junction and meets the roads it crosses at their nearer junction, within 400 m', () => {
    const q = rules.quote(fresh(), city, road([at(1.1, 2), at(9, 4.9)]))
    expect(q.ok).toBe(true)
    expect(q.major).toBe(true)
    // From (1,2) to (9,5): it crosses the grid's lines, and bends to meet those whose junction is near the crossing.
    const nodes = q.stations.map((s) => [Math.round((s.at[0] - 77.55) * 108.48), Math.round((s.at[1] - 12.93) * 110.57)])
    expect(nodes[0]).toEqual([1, 2])
    expect(nodes.at(-1)).toEqual([9, 5])
    expect(nodes).toContainEqual([4, 3])
    expect(nodes.length).toBeGreaterThan(4)
    expect(q.stations[0]!.stop).toBe(0)
    expect(q.stations.at(-1)!.stop).toBe(1)
    expect(q.stations.slice(1, -1).every((s) => s.stop === undefined)).toBe(true)
    // Land is a large part of a road on the ground; the months are 1 to 2 years.
    expect(q.land).toBeGreaterThan(0)
    expect(q.cost).toBeGreaterThan(q.land!)
    expect(q.months).toBeGreaterThanOrEqual(12)
    expect(q.months).toBeLessThanOrEqual(24)
    expect(q.running).toBeGreaterThan(0)
    // The roads at its ends lose a lane while it is built: every link in and out of its first and last junctions.
    expect(q.disrupted.length).toBe(16)
  })

  it('as a flyover meets nothing between its ends, takes no land, and costs more a km in works', () => {
    const ground = rules.quote(fresh(), city, road([at(1, 2), at(7, 5)]))
    const flyover = rules.quote(fresh(), city, road([at(1, 2), at(7, 5)], 2, true))
    expect(flyover.ok).toBe(true)
    expect(flyover.stations).toHaveLength(2)
    expect(flyover.land).toBeUndefined()
    expect(flyover.length).toBeLessThanOrEqual(ground.length)
    expect(ground.stations.length).toBeGreaterThan(2)
    expect(flyover.cost).toBe(Math.round((Math.round((flyover.length * 2 * 2 * ROAD.flyoverLaneKm) / 1000) * costIndex(0)) / 10_000))
    expect(ground.cost - ground.land!).toBeLessThan(flyover.cost)
  })

  it('refuses what cannot be built', () => {
    const g = fresh()
    expect(rules.quote(g, city, road([at(1, 1)])).reason).toMatch(/at least two places/)
    expect(rules.quote(g, city, road([at(1, 1), at(1.1, 1.1)])).reason).toMatch(/same junction/)
    expect(rules.quote(g, city, road([at(1, 1), at(3, 1), at(1, 1)])).reason).toMatch(/same junction twice/)
    expect(rules.quote(g, city, road([at(1, 1), at(30, 30)])).reason).toMatch(/no main road within 2 km/)
    expect(rules.quote(g, city, { ...road([at(1, 1), at(3, 1)]), lanes: 4 } as unknown as Plan).reason).toMatch(/1, 2 or 3 lanes/)
    expect(rules.quote(g, city, road([at(0, 0), at(11, 11)], 2, true)).reason).toMatch(/at most 8 km/)
    expect(refused(g, { kind: 'build', plan: { kind: 'road', stops: [at(1, 1), at(3, 1)], lanes: 2 } })).toMatch(/flyover/)
  })

  it('gives the same road every time from the same places', () => {
    const plan = road([at(1, 2), at(6, 7.8), at(10, 4)])
    expect(JSON.stringify(rules.quote(fresh(), city, plan))).toBe(JSON.stringify(rules.quote(fresh(), city, plan)))
  })
})

describe('a road built and opened', () => {
  const g = fresh()
  expect(rules.act(g, city, { kind: 'build', plan: road([at(1, 2), at(9, 5)]) })).toEqual({ ok: true })
  const p = g.projects![0]!
  const during = rules.state(g, city)
  while (g.month < p.opens) end(g)
  const after = rules.state(g, city)

  it('takes a lane from the roads at its ends while it is built, and none once open', () => {
    expect(during.works).toEqual(p.quote.disrupted)
    expect(after.works).toBeUndefined()
  })

  it('appends its links after the city\'s, both ways, and moves no id that was there', () => {
    const net = after.roads
    expect(net.links.length).toBe(links + 2 * (p.quote.stations.length - 1))
    expect(net.nodes.length).toBe(city.roads.nodes.length)
    expect(net.zoneNode).toEqual(city.roads.zoneNode)
    for (const l of city.roads.links) {
      const m = net.links[l.id]!
      expect([m.id, m.from, m.to, m.length, m.lanes]).toEqual([l.id, l.from, l.to, l.length, l.lanes])
    }
    for (const l of net.links.slice(links)) {
      expect(l.lanes).toBe(2)
      expect(l.kind).toBe('primary')
      expect(l.drawn).toEqual([])
    }
    // Where it meets other roads there are signals now, on every road in.
    expect(net.nodes[node(4, 3)]!.signal).toBe(true)
    const into = net.links.find((l) => l.to === node(4, 3) && l.id < links)!
    expect(into.signals).toBe((city.roads.links[into.id]!.signals ?? 0) + (city.roads.nodes[node(4, 3)]!.signal ? 0 : 1))
  })

  it('is drawn, adds to the upkeep for good, and the model runs on it', () => {
    expect(g.built!.roads).toHaveLength(1)
    expect(g.built!.roads![0]).toMatchObject({ lanes: 2, flyover: false, path: p.quote.path })
    expect(g.built!.roads![0]!.nodes![0]).toBe(node(1, 2))
    const upkeep = (x: Game) => -rules.books(x, city).find((e) => e.key === 'upkeep')!.amount
    const without = { ...g, built: { ...g.built!, roads: [] } }
    expect(upkeep(g)).toBeGreaterThan(upkeep(without))
    const r = simulate(after)
    expect(r.flow.morning.length).toBe(after.roads.links.length)
    expect(Number.isFinite(r.commute)).toBe(true)
    expect(g.reports.flatMap((x) => x.news).join(' ')).toMatch(/The new road from .* opens: [\d.]+ km, 2 lanes each way/)
  })
})

describe('work at junctions', () => {
  it('signals: cheap, a month, minor; refused where there are signals already or fewer than three roads meet', () => {
    const g = fresh()
    const q = rules.quote(g, city, { kind: 'junction', node: node(5, 5), work: 'signal' })
    expect(q).toMatchObject({ ok: true, months: JUNCTION.signal.months, major: false })
    expect(rules.quote(g, city, { kind: 'junction', node: node(4, 4), work: 'signal' }).reason).toMatch(/signals already/)
    expect(rules.quote(g, city, { kind: 'junction', node: node(0, 0), work: 'redesign' }).reason).toMatch(/three roads/)
    expect(rules.quote(g, city, { kind: 'junction', node: 99_999, work: 'redesign' }).reason).toMatch(/no such junction/)
    expect(rules.quote(g, city, { kind: 'junction', node: node(5, 5), work: 'tunnel' } as unknown as Plan).ok).toBe(false)
  })

  it('a redesign gives the roads in a quarter more room; an overpass lifts the main road over, a major work', () => {
    const g = fresh()
    const redesign = build(g, { kind: 'junction', node: node(5, 5), work: 'redesign' })
    expect(redesign.quote.major).toBe(false)
    let net = rules.state(g, city).roads
    for (const l of net.links.filter((x) => x.to === node(5, 5))) {
      expect(l.capacity).toBe(Math.round((city.roads.links[l.id]!.capacity * JUNCTION.redesign.capacity) / 1000))
    }
    expect(net.nodes[node(5, 5)]!.work).toBe('redesign')
    const q = rules.quote(g, city, { kind: 'junction', node: node(8, 4), work: 'overpass' })
    expect(q.ok && q.major).toBe(true)
    // The main road through: the busiest road in and on straight, both ways, loses a lane while it is built.
    expect(q.disrupted).toHaveLength(4)
    const over = build(g, { kind: 'junction', node: node(8, 4), work: 'overpass' })
    net = rules.state(g, city).roads
    const main = over.quote.disrupted.map((id) => net.links[id]!).filter((l) => l.to === node(8, 4))
    expect(main).toHaveLength(2)
    for (const l of main) {
      expect(l.capacity).toBe(Math.round((city.roads.links[l.id]!.capacity * JUNCTION.overpass.capacity) / 1000))
      expect(l.signals).toBe((city.roads.links[l.id]!.signals ?? 1) - 1)
    }
    expect(rules.quote(g, city, { kind: 'junction', node: node(8, 4), work: 'redesign' }).reason).toMatch(/lifted over/)
  })
})

describe('one-way streets', () => {
  it('shuts the other way and gives its lanes to this one, at once, and two-way again', () => {
    const g = fresh()
    const id = link(node(4, 4), node(5, 4))
    const back = link(node(5, 4), node(4, 4))
    expect(rules.act(g, city, { kind: 'build', plan: { kind: 'oneWay', link: id, on: true } })).toEqual({ ok: true })
    expect(g.projects).toEqual([])
    expect(g.built!.oneWay).toEqual([id])
    const net = rules.state(g, city).roads
    expect(net.links[id]!.lanes).toBe(4)
    expect(net.links[id]!.capacity).toBe(2 * city.roads.links[id]!.capacity)
    expect(isShut(net.links[back]!)).toBe(true)
    expect(net.links.length).toBe(links)
    expect(Number.isFinite(simulate(rules.state(g, city)).commute)).toBe(true)
    expect(refused(g, { kind: 'build', plan: { kind: 'oneWay', link: back, on: true } })).toMatch(/other way already/)
    expect(refused(g, { kind: 'build', plan: { kind: 'oneWay', link: id, on: true } })).toMatch(/one-way already/)
    expect(rules.act(g, city, { kind: 'build', plan: { kind: 'oneWay', link: id, on: false } })).toEqual({ ok: true })
    expect(rules.state(g, city).roads).toBe(city.roads)
    expect(refused(g, { kind: 'build', plan: { kind: 'oneWay', link: id, on: false } })).toMatch(/not one-way/)
  })

  it('is refused where it would leave a junction that cannot be reached or left', () => {
    const g = fresh()
    // The corner has two roads: both made one-way into it, it could not be left.
    expect(rules.act(g, city, { kind: 'build', plan: { kind: 'oneWay', link: link(node(1, 0), node(0, 0)), on: true } })).toEqual({ ok: true })
    expect(refused(g, { kind: 'build', plan: { kind: 'oneWay', link: link(node(0, 1), node(0, 0)), on: true } })).toMatch(/could not be reached, or left/)
    expect(refused(g, { kind: 'build', plan: { kind: 'oneWay', link: 99_999, on: true } })).toMatch(/not a main road/)
  })
})

describe('footpaths, speed limits and taller building', () => {
  it('footpaths: priced by the main road in the zone, months, narrower roads there once laid', () => {
    const g = fresh()
    const q = rules.quote(g, city, { kind: 'footpaths', zone: 4 })
    expect(q.ok).toBe(true)
    expect(q.major).toBe(false)
    expect(q.length).toBeGreaterThan(0)
    expect(q.months).toBeGreaterThanOrEqual(2)
    expect(q.months).toBeLessThanOrEqual(6)
    build(g, { kind: 'footpaths', zone: 4 })
    const s = rules.state(g, city)
    expect(s.footpaths).toEqual([4])
    expect(s.roads.links.some((l) => l.capacity < city.roads.links[l.id]!.capacity)).toBe(true)
    expect(rules.quote(g, city, { kind: 'footpaths', zone: 4 }).reason).toMatch(/footpaths already/)
    expect(rules.books(g, city).some((e) => e.key === 'footpaths')).toBe(true)
    expect(rules.quote(g, city, { kind: 'footpaths', zone: 999 }).reason).toMatch(/no such zone/)
  })

  it('speed limits: at once, on the roads of the zone that run faster, and lifted', () => {
    const g = fresh()
    expect(rules.quote(g, city, { kind: 'speedLimit', zone: 4, limit: 35 }).reason).toMatch(/30, 40, 50/)
    expect(rules.act(g, city, { kind: 'build', plan: { kind: 'speedLimit', zone: 4, limit: 30 } })).toEqual({ ok: true })
    const s = rules.state(g, city)
    const limited = Object.entries(s.limits ?? {})
    expect(limited.length).toBeGreaterThan(0)
    for (const [id, limit] of limited) {
      expect(limit).toBe(30)
      expect(city.roads.links[Number(id)]!.speed).toBeGreaterThan(30)
    }
    expect(refused(g, { kind: 'build', plan: { kind: 'speedLimit', zone: 4, limit: 30 } })).toMatch(/30 km\/h already/)
    expect(rules.act(g, city, { kind: 'build', plan: { kind: 'speedLimit', zone: 4, limit: null } })).toEqual({ ok: true })
    expect(rules.state(g, city).limits).toBeUndefined()
    // Held to a limit, those who drive there like it less: a limit in every zone of the small city is felt.
    for (const z of city.zones) rules.act(g, city, { kind: 'build', plan: { kind: 'speedLimit', zone: z.id, limit: 30 } })
    end(g)
    expect(g.pressures!.some((p) => /speed limits/.test(p.text))).toBe(true)
  })

  it('taller building: only near a station, a major action, drawing growth and selling building rights', () => {
    const g = fresh()
    // Zone 3 is beside the east-west line; zone 0 is 2 km from any station.
    expect(rules.quote(g, city, { kind: 'density', zone: 0, on: true }).reason).toMatch(/no metro or suburban station/)
    const q = rules.quote(g, city, { kind: 'density', zone: 3, on: true })
    expect(q.ok && q.major).toBe(true)
    const plain = fresh()
    expect(rules.act(g, city, { kind: 'build', plan: { kind: 'density', zone: 3, on: true } })).toEqual({ ok: true })
    for (let k = 0; k < 24; k++) {
      end(g)
      end(plain)
    }
    expect(g.zonePeople![3]!).toBeGreaterThan(plain.zonePeople![3]!)
    expect(g.reports.at(-1)!.books.find((e) => e.key === 'rights')!.amount).toBeGreaterThan(0)
    expect(g.reports[0]!.figures.find((f) => f.key === 'approval')!.causes.some((c) => /taller building/.test(c.text))).toBe(true)
  })
})

describe('growth by zone', () => {
  it('grows each zone by its own rate, in whole people that add up to the city', () => {
    const g = fresh()
    for (let k = 0; k < 36; k++) end(g)
    const people = g.zonePeople!
    expect(people.every((p) => Number.isInteger(p) && p >= 0)).toBe(true)
    const start = city.zones.reduce((a, z) => a + z.people, 0)
    expect(people.reduce((a, b) => a + b, 0)).toBe(Math.round((start * g.people) / 10_000))
    // Not alike: some zones grew faster than others.
    const rates = people.map((p, k) => p / city.zones[k]!.people)
    expect(Math.max(...rates) - Math.min(...rates)).toBeGreaterThan(0.005)
    // The model is given them.
    expect(rules.state(g, city).zones.map((z) => z.people)).toEqual(people)
  })

  it('the network for the same roads is made once', () => {
    const g = fresh()
    rules.act(g, city, { kind: 'build', plan: { kind: 'oneWay', link: link(node(4, 4), node(5, 4)), on: true } })
    expect(rules.state(g, city).roads).toBe(rules.state(g, city).roads)
    expect(networkOf(city, onRoadsOf(g.built!))).toBe(rules.state(g, city).roads)
  })
})

describe('snapping a lone tap for a road', () => {
  it('goes to the nearest junction, named, or says why not', () => {
    const g = fresh()
    const s = rules.snap!(g, city, 'road', at(3.2, 4.1))
    expect('reason' in s).toBe(false)
    if (!('reason' in s)) {
      expect(s.at[0]).toBeCloseTo(77.55 + 3 / 108.48, 5)
      expect(s.name).toMatch(/^Zone/)
    }
    expect(rules.snap!(g, city, 'road', at(40, 40))).toEqual({ reason: expect.stringMatching(/no main road within 2 km/) })
  })
})
