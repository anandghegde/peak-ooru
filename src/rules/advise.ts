import type { MonthResult, Simulate } from '../sim/types'
import { corridors } from './suggest'
import { builtOf, setupOf } from './lines'
import { limitQuote, networkOf, onRoadsOf, isShut } from './roads'
import { cityState } from './state'
import { quote } from './plan'
import { marksOf, pointsFor, averageOf, trafficMeasures, fairnessReference } from './score'
import { costIndex, monthBooks, paise } from './money'
import { DEFAULT_PRICES } from '../sim/params'
import { APPROVAL, REPAIR, SCORE, UPKEEP } from './params'
import { nameOf, namedRoads, patchMonths, stretchName, surfaceMinutes } from './upkeep'
import type { Action, Advice, CityData, Game, MeasureKey, Outcome, Plan, Report } from './types'
import { leverOf, type Lever } from './unlock'

/*
 * Slice 9: "What could I do now?" (SLICE9, B job 1). Three things the city can afford now that are expected to raise the
 * score most within a year, from the city's own state: the roads whose surface costs most time, the zones whose streets
 * are worst, the busiest corridors without a bus route of the player's, the player's bus routes without lanes, the most
 * jammed junctions, the zones where most are killed, the upkeep budget, the most crowded lines. Each is estimated without
 * the model, from last month's traffic and the rules' own arithmetic, in a few tens of milliseconds; given `simulate`,
 * the best is checked with the model (two runs; about half a second in a browser).
 *
 * An estimate is the change in the score as the year in hand scores it (each measure's average over the next twelve
 * months, approval over thirty-six) against not doing it: what it does to the traffic, for the months it is in effect;
 * its cost and running against money for the score; what it does to approval. The traffic part is the rules' arithmetic
 * where they have one (a road's surface), scaled by what the model was measured to do with it, or a figure measured in
 * the model for the kind of thing (`tools/measure-advice.ts calibrate`, on January 2026 and on 2027, 2029 and 2031 of a
 * game left alone).
 */

/** Money the city keeps in hand after anything suggested, at the least it is expected to have within the year: ₹500 crore. */
const RESERVE = 50_000

/**
 * What the model was measured to do (`tools/measure-advice.ts calibrate`, months 0, 12, 36 and 60), in points of the
 * year's score within a year of doing it, before its money and approval (which are worked out from the thing itself).
 * Judgement where the measurements varied: the middle of them.
 */
const PER = {
  /** For each second of the average commute the rules' arithmetic says a better surface saves: 12 to 20 points for the ten worst roads patched. */
  roadSecond: 0.5,
  /** A suggested bus route, the first few: 14 in January 2026, 2 to 8 later (a route beside a metro line opening carries little). */
  busRoute: 8,
  /** Bus lanes, for each 10 km of lane along a route the player runs. */
  busLane10km: 6,
  /** For each death a year a speed limit saves (its safety is worked out from the deaths). */
  death: 0.05,
  /** The upkeep budget raised to generous: 24 to 39 points within a year (the roads, and approval by zone, answer at once). */
  generous: 28,
  /** A standing order to patch potholes below 30: 12 to 36. */
  order: 15,
  /** Three more trains on a line fuller than its trains carry: 9 to 10. */
  trains: 10,
  /** The streets of the ten zones where most live on broken streets, patched: 7 to 10. */
  streets: 7,
  /** Each of the three most jammed junctions redesigned: 0 to 5 for three, noisy. */
  junction: 0.6,
  /** For each link losing a lane to resurfacing for a month. */
  worksLink: 0.05,
}

/** A thing looked at, with the parts of its estimate. */
export interface Candidate extends Advice {
  /** The change the traffic makes, in score points within the year, before money and approval. */
  traffic: number
  /** What it pushes approval by: standing (tenths a month) and once (tenths). */
  standing: number
  once: number
  /** Lakh off money for the score, averaged over the next twelve months. */
  spend: number
  /** The share of the next twelve months it is in effect, for scaling a check with the model; none if it cannot be checked. */
  share?: number
  /** What the estimate was made from, for measuring it. */
  basis?: number
  /** Of `traffic`, what works under way cost, which a check with the thing open at once does not see. */
  works?: number
}

export interface AdviseOptions {
  levers?: string[]
  count?: number
  simulate?: Simulate
  /** This month's traffic, if the caller has worked it out already: used before the first month, when there is no last. */
  result?: MonthResult
}

/** What advice needs of the rules: whether an action may be done, doing it, and ending a month (for the check). */
export interface Deps {
  may: (game: Game, city: CityData, action: Action) => Outcome
  act: (game: Game, city: CityData, action: Action) => Outcome
  endMonth: (game: Game, city: CityData, result: MonthResult) => Report
  /** Money at the end of each of the next months as things stand (`forecast` in index.ts). */
  forecast: (game: Game, city: CityData, months: number) => { month: number; money: number }[]
}

