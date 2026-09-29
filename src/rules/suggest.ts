import { east, latOf, lngOf, metres, micro, north, roadIndex, shortest, type RoadIndex } from './geo'
import { builtOf, cycleMinutes, setupOf } from './lines'
import type { Station, TransitLine } from '../data/types'
import type { Simulate } from '../sim/types'
import { quote, roadsNow, trainsAtOpening } from './plan'
import { cityState } from './state'
import { isShut } from './roads'
import type { CityData, Game, Plan, Stop } from './types'

/*
 * Suggested corridors (PRD UI-7d): where most traffic runs and no line serves it, from the last month's flows on the
 * roads (before the first month, from what the roads can carry). A corridor grows from the busiest unserved stretch
 * both ways, along the busiest road that carries on in much the same direction, until it is long enough, the traffic
 * thins, or it reaches a metro station, which it then joins. Each is offered as the places a player would tap, and
 * must pass `quote`. Best first: the most traffic along it.
 */

const LOOK = {
  metro: { length: 24_000, least: 5000, served: 1200, taps: 4000, join: 700 },
  busRoute: { length: 10_000, least: 4000, served: 600, taps: 3000, join: 400 },
}
/** A corridor stops where the traffic falls below this share of its busiest stretch (thousandths). */
const THINS = 150
/** Minutes between buses at the peak on a suggested route. */
const BUS_HEADWAY = 8

export function suggest(game: Game, city: CityData, kind: 'metro' | 'busRoute' | 'road', simulate?: Simulate): Plan[] {
  if (kind === 'road') return roadSuggestions(game, city)
  if (kind !== 'metro' && kind !== 'busRoute') return []
  const look = LOOK[kind]
  const candidates = corridors(game, city, kind)
  candidates.sort((a, b) => b.score - a.score)
  // Checked with the model: the best few by the guess, each opened at once in this month's city, ranked by the riders
  // it would carry a weekday for the square root of its cost.
  if (simulate && kind === 'metro') {
    const checked = candidates.slice(0, CHECKED)
    for (const c of checked) c.score = ridersIfOpen(game, city, c.plan, simulate) / Math.sqrt(Math.max(1, c.cost))
    candidates.splice(0, CHECKED, ...checked.sort((a, b) => b.score - a.score))
  }
  // The best, each not running where a better one runs already.
  const plans: Plan[] = []
  const taken: [number, number][] = []
  for (const c of candidates) {
    if (plans.length >= 5) break
    const shared = c.spots.filter(([x, y]) => taken.some(([tx, ty]) => metres(x, y, tx, ty) <= look.served)).length
    if (shared * 2 > c.spots.length) continue
    plans.push(c.plan)
    taken.push(...c.spots)
  }
  return plans
}

