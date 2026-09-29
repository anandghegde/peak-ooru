import { DEFAULT_PRICES } from '../sim/params'
import type { MonthResult } from '../sim/types'
import { workNoun, type Opened } from './build'
import { limitsOf, linkZones, networkOf } from './roads'
import { peopleNow } from './state'
import type { CityData, Game, Plan, Pressure, Setup } from './types'
import { costIndex, div, paise } from './money'
import { APPROVAL, DIG, TAX } from './params'
import { floodsIn, roadsByZone } from './upkeep'
import { monthName, percent, perKm } from './words'

/*
 * Approval (PRD APP-1 to APP-4), by zone (slice 7). 0 to 100 in tenths, starting at 55 in every zone; the city's is the
 * average of the zones' by their people. People judge a government two ways:
 *
 * - **By how their lives have changed over its term:** each zone's commute, road deaths for its people, the state of its
 *   roads and streets, and the jobs it can reach, against the first month's. These set where approval settles (55 and
 *   the change), and they count for more as the years pass: nothing in the first month, in full from the fourth year.
 * - **By what annoys or pleases them this month:** the tax rate, fares, works that take lanes, bus lanes, speed limits,
 *   floods, land taken, taller building next door; and, once, things opening. These push approval, and it moves back
 *   by a twelfth of the way each month towards where the results put it, so a push that stops fades.
 *
 * A standing push of P tenths a month settles approval 1.2 P points from where results put it.
 */

const FARED = [
  { mode: 'metro', price: 'metroPerKm', words: 'The metro fare' },
  { mode: 'bus', price: 'busPerKm', words: 'The bus fare' },
  { mode: 'rail', price: 'railPerKm', words: 'The suburban rail fare' },
] as const

/** A push on approval this month: tenths for every zone, and tenths more for some zones by their index. */
export interface Push {
  text: string
  tenths: number
  local?: Map<number, number>
}

const addLocal = (local: Map<number, number>, k: number, tenths: number) => local.set(k, (local.get(k) ?? 0) + tenths)

/** Zone indices by id. */
const indexOf = new WeakMap<object, Map<number, number>>()
function zoneIndex(city: CityData): Map<number, number> {
  let m = indexOf.get(city.zones)
  if (!m) indexOf.set(city.zones, (m = new Map(city.zones.map((z, k) => [z.id, k]))))
  return m
}