/** Up to `count` things worth doing now, best first (`Rules.advise`). Changes nothing. */
export function advise(game: Game, city: CityData, options: AdviseOptions, deps: Deps): Advice[] {
  if (game.status !== 'playing') return []
  const count = Math.max(1, Math.min(5, options.count ?? 3))
  const { list, result } = candidates(game, city, options, deps)
  // Variety: what the player did in the last two months ranks lower, so that the same advice is not first month after month.
  const recent = new Set(game.done.filter((d) => d.month >= game.month - 2).map((d) => leverOf(d.action)))
  const rank = (c: Candidate) => (recent.has(c.lever as Lever) ? c.score * 0.6 : c.score)
  let picked = pick(list, count, rank)
  // The best that can be checked, checked with the model; if it falls below the next, they are chosen again. Not when
  // the model had to be run for this month's traffic already (before the first month), to keep within a second.
  const first = picked.find((c) => c.share !== undefined)
  const ran = !game.last && !options.result
  if (options.simulate && result && first && !ran) {
    check(game, city, first, result, options.simulate, deps)
    picked = pick(list, count, rank)
  }
  return picked.filter((c) => c.score >= 1).map(({ traffic: _t, standing: _s, once: _o, spend: _p, share: _h, basis: _b, works: _w, ...a }) => a)
}

/** The best of each lever first, so that three suggestions are three different things; then by what they are worth. */
function pick(list: Candidate[], count: number, rank: (c: Candidate) => number): Candidate[] {
  const sorted = [...list].sort((a, b) => rank(b) - rank(a) || (a.title < b.title ? -1 : 1))
  const picked: Candidate[] = []
  const levers = new Set<string>()
  for (const c of sorted) {
    if (picked.length >= count) break
    if (c.score < 1 || levers.has(c.lever)) continue
    picked.push(c)
    levers.add(c.lever)
  }
  for (const c of sorted) {
    if (picked.length >= count) break
    if (c.score >= 1 && !picked.includes(c)) picked.push(c)
  }
  return picked.sort((a, b) => rank(b) - rank(a) || (a.title < b.title ? -1 : 1))
}

/** Every thing worth looking at now, each with its estimate, in no order: for `advise`, and for measuring it. */
export function candidates(game: Game, city: CityData, options: AdviseOptions, deps: Pick<Deps, 'may' | 'forecast'>): { list: Candidate[]; result: MonthResult | null } {
  const allowed = options.levers ? new Set(options.levers) : null
  const ok = (lever: string) => !allowed || allowed.has(lever)
  // Last month's traffic; before the first month, this month's, if the model is given.
  const result = game.last ?? options.result ?? (options.simulate ? options.simulate(cityState(game, city)) : null)
  const ctx = context(game, city, result, deps.forecast)
  const list: Candidate[] = []
  const add = (found: Candidate[]) => {
    for (const c of found) {
      if (!ok(c.lever)) continue
      // What it costs, and two years of running it: the city must be able to keep what it starts.
      if ((c.cost > 0 || c.running > 0) && c.cost + 24 * Math.max(0, c.running) > ctx.room) continue
      if (!c.actions.every((a) => deps.may(game, city, a).ok)) continue
      list.push(c)
    }
  }
  if (ok('repair')) add([...patchRoads(game, city, ctx), ...resurfaceRoads(game, city, ctx)])
  if (ok('streets')) add(patchStreets(game, city))
  if (ok('busRoute')) add(busRoutes(game, city))
  if (ok('busLane')) add(busLanes(game, city, ctx))
  if (ok('junction')) add(junctions(game, city, ctx))
  if (ok('speedLimit')) add(speedLimits(game, city, ctx))
  if (ok('footpaths')) add(footpaths(game, city, ctx))
  if (ok('upkeep')) add(upkeep(game, city))
  if (ok('vehicles') && 'act' in deps) add(trains(game, city, ctx, deps as Pick<Deps, 'act'>))
  if (ok('fare') || ok('tax') || ok('upkeep')) add(shortfall(game, city, ctx))
  for (const c of list) c.score = scoreOf(game, c)
  return { list, result }
}

// ------------------------------------------------------------------------------------------------ what is known now

interface Context {
  result: MonthResult | null
  /**
   * Money that may be spent on something suggested: the least the city is expected to have over the next twelve months
   * as things stand (the work in hand paid as it falls due, the month's running as it is), less the reserve.
   */
  room: number
  /** That least, and whether the city would run out of money within the year. */
  lowest: number
  /** Each routing link's surface now, whole points. */
  surface: number[]
}

