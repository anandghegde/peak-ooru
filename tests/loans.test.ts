import { describe, expect, it } from 'vitest'
import { rules } from '../src/rules/index'
import { loanLimit, loanPayment, loanRate } from '../src/rules/money'
import type { Game } from '../src/rules/types'
import { simulate } from '../src/sim/index'
import { smallCity, testSeason } from './rules-city'

const city = smallCity()
const fresh = () => rules.start(testSeason, city)
const r0 = simulate(rules.state(fresh(), city))
/** Ends a month on the first month's traffic, which is all the loans need. */
const end = (g: Game) => rules.endMonth(g, city, { ...r0, month: g.month })

describe('borrowing', () => {
  it('adds the money now and a loan repaid monthly from the next month', () => {
    const g = fresh()
    expect(rules.act(g, city, { kind: 'borrow', amount: 50_000 }).ok).toBe(true)
    expect(g.money).toBe(testSeason.money + 50_000)
    const loan = g.loans[0]!
    expect(loan).toMatchObject({ id: 1, amount: 50_000, owed: 50_000, monthsLeft: 60, taken: 0 })
    const first = end(g)
    expect(first.books.find((e) => e.key === 'loans')).toBeUndefined()
    expect(first.news.join(' ')).toMatch(/You borrowed ₹500 crore at 8.* a year/)
    const second = end(g)
    expect(second.books.find((e) => e.key === 'loans')!.amount).toBe(-loan.payment)
    expect(g.loans[0]!.monthsLeft).toBe(59)
  })

  it('is repaid to nothing in exactly 60 payments, costing more than was borrowed', () => {
    const g = fresh()
    rules.act(g, city, { kind: 'borrow', amount: 100_000 })
    let paid = 0
    let payments = 0
    for (let k = 0; k < 70; k++) {
      const due = end(g).books.find((e) => e.key === 'loans')
      if (due) {
        paid -= due.amount
        payments++
      }
    }
    expect(payments).toBe(60)
    expect(g.loans).toHaveLength(0)
    expect(paid).toBeGreaterThan(100_000)
    expect(g.reports.some((r) => r.news.some((n) => /is paid off/.test(n)))).toBe(true)
  })

  it('costs more the more is owed', () => {
    const g = fresh()
    const limit = loanLimit(g)
    expect(loanRate(0, limit)).toBe(800)
    expect(loanRate(limit, limit)).toBe(1200)
    rules.act(g, city, { kind: 'borrow', amount: 10_000 })
    rules.act(g, city, { kind: 'borrow', amount: 200_000 })
    rules.act(g, city, { kind: 'borrow', amount: 10_000 })
    const [a, b, c] = g.loans
    expect(b!.rate).toBeGreaterThan(a!.rate)
    expect(c!.rate).toBeGreaterThanOrEqual(b!.rate)
  })

  it('is refused past the limit, in odd amounts, or when not whole and above nothing', () => {
    const g = fresh()
    const limit = loanLimit(g)
    const most = limit - (limit % 10_000)
    const over = rules.act(g, city, { kind: 'borrow', amount: most + 10_000 })
    expect(over.ok).toBe(false)
    expect(over.ok ? '' : over.reason).toMatch(/may owe at most/)
    for (const amount of [0, -10_000, 15_000, 10_000.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(rules.act(g, city, { kind: 'borrow', amount }).ok).toBe(false)
    }
    expect(rules.act(g, city, { kind: 'borrow', amount: most }).ok).toBe(true)
    expect(rules.act(g, city, { kind: 'borrow', amount: 10_000 }).ok).toBe(false)
    expect(g.loans).toHaveLength(1)
  })

  it('works out a payment that repays the loan with its interest', () => {
    // ₹100 crore at 12% over 5 years is ₹2.22 crore a month.
    expect(loanPayment(10_000, 1200, 60)).toBe(223)
  })
})

describe('repaying early', () => {
  it('takes what is owed, and ends the payments', () => {
    const g = fresh()
    rules.act(g, city, { kind: 'borrow', amount: 50_000 })
    end(g)
    end(g)
    const owed = g.loans[0]!.owed
    const money = g.money
    expect(rules.act(g, city, { kind: 'repay', loan: 1 }).ok).toBe(true)
    expect(g.money).toBe(money - owed)
    expect(rules.act(g, city, { kind: 'repay', loan: 1 }).ok).toBe(false)
    const report = end(g)
    expect(report.books.find((e) => e.key === 'loans')).toBeUndefined()
    expect(report.news.join(' ')).toMatch(/repaid early/)
    expect(g.loans).toHaveLength(0)
  })

  it('is refused for a loan that does not exist, or without the money', () => {
    const g = fresh()
    expect(rules.act(g, city, { kind: 'repay', loan: 1 }).ok).toBe(false)
    rules.act(g, city, { kind: 'borrow', amount: 50_000 })
    g.money = 100
    const outcome = rules.act(g, city, { kind: 'repay', loan: 1 })
    expect(outcome.ok ? '' : outcome.reason).toMatch(/takes ₹500 crore/)
    expect(rules.act(g, city, { kind: 'repay', loan: 1.5 }).ok).toBe(false)
  })
})

describe('running out of money', () => {
  it('ends the game after three months running below nothing, and not before', () => {
    const g = fresh()
    g.money = -1_000_000
    end(g)
    expect(g.inTheRed).toBe(1)
    end(g)
    expect(g.status).toBe('playing')
    const last = end(g)
    expect(g.status).toBe('default')
    expect(last.news.join(' ')).toMatch(/state has taken over/)
    expect(() => end(g)).toThrow()
  })

  it('counts the months afresh once money is above nothing again', () => {
    const g = fresh()
    g.money = -10
    end(g)
    expect(g.inTheRed).toBe(0)
  })
})
