import { describe, expect, it } from 'vitest'
import { rules } from '../src/rules/index'
import type { Action, Game, Stop } from '../src/rules/types'
import type { CityState } from '../src/sim/types'
import { simulate } from '../src/sim/index'
import { smallCity, testSeason } from './rules-city'

const city = smallCity()
const at = (x: number, y: number): Stop => ({ at: [77.55 + x / 108.48, 12.93 + y / 110.57] })
const node = (x: number, y: number) => y * 12 + x
const link = (a: number, b: number) => city.roads.links.find((l) => l.from === a && l.to === b)!.id
const links = city.roads.links.length

/** A whole game on the small city with every lever of slice 5 in it, beside the metro that opens in two stretches. */
function play(): Game {
  const g = rules.start({ ...testSeason, money: 400_000 }, city)
  const plan: Record<number, Action[]> = {
    0: [
      { kind: 'build', plan: { kind: 'road', stops: [at(1, 2), at(9, 5)], lanes: 2, flyover: false } },
      { kind: 'build', plan: { kind: 'road', stops: [at(2, 9), at(7, 10)], lanes: 3, flyover: true } },
      { kind: 'build', plan: { kind: 'junction', node: node(5, 5), work: 'signal' } },
      { kind: 'build', plan: { kind: 'footpaths', zone: 4 } },
      { kind: 'build', plan: { kind: 'speedLimit', zone: 3, limit: 30 } },
      { kind: 'build', plan: { kind: 'oneWay', link: link(node(4, 4), node(5, 4)), on: true } },
    ],
    1: [
      { kind: 'build', plan: { kind: 'junction', node: node(8, 4), work: 'overpass' } },
      { kind: 'build', plan: { kind: 'density', zone: 3, on: true } },
      { kind: 'build', plan: { kind: 'metro', stops: [at(1, 8), at(6, 8), at(10, 8)] } },
    ],
    3: [{ kind: 'build', plan: { kind: 'junction', node: node(5, 5), work: 'redesign' } }],
    20: [
      { kind: 'build', plan: { kind: 'speedLimit', zone: 3, limit: null } },
      { kind: 'build', plan: { kind: 'speedLimit', zone: 6, limit: 40 } },
      { kind: 'build', plan: { kind: 'oneWay', link: link(node(4, 4), node(5, 4)), on: false } },
    ],
    // A bus lane on the new road, whose links came after the city's.
    30: [{ kind: 'build', plan: { kind: 'busLane', links: [links, links + 1] } }],
    40: [{ kind: 'build', plan: { kind: 'density', zone: 3, on: false } }],
  }
  while (g.status === 'playing') {
    for (const a of plan[g.month] ?? []) expect([g.month, a.kind, rules.act(g, city, a)]).toEqual([g.month, a.kind, { ok: true }])
    const state = rules.state(g, city)
    wellFormed(state)
    rules.endMonth(g, city, simulate(state))
  }
  return g
}

/** A network the model can take: ids in order, every link between nodes that exist, the city's ids where they were. */
function wellFormed(state: CityState) {
  const { nodes, links: ls, zoneNode } = state.roads
  ls.forEach((l, k) => {
    expect(l.id).toBe(k)
    expect(nodes[l.from] && nodes[l.to]).toBeTruthy()
    expect(Number.isInteger(l.capacity) && l.capacity > 0 && l.lanes > 0 && l.length > 0).toBe(true)
  })
  expect(zoneNode).toEqual(city.roads.zoneNode)
  for (const l of city.roads.links) expect(ls[l.id]!.drawn).toBe(l.drawn)
  for (const [id, limit] of Object.entries(state.limits ?? {})) expect(ls[Number(id)]!.speed).toBeGreaterThan(limit)
}

describe('a whole game with every lever of slice 5', () => {
  const played = play()

  it('builds, opens and sets each as it goes', () => {
    expect(played.status).toBe('finished')
    const b = played.built!
    expect(b.roads!.map((r) => r.flyover)).toEqual([false, true])
    expect(b.junctions).toEqual([{ node: node(5, 5), work: 'signal' }, { node: node(5, 5), work: 'redesign' }, { node: node(8, 4), work: 'overpass' }])
    expect(b.footpaths).toEqual([4])
    expect(b.limits).toEqual([{ zone: 6, limit: 40 }])
    expect(b.oneWay).toEqual([])
    expect(b.dense).toEqual([])
    expect(b.busLanes).toEqual([links, links + 1])
    const news = played.reports.flatMap((r) => r.news).join(' ')
    expect(news).toMatch(/The Navy Line opens its first stretch/)
    expect(news).toMatch(/The flyover from .* opens: [\d.]+ km, 3 lanes each way\. It meets no road between its ends\./)
    expect(news).toMatch(/The overpass at .* opens/)
    expect(news).toMatch(/You allowed taller building in/)
    expect(news).toMatch(/You set a speed limit of 40 km\/h/)
  })

  it('writes plain sentences', () => {
    const texts = played.reports.flatMap((r) => [...r.news, ...r.needs, ...r.figures.flatMap((f) => f.causes.map((c) => c.text))])
    for (const t of texts) {
      expect(t, t).not.toMatch(/\b(\w+) \1\b/i)
      expect(t, t).not.toMatch(/!|undefined|NaN/)
      expect(t, t).toMatch(/^[A-Z+−\d₹]/)
    }
  })

  it('plays again from its list of actions to the same game exactly', () => {
    const again = rules.replay({ ...testSeason, money: 400_000 }, city, played.done, simulate)
    expect(JSON.stringify(again)).toBe(JSON.stringify(played))
  })

  it('refuses a list in which a plan was changed to something the rules do not allow', () => {
    const season = { ...testSeason, money: 400_000 }
    const change = (f: (a: Action) => void) => {
      const done = structuredClone(played.done)
      for (const d of done) f(d.action)
      return done
    }
    const road = change((a) => {
      if (a.kind === 'build' && a.plan.kind === 'road') (a.plan as { lanes: number }).lanes = 5
    })
    expect(() => rules.replay(season, city, road, simulate)).toThrow(/1, 2 or 3 lanes/)
    const limit = change((a) => {
      if (a.kind === 'build' && a.plan.kind === 'speedLimit' && a.plan.limit === 30) a.plan.limit = 5
    })
    expect(() => rules.replay(season, city, limit, simulate)).toThrow(/speed limit may be/)
    const dense = change((a) => {
      if (a.kind === 'build' && a.plan.kind === 'density' && a.plan.on) a.plan.zone = 0
    })
    expect(() => rules.replay(season, city, dense, simulate)).toThrow(/no metro or suburban station/)
    const cut = structuredClone(played.done)
    cut.splice(1, 0, { month: 0, action: { kind: 'build', plan: { kind: 'oneWay', link: link(node(1, 0), node(0, 0)), on: true } } })
    cut.splice(1, 0, { month: 0, action: { kind: 'build', plan: { kind: 'oneWay', link: link(node(0, 1), node(0, 0)), on: true } } })
    expect(() => rules.replay(season, city, cut, simulate)).toThrow(/could not be reached, or left/)
  })
})