function context(game: Game, city: CityData, result: MonthResult | null, forecast: Deps['forecast']): Context {
  const setup = setupOf(game, city)
  let lowest = game.money
  if (game.last) for (const m of forecast(game, city, 12)) lowest = Math.min(lowest, m.money)
  else {
    for (const p of game.projects ?? []) lowest -= Math.round((p.cost * Math.min(12, p.opens - game.month)) / Math.max(1, p.opens - p.started))
  }
  return { result, room: lowest - RESERVE, lowest, surface: setup.surface ?? [] }
}

// ------------------------------------------------------------------------------------------------ the score of it

/** Points of the year's score (0 to 1,000) for a change in one measure's average, from where it stands, against the marks. */
function measurePoints(game: Game, key: MeasureKey, change: number): number {
  const marks = marksOf(game)[key]
  const measured = game.measured ?? []
  const opening = game.season.opening
  const now = measured.length ? averageOf(measured, key) : opening ? opening[key] : 0
  return ((pointsFor(now + change, marks) - pointsFor(now, marks)) * SCORE.weights[key]) / 1000
}

/**
 * Approval's average over thirty-six months, twelve months on, for a push: `standing` tenths a month for the year, and
 * `once` tenths now. Approval moves a twelfth of the way back each month, so a standing push P settles at 12 P.
 */
function approvalShift(standing: number, once: number): number {
  let sum = 0
  let left = 1
  let settled = 0
  for (let n = 0; n < 12; n++) {
    settled = settled + standing - settled / APPROVAL.drift
    sum += settled + once * left
    left = left * (1 - 1 / APPROVAL.drift)
  }
  return sum / SCORE.approvalMonths
}

function scoreOf(game: Game, c: Candidate): number {
  const money = measurePoints(game, 'money', -c.spend)
  const approval = measurePoints(game, 'approval', approvalShift(c.standing, c.once))
  return Math.round((c.traffic + money + approval) * 10) / 10
}

/** Lakh off money for the score, averaged over the next twelve months: the cost at once, the running as it accrues. */
const spendOf = (cost: number, running: number) => cost + Math.round(6.5 * running)

// ------------------------------------------------------------------------------------------------ roads

/** Links in poor or broken repair, grouped by named road, most time lost first, none being mended. */
function poorRoads(game: Game, city: CityData, ctx: Context) {
  const result = ctx.result as (MonthResult & { surfaceDelay?: Int32Array }) | null
  if (!result) return []
  const roads = networkOf(city, onRoadsOf(builtOf(game)))
  const being = new Set<number>()
  for (const p of game.projects ?? []) if (p.plan.kind === 'repair') for (const id of p.plan.links) being.add(id)
  const named = namedRoads(city)
  const by = new Map<number, { links: number[]; lost: number }>()
  const delay = result.surfaceDelay
  for (const l of roads.links) {
    if (l.id >= city.roads.links.length || isShut(l) || being.has(l.id)) continue
    const c = ctx.surface[l.id] ?? 100
    if (c >= 50) continue
    const lost = delay ? delay[l.id] ?? 0 : (Number(result.flow.morning[l.id]) || 0) * l.length * (50 - c)
    if (lost <= 0) continue
    const k = named.road[l.id]!
    const r = by.get(k) ?? { links: [], lost: 0 }
    r.links.push(l.id)
    r.lost += lost
    by.set(k, r)
  }
  return [...by].sort((a, b) => b[1].lost - a[1].lost || a[0] - b[0]).map(([k, r]) => ({
    links: r.links.sort((a, b) => a - b),
    name: nameOf(city, r.links[0]!) === null ? named.names[k]! : stretchName(roads, r.links, nameOf(city, r.links[0]!)!),
  }))
}

/** Seconds of the average commute a new surface on some links saves, at last month's traffic (negative saves). */
function surfaceSeconds(game: Game, city: CityData, ctx: Context, links: number[], to: number): number {
  if (!ctx.result) return 0
  const roads = networkOf(city, onRoadsOf(builtOf(game)))
  const now = [...ctx.surface]
  for (const id of links) now[id] = Math.max(now[id] ?? 100, to)
  return surfaceMinutes(ctx.result, roads, ctx.surface, now, new Set()) * 60
}

/** A small count in words: "ten roads". */
const count = (n: number) => ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] ?? String(n)

/** Approval once, for roads mended (`pressures`): a tenth for each `mendedPer` m, at most `mendedMost`. */
const mendedOnce = (metres: number) => Math.min(APPROVAL.mendedMost, Math.round(metres / APPROVAL.mendedPer))

