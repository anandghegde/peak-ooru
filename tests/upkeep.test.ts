import { describe, expect, it } from 'vitest'
import { rules } from '../src/rules/index'
import { REPAIR } from '../src/rules/params'
import type { Action, Game, Plan, Stop } from '../src/rules/types'
import { namedRoad } from '../src/rules/upkeep'
import { simulate } from '../src/sim/index'
import { smallCity, testSeason } from './rules-city'

/* Mending the roads (slice 6): patching, resurfacing, concrete, a zone's streets, the budget, dig once, standing orders. */

const city = smallCity()
const first = simulate(rules.state(rules.start(testSeason, city), city))
const at = (x: number, y: number): Stop => ({ at: [77.55 + x / 108.48, 12.93 + y / 110.57] })

const fresh = (money = 400_000): Game => rules.start({ ...testSeason, money }, city)
const end = (g: Game) => rules.endMonth(g, city, { ...first, month: g.month })
/** Links in poor or broken repair, lowest ids first. */
const poor = (g: Game, n: number) => g.condition!.flatMap((c, id) => (c < 50 ? [id] : [])).slice(0, n)
function refused(g: Game, a: Action): string {
  const before = JSON.stringify(g)
  const outcome = rules.act(g, city, a)
  expect(outcome.ok).toBe(false)
  expect(JSON.stringify(g)).toBe(before)
  return outcome.ok ? '' : outcome.reason
}

describe('patching potholes (PRD UPK-1, UPK-11)', () => {
  it('is quoted cheap and at once, raises a road to fair, and says how long it lasts', () => {
    const g = fresh()
    const links = poor(g, 6)
    const q = rules.quote(g, city, { kind: 'repair', links, work: 'patch' })
    expect(q).toMatchObject({ ok: true, months: 0, major: false, condition: 62, lasts: 12, disrupted: [] })
    expect(q.cost).toBeGreaterThan(0)
    expect(q.cost).toBeLessThan(100)
    expect(q.note).toMatch(/raising (it|them) to fair\. It wears off over 12 months\./)
    const money = g.money
    expect(rules.act(g, city, { kind: 'build', plan: { kind: 'repair', links, work: 'patch' } })).toEqual({ ok: true })
    expect(g.money).toBe(money - q.cost)
    for (const id of links) expect(g.condition![id]).toBe(62)
    // It is in this month's traffic.
    for (const id of links) expect(rules.state(g, city).surface![id]).toBe(62)
    // And wears off over the year, back to what the road beneath has become.
    for (let k = 0; k < 12; k++) end(g)
    for (const id of links) {
      expect(g.wear!.patch[id]).toBe(0)
      expect(g.condition![id]).toBeLessThan(62)
    }
  })

  it('lasts half as long from May to September, and the quote says so', () => {
    const g = fresh()
    while (g.month < 5) end(g)
    const links = poor(g, 3)
    const q = rules.quote(g, city, { kind: 'repair', links, work: 'patch' })
    expect(q.lasts).toBe(6)
    expect(q.note).toMatch(/Patching in the rains, or just before, lasts half as long\./)
    rules.act(g, city, { kind: 'build', plan: { kind: 'repair', links, work: 'patch' } })
    expect(g.told!.join(' ')).toMatch(/half as long as in the dry months/)
    expect(g.wear!.left[links[0]!]).toBe(6)
  })

  it('refuses roads already fair, and leaves out those of a list that need nothing', () => {
    const g = fresh()
    const good = g.condition!.flatMap((c, id) => (c >= 62 ? [id] : [])).slice(0, 3)
    expect(refused(g, { kind: 'build', plan: { kind: 'repair', links: good, work: 'patch' } })).toMatch(/fair or better already/)
    const q = rules.quote(g, city, { kind: 'repair', links: [...good, ...poor(g, 2)], work: 'patch' })
    expect(q.ok).toBe(true)
    expect(q.note).toMatch(/3 of the stretches chosen need nothing/)
  })
})

