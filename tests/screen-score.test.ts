import { describe, expect, it } from 'vitest'
import type { Zone } from '../src/data/types'
import { deeds, roadKmOf } from '../src/game/deeds'
import { contribution, MEASURES, movedMost, ordered, servedByZone, standInEvents, standInScore, worstFifth } from '../src/game/score'
import type { Game, Measure, Score } from '../src/rules/types'
import type { RoutingNetwork } from '../src/sim/types'
import { measureValue, signed } from '../src/ui/score'

const zone = (id: number, people: number): Zone =>
  ({ id, name: `Z${id}`, nameKn: null, node: 0, centre: [77.6, 12.9], area: 1, people, jobs: 1000, income: 3 })

const measure = (key: Measure['key'], points: number, weight: number): Measure =>
  ({ key, name: key, weight, value: 0, unit: '%', points, causes: [] })

describe('the score on the screen', () => {
  it('weighs the seven measures to a thousand', () => {
    expect(MEASURES).toHaveLength(7)
    expect(MEASURES.reduce((s, m) => s + m.weight, 0)).toBe(1000)
    // A measure at full points adds its whole weight.
    expect(contribution({ points: 1000, weight: 250 })).toBe(250)
    expect(contribution({ points: 400, weight: 200 })).toBe(80)
  })

  it('says each measure in its own unit', () => {
    expect(measureValue({ value: 57.46, unit: 'minutes' })).toBe('57.5 min')
    expect(measureValue({ value: 14.6, unit: '% of jobs within 45 minutes' })).toBe('14.6% of jobs within 45 minutes')
    expect(measureValue({ value: 2000, unit: '₹ crore, less debts' })).toBe('₹2,000 crore')
    expect(measureValue({ value: 55, unit: 'of 100' })).toBe('55 of 100')
    expect(signed(12)).toBe('+1.2')
    expect(signed(-4)).toBe('−0.4')
    expect(signed(0)).toBe('0')
  })

  it('finds the measure that moved the total most, by its weight', () => {
    const before: Score = { total: 0, measures: [measure('access', 400, 250), measure('money', 400, 100)] }
    const now: Score = { total: 0, measures: [measure('access', 420, 250), measure('money', 450, 100)] }
    // Access rose 2 points at a quarter's weight (5 of the total); money 5 points at a tenth (5): access comes first.
    expect(movedMost(now, before)?.measure.key).toBe('access')
    expect(ordered({ total: 0, measures: [measure('money', 0, 100), measure('access', 0, 250)] }).map((m) => m.key)).toEqual(['access', 'money'])
  })

  it('marks a fifth of the zones as the worst served, and leaves out zones where few live', () => {
    const zones = Array.from({ length: 10 }, (_, i) => zone(i, i === 9 ? 100 : 10_000))
    const access = zones.map((z) => 100 + z.id * 10)
    const commute = zones.map(() => 3000)
    const served = servedByZone(zones, access, commute)
    expect(Number.isNaN(served[9]!)).toBe(true)
    const worst = worstFifth(served)
    expect([...worst]).toEqual([0, 1])
  })

  it('gives a stand-in score of seven measures between 0 and 1,000', () => {
    const game = { people: 10_000, loans: [], money: 200_000, approval: 550, last: null } as unknown as Game
    const s = standInScore(game, [zone(0, 10_000)], null)
    expect(s.measures).toHaveLength(7)
    expect(s.total).toBeGreaterThan(300)
    expect(s.total).toBeLessThan(500)
    expect(standInEvents(null).every((e) => e.started >= 3)).toBe(true)
  })
})

describe('what the player did, for the ending', () => {
  const roads: RoutingNetwork = {
    nodes: [
      { id: 0, at: [77_600_000, 12_900_000], gateway: false, signal: false },
      { id: 1, at: [77_610_000, 12_900_000], gateway: false, signal: false },
    ],
    links: [
      { id: 0, from: 0, to: 1, length: 2000, kind: 'primary', lanes: 2, speed: 40, capacity: 3000, drawn: [0], forward: [true] },
      { id: 1, from: 1, to: 0, length: 2000, kind: 'primary', lanes: 2, speed: 40, capacity: 3000, drawn: [0], forward: [false] },
    ],
    zoneNode: [0],
  }

  it('counts a road mended both ways once', () => {
    expect(roadKmOf(roads, [0, 1])).toBe(2)
    expect(roadKmOf(roads, [0])).toBe(2)
  })

  it('names what was built and mended, and what came of it', () => {
    const game = {
      done: [{ month: 3, action: { kind: 'build', plan: { kind: 'repair', links: [0, 1], work: 'resurface' } } }],
      built: { lines: [], stations: [], busLanes: [], vehicles: {} },
      reports: [
        { figures: [{ key: 'commute', now: 57, before: 57.5 }, { key: 'safety', now: 1400, before: 1400 }] },
        { figures: [{ key: 'commute', now: 52.1, before: 52.3 }, { key: 'safety', now: 1148, before: 1150 }] },
      ],
    } as unknown as Game
    const lines = deeds(game, roads)
    expect(lines[0]).toBe('Resurfaced 2 km of road')
    expect(lines).toContain('Road deaths down 18%')
    expect(lines).toContain('Commute down 5.4 minutes')
    expect(lines.length).toBeLessThanOrEqual(3)
  })

  it('says so when nothing was built', () => {
    const game = { done: [], built: undefined, reports: [] } as unknown as Game
    expect(deeds(game, roads)).toEqual(['Built nothing'])
  })
})