/** What pushes approval this month, before the pull towards where results put it. */
export function pressures(
  game: Game,
  city: CityData,
  result: MonthResult,
  setup: Setup,
  opened: Opened[],
): Push[] {
  const out: Push[] = []
  const index = zoneIndex(city)
  const roads = networkOf(city, setup.onRoads)
  const zoneOf = linkZones(city, roads)
  if (game.taxRate !== TAX.standard) {
    out.push({
      text: `Property tax at ${percent(game.taxRate)} of the standard rate`,
      tenths: -div((game.taxRate - TAX.standard) * APPROVAL.tax, 10_000),
    })
  }
  // Fares above the usual in real terms (the usual rises with costs) are resented; a fare below what it was at the
  // start is welcome. A fare left alone as costs rise is neither: people do not notice a fare that did not change.
  const index4 = costIndex(game.month)
  for (const f of FARED) {
    const start = paise(DEFAULT_PRICES[f.price])
    const usual = div(start * index4, 10_000)
    const now = paise(game.prices[f.price])
    const tenths = now > usual ? -div((now - usual) * APPROVAL.fare[f.mode], usual) : now < start ? div((start - now) * APPROVAL.fare[f.mode], start) : 0
    if (tenths !== 0) out.push({ text: `${f.words} at ${perKm(now)}, ${now > usual ? 'above' : 'below'} the usual`, tenths })
  }
  // Works that take lanes: felt most where they are, and a little by everyone who drives through.
  if (setup.works.length) {
    let m = 0
    const byZone = new Map<number, number>()
    for (const id of setup.works) {
      const len = roads.links[id]?.length ?? 0
      m += len
      const k = index.get(zoneOf[id]!)
      if (k !== undefined) byZone.set(k, (byZone.get(k) ?? 0) + len)
    }
    const local = new Map<number, number>()
    for (const [k, len] of byZone) addLocal(local, k, -Math.min(APPROVAL.worksLocalMost, div(len, APPROVAL.worksLocal)))
    out.push({ text: `${Math.round(m / 1000)} km of main road losing a lane to works`, tenths: -div(m, APPROVAL.worksKm), local })
  }
  // Drivers resent a lane given to buses, as many as drive there, for as long as it stands; less as they get used to
  // it (slice 7): in full for a year after it is ordered, then less, to a third after three years.
  const since = orderedWhen(game)
  if (setup.busLanes.length) {
    let driven = 0
    let m = 0
    for (const id of setup.busLanes) {
      const link = city.roads.links[id]
      if (!link) continue
      m += link.length
      const felt = fade(game.month - (since.lanes.get(id) ?? game.month))
      driven += div(Math.round((((Number(result.flow.morning[id]) || 0) + (Number(result.flow.evening[id]) || 0)) * link.length) / 1000) * felt, 1000)
    }
    const tenths = -div(driven, APPROVAL.busLaneDriven)
    if (tenths) out.push({ text: `Drivers losing a lane to ${Math.round(m / 100) / 10} km of bus lanes`, tenths })
  }
  // Speed limits, felt by those who drive on the roads limited, as far as the limit slows them.
  const limits = cityLimits(city, setup)
  if (limits) {
    let felt = 0
    let m = 0
    for (const [key, limit] of Object.entries(limits)) {
      const link = roads.links[Number(key)]!
      m += link.length
      const driven = (((Number(result.flow.morning[link.id]) || 0) + (Number(result.flow.evening[link.id]) || 0)) * link.length) / 1000
      const age = game.month - (since.limits.get(zoneOf[link.id]!) ?? game.month)
      felt += div(Math.round((driven * (link.speed - limit)) / link.speed) * fade(age), 1000)
    }
    const tenths = -div(felt, APPROVAL.limitDriven)
    if (tenths) out.push({ text: `Drivers held to speed limits on ${Math.round(m / 100) / 10} km of main road`, tenths })
  }
  // Once: land taken for roads ordered this month, felt most in the zones it is taken from.
  for (const p of game.projects ?? []) {
    if (p.started !== game.month || !p.quote.land) continue
    const local = new Map<number, number>()
    const zones = new Set<number>()
    for (const id of p.quote.disrupted) {
      const k = index.get(zoneOf[id]!)
      if (k !== undefined) zones.add(k)
    }
    for (const s of p.quote.stations) {
      const k = index.get(nearestZoneOf(city, s.at))
      if (k !== undefined) zones.add(k)
    }
    for (const k of zones) addLocal(local, k, -Math.min(APPROVAL.landLocalMost, div(p.quote.land, APPROVAL.landLocal)))
    const tenths = -Math.min(APPROVAL.landMost, div(p.quote.land, APPROVAL.landPer))
    out.push({ text: `People losing land to ${workNoun(p)}`, tenths, local })
  }
  const now = game.done.filter((d) => d.month === game.month && d.action.kind === 'build').map((d) => (d.action as { plan: Plan }).plan)
  const oneWays = now.filter((p): p is Extract<Plan, { kind: 'oneWay' }> => p.kind === 'oneWay' && p.on)
  if (oneWays.length) {
    const local = new Map<number, number>()
    for (const p of oneWays) {
      const k = index.get(zoneOf[p.link]!)
      if (k !== undefined) addLocal(local, k, -APPROVAL.oneWayLocal)
    }
    out.push({ text: `${oneWays.length === 1 ? 'A road' : `${oneWays.length} roads`} made one-way`, tenths: -oneWays.length * APPROVAL.oneWay, local })
  }
  for (const p of now) {
    if (p.kind !== 'density' || !p.on) continue
    const zone = city.zones.find((z) => z.id === p.zone)
    const local = new Map<number, number>()
    const k = index.get(p.zone)
    if (k !== undefined) local.set(k, -APPROVAL.denseLocal)
    out.push({ text: `Neighbours objecting to taller building in ${zone?.name ?? 'a zone'}`, tenths: -APPROVAL.dense, local })
  }
  // Floods: felt where the roads were shut, and a little by everyone.
  const floods = floodsIn(game.season, city, game.month)
  if (floods.length) {
    let kmDays = 0
    let days = 0
    const byZone = new Map<number, number>()
    for (const f of floods) {
      const md = (city.roads.links[f.link]?.length ?? 0) * f.days
      kmDays += md
      days = Math.max(days, f.days)
      const k = index.get(zoneOf[f.link]!)
      if (k !== undefined) byZone.set(k, (byZone.get(k) ?? 0) + md)
    }
    const local = new Map<number, number>()
    for (const [k, md] of byZone) addLocal(local, k, -Math.min(APPROVAL.floodLocalMost, div(md, APPROVAL.floodLocal)))
    out.push({ text: `Roads flooded for up to ${days} day${days === 1 ? '' : 's'}`, tenths: -div(kmDays, APPROVAL.floodKmDays * 1000), local })
  }
  if (game.digOnce) out.push({ text: 'Utilities made to dig only in set months', tenths: -DIG.approval })
  // Once, for roads and streets mended this month, by the player or their standing order.
  const w = game.wear
  if (w) {
    let m = 0
    for (let id = 0; id < w.mended.length; id++) if (w.mended[id] === game.month) m += roads.links[id]?.length ?? 0
    const zones = w.streetsMended.filter((x) => x === game.month).length
    const tenths = Math.min(APPROVAL.mendedMost, div(m, APPROVAL.mendedPer) + Math.floor(zones / APPROVAL.mendedStreets))
    if (tenths > 0) out.push({ text: `Roads mended: ${Math.round(m / 100) / 10} km${zones ? `, and the streets of ${zones} zone${zones === 1 ? '' : 's'}` : ''}`, tenths })
  }
  for (const o of opened) {
    const tenths = APPROVAL.opens[o.kind] ?? 0
    if (tenths) out.push({ text: o.push, tenths })
  }
  return out.filter((p) => p.tenths !== 0 || (p.local && p.local.size))
}

