import { describe, expect, it } from 'vitest'
import { rules } from '../src/rules/index'
import { DIG } from '../src/rules/params'
import type { Game, Upkeep } from '../src/rules/types'
import { dugIn, floodsIn, rainIn, roadsFigure, startWear } from '../src/rules/upkeep'
import { simulate } from '../src/sim/index'
import type { MonthResult } from '../src/sim/types'
import { smallCity, testSeason } from './rules-city'

/*
 * The state of the roads over time (slice 6): how they start, wear, are dug and flood, and what the upkeep budget does.
 * One month of traffic, worked out once, stands for every month, so that years play in milliseconds.
 */

const city = smallCity()
const first = simulate(rules.state(rules.start(testSeason, city), city))

function played(months: number, level: Upkeep = 'steady', dig = false, seed = testSeason.seed, result: MonthResult = first): Game {
  const g = rules.start({ ...testSeason, seed }, city)
  if (level !== 'steady') expect(rules.act(g, city, { kind: 'upkeep', level })).toEqual({ ok: true })
  if (dig) expect(rules.act(g, city, { kind: 'digOnce', on: true })).toEqual({ ok: true })
  for (let m = 0; m < months; m++) {
    g.money = 10_000_000
    rules.endMonth(g, city, { ...result, month: g.month })
  }
  return g
}

const mean = (g: Game) => {
  let m = 0
  let s = 0
  for (const l of city.roads.links) {
    m += l.length
    s += l.length * g.condition![l.id]!
  }
  return s / m
}

describe('the roads at the start (PRD ROAD-8)', () => {
  const g = rules.start(testSeason, city)

  it('gives every link and every zone a condition, in whole points, a little under fair on the whole', () => {
    expect(g.condition).toHaveLength(city.roads.links.length)
    expect(g.streets).toHaveLength(city.zones.length)
    for (const c of [...g.condition!, ...g.streets!]) expect(Number.isInteger(c) && c >= 0 && c <= 100).toBe(true)
    expect(mean(g)).toBeGreaterThan(35)
    // The small city has no outer roads or tech corridors, which are worst; the real city starts at 47.
    expect(mean(g)).toBeLessThan(62)
    expect(new Set(g.condition).size).toBeGreaterThan(10)
    expect(g.upkeep).toBe('steady')
    expect(g.digOnce).toBe(false)
  })

  it('is the same for every player of a season, and another season has another mix', () => {
    expect(startWear(testSeason, city)).toEqual(startWear(testSeason, city))
    expect(rules.start(testSeason, city).condition).toEqual(g.condition)
    expect(rules.start({ ...testSeason, seed: 2 }, city).condition).not.toEqual(g.condition)
  })

  it('keeps the condition in thousandths of a point, whole', () => {
    for (const x of [...g.wear!.base, ...g.wear!.streets]) expect(Number.isInteger(x) && x >= 0 && x <= 100_000).toBe(true)
    g.wear!.base.forEach((b, id) => expect(Math.floor(b / 1000)).toBe(g.condition![id]))
  })
})

describe('wear (PRD ROAD-2, UPK-13)', () => {
  it('takes the roads down about a grade in three years at a bare budget', () => {
    const start = mean(rules.start(testSeason, city))
    const g = played(36, 'bare')
    expect(start - mean(g)).toBeGreaterThan(15)
    expect(start - mean(g)).toBeLessThan(35)
  })

  it('holds them at a steady budget, and slowly improves them at a generous one', () => {
    const start = mean(rules.start(testSeason, city))
    expect(Math.abs(mean(played(36, 'steady')) - start)).toBeLessThan(6)
    expect(mean(played(36, 'generous'))).toBeGreaterThan(start + 3)
  })

  it('wears a busy road faster than a quiet one', () => {
    const quiet: MonthResult = { ...first, flow: { morning: new Int32Array(first.flow.morning.length), midday: new Int32Array(first.flow.midday.length), evening: new Int32Array(first.flow.evening.length), night: new Int32Array(first.flow.night.length) } }
    const extra = first as MonthResult & { vehiclesByLink?: Int32Array; heavyByLink?: Int32Array }
    if (extra.vehiclesByLink) Object.assign(quiet, { vehiclesByLink: new Int32Array(extra.vehiclesByLink.length), heavyByLink: new Int32Array(extra.vehiclesByLink.length) })
    expect(mean(played(12, 'bare', false, 1, quiet))).toBeGreaterThan(mean(played(12, 'bare')) + 1)
  })

  it('wears faster in the monsoon months', () => {
    const g = played(5, 'bare')
    const before = mean(g)
    const dry = [0, 1, 2, 3, 4].length
    const g2 = played(9, 'bare')
    // June to September (months 5 to 8) against January to May, by what each lost a month.
    const monsoon = (before - mean(g2)) / 4
    const start = mean(rules.start(testSeason, city))
    expect(monsoon).toBeGreaterThan((start - before) / dry)
    expect(rainIn(testSeason, 6)).toBeGreaterThan(0)
    expect(rainIn(testSeason, 2)).toBe(0)
  })

  it('never goes below 0 or above 100, and plays the same twice', () => {
    const g = played(120, 'bare')
    for (const c of g.condition!) expect(c >= 0 && c <= 100).toBe(true)
    expect(JSON.stringify(played(24, 'bare'))).toBe(JSON.stringify(played(24, 'bare')))
  })
})