/** Every corridor looked at, each with its plan, its score and where its stations are. */
export function corridors(game: Game, city: CityData, kind: 'metro' | 'busRoute') {
  const ix = roadIndex(city.roads)
  const look = LOOK[kind]
  const flow = flows(game, city)
  const n = city.roads.nodes.length

  // What is served already: metro stations (open, being built, the player's and those ordered) for a metro line;
  // the player's bus routes, and those ordered, for a bus route.
  const served: [number, number][] = []
  const built = builtOf(game)
  const metroStations = [...city.transit.stations, ...built.stations].filter((s) => s.kind === 'metro')
  if (kind === 'metro') {
    for (const s of metroStations) served.push([east(micro(s.at[0])), north(micro(s.at[1]))])
    for (const p of game.projects ?? []) {
      if (p.plan.kind === 'metro') for (const s of p.quote.stations) served.push([east(micro(s.at[0])), north(micro(s.at[1]))])
    }
  } else {
    const paths = [...built.lines.filter((l) => l.kind === 'bus').map((l) => l.path), ...(game.projects ?? []).filter((p) => p.plan.kind === 'busRoute').map((p) => p.quote.path)]
    for (const path of paths) for (let i = 0; i + 1 < path.length; i += 2) served.push([east(micro(path[i]!)), north(micro(path[i + 1]!))])
  }
  const isServed = (x: number, y: number) => served.some(([sx, sy]) => metres(x, y, sx, sy) <= look.served)
  const mid = (l: number) => {
    const link = city.roads.links[l]!
    return [(ix.x[link.from]! + ix.x[link.to]!) >> 1, (ix.y[link.from]! + ix.y[link.to]!) >> 1] as const
  }
  const usable = (l: number) => kind === 'metro' || city.roads.links[l]!.kind !== 'motorway'

  const seeds = city.roads.links
    .map((l) => l.id)
    .filter((l) => usable(l) && flow[l]! > 0)
    .sort((a, b) => flow[b]! - flow[a]! || a - b)
  const tried = new Uint8Array(city.roads.links.length)
  const candidates: { plan: Plan; score: number; spots: [number, number][]; cost: number }[] = []
  for (const seed of seeds) {
    if (candidates.length >= CANDIDATES) break
    if (tried[seed]) continue
    tried[seed] = 1
    const [mx, my] = mid(seed)
    if (isServed(mx, my)) continue
    const corridor = grow(ix, seed, flow, look, usable, kind === 'metro' ? metroStations : [], isServed)
    for (const l of corridor.links) {
      tried[l] = 1
      const link = city.roads.links[l]!
      const back = ix.between.get(link.to * n + link.from)
      if (back !== undefined) tried[back] = 1
    }
    if (corridor.length < look.least) continue
    const plan = toPlan(ix, corridor, look.taps, kind)
    const q = quote(game, city, plan)
    if (!q.ok) continue
    const spots = q.stations.map((st) => [east(micro(st.at[0])), north(micro(st.at[1]))] as [number, number])
    // A bus route is worth the traffic along it; a metro line, see `metroScore`.
    const score = kind === 'metro' ? metroScore(game, city, q.stations, spots, served, look.served, q.cost) : corridor.score
    candidates.push({ plan, score, spots, cost: q.cost })
  }
  return candidates
}

/** Corridors looked at before choosing the best, and of them those checked with the model when it is given. */
const CANDIDATES = 60
const CHECKED = 8

/** Riders a weekday a planned metro line would carry if it opened now, from a run of the model. */
function ridersIfOpen(game: Game, city: CityData, plan: Plan, simulate: Simulate): number {
  const q = quote(game, city, plan)
  if (!q.ok) return 0
  const setup = setupOf(game, city)
  let next = 1 + Math.max(0, ...city.transit.stations.map((s) => s.id), ...setup.stations.map((s) => s.id))
  const added: Station[] = []
  const ids = q.stations.map((s) => {
    if (s.existing !== undefined) return s.existing
    const st: Station = { id: next++, name: s.name, nameKn: s.nameKn, at: s.at, kind: 'metro' }
    added.push(st)
    return st.id
  })
  const id = 'player-suggested'
  const line: TransitLine = { id, name: 'Suggested', kind: 'metro', colour: '#000', status: 'open', stations: ids, path: q.path }
  const trial = {
    ...setup,
    lines: [...setup.lines, line],
    stations: [...setup.stations, ...added],
    vehicles: { ...setup.vehicles, [id]: trainsAtOpening(q.length) },
  }
  return simulate(cityState(game, city, game.people, game.prices, trial)).riders[id] ?? 0
}

/**
 * What a metro line is likely worth, without the model (which the rules cannot run). Measured in the model on 24
 * corridors (September 2026), riders follow above all how the line joins the network: lines joining two different
 * lines carried 110,000 to 200,000 a weekday, lines joining none under 40,000, whatever lived along them. So: the
 * square root of the people and twice the jobs newly within reach of a station, times one more than the stations it
 * shares, four times over if it joins two lines or more at two stations or more, over the square root of its cost.
 */
function metroScore(
  game: Game,
  city: CityData,
  stations: { existing?: number }[],
  spots: [number, number][],
  served: [number, number][],
  within: number,
  cost: number,
): number {
  const near = (x: number, y: number, list: [number, number][]) => list.some(([sx, sy]) => metres(x, y, sx, sy) <= within)
  let reached = 0
  for (const z of city.zones) {
    const x = east(micro(z.centre[0]))
    const y = north(micro(z.centre[1]))
    if (near(x, y, spots) && !near(x, y, served)) reached += z.people + 2 * z.jobs
  }
  const shared = stations.flatMap((s) => (s.existing === undefined ? [] : [s.existing]))
  const lines = new Set<string>()
  // Lines being built count: they will be open long before a line ordered now.
  for (const l of [...city.transit.lines, ...builtOf(game).lines]) {
    if (l.kind === 'metro' && l.stations.some((id) => shared.includes(id))) lines.add(l.id)
  }
  // Two lines joined at two places: one interchange where two lines meet already makes no new link.
  const links = shared.length >= 2 && lines.size >= 2
  return (reached * (1 + shared.length) * (links ? 4 : 1)) / Math.sqrt(Math.max(1, cost))
}