describe('resurfacing and concrete (PRD UPK-2, UPK-3, UPK-10)', () => {
  it('resurfaces in a month or three with a lane shut, then the road is good', () => {
    const g = fresh()
    const links = poor(g, 8)
    const plan: Plan = { kind: 'repair', links, work: 'resurface' }
    const q = rules.quote(g, city, plan)
    expect(q).toMatchObject({ ok: true, major: false, condition: 90 })
    expect(q.months).toBeGreaterThanOrEqual(1)
    expect(q.months).toBeLessThanOrEqual(3)
    expect(q.disrupted).toEqual([...links].sort((a, b) => a - b))
    expect(q.note).toMatch(/should stay fair or better for/)
    rules.act(g, city, { kind: 'build', plan })
    expect(rules.state(g, city).works).toEqual(expect.arrayContaining(links))
    expect(refused(g, { kind: 'build', plan: { kind: 'repair', links: [links[0]!], work: 'patch' } })).toMatch(/being mended already/)
    while (g.projects!.length) end(g)
    for (const id of links) expect(g.condition![id]).toBeGreaterThanOrEqual(89)
    expect(rules.state(g, city).works ?? []).toEqual([])
    expect(g.reports.flatMap((r) => r.news).join(' ')).toMatch(/Resurfacing .* is done: the road is good again/)
  })

  it('lays concrete as a major work, shutting half the road for 6 to 12 months; it is then new and wears a quarter as fast', () => {
    const g = fresh()
    const links = poor(g, 6)
    const plan: Plan = { kind: 'repair', links, work: 'concrete' }
    const q = rules.quote(g, city, plan)
    expect(q).toMatchObject({ ok: true, major: true, condition: 100 })
    expect(q.months).toBeGreaterThanOrEqual(6)
    expect(q.months).toBeLessThanOrEqual(12)
    expect(q.cost).toBeGreaterThan(rules.quote(g, city, { kind: 'repair', links, work: 'resurface' }).cost * 3)
    // Half the lanes of each link, rounded up.
    for (const id of links) expect(q.disrupted.filter((x) => x === id)).toHaveLength(Math.ceil(city.roads.links[id]!.lanes / 2))
    rules.act(g, city, { kind: 'build', plan })
    expect(g.majors).toBe(1)
    while (g.projects!.length) end(g)
    expect(g.concrete).toEqual([...links].sort((a, b) => a - b))
    for (const id of links) expect(g.condition![id]).toBeGreaterThanOrEqual(99)
    expect(refused(g, { kind: 'build', plan })).toMatch(/concrete already/)
    expect(refused(g, { kind: 'build', plan: { kind: 'repair', links, work: 'resurface' } })).toMatch(/concrete/)
    // A year on, concrete has worn far less than a resurfaced road would.
    const worn = links.map((id) => 100_000 - g.wear!.base[id]!)
    const h = fresh()
    rules.act(h, city, { kind: 'build', plan: { kind: 'repair', links, work: 'resurface' } })
    while (h.projects!.length) end(h)
    const from = links.map((id) => h.wear!.base[id]!)
    for (let k = 0; k < 12; k++) {
      end(g)
      end(h)
    }
    const concreteWear = links.reduce((s, id, k) => s + (100_000 - g.wear!.base[id]!) - worn[k]!, 0)
    const asphaltWear = links.reduce((s, id, k) => s + from[k]! - h.wear!.base[id]!, 0)
    expect(concreteWear).toBeLessThan(asphaltWear / 2)
  })

  it('refuses plans that are not proper', () => {
    const g = fresh()
    const bad: unknown[] = [
      { kind: 'repair', links: [], work: 'patch' },
      { kind: 'repair', links: [1, 1], work: 'patch' },
      { kind: 'repair', links: [1.5], work: 'patch' },
      { kind: 'repair', links: [999_999], work: 'patch' },
      { kind: 'repair', links: [1], work: 'paint' },
      { kind: 'repair', links: Array.from({ length: REPAIR.links + 1 }, (_, i) => i), work: 'patch' },
      { kind: 'streets', zone: 1.5, work: 'patch' },
      { kind: 'streets', zone: 99_999, work: 'patch' },
      { kind: 'streets', zone: 1, work: 'concrete' },
    ]
    for (const plan of bad) refused(g, { kind: 'build', plan: plan as Plan })
  })
})

