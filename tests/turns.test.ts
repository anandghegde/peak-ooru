import { describe, expect, it } from 'vitest'
import { matches, type Kept } from '../src/game/keep'
import { spanReport } from '../src/game/report'
import { STANDIN_SEASON, standInRules } from '../src/game/standin-rules'
import type { Game, Report } from '../src/rules/types'
import type { Outlook } from '../src/sim/worker'
import { crore, grouped, monthShort, span } from '../src/ui/format'
import { compare } from '../src/ui/levers'
import { believable, causeLine, figureLine } from '../src/ui/report'

describe('numbers for the player', () => {
  it('group digits as in India', () => {
    expect(grouped(20583674)).toBe('2,05,83,674')
  })

  it('show lakh as crore', () => {
    expect(crore(214_000)).toBe('₹2,140 crore')
    expect(crore(-350)).toBe('−₹3.5 crore')
  })

  it('name months and spans of months', () => {
    expect(monthShort(14)).toBe('Mar 2027')
    expect(span(14, 14)).toBe('March 2027')
    expect(span(12, 17)).toBe('January to June 2027')
    expect(span(10, 13)).toBe('November 2026 to February 2027')
  })
})

describe('the report', () => {
  it('reads figures first, with the change', () => {
    const f = { key: 'commute' as const, name: 'Commute', now: 52.4, before: 53, unit: 'min', causes: [] }
    expect(figureLine(f)).toBe('Commute 52.4 min, down 0.6')
    const money = { key: 'money' as const, name: 'Money', now: 2140, before: 2112, unit: 'crore', causes: [] }
    expect(figureLine(money)).toBe('Money ₹2,140 crore, up ₹28 crore')
  })

  it('puts the figure in front of a cause given only in words', () => {
    expect(causeLine('from cheaper bus fares', -0.4)).toBe('0.4 from cheaper bus fares')
    expect(causeLine('−0.4 min from cheaper bus fares', -0.4)).toBe('−0.4 min from cheaper bus fares')
  })

  it('covers a skip in one report: figures from its start to its end, books summed', () => {
    const month = (m: number, commute: [number, number], tax: number, needs: string[] = []): Report => ({
      from: m,
      to: m,
      figures: [{ key: 'commute', name: 'Commute', before: commute[0], now: commute[1], unit: 'min', causes: [] }],
      books: [{ key: 'tax', name: 'Property tax', amount: tax }],
      news: [`News of ${m}`],
      needs,
    })
    const r = spanReport([month(3, [50, 51], 100), month(4, [51, 52], 110), month(5, [52, 51.5], 120, ['Low'])])!
    expect([r.from, r.to]).toEqual([3, 5])
    expect(r.figures[0]).toMatchObject({ before: 50, now: 51.5 })
    expect(r.books[0]!.amount).toBe(330)
    expect(r.news).toHaveLength(3)
    expect(r.needs).toEqual(['Low'])
  })
})

describe('a forecast', () => {
  const outlook = (commute: number, bus: number, fares: number, money: number): Outlook => ({
    commute,
    trips: { car: 1, twoWheeler: 1, auto: 0, bus, metro: 0, rail: 0, cycle: 0, walk: 0 },
    riders: {},
    books: [{ key: 'fares-bus', name: 'Bus fares', amount: fares }, { key: 'grant', name: 'Grant', amount: 13_000 }],
    money,
  })

  it('shows what a fare moves, and only the books that move', () => {
    const rows = compare({ kind: 'fare', mode: 'bus', perKm: 120 }, outlook(3000, 4_000_000, 7_000, 200_000),
      outlook(2990, 4_200_000, 5_500, 198_500))
    expect(rows.map((r) => r[0])).toEqual([
      'Average commute', 'Bus trips a day', 'Car and two-wheeler trips', 'Bus fares', 'Money at the month’s end',
    ])
    expect(rows[1]).toEqual(['Bus trips a day', '40.0 lakh', '42.0 lakh'])
  })
})

describe('a kept game', () => {
  const city = { zones: [], roads: { nodes: [], links: [], zoneNode: [] }, transit: { stations: [], lines: [] } }
  const game: Game = standInRules.start(STANDIN_SEASON, city)
  standInRules.act(game, city, { kind: 'borrow', amount: 10_000 })
  const kept = (g: Game | null, month = 0): Kept => ({ version: '1', season: STANDIN_SEASON, done: game.done, month, times: [], game: g })

  it('is taken as it is when it agrees with its list of actions', () => {
    expect(matches(kept(game))).toBe(true)
  })

  it('is played again when it is missing or does not agree', () => {
    expect(matches(kept(null))).toBe(false)
    expect(matches(kept(game, 5))).toBe(false)
    expect(matches(kept({ ...game, done: [] }))).toBe(false)
  })
})

describe('a cause', () => {
  it('is left out when it is larger than the change it explains, or comes from growth too small to matter', () => {
    expect(believable({ text: '−0.4 min from the bus fare falling to ₹1.20 a km', amount: -0.4 }, -0.6)).toBe(true)
    expect(believable({ text: '−0.5 min from 0.21% more people', amount: -0.5 }, -0.1)).toBe(false)
    expect(believable({ text: '+0.1 min from 0.21% more people', amount: 0.1 }, 0.3)).toBe(false)
    expect(believable({ text: '+0.2 min from 1.16% more people', amount: 0.2 }, 0.2)).toBe(true)
  })
})