/**
 * Traffic on each link, both ways, at the two peaks (the last month's vehicles an hour, or before the first month
 * what the roads carry), weighed by how many live and work nearby: the nearest zone's people and jobs a km², as a
 * share of `DENSE`, at most whole. So a highway through farmland counts for little, a jammed road in the city for much.
 */
function flows(game: Game, city: CityData): Float64Array {
  const links = city.roads.links
  const own = new Float64Array(links.length)
  const last = game.last
  for (const l of links) {
    own[l.id] = last ? (Number(last.flow.morning[l.id]) || 0) + (Number(last.flow.evening[l.id]) || 0) : l.capacity
  }
  const ix = roadIndex(city.roads)
  const n = city.roads.nodes.length
  const zx = city.zones.map((z) => east(micro(z.centre[0])))
  const zy = city.zones.map((z) => north(micro(z.centre[1])))
  const both = new Float64Array(links.length)
  for (const l of links) {
    const back = ix.between.get(l.to * n + l.from)
    const mx = (ix.x[l.from]! + ix.x[l.to]!) >> 1
    const my = (ix.y[l.from]! + ix.y[l.to]!) >> 1
    let best = 0
    let bestD = Infinity
    for (let k = 0; k < city.zones.length; k++) {
      const d = (zx[k]! - mx) * (zx[k]! - mx) + (zy[k]! - my) * (zy[k]! - my)
      if (d < bestD) {
        bestD = d
        best = k
      }
    }
    const z = city.zones[best]!
    const dense = Math.min(1, (z.people + z.jobs) / Math.max(0.1, z.area) / DENSE)
    both[l.id] = (own[l.id]! + (back === undefined ? 0 : own[back]!)) * dense
  }
  return both
}

/** People and jobs a km² at which a place counts in full. */
const DENSE = 30_000

interface Corridor {
  nodes: number[]
  links: number[]
  length: number
  score: number
  /** A metro station each end joins, if any. */
  ends: [number | null, number | null]
}

function grow(
  ix: RoadIndex,
  seed: number,
  flow: Float64Array,
  look: (typeof LOOK)['metro'],
  usable: (l: number) => boolean,
  stations: { id: number; at: [number, number] }[],
  isServed: (x: number, y: number) => boolean,
): Corridor {
  const links = ix.roads.links
  const s = links[seed]!
  const nodes = [s.from, s.to]
  const used = [seed]
  const seen = new Set(nodes)
  let length = s.length
  let score = flow[seed]! * s.length
  const least = (flow[seed]! * THINS) / 1000
  const ends: [number | null, number | null] = [null, null]
  const near = (node: number) => {
    for (const st of stations) {
      if (metres(ix.x[node]!, ix.y[node]!, east(micro(st.at[0])), north(micro(st.at[1]))) <= look.join) return st.id
    }
    return null
  }
  const dir = (l: number) => [ix.x[links[l]!.to]! - ix.x[links[l]!.from]!, ix.y[links[l]!.to]! - ix.y[links[l]!.from]!] as const
  // Carries on in much the same direction: within about 60 degrees.
  const onward = (a: readonly [number, number], b: readonly [number, number]) => {
    const dot = a[0] * b[0] + a[1] * b[1]
    return dot > 0 && 4 * dot * dot >= (a[0] * a[0] + a[1] * a[1]) * (b[0] * b[0] + b[1] * b[1])
  }
  for (const forward of [true, false]) {
    let last = seed
    while (length < look.length) {
      const at = forward ? nodes.at(-1)! : nodes[0]!
      const station = near(at)
      if (station !== null) {
        ends[forward ? 1 : 0] = station
        break
      }
      let best = -1
      for (const l of forward ? ix.out[at]! : ix.into[at]!) {
        const other = forward ? links[l]!.to : links[l]!.from
        if (seen.has(other) || !usable(l) || flow[l]! < least || !onward(dir(last), dir(l))) continue
        if (isServed(ix.x[other]!, ix.y[other]!) && near(other) === null) continue
        if (best < 0 || flow[l]! > flow[best]! || (flow[l] === flow[best] && l < best)) best = l
      }
      if (best < 0) break
      const other = forward ? links[best]!.to : links[best]!.from
      if (forward) nodes.push(other)
      else nodes.unshift(other)
      seen.add(other)
      used.push(best)
      length += links[best]!.length
      score += flow[best]! * links[best]!.length
      last = best
    }
  }
  return { nodes, links: used, length, score, ends }
}

