// A scripted player: plays the real city for 120 months without a screen and prints the year-end figures and books.
//   npx vite-node tools/playthrough.ts [plan] [seed] [--check]
//   plans: nothing, cheap-fares, dear-fares, high-tax, borrow-and-hold, careless, steady, keep-up, metro, buses, both,
//   roads, safe-streets, everything, neglect, lean-start, keep-roads, concrete, generous, every-lever, good-governance,
//   populist, slow-everywhere, lanes-everywhere, hoard, last-year, late-spender, careless-builder, (slice 9) advised,
//   safe-streets-40; or all (side by
//   side), or several named with commas
//   --check  plays the game again from its season and list of actions and says whether it came out the same
//   npx vite-node tools/playthrough.ts report   a month, then fares and tax raised, and the reports that follow
//   npx vite-node tools/playthrough.ts books    the first month's books, by which TAX_BASE is set for a small surplus
//   npx vite-node tools/playthrough.ts opening  the city's figures as it starts, for the season's `opening` (slice 7)
//   npx vite-node tools/playthrough.ts marks [--quick]  sets the season's marks from the scripted players (slice 7)
//   --no-tax-rise  (slice 9) plans built on keep-up leave the tax alone
//   --save=file.json  keeps each plan's status, months, figures scored (`Game.measured`), score and list of actions (slice 8)
import { readFileSync, writeFileSync } from 'node:fs'
import type { Transit, Zone } from '../src/data/types'
import { micro, roadIndex } from '../src/rules/geo'
import { forecast, rules } from '../src/rules/index'
import { loanLimit, owed, paidBy } from '../src/rules/money'
import { LOANS } from '../src/rules/params'
import { traffic } from '../src/rules/report'
import { averageOf, MEASURES, scoreOf, scoreWith, trafficMeasures } from '../src/rules/score'
import { NOISE } from '../src/rules/params'
import { skip } from '../src/rules/skip'
import { peopleNow } from '../src/rules/state'
import type { Action, CityData, Entry, Game, Marks, MeasureKey, Plan, Report, Season } from '../src/rules/types'
import { firstSeason } from '../src/seasons/first'
import { ROAD_NAMES } from '../src/rules/names'
import { simulate } from '../src/sim/index'
import type { RoutingNetwork } from '../src/sim/types'

