import { describe, expect, it } from 'vitest'
import { rules } from '../src/rules/index'
import { SCORE } from '../src/rules/params'
import { netMoney } from '../src/rules/reasons'
import { fairness, MEASURES, pointsFor, scoreOf, trafficMeasures } from '../src/rules/score'
import type { Game, Measured, Season } from '../src/rules/types'
import { firstSeason } from '../src/seasons/first'
import { simulate } from '../src/sim/index'
import type { MonthResult } from '../src/sim/types'
import { smallCity, testSeason } from './rules-city'

/* The score (slice 7, PRD section 6): seven measures, marks, averages, whole numbers, penalties and replay. */

const city = smallCity()
const season: Season = { ...testSeason, marks: firstSeason.marks }
const fresh = (s = season): Game => rules.start(s, city)
const month = (g: Game) => rules.endMonth(g, city, simulate(rules.state(g, city)))

describe('points against the marks (PRD SCORE-10)', () => {
  it('runs from 0 to 100, in tenths, either way round, and holds at the ends', () => {
    expect(pointsFor(150, { none: 100, full: 200 })).toBe(500)
    expect(pointsFor(50, { none: 100, full: 200 })).toBe(0)
    expect(pointsFor(250, { none: 100, full: 200 })).toBe(1000)
    // A commute: less is better.
    expect(pointsFor(3000, { none: 3600, full: 2800 })).toBe(750)
    expect(pointsFor(4000, { none: 3600, full: 2800 })).toBe(0)
  })

  it('weighs the seven measures as the PRD does, to a thousand in all', () => {
    expect(MEASURES).toEqual(['access', 'commute', 'clean', 'safety', 'fairness', 'money', 'approval'])
    expect(Object.values(SCORE.weights).reduce((a, b) => a + b, 0)).toBe(1000)
    expect(SCORE.weights).toMatchObject({ access: 250, commute: 200, clean: 150, safety: 100, fairness: 100, money: 100, approval: 100 })
  })

  it('publishes the first season\'s marks, one pair for each measure', () => {
    for (const key of MEASURES) {
      const m = firstSeason.marks![key]
      expect(Number.isInteger(m.none) && Number.isInteger(m.full) && m.none !== m.full).toBe(true)
    }
  })
})

describe('fairness (PRD SCORE-5)', () => {
  const result = (access: number[], commute: number[]) => ({ accessByZone: Int16Array.from(access), commuteByZone: Int32Array.from(commute) }) as unknown as MonthResult

  it('is 1000 where everyone is served alike', () => {
    expect(fairness(result([100, 100, 100], [3000, 3000, 3000]), [10, 20, 30], [0, 1, 2])).toBe(1000)
  })

  it('takes the worst-served fifth of the people, not of the zones', () => {
    // One zone of 20 people with no reach at all, and one of 80 with 100: the worst fifth is exactly the first.
    const r = result([0, 100], [6000, 3000])
    // Access: 0 against the city's 80; commute: the city's 3600 against 6000.
    expect(fairness(r, [20, 80], [0, 1])).toBe(Math.round((0 + Math.round((3600 * 1000) / 6000)) / 2))
    // With the zones' people the other way round, the fifth is a quarter of the big zone: all the worst figure still.
    const s = result([0, 100], [6000, 3000])
    expect(fairness(s, [80, 20], [0, 1])).toBe(Math.round((0 + Math.round((5400 * 1000) / 6000)) / 2))
  })

  it('counts zones with no people for nothing', () => {
    expect(fairness(result([0, 100, 100], [9000, 3000, 3000]), [0, 10, 10], [0, 1, 2])).toBe(1000)
  })
})

