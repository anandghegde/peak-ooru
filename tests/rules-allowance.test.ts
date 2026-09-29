import { describe, expect, it } from 'vitest'
import { allowance, indiaDay, mayEnd } from '../src/rules/allowance'

const H = 3_600_000
/** A moment in India time: day d of January 2026 at h hours. India is UTC+5:30. */
const india = (d: number, h: number, min = 0) => Date.UTC(2026, 0, d, h, min) - 5.5 * H
const times = (n: number, at: number) => Array.from({ length: n }, (_, k) => at + k * 60_000)

describe('the daily allowance', () => {
  it('gives twelve months on the first day', () => {
    expect(allowance([], india(5, 10)).left).toBe(12)
    expect(allowance(times(5, india(5, 10)), india(5, 11)).left).toBe(7)
    expect(allowance(times(12, india(5, 10)), india(5, 23)).left).toBe(0)
    expect(mayEnd(times(12, india(5, 10)), india(5, 23))).toBe(false)
  })

  it('turns at midnight in India, which is 18:30 UTC', () => {
    const played = times(12, india(5, 20))
    expect(allowance(played, india(5, 23, 59)).left).toBe(0)
    expect(allowance(played, india(6, 0, 0)).left).toBe(12)
    expect(allowance(played, Date.UTC(2026, 0, 5, 18, 29, 59)).left).toBe(0)
    expect(allowance(played, Date.UTC(2026, 0, 5, 18, 30)).left).toBe(12)
    expect(allowance(played, india(5, 23)).next).toBe(Date.UTC(2026, 0, 5, 18, 30))
  })

  it('counts months ended either side of midnight on their own days', () => {
    // Six before midnight, six after: each day's twelve less six.
    const played = [...times(6, india(5, 23, 50)), ...times(6, india(6, 0, 1))]
    expect(indiaDay(played[5]!)).toBe(indiaDay(played[6]!) - 1)
    expect(allowance(played, india(6, 1)).left).toBe(12 + 6 - 6)
  })

  it('carries unused months over, to at most thirty-six', () => {
    const played = times(12, india(5, 10))
    expect(allowance(played, india(6, 10)).left).toBe(12)
    expect(allowance(played, india(7, 10)).left).toBe(24)
    expect(allowance(played, india(8, 10)).left).toBe(36)
    // A gap of a week holds at thirty-six.
    expect(allowance(played, india(12, 10)).left).toBe(36)
    expect(allowance([...played, ...times(30, india(12, 10))], india(12, 11)).left).toBe(6)
    expect(allowance([...played, ...times(36, india(12, 10))], india(13, 9)).left).toBe(12)
  })

  it('carries over what was left on the first day', () => {
    expect(allowance(times(2, india(5, 10)), india(6, 10)).left).toBe(22)
  })

  it('ignores times that are not finite or not yet come, and takes them in any order', () => {
    const played = times(4, india(5, 10))
    expect(allowance([Number.NaN, ...played, india(9, 0)], india(5, 12)).left).toBe(8)
    expect(allowance([...played].reverse(), india(5, 12)).left).toBe(8)
  })
})