describe('utilities digging (PRD ROAD-2, POL-4)', () => {
  it('dig up some roads most months, which drop to poor', () => {
    const g = rules.start(testSeason, city)
    let dug = 0
    for (let m = 0; m < 24; m++) dug += dugIn(g, city, m).links.length
    expect(dug).toBeGreaterThan(0)
    const played12 = played(12, 'bare')
    const hit = played12.wear!.dug.filter((m) => m >= 0).length
    expect(hit).toBeGreaterThan(0)
  })

  it('with dig once, dig only in the set months, and put the road back as it was', () => {
    const g = rules.start(testSeason, city)
    rules.act(g, city, { kind: 'digOnce', on: true })
    for (let m = 0; m < 24; m++) {
      const d = dugIn(g, city, m)
      if (!DIG.months.includes(m % 12)) expect(d.links).toEqual([])
      expect(d.restored).toBe(true)
    }
    const once = played(24, 'steady', true)
    expect(once.wear!.dug.every((m) => m < 0)).toBe(true)
    expect(mean(once)).toBeGreaterThan(mean(played(24, 'steady')))
  })

  it('with dig once, costs approval with the utilities and some growth', () => {
    const once = played(24, 'steady', true)
    const not = played(24, 'steady')
    expect(once.people).toBeLessThan(not.people)
    expect(once.pressures!.some((p) => /Utilities made to dig/.test(p.text))).toBe(true)
  })

  it('is a major action, refused when it is so already or not a true or false', () => {
    const g = rules.start(testSeason, city)
    expect(rules.may(g, city, { kind: 'digOnce', on: false }).ok).toBe(false)
    expect(rules.may(g, city, { kind: 'digOnce', on: 'yes' as unknown as boolean }).ok).toBe(false)
    rules.act(g, city, { kind: 'digOnce', on: true })
    expect(g.majors).toBe(1)
  })
})

describe('the monsoon (PRD EVT-1)', () => {
  it('comes from June to September only, heavier some years than others, the same for a season', () => {
    for (let m = 0; m < 120; m++) {
      const mm = rainIn(testSeason, m)
      if (m % 12 < 5 || m % 12 > 8) expect(mm).toBe(0)
      else expect(mm).toBeGreaterThanOrEqual(0)
    }
    const years = new Set(Array.from({ length: 10 }, (_, y) => rainIn(testSeason, y * 12 + 7)))
    expect(years.size).toBeGreaterThan(3)
  })

  it('shuts low roads for days in a heavy month, and they go to the model as `shut`', () => {
    // A month with floods in some season of the first twenty.
    let found = false
    for (let seed = 1; seed <= 20 && !found; seed++) {
      for (let m = 5; m < 120 && !found; m++) {
        const f = floodsIn({ ...testSeason, seed }, city, m)
        if (!f.length) continue
        found = true
        const g = rules.start({ ...testSeason, seed }, city)
        while (g.month < m) rules.endMonth(g, city, { ...first, month: g.month })
        const shut = rules.state(g, city).shut!
        expect(Object.keys(shut).map(Number)).toEqual(f.map((x) => x.link))
        for (const v of Object.values(shut)) expect(v > 0 && v <= 1000 && Number.isInteger(v)).toBe(true)
        const report = rules.endMonth(g, city, { ...first, month: g.month })
        expect(report.flooded).toEqual(f)
        expect(report.news.join(' ')).toMatch(/Low-lying roads flooded and were shut for up to \d+ days?/)
      }
    }
    expect(found).toBe(true)
  })
})

describe('the figure', () => {
  it('gives the share of main road in good or fair repair, with its causes', () => {
    const g = rules.start(testSeason, city)
    const report = rules.endMonth(g, city, { ...first, month: 0 })
    const f = report.figures.find((x) => x.key === 'roads')!
    expect(f.name).toBe('Main roads in good or fair repair')
    expect(f.now).toBe(roadsFigure(g, city))
    expect(f.causes.length).toBeGreaterThan(0)
    expect(f.causes[0]!.text).toMatch(/^[−+]\d+\.\d points: /)
  })
})
