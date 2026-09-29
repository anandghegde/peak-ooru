import { describe, expect, it } from 'vitest'
import { rules } from '../src/rules/index'
import { balance } from '../src/rules/money'
import { combine, explain, spanStart, traffic } from '../src/rules/report'
import { skip } from '../src/rules/skip'
import type { Game } from '../src/rules/types'
import { simulate } from '../src/sim/index'
import type { CityState } from '../src/sim/types'
import { smallCity, testSeason } from './rules-city'

const city = smallCity()
const fresh = () => rules.start(testSeason, city)
const end = (g: Game) => rules.endMonth(g, city, simulate(rules.state(g, city)))

describe('a month’s report', () => {
  it('gives each figure before and now, the books, and the money’s largest items as its causes', () => {
    const g = fresh()
    end(g)
    const report = end(g)
    expect(report.from).toBe(1)
    expect(report.to).toBe(1)
    // Road deaths come once the model gives them (slice 5).
    const deaths = g.last!.deaths !== undefined
    expect(report.figures.map((f) => f.key)).toEqual(['commute', 'speed', 'access', 'clean', ...(deaths ? ['safety'] : []), 'money', 'approval', 'roads'])
    if (deaths) expect(report.figures.find((f) => f.key === 'safety')).toMatchObject({ name: 'Road deaths a year', now: g.last!.deaths })
    const money = report.figures.find((f) => f.key === 'money')!
    expect(Math.round((money.now - money.before) * 100)).toBe(balance(report.books))
    expect(money.causes).toHaveLength(3)
    expect(money.causes[0]!.text).toMatch(/^\+₹[\d,]+ crore: property tax$/)
    for (const f of report.figures) expect(f.causes.length).toBeLessThanOrEqual(3)
  })

  it('says what the player did, with what it was before', () => {
    const g = fresh()
    rules.act(g, city, { kind: 'fare', mode: 'metro', perKm: 550 })
    rules.act(g, city, { kind: 'tax', rate: 11_000 })
    const news = end(g).news.join(' ')
    expect(news).toMatch(/The metro fare went up from ₹4.50 a km to ₹5.50 a km\./)
    expect(news).toMatch(/You set property tax at 110% of the standard rate, from 100%\./)
  })

  it('reports the year’s end as something needing the player', () => {
    const g = fresh()
    let report = end(g)
    for (let k = 1; k < 12; k++) report = end(g)
    expect(report.news.join(' ')).toMatch(/2026 is over\. Money went from ₹2,000 crore to /)
    expect(report.needs[0]).toMatch(/2026 is over/)
  })

  it('uses plain words: no exclamation marks', () => {
    const g = fresh()
    rules.act(g, city, { kind: 'borrow', amount: 20_000 })
    for (let k = 0; k < 12; k++) {
      const r = end(g)
      for (const text of [...r.news, ...r.needs, ...r.figures.flatMap((f) => f.causes.map((c) => c.text))]) {
        expect(text).not.toMatch(/!/)
      }
    }
  })
})

describe('causes', () => {
  it('put a changed fare back as it was, and give the difference it made', () => {
    const g = fresh()
    end(g)
    const start = spanStart(g)
    rules.act(g, city, { kind: 'fare', mode: 'bus', perKm: 400 })
    const report = end(g)
    const runs: CityState[] = []
    const explained = explain(g, city, (s) => (runs.push(s), simulate(s)), start, report)
    // One run with the bus fare put back, one with the people as they were.
    expect(runs).toHaveLength(2)
    expect(runs[0]!.prices!.busPerKm).toBe(1.6)
    const clean = explained.figures.find((f) => f.key === 'clean')!
    const fare = clean.causes.find((c) => /bus fare rising to ₹4.00 a km/.test(c.text))!
    expect(fare.amount).toBeLessThan(0)
    const without = traffic(simulate(runs[0]!), city)
    expect(fare.amount).toBeCloseTo(clean.now - without.clean, 5)
    expect(fare.text).toMatch(/^−\d+\.\d points from the bus fare rising to ₹4.00 a km$/)
  })

  it('split growth from the part the tax rate played in it', () => {
    const g = fresh()
    end(g)
    const start = spanStart(g)
    rules.act(g, city, { kind: 'tax', rate: 15_000 })
    for (let k = 0; k < 6; k++) end(g)
    const runs: CityState[] = []
    explain(g, city, (s) => (runs.push(s), simulate(s)), start, combine(g.reports.slice(1)))
    expect(runs).toHaveLength(2)
    expect(g.taxPeople).toBeLessThan(0)
  })

  it('are not looked for in the first month, when there is nothing before', () => {
    const g = fresh()
    const report = skip(g, city, simulate, 1)
    // Those the model explains; money, approval and the roads have causes of their own from the first month.
    expect(report.figures.filter((f) => !['money', 'approval', 'roads'].includes(f.key)).every((f) => f.causes.length === 0)).toBe(true)
  })
})

describe('causes on the roads (slice 5)', () => {
  it('says what a new road, footpaths and speed limits did, each as its own cause', () => {
    const g = rules.start({ ...testSeason, money: 400_000 }, city)
    const at = (x: number, y: number) => ({ at: [77.55 + x / 108.48, 12.93 + y / 110.57] as [number, number] })
    rules.act(g, city, { kind: 'build', plan: { kind: 'road', stops: [at(1, 2), at(9, 5)], lanes: 2, flyover: false } })
    const opens = g.projects![0]!.opens
    while (g.month < opens - 1) end(g)
    rules.act(g, city, { kind: 'build', plan: { kind: 'speedLimit', zone: 4, limit: 30 } })
    const start = spanStart(g)
    const report = explain(g, city, simulate, start, combine([end(g), end(g)]))
    const causes = report.figures.flatMap((f) => f.causes.map((c) => c.text)).join(' | ')
    expect(causes).toMatch(/from the new road from .* opening/)
  })
})

describe('a report for a span of months', () => {
  it('runs from the first month’s before to the last month’s now, with the books summed', () => {
    const g = fresh()
    const reports = [end(g), end(g), end(g)]
    const span = combine(reports)
    expect(span.from).toBe(0)
    expect(span.to).toBe(2)
    const money = span.figures.find((f) => f.key === 'money')!
    expect(money.before).toBe(testSeason.money / 100)
    expect(money.now).toBe(g.money / 100)
    expect(balance(span.books)).toBe(g.money - testSeason.money)
    // Combining does not change the months’ own reports.
    expect(balance(reports[0]!.books)).toBe(Math.round((reports[0]!.figures.find((f) => f.key === 'money')!.now - 2000) * 100))
  })
})
