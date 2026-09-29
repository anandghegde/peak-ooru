import { describe, expect, it } from 'vitest'
import { allowance } from '../src/rules/allowance'
import { approvalWord } from '../src/rules/approval'
import { rules } from '../src/rules/index'
import { APPROVAL } from '../src/rules/params'
import type { Game } from '../src/rules/types'
import { firstSeason } from '../src/seasons/first'
import { simulate } from '../src/sim/index'
import { smallCity, testSeason } from './rules-city'

const city = smallCity()
const fresh = () => rules.start(testSeason, city)
const end = (g: Game) => rules.endMonth(g, city, simulate(rules.state(g, city)))

/** Everything as dear as the rules allow. */
function squeeze(g: Game) {
  rules.act(g, city, { kind: 'tax', rate: 15_000 })
  rules.act(g, city, { kind: 'fare', mode: 'metro', perKm: 900 })
  rules.act(g, city, { kind: 'fare', mode: 'bus', perKm: 400 })
  rules.act(g, city, { kind: 'fare', mode: 'rail', perKm: 200 })
}

describe('approval', () => {
  it('starts at 55, in tenths', () => {
    expect(fresh().approval).toBe(550)
  })

  it('falls under a high tax, and says why', () => {
    const g = fresh()
    rules.act(g, city, { kind: 'tax', rate: 12_500 })
    for (let m = 0; m < 12; m++) end(g)
    expect(g.approval!).toBeLessThan(450)
    expect(g.pressures!.some((p) => /Property tax at 125%/.test(p.text) && p.points === -2)).toBe(true)
    const figure = g.reports.at(-1)!.figures.find((f) => f.key === 'approval')!
    expect(figure.now).toBe(g.approval! / 10)
    expect(figure.causes.some((c) => /property tax at 125%/.test(c.text))).toBe(true)
  })

  it('rises with a cut, and drifts back towards 55 when nothing pushes it', () => {
    const g = fresh()
    rules.act(g, city, { kind: 'tax', rate: 9_000 })
    end(g)
    expect(g.approval!).toBeGreaterThan(550)
    const h = fresh()
    h.approval = 800
    end(h)
    expect(h.approval!).toBeLessThan(800)
    expect(h.pressures!.some((p) => /Settling back towards 55/.test(p.text))).toBe(true)
  })

  it('rises when something opens, and falls with roads losing lanes to works', () => {
    const g = fresh()
    const at = (x: number, y: number) => ({ at: [77.55 + x / 108.48, 12.93 + y / 110.57] as [number, number] })
    rules.act(g, city, { kind: 'build', plan: { kind: 'busRoute', stops: [at(1, 4), at(8, 4)], buses: 6 } })
    rules.act(g, city, { kind: 'build', plan: { kind: 'metro', stops: [at(0, 8), at(10, 8)] } })
    end(g)
    const texts = g.pressures!.map((p) => `${p.text} ${p.points}`)
    expect(texts.join('; ')).toMatch(/Bus route 1 starting 0.5/)
    expect(texts.join('; ')).toMatch(/km of main road losing a lane to works -/)
  })

  it('is reviewed each December: under 30 a warning, two running and the player is replaced', () => {
    const g = fresh()
    squeeze(g)
    for (let m = 0; m < 12; m++) end(g)
    expect(g.approval!).toBeLessThan(APPROVAL.warning)
    expect(g.warnings).toBe(1)
    expect(g.status).toBe('playing')
    expect(g.reports.at(-1)!.news.join(' ')).toMatch(/The yearly review: approval stands at [\d.]+, very low\. That is under 30: a warning/)
    for (let m = 0; m < 12; m++) end(g)
    expect(g.status).toBe('replaced')
    expect(g.month).toBe(24)
    expect(g.reports.at(-1)!.news.join(' ')).toMatch(/The state has replaced you as commissioner/)
    expect(rules.act(g, city, { kind: 'tax', rate: 10_000 })).toEqual({ ok: false, reason: 'The game is over.' })
  })

  it('has a word for each level', () => {
    expect([750, 600, 450, 320, 100].map(approvalWord)).toEqual(['high', 'good', 'fair', 'low', 'very low'])
  })
})

describe('the daily allowance', () => {
  it('is off in the first season while the game is built, and then sets no limit', () => {
    expect(firstSeason.allowance).toBe(false)
    const a = allowance([1, 2, 3], 10_000, false)
    expect(a.on).toBe(false)
    expect(a.left).toBe(Number.POSITIVE_INFINITY)
    expect(allowance([], 10_000).on).toBe(true)
  })
})

describe('approval and the roads (slice 5)', () => {
  it('falls once for land taken by a road on the ground and for a road made one-way; rises when a road opens', async () => {
    const { rules } = await import('../src/rules/index')
    const { simulate } = await import('../src/sim/index')
    const { smallCity, testSeason } = await import('./rules-city')
    const city = smallCity()
    const g = rules.start({ ...testSeason, money: 400_000 }, city)
    const at = (x: number, y: number) => ({ at: [77.55 + x / 108.48, 12.93 + y / 110.57] as [number, number] })
    expect(rules.act(g, city, { kind: 'build', plan: { kind: 'road', stops: [at(1, 2), at(9, 5)], lanes: 2, flyover: false } })).toEqual({ ok: true })
    const link = city.roads.links.find((l) => l.from === 4 * 12 + 4 && l.to === 4 * 12 + 5)!.id
    expect(rules.act(g, city, { kind: 'build', plan: { kind: 'oneWay', link, on: true } })).toEqual({ ok: true })
    rules.endMonth(g, city, simulate(rules.state(g, city)))
    const texts = g.pressures!.map((p) => `${p.text} ${p.points}`)
    expect(texts.some((t) => /^People losing land to the new road from .* -\d/.test(t))).toBe(true)
    expect(texts.some((t) => /^A road made one-way -0\.\d$/.test(t))).toBe(true)
    const p = g.projects![0]!
    while (g.month < p.opens) rules.endMonth(g, city, simulate(rules.state(g, city)))
    expect(g.pressures!.some((x) => /^The new road from .* opening$/.test(x.text) && x.points === 2)).toBe(true)
  })
})
