import { describe, expect, it } from 'vitest'
import { rules } from '../src/rules/index'
import { costIndex, installment, loanLimit, owed } from '../src/rules/money'
import { METRO } from '../src/rules/params'
import type { Action, Game, Plan, Stop } from '../src/rules/types'
import { simulate } from '../src/sim/index'
import { smallCity, testSeason } from './rules-city'

const city = smallCity()
const fresh = (money = testSeason.money) => rules.start({ ...testSeason, money }, city)
const end = (g: Game) => rules.endMonth(g, city, simulate(rules.state(g, city)))
/** A place on the small city's grid: x km east and y km north of its corner. */
const at = (x: number, y: number): Stop => ({ at: [77.55 + x / 108.48, 12.93 + y / 110.57] })
const metro = (...stops: Stop[]): Plan => ({ kind: 'metro', stops })

/** Tries an action, and checks that a refused one leaves the game exactly as it was. */
function refused(g: Game, action: unknown): string {
  const before = JSON.stringify(g)
  const outcome = rules.act(g, city, action as Action)
  expect(outcome.ok).toBe(false)
  expect(JSON.stringify(g)).toBe(before)
  return outcome.ok ? '' : outcome.reason
}

describe('planning a metro line', () => {
  it('runs along a road that leads the right way, with stations about every 1.3 km, at least 600 m apart', () => {
    const q = rules.quote(fresh(), city, metro(at(1, 8), at(10, 8)))
    expect(q.ok).toBe(true)
    expect(q.major).toBe(true)
    expect(q.length).toBeGreaterThanOrEqual(8990)
    expect(q.length).toBeLessThanOrEqual(9010)
    expect(q.stations.length).toBeGreaterThanOrEqual(6)
    for (let i = 1; i < q.stations.length; i++) {
      const [a, b] = [q.stations[i - 1]!.at, q.stations[i]!.at]
      expect(Math.abs(a[0] - b[0]) * 108_480 + Math.abs(a[1] - b[1]) * 110_570).toBeGreaterThanOrEqual(METRO.apart)
    }
    // Along the road at y = 8: every lane beneath it, both ways, is disrupted while it is built.
    expect(q.disrupted.length).toBe(18)
    for (const id of q.disrupted) expect(city.roads.links[id]!.kind).toBe('primary')
    // Viaduct: the player's share of ₹380 crore a km.
    expect(q.cost).toBe(Math.round((Math.round((q.length * METRO.viaductKm) / 1000) * METRO.share) / 10_000))
    expect(q.months).toBeGreaterThanOrEqual(METRO.least)
    expect(q.running).toBeGreaterThan(0)
  })

  it('snaps a tap a little off to the junction, and names new stations after the nearest zone', () => {
    const q = rules.quote(fresh(), city, metro({ at: [77.55 + 1.15 / 108.48, 12.93 + 8.1 / 110.57] }, at(6, 8)))
    expect(q.ok).toBe(true)
    expect(q.stations[0]!.at[0]).toBeCloseTo(77.55 + 1 / 108.48, 5)
    expect(q.stations[0]!.name).toMatch(/^Zone \d+/)
    expect(new Set(q.stations.map((s) => s.name)).size).toBe(q.stations.length)
  })

  it('goes straight, as a tunnel at a higher price, where the roads do not lead the right way', () => {
    const road = rules.quote(fresh(), city, metro(at(1, 8), at(9, 8)))
    const tunnel = rules.quote(fresh(), city, metro(at(1, 1), at(7, 7)))
    expect(tunnel.ok).toBe(true)
    expect(tunnel.disrupted).toEqual([])
    expect(tunnel.cost / tunnel.length).toBeGreaterThan((3 * road.cost) / road.length)
  })

  it('joins a station that is there when the player taps it, or taps beside it', () => {
    const g = fresh()
    const byStation = rules.quote(g, city, metro({ station: 1 }, at(2, 10)))
    const beside = rules.quote(g, city, metro({ at: [77.55 + 2.1 / 108.48, 12.93 + 5 / 110.57] }, at(2, 10)))
    expect(byStation.stations[0]!.existing).toBe(1)
    expect(beside.stations[0]!.existing).toBe(1)
    expect(byStation.stations[0]!.name).toBe('S1')
  })

  it('refuses places too close, too far from a road, the same station twice, and plans that are not proper', () => {
    const g = fresh()
    expect(rules.quote(g, city, metro(at(4, 8), at(4.4, 8))).reason).toMatch(/600 m apart/)
    expect(rules.quote(g, city, metro(at(4, 8), at(30, 30))).reason).toMatch(/no main road within 2 km/)
    expect(rules.quote(g, city, metro({ station: 1 }, at(2, 10), { station: 1 })).reason).toMatch(/same station twice/)
    expect(rules.quote(g, city, metro(at(4, 8))).ok).toBe(false)
    expect(rules.quote(g, city, { kind: 'metro', stops: [{ at: [Number.NaN, 12] }, at(1, 1)] }).ok).toBe(false)
    expect(rules.quote(g, city, metro({ station: 999 }, at(1, 1))).reason).toMatch(/no such metro station/)
  })

  it('moves a tap far from a road to the nearest road, up to 2 km, and says which place each station came from', () => {
    const g = fresh()
    const q = rules.quote(g, city, metro(at(4, 8), at(12.5, 8)))
    expect(q.ok).toBe(true)
    expect(q.stations[0]!.stop).toBe(0)
    expect(q.stations.at(-1)!.stop).toBe(1)
    expect(q.stations.at(-1)!.at[0]).toBeCloseTo(77.55 + 11 / 108.48, 5)
    expect(q.stations.slice(1, -1).every((s) => s.stop === undefined)).toBe(true)
  })

  it('snaps a lone first tap, as a station or a bus stop would be built', () => {
    const g = fresh()
    const station = rules.snap!(g, city, 'metro', { at: [77.55 + 2.1 / 108.48, 12.93 + 5 / 110.57] })
    expect(station).toMatchObject({ name: 'S1', existing: 1 })
    const stop = rules.snap!(g, city, 'busRoute', at(3.2, 4.1))
    expect('reason' in stop).toBe(false)
    if (!('reason' in stop)) expect(stop.at[0]).toBeCloseTo(77.55 + 3 / 108.48, 5)
    expect(rules.snap!(g, city, 'metro', at(40, 40))).toEqual({ reason: expect.stringMatching(/no main road within 2 km/) })
    expect(rules.snap!(g, city, 'metro', { station: 999 })).toEqual({ reason: expect.stringMatching(/no such/) })
  })

  it('gives the same line every time from the same places', () => {
    const plan = metro(at(1, 8), at(6, 7.8), at(10, 4))
    expect(JSON.stringify(rules.quote(fresh(), city, plan))).toBe(JSON.stringify(rules.quote(fresh(), city, plan)))
  })
})

