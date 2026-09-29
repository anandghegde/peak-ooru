import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { rules } from '../src/rules/index'
import type { Action, Game } from '../src/rules/types'
import { crore, grouped, monthName, perKm } from '../src/rules/words'
import { simulate } from '../src/sim/index'
import { smallCity, testSeason } from './rules-city'

const city = smallCity()
const fresh = () => rules.start(testSeason, city)
const endMonth = (g: Game) => rules.endMonth(g, city, simulate(rules.state(g, city)))

/** Tries an action, and checks that a refused one leaves the game exactly as it was. */
function refused(g: Game, action: unknown): string {
  const before = JSON.stringify(g)
  const outcome = rules.act(g, city, action as Action)
  expect(outcome.ok).toBe(false)
  expect(JSON.stringify(g)).toBe(before)
  return outcome.ok ? '' : outcome.reason
}

describe('a new game', () => {
  it('starts in January 2026 with the season’s money, the standard tax rate and the usual fares', () => {
    const g = fresh()
    expect(g.month).toBe(0)
    expect(g.status).toBe('playing')
    expect(g.money).toBe(testSeason.money)
    expect(g.taxRate).toBe(10_000)
    expect(g.people).toBe(10_000)
    expect(g.prices.metroPerKm).toBe(4.5)
    expect(g.prices.parking).toHaveLength(city.zones.length)
  })

  it('refuses a season that is not whole', () => {
    expect(() => rules.start({ ...testSeason, money: 1.5 }, city)).toThrow()
    expect(() => rules.start({ ...testSeason, months: 500 }, city)).toThrow()
  })
})

describe('the property tax rate', () => {
  it('may change once in a calendar year, and again from the next January', () => {
    const g = fresh()
    expect(rules.act(g, city, { kind: 'tax', rate: 11_000 })).toEqual({ ok: true })
    expect(refused(g, { kind: 'tax', rate: 12_000 })).toMatch(/once a year.*January 2026.*January 2027/)
    for (let k = 0; k < 11; k++) endMonth(g)
    expect(g.month).toBe(11)
    refused(g, { kind: 'tax', rate: 12_000 })
    endMonth(g)
    expect(rules.act(g, city, { kind: 'tax', rate: 12_000 }).ok).toBe(true)
  })

  it('refuses a rate outside its limits, not whole, not in steps, or unchanged', () => {
    const g = fresh()
    expect(refused(g, { kind: 'tax', rate: 7900 })).toMatch(/between 80% and 150%/)
    refused(g, { kind: 'tax', rate: 15_100 })
    refused(g, { kind: 'tax', rate: 11_050 })
    refused(g, { kind: 'tax', rate: 11_000.5 })
    refused(g, { kind: 'tax', rate: Number.NaN })
    refused(g, { kind: 'tax', rate: Number.POSITIVE_INFINITY })
    refused(g, { kind: 'tax', rate: '11000' })
    refused(g, { kind: 'tax', rate: 10_000 })
  })
})

describe('fares', () => {
  it('change the prices the model is given', () => {
    const g = fresh()
    expect(rules.act(g, city, { kind: 'fare', mode: 'bus', perKm: 250 }).ok).toBe(true)
    expect(rules.state(g, city).prices?.busPerKm).toBe(2.5)
    expect(g.done).toEqual([{ month: 0, action: { kind: 'fare', mode: 'bus', perKm: 250 } }])
  })

  it('may change more than once a month', () => {
    const g = fresh()
    expect(rules.act(g, city, { kind: 'fare', mode: 'metro', perKm: 500 }).ok).toBe(true)
    expect(rules.act(g, city, { kind: 'fare', mode: 'metro', perKm: 550 }).ok).toBe(true)
  })

  it('refuse a fare outside its limits, not whole, of no such mode, or unchanged', () => {
    const g = fresh()
    expect(refused(g, { kind: 'fare', mode: 'metro', perKm: 950 })).toMatch(/between ₹2.00 a km and ₹9.00 a km/)
    refused(g, { kind: 'fare', mode: 'bus', perKm: 40 })
    refused(g, { kind: 'fare', mode: 'rail', perKm: 15 })
    refused(g, { kind: 'fare', mode: 'metro', perKm: 4.5 })
    refused(g, { kind: 'fare', mode: 'metro', perKm: -300 })
    refused(g, { kind: 'fare', mode: 'car', perKm: 300 })
    refused(g, { kind: 'fare', mode: 'metro', perKm: 450 })
  })
})

describe('anything else', () => {
  it('is refused: no action, an unknown kind, and every action once the game is over', () => {
    const g = fresh()
    refused(g, null)
    refused(g, { kind: 'bribe', amount: 5 })
    g.status = 'finished'
    expect(refused(g, { kind: 'fare', mode: 'bus', perKm: 200 })).toBe('The game is over.')
  })

  it('is not recorded with fields it did not need', () => {
    const g = fresh()
    rules.act(g, city, { kind: 'borrow', amount: 10_000, extra: 'x' } as unknown as Action)
    expect(g.done[0]!.action).toEqual({ kind: 'borrow', amount: 10_000 })
  })
})

describe('the state of the city for the model', () => {
  it('grows every zone’s people and jobs with the city, in whole numbers', () => {
    const g = fresh()
    expect(rules.state(g, city).zones).toBe(city.zones)
    g.people = 11_234
    const zones = rules.state(g, city).zones
    zones.forEach((z, k) => {
      expect(Number.isInteger(z.people) && Number.isInteger(z.jobs)).toBe(true)
      expect(z.people).toBe(Math.round((city.zones[k]!.people * 11_234) / 10_000))
      expect(z.jobs).toBe(Math.round((city.zones[k]!.jobs * 11_234) / 10_000))
    })
    expect(rules.state(g, city).seed).toBe(testSeason.seed)
  })
})

describe('words for the player', () => {
  it('group digits the Indian way and name months', () => {
    expect(grouped(12_345_678)).toBe('1,23,45,678')
    expect(grouped(999)).toBe('999')
    expect(crore(214_000)).toBe('₹2,140 crore')
    expect(crore(-3500)).toBe('−₹35 crore')
    expect(crore(450)).toBe('₹4.5 crore')
    expect(crore(1_234_500)).toBe('₹12,345 crore')
    expect(perKm(450)).toBe('₹4.50 a km')
    expect(monthName(0)).toBe('January 2026')
    expect(monthName(119)).toBe('December 2035')
  })
})

describe('the rules’ own code', () => {
  it('uses no arithmetic that differs between machines, no clock and no chance', () => {
    const dir = new URL('../src/rules/', import.meta.url)
    for (const file of readdirSync(dir)) {
      const src = readFileSync(new URL(file, dir), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
      expect(src, file).not.toMatch(/Math\.(exp|log|pow|sin|cos|tan|random|cbrt|hypot)|\*\*|Date\.|performance\./)
    }
  })
})