function patchRoads(game: Game, city: CityData, ctx: Context): Candidate[] {
  const worst = poorRoads(game, city, ctx).slice(0, 10)
  if (!worst.length) return []
  // A patch wears off evenly over its months: on average half of it, for as many of the next twelve as it lasts.
  const share = Math.min(12, patchMonths(game.month)) / 24
  const out: Candidate[] = []
  const make = (links: number[], title: string, why: string) => {
    const plan: Plan = { kind: 'repair', links, work: 'patch' }
    const q = quote(game, city, plan)
    if (!q.ok) return
    const seconds = surfaceSeconds(game, city, ctx, links, REPAIR.patch.to / 1000)
    out.push({
      title, text: why, lever: 'repair', actions: [{ kind: 'build', plan }], cost: q.cost, running: 0,
      score: 0, checked: false, links,
      traffic: -seconds * PER.roadSecond * share, standing: 0, once: mendedOnce(2 * q.length), spend: spendOf(q.cost, 0), share,
    })
  }
  const first = worst[0]!
  const lasts = patchMonths(game.month)
  make(first.links, `Patch the potholes on ${first.name}`, `Its potholes cost the city more time than any other road's. A patch lasts about ${lasts} months.`)
  if (worst.length > 1) {
    const all = [...new Set(worst.flatMap((r) => r.links))].sort((a, b) => a - b)
    make(all, `Patch the potholes on the ${count(worst.length)} roads that cost the city most time`, `Among them ${worst[0]!.name}, and ${worst[1]!.name}. A patch lasts about ${lasts} months.`)
  }
  return out
}

function resurfaceRoads(game: Game, city: CityData, ctx: Context): Candidate[] {
  const worst = poorRoads(game, city, ctx).slice(0, 3)
  if (!worst.length) return []
  const links = [...new Set(worst.flatMap((r) => r.links))].sort((a, b) => a - b)
  const plan: Plan = { kind: 'repair', links, work: 'resurface' }
  const q = quote(game, city, plan)
  if (!q.ok) return []
  const seconds = surfaceSeconds(game, city, ctx, links, REPAIR.resurface.to / 1000)
  // Done stretch by stretch: on average in effect for the year less half its months and a half, and lasting years.
  const share = Math.max(0, 12 - (q.months + 1) / 2) / 12
  return [{
    title: `Resurface the ${worst.length === 1 ? 'road' : `${count(worst.length)} roads`} whose potholes cost the city most time`,
    text: `Done stretch by stretch over ${q.months === 1 ? 'a month' : `${q.months} months`}, with a lane shut only where the work is. ${worst.length === 1 ? 'It stays' : 'They stay'} good for years.`, lever: 'repair',
    actions: [{ kind: 'build', plan }], cost: q.cost, running: 0, score: 0, checked: false, links,
    traffic: -seconds * PER.roadSecond * share - PER.worksLink * q.disrupted.length,
    standing: 0, once: mendedOnce(2 * q.length), spend: spendOf(q.cost, 0), share, works: -PER.worksLink * q.disrupted.length,
  }]
}

/** The streets of the zones where most people live on the worst streets, patched: ten at most. */
function patchStreets(game: Game, city: CityData): Candidate[] {
  const streets = game.streets ?? []
  const people = game.zonePeople ?? city.zones.map((z) => z.people)
  const zones = city.zones.map((z, k) => ({ id: z.id, need: (people[k] ?? 0) * Math.max(0, 50 - (streets[z.id] ?? 100)) }))
    .filter((z) => z.need > 0).sort((a, b) => b.need - a.need || a.id - b.id).slice(0, 10)
  const actions: Action[] = []
  let cost = 0
  for (const z of zones) {
    const q = quote(game, city, { kind: 'streets', zone: z.id, work: 'patch' })
    if (!q.ok) continue
    actions.push({ kind: 'build', plan: { kind: 'streets', zone: z.id, work: 'patch' } })
    cost += q.cost
  }
  if (actions.length < 3) return []
  const share = Math.min(12, patchMonths(game.month)) / 24
  return [{
    title: `Patch the streets of the ${count(actions.length)} zones where most people live on broken streets`,
    text: `Every trip begins and ends on the streets, and potholes there slow everyone. A patch lasts about ${patchMonths(game.month)} months.`,
    lever: 'streets', actions, cost, running: 0, score: 0, checked: false,
    traffic: (PER.streets * actions.length * share * 2) / 10, standing: 0, once: 0, spend: spendOf(cost, 0), share,
  }]
}