describe('planning a bus route, bus lanes and more trains', () => {
  it('a bus route follows the roads by the quickest way, cheap and quick, a minor action', () => {
    const q = rules.quote(fresh(), city, { kind: 'busRoute', stops: [at(1, 4), at(8, 4), at(8, 10)], buses: 10 })
    expect(q.ok).toBe(true)
    expect(q.major).toBe(false)
    expect(q.months).toBe(1)
    expect(q.length).toBe(13_000)
    expect(q.cost).toBeLessThan(1000)
    // The stops are those tapped; the buses pick up about every kilometre between.
    expect(q.stations).toHaveLength(3)
    expect(q.path.length).toBe(2 * 14)
  })

  it('a bus lane needs two lanes, and a long scheme is major', () => {
    const g = fresh()
    const twoLane = city.roads.links.filter((l) => l.lanes >= 2).map((l) => l.id)
    const oneLane = city.roads.links.find((l) => l.lanes === 1)!.id
    expect(rules.quote(g, city, { kind: 'busLane', links: [oneLane] }).reason).toMatch(/two lanes/)
    expect(rules.quote(g, city, { kind: 'busLane', links: twoLane.slice(0, 3) }).major).toBe(false)
    expect(rules.quote(g, city, { kind: 'busLane', links: twoLane.slice(0, 8) }).major).toBe(true)
    expect(rules.quote(g, city, { kind: 'busLane', links: [twoLane[0]!, twoLane[0]!] }).ok).toBe(false)
  })

  it('more suburban trains go on a line that is there', () => {
    const g = fresh()
    const q = rules.quote(g, city, { kind: 'railService', line: 'railway', trains: 3 })
    expect(q.ok && q.major).toBe(true)
    expect(q.stations.every((s) => s.existing !== undefined)).toBe(true)
    expect(rules.quote(g, city, { kind: 'railService', line: 'east-west', trains: 3 }).ok).toBe(false)
  })
})

