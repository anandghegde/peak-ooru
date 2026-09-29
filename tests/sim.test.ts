import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Transit, Zone } from '../src/data/types'
import { expNeg } from '../src/sim/fixed'
import { ROAD } from '../src/sim/params'
import { simulate } from '../src/sim/index'
import { MODES, PERIODS, type CityState, type RoutingNetwork } from '../src/sim/types'
import { fixtureCity } from './sim-fixture'

const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../public/data/${file}`, import.meta.url), 'utf8')) as T

describe('a month of the small city', () => {
  const city = fixtureCity()
  const r = simulate(city)

  it('gives flow and speed for every link in every period, as whole numbers in range', () => {
    for (const p of PERIODS) {
      expect(r.flow[p]).toBeInstanceOf(Int32Array)
      expect(r.speed[p]).toBeInstanceOf(Int16Array)
      expect(r.flow[p].length).toBe(city.roads.links.length)
      expect(r.speed[p].length).toBe(city.roads.links.length)
      for (const f of r.flow[p]) expect(f).toBeGreaterThanOrEqual(0)
      for (const s of r.speed[p]) {
        expect(s).toBeGreaterThan(0)
        expect(s).toBeLessThanOrEqual(1000)
      }
    }
  })

  it('carries more at the peaks than at night, and moves faster at night', () => {
    const sum = (a: ArrayLike<number>) => Array.from(a).reduce((s, x) => s + x, 0)
    expect(sum(r.flow.morning)).toBeGreaterThan(sum(r.flow.night))
    expect(sum(r.flow.evening)).toBeGreaterThan(sum(r.flow.night))
    expect(sum(r.speed.night)).toBeGreaterThan(sum(r.speed.morning))
  })

  it('gives a commute and access for the city and for each zone', () => {
    expect(Number.isInteger(r.commute)).toBe(true)
    expect(r.commute).toBeGreaterThan(5 * 60)
    expect(r.commute).toBeLessThan(120 * 60)
    expect(r.commuteByZone.length).toBe(city.zones.length)
    expect(r.accessByZone.length).toBe(city.zones.length)
    expect(r.access).toBeGreaterThan(0)
    expect(r.access).toBeLessThanOrEqual(1000)
  })

  it('counts trips by every mode, riders only on lines in service', () => {
    for (const m of MODES) expect(Number.isInteger(r.trips[m])).toBe(true)
    expect(r.trips.walk).toBeGreaterThan(0)
    expect(r.trips.twoWheeler).toBeGreaterThan(0)
    expect(r.riders['east-west']).toBeGreaterThan(0)
    expect(r.riders['north-south']).toBe(0)
    expect(r.riders.railway).toBeGreaterThanOrEqual(0)
  })

  it('keeps what is needed to explain the commute: each mode, and the delay from traffic', () => {
    const d = r as ReturnType<typeof simulate>
    let trips = 0
    let seconds = 0
    for (const m of MODES) {
      trips += d.commuteByMode[m].trips
      seconds += d.commuteByMode[m].trips * d.commuteByMode[m].seconds
    }
    // The city's commute is the average of the modes', weighted by their trips.
    expect(Math.abs(seconds / trips - r.commute)).toBeLessThan(5)
    expect(d.commuteDelay).toBeGreaterThanOrEqual(0)
    expect(d.commuteDelay).toBeLessThan(r.commute)
  })

  it('slows a road in poor repair and sends traffic elsewhere', () => {
    // The busiest link at the morning peak, and its twin the other way, fall to 40% of free speed.
    let busiest = 0
    for (let l = 0; l < city.roads.links.length; l++) if (r.flow.morning[l]! > r.flow.morning[busiest]!) busiest = l
    const condition = city.roads.links.map((l) => (l.id === busiest ? 0.4 : 1))
    const worse = simulate({ ...city, condition })
    expect(worse.flow.morning[busiest]!).toBeLessThan(r.flow.morning[busiest]!)
    expect(worse.commute).toBeGreaterThanOrEqual(r.commute)
  })
})

describe('prices far from today', () => {
  const city = fixtureCity()
  const finite = (r: ReturnType<typeof simulate>) => {
    for (const p of PERIODS) {
      for (const f of r.flow[p]) expect(f).toBeGreaterThanOrEqual(0)
      for (const s of r.speed[p]) expect(s).toBeGreaterThan(0)
    }
    for (const x of [r.commute, r.access, ...Object.values(r.trips), ...Object.values(r.riders), ...Object.values(r.fares), ...Object.values(r.passengerKm), ...Object.values(r.lineFare), ...Object.values(r.crowding)]) {
      expect(Number.isFinite(x)).toBe(true)
      expect(x).toBeGreaterThanOrEqual(0)
    }
    for (const x of r.commuteByZone) expect(x).toBeGreaterThanOrEqual(0)
  }

  it('comes to sound figures with free fares, fares three times as dear, dear fuel and dear parking', () => {
    const d = { fuel: 111, metroPerKm: 4.5, busPerKm: 1.6, railPerKm: 0.4, leastFare: 10 }
    const cases = [
      { metroPerKm: 0, busPerKm: 0, railPerKm: 0, leastFare: 0 },
      { metroPerKm: d.metroPerKm * 3, busPerKm: d.busPerKm * 3, railPerKm: d.railPerKm * 3, leastFare: 30 },
      { fuel: 1000, parking: city.zones.map(() => 5000) },
      { fuel: 0, parking: city.zones.map(() => 0) },
    ]
    for (const prices of cases) finite(simulate({ ...city, prices }))
  })

  it('treats a price below nothing, or not a number, as the usual one', () => {
    const odd = simulate({ ...city, prices: { metroPerKm: -5, fuel: Number.NaN, parking: [-100] } })
    const usual = simulate(city)
    expect(odd.trips).toEqual(usual.trips)
  })

  it('earns more in fares with the metro dear, up to a point, and nothing when it is free', () => {
    const base = simulate(city)
    const free = simulate({ ...city, prices: { metroPerKm: 0, leastFare: 0 } })
    expect(free.fares.metro).toBe(0)
    expect(free.trips.metro).toBeGreaterThan(base.trips.metro)
    expect(base.fares.metro).toBeGreaterThan(0)
    // A line's fares and km add up to the mode's.
    const lines = city.transit.lines.filter((l) => l.kind === 'metro').map((l) => l.id)
    const sum = (x: Record<string, number>) => lines.reduce((a, id) => a + (x[id] ?? 0), 0)
    expect(Math.abs(sum(base.lineFare) - base.fares.metro)).toBeLessThanOrEqual(lines.length)
    expect(Math.abs(sum(base.lineKm) - base.passengerKm.metro)).toBeLessThanOrEqual(lines.length)
  })
})

describe('the arithmetic', () => {
  it('reads e to a power from its table to about one part in eight thousand', () => {
    for (let x = 0; x < 30; x += 0.37) expect(Math.abs(expNeg(x) / Math.exp(-x) - 1)).toBeLessThan(1.3e-4)
    expect(expNeg(0)).toBe(1)
    expect(expNeg(100)).toBe(0)
  })
})

describe('a month of Bengaluru', () => {
  const state: CityState = {
    month: 0,
    seed: 1,
    zones: read<Zone[]>('zones.json'),
    roads: read<RoutingNetwork>('routing.json'),
    transit: read<Transit>('transit.json'),
  }
  const r = simulate(state)

  it('is in the agreed shape for every zone and link', () => {
    expect(r.commuteByZone.length).toBe(411)
    expect(r.accessByZone.length).toBe(411)
    for (const p of PERIODS) expect(r.flow[p].length).toBe(state.roads.links.length)
    expect(Object.keys(r.riders).sort()).toEqual(state.transit.lines.map((l) => l.id).sort())
  })

  it('takes parking charges for all 411 zones, and fares far from today, without breaking', () => {
    const parking = state.zones.map((z) => (z.ward ? 50 : 0))
    for (const prices of [{ parking }, { metroPerKm: 0, busPerKm: 0, railPerKm: 0, leastFare: 0 }, { metroPerKm: 13.5, busPerKm: 4.8, leastFare: 30 }]) {
      const x = simulate({ ...state, prices })
      for (const v of [x.commute, x.access, ...Object.values(x.trips), ...Object.values(x.fares), ...Object.values(x.crowding)]) {
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(0)
      }
      for (const p of PERIODS) for (const f of x.flow[p]) expect(f).toBeGreaterThanOrEqual(0)
    }
  })

  it('passes no more on any link than half as much again as it can carry', () => {
    for (const p of PERIODS) {
      state.roads.links.forEach((l) => expect(r.flow[p][l.id]! / r.vehiclesPerPcu[p]).toBeLessThanOrEqual(1.5 * l.capacity * ROAD.capacityScale + 1))
    }
  })

  it('lengthens the commute as people grow, by a little for a little, never shortening it', () => {
    const grown = (g: number) => simulate({ ...state, zones: state.zones.map((z) => ({ ...z, people: Math.round(z.people * g) })) })
    let before = r.commute
    for (const g of [1.001, 1.005, 1.01, 1.02, 1.05]) {
      const c = grown(g).commute
      expect(c).toBeGreaterThanOrEqual(before)
      if (g === 1.001) expect(c - r.commute).toBeLessThan(6)
      before = c
    }
  }, 60_000)

  it('answers the events of slice 7: more trips in a month of festivals, and the bus riders gone elsewhere in a strike', () => {
    const f = simulate({ ...state, surge: 1100 })
    const all = (x: typeof r) => MODES.reduce((a, m) => a + x.trips[m], 0)
    expect(all(f) / all(r)).toBeGreaterThan(1.09)
    expect(all(f) / all(r)).toBeLessThan(1.11)
    expect(f.commute).toBeGreaterThan(r.commute)
    const half = simulate({ ...state, busService: 500 })
    const none = simulate({ ...state, busService: 0 })
    expect(half.trips.bus).toBeLessThan(r.trips.bus)
    expect(none.trips.bus).toBeLessThan(1)
    expect(none.trips.auto).toBeGreaterThan(half.trips.auto)
    expect(half.trips.auto).toBeGreaterThan(r.trips.auto)
    // As usual, the same month to the last bit.
    expect(simulate({ ...state, busService: 1000, surge: 1000 }).commute).toBe(r.commute)
  }, 60_000)

  it('fills trains no fuller than they carry, today and with a quarter more people', () => {
    const grown = simulate({ ...state, zones: state.zones.map((z) => ({ ...z, people: Math.round(z.people * 1.25) })) })
    for (const x of [r, grown]) for (const id of ['purple', 'green', 'yellow']) expect(x.crowding[id]!).toBeLessThanOrEqual(1100)
  }, 60_000)

  it('puts more people in cars and on two-wheelers when more of them have one', () => {
    const more = simulate({ ...state, ownership: { car: 1300, twoWheeler: 1300 } })
    expect(more.trips.car).toBeGreaterThan(r.trips.car)
    expect(more.trips.twoWheeler).toBeGreaterThan(r.trips.twoWheeler)
    expect(more.trips.bus).toBeLessThan(r.trips.bus)
    const odd = simulate({ ...state, ownership: { car: -1, twoWheeler: Number.NaN } })
    expect(odd.trips).toEqual(r.trips)
  }, 60_000)

  it('comes to figures of the right order', () => {
    const trips = MODES.reduce((s, m) => s + r.trips[m], 0)
    expect(trips / 16.45e6).toBeGreaterThan(1)
    expect(trips / 16.45e6).toBeLessThan(1.5)
    expect(r.commute / 60).toBeGreaterThan(35)
    expect(r.commute / 60).toBeLessThan(65)
    expect(r.trips.bus).toBeGreaterThan(3e6)
    expect(r.trips.metro).toBeGreaterThan(4e5)
    expect(r.trips.metro).toBeLessThan(1.5e6)
    expect(r.trips.twoWheeler).toBeGreaterThan(r.trips.car)
    expect(r.riders.pink).toBe(0)
    expect(r.riders.blue).toBe(0)
  })
})

describe('reasons', () => {
  it("names the roads a zone's commuters lose their time on, largest first", async () => {
    const { delayByRoad } = await import('../src/sim/reasons')
    const city = fixtureCity()
    const r = simulate(city)
    const roads = delayByRoad(city, r, 0, 'morning')
    expect(roads.length).toBeGreaterThan(0)
    for (let k = 1; k < roads.length; k++) expect(roads[k - 1]!.seconds).toBeGreaterThanOrEqual(roads[k]!.seconds)
    for (const x of roads) expect(x.link).toBeLessThan(city.roads.links.length)
  })
})
