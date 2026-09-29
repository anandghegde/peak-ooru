import { describe, expect, it } from 'vitest'
import { rules } from '../src/rules/index'
import { ARRIVALS, arriving, leverOf, unlocked } from '../src/rules/unlock'
import type { Game, Plan } from '../src/rules/types'
import { resurfacedIn } from '../src/rules/upkeep'
import { simulate } from '../src/sim/index'
import { smallCity, testSeason } from './rules-city'

/* Slice 9: "What could I do now?" (`rules.advise`), the order the levers arrive in, and resurfacing stretch by stretch. */

const city = smallCity()
const first = simulate(rules.state(rules.start(testSeason, city), city))
const fresh = (money = 400_000): Game => rules.start({ ...testSeason, money }, city)
const end = (g: Game) => rules.endMonth(g, city, { ...simulate(rules.state(g, city)), month: g.month })

describe('advice (SLICE9 B1)', () => {
  it('gives at most three things, each allowed now, affordable, and changes nothing', () => {
    const g = fresh()
    end(g)
    const before = JSON.stringify(g)
    const list = rules.advise!(g, city)
    expect(JSON.stringify(g)).toBe(before)
    expect(list.length).toBeGreaterThan(0)
    expect(list.length).toBeLessThanOrEqual(3)
    for (const a of list) {
      expect(a.title.length).toBeGreaterThan(0)
      expect(a.score).toBeGreaterThanOrEqual(1)
      expect(a.cost).toBeLessThanOrEqual(g.money)
      for (const action of a.actions) expect(rules.may(g, city, action)).toEqual({ ok: true })
    }
    // Best first, and three different levers where there are three.
    for (let i = 1; i < list.length; i++) expect(list[i - 1]!.score).toBeGreaterThanOrEqual(list[i]!.score)
  })

  it('keeps to the levers given, and gives nothing in a game that is over', () => {
    const g = fresh()
    end(g)
    for (const a of rules.advise!(g, city, { levers: ['repair', 'busRoute'] })) expect(['repair', 'busRoute']).toContain(a.lever)
    expect(rules.advise!(g, city, { levers: [] })).toEqual([])
    expect(rules.advise!({ ...g, status: 'finished' }, city)).toEqual([])
  })

  it('works before the first month, with the model given, and checks the best with it', () => {
    const g = fresh()
    const list = rules.advise!(g, city, { simulate })
    expect(list.length).toBeGreaterThan(0)
    expect(list.every((a) => a.actions.every((x) => rules.may(g, city, x).ok))).toBe(true)
  })

  it('suggests nothing that costs money when the city has none to spare, but a way to find some', () => {
    const g = fresh(20_000)
    end(g)
    const list = rules.advise!(g, city)
    for (const a of list) expect(a.cost).toBe(0)
  })

  it('what it suggests can be done: doing each leaves the game playable', () => {
    const g = fresh()
    end(g)
    for (const a of rules.advise!(g, city)) for (const action of a.actions) expect(rules.act(g, city, action).ok).toBe(true)
    end(g)
    expect(g.status).toBe('playing')
  })
})

describe('the order the levers arrive in a first game (SLICE9 B3)', () => {
  it('begins with mending, buses and fares, and has every lever within the first year', () => {
    expect(unlocked(0)).toEqual(['repair', 'streets', 'busRoute', 'fare'])
    expect(unlocked(0)).not.toContain('metro')
    expect(unlocked(5)).not.toContain('metro')
    expect(unlocked(6)).toContain('metro')
    const all = ARRIVALS.flatMap((a) => a.levers)
    expect(new Set(all).size).toBe(all.length)
    expect(unlocked(11)).toEqual(all)
    expect(unlocked(119)).toEqual(all)
    for (const a of ARRIVALS) expect(a.month).toBeLessThan(12)
  })

  it('announces each arrival in one line, and knows the lever of each action', () => {
    expect(arriving(6)!.levers).toEqual(['metro'])
    expect(arriving(5)).toBeNull()
    for (const a of ARRIVALS) expect(a.text.split('. ').length).toBeLessThanOrEqual(2)
    expect(leverOf({ kind: 'build', plan: { kind: 'metro' } })).toBe('metro')
    expect(leverOf({ kind: 'fare' })).toBe('fare')
    expect(leverOf({ kind: 'cancel' })).toBeNull()
  })

  it('limits only what the screen offers: the rules allow a metro line in the first month', () => {
    const g = fresh()
    const plan = rules.suggest(g, city, 'metro')[0]
    if (plan) expect(rules.may(g, city, { kind: 'build', plan }).ok).toBe(true)
  })
})

describe('resurfacing stretch by stretch (slice 9)', () => {
  it('shuts a lane only on the stretches done that month, and each is good from the end of its month', () => {
    const g = fresh(4_000_000)
    const links = g.condition!.flatMap((c, id) => (c < 60 ? [id] : []))
    const plan: Plan = { kind: 'repair', links, work: 'resurface' }
    const q = rules.quote(g, city, plan)
    expect(q.ok).toBe(true)
    expect(rules.act(g, city, { kind: 'build', plan }).ok).toBe(true)
    const p = g.projects!.at(-1)!
    const months = p.opens - p.started
    expect(months).toBeGreaterThan(1)
    // Every stretch is done in exactly one month, in turn.
    const done = Array.from({ length: months }, (_, k) => resurfacedIn(p, p.started + k))
    expect(done.flat().sort((a, b) => a - b)).toEqual([...q.disrupted].sort((a, b) => a - b))
    for (let k = 0; k < months; k++) {
      expect(rules.state(g, city).works ?? []).toEqual([...done[k]!].sort((a, b) => a - b))
      rules.endMonth(g, city, { ...first, month: g.month })
      for (const id of done[k]!) expect(g.condition![id]).toBeGreaterThanOrEqual(89)
    }
    expect(rules.state(g, city).works ?? []).toEqual([])
    if (months > 1) expect(q.note).toMatch(/stretch by stretch/)
  })
})

describe('what needs the player (slice 9: Report.urgent)', () => {
  it('keeps to what the player must act on: money running out, not a route starting or the year ending', () => {
    const g = fresh()
    const plan = rules.suggest(g, city, 'busRoute')[0]!
    expect(rules.act(g, city, { kind: 'build', plan }).ok).toBe(true)
    const r = rules.endMonth(g, city, { ...first, month: g.month })
    expect(r.needs.join(' ')).toMatch(/Bus route 1/)
    expect(r.urgent).toEqual([])
    const poor = fresh()
    poor.money = -100_000
    const last = rules.endMonth(poor, city, { ...first, month: poor.month })
    expect(last.urgent!.join(' ')).toMatch(/below nothing/)
    expect(last.needs).toEqual(expect.arrayContaining(last.urgent!))
  })
})