describe('building', () => {
  const plan = metro(at(1, 8), at(10, 8))

  it('pays as the work goes, takes a lane beneath for the first half, and opens with its trains', () => {
    const g = fresh()
    const q = rules.quote(g, city, plan)
    expect(rules.act(g, city, { kind: 'build', plan })).toEqual({ ok: true })
    const p = g.projects![0]!
    expect(p.opens).toBe(q.months)
    expect(rules.state(g, city).works).toEqual(q.disrupted)
    let paid = 0
    for (let m = 0; m < q.months; m++) {
      const report = end(g)
      paid -= report.books.find((e) => e.key === `build-${p.id}`)?.amount ?? 0
      const works = rules.state(g, city).works ?? []
      if (g.month < Math.floor(q.months / 2)) expect(works.length).toBe(q.disrupted.length)
      else expect(works).toEqual([])
    }
    expect(paid).toBe(p.cost)
    expect(g.projects).toEqual([])
    const line = g.built!.lines[0]!
    expect(line.id).toBe('player-metro-1')
    expect(line.name).toBe('Navy Line')
    expect(line.stations.length).toBe(q.stations.length)
    const state = rules.state(g, city)
    expect(state.transit.lines.some((l) => l.id === line.id && l.status === 'open')).toBe(true)
    expect(state.vehicles?.[line.id]).toBeGreaterThan(0)
    expect(g.reports.at(-1)!.news.join(' ')).toMatch(/The Navy Line, .* opens, with \d+ stations/)
    // Running it is in the books, and the model carries riders on it.
    const r = simulate(state)
    expect(rules.books(g, city).some((e) => e.key === `run-metro-${line.id}` && e.amount < 0)).toBe(true)
    expect(r.riders[line.id]).toBeGreaterThan(0)
  })

  it('spreads the cost evenly, to the lakh', () => {
    const p = { id: 1, plan, name: '', started: 3, opens: 10, cost: 100_003, quote: rules.quote(fresh(), city, plan) }
    let sum = 0
    for (let m = 0; m < 12; m++) sum += installment(p, m)
    expect(sum).toBe(100_003)
    expect(installment(p, 2)).toBe(0)
    expect(installment(p, 10)).toBe(0)
  })

  it('allows three major works a month', () => {
    const g = fresh(2_000_000)
    for (const y of [0, 4, 8]) expect(rules.act(g, city, { kind: 'build', plan: metro(at(0, y), at(6, y)) }).ok).toBe(true)
    expect(refused(g, { kind: 'build', plan: metro(at(0, 11), at(6, 11)) })).toMatch(/Three major works/)
    // A bus route is minor.
    expect(rules.act(g, city, { kind: 'build', plan: { kind: 'busRoute', stops: [at(1, 4), at(8, 4)], buses: 5 } }).ok).toBe(true)
    end(g)
    expect(rules.act(g, city, { kind: 'build', plan: metro(at(0, 11), at(6, 11)) }).ok).toBe(true)
  })

  it('refuses work the city cannot pay for over the next twelve months, with what it has and can borrow', () => {
    const g = fresh(10_000)
    // With ₹100 crore in hand, the line may be ordered on what can be borrowed.
    expect(rules.may(g, city, { kind: 'build', plan }).ok).toBe(true)
    const room = loanLimit(g) - owed(g)
    rules.act(g, city, { kind: 'borrow', amount: room - (room % 10_000) })
    g.money = 10_000
    expect(refused(g, { kind: 'build', plan })).toMatch(/over the next twelve months\. The city has ₹100 crore, and can borrow ₹0 crore more/)
  })

  it('costs more as prices rise', () => {
    const g = fresh()
    const now = rules.quote(g, city, plan).cost
    g.month = 36
    expect(rules.quote(g, city, plan).cost).toBe(Math.round((now * costIndex(36)) / 10_000))
  })

  it('can be cancelled, with half of what was paid back, and the lanes given back', () => {
    const g = fresh()
    rules.act(g, city, { kind: 'build', plan })
    for (let m = 0; m < 5; m++) end(g)
    const p = g.projects![0]!
    let paid = 0
    for (let m = 0; m < 5; m++) paid += installment(p, m)
    const money = g.money
    expect(rules.act(g, city, { kind: 'cancel', project: p.id })).toEqual({ ok: true })
    expect(g.money - money).toBe(Math.round(paid / 2))
    expect(g.projects).toEqual([])
    expect(rules.state(g, city).works).toBeUndefined()
    expect(refused(g, { kind: 'cancel', project: p.id })).toMatch(/no such work/)
  })
})

