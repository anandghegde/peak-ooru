import { describe, expect, it } from 'vitest'
import { rules } from '../src/rules/index'
import { skip, skipAsync } from '../src/rules/skip'
import type { Game } from '../src/rules/types'
import { simulate } from '../src/sim/index'
import { smallCity, testSeason } from './rules-city'

const city = smallCity()
const fresh = () => rules.start(testSeason, city)

describe('skipping ahead', () => {
  it('by a month ends one month, with one report', () => {
    const g = fresh()
    const report = skip(g, city, simulate, 1)
    expect(g.month).toBe(1)
    expect([report.from, report.to]).toEqual([0, 0])
  })

  it('by three months gives one report for all three', () => {
    const g = fresh()
    const report = skip(g, city, simulate, 3)
    expect(g.month).toBe(3)
    expect([report.from, report.to]).toEqual([0, 2])
    expect(g.reports).toHaveLength(3)
    expect(report.news[0]).toBe('Your term as commissioner has begun.')
  })

  it('to the next thing that needs the player stops at the year’s end', () => {
    const g = fresh()
    skip(g, city, simulate, 2)
    const report = skip(g, city, simulate, 'event')
    expect(g.month).toBe(12)
    expect(report.to).toBe(11)
    expect(report.needs[0]).toMatch(/2026 is over/)
  })

  it('of twelve months stops early at the year’s end', () => {
    const g = fresh()
    skip(g, city, simulate, 6)
    skip(g, city, simulate, 12)
    expect(g.month).toBe(12)
  })

  it('never passes a month in which the player could lose', () => {
    const g = fresh()
    g.money = -10_000_000
    const first = skip(g, city, simulate, 12)
    expect(g.month).toBe(1)
    expect(first.needs[0]).toMatch(/below nothing.*end of March 2026, the state takes over/)
    skip(g, city, simulate, 'event')
    expect(g.month).toBe(2)
    expect(g.status).toBe('playing')
    skip(g, city, simulate, 6)
    expect(g.status).toBe('default')
    expect(g.month).toBe(3)
  })

  it('stops when money will run out within three months at this rate', () => {
    const g = fresh()
    skip(g, city, simulate, 1)
    // A loan that takes far more each month than the city earns.
    g.loans.push({ id: 9, amount: 5_000_000, owed: 5_000_000, rate: 800, payment: 400_000, monthsLeft: 60, taken: 0 })
    g.money = 500_000
    const report = skip(g, city, simulate, 6)
    expect(g.month).toBe(2)
    expect(g.money).toBeGreaterThan(0)
    expect(report.needs[0]).toMatch(/At this rate money runs out at the end of/)
  })

  it('can be stopped between months, and says how far it has come', () => {
    const g = fresh()
    const seen: number[] = []
    skip(g, city, simulate, 6, { progress: (done) => seen.push(done), stop: () => seen.length >= 2 })
    expect(g.month).toBe(2)
    expect(seen).toEqual([1, 2])
  })

  it('does not run past the last month', () => {
    const g = fresh()
    // Each skip stops where something needs the player: the year's end, an opening, an event.
    for (let k = 0; k < 200 && g.status === 'playing'; k++) skip(g, city, simulate, 'event')
    expect(g.month).toBe(120)
    expect(g.status).toBe('finished')
    expect(() => skip(g, city, simulate, 1)).toThrow()
  })

  it('comes to the same with a model that answers later', async () => {
    const a = fresh()
    const b = fresh()
    for (const g of [a, b]) {
      skip(g, city, simulate, 1)
      rules.act(g, city, { kind: 'fare', mode: 'metro', perKm: 700 })
    }
    const sync = skip(a, city, simulate, 3)
    const later = await skipAsync(b, city, async (s) => simulate(s), 3, { pause: () => Promise.resolve() })
    expect(JSON.stringify(later)).toBe(JSON.stringify(sync))
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
  })
})

describe('a skip’s report', () => {
  it('leaves the game as ending the months one by one would', () => {
    const a = fresh()
    const b: Game = fresh()
    skip(a, city, simulate, 5)
    for (let k = 0; k < 5; k++) rules.endMonth(b, city, simulate(rules.state(b, city)))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
