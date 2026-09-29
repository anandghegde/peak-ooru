import { describe, expect, it } from 'vitest'
import { gameDigest } from '../src/rules/digest'
import { rules } from '../src/rules/index'
import type { Game, Season } from '../src/rules/types'
import { firstSeason } from '../src/seasons/first'
import { simulate } from '../src/sim/index'
import { smallCity, testSeason } from './rules-city'

/* The game's fingerprint (slice 8): what the server and the screen compare after each month. */

const city = smallCity()
const season: Season = { ...testSeason, marks: firstSeason.marks }
const month = (g: Game) => rules.endMonth(g, city, simulate(rules.state(g, city)))

function played(n: number) {
  const g = rules.start(season, city)
  for (let i = 0; i < n; i++) month(g)
  return g
}

describe('gameDigest', () => {
  it('is eight hex digits, and the same for a copy sent as JSON', () => {
    const g = played(2)
    const d = gameDigest(g)
    expect(d).toMatch(/^[0-9a-f]{8}$/)
    expect(gameDigest(JSON.parse(JSON.stringify(g)) as Game)).toBe(d)
  })

  it('is the same for the same game played again from its actions', () => {
    const g = played(3)
    const again = rules.replay(season, city, g.done, simulate, 3)
    expect(gameDigest(again)).toBe(gameDigest(g))
  })

  it('changes with the money, the month, the status, the score and any month kept for the score', () => {
    const g = played(2)
    const d = gameDigest(g)
    const copy = () => JSON.parse(JSON.stringify(g)) as Game
    const a = copy(); a.money += 1; expect(gameDigest(a)).not.toBe(d)
    const b = copy(); b.month += 1; expect(gameDigest(b)).not.toBe(d)
    const c = copy(); c.status = 'finished'; expect(gameDigest(c)).not.toBe(d)
    const e = copy(); e.score!.total += 1; expect(gameDigest(e)).not.toBe(d)
    const f = copy(); f.measured![0]!.commute += 1; expect(gameDigest(f)).not.toBe(d)
    const h = copy(); h.measured!.pop(); expect(gameDigest(h)).not.toBe(d)
  })

  it('ignores reports, words and timings', () => {
    const g = played(2)
    const d = gameDigest(g)
    const copy = JSON.parse(JSON.stringify(g)) as Game
    copy.reports = []
    copy.told = ['something']
    copy.pressures = []
    if (copy.last) copy.last.took = 12345
    expect(gameDigest(copy)).toBe(d)
  })

  it('is fixed for a fixed game, on every engine', () => {
    const g = {
      month: 3, status: 'playing', money: -1_234_567_890_123, score: { total: 612, measures: [{ key: 'access', points: 455 }] },
      measured: [{ month: 0, access: 402, commute: 2710, clean: 480, safety: 700, fairness: 610, money: 5000, approval: 550 }],
    } as unknown as Game
    expect(gameDigest(g)).toBe(gameDigest(JSON.parse(JSON.stringify(g)) as Game))
    expect(gameDigest(g)).toMatchInlineSnapshot(`"5924cefb"`)
  })
})