describe('running the lines', () => {
  /** A game with a bus route open. */
  function withRoute() {
    const g = fresh()
    rules.act(g, city, { kind: 'build', plan: { kind: 'busRoute', stops: [at(1, 4), at(8, 4)], buses: 6 } })
    end(g)
    return g
  }

  it('opens a bus route the next month, with its buses, and runs them for the books', () => {
    const g = withRoute()
    const line = g.built!.lines[0]!
    expect(line.kind).toBe('bus')
    expect(g.built!.vehicles[line.id]).toBe(6)
    expect(rules.state(g, city).vehicles).toEqual({ [line.id]: 6 })
    expect(rules.books(g, city).find((e) => e.key === `run-bus-${line.id}`)!.amount).toBeLessThan(0)
  })

  it('adds buses at a price, takes them away, and keeps within limits', () => {
    const g = withRoute()
    const id = g.built!.lines[0]!.id
    const money = g.money
    expect(rules.act(g, city, { kind: 'vehicles', line: id, change: 4 })).toEqual({ ok: true })
    expect(g.built!.vehicles[id]).toBe(10)
    expect(g.money).toBeLessThan(money)
    expect(rules.act(g, city, { kind: 'vehicles', line: id, change: -9 })).toEqual({ ok: true })
    expect(refused(g, { kind: 'vehicles', line: id, change: -1 })).toMatch(/at least 1/)
    refused(g, { kind: 'vehicles', line: id, change: 0 })
    refused(g, { kind: 'vehicles', line: id, change: 1.5 })
    refused(g, { kind: 'vehicles', line: 'no-such-line', change: 1 })
  })

  it('adds trains to the city’s own metro line, from what it runs by default', () => {
    const g = fresh()
    expect(rules.act(g, city, { kind: 'vehicles', line: 'east-west', change: 3 })).toEqual({ ok: true })
    const v = rules.state(g, city).vehicles!['east-west']!
    expect(v).toBeGreaterThan(3)
    expect(rules.books(g, city).find((e) => e.key === 'run-metro-east-west')!.amount).toBeLessThan(0)
  })

  it('closes only the player’s own lines', () => {
    const g = withRoute()
    const id = g.built!.lines[0]!.id
    refused(g, { kind: 'close', line: 'east-west' })
    expect(rules.act(g, city, { kind: 'close', line: id })).toEqual({ ok: true })
    expect(g.built!.lines).toEqual([])
    expect(g.built!.vehicles[id]).toBeUndefined()
    expect(rules.state(g, city).transit.lines.some((l) => l.id === id)).toBe(false)
  })

  it('refuses building actions that are not proper, leaving the game untouched', () => {
    const g = withRoute()
    refused(g, { kind: 'build' })
    refused(g, { kind: 'build', plan: null })
    refused(g, { kind: 'build', plan: { kind: 'metro', stops: 'here' } })
    refused(g, { kind: 'build', plan: { kind: 'busRoute', stops: [at(1, 4), at(8, 4)], buses: 0 } })
    refused(g, { kind: 'build', plan: { kind: 'busRoute', stops: [at(1, 4), at(8, 4)], buses: 2.5 } })
    refused(g, { kind: 'build', plan: { kind: 'busLane', links: [-1] } })
    refused(g, { kind: 'build', plan: { kind: 'railService', line: 'nowhere', trains: 2 } })
    refused(g, { kind: 'build', plan: { kind: 'railService', line: 'railway', trains: 99 } })
    refused(g, { kind: 'cancel', project: 'x' })
    refused(g, { kind: 'close', line: 7 })
  })

  it('records a plan as the player gave it, and nothing else', () => {
    const g = fresh()
    const plan = { kind: 'busRoute', stops: [{ at: [77.56, 12.966], extra: 1 }, at(8, 4)], buses: 5, colour: 'red' }
    expect(rules.act(g, city, { kind: 'build', plan } as unknown as Action).ok).toBe(true)
    expect(g.done[0]!.action).toEqual({ kind: 'build', plan: { kind: 'busRoute', stops: [{ at: [77.56, 12.966] }, at(8, 4)], buses: 5 } })
  })
})