/** A redesign of the three junctions where the most time is lost at the peaks. */
function junctions(game: Game, city: CityData, ctx: Context): Candidate[] {
  const last = ctx.result
  if (!last) return []
  const roads = networkOf(city, onRoadsOf(builtOf(game)))
  const lost = new Float64Array(roads.nodes.length)
  for (const l of roads.links) {
    for (const p of ['morning', 'evening'] as const) {
      const f = Number(last.flow[p][l.id]) || 0
      const sp = Number(last.speed[p][l.id]) || 1000
      if (f > 0 && sp < 1000) lost[l.to] = lost[l.to]! + (f * l.length * (1000 - sp)) / Math.max(1, sp) / 1000
    }
  }
  const order = [...lost.keys()].filter((n) => lost[n]! > 0).sort((a, b) => lost[b]! - lost[a]! || a - b)
  const actions: Action[] = []
  let cost = 0
  let months = 0
  for (const node of order.slice(0, 40)) {
    if (actions.length >= 3) break
    const q = quote(game, city, { kind: 'junction', node, work: 'redesign' })
    if (!q.ok) continue
    actions.push({ kind: 'build', plan: { kind: 'junction', node, work: 'redesign' } })
    cost += q.cost
    months = Math.max(months, q.months)
  }
  if (!actions.length) return []
  const share = Math.max(0, 12 - months) / 12
  return [{
    title: `Redesign the ${count(actions.length)} most jammed junctions`, text: `More room to turn and wait, with signals: a quarter more traffic gets through. It takes ${months} months.`,
    lever: 'junction', actions, cost, running: 0, score: 0, checked: false,
    traffic: PER.junction * actions.length * share * 1.5, standing: 0, once: 0, spend: spendOf(cost, 0), share,
  }]
}

// ------------------------------------------------------------------------------------------------ buses

function busRoutes(game: Game, city: CityData): Candidate[] {
  const list = corridors(game, city, 'busRoute').sort((a, b) => b.score - a.score)
  if (!list.length) return []
  const out: Candidate[] = []
  // Each route more serves a little less that is not served already.
  const routes = (game.built?.lines ?? []).filter((l) => l.kind === 'bus').length + (game.projects ?? []).filter((p) => p.plan.kind === 'busRoute').length
  const fade = 4 / (4 + routes)
  // Metro stations open this month (the city's, the season's as far as open, the player's): a route beside a metro line
  // carries few (measured: a route on the Outer Ring Road 14 points in 2026, 2 once the Blue Line ran beside it).
  const setup = setupOf(game, city)
  const open = new Set(setup.lines.filter((l) => l.kind === 'metro').flatMap((l) => l.stations))
  for (const l of city.transit.lines) if (l.kind === 'metro' && l.status === 'open') for (const id of l.stations) open.add(id)
  const metro = [...city.transit.stations, ...setup.stations].filter((st) => open.has(st.id))
    .map((st) => [Math.round(st.at[0] * 1e6), Math.round(st.at[1] * 1e6)] as const)
  const nearMetro = (at: [number, number]) => metro.some(([x, y]) => Math.abs(x - Math.round(at[0] * 1e6)) * 0.108 + Math.abs(y - Math.round(at[1] * 1e6)) * 0.111 <= 1200)
  const taken: [number, number][] = []
  for (const c of list) {
    if (out.length >= 2) break
    // Not the same corridor the other way.
    const shared = c.spots.filter(([x, y]) => taken.some(([tx, ty]) => Math.abs(x - tx) + Math.abs(y - ty) <= 800)).length
    if (shared * 2 > c.spots.length) continue
    taken.push(...c.spots)
    const q = quote(game, city, c.plan)
    if (!q.ok) continue
    const a = q.stations[0]?.name ?? 'here'
    const b = q.stations.at(-1)?.name ?? 'there'
    const buses = c.plan.kind === 'busRoute' ? c.plan.buses : 0
    const share = Math.max(0, 12 - Math.max(1, q.months)) / 12
    const beside = q.stations.filter((st) => nearMetro(st.at)).length / Math.max(1, q.stations.length)
    out.push({
      title: `A bus route from ${a} to ${b}`,
      text: `${Math.round(q.length / 100) / 10} km with ${buses} buses, along one of the busiest roads no route of yours serves. It starts next month.`,
      lever: 'busRoute', actions: [{ kind: 'build', plan: c.plan }], cost: q.cost, running: q.running, score: 0, checked: false,
      at: q.stations[0]?.at,
      traffic: PER.busRoute * fade * share * (1 - 0.8 * beside),
      standing: 0, once: APPROVAL.opens.busRoute ?? 0, spend: spendOf(q.cost, q.running), share, basis: c.score,
    })
  }
  return out
}