/** The places a player would tap for a corridor: its ends (a station where it joins one), and about every `every` m. */
function toPlan(ix: RoadIndex, c: Corridor, every: number, kind: 'metro' | 'busRoute'): Plan {
  const at = (node: number): Stop => ({ at: [(ix.roads.nodes[node]!.at[0]) / 1e6, (ix.roads.nodes[node]!.at[1]) / 1e6] })
  const stops: Stop[] = [c.ends[0] !== null ? { station: c.ends[0] } : at(c.nodes[0]!)]
  let along = 0
  let lastTap = 0
  for (let i = 1; i < c.nodes.length - 1; i++) {
    along += metres(ix.x[c.nodes[i - 1]!]!, ix.y[c.nodes[i - 1]!]!, ix.x[c.nodes[i]!]!, ix.y[c.nodes[i]!]!)
    if (along - lastTap >= every && c.length - along >= every / 2) {
      stops.push(at(c.nodes[i]!))
      lastTap = along
    }
  }
  stops.push(c.ends[1] !== null ? { station: c.ends[1] } : at(c.nodes.at(-1)!))
  if (kind === 'metro') return { kind: 'metro', stops }
  const buses = Math.max(4, Math.min(40, Math.ceil(cycleMinutes(c.length, 'bus') / BUS_HEADWAY)))
  return { kind: 'busRoute', stops, buses }
}

// ------------------------------------------------------------------------------------------------ roads

/**
 * Roads suggested where the traffic was worst last month (PRD BLD-5): a flyover over the most jammed stretches of
 * main road, and a road on the ground where a way round the jam is missing (two junctions near it, the way between
 * them by road more than twice as long as straight). Best first by the time lost on the jammed stretch; three to
 * five, each passing `quote`. Nothing before the first month, when there is no traffic to go by.
 */
