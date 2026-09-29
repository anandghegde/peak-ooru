import type { Network } from '../data/types'
import type { Surface } from '../rules/types'
import { grade, surfaceSpeed } from '../sim/surface'
import { PERIODS, type MonthResult, type Period, type RoutingLink, type RoutingNetwork } from '../sim/types'

/*
 * The state of the roads, for the screen: grades, the roads a tap on a named road offers, and the worst roads and the
 * delay each causes where the rules do not name them.
 */

/** Good 75 and above, fair 50 to 74, poor 25 to 49, broken under 25 (the brief's grades, for everyone). */
export const GRADES: Surface[] = ['good', 'fair', 'poor', 'broken']

/** 0 good, 1 fair, 2 poor, 3 broken: the model's own grading, so that the screen and the model agree. */
export const gradeOf = grade
export { surfaceSpeed }

/** Patching from May to September lasts half as long (PRD UPK-11). */
export const patchesShort = (month: number) => month % 12 >= 4 && month % 12 <= 8

// ---------------------------------------------------------------------------------------------------------------
// Named roads.

const byNode = new WeakMap<Network, Map<number, number[]>>()

function stretchesAt(network: Network): Map<number, number[]> {
  let m = byNode.get(network)
  if (!m) {
    m = new Map()
    for (const l of network.links) {
      for (const n of [l.a, l.b]) {
        const list = m.get(n)
        if (list) list.push(l.id)
        else m.set(n, [l.id])
      }
    }
    byNode.set(network, m)
  }
  return m
}

const nameKey = (name: string | null | undefined) => (name ?? '').trim().toLowerCase()

/**
 * Whether a stretch's name is the road's: the same, or the road's name with more after it ("Outer Ring Road
 * Underpass" on the Outer Ring Road), or the other way about, for names long enough not to be common words.
 */
function sameRoad(key: string, name: string | null | undefined): boolean {
  const n = nameKey(name)
  if (!n) return false
  if (n === key) return true
  const [short, long] = n.length < key.length ? [n, key] : [key, n]
  return short.length >= 8 && long.startsWith(`${short} `)
}

/** A stretch a road may pass through under another name, or none: a slip road, a flyover, an underpass, a bridge. */
const BRIDGE = /flyover|underpass|overpass|bridge|elevated/i
/** How many such stretches in a row a road may pass through before it is taken to have ended. */
const BRIDGE_HOPS = 3

/**
 * The stretches of the drawn network that make one road with `stretch`: joined end to end and bearing its name, and
 * the pieces between two parts of it that bear none or a flyover's (the Outer Ring Road is cut by flyovers and
 * underpasses with names of their own). Names repeat across the city ("Main Road", "1st Cross"), so only the
 * connected run from the stretch tapped is taken. Empty for a stretch with no name.
 */
export function namedRun(network: Network, stretch: number): number[] {
  const first = network.links[stretch]
  const key = nameKey(first?.name)
  if (!first || !key) return []
  const at = stretchesAt(network)
  const run = new Set([stretch])
  const tried = new Set<number>()
  const queue: { id: number; between: number[] }[] = [{ id: stretch, between: [] }]
  while (queue.length) {
    const { id, between } = queue.pop()!
    const l = network.links[id]!
    for (const n of [l.a, l.b]) {
      for (const next of at.get(n) ?? []) {
        if (run.has(next)) continue
        const s = network.links[next]!
        if (sameRoad(key, s.name)) {
          // The pieces passed through on the way are part of the road.
          for (const b of between) run.add(b)
          run.add(next)
          queue.push({ id: next, between: [] })
        } else if ((!s.name || s.link || BRIDGE.test(s.name)) && between.length < BRIDGE_HOPS && !tried.has(next)) {
          tried.add(next)
          queue.push({ id: next, between: [...between, next] })
        }
      }
    }
  }
  return [...run].sort((a, b) => a - b)
}

/**
 * The routing links of a run of stretches whose condition is under `below`: "all of Hosur Road that is poor". A link
 * belongs to the run if any stretch it stands for does.
 */
export function linksOfRun<T extends { id: number; drawn: number[] }>(
  run: number[], links: T[], condition: ArrayLike<number>, below: number,
): T[] {
  const inRun = new Set(run)
  return links.filter((l) => l.drawn.some((d) => inRun.has(d)) && (condition[l.id] ?? 100) < below)
}

/**
 * Km of road in some links, counting a two-way road once. With the drawn network, by its stretches: a divided road is
 * mapped as two one-way carriageways, each counted as half, so that Hosur Road is as long as Hosur Road.
 */
export function roadKm(links: { drawn: number[]; length: number }[], network?: Network | null): number {
  if (network) {
    const stretches = new Set(links.flatMap((l) => l.drawn))
    let m = 0
    for (const id of stretches) {
      const s = network.links[id]
      if (s) m += s.oneway ? s.length / 2 : s.length
    }
    // A road the player built stands for no stretch: its own length, once.
    for (const l of links) if (!l.drawn.length) m += l.length / 2
    return m / 1000
  }
  const seen = new Set<string>()
  let m = 0
  for (const l of links) {
    const key = l.drawn.length ? [...l.drawn].sort((a, b) => a - b).join() : `own-${l.length}`
    if (seen.has(key)) continue
    seen.add(key)
    m += l.length
  }
  return m / 1000
}