describe('suggested corridors', () => {
  it('offers plans the player could have made, each passing the quote', () => {
    const g = fresh()
    end(g)
    for (const kind of ['metro', 'busRoute'] as const) {
      const plans = rules.suggest(g, city, kind)
      expect(plans.length).toBeGreaterThan(0)
      expect(plans.length).toBeLessThanOrEqual(5)
      for (const p of plans) {
        expect(p.kind).toBe(kind)
        expect(rules.quote(g, city, p).ok).toBe(true)
        expect(rules.may(g, city, { kind: 'build', plan: p }).ok).toBe(true)
      }
    }
  })
})

describe('the season’s lines', () => {
  const season = { ...testSeason, openings: [{ line: 'north-south', month: 3, stations: 3 }, { line: 'north-south', month: 6, stations: 5 }] }

  it('open in phases in the months the season sets, are announced, and cost their running', () => {
    const g = rules.start(season, city)
    const open = () => rules.state(g, city).transit.lines.find((l) => l.id === 'north-south')!
    expect(open().status).toBe('building')
    end(g)
    end(g)
    const report = end(g)
    expect(report.news.join(' ')).toMatch(/The north-south opens its first stretch, from S7 to S9/)
    expect(open().status).toBe('open')
    expect(open().stations).toEqual([7, 8, 9])
    expect(rules.books(g, city).some((e) => e.key === 'run-metro-north-south')).toBe(true)
    for (let m = 3; m < 6; m++) end(g)
    expect(open().stations).toHaveLength(5)
  })
})

describe('a report after something opens', () => {
  it('says what the opening did, by working the month out without it', async () => {
    const { skip } = await import('../src/rules/skip')
    const g = fresh()
    rules.act(g, city, { kind: 'build', plan: { kind: 'busRoute', stops: [at(1, 4), at(8, 4)], buses: 12 } })
    end(g)
    const runs: unknown[] = []
    const report = skip(g, city, (s) => (runs.push(s), simulate(s)), 1)
    expect(runs.length).toBeGreaterThanOrEqual(2)
    const causes = report.figures.flatMap((f) => f.causes.map((c) => c.text)).join(' ')
    expect(causes).toMatch(/Bus route 1 starting/)
  })
})

describe('a metro line opens in two stretches (slice 5)', () => {
  it('its first half of stations at half its months, the rest at the end, keeping its stations and trains', () => {
    const g = fresh(1_000_000)
    expect(rules.act(g, city, { kind: 'build', plan: metro(at(1, 8), at(10, 8)) })).toEqual({ ok: true })
    const p = g.projects![0]!
    const n = p.quote.stations.length
    expect(n).toBeGreaterThanOrEqual(4)
    const half = p.started + Math.floor((p.opens - p.started) / 2)
    while (g.month < half) end(g)
    const first = g.built!.lines.find((l) => l.id === p.line)!
    expect(first.stations).toHaveLength(Math.ceil(n / 2))
    expect(g.projects).toHaveLength(1)
    expect(g.reports.at(-1)!.news.join(' ')).toMatch(/opens its first stretch, from .* to .*, \d+ stations\. The rest opens in/)
    const trains = g.built!.vehicles[p.line!]!
    while (g.month < p.opens) end(g)
    const full = g.built!.lines.find((l) => l.id === p.line)!
    expect(full.stations).toHaveLength(n)
    expect(full.stations.slice(0, first.stations.length)).toEqual(first.stations)
    expect(g.built!.lines.filter((l) => l.id === p.line)).toHaveLength(1)
    expect(g.built!.vehicles[p.line!]).toBeGreaterThanOrEqual(trains)
    expect(new Set(g.built!.stations.map((s) => s.id)).size).toBe(g.built!.stations.length)
  })
})