describe('the score as the game goes (PRD SCORE-11)', () => {
  const g = fresh()
  for (let k = 0; k < 30; k++) month(g)

  it('keeps each month\'s figures as whole numbers', () => {
    expect(g.measured).toHaveLength(30)
    for (const m of g.measured!) for (const key of MEASURES) expect(Number.isInteger(m[key])).toBe(true)
  })

  it('scores each year on its twelve months, and approval on thirty-six, exactly, and weighs the years (slice 8)', () => {
    const m = g.measured!
    const avg = (key: 'access' | 'approval', end: number) => {
      const n = key === 'approval' ? 36 : 12
      const from = Math.max(0, end - n)
      return Math.round(m.slice(from, end).reduce((a, x) => a + x[key], 0) / (end - from))
    }
    const w = firstSeason.years!
    // 2026 and 2027 are done, as their Decembers stood; 2028 is in hand, as it stands after six months.
    for (const key of ['access', 'approval'] as const) {
      const p = [12, 24, 30].map((end) => pointsFor(avg(key, end), season.marks![key]))
      const weighed = Math.round((w[0]! * p[0]! + w[1]! * p[1]! + w[2]! * p[2]!) / (w[0]! + w[1]! + w[2]!))
      expect(g.score!.measures.find((x) => x.key === key)!.points).toBe(weighed)
    }
    expect(g.score!.years!.map((y) => [y.year, y.weight, y.done])).toEqual([[2026, w[0], true], [2027, w[1], true], [2028, w[2], false]])
    // The figure shown is the city as it is now: the last twelve months.
    expect(g.score!.measures.find((x) => x.key === 'access')!.value).toBe(avg('access', 30) / 10)
  })

  it('is a whole number from 0 to 1000, the weighted sum of the points', () => {
    const s = g.score!
    expect(Number.isInteger(s.total)).toBe(true)
    expect(s.total).toBe(Math.round(s.measures.reduce((a, m) => a + m.points * m.weight, 0) / 1000))
    expect(s.total).toBeGreaterThan(0)
    expect(s.total).toBeLessThanOrEqual(1000)
    expect(rules.score(g, city)).toEqual(s)
  })

  it('keeps the total at each year\'s end, and reports the score before and after', () => {
    expect(g.scores).toHaveLength(2)
    const r = g.reports.at(-1)!
    expect(r.score!.now).toEqual(g.score)
    expect(r.score!.before.total).toBeGreaterThan(0)
  })

  it('plays again from the list of actions to the same score, to the last figure', () => {
    const played = fresh()
    rules.act(played, city, { kind: 'fare', mode: 'metro', perKm: 600 })
    for (let k = 0; k < 14; k++) month(played)
    rules.act(played, city, { kind: 'tax', rate: 11_000 })
    for (let k = 0; k < 14; k++) month(played)
    const again = rules.replay(season, city, played.done, simulate, played.month)
    expect(JSON.stringify(again.score)).toBe(JSON.stringify(played.score))
    expect(JSON.stringify(again.measured)).toBe(JSON.stringify(played.measured))
    expect(JSON.stringify(again)).toBe(JSON.stringify(played))
  })

  it('reads the traffic measures from the month as the model gives it', () => {
    const r = simulate(rules.state(g, city))
    const t = trafficMeasures(r, city, g.zonePeople!)
    expect(t.access).toBe(r.access)
    expect(t.commute).toBe(r.commute)
    expect(t.fairness).toBeGreaterThan(0)
    expect(t.fairness).toBeLessThanOrEqual(1000)
  })
})

describe('money for the score (PRD SCORE-6, SCORE-12)', () => {
  it('counts what is owed and what is still to pay on work under way, in full', () => {
    const g = fresh({ ...season, money: 400_000 })
    const at = (x: number, y: number) => ({ at: [77.55 + x / 108.48, 12.93 + y / 110.57] as [number, number] })
    const before = netMoney(g)
    expect(rules.act(g, city, { kind: 'borrow', amount: 100_000 })).toEqual({ ok: true })
    // Borrowing makes the city no richer.
    expect(netMoney(g)).toBe(before)
    expect(rules.act(g, city, { kind: 'build', plan: { kind: 'metro', stops: [at(0, 0), at(8, 0)] } })).toEqual({ ok: true })
    const cost = g.projects![0]!.cost
    expect(netMoney(g)).toBe(before - cost)
    month(g)
    // Paying for the work as it goes leaves it where ordering put it, but for the month's own books.
    const m = g.measured![0]!
    expect(m.money).toBe(netMoney(g))
    expect(m.money).toBe(g.money - g.loans.reduce((x, l) => x + l.owed, 0) - (cost - Math.floor(cost / (g.projects![0]!.opens - g.projects![0]!.started))))
    const cause = g.score!.measures.find((x) => x.key === 'money')!.causes.map((c) => c.text).join(' ')
    expect(cause).toMatch(/: ordering /)
  })
})