/**
 * How much a standing annoyance is still felt, in thousandths, by its age in months (slice 7): in full for
 * `APPROVAL.fade.full` months, then less, to `least` after `over` more.
 */
export function fade(age: number): number {
  const f = APPROVAL.fade
  if (age <= f.full) return 1000
  return Math.max(f.least, 1000 - div((age - f.full) * (1000 - f.least), f.over))
}

/** The month each bus lane (by link) and each speed limit (by zone) was last ordered, from the list of actions. */
function orderedWhen(game: Game): { lanes: Map<number, number>; limits: Map<number, number> } {
  const lanes = new Map<number, number>()
  const limits = new Map<number, number>()
  for (const d of game.done) {
    if (d.action.kind !== 'build') continue
    const p = d.action.plan
    if (p.kind === 'busLane') for (const id of p.links) lanes.set(id, d.month)
    else if (p.kind === 'speedLimit') limits.set(p.zone, d.month)
  }
  return { lanes, limits }
}

/** The zone whose centre is nearest a place given in degrees. */
function nearestZoneOf(city: CityData, at: [number, number]): number {
  let best = city.zones[0]?.id ?? 0
  let far = Infinity
  for (const z of city.zones) {
    const dx = z.centre[0] - at[0]
    const dy = z.centre[1] - at[1]
    const d = dx * dx + dy * dy
    if (d < far) {
      far = d
      best = z.id
    }
  }
  return best
}

/** Speed limits on the roads in a setup, by link id, or none. */
function cityLimits(city: CityData, setup: Setup): Record<number, number> | undefined {
  const limits = setup.onRoads?.limits ?? []
  return limits.length ? limitsOf(city, networkOf(city, setup.onRoads), limits) : undefined
}

/** Road deaths a year for each ten million people now. */
export function deathRate(game: Game, city: CityData, deaths: number): number {
  const people = peopleNow(game, city)
  return people > 0 ? div(deaths * 10_000_000, people) : 0
}

/** Each zone's figures for how its people's lives are going: commute, access, deaths a person, roads. */
function zoneFigures(game: Game, city: CityData, result: MonthResult, people: number[]) {
  const roads = roadsByZone(game, city)
  return {
    commute: city.zones.map((z) => Math.round(result.commuteByZone[z.id] ?? 0)),
    access: city.zones.map((z) => Math.round(result.accessByZone[z.id] ?? 0)),
    deaths: city.zones.map((z, k) => (people[k]! > 0 ? div(Math.round(result.deathsByZone?.[z.id] ?? 0) * 10_000_000, people[k]!) : 0)),
    roads,
  }
}

/** Keeps each zone's figures in the first month, against which how lives changed is judged. */
export function noteFirst(game: Game, city: CityData, result: MonthResult, people: number[]): void {
  game.firstZones ??= zoneFigures(game, city, result, people)
}

const clamp = (x: number, most: number) => Math.max(-most, Math.min(most, x))

/**
 * Where results put each zone's approval, in tenths from 55, and in words for the city: the change since the first
 * month in its commute, road deaths for its people, its roads and streets, and the jobs it can reach, weighed in
 * over the first `APPROVAL.results.ramp` months.
 */