const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../public/data/${file}`, import.meta.url), 'utf8')) as T

/** Metro lines being built. */
const building = (g: Game, kind: string) => (g.projects ?? []).filter((p) => p.plan.kind === kind).length

/** Orders the game's best suggestion of a kind, if the rules allow it. */
function orderSuggested(g: Game, city: CityData, kind: 'metro' | 'busRoute'): Action[] {
  const plan = rules.suggest(g, city, kind)[0]
  return plan ? [{ kind: 'build', plan }] : []
}

/**
 * Bus lanes along the player's first two bus routes once they run, on every stretch with two lanes or more and none
 * yet: lanes on every route would take a lane from too many drivers.
 */
function lanesAlongRoutes(g: Game, city: CityData, along = 2): Action[] {
  const ix = roadIndex(city.roads)
  const n = city.roads.nodes.length
  const byAt = new Map(city.roads.nodes.map((node) => [`${node.at[0]},${node.at[1]}`, node.id]))
  const have = new Set([...(g.built?.busLanes ?? []), ...(g.projects ?? []).flatMap((p) => (p.plan.kind === 'busLane' ? p.plan.links : []))])
  const links: number[] = []
  for (const line of g.built?.lines ?? []) {
    if (line.kind !== 'bus' || Number(line.id.slice('player-bus-'.length)) > along) continue
    const nodes = []
    for (let i = 0; i + 1 < line.path.length; i += 2) nodes.push(byAt.get(`${micro(line.path[i]!)},${micro(line.path[i + 1]!)}`))
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1]
      const b = nodes[i]
      if (a === undefined || b === undefined) continue
      for (const id of [ix.between.get(a * n + b), ix.between.get(b * n + a)]) {
        if (id !== undefined && city.roads.links[id]!.lanes >= 2 && !have.has(id)) {
          links.push(id)
          have.add(id)
        }
      }
    }
  }
  return links.length ? [{ kind: 'build', plan: { kind: 'busLane', links } }] : []
}

let CITY: CityData

/**
 * Slice 9: `--no-tax-rise` leaves out keep-up's point of tax each January, which a city with thousands of crore in hand
 * does not need, from every plan built on keep-up: to see what each single-minded plan does for itself.
 */
const TAX_RISE = !process.argv.includes('--no-tax-rise')

/** What a careful player does each January from 2027 to keep up with costs: fares up 4%, the tax rate up a point. */
const keepUp = (g: Game): Action[] => {
  if (g.month === 0 || g.month % 12 !== 0) return []
  const up = (rupees: number) => Math.round((rupees * 100 * 1.04) / 10) * 10
  const fares: Action[] = (['metro', 'bus', 'rail'] as const)
    .map((mode): Action => ({ kind: 'fare', mode, perKm: Math.min({ metro: 900, bus: 400, rail: 200 }[mode], up(g.prices[`${mode}PerKm`])) }))
    .filter((a) => a.kind === 'fare' && a.perKm !== Math.round(g.prices[`${a.mode}PerKm`] * 100))
  return TAX_RISE ? [...fares, { kind: 'tax', rate: Math.min(15_000, g.taxRate + 100) }] : fares
}


/** What is still to be paid on the work in hand. */
const toPay = (g: Game) => (g.projects ?? []).reduce((sum, p) => sum + p.cost - paidBy(p, g.month), 0)

/** Money a careful builder keeps in hand, beyond what the work falls due over a year. */
const RESERVE = 30_000

/**
 * Builds the suggested metro lines (checked with the model) as money allows: at most `most` at a time, each ordered
 * when all still to pay on it and on the work in hand fits in the money in hand and half the city's borrowing room,
 * with ₹300 crore to spare; and keeps up with costs.
 */
const metroPlan = (g: Game, most = 2, keep: (g: Game) => Action[] = keepUp, until = 120): Action[] => {
  const out = keep(g)
  if (g.month >= until) return out
  if (building(g, 'metro') >= most) return out
  const room = Math.max(0, Math.floor((loanLimit(g) / 2 - owed(g)) / LOANS.step) * LOANS.step)
  const affords = (plan: Plan | undefined) => {
    if (!plan) return false
    const q = rules.quote(g, CITY, plan)
    return q.ok && g.money + room >= toPay(g) + q.cost + RESERVE
  }
  // The suggestions are checked with the model (eight runs) only when the first guess could be afforded.
  if (!affords(rules.suggest(g, CITY, 'metro')[0])) return out
  const plan = rules.suggest(g, CITY, 'metro', simulate)[0]
  return affords(plan) ? [...out, { kind: 'build', plan: plan! }] : out
}

/**
 * Borrows ₹500 crore when money runs under the reserve and work is in hand, up to two thirds of what the city may owe
 * (building is planned against half, so a sixth is kept for bad months).
 */
const borrowWhenLow = (g: Game): Action[] => {
  if (g.money >= RESERVE || !(g.projects ?? []).length || owed(g) + 50_000 > (loanLimit(g) * 2) / 3) return []
  return [{ kind: 'borrow', amount: 50_000 }]
}

/** Five more trains on each of the city's busiest metro lines each January from 2027, while they are full. */
const moreTrains = (g: Game): Action[] => {
  if (g.month === 0 || g.month % 12 !== 0) return []
  const crowding = (g.last as { crowding?: Record<string, number> } | null)?.crowding ?? {}
  return ['purple', 'blue', 'green', 'yellow', 'pink']
    .filter((id) => (crowding[id] ?? 0) > 900)
    .map((line): Action => ({ kind: 'vehicles', line, change: 5 }))
}

/** A suggested bus route a month until there are ten, and bus lanes along each once it runs; and keeps up with costs. */
const busPlan = (g: Game): Action[] => {
  const routes = (g.built?.lines ?? []).filter((l) => l.kind === 'bus').length + building(g, 'busRoute')
  return [...keepUp(g), ...(routes < 10 ? orderSuggested(g, CITY, 'busRoute') : []), ...lanesAlongRoutes(g, CITY)]
}

/** Vehicle-hours lost at the peaks on the links into each junction last month: where traffic is worst. */
function jammedJunctions(g: Game): number[] {
  const last = g.last
  if (!last) return []
  const roads = rules.state(g, CITY).roads
  const lost = new Float64Array(roads.nodes.length)
  for (const l of roads.links) {
    for (const p of ['morning', 'evening'] as const) {
      const f = Number(last.flow[p][l.id]) || 0
      const sp = Number(last.speed[p][l.id]) || 1000
      if (f > 0 && sp < 1000) lost[l.to]! += (f * l.length * (1000 - sp)) / Math.max(1, sp) / 1000
    }
  }
  return [...lost.keys()].filter((n) => lost[n]! > 0).sort((a, b) => lost[b]! - lost[a]! || a - b)
}

/** Junction work where traffic is worst: `each` redesigns a month, and an overpass when `overpass` and money allow. */
function junctionWork(g: Game, each: number, overpass: boolean): Action[] {
  const out: Action[] = []
  const worst = jammedJunctions(g).slice(0, 60)
  for (const node of worst) {
    if (out.length >= each) break
    const plan = { kind: 'junction', node, work: 'redesign' } as const
    if (rules.quote(g, CITY, plan).ok) out.push({ kind: 'build', plan })
  }
  if (overpass && building(g, 'junction') < each + 1) {
    for (const node of worst.slice(0, 10)) {
      const plan = { kind: 'junction', node, work: 'overpass' } as const
      const q = rules.quote(g, CITY, plan)
      if (q.ok && g.money > 3 * q.cost) {
        out.push({ kind: 'build', plan })
        break
      }
    }
  }
  return out
}

/** The best suggested road or flyover, when fewer than `most` are being built and there is twice its cost in hand. */
function roadWork(g: Game, most: number): Action[] {
  if (building(g, 'road') >= most) return []
  const plan = rules.suggest(g, CITY, 'road')[0]
  if (!plan) return []
  return g.money > 2 * rules.quote(g, CITY, plan).cost ? [{ kind: 'build', plan }] : []
}

/** Zones where most are killed on the roads last month (or, before the model gives deaths, the most crowded wards). */
function dangerous(g: Game): number[] {
  const by = g.last?.deathsByZone
  const zones = CITY.zones.filter((z) => z.ward)
  const score = (id: number) => (by ? by[id] ?? 0 : 0) * 1e6 + (CITY.zones[id]!.people / CITY.zones[id]!.area)
  return zones.map((z) => z.id).sort((a, b) => score(b) - score(a) || a - b)
}

/** Footpaths in `each` more of the most dangerous zones a month, up to `most`; a limit of 30 km/h in the first `limits`. */
function safeStreets(g: Game, each: number, most: number, limits: number): Action[] {
  const out: Action[] = []
  const laid = new Set([...(g.built?.footpaths ?? []), ...(g.projects ?? []).flatMap((p) => (p.plan.kind === 'footpaths' ? [p.plan.zone] : []))])
  const order = dangerous(g)
  if (laid.size < most) {
    for (const zone of order) {
      if (out.length >= each) break
      if (laid.has(zone)) continue
      const plan = { kind: 'footpaths', zone } as const
      if (rules.quote(g, CITY, plan).ok) out.push({ kind: 'build', plan })
    }
  }
  if (g.month === 1) {
    for (const zone of order.slice(0, limits)) {
      const plan = { kind: 'speedLimit', zone, limit: 30 } as const
      if (rules.quote(g, CITY, plan).ok) out.push({ kind: 'build', plan })
    }
  }
  return out
}

/** Taller building allowed in the most populous zone near a station not yet allowed, one a month, up to `most`. */
function denser(g: Game, most: number): Action[] {
  if ((g.built?.dense ?? []).length >= most) return []
  const order = [...CITY.zones].filter((z) => z.ward).sort((a, b) => b.people - a.people || a.id - b.id)
  for (const z of order) {
    const plan = { kind: 'density', zone: z.id, on: true } as const
    if (rules.quote(g, CITY, plan).ok) return [{ kind: 'build', plan }]
  }
  return []
}

// ------------------------------------------------------------------------------------------------ roads (slice 6)

/** Links in poor or broken repair, busiest first by the time their surface cost last month (the model's `surfaceDelay`). */
function costlyLinks(g: Game): number[] {
  const delay = (g.last as { surfaceDelay?: Int32Array } | null)?.surfaceDelay
  if (!delay) return []
  const ids: number[] = []
  for (let i = 0; i < delay.length; i++) if ((g.condition?.[i] ?? 100) < 50 && delay[i]! > 0) ids.push(i)
  return ids.sort((a, b) => delay[b]! - delay[a]! || a - b)
}

/**
 * Each February (once there is a month's traffic to go by), resurfaces the poor roads that cost the most time, up to
 * `lakh` of work at 2026 prices, if the money is there with the reserve to spare.
 */
function resurfaceBusiest(g: Game, lakh: number): Action[] {
  if (g.month % 12 !== 1) return []
  const being = new Set((g.projects ?? []).flatMap((p) => (p.plan.kind === 'repair' ? p.plan.links : [])))
  const concrete = new Set(g.concrete ?? [])
  const roads = rules.state(g, CITY).roads
  const links: number[] = []
  let laneM = 0
  for (const id of costlyLinks(g)) {
    if (being.has(id) || concrete.has(id)) continue
    const l = roads.links[id]!
    if (((laneM + l.length * l.lanes) * 50) / 1000 > lakh) break
    laneM += l.length * l.lanes
    links.push(id)
  }
  if (!links.length) return []
  const plan: Plan = { kind: 'repair', links, work: 'resurface' }
  const q = rules.quote(g, CITY, plan)
  return q.ok && g.money > q.cost + RESERVE ? [{ kind: 'build', plan }] : []
}

/** The ring road and the main radials, as mapped, in the order they are laid in concrete. */
const CONCRETE_ROADS = ['Outer Ring Road', 'Hosur Road', 'Bellary Road', 'Tumkur Road', 'Old Madras Road', 'Mysore Road',
  'Bannerghatta Road', 'Kanakapura Road', 'Magadi Road', 'Sarjapura Road']

/**
 * Lays the ring road and the main radials in concrete, a package of about 12 km of road (both ways) at a time, as the
 * city's white-topping is let, two packages at most under way, when the money is there with the reserve to spare.
 */
function concreteRoads(g: Game): Action[] {
  if ((g.projects ?? []).filter((p) => p.plan.kind === 'repair' && p.plan.work === 'concrete').length >= 2) return []
  const taken = new Set([...(g.concrete ?? []), ...(g.projects ?? []).flatMap((p) => (p.plan.kind === 'repair' ? p.plan.links : []))])
  const roads = CITY.roads
  for (const name of CONCRETE_ROADS) {
    const k = ROAD_NAMES.names.indexOf(name)
    const left = new Set(ROAD_NAMES.of.flatMap((n, id) => (n === k && !taken.has(id) ? [id] : [])))
    if (!left.size) continue
    // A package: from the lowest link left, along the road through the links it meets, to about 24 km of links.
    const start = Math.min(...left)
    const links = [start]
    const seen = new Set([start])
    let m = roads.links[start]!.length
    for (let i = 0; i < links.length && m < 24_000; i++) {
      const l = roads.links[links[i]!]!
      for (const id of left) {
        if (seen.has(id) || m >= 24_000) continue
        const o = roads.links[id]!
        if (o.from === l.from || o.from === l.to || o.to === l.from || o.to === l.to) {
          seen.add(id)
          links.push(id)
          m += o.length
        }
      }
    }
    const plan: Plan = { kind: 'repair', links: links.sort((a, b) => a - b), work: 'concrete' }
    const q = rules.quote(g, CITY, plan)
    return q.ok && g.money > q.cost + RESERVE ? [{ kind: 'build', plan }] : []
  }
  return []
}

/** Fares up 4% each January from 2027, with costs, so that they stand still in real terms; the tax left alone. */
const faresWithCosts = (g: Game): Action[] => keepUp(g).filter((a) => a.kind === 'fare')

/**
 * Slice 7. What I would do, playing to win: `everything`, with the roads looked after better and the tax left alone.
 * Metro lines two at a time, borrowing when low, but none ordered after 2030, whose would open too late to count for
 * much; ten bus routes with lanes along the first four; the busiest city lines given more trains; a junction redesign a
 * month where traffic is worst; footpaths in the most dangerous zone each month up to 40; 40 km/h in the twenty most
 * dangerous; taller building near stations. The upkeep budget steady, with potholes patched wherever a zone's roads fall
 * below 30, and ₹250 crore of the poor roads that cost most resurfaced each February. Fares keep up with costs; the tax
 * rises three points in a January only if money would otherwise run short within the year.
 */
function goodGovernance(g: Game): Action[] {
  const routes = (g.built?.lines ?? []).filter((l) => l.kind === 'bus').length + building(g, 'busRoute')
  const short = g.month % 12 === 0 && g.month > 0 && forecast(g, CITY, 12).some((m) => m.money < RESERVE)
  const tax: Action[] = short ? [{ kind: 'tax', rate: Math.min(15_000, g.taxRate + 300) }] : []
  return [
    ...(g.month === 0 ? [{ kind: 'upkeep', level: 'steady', patchBelow: 30 } as Action] : []),
    ...tax,
    ...resurfaceBusiest(g, 25_000),
    ...metroPlan(g, 2, faresWithCosts, 60),
    ...borrowWhenLow(g),
    ...moreTrains(g),
    ...(routes < 10 ? orderSuggested(g, CITY, 'busRoute') : []),
    ...lanesAlongRoutes(g, CITY, 4),
    ...junctionWork(g, 1, false),
    ...safeStreets(g, 1, 40, 0),
    ...(g.month === 1 ? dangerous(g).slice(0, 20).map((zone): Action => ({ kind: 'build', plan: { kind: 'speedLimit', zone, limit: 40 } })) : []),
    ...denser(g, 20),
  ]
}

/**
 * Slice 7. The populist: cheap fares and a lower tax from the first month, no charges, roads and flyovers before
 * transit (two at a time, and overpasses where traffic is worst), and borrowing to pay for it whenever money runs low,
 * to the limit.
 */
function populist(g: Game): Action[] {
  const out: Action[] = []
  if (g.month === 0) {
    out.push({ kind: 'fare', mode: 'metro', perKm: 350 }, { kind: 'fare', mode: 'bus', perKm: 120 }, { kind: 'fare', mode: 'rail', perKm: 30 }, { kind: 'tax', rate: 9000 })
  }
  const room = Math.floor((loanLimit(g) - owed(g)) / LOANS.step) * LOANS.step
  if (g.money < RESERVE && room >= 50_000) out.push({ kind: 'borrow', amount: 50_000 })
  if (g.month < 108) out.push(...roadWork(g, 2), ...junctionWork(g, 1, true))
  return out
}

/** Slice 7: the one-year builder: nothing until 2034, then borrows to the limit and spends it on work that opens in time. */
function lastYear(g: Game): Action[] {
  if (g.month < 96) return []
  const out: Action[] = []
  if (g.month === 96) {
    const room = loanLimit(g) - owed(g)
    out.push({ kind: 'borrow', amount: room - (room % LOANS.step) }, { kind: 'upkeep', level: 'generous' })
  }
  const routes = (g.built?.lines ?? []).filter((l) => l.kind === 'bus').length + building(g, 'busRoute')
  out.push(...resurfaceBusiest({ ...g, month: 1 } as Game, 60_000).map((a) => a), ...(routes < 10 ? orderSuggested(g, CITY, 'busRoute') : []), ...lanesAlongRoutes(g, CITY, 10), ...junctionWork(g, 3, false))
  if (g.month === 97) out.push(...dangerous(g).slice(0, 60).map((zone): Action => ({ kind: 'build', plan: { kind: 'speedLimit', zone, limit: 30 } })))
  return out
}

/**
 * Slice 7: the late spender. Nothing for seven years, hoarding what the city earns; from January 2033 it spends it on
 * what shows quickly: the upkeep budget at generous and potholes patched below 30, ₹300 crore of resurfacing each
 * February, ten bus routes with lanes along four, two junction redesigns a month, footpaths in three dangerous zones a
 * month, 40 km/h in the twenty most dangerous. No metro: it would not open in time. Borrows when money runs low.
 */
function lateSpender(g: Game): Action[] {
  if (g.month < 84) return []
  const routes = (g.built?.lines ?? []).filter((l) => l.kind === 'bus').length + building(g, 'busRoute')
  return [
    ...(g.month === 84 ? [{ kind: 'upkeep', level: 'generous', patchBelow: 30 } as Action] : []),
    ...(g.month === 85 ? dangerous(g).slice(0, 20).map((zone): Action => ({ kind: 'build', plan: { kind: 'speedLimit', zone, limit: 40 } })) : []),
    ...resurfaceBusiest(g, 30_000),
    ...(g.money < RESERVE && owed(g) + 50_000 <= (loanLimit(g) * 2) / 3 ? [{ kind: 'borrow', amount: 50_000 } as Action] : []),
    ...(routes < 10 ? orderSuggested(g, CITY, 'busRoute') : []),
    ...lanesAlongRoutes(g, CITY, 4),
    ...junctionWork(g, 2, false),
    ...safeStreets(g, 3, 60, 0),
  ]
}

/** What each plan does in a month, given the game as it stands. */
const PLANS: Record<string, (game: Game) => Action[]> = {
  nothing: () => [],
  'cheap-fares': (g) => (g.month === 0
    ? [{ kind: 'fare', mode: 'metro', perKm: 300 }, { kind: 'fare', mode: 'bus', perKm: 100 }, { kind: 'fare', mode: 'rail', perKm: 20 }]
    : []),
  'dear-fares': (g) => (g.month === 0
    ? [{ kind: 'fare', mode: 'metro', perKm: 700 }, { kind: 'fare', mode: 'bus', perKm: 250 }, { kind: 'fare', mode: 'rail', perKm: 80 }]
    : []),
  'high-tax': (g) => (g.month === 0 ? [{ kind: 'tax', rate: 12_500 }] : []),
  'borrow-and-hold': (g) => (g.month === 0 ? [{ kind: 'borrow', amount: 100_000 }] : []),
  careless: (g) => {
    if (g.month !== 0) return []
    const room = loanLimit(g) - owed(g)
    return [{ kind: 'borrow', amount: room - (room % LOANS.step) }]
  },
  // Keeps up with rising costs: each January from 2027, fares up by a twentieth and the tax rate up two points.
  steady: (g) => {
    if (g.month === 0 || g.month % 12 !== 0) return []
    const up = (rupees: number) => Math.round((rupees * 100 * 1.05) / 10) * 10
    return [
      { kind: 'fare', mode: 'metro', perKm: Math.min(900, up(g.prices.metroPerKm)) },
      { kind: 'fare', mode: 'bus', perKm: Math.min(400, up(g.prices.busPerKm)) },
      { kind: 'tax', rate: Math.min(15_000, g.taxRate + 200) },
    ]
  },
  metro: (g) => [...metroPlan(g), ...borrowWhenLow(g)],
  buses: busPlan,
  // Buses as `buses`, and metro lines as `metro`, three at a time, borrowing when money runs low.
  both: (g) => [...metroPlan(g, 3), ...borrowWhenLow(g), ...busPlan(g).filter((a) => a.kind === 'build')],
  // Keeps up with costs and builds nothing: against which the builders are measured.
  'keep-up': keepUp,
  // Flyovers where traffic is worst, two at a time, and junctions redesigned or lifted over where it is worst.
  roads: (g) => [...keepUp(g), ...roadWork(g, 2), ...junctionWork(g, 2, true)],
  // Footpaths in the three most dangerous zones a month, and a limit of 30 km/h in the forty most dangerous.
  'safe-streets': (g) => [...keepUp(g), ...safeStreets(g, 3, 150, 40)],
  // A sensible mix: metro lines as `both`, bus routes and lanes, a junction at a time where traffic is worst, footpaths
  // in the most dangerous zones, and taller building near stations; and (slice 6) the roads looked after: ₹150 crore
  // of the poor roads that cost most resurfaced each February.
  everything: (g) => everything(g, true),
  // Slice 6. `everything` with the roads let go: the upkeep budget at bare, and no mending.
  neglect: (g) => [...(g.month === 0 ? [{ kind: 'upkeep', level: 'bare' } as Action] : []), ...everything(g, false)],
  // `everything` with the budget at bare for the first three years, to pay for building, then steady and mending.
  'lean-start': (g) => [
    ...(g.month === 0 ? [{ kind: 'upkeep', level: 'bare' } as Action] : g.month === 36 ? [{ kind: 'upkeep', level: 'steady' } as Action] : []),
    ...everything(g, g.month >= 36),
  ],
  // Keeps up with costs, keeps the budget steady, has potholes patched in any zone whose roads fall below 25 (broken),
  // and each February resurfaces ₹200 crore of the poor roads that cost the most time.
  'keep-roads': (g) => [
    ...keepUp(g),
    ...(g.month === 0 ? [{ kind: 'upkeep', level: 'steady', patchBelow: 25 } as Action] : []),
    ...resurfaceBusiest(g, 20_000),
  ],
  // Keeps up with costs, and lays the ring road and the main radials in concrete, one at a time as money allows.
  concrete: (g) => [...keepUp(g), ...concreteRoads(g)],
  // Every lever of slice 6 at least once, for checking replay on the real city (`every-lever --check`): the budget and
  // the standing order set and changed, dig once on and off, potholes patched on the worst road and in a zone's
  // streets, the busiest poor roads resurfaced, a package of concrete, a zone's streets resurfaced, and a metro line
  // ordered to make good the roads it digs up.
  'every-lever': (g) => {
    const out: Action[] = [...keepUp(g)]
    const worst = g.reports.at(-1)?.worstRoads?.[0]?.links
    const street = (below: number) => g.streets!.findIndex((c, z) => c < below && CITY.zones[z]!.people > 0)
    if (g.month === 0) out.push({ kind: 'upkeep', level: 'generous', patchBelow: 30 }, { kind: 'build', plan: { kind: 'streets', zone: street(55), work: 'patch' } })
    if (g.month === 1 && worst) out.push({ kind: 'digOnce', on: true }, { kind: 'build', plan: { kind: 'repair', links: worst, work: 'patch' } })
    if (g.month === 2) out.push(...concreteRoads(g))
    if (g.month === 3) {
      const plan = rules.suggest(g, CITY, 'metro')[0]
      if (plan && plan.kind === 'metro') out.push({ kind: 'build', plan: { ...plan, makeGood: true } })
    }
    if (g.month === 4) out.push({ kind: 'build', plan: { kind: 'streets', zone: street(70), work: 'resurface' } })
    if (g.month === 30) out.push({ kind: 'upkeep', level: 'steady', patchBelow: null })
    if (g.month === 40) out.push({ kind: 'digOnce', on: false }, { kind: 'upkeep', level: 'bare' })
    if (g.month === 60) out.push({ kind: 'upkeep', level: 'steady' })
    return [...out, ...resurfaceBusiest(g, 10_000)]
  },
  // Keeps up with costs, and sets the upkeep budget at generous.
  generous: (g) => [...keepUp(g), ...(g.month === 0 ? [{ kind: 'upkeep', level: 'generous' } as Action] : [])],
  // Slice 7: what I would do playing to win; the populist; and plans that look for ways to score without governing.
  'good-governance': goodGovernance,
  populist,
  // A limit of 30 km/h on the main roads of every zone that has a faster one, in February 2026; fares and tax as keep-up.
  'slow-everywhere': (g) => [...keepUp(g), ...(g.month === 1 ? CITY.zones.map((z): Action => ({ kind: 'build', plan: { kind: 'speedLimit', zone: z.id, limit: 30 } })) : [])],
  // Ten bus routes, with bus lanes along every one of them.
  'lanes-everywhere': (g) => {
    const routes = (g.built?.lines ?? []).filter((l) => l.kind === 'bus').length + building(g, 'busRoute')
    return [...keepUp(g), ...(routes < 10 ? orderSuggested(g, CITY, 'busRoute') : []), ...lanesAlongRoutes(g, CITY, 10)]
  },
  // Hoards: tax at the most, fares at the most, builds nothing.
  hoard: (g) => (g.month === 0
    ? [{ kind: 'tax', rate: 15_000 }, { kind: 'fare', mode: 'metro', perKm: 900 }, { kind: 'fare', mode: 'bus', perKm: 400 }, { kind: 'fare', mode: 'rail', perKm: 200 }]
    : []),
  'last-year': lastYear,
  // Slice 9: a player who does only what "What could I do now?" suggests, the first of its three each month.
  advised: (g) => (rules.advise?.(g, CITY) ?? []).slice(0, 1).flatMap((a) => a.actions),
  // Slice 9: as safe-streets, with a limit of 40 km/h rather than 30.
  'safe-streets-40': (g) => [...keepUp(g), ...safeStreets(g, 3, 150, 0), ...(g.month === 1 ? dangerous(g).slice(0, 40).map((zone): Action => ({ kind: 'build', plan: { kind: 'speedLimit', zone, limit: 40 } })) : [])],
  'late-spender': lateSpender,
  // Borrows to the limit at once, and orders every suggested line it can, three a month.
  'careless-builder': (g) => {
    const out: Action[] = []
    if (g.month === 0) {
      const room = loanLimit(g) - owed(g)
      out.push({ kind: 'borrow', amount: room - (room % LOANS.step) })
    }
    return out
  },
}

/**
 * A sensible mix (slice 5): metro lines as `both`, bus routes and lanes, a junction at a time where traffic is worst,
 * footpaths in the most dangerous zones, and taller building near stations; with `roads`, the poor roads that cost most
 * resurfaced each February (slice 6).
 */
function everything(g: Game, roads: boolean): Action[] {
  const routes = (g.built?.lines ?? []).filter((l) => l.kind === 'bus').length + building(g, 'busRoute')
  return [
    ...(roads ? resurfaceBusiest(g, 15_000) : []),
    ...metroPlan(g, 2),
    ...borrowWhenLow(g),
    ...moreTrains(g),
    ...(routes < 10 ? orderSuggested(g, CITY, 'busRoute') : []),
    ...lanesAlongRoutes(g, CITY, 4),
    ...junctionWork(g, 1, false),
    ...safeStreets(g, 1, 40, 0),
    ...(g.month === 1 ? dangerous(g).slice(0, 20).map((zone): Action => ({ kind: 'build', plan: { kind: 'speedLimit', zone, limit: 40 } })) : []),
    ...denser(g, 20),
  ]
}

/** Plans that decide as they go, action by action, seeing each one's result. */
const EAGER: Record<string, (game: Game, city: CityData) => void> = {
  'careless-builder': (g, city) => {
    for (let k = 0; k < 3; k++) {
      const [a] = orderSuggested(g, city, 'metro')
      if (!a || !rules.act(g, city, a).ok) break
    }
  },
}

interface Year {
  year: number
  approval: number
  access: number
  deaths: number
  lines: number
  money: number
  balance: number
  commute: number
  speed: number
  clean: number
  people: number
  metro: number
  bus: number
  owed: number
  /** Slice 6: main-road length in good or fair repair, %; the average condition of main roads and of streets. */
  roads: number
  surface: number
  streets: number
  /** What pushed approval most in the year's last month. */
  pushes: string
  /** Slice 7: the score at the year's end, and each measure's points. */
  score: number
  points: number[]
}

/** Average condition of the main roads, by length, and of the streets, by people. */
function roadState(g: Game, city: CityData): { surface: number; streets: number } {
  const roads = rules.state(g, city).roads
  let m = 0
  let s = 0
  for (const l of roads.links) {
    if (l.from === l.to) continue
    m += l.length
    s += l.length * (g.condition?.[l.id] ?? 100)
  }
  let p = 0
  let t = 0
  city.zones.forEach((z, k) => {
    p += z.people
    t += z.people * (g.streets?.[k] ?? 100)
  })
  return { surface: Math.round((s / m) * 10) / 10, streets: Math.round((t / p) * 10) / 10 }
}

const cr = (lakh: number) => Math.round(lakh / 100)

function play(plan: string, season: Season, city: CityData, quiet: boolean) {
  const choose = PLANS[plan]
  if (!choose) throw new Error(`No plan called ${plan}. Plans: ${Object.keys(PLANS).join(', ')}`)
  const game = rules.start(season, city)
  const years: Year[] = []
  let yearBooks: Entry[] = []
  let yearMoney = game.money
  const started = performance.now()
  let slowest = 0
  while (game.status === 'playing') {
    for (const action of choose(game)) {
      const outcome = rules.act(game, city, action)
      if (!outcome.ok && !quiet && !['build'].includes(action.kind)) console.log(`  ${game.month}: ${action.kind} refused: ${outcome.reason}`)
    }
    EAGER[plan]?.(game, city)
    const t = performance.now()
    const result = simulate(rules.state(game, city))
    slowest = Math.max(slowest, performance.now() - t)
    const month = game.month
    const report = rules.endMonth(game, city, result)
    for (const e of report.books) {
      const kept = yearBooks.find((b) => b.key === e.key)
      if (kept) kept.amount += e.amount
      else yearBooks.push({ ...e })
    }
    if (month % 12 === 11 || game.status !== 'playing') {
      const f = traffic(result, city)
      years.push({
        year: 2026 + Math.floor(month / 12),
        approval: (game.approval ?? 550) / 10,
        access: f.access,
        deaths: result.deaths ?? 0,
        lines: (game.built?.lines ?? []).filter((l) => l.kind === 'metro').length,
        money: cr(game.money),
        balance: cr(game.money - yearMoney),
        commute: f.commute,
        speed: f.speed,
        clean: f.clean,
        people: peopleNow(game, city),
        metro: result.trips.metro,
        bus: result.trips.bus,
        owed: cr(owed(game)),
        roads: report.figures.find((f) => f.key === 'roads')?.now ?? 0,
        pushes: (game.pressures ?? []).slice(0, 3).map((p) => `${p.text} ${p.points}`).join('; '),
        score: game.score?.total ?? 0,
        points: (game.score?.measures ?? []).map((m) => m.points),
        ...roadState(game, city),
      })
      if (game.status === 'playing') {
        yearBooks = []
        yearMoney = game.money
      }
    }
  }
  const took = (performance.now() - started) / 1000
  return { game, years, lastBooks: yearBooks, took, slowest }
}

function printPlan(plan: string, r: ReturnType<typeof play>) {
  console.log(`\n${plan}: ${r.game.status} in ${r.game.month} months, ${r.took.toFixed(1)} s (${((r.took * 1000) / r.game.month).toFixed(0)} ms a month, slowest model run ${r.slowest.toFixed(0)} ms)`)
  console.log('  year   money ₹cr  year ₹cr  owed ₹cr  approval  own metro  commute  access %  deaths  peak km/h  clean %  people (lakh)  metro/day  bus/day  roads %  surface  streets')
  for (const y of r.years) {
    console.log(
      `  ${y.year}  ${String(y.money).padStart(9)}  ${String(y.balance).padStart(8)}  ${String(y.owed).padStart(8)}  ` +
        `${y.approval.toFixed(1).padStart(8)}  ${String(y.lines).padStart(9)}  ` +
        `${y.commute.toFixed(1).padStart(7)}  ${y.access.toFixed(1).padStart(8)}  ${String(y.deaths).padStart(6)}  ${y.speed.toFixed(1).padStart(9)}  ${y.clean.toFixed(1).padStart(7)}  ` +
        `${(y.people / 1e5).toFixed(1).padStart(13)}  ${String(y.metro).padStart(9)}  ${String(y.bus).padStart(8)}  ` +
        `${y.roads.toFixed(1).padStart(7)}  ${y.surface.toFixed(1).padStart(7)}  ${y.streets.toFixed(1).padStart(7)}`,
    )
  }
  for (const y of r.years) console.log(`  approval ${y.year}: ${y.pushes}`)
  console.log('  score by year:  ' + r.years.map((y) => `${y.year} ${y.score} [${y.points.map((p) => (p / 10).toFixed(0)).join(' ')}]`).join('  '))
  const s = r.game.score
  if (s) {
    console.log(`  score at the end: ${s.total}${s.penalty ? ` (${s.penalty.text} −${s.penalty.points})` : ''}`)
    for (const m of s.measures) console.log(`    ${m.name.padEnd(13)} ${String(m.value).padStart(8)} ${m.unit.padEnd(46)} ${(m.points / 10).toFixed(1).padStart(6)} points × ${m.weight / 10}%`)
    console.log(`  averages scored, as kept: ${JSON.stringify(Object.fromEntries(MEASURES.map((k) => [k, averageOf(r.game.measured ?? [], k)])))}`)
  }
  for (const d of r.game.done.filter((d) => d.action.kind !== 'fare' && d.action.kind !== 'tax')) {
    const a = d.action
    const what = a.kind === 'build' ? `${a.plan.kind}${a.plan.kind === 'metro' || a.plan.kind === 'busRoute' || a.plan.kind === 'road' ? ` (${a.plan.stops.length} places)` : ''}` : JSON.stringify(a)
    console.log(`  month ${d.month}: ${a.kind} ${what}`)
  }
  for (const report of r.game.reports) for (const n of report.news) if (/opens|begins running|are open|review|replaced/.test(n)) console.log(`  ${report.from}: ${n}`)
  const riders = r.game.last?.riders ?? {}
  for (const l of r.game.built?.lines ?? []) if (l.kind === 'metro') console.log(`  riders a weekday at the end, ${l.name}: ${riders[l.id] ?? 0}`)
  console.log(`  books of the last year, ₹ crore:`)
  for (const e of r.lastBooks) console.log(`    ${e.name.padEnd(34)} ${String(cr(e.amount)).padStart(7)}`)
}

function check(plan: string, r: ReturnType<typeof play>, season: Season, city: CityData) {
  const t = performance.now()
  const again = rules.replay(season, city, r.game.done, simulate)
  const a = JSON.stringify(r.game)
  const b = JSON.stringify(again)
  const secs = ((performance.now() - t) / 1000).toFixed(1)
  if (a === b) console.log(`  replay of ${plan}: the same game, to the last figure (${a.length} characters compared, ${secs} s)`)
  else {
    let k = 0
    while (a[k] === b[k]) k++
    console.log(`  replay of ${plan}: DIFFERENT at character ${k}: ${a.slice(k - 60, k + 60)} | ${b.slice(k - 60, k + 60)}`)
    process.exitCode = 1
  }
}

function printReport(r: Report) {
  console.log(`\nreport for months ${r.from} to ${r.to}:`)
  for (const f of r.figures) {
    console.log(`  ${f.name}: ${f.before} to ${f.now} ${f.unit}`)
    for (const c of f.causes) console.log(`    ${c.text}`)
  }
  for (const n of r.news) console.log(`  news: ${n}`)
  for (const n of r.needs) console.log(`  needs: ${n}`)
}

/** What the player reads after raising fares and tax: a month, then the rest of the year. */
function reportDemo(season: Season, city: CityData) {
  const game = rules.start(season, city)
  rules.endMonth(game, city, simulate(rules.state(game, city)))
  for (const action of [
    { kind: 'fare', mode: 'metro', perKm: 600 },
    { kind: 'fare', mode: 'bus', perKm: 250 },
    { kind: 'tax', rate: 12_000 },
  ] as Action[]) console.log(rules.act(game, city, action))
  let t = performance.now()
  printReport(skip(game, city, simulate, 1))
  console.log(`  (${((performance.now() - t) / 1000).toFixed(1)} s with the runs for causes)`)
  t = performance.now()
  printReport(skip(game, city, simulate, 'event'))
  console.log(`  (${((performance.now() - t) / 1000).toFixed(1)} s)`)
}

/** The first month's books, and what each fared mode carried. */
function firstBooks(season: Season, city: CityData) {
  const game = rules.start(season, city)
  const result = simulate(rules.state(game, city))
  const report = rules.endMonth(game, city, result)
  for (const e of report.books) console.log(`  ${e.name.padEnd(34)} ${(e.amount / 100).toFixed(1).padStart(8)}`)
  const sum = report.books.reduce((a, e) => a + e.amount, 0)
  console.log(`  ${'balance, ₹ crore a month'.padEnd(34)} ${(sum / 100).toFixed(1).padStart(8)}`)
  const t = result.trips
  console.log(`  trips a weekday: metro ${t.metro}, bus ${t.bus}, rail ${t.rail}; commute ${(result.commute / 60).toFixed(1)} min`)
}

/**
 * Slice 7: the seven measures' figures for the city as it starts, for `Season.opening` in src/seasons/first.ts: the
 * first month's traffic as the model has it, and the season's money and the approval of the start.
 */
function opening(season: Season, city: CityData) {
  const game = rules.start({ ...season, opening: undefined }, city)
  const result = simulate(rules.state(game, city))
  const t = trafficMeasures(result, city, city.zones.map((z) => z.people))
  const figures = { ...t, money: season.money, approval: 550 }
  console.log(`  opening: ${JSON.stringify(figures).replace(/"(\w+)":/g, '$1: ').replace(/,/g, ', ')},`)
  console.log(`  the score of the city as it starts: ${scoreWith({ ...game, season: { ...season, opening: undefined } }, city, result, undefined, season.money).total}`)
}

/** The plans a person would call governing, not gaming, from which the best on each measure sets its 100 (slice 7). */
const PLAUSIBLE = ['good-governance', 'everything', 'lean-start', 'generous', 'lanes-everywhere', 'keep-roads', 'both', 'metro', 'buses', 'safe-streets']

/**
 * Slice 7: sets the season's marks from the scripted players, as docs/RULES.md ("The marks") describes, and prints them
 * with the opening figures and every plan's score under them. On each measure but money: the city as it starts scores
 * 40 and the best plausible plan 95; where that would leave doing nothing under 10 (the start is as good as the best
 * plan reaches, as access is), doing nothing scores 15 and the best plausible plan 90 instead. Money: nothing at
 * −₹4,000 crore, 100 at ₹3,000 crore. Plays each plan (about 25 minutes in all; `--quick` plays only doing nothing and
 * the plausible plans).
 */
function fitMarks(season: Season, city: CityData, quick: boolean) {
  const bare: Season = { ...season, marks: undefined, opening: undefined }
  const start = rules.start(bare, city)
  const first = simulate(rules.state(start, city))
  const opening = { ...trafficMeasures(first, city, city.zones.map((z) => z.people)), money: season.money, approval: 550 }
  console.log(`  opening: ${JSON.stringify(opening)}`)
  const plans = quick ? ['nothing', ...PLAUSIBLE] : Object.keys(PLANS).filter((p) => p !== 'every-lever')
  const games = new Map<string, Game>()
  for (const p of plans) {
    games.set(p, play(p, bare, city, true).game)
    console.log(`  played ${p}`)
  }
  const avg = (g: Game, key: MeasureKey) => averageOf(g.measured ?? [], key)
  const lower = (key: MeasureKey) => key === 'commute' || key === 'safety'
  const step = (key: MeasureKey) => (key === 'money' ? 10_000 : 5)
  const round = (x: number, key: MeasureKey) => Math.round(x / step(key)) * step(key)
  const marks = {} as Marks
  for (const key of MEASURES) {
    if (key === 'money') {
      marks.money = { none: -400_000, full: 100_000 }
      continue
    }
    const S = opening[key]
    const N = avg(games.get('nothing')!, key)
    const values = PLAUSIBLE.filter((p) => games.has(p) && games.get(p)!.status === 'finished').map((p) => avg(games.get(p)!, key))
    const B = lower(key) ? Math.min(...values) : Math.max(...values)
    // Approval's noise: half a point (judgement); the rest B's.
    const noise = (key === 'approval' ? 5 : NOISE[key as keyof typeof NOISE]) * (lower(key) ? -1 : 1)
    // The city as it starts at 40, the best plausible plan at 95.
    let span = ((B - S) * 100) / 55
    let none = S - 0.4 * span
    let how = 'start 40, best 95'
    if ((B - S) / noise < 3 || ((N - none) * 100) / span < 10) {
      // The start is as good as the best reaches: doing nothing at 15, the best at 90.
      span = ((B - N) * 100) / 75
      none = N - 0.15 * span
      how = 'doing nothing 15, best 90'
    }
    if (span / noise < 10) {
      // The plans hardly differ: ten times the noise, the start at 40.
      span = 10 * noise
      none = S - 0.4 * span
      how = 'ten times the noise, start 40'
    }
    marks[key] = { none: round(none, key), full: round(none + span, key) }
    console.log(`  ${key}: start ${S}, doing nothing ${N}, best ${B}: ${how}`)
  }
  console.log(`  marks: ${JSON.stringify(marks)}`)
  console.log(`  opening: ${JSON.stringify(opening)}`)
  const marked: Season = { ...season, marks, opening }
  console.log(`  the city as it starts: ${scoreOf(rules.start(marked, city)).total}`)
  const rows = [...games].map(([p, g]) => [p, scoreOf({ ...g, season: marked })] as const).sort((a, b) => b[1].total - a[1].total)
  for (const [p, s] of rows) console.log(`  ${p.padEnd(18)} ${String(s.total).padStart(4)} ${s.measures.map((m) => String(Math.round(m.points / 10)).padStart(4)).join('')}`)
}

/**
 * Writes src/rules/names.ts: for each routing link, the name of the road it stands for (the name with the most drawn
 * length among its stretches), and the links that pass through an underpass (a drawn stretch with a level below 0),
 * which stand in for low-lying roads until the model gives its list. The rules run without the drawn network.
 */
function writeNames() {
  const roads = read<RoutingNetwork>('routing.json')
  const network = read<{ links: { length: number; name: string | null; level: number }[] }>('network.json')
  const names: string[] = []
  const index = new Map<string, number>()
  const of: number[] = []
  const low: number[] = []
  let check = 0
  for (const l of roads.links) {
    check += l.length
    const by = new Map<string, number>()
    for (const d of l.drawn) {
      const n = network.links[d]
      if (n?.name) by.set(n.name, (by.get(n.name) ?? 0) + n.length)
    }
    let best: string | null = null
    for (const [k, v] of [...by].sort((a, b) => (a[0] < b[0] ? -1 : 1))) if (best === null || v > by.get(best)!) best = k
    if (best === null) of.push(-1)
    else {
      if (!index.has(best)) {
        index.set(best, names.length)
        names.push(best)
      }
      of.push(index.get(best)!)
    }
    if (l.drawn.some((d) => (network.links[d]?.level ?? 0) < 0)) low.push(l.id)
  }
  const text = `// Made by \`npx vite-node tools/playthrough.ts names\` from public/data/routing.json and network.json. Do not edit.