describe('an early end (PRD MONEY-5, APP-4, APP-5)', () => {
  const measured = (money: number): Measured => ({ month: 0, access: 150, commute: 3000, clean: 540, safety: 700, fairness: 440, money, approval: 500 })

  it('loses half the score when the player is replaced, and money too on a default', () => {
    const g = fresh()
    g.measured = [measured(100_000)]
    const whole = scoreOf(g).total
    g.status = 'replaced'
    const replaced = scoreOf(g)
    expect(replaced.total).toBe(whole - (whole - Math.round(whole / 2)))
    expect(replaced.penalty!.text).toMatch(/replaced/)
    g.status = 'default'
    const broke = scoreOf(g)
    expect(broke.measures.find((m) => m.key === 'money')!.points).toBe(0)
    expect(broke.total).toBeLessThan(replaced.total)
    expect(broke.penalty!.text).toMatch(/defaulted/)
  })

  it('scores nothing before the first month has been worked out, unless the season publishes the city as it starts', () => {
    expect(rules.score(fresh(), city).total).toBe(0)
    const opening = { access: 146, commute: 3454, clean: 527, safety: 829, fairness: 435, money: 200_000, approval: 550 }
    const g = fresh({ ...season, opening })
    const s = rules.score(g, city)
    expect(s.total).toBeGreaterThan(0)
    expect(g.score).toEqual(s)
    // Each measure away from its ends, as the marks are set; but money, which scores in full from ₹1,000 crore (slice 9),
    // and the city starts with ₹2,000 crore.
    for (const m of s.measures) expect(m.points > 0 && (m.points < 1000 || m.key === 'money'), m.key).toBe(true)
    expect(s.measures.find((m) => m.key === 'money')!.points).toBe(1000)
    // Once a month is worked out, the month's own figures replace the season's.
    month(g)
    expect(g.measured).toHaveLength(1)
  })
})

describe('reasons for the score (PRD SCORE-13, SCORE-14)', () => {
  it('gives each measure its causes at the end of a skip, or says there was no measurable change', async () => {
    const { skip } = await import('../src/rules/skip')
    const g = fresh()
    month(g)
    rules.act(g, city, { kind: 'fare', mode: 'metro', perKm: 700 })
    const report = skip(g, city, simulate, 3)
    expect(report.score).toBeDefined()
    for (const m of report.score!.now.measures) {
      for (const c of m.causes) {
        expect(c.text).not.toMatch(/!/)
        expect(Number.isFinite(c.amount)).toBe(true)
      }
      expect(m.causes.length).toBeLessThanOrEqual(3)
    }
    const clean = report.score!.now.measures.find((m) => m.key === 'clean')!
    expect(clean.causes.map((c) => c.text).join(' ')).toMatch(/metro fare rising to ₹7.00 a km|No measurable change|none large enough to name/)
    // The game keeps the score as the month's end left it: the causes found by the model are the report's alone.
    expect(JSON.stringify(g.score)).not.toContain('metro fare rising')
  })

  it('answers "why is this bad?" for a zone and a road, in sentences and numbers', async () => {
    const { whyZone, whyRoad } = await import('../src/rules/why')
    const g = fresh()
    month(g)
    const zone = whyZone(g, city, city.zones[0]!.id)!
    expect(zone.lines.join(' ')).toMatch(/The commute from here is [\d.]+ minutes/)
    expect(zone.lines.join(' ')).toMatch(/can reach [\d.]+% of the city's jobs/)
    const busiest = city.roads.links.reduce((a, l) => ((g.last!.flow.evening[l.id] ?? 0) > (g.last!.flow.evening[a.id] ?? 0) ? l : a))
    const road = whyRoad(g, city, busiest.id)!
    expect(road.lines[0]).toMatch(/vehicles an hour/)
    expect(road.lines.join(' ')).toMatch(/Its surface is (good|fair|poor|broken)/)
    for (const c of road.causes) expect(c.amount).toBeGreaterThan(0)
    expect(whyZone(rules.start(season, city), city, 0)).toBeNull()
  })
})

describe('reasons over a span of months (PRD TIME-8, SCORE-13)', () => {
  it('judge the change over the whole span, not the last month only', async () => {
    const { combine } = await import('../src/rules/report')
    const { NOISE } = await import('../src/rules/params')
    const g = fresh()
    month(g)
    rules.act(g, city, { kind: 'fare', mode: 'metro', perKm: 900 })
    rules.act(g, city, { kind: 'fare', mode: 'bus', perKm: 400 })
    const reports = [month(g), month(g), month(g), month(g), month(g), month(g)]
    const span = combine(reports)
    const from = span.measured!.before!
    const to = span.measured!.now
    expect(from.month).toBe(0)
    expect(to.month).toBe(6)
    let moved = 0
    for (const m of span.score!.now.measures) {
      if (m.key === 'money' || m.key === 'approval') continue
      const change = Math.abs(to[m.key] - from[m.key])
      if (change >= NOISE[m.key]) {
        moved++
        expect(m.causes.map((c) => c.text), m.key).not.toContain('No measurable change')
      } else expect(m.causes.map((c) => c.text), m.key).toEqual(['No measurable change'])
    }
    expect(moved).toBeGreaterThan(0)
  })
})
