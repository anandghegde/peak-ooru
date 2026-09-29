import { describe, expect, it } from 'vitest'
import { forecast, rules } from '../src/rules/index'
import { show } from '../src/rules/upkeep'
import { balance, costIndex, fareIncome, monthBooks, taxIncome, valueIndex } from '../src/rules/money'
import { TAX_BASE } from '../src/rules/params'
import { simulate } from '../src/sim/index'
import { smallCity, testSeason } from './rules-city'

const city = smallCity()
const fresh = () => rules.start(testSeason, city)
const month = (g = fresh()) => simulate(rules.state(g, city))

describe('the books of a month', () => {
  it('balance: money moves by exactly the sum of the books, every month', () => {
    const g = fresh()
    rules.act(g, city, { kind: 'borrow', amount: 50_000 })
    for (let k = 0; k < 14; k++) {
      const before = g.money
      const report = rules.endMonth(g, city, month(g))
      expect(g.money - before).toBe(balance(report.books))
      for (const e of report.books) expect(Number.isInteger(e.amount)).toBe(true)
    }
  })

  it('are as `books` foretold them, when the traffic is as last month’s', () => {
    const g = fresh()
    const r = month(g)
    rules.endMonth(g, city, r)
    const foretold = rules.books(g, city)
    const report = rules.endMonth(g, city, r)
    expect(report.books).toEqual(foretold)
  })

  it('run more trains on a metro line fuller than its trains carry, in proportion', () => {
    const g = fresh()
    const r = month(g)
    const running = (crowding: number) =>
      monthBooks(g, city, { ...r, crowding: { 'east-west': crowding } } as typeof r).find((e) => e.key === 'run-metro-east-west')!.amount
    expect(running(500)).toBe(running(1000))
    expect(running(2000) / running(1000)).toBeCloseTo(2, 2)
  })

  it('name every line of the metro in service, and nothing for a line being built', () => {
    const g = fresh()
    const keys = rules.endMonth(g, city, month(g)).books.map((e) => e.key)
    expect(keys).toContain('fares-metro-east-west')
    expect(keys).toContain('run-metro-east-west')
    expect(keys.some((k) => k.includes('north-south'))).toBe(false)
  })
})

describe('property tax', () => {
  it('is the base at the standard rate, and grows with the rate and the people', () => {
    const g = fresh()
    expect(taxIncome(g)).toBe(TAX_BASE)
    g.taxRate = 12_000
    expect(taxIncome(g)).toBe((TAX_BASE * 12) / 10)
    g.taxRate = 10_000
    g.people = 11_000
    expect(taxIncome(g)).toBe((TAX_BASE * 11) / 10)
  })

  it('grows with the value of property each January, and costs grow with prices', () => {
    expect(valueIndex(11)).toBe(10_000)
    // Slice 7: property values rise 2% a year (4% before), so that doing nothing ends with about what it began with.
    expect(valueIndex(12)).toBe(10_200)
    expect(valueIndex(24)).toBe(10_404)
    expect(costIndex(12)).toBe(10_400)
    const g = fresh()
    g.month = 12
    expect(taxIncome(g)).toBe(Math.round((TAX_BASE * 10_200) / 10_000))
  })

  it('slows growth when the rate is high', () => {
    const low = fresh()
    const high = fresh()
    rules.act(high, city, { kind: 'tax', rate: 13_000 })
    for (let k = 0; k < 12; k++) {
      rules.endMonth(low, city, month(low))
      rules.endMonth(high, city, month(high))
    }
    expect(high.people).toBeLessThan(low.people)
    expect(high.taxPeople).toBeLessThan(0)
    expect(high.money).toBeGreaterThan(low.money)
  })
})