export function resultsPull(game: Game, city: CityData, result: MonthResult, people: number[]): { byZone: number[]; parts: { text: string; tenths: number }[] } {
  const first = game.firstZones
  const R = APPROVAL.results
  const byZone = city.zones.map(() => 0)
  if (!first) return { byZone, parts: [] }
  const now = zoneFigures(game, city, result, people)
  const weight = Math.min(1000, div(game.month * 1000, R.ramp))
  const sums = { commute: 0, access: 0, deaths: 0, roads: 0 }
  let all = 0
  city.zones.forEach((_, k) => {
    const p = people[k]!
    if (p <= 0) return
    const c0 = first.commute[k]!
    const commute = c0 > 0 && now.commute[k]! > 0 ? clamp(-div((now.commute[k]! - c0) * R.commute, c0), R.each) : 0
    const a0 = first.access[k]!
    const access = a0 > 0 ? clamp(div((now.access[k]! - a0) * R.access, a0), R.each) : 0
    const d0 = first.deaths[k]!
    const deaths = d0 > 0 ? clamp(-div((now.deaths[k]! - d0) * R.deaths, d0), R.each) : 0
    const roads = clamp((now.roads[k]! - first.roads[k]!) * R.roads, R.each)
    const sum = commute + access + deaths + roads
    const capped = Math.max(-R.down, Math.min(R.up, sum))
    byZone[k] = div(capped * weight, 1000)
    // For the words, each part as far as the cap lets it count.
    const part = (x: number) => (sum === capped || sum === 0 ? x : div(x * capped, sum))
    all += p
    sums.commute += p * part(commute)
    sums.access += p * part(access)
    sums.deaths += p * part(deaths)
    sums.roads += p * part(roads)
  })
  // In words, for the city: each part's pull this month, a twelfth of where it puts approval.
  const pull = (sum: number) => (all > 0 ? div(div(sum, all) * weight, 1000 * APPROVAL.drift) : 0)
  const parts: { text: string; tenths: number }[] = []
  const firstCommute = game.firstCommute ?? result.commute
  if (firstCommute > 0) {
    const share = div((result.commute - firstCommute) * 1000, firstCommute)
    parts.push({ text: share === 0 ? `The commute as it was in ${monthName(0)}` : `The commute ${Math.abs(share) / 10}% ${share > 0 ? 'longer' : 'shorter'} than in ${monthName(0)}`, tenths: pull(sums.commute) })
  }
  parts.push({ text: `Jobs within reach ${sums.access >= 0 ? 'more' : 'fewer'} than in ${monthName(0)}`, tenths: pull(sums.access) })
  if (result.deaths !== undefined && game.firstDeaths) {
    const share = div((deathRate(game, city, result.deaths) - game.firstDeaths) * 1000, game.firstDeaths)
    parts.push({ text: `Road deaths ${Math.abs(share) / 10}% ${share > 0 ? 'more' : 'fewer'} for the people than in ${monthName(0)}`, tenths: pull(sums.deaths) })
  }
  parts.push({ text: `Roads and streets where people live ${sums.roads >= 0 ? 'better' : 'worse'} than in ${monthName(0)}`, tenths: pull(sums.roads) })
  return { byZone, parts: parts.filter((p) => p.tenths !== 0) }
}

/**
 * Moves approval in every zone for the month, and the city's with them; keeps the month's pressures, largest first, in
 * points, as the city feels them.
 */
export function moveApproval(game: Game, city: CityData, pushes: Push[], pull: ReturnType<typeof resultsPull>, people: number[]): void {
  const before = game.approval ?? APPROVAL.start
  const zones = game.zoneApproval ?? city.zones.map(() => APPROVAL.start)
  let all = 0
  for (const p of people) if (p > 0) all += p
  let common = 0
  for (const p of pushes) common += p.tenths
  const next = zones.map((a, k) => {
    let local = 0
    for (const p of pushes) local += p.local?.get(k) ?? 0
    const target = APPROVAL.start + pull.byZone[k]!
    return Math.max(0, Math.min(1000, a + div(target - a, APPROVAL.drift) + common + local))
  })
  let sum = 0
  next.forEach((a, k) => {
    if (people[k]! > 0) sum += people[k]! * a
  })
  game.zoneApproval = next
  game.approval = all > 0 ? div(sum, all) : before
  // For the player: each push as the city feels it (its own tenths, and its local ones over the city's people), the
  // results' pull, and the rest of the pull, back towards 55.
  const words: { text: string; tenths: number }[] = pushes.map((p) => {
    let local = 0
    if (p.local) for (const [k, t] of p.local) local += (people[k] ?? 0) * t
    return { text: p.text, tenths: p.tenths + (all > 0 ? div(local, all) : 0) }
  })
  words.push(...pull.parts)
  const drift = div(APPROVAL.start - before, APPROVAL.drift)
  if (drift !== 0) words.push({ text: `Settling back towards ${APPROVAL.start / 10}`, tenths: drift })
  game.pressures = words
    .filter((p) => p.tenths !== 0)
    .sort((x, y) => Math.abs(y.tenths) - Math.abs(x.tenths) || (x.text < y.text ? -1 : 1))
    .map((p): Pressure => ({ text: p.text, points: p.tenths / 10 }))
}

/** A word for approval, for the player. */
export function approvalWord(tenths: number): string {
  if (tenths >= 700) return 'high'
  if (tenths >= 550) return 'good'
  if (tenths >= 400) return 'fair'
  if (tenths >= APPROVAL.warning) return 'low'
  return 'very low'
}