function roadSuggestions(game: Game, city: CityData): Plan[] {
  const last = game.last
  if (!last) return []
  const roads = roadsNow(game, city)
  const ix = roadIndex(roads)
  const links = roads.links
  // Vehicle-hours lost at the two peaks on each link, as a share of its time at free speed.
  const lost = new Float64Array(links.length)
  for (const l of links) {
    if (isShut(l) || l.kind === 'motorway') continue
    for (const period of ['morning', 'evening'] as const) {
      const f = Number(last.flow[period][l.id]) || 0
      const sp = Number(last.speed[period][l.id]) || 1000
      if (f > 0 && sp > 0 && sp < 1000) lost[l.id]! += (f * l.length * (1000 - sp)) / sp / 1000
    }
  }
  // Places already served: the player's roads and those being built.
  const taken: [number, number][] = []
  for (const r of game.built?.roads ?? []) for (let i = 0; i + 1 < r.path.length; i += 2) taken.push([east(micro(r.path[i]!)), north(micro(r.path[i + 1]!))])
  for (const p of game.projects ?? []) {
    if (p.plan.kind === 'road' || p.plan.kind === 'junction') for (let i = 0; i + 1 < p.quote.path.length; i += 2) taken.push([east(micro(p.quote.path[i]!)), north(micro(p.quote.path[i + 1]!))])
  }
  const near = (x: number, y: number, d: number) => taken.some(([tx, ty]) => metres(x, y, tx, ty) <= d)
  const n = roads.nodes.length
  const seeds = links.map((l) => l.id).filter((id) => lost[id]! > 0).sort((a, b) => lost[b]! - lost[a]! || a - b)
  const used = new Uint8Array(links.length)
  const out: { plan: Plan; score: number }[] = []
  const at = (node: number): Stop => ({ at: [lngOf(ix.x[node]!) / 1e6, latOf(ix.y[node]!) / 1e6] })
  for (const seed of seeds.slice(0, 40)) {
    if (out.length >= 8) break
    if (used[seed]) continue
    const l = links[seed]!
    const mx = (ix.x[l.from]! + ix.x[l.to]!) >> 1
    const my = (ix.y[l.from]! + ix.y[l.to]!) >> 1
    if (near(mx, my, 1500)) continue
    // A flyover along the jammed road: on through the most jammed link ahead and behind while it is jammed too.
    const chain = [l.from, l.to]
    let length = l.length
    const dir = (id: number) => [ix.x[links[id]!.to]! - ix.x[links[id]!.from]!, ix.y[links[id]!.to]! - ix.y[links[id]!.from]!] as const
    const onward = (a: readonly [number, number], b: readonly [number, number]) => {
      const dot = a[0] * b[0] + a[1] * b[1]
      return dot > 0 && 4 * dot * dot >= 3 * (a[0] * a[0] + a[1] * a[1]) * (b[0] * b[0] + b[1] * b[1])
    }
    for (const forward of [true, false]) {
      let lastLink = seed
      while (length < 3000) {
        const end = forward ? chain.at(-1)! : chain[0]!
        let best = -1
        for (const id of forward ? ix.out[end]! : ix.into[end]!) {
          const other = forward ? links[id]!.to : links[id]!.from
          if (chain.includes(other) || lost[id]! < lost[seed]! * 0.3 || !onward(dir(lastLink), dir(id))) continue
          if (best < 0 || lost[id]! > lost[best]!) best = id
        }
        if (best < 0) break
        chain.splice(forward ? chain.length : 0, 0, forward ? links[best]!.to : links[best]!.from)
        length += links[best]!.length
        used[best] = 1
        lastLink = best
      }
    }
    used[seed] = 1
    const back = ix.between.get(l.to * n + l.from)
    if (back !== undefined) used[back] = 1
    if (length >= 600) {
      const lanes = Math.max(1, Math.min(3, l.lanes)) as 1 | 2 | 3
      out.push({ plan: { kind: 'road', stops: [at(chain[0]!), at(chain.at(-1)!)], lanes: lanes === 1 ? 2 : lanes, flyover: true }, score: lost[seed]! * 1.1 })
    }
    // A way round: two junctions within 2.5 km of the jam, 0.8 to 3 km apart and lying along it, far apart by road.
    const around: number[] = []
    for (let k = 0; k < n && around.length < 60; k++) {
      if (roads.nodes[k]!.gateway || !ix.street[k]) continue
      const d = metres(mx, my, ix.x[k]!, ix.y[k]!)
      if (d <= 2500 && d >= 300) around.push(k)
    }
    const [lx, ly] = dir(seed)
    const ll = Math.sqrt(lx * lx + ly * ly)
    let bestPair: { p: number; q: number; ratio: number } | null = null
    for (const p of around) {
      for (const q of around) {
        if (q <= p) continue
        const dx = ix.x[q]! - ix.x[p]!
        const dy = ix.y[q]! - ix.y[p]!
        const d = Math.round(Math.sqrt(dx * dx + dy * dy))
        if (d < 800 || d > 3000 || ll === 0 || Math.abs(dx * lx + dy * ly) < 0.8 * d * ll) continue
        const way = shortest(ix, [[p, 0]], [[q, 0]], (id) => (isShut(links[id]!) ? Infinity : links[id]!.length), false, 3 * d)
        const ratio = way ? way.cost / d : 3
        if (ratio >= 2 && (!bestPair || ratio > bestPair.ratio)) bestPair = { p, q, ratio }
      }
    }
    if (bestPair) out.push({ plan: { kind: 'road', stops: [at(bestPair.p), at(bestPair.q)], lanes: 2, flyover: false }, score: lost[seed]! })
  }
  out.sort((a, b) => b.score - a.score)
  const plans: Plan[] = []
  for (const c of out) {
    if (plans.length >= 5) break
    if (quote(game, city, c.plan).ok) plans.push(c.plan)
  }
  return plans
}