/** Names of the roads the routing links stand for, and links through underpasses, for the rules (docs/RULES.md). */
export const ROAD_NAMES = {
  /** The routing network these are for: its number of links and their length in all, in metres. */
  links: ${roads.links.length},
  length: ${check},
  names: ${JSON.stringify(names)},
  /** For each routing link, its index in \`names\`, or -1 if unnamed. */
  of: ${JSON.stringify(of)},
  /** Routing links through an underpass. */
  low: ${JSON.stringify(low)},
}
`
  writeFileSync(new URL('../src/rules/names.ts', import.meta.url), text)
  console.log(`${names.length} names, ${of.filter((x) => x < 0).length} of ${of.length} links unnamed, ${low.length} low`)
}

function main() {
  const args = process.argv.slice(2)
  if (args[0] === 'names') return writeNames()
  const plan = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a)) ?? 'nothing'
  const seed = Number(args.find((a) => /^\d+$/.test(a)) ?? firstSeason.seed)
  const season: Season = { ...firstSeason, seed }
  const city: CityData = {
    zones: read<Zone[]>('zones.json'),
    roads: read<RoutingNetwork>('routing.json'),
    transit: read<Transit>('transit.json'),
  }
  CITY = city
  if (plan === 'report') return reportDemo(season, city)
  if (plan === 'books') return firstBooks(season, city)
  if (plan === 'opening') return opening(season, city)
  if (plan === 'marks') return fitMarks(season, city, args.includes('--quick'))
  const plans = plan === 'all' ? Object.keys(PLANS) : plan.split(',')
  const results = plans.map((p) => {
    const r = play(p, season, city, false)
    printPlan(p, r)
    if (args.includes('--check')) check(p, r, season, city)
    return [p, r] as const
  })
  const save = args.find((a) => a.startsWith('--save='))?.slice('--save='.length)
  if (save) {
    const kept = Object.fromEntries(results.map(([p, r]) => [p, { status: r.game.status, month: r.game.month, measured: r.game.measured ?? [], score: r.game.score?.total ?? 0, done: r.game.done }]))
    writeFileSync(save, JSON.stringify(kept))
  }
  if (plans.length > 1) {
    console.log('\nside by side at the end (money ₹ crore; commute minutes; access % of jobs within 45 min; deaths a year; people lakh)')
    console.log('  plan               money   owed  commute 2026  commute  access  deaths  approval  people  ends')
    for (const [p, r] of results) {
      const y = r.years.at(-1)!
      const first = r.years[0]!
      console.log(
        `  ${p.padEnd(16)} ${String(y.money).padStart(7)} ${String(y.owed).padStart(6)}  ${first.commute.toFixed(1).padStart(12)}  ` +
          `${y.commute.toFixed(1).padStart(7)}  ${y.access.toFixed(1).padStart(6)}  ${String(y.deaths).padStart(6)}  ` +
          `${y.approval.toFixed(1).padStart(8)}  ${(y.people / 1e5).toFixed(1).padStart(6)}  ` +
          `${r.game.status}${r.game.status === 'finished' ? '' : ` in month ${r.game.month}`}`,
      )
    }
    console.log('\nthe score, best first: total; points of each measure (access, commute, clean, safety, fairness, money, approval)')
    for (const [p, r] of [...results].sort((a, b) => (b[1].game.score?.total ?? 0) - (a[1].game.score?.total ?? 0))) {
      const s = r.game.score!
      const pts = s.measures.map((m) => (m.points / 10).toFixed(0).padStart(4)).join('')
      const y = r.years.at(-1)!
      console.log(`  ${p.padEnd(18)} ${String(s.total).padStart(4)} ${pts}   ${r.game.status}${r.game.status === 'finished' ? '' : ` in month ${r.game.month}`}, ₹${y.money} crore, owed ₹${y.owed} crore, approval ${y.approval.toFixed(1)}${s.penalty ? `, less ${s.penalty.points}` : ''}`)
    }
    console.log('\nthe figures scored (averages of the last 12 months; approval 36)')
    for (const [p, r] of results) console.log(`  ${p.padEnd(18)} ${r.game.score!.measures.map((m) => String(m.value).padStart(7)).join('')}`)
  }
}

main()
