import { describe, expect, it } from 'vitest'
import { simulate } from '../src/sim/index'
import { DEFAULT_PRICES } from '../src/sim/params'
import { fixtureCity } from './sim-fixture'

describe('the choice of how to travel', () => {
  const city = fixtureCity()
  const base = simulate(city)

  it('moves people off the metro when its fare rises, and onto it when it falls', () => {
    const dear = simulate({ ...city, prices: { metroPerKm: DEFAULT_PRICES.metroPerKm * 3 } })
    const cheap = simulate({ ...city, prices: { metroPerKm: DEFAULT_PRICES.metroPerKm / 2, leastFare: 5 } })
    expect(dear.trips.metro).toBeLessThan(base.trips.metro)
    expect(cheap.trips.metro).toBeGreaterThan(base.trips.metro)
    expect(dear.riders['east-west']!).toBeLessThan(base.riders['east-west']!)
  })

  it('moves people out of cars and off two-wheelers when fuel costs more', () => {
    const dear = simulate({ ...city, prices: { fuel: DEFAULT_PRICES.fuel * 2 } })
    expect(dear.trips.car).toBeLessThan(base.trips.car)
    expect(dear.trips.twoWheeler).toBeLessThan(base.trips.twoWheeler)
    expect(dear.trips.bus).toBeGreaterThan(base.trips.bus)
  })

  it('drives fewer people to a zone that charges for parking', () => {
    // Parking in the zone with the most jobs.
    const busiest = city.zones.reduce((a, b) => (b.jobs > a.jobs ? b : a)).id
    const parking = city.zones.map((z) => (z.id === busiest ? 200 : 0))
    const charged = simulate({ ...city, prices: { parking } })
    expect(charged.trips.car).toBeLessThan(base.trips.car)
  })

  it('takes cheaper buses more', () => {
    const cheap = simulate({ ...city, prices: { busPerKm: 0, leastFare: 0 } })
    expect(cheap.trips.bus).toBeGreaterThan(base.trips.bus)
  })

  it('carries no one on a line that is not open', () => {
    expect(base.riders['north-south']).toBe(0)
    const opened = fixtureCity()
    opened.transit.lines[1]!.status = 'open'
    const r = simulate(opened)
    expect(r.riders['north-south']!).toBeGreaterThan(0)
    expect(r.trips.metro).toBeGreaterThan(base.trips.metro)
  })

  it('keeps the total number of trips whatever the prices', () => {
    const total = (r: typeof base) => Object.values(r.trips).reduce((s, x) => s + x, 0)
    const dear = simulate({ ...city, prices: { fuel: 300, metroPerKm: 20, busPerKm: 10 } })
    expect(Math.abs(total(dear) - total(base))).toBeLessThanOrEqual(8)
  })
})