describe("a zone's streets", () => {
  it('are patched at once, or resurfaced in a month, and the model is told', () => {
    const g = fresh()
    const zone = g.streets!.findIndex((c, z) => c < 55 && city.zones[z]!.people > 0)
    expect(zone).toBeGreaterThanOrEqual(0)
    const q = rules.quote(g, city, { kind: 'streets', zone, work: 'patch' })
    expect(q).toMatchObject({ ok: true, months: 0, condition: 62 })
    rules.act(g, city, { kind: 'build', plan: { kind: 'streets', zone, work: 'patch' } })
    expect(g.streets![zone]).toBe(62)
    expect(rules.state(g, city).streets![zone]).toBe(62)
    const r = rules.quote(g, city, { kind: 'streets', zone, work: 'resurface' })
    expect(r).toMatchObject({ ok: true, months: 1, condition: 90 })
    rules.act(g, city, { kind: 'build', plan: { kind: 'streets', zone, work: 'resurface' } })
    end(g)
    expect(g.streets![zone]).toBeGreaterThanOrEqual(89)
  })
})

describe('the upkeep budget (PRD UPK-4, UPK-13)', () => {
  it('costs more the more it does, and shows in the books', () => {
    const cost = (level: 'bare' | 'steady' | 'generous') => {
      const g = fresh()
      if (level !== 'steady') rules.act(g, city, { kind: 'upkeep', level })
      return -rules.books(g, city).find((e) => e.key === 'upkeep')!.amount
    }
    expect(cost('bare')).toBeLessThan(cost('steady'))
    expect(cost('steady')).toBeLessThan(cost('generous'))
  })

  it('is refused when unchanged or not a level, and says what it costs when set', () => {
    const g = fresh()
    expect(refused(g, { kind: 'upkeep', level: 'steady' })).toMatch(/already steady/)
    refused(g, { kind: 'upkeep', level: 'lavish' as 'bare' })
    refused(g, { kind: 'upkeep', level: 'steady', patchBelow: 90 })
    refused(g, { kind: 'upkeep', level: 'steady', patchBelow: 40.5 })
    expect(rules.act(g, city, { kind: 'upkeep', level: 'generous' })).toEqual({ ok: true })
    expect(g.told!.join(' ')).toMatch(/You set the upkeep budget to generous: ₹[\d.]+ crore a month, from ₹[\d.]+ crore at steady\./)
  })
})

describe('the standing order to patch (PRD TIME-10)', () => {
  it('patches the potholes of any zone whose roads fall below the mark, and charges for it', () => {
    const g = fresh()
    expect(rules.act(g, city, { kind: 'upkeep', level: 'bare', patchBelow: 60 })).toEqual({ ok: true })
    expect(g.patchBelow).toBe(60)
    const report = end(g)
    const entry = report.books.find((e) => e.key === 'order')
    expect(entry && entry.amount).toBeLessThan(0)
    expect(report.news.join(' ')).toMatch(/Your standing order patched potholes in \d+ zones?/)
    expect(rules.act(g, city, { kind: 'upkeep', level: 'bare', patchBelow: null })).toEqual({ ok: true })
    expect(g.patchBelow).toBeUndefined()
  })
})

describe('making good after works (PRD UPK-12)', () => {
  const metro = (makeGood: boolean): Plan => ({ kind: 'metro', stops: [at(1, 8), at(6, 8), at(10, 8)], ...(makeGood ? { makeGood } : {}) })

  it('costs more when ordered, and hands the roads back good rather than poor', () => {
    const g = fresh(1_000_000)
    const plain = rules.quote(g, city, metro(false))
    const good = rules.quote(g, city, metro(true))
    expect(good.makeGood).toBeGreaterThan(0)
    expect(good.cost).toBe(plain.cost + good.makeGood!)
    const h = fresh(1_000_000)
    rules.act(g, city, { kind: 'build', plan: metro(false) })
    rules.act(h, city, { kind: 'build', plan: metro(true) })
    const p = g.projects![0]!
    const end1 = p.started + Math.floor((p.opens - p.started) / 2)
    while (g.month < end1) {
      end(g)
      end(h)
    }
    const dug = [...new Set(p.quote.disrupted)]
    for (const id of dug) {
      expect(g.condition![id]).toBeLessThan(50)
      expect(h.condition![id]).toBeGreaterThanOrEqual(80)
    }
    expect(g.reports.flatMap((r) => r.news).join(' ')).toMatch(/handed back in poor repair/)
    expect(h.reports.flatMap((r) => r.news).join(' ')).toMatch(/handed back resurfaced, as ordered/)
  })

  it('refuses a make-good that is not a true or false', () => {
    refused(fresh(), { kind: 'build', plan: { ...metro(false), makeGood: 'yes' } as unknown as Plan })
  })
})

