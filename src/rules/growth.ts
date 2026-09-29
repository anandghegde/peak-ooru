import type { MonthResult } from '../sim/types'
import { DEFAULT_PRICES } from '../sim/params'
import { costIndex, div, paise } from './money'
import { builtOf } from './lines'
import { DENSITY, DIG, GROWTH, TAX, ZONE_GROWTH } from './params'
import type { CityData, Game, Lakh } from './types'

/*
 * Growth (PRD CITY-15). The city grows each month by a yearly rate (slice 3: faster when the commute is shorter than
 * in the first month, slower when the tax rate is high). Slice 5 shares that growth among the zones: each by its
 * people and a weight, higher where the commute is shorter than the city's, where more jobs are within reach, and
 * where the player allows taller building near a station. Whole people throughout; the zones add up to the city.
 */

export interface Grown {
  /** People in the city, in ten-thousandths of those at the start. */
  people: number
  /** Of the change, the part the tax rate made, in the same units. */
  byTax: number
  /** People in each zone, in the order of the city's zones. */
  zonePeople: number[]
  /** Building rights sold this month, in lakh: for those who came to live where taller building is allowed. */
  rights: Lakh
}

/** People in each zone now, in the order of the city's zones. */
export function zonePeopleOf(game: Game, city: CityData): number[] {
  if (game.zonePeople) return game.zonePeople
  return city.zones.map((z) => Math.round((z.people * game.people) / 10_000))
}

const startTotals = new WeakMap<object, number>()
function startTotal(city: CityData): number {
  let t = startTotals.get(city.zones)
  if (t === undefined) {
    t = 0
    for (const z of city.zones) t += z.people
    startTotals.set(city.zones, t)
  }
  return t
}

/** a × b ÷ c rounded down, exactly, for whole numbers whose products stay below 2^53. */
function mulDiv(a: number, b: number, c: number): { q: number; r: number } {
  const n = a * b
  let q = Math.floor(n / c)
  if (q * c > n) q--
  else if ((q + 1) * c <= n) q++
  return { q, r: n - q * c }
}

/** Hundredths of a percent a year taken off growth by metro and bus fares above the usual in real terms. */
export function fareEffect(game: Game): number {
  const index = costIndex(game.month)
  let above = 0
  for (const price of ['metroPerKm', 'busPerKm'] as const) {
    const usual = div(paise(DEFAULT_PRICES[price]) * index, 10_000)
    above += div((paise(game.prices[price]) - usual) * 10_000, usual)
  }
  return Math.max(0, div(above * GROWTH.fare, 20_000))
}

/** What the month's growth comes to, from its traffic. Changes nothing. */
export function growth(game: Game, city: CityData, result: MonthResult): Grown {
  const first = game.firstCommute ?? result.commute
  const fromCommute = first > 0 ? div((first - result.commute) * GROWTH.commute, first) : 0
  const commuteEffect = Math.max(-GROWTH.commuteMost, Math.min(GROWTH.commuteMost, fromCommute))
  const taxEffect = div((game.taxRate - TAX.standard) * GROWTH.tax, 10_000)
  // Slice 6: with dig once, new water, power and cable connections come more slowly.
  const digEffect = game.digOnce ? DIG.growth : 0
  const people = game.people + div(game.people * (GROWTH.base + commuteEffect - taxEffect - fareEffect(game) - digEffect), 120_000)
  const byTax = -div(game.people * taxEffect, 120_000)

  const before = zonePeopleOf(game, city)
  let now = 0
  for (const p of before) now += p
  const delta = Math.round((startTotal(city) * people) / 10_000) - now
  const dense = new Set(builtOf(game).dense ?? [])
  const weights = city.zones.map((z, k) => {
    const p = before[k]!
    if (p <= 0) return 0
    if (delta < 0) return p
    let f = 1000
    const zc = result.commuteByZone[z.id] ?? 0
    if (result.commute > 0 && zc > 0) f += div((result.commute - zc) * ZONE_GROWTH.commute, result.commute)
    const za = result.accessByZone[z.id] ?? 0
    f += div((za - result.access) * ZONE_GROWTH.access, 1000)
    f = Math.max(ZONE_GROWTH.least, Math.min(ZONE_GROWTH.most, f))
    if (dense.has(z.id) && p * 1000 < z.people * DENSITY.most) f += DENSITY.pull
    return p * f
  })
  let all = 0
  for (const w of weights) all += w
  const zonePeople = [...before]
  let rights = 0
  if (delta !== 0 && all > 0) {
    const size = Math.abs(delta)
    const sign = delta > 0 ? 1 : -1
    const parts = weights.map((w) => mulDiv(size, w, all))
    let left = size
    for (const p of parts) left -= p.q
    // What rounding leaves goes to the largest remainders, the lower zone first on a tie.
    const order = parts.map((_, k) => k).sort((a, b) => parts[b]!.r - parts[a]!.r || a - b)
    for (let i = 0; i < left; i++) parts[order[i]!]!.q++
    let added = 0
    city.zones.forEach((z, k) => {
      zonePeople[k] = Math.max(0, before[k]! + sign * parts[k]!.q)
      if (sign > 0 && dense.has(z.id)) added += parts[k]!.q
    })
    rights = Math.round((added * DENSITY.perTenPeople) / 10)
  }
  return { people, byTax, zonePeople, rights }
}
