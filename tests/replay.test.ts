import { describe, expect, it } from 'vitest'
import { rules } from '../src/rules/index'
import type { Action, Done, Game } from '../src/rules/types'
import { simulate } from '../src/sim/index'
import { smallCity, testSeason } from './rules-city'

const city = smallCity()

/** A whole game on the small city, with every kind of action, played as a player would. */
function playWhole(): Game {
  const g = rules.start(testSeason, city)
  const plan: Record<number, Action[]> = {
    0: [{ kind: 'fare', mode: 'metro', perKm: 600 }, { kind: 'borrow', amount: 50_000 }],
    3: [{ kind: 'tax', rate: 11_500 }, { kind: 'fare', mode: 'bus', perKm: 120 }],
    14: [{ kind: 'repay', loan: 1 }, { kind: 'tax', rate: 9_000 }],
    30: [{ kind: 'borrow', amount: 30_000 }, { kind: 'borrow', amount: 20_000 }, { kind: 'fare', mode: 'rail', perKm: 100 }],
    61: [{ kind: 'fare', mode: 'metro', perKm: 300 }],
    118: [{ kind: 'borrow', amount: 10_000 }],
  }
  while (g.status === 'playing') {
    for (const a of plan[g.month] ?? []) expect(rules.act(g, city, a)).toEqual({ ok: true })
    rules.endMonth(g, city, simulate(rules.state(g, city)))
  }
  return g
}

describe('playing a game again from its list of actions', () => {
  const played = playWhole()

  it('gives the same game exactly, over all 120 months', () => {
    expect(played.status).toBe('finished')
    expect(played.month).toBe(120)
    expect(played.done).toHaveLength(11)
    const again = rules.replay(testSeason, city, played.done, simulate)
    expect(JSON.stringify(again)).toBe(JSON.stringify(played))
    expect(again.reports).toHaveLength(120)
  })

  it('gives the same game when played only to a month part way', () => {
    const upTo = rules.replay(testSeason, city, played.done.filter((d) => d.month <= 30), simulate, 30)
    expect(upTo.month).toBe(30)
    // The actions of month 30 are done, and the month not yet ended.
    expect(upTo.loans.map((l) => l.amount)).toEqual([30_000, 20_000])
    expect(upTo.reports).toHaveLength(30)
    expect(JSON.stringify(upTo.reports)).toBe(JSON.stringify(played.reports.slice(0, 30)))
  })

  const refuse = (done: unknown, why: RegExp, until?: number) =>
    expect(() => rules.replay(testSeason, city, done as Done[], simulate, until)).toThrow(why)

  it('refuses a list with an action the rules do not allow', () => {
    refuse([{ month: 0, action: { kind: 'tax', rate: 11_000 } }, { month: 5, action: { kind: 'tax', rate: 12_000 } }], /once a year/, 6)
    refuse([{ month: 0, action: { kind: 'fare', mode: 'metro', perKm: 5000 } }], /between/, 1)
    refuse([{ month: 0, action: { kind: 'fare', mode: 'metro', perKm: 4.75 } }], /whole/, 1)
    refuse([{ month: 0, action: { kind: 'borrow', amount: 99_990_000 } }], /may owe at most/, 1)
    refuse([{ month: 2, action: { kind: 'repay', loan: 7 } }], /no such loan/, 3)
  })

  it('refuses an action dated in a month already passed, or never reached', () => {
    refuse([{ month: 3, action: { kind: 'borrow', amount: 10_000 } }, { month: 1, action: { kind: 'borrow', amount: 10_000 } }], /already passed/, 5)
    refuse([{ month: -1, action: { kind: 'borrow', amount: 10_000 } }], /already passed/, 5)
    refuse([{ month: 1.5, action: { kind: 'borrow', amount: 10_000 } }], /not a proper one/, 5)
    refuse([{ month: 9, action: { kind: 'borrow', amount: 10_000 } }], /never reached/, 5)
    refuse([null], /not a proper one/, 1)
  })

  it('refuses a month to play to beyond the season', () => {
    refuse([], /not a proper one/, 121)
  })
})