/** Bus lanes along the player's running bus routes that have none, on every stretch of two lanes or more. */
function busLanes(game: Game, city: CityData, ctx: Context): Candidate[] {
  const result = ctx.result
  if (!result) return []
  const built = builtOf(game)
  const have = new Set([...built.busLanes, ...(game.projects ?? []).flatMap((p) => (p.plan.kind === 'busLane' ? p.plan.links : []))])
  const byAt = new Map(city.roads.nodes.map((n) => [`${n.at[0]},${n.at[1]}`, n.id]))
  const between = new Map<number, number>()
  const n = city.roads.nodes.length
  for (const l of city.roads.links) between.set(l.from * n + l.to, l.id)
  const out: Candidate[] = []
  for (const line of built.lines) {
    if (line.kind !== 'bus') continue
    const nodes: (number | undefined)[] = []
    for (let i = 0; i + 1 < line.path.length; i += 2) nodes.push(byAt.get(`${Math.round(line.path[i]! * 1e6)},${Math.round(line.path[i + 1]! * 1e6)}`))
    const links: number[] = []
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1]
      const b = nodes[i]
      if (a === undefined || b === undefined) continue
      for (const id of [between.get(a * n + b), between.get(b * n + a)]) {
        if (id !== undefined && city.roads.links[id]!.lanes >= 2 && !have.has(id) && !links.includes(id)) links.push(id)
      }
    }
    if (!links.length) continue
    links.sort((a, b) => a - b)
    const plan: Plan = { kind: 'busLane', links }
    const q = quote(game, city, plan)
    if (!q.ok) continue
    let driven = 0
    let m = 0
    for (const id of links) {
      const l = city.roads.links[id]!
      m += l.length
      driven += (((Number(result.flow.morning[id]) || 0) + (Number(result.flow.evening[id]) || 0)) * l.length) / 1000
    }
    const share = Math.max(0, 12 - Math.max(1, q.months)) / 12
    out.push({
      title: `Bus lanes along ${line.name}`,
      text: `Its buses, and the city's on the same roads, would run free of the traffic. Drivers lose a lane, and resent it for a year or two.`,
      lever: 'busLane', actions: [{ kind: 'build', plan }], cost: q.cost, running: q.running, score: 0, checked: false, links,
      traffic: PER.busLane10km * (m / 10_000) * share,
      standing: -driven / APPROVAL.busLaneDriven, once: 0, spend: spendOf(q.cost, q.running), share,
    })
    if (out.length >= 2) break
  }
  return out
}

// ------------------------------------------------------------------------------------------------ safety

/** A limit of 40 km/h in the ten zones where most were killed last month, where the limit would slow a road. */
function speedLimits(game: Game, city: CityData, ctx: Context): Candidate[] {
  const by = ctx.result?.deathsByZone
  if (!by) return []
  const roads = networkOf(city, onRoadsOf(builtOf(game)))
  const limited = new Set((game.built?.limits ?? []).map((l) => l.zone))
  const zones = city.zones.filter((z) => z.people > 0 && !limited.has(z.id)).map((z) => z.id)
    .sort((a, b) => (by[b] ?? 0) - (by[a] ?? 0) || a - b)
  const actions: Action[] = []
  let deaths = 0
  let cost = 0
  for (const zone of zones) {
    if (actions.length >= 10) break
    const q = limitQuote(game, city, roads, zone, 40)
    if (!q.ok) continue
    actions.push({ kind: 'build', plan: { kind: 'speedLimit', zone, limit: 40 } })
    deaths += by[zone] ?? 0
    cost += q.cost
  }
  if (!actions.length) return []
  // Measured in the model: 40 km/h in the twenty deadliest zones saved about a tenth of their deaths.
  const saved = deaths / 10
  const people = (game.zonePeople ?? city.zones.map((z) => z.people)).reduce((a, p) => a + p, 0)
  const safety = measurePoints(game, 'safety', -Math.round((saved * 10_000_000) / Math.max(1, people)))
  return [{
    title: `A speed limit of 40 km/h in the ${count(actions.length)} zones where most people are killed on the roads`,
    text: `About ${Math.round(saved)} fewer deaths a year, for slower trips there at night. Drivers resent it for a while.`,
    lever: 'speedLimit', actions, cost, running: 0, score: 0, checked: false,
    traffic: safety + saved * PER.death, standing: -actions.length / 4, once: 0, spend: spendOf(cost, 0), share: 1,
  }]
}

/** Footpaths in the three zones where most are killed. Measured: a few zones' footpaths do little for the city's score. */
function footpaths(game: Game, city: CityData, ctx: Context): Candidate[] {
  const by = ctx.result?.deathsByZone
  if (!by) return []
  const laid = new Set([...(game.built?.footpaths ?? []), ...(game.projects ?? []).flatMap((p) => (p.plan.kind === 'footpaths' ? [p.plan.zone] : []))])
  const zones = city.zones.filter((z) => z.ward && z.people > 0 && !laid.has(z.id)).map((z) => z.id).sort((a, b) => (by[b] ?? 0) - (by[a] ?? 0) || a - b)
  const actions: Action[] = []
  let cost = 0
  let deaths = 0
  let months = 0
  for (const zone of zones.slice(0, 20)) {
    if (actions.length >= 3) break
    const q = quote(game, city, { kind: 'footpaths', zone })
    if (!q.ok) continue
    actions.push({ kind: 'build', plan: { kind: 'footpaths', zone } })
    cost += q.cost
    deaths += by[zone] ?? 0
    months = Math.max(months, q.months)
  }
  if (!actions.length) return []
  const share = Math.max(0, 12 - months) / 12
  return [{
    title: `Footpaths and crossings in the ${count(actions.length)} zones where most people are killed on the roads`, text: 'Walking there becomes safer and pleasanter. The roads narrow a little.',
    lever: 'footpaths', actions, cost, running: 0, score: 0, checked: false,
    traffic: PER.death * deaths * 0.2 * share, standing: 0, once: 0, spend: spendOf(cost, 0), share,
  }]
}