describe('the worst roads (PRD ROAD-6)', () => {
  it('names at most five roads in poor repair, by the time their surface costs, worst first', () => {
    const g = fresh()
    const report = end(g)
    const worst = report.worstRoads!
    expect(worst.length).toBeGreaterThan(0)
    expect(worst.length).toBeLessThanOrEqual(5)
    for (let k = 1; k < worst.length; k++) expect(worst[k - 1]!.hours).toBeGreaterThanOrEqual(worst[k]!.hours)
    for (const w of worst) {
      expect(w.condition).toBeLessThan(50)
      expect(w.links.length).toBeGreaterThan(0)
      // What the screen needs to mend it: a plan of its links is quoted.
      expect(rules.quote(g, city, { kind: 'repair', links: w.links, work: 'resurface' }).ok).toBe(true)
    }
  })

  it('gives the whole of a named road from one of its links', () => {
    const r = namedRoad(fresh(), city, 0)!
    expect(r.links).toContain(0)
  })
})

describe('a whole game with every lever of slice 6', () => {
  function play(): Game {
    const g = fresh(1_000_000)
    const bad = (m: number) => poor(g, 40).slice(m % 7, (m % 7) + 4)
    const plan: Record<number, (g: Game) => Action[]> = {
      0: (h) => [
        { kind: 'upkeep', level: 'generous', patchBelow: 40 },
        { kind: 'build', plan: { kind: 'repair', links: bad(0), work: 'patch' } },
        { kind: 'build', plan: { kind: 'metro', stops: [at(1, 8), at(6, 8), at(10, 8)], makeGood: true } },
        { kind: 'build', plan: { kind: 'streets', zone: h.streets!.findIndex((c, z) => c < 60 && city.zones[z]!.people > 0), work: 'resurface' } },
      ],
      1: () => [{ kind: 'digOnce', on: true }, { kind: 'build', plan: { kind: 'repair', links: bad(1), work: 'resurface' } }],
      2: () => [{ kind: 'build', plan: { kind: 'repair', links: bad(2), work: 'concrete' } }],
      3: () => [{ kind: 'build', plan: { kind: 'road', stops: [at(1, 2), at(9, 5)], lanes: 2, flyover: false, makeGood: true } }],
      6: (h) => [{ kind: 'build', plan: { kind: 'streets', zone: h.streets!.findIndex((c, z) => c < 62 && city.zones[z]!.people > 0), work: 'patch' } }],
      30: () => [{ kind: 'upkeep', level: 'bare' }, { kind: 'digOnce', on: false }],
      50: () => [{ kind: 'upkeep', level: 'steady', patchBelow: null }],
    }
    while (g.status === 'playing') {
      for (const a of plan[g.month]?.(g) ?? []) expect([g.month, a.kind, rules.act(g, city, a)]).toEqual([g.month, a.kind, { ok: true }])
      rules.endMonth(g, city, simulate(rules.state(g, city)))
    }
    return g
  }
  const played = play()

  it('plays out, and plays again to the same game from its list of actions', () => {
    expect(played.status).toBe('finished')
    expect(played.concrete!.length).toBeGreaterThan(0)
    const again = rules.replay(played.season, city, played.done, simulate)
    expect(JSON.stringify(again)).toBe(JSON.stringify(played))
  })

  it('keeps clean copies of the new actions', () => {
    const kinds = played.done.map((d) => d.action.kind)
    expect(kinds).toContain('upkeep')
    expect(kinds).toContain('digOnce')
    expect(played.done.find((d) => d.action.kind === 'upkeep')!.action).toEqual({ kind: 'upkeep', level: 'generous', patchBelow: 40 })
  })
})