describe('a whole game with building in it', () => {
  const at = (x: number, y: number) => ({ at: [77.55 + x / 108.48, 12.93 + y / 110.57] as [number, number] })
  const season = { ...testSeason, openings: [{ line: 'north-south', month: 20, stations: 3 }, { line: 'north-south', month: 40, stations: 5 }] }
  const twoLane = city.roads.links.filter((l) => l.lanes >= 2).map((l) => l.id)

  function play(): Game {
    const g = rules.start(season, city)
    const plan: Record<number, Action[]> = {
      0: [
        { kind: 'borrow', amount: 100_000 },
        { kind: 'build', plan: { kind: 'metro', stops: [at(1, 8), at(6, 8.2), at(10, 8)] } },
        { kind: 'build', plan: { kind: 'busRoute', stops: [at(1, 4), at(8, 4), { station: 3 }], buses: 8 } },
        { kind: 'build', plan: { kind: 'metro', stops: [at(0, 0), at(8, 0)] } },
      ],
      2: [
        { kind: 'build', plan: { kind: 'busLane', links: twoLane.slice(0, 4) } },
        { kind: 'vehicles', line: 'player-bus-1', change: 4 },
      ],
      5: [{ kind: 'cancel', project: 3 }],
      7: [{ kind: 'build', plan: { kind: 'railService', line: 'railway', trains: 3 } }, { kind: 'tax', rate: 10_500 }],
      30: [{ kind: 'vehicles', line: 'east-west', change: 2 }],
      50: [{ kind: 'vehicles', line: 'player-metro-1', change: 3 }],
      60: [{ kind: 'close', line: 'player-bus-1' }, { kind: 'vehicles', line: 'railway', change: -1 }],
    }
    while (g.status === 'playing') {
      for (const a of plan[g.month] ?? []) expect([g.month, rules.act(g, city, a)]).toEqual([g.month, { ok: true }])
      const state = rules.state(g, city)
      wellFormed(state)
      rules.endMonth(g, city, simulate(state))
    }
    return g
  }
  /** Nothing the model would drop: unique ids, two stations or more that exist, vehicles on every line that has a number. */
  function wellFormed(state: ReturnType<typeof rules.state>) {
    const ids = state.transit.lines.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
    const stations = new Set(state.transit.stations.map((s) => s.id))
    expect(stations.size).toBe(state.transit.stations.length)
    for (const l of state.transit.lines) {
      if (l.status !== 'open') continue
      expect(new Set(l.stations).size).toBeGreaterThanOrEqual(2)
      for (const id of l.stations) expect(stations.has(id)).toBe(true)
      if (l.id.startsWith('player-')) expect(state.vehicles?.[l.id]).toBeGreaterThan(0)
    }
    for (const [id, v] of Object.entries(state.vehicles ?? {})) {
      expect(ids).toContain(id)
      expect(Number.isInteger(v) && v > 0).toBe(true)
    }
  }
  const played = play()

  it('builds, opens, changes and closes lines as it goes', () => {
    expect(played.status).toBe('finished')
    expect(played.built!.lines.map((l) => l.id)).toEqual(['player-metro-1'])
    expect(played.built!.busLanes).toHaveLength(4)
    expect(played.built!.vehicles.railway).toBe(2)
    expect(played.projects).toEqual([])
    const news = played.reports.flatMap((r) => r.news).join(' ')
    expect(news).toMatch(/You stopped work on the Brown Line/)
    expect(news).toMatch(/The north-south opens in full/)
  })

  it('writes plain sentences: no doubled words, no "the" before a bus route, no exclamation marks', () => {
    const texts = played.reports.flatMap((r) => [
      ...r.news,
      ...r.needs,
      ...r.figures.flatMap((f) => f.causes.map((c) => c.text)),
    ])
    expect(texts.length).toBeGreaterThan(100)
    for (const t of texts) {
      expect(t, t).not.toMatch(/\b(\w+) \1\b/i)
      expect(t, t).not.toMatch(/the Bus route|the [A-Z][a-z]+ Line opening has|!/)
      expect(t, t).toMatch(/^[A-Z+−\d₹]/)
    }
    expect(played.reports.flatMap((r) => r.needs)).toContain('Bus route 1 has started running.')
  })

  it('gives each December a review of its own', () => {
    const reviews = played.reports.flatMap((r) => (r.review ? [r.review] : []))
    expect(reviews).toHaveLength(10)
    expect(reviews[0]).toEqual({
      year: 2026,
      approval: played.reports[11]!.figures.find((f) => f.key === 'approval')!.now,
      word: expect.any(String),
      warning: false,
      warnings: 0,
      replaced: false,
    })
  })

  it('plays again from its list of actions to the same game exactly', () => {
    const again = rules.replay(season, city, played.done, simulate)
    expect(JSON.stringify(again)).toBe(JSON.stringify(played))
  })

  it('refuses a list in which a plan has been changed to something the rules do not allow', () => {
    const done = structuredClone(played.done)
    const build = done.find((d) => d.action.kind === 'build' && d.action.plan.kind === 'busRoute')!
    if (build.action.kind === 'build' && build.action.plan.kind === 'busRoute') build.action.plan.buses = 500
    expect(() => rules.replay(season, city, done, simulate)).toThrow(/runs 1 to 60 buses/)
    const four = structuredClone(played.done)
    four.splice(1, 0, { month: 0, action: { kind: 'build', plan: { kind: 'metro', stops: [at(0, 11), at(6, 11)] } } })
    four.splice(1, 0, { month: 0, action: { kind: 'build', plan: { kind: 'metro', stops: [at(0, 4), at(6, 4)] } } })
    expect(() => rules.replay(season, city, four, simulate)).toThrow(/Three major works/)
  })
})