// ------------------------------------------------------------------------------------------------ upkeep, trains, fares

function upkeep(game: Game, city: CityData): Candidate[] {
  const out: Candidate[] = []
  const level = game.upkeep ?? 'steady'
  // What a level costs a month more than another, at this month's prices: by the lane-km as the books have them.
  const books = monthBooks(game, city, game.last)
  const now = -(books.find((e) => e.key === 'upkeep')?.amount ?? 0)
  const at = (to: string) => (now > 0 ? Math.round((now * UPKEEP.laneKm[to]!) / UPKEEP.laneKm[level]!) : 0)
  if (level === 'bare') {
    const more = at('steady') - now
    out.push({
      title: 'Set the upkeep budget back to steady', text: 'At bare nothing is mended, and the roads fall about a grade in three years, slowing everyone.',
      lever: 'upkeep', actions: [{ kind: 'upkeep', level: 'steady' }], cost: 0, running: more, score: 0, checked: false,
      traffic: PER.generous, standing: 0, once: 0, spend: spendOf(0, more),
    })
  } else if (level === 'steady') {
    const more = at('generous') - now
    if (more > 0) {
      out.push({
        title: 'Set the upkeep budget to generous', text: 'Roads wear more slowly and the worst are mended sooner, so they get better, and people notice.',
        lever: 'upkeep', actions: [{ kind: 'upkeep', level: 'generous' }], cost: 0, running: more, score: 0, checked: false,
        traffic: PER.generous, standing: 0, once: 0, spend: spendOf(0, more),
      })
    }
  }
  if (game.patchBelow === undefined && level !== 'bare') {
    out.push({
      title: 'Order potholes patched wherever roads fall below 30', text: 'Each month, any zone whose roads fall that low has its potholes filled. The city pays for each patch.',
      lever: 'upkeep', actions: [{ kind: 'upkeep', level, patchBelow: 30 }], cost: 0, running: 1000, score: 0, checked: false,
      traffic: PER.order, standing: 0, once: 0, spend: spendOf(0, 1000),
    })
  }
  return out
}

function trains(game: Game, city: CityData, ctx: Context, deps: Pick<Deps, 'act'>): Candidate[] {
  const crowding = (ctx.result as { crowding?: Record<string, number> } | null)?.crowding ?? {}
  const out: Candidate[] = []
  for (const [line, full] of Object.entries(crowding).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) {
    if (full < 1000 || out.length >= 1) continue
    const known = [...city.transit.lines, ...builtOf(game).lines].find((l) => l.id === line)
    if (!known || known.kind !== 'metro') continue
    // Not again for a line given trains in the last six months: they take a while to tell.
    if (game.done.some((d) => d.month >= game.month - 6 && d.action.kind === 'vehicles' && d.action.line === line)) continue
    const action: Action = { kind: 'vehicles', line, change: 3 }
    // What they cost, and cost to run: the books with them, against without.
    const copy = structuredClone(game)
    const before = copy.money
    if (!deps.act(copy, city, action).ok) continue
    const cost = before - copy.money
    const running = runningOf(game, city) - runningOf(copy, city)
    out.push({
      title: `Three more trains on the ${known.name}`, text: 'At the peak it is fuller than its trains can carry, and people are left on the platform.',
      lever: 'vehicles', actions: [action], cost, running, score: 0, checked: false,
      traffic: PER.trains, standing: 0, once: 0, spend: spendOf(cost, running), share: 1,
    })
  }
  return out
}

/** The month's books as they stand, but for payments on work: what running the city costs and earns. */
function runningOf(game: Game, city: CityData): number {
  let sum = 0
  for (const e of monthBooks(game, city, game.last)) if (!e.key.startsWith('build-')) sum += e.amount
  return sum
}

/**
 * When money would run short within the year as things stand: the metro and bus fares back up with costs; once they
 * are, the property tax up five points, or the upkeep budget back from generous. Worth more than anything else when the city would run out: three
 * months below nothing is a default, and half the score is lost.
 */
