import { describe, expect, it } from 'vitest'
import type { Game, Measured } from '../src/rules/types'
import { firstSeason } from '../src/seasons/first'
import { shareLine } from '../src/share/line'

const opening = firstSeason.opening!

/** A finished game whose last year's figures are the city's opening ones changed by `change`. */
function ended(change: Partial<Omit<Measured, 'month'>>, status: Game['status'] = 'finished', months = 120): Game {
  const measured = Array.from({ length: months }, (_, m) => ({ ...opening, month: m, ...(m >= months - 36 ? change : {}) }))
  return { season: firstSeason, status, month: months, measured } as unknown as Game
}

describe('the one line a finished game is shared with', () => {
  it('says the commute cut in whole minutes, rounded down', () => {
    expect(shareLine(ended({ commute: opening.commute - 14 * 60 - 59 })).text).toBe('I cut Bengaluru’s commute by 14 minutes.')
    expect(shareLine(ended({ commute: opening.commute - 61 })).text).toBe('I cut Bengaluru’s commute by a minute.')
  })

  it('does not boast of a change too small to say', () => {
    const line = shareLine(ended({ commute: opening.commute - 50, access: opening.access + 5, clean: opening.clean + 15 }))
    expect(line).toEqual({ text: 'Bengaluru survived me. Just.', about: 'none' })
  })

  it('never claims a measure that got worse', () => {
    const line = shareLine(ended({ commute: opening.commute + 600, safety: opening.safety * 2, money: opening.money - 100_000 }))
    expect(line.about).toBe('none')
  })

  it('gives a player who left the city scoring below where it began nothing to boast of', () => {
    // As a city left alone goes: deaths fall a little of themselves while the rest gets worse.
    const idle = ended({ safety: 709, commute: 3774, access: 106, clean: 504, fairness: 382, approval: 504 })
    expect(shareLine(idle).text).toBe('Bengaluru survived me. Just.')
  })

  it('says road deaths fell by a third only when they fell by at least a third', () => {
    expect(shareLine(ended({ safety: Math.floor(opening.safety * 0.66) })).text).toBe('Road deaths fell by a third on my watch.')
    expect(shareLine(ended({ safety: Math.ceil(opening.safety * 0.7) })).text).toBe('Road deaths fell by a quarter on my watch.')
    expect(shareLine(ended({ safety: Math.floor(opening.safety * 0.85) })).text).toBe('Road deaths fell by 15% on my watch.')
  })

  it('says jobs in reach as a share more, or doubled', () => {
    expect(shareLine(ended({ access: Math.round(opening.access * 1.46) })).text).toMatch(/^I put 4[56]% more jobs within 45 minutes/)
    expect(shareLine(ended({ access: opening.access * 2 })).text).toBe('I doubled the jobs within 45 minutes of the average Bengalurean.')
  })

  it('says clean travel as trips in every hundred', () => {
    expect(shareLine(ended({ clean: opening.clean + 69 })).text).toBe('I moved six in every 100 trips onto buses, trains, cycles and feet.')
  })

  it('chooses the change worth most in the score, and money only when nothing better moved', () => {
    const both = ended({ commute: opening.commute - 10 * 60, money: opening.money + 200_000 })
    expect(shareLine(both).about).toBe('commute')
    // Money the marks reward: under their full mark.
    const season = { ...firstSeason, marks: { ...firstSeason.marks!, money: { none: -400_000, full: 600_000 } } }
    const rich = { ...ended({ money: opening.money + 123_456 }), season }
    expect(shareLine(rich).text).toBe('I left Bengaluru ₹1,200 crore better off than I found it.')
    // Money beyond what the season's marks reward scores nothing more, and is no boast.
    const hoard = { ...ended({ money: opening.money + 300_000 }), season: { ...season, marks: { ...season.marks, money: { none: -400_000, full: 100_000 } } } }
    expect(shareLine(hoard).about).toBe('none')
  })

  it('says how a game ended early, whatever else moved', () => {
    expect(shareLine(ended({ commute: opening.commute - 900 }, 'default', 70)).text).toBe('I ran Bengaluru out of money. The state had to step in.')
    expect(shareLine(ended({}, 'replaced', 60)).text).toBe('Bengaluru replaced me in 2030. Fair enough.')
  })

  it('has a line for a game with no figures', () => {
    expect(shareLine({ season: firstSeason, status: 'finished', month: 0 } as unknown as Game).text).toBe('Bengaluru survived me. Just.')
  })
})