// ---------------------------------------------------------------------------------------------------------------
// The worst roads.

/** Hours in each part of the day, for turning an hour's flow into a day's (judgement: 3 + 5 + 3 + 13). */
export const PERIOD_HOURS: Record<Period, number> = { morning: 3, midday: 5, evening: 3, night: 13 }

/** What a link in poor repair costs the people on it. */
export interface LinkDelay {
  id: number
  drawn: number[]
  condition: number
  /** Vehicle-hours lost to its surface in a weekday. */
  hours: number
  /** Seconds lost by each vehicle crossing it at the evening peak, and vehicles an hour on it then. */
  seconds: number
  evening: number
  length: number
  lanes: number
}

/**
 * Links whose surface is fair or worse, with the time their surface costs: each vehicle's time across it, less what
 * it would be on a good surface, times the vehicles, over the parts of the day. An estimate from the month's traffic.
 */
export function linkDelays(
  roads: RoutingNetwork, result: MonthResult, condition: ArrayLike<number>,
  kmh?: (period: Period, link: RoutingLink) => number,
): LinkDelay[] {
  const out: LinkDelay[] = []
  // The model's own figure for the time each surface costs, where it gives one: vehicle-minutes a weekday.
  const surfaceDelay = (result as MonthResult & { surfaceDelay?: ArrayLike<number> }).surfaceDelay
  for (const l of roads.links) {
    const c = condition[l.id]
    if (c === undefined || c >= 75) continue
    const lost = 1 - surfaceSpeed(c)
    let hours = 0
    let seconds = 0
    for (const p of PERIODS) {
      const flow = result.flow[p][l.id] ?? 0
      const speed = Math.max(1, kmh ? kmh(p, l) : (l.speed * (result.speed[p][l.id] ?? 1000)) / 1000)
      const extra = ((l.length / 1000 / speed) * 3600) * lost
      hours += (flow * extra * PERIOD_HOURS[p]) / 3600
      if (p === 'evening') seconds = extra
    }
    if (surfaceDelay) hours = (surfaceDelay[l.id] ?? 0) / 60
    out.push({
      id: l.id, drawn: l.drawn, condition: c, hours, seconds, evening: result.flow.evening[l.id] ?? 0,
      length: l.length, lanes: l.lanes,
    })
  }
  return out
}

/** One of the worst roads, as the report names it. */
export interface WorstRoad {
  name: string
  /** Km of it that is poor or broken, and of that, broken. */
  km: number
  brokenKm: number
  /** Vehicle-hours lost to its surface a weekday. */
  hours: number
  /** Minutes slower end to end at the evening peak, one way. */
  minutes: number
  /** The links to mend: all of it that is poor or broken. */
  links: number[]
  /** Where it is, for going to it: the bounds of its poor stretches, west, south, east, north. */
  bounds: [number, number, number, number]
}

/**
 * The roads whose surfaces cost most, by name: each poor or broken link joined with the rest of its named road
 * (the connected run of stretches of one name), and the runs ranked by the hours they lose. Unnamed stretches are
 * left out: a road the player cannot name is not one they can be told of.
 */
export function worstRoads(network: Network, delays: LinkDelay[], count = 5): WorstRoad[] {
  const poor = delays.filter((d) => d.condition < 50)
  const byStretch = new Map<number, LinkDelay[]>()
  for (const d of poor) for (const s of d.drawn) byStretch.set(s, [...(byStretch.get(s) ?? []), d])
  const done = new Set<number>()
  const roads: WorstRoad[] = []
  for (const d of [...poor].sort((a, b) => b.hours - a.hours)) {
    if (done.has(d.id)) continue
    const start = d.drawn.find((s) => network.links[s]?.name)
    if (start === undefined) continue
    const run = namedRun(network, start)
    const members = new Set<LinkDelay>()
    for (const s of run) for (const x of byStretch.get(s) ?? []) members.add(x)
    const list = [...members]
    for (const x of list) done.add(x.id)
    const hours = list.reduce((sum, x) => sum + x.hours, 0)
    // Both ways of a two-way road are links: one way is about half the seconds of both.
    const twoWay = list.length > 1 && new Set(list.map((x) => x.drawn.join())).size < list.length
    const seconds = list.reduce((sum, x) => sum + x.seconds, 0) / (twoWay ? 2 : 1)
    let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity]
    for (const x of list) {
      for (const st of x.drawn) {
        const line = network.links[st]?.line ?? []
        for (let i = 0; i + 1 < line.length; i += 2) {
          w = Math.min(w, line[i]!)
          e = Math.max(e, line[i]!)
          s = Math.min(s, line[i + 1]!)
          n = Math.max(n, line[i + 1]!)
        }
      }
    }
    roads.push({
      name: network.links[start]!.name!,
      km: roadKm(list, network),
      brokenKm: roadKm(list.filter((x) => x.condition < 25), network),
      hours,
      minutes: seconds / 60,
      links: list.map((x) => x.id).sort((a, b) => a - b),
      bounds: [w, s, e, n],
    })
  }
  return roads.sort((a, b) => b.hours - a.hours).slice(0, count)
}