function shortfall(game: Game, city: CityData, ctx: Context): Candidate[] {
  if (ctx.lowest >= RESERVE) return []
  const worth = ctx.lowest < 0 ? 60 : ctx.lowest < RESERVE / 2 ? 15 : 5
  const out: Candidate[] = []
  const before = runningOf(game, city)
  const gain = (change: (g: Game) => void) => {
    const copy = structuredClone(game)
    change(copy)
    return Math.max(0, runningOf(copy, city) - before)
  }
  const why = ctx.lowest < 0 ? 'At this rate the city runs out of money within the year.' : 'Money is running low.'
  // First the fares, back up to where they stood in real terms: that costs no approval, since the usual fare rises with
  // costs each January (`pressures`); only then the tax, which people resent for as long as it stands.
  const usual = (mode: 'metro' | 'bus') => Math.floor((paise(DEFAULT_PRICES[`${mode}PerKm`]) * costIndex(game.month)) / 100_000) * 10
  const behind = (['metro', 'bus'] as const).filter((mode) => usual(mode) > Math.round(game.prices[`${mode}PerKm`] * 100))
  if (behind.length) {
    const actions: Action[] = behind.map((mode) => ({ kind: 'fare', mode, perKm: usual(mode) }))
    // The fares the books take are what riders paid last month; each rupee more a km keeps about seven tenths of its
    // riders' fares (judgement, from the model's answer to fares).
    let fares = 0
    for (const e of monthBooks(game, city, game.last)) {
      const mode = e.key.startsWith('fares-metro') ? 'metro' : e.key === 'fares-bus' || e.key === 'shakti' ? 'bus' : null
      if (!mode || !behind.includes(mode)) continue
      const now = Math.round(game.prices[`${mode}PerKm`] * 100)
      fares += Math.round((e.amount * (usual(mode) - now) * 7) / (now * 10))
    }
    out.push({
      title: `Raise the ${behind.join(' and ')} fare${behind.length > 1 ? 's' : ''} in step with costs`, text: `${why} People do not resent a fare that only keeps up with costs.`,
      lever: 'fare', actions, cost: 0, running: -fares, score: 0, checked: false, traffic: worth, standing: 0, once: 0, spend: 0,
    })
    return out
  }
  // The tax, or less upkeep, only when the money would run really low: under half the reserve.
  if (ctx.lowest >= RESERVE / 2) return out
  const rate = Math.min(15_000, game.taxRate + 500)
  const tax = gain((g) => {
    g.taxRate = rate
  })
  out.push({
    title: 'Raise the property tax by five points', text: `${why} People resent it for as long as it stands.`,
    lever: 'tax', actions: [{ kind: 'tax', rate }], cost: 0, running: -tax, score: 0, checked: false, traffic: worth, standing: -4, once: 0, spend: 0,
  })
  if (game.upkeep === 'generous') {
    const saved = gain((g) => {
      g.upkeep = 'steady'
    })
    out.push({
      title: 'Set the upkeep budget back to steady', text: `${why} The roads hold, but no longer improve.`,
      lever: 'upkeep', actions: [{ kind: 'upkeep', level: 'steady' }], cost: 0, running: -saved, score: 0, checked: false,
      traffic: worth - PER.generous, standing: 0, once: 0, spend: 0,
    })
  }
  void city
  return out
}

// ------------------------------------------------------------------------------------------------ the check

/**
 * Checks a suggestion with the model: the game with it done, opened at the month's end whatever its months, against the
 * game without, each a month on; the traffic's change in the measures, for the share of the year it is in effect,
 * scored against the marks. Money and approval as estimated. Two runs of the model.
 */
function check(game: Game, city: CityData, c: Candidate, result: MonthResult, simulate: Simulate, deps: Deps): void {
  if (c.share === undefined) return
  const without = structuredClone(game)
  const withIt = structuredClone(game)
  for (const a of c.actions) if (!deps.act(withIt, city, a).ok) return
  const had = new Set((game.projects ?? []).map((p) => p.id))
  for (const p of withIt.projects ?? []) if (!had.has(p.id)) p.opens = withIt.month + 1
  const month = { ...result, month: game.month }
  deps.endMonth(without, city, month)
  deps.endMonth(withIt, city, month)
  const a = simulate(cityState(without, city))
  const b = simulate(cityState(withIt, city))
  const people = cityState(without, city).zones.map((z) => z.people)
  const reference = fairnessReference(without, city)
  const ta = trafficMeasures(a, city, people, reference)
  const tb = trafficMeasures(b, city, people, reference)
  let traffic = 0
  for (const key of ['access', 'commute', 'clean', 'safety', 'fairness'] as const) traffic += measurePoints(game, key, (tb[key] - ta[key]) * c.share)
  c.traffic = traffic + (c.works ?? 0)
  c.score = scoreOf(game, c)
  c.checked = true
}