describe('what dear tax and dear fares do over the years (slice 5)', () => {
  it('a dearer tax slows the rise in the value of property, and so the tax base', () => {
    const plain = fresh()
    const dear = fresh()
    rules.act(dear, city, { kind: 'tax', rate: 12_500 })
    for (let k = 0; k < 24; k++) {
      rules.endMonth(plain, city, month(plain))
      rules.endMonth(dear, city, month(dear))
    }
    // 2% a year at the standard rate (slice 7); −0.5% at 125%.
    expect(plain.value).toBe(10_404)
    expect(dear.value).toBe(Math.round((Math.round((10_000 * 9_950) / 10_000) * 9_950) / 10_000))
  })

  it('fares above the usual slow the growth of the city; at the usual they do not', () => {
    const plain = fresh()
    const dear = fresh()
    rules.act(dear, city, { kind: 'fare', mode: 'metro', perKm: 700 })
    rules.act(dear, city, { kind: 'fare', mode: 'bus', perKm: 250 })
    for (let k = 0; k < 12; k++) {
      rules.endMonth(plain, city, month(plain))
      rules.endMonth(dear, city, month(dear))
    }
    expect(dear.people).toBeLessThan(plain.people)
  })

  it('the state pays for free bus rides at the usual fare, not at a dearer one', () => {
    const g = fresh()
    const r = month(g)
    rules.endMonth(g, city, r)
    const paid = (x: typeof g) => rules.books(x, city).find((e) => e.key === 'shakti')!.amount
    const fares = (x: typeof g) => rules.books(x, city).find((e) => e.key === 'fares-bus')!.amount
    const usual = paid(g)
    g.prices = { ...g.prices, busPerKm: 3.2 }
    // The same riders at twice the fare: the city's fares would double, but the state's payment does not.
    expect(paid(g)).toBeLessThanOrEqual(Math.round((usual * 11) / 10))
    expect(fares(g)).toBeGreaterThan(0)
  })
})

describe('fares', () => {
  it('are the fare for an average trip, within the least and most fare, for those who pay', () => {
    // 1,000 trips of 10 km at ₹4.50 a km: ₹45 each, 26 days: ₹11.7 lakh.
    expect(fareIncome('metro', 1000, 100, 450, 1000)).toBe(12)
    // The least fare, ₹10, for short trips.
    expect(fareIncome('metro', 100_000, 10, 450, 1000)).toBe(260)
    // The most, ₹90.
    expect(fareIncome('metro', 100_000, 400, 450, 1000)).toBe(2340)
    // On the bus only 45% pay: 100,000 trips at ₹16.
    expect(fareIncome('bus', 100_000, 100, 160, 1000)).toBe(187)
  })

  it('are what the model says was paid on a weekday, over 26 days of fares', () => {
    const g = fresh()
    const r = month(g) as ReturnType<typeof month> & { fares?: Record<string, number> }
    const books = rules.endMonth(g, city, r).books
    expect(r.fares).toBeDefined()
    expect(books.find((e) => e.key === 'fares-bus')!.amount).toBe(Math.round((Math.round(r.fares!.bus!) * 26) / 100_000))
  })

  it('earn more when raised and less when cut, as the model moves riders', () => {
    const income = (perKm: number) => {
      const g = fresh()
      // On roads in perfect repair (slice 6), so that only the fare moves riders: on poor roads the buses are slow.
      g.wear = { ...g.wear!, base: g.wear!.base.map(() => 100_000), streets: g.wear!.streets.map(() => 100_000) }
      show(g, city)
      if (perKm !== 160) rules.act(g, city, { kind: 'fare', mode: 'bus', perKm })
      const r = month(g)
      return { trips: r.trips.bus, fares: rules.endMonth(g, city, r).books.find((e) => e.key === 'fares-bus')!.amount }
    }
    const cheap = income(80)
    const usual = income(160)
    const dear = income(320)
    expect(cheap.trips).toBeGreaterThan(usual.trips)
    expect(dear.trips).toBeLessThan(usual.trips)
    expect(cheap.fares).toBeLessThanOrEqual(usual.fares)
    expect(dear.fares).toBeGreaterThan(usual.fares)
  })
})

describe('the forecast', () => {
  it('plays the books forward without the model, and changes nothing', () => {
    const g = fresh()
    expect(forecast(g, city)).toEqual([])
    rules.endMonth(g, city, month(g))
    const before = JSON.stringify(g)
    const ahead = forecast(g, city, 12)
    expect(JSON.stringify(g)).toBe(before)
    expect(ahead).toHaveLength(12)
    expect(ahead[0]!.month).toBe(2)
  })
})
