import { describe, expect, it } from 'vitest'
import { gameDigest } from '../src/rules/digest'
import { rules } from '../src/rules/index'
import { MEASURES, scoreOf, yearWeights } from '../src/rules/score'
import type { Game, Measured, Season } from '../src/rules/types'
import { firstSeason } from '../src/seasons/first'
import { openSeason } from '../src/seasons/open'
import { simulate } from '../src/sim/index'
import { smallCity, testSeason } from './rules-city'

/* Slice 8: the score of ten years. Each year scored as its December stood; the years weighed, later ones more. */

const LAST_ONLY = [0, 0, 0, 0, 0, 0, 0, 0, 0, 1000]

/** A game of `months` months whose figures are `good` or not in each month, as `good(month)` says. */
function game(months: number, good: (month: number) => boolean, years?: number[], status: Game['status'] = 'playing'): Game {
  const o = firstSeason.opening!
  const best = { access: 170, commute: 2700, clean: 580, safety: 500, fairness: 560, money: 300_000, approval: 800 }
  const measured: Measured[] = Array.from({ length: months }, (_, month) => ({ month, ...(good(month) ? best : o) }))
  return { season: { ...firstSeason, years }, measured, status } as unknown as Game
}

describe('the weights of the years', () => {
  it('are ten whole numbers from 2026 to 2035 that sum to a thousand, each year counting more than the one before', () => {
    const w = firstSeason.years!
    expect(w).toHaveLength(10)
    expect(w.reduce((a, b) => a + b, 0)).toBe(1000)
    for (let k = 1; k < 10; k++) {
      expect(Number.isInteger(w[k])).toBe(true)
      expect(w[k]!).toBeGreaterThan(w[k - 1]!)
    }
    // About 3% for 2026, a fifth and more for 2035.
    expect(w[0]).toBe(30)
    expect(w[9]!).toBeGreaterThan(200)
    // A season without its own takes the first season's.
    expect(yearWeights({ ...firstSeason, years: undefined })).toEqual(w)
  })
})

describe('the score of ten years', () => {
  it('is, at the end, the years\' scores weighed together', () => {
    const g = game(120, (m) => m >= 84)
    const s = scoreOf(g)
    expect(s.years).toHaveLength(10)
    expect(s.years!.every((y) => y.done)).toBe(true)
    const weighed = s.years!.reduce((a, y) => a + y.weight * y.total, 0) / 1000
    // Each measure's points are weighed, and the total made from them: within a point of the years' totals weighed.
    expect(Math.abs(s.total - weighed)).toBeLessThanOrEqual(1)
    expect(s.total).toBe(Math.round(s.measures.reduce((a, m) => a + m.points * m.weight, 0) / 1000))
  })

  it('rewards governing well for ten years over sitting still for seven and then spending', () => {
    const throughout = scoreOf(game(120, () => true)).total
    const late = scoreOf(game(120, (m) => m >= 84)).total
    const early = scoreOf(game(120, (m) => m < 36)).total
    expect(throughout).toBeGreaterThan(late)
    // Seven years sat through count for nearly half: late spending gains a little over half of governing throughout.
    const start = scoreOf(game(120, () => false)).total
    expect((late - start) / (throughout - start)).toBeLessThan(0.65)
    // Later years count more: the last three good are worth more than the first three.
    expect(late).toBeGreaterThan(early)
  })

  it('under the rule before slice 8 (the last weight a thousand), is the last year alone (approval: its thirty-six months)', () => {
    const late = scoreOf(game(120, (m) => m >= 84, LAST_ONLY)).total
    const throughout = scoreOf(game(120, () => true, LAST_ONLY)).total
    expect(late).toBe(throughout)
  })

  it('as the game goes, is the final score so far by the same rule, and does not jump at a year\'s end or the last', () => {
    const good = (m: number) => m % 24 < 12
    const totals = Array.from({ length: 121 }, (_, n) => scoreOf(game(n || 1, good)).total)
    // From one month to the next it moves as the averages move: never by more than the months' own change allows.
    for (let n = 2; n <= 120; n++) expect(Math.abs(totals[n]! - totals[n - 1]!), `month ${n}`).toBeLessThanOrEqual(80)
    // At the end, the final score.
    expect(totals[120]).toBe(scoreOf(game(120, good)).total)
    // In December and the January after, the year just done counts as that December stood.
    const dec = scoreOf(game(36, good))
    const jan = scoreOf(game(37, good))
    expect(jan.years!.slice(0, 3)).toEqual(dec.years!.slice(0, 3))
    expect(jan.years![3]!.done).toBe(false)
  })

  it('leaves out the years not reached, when a game ends early, and then takes half', () => {
    const g = game(50, () => true, undefined, 'replaced')
    const s = scoreOf(g)
    expect(s.years!.map((y) => y.year)).toEqual([2026, 2027, 2028, 2029, 2030])
    const whole = scoreOf({ ...g, status: 'playing' }).total
    expect(s.total).toBe(whole - (whole - Math.round(whole / 2)))
  })

  it('keeps the score a game shows the same when played again, and in its fingerprint', () => {
    const city = smallCity()
    const season: Season = { ...testSeason, marks: firstSeason.marks, years: firstSeason.years }
    const g = rules.start(season, city)
    for (let k = 0; k < 15; k++) rules.endMonth(g, city, simulate(rules.state(g, city)))
    const again = rules.replay(season, city, g.done, simulate, 15)
    expect(again.score).toEqual(g.score)
    expect(gameDigest(again)).toBe(gameDigest(g))
    expect(g.score!.years!.map((y) => y.year)).toEqual([2026, 2027])
    for (const key of MEASURES) expect(g.score!.measures.find((m) => m.key === key)!.points).toBeGreaterThanOrEqual(0)
  })
})

describe('the open season (slice 8)', () => {
  it('is the first season with the daily allowance on, scored alike', () => {
    expect(openSeason.allowance).toBe(true)
    expect(firstSeason.allowance).toBe(false)
    expect(openSeason.id).not.toBe(firstSeason.id)
    const { id: _a, allowance: _b, ...open } = openSeason
    const { id: _c, allowance: _d, ...first } = firstSeason
    expect(open).toEqual(first)
  })
})
