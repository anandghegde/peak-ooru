// Noise (slice 7, job 2): fifty small changes of different kinds, one at a time, to January 2026 as the first season
// starts it, and what each does to the four figures the score reads: the commute, access to jobs, road deaths, and the
// share of clean trips (bus, metro, rail, cycle, on foot). Each change is small and meant well or meant ill, so a change
// in the wrong direction is noise; the spread says below what size a change is noise.
//   npx vite-node tools/measure-noise.ts            the fifty, and the spread
//   npx vite-node tools/measure-noise.ts --list     each change on its own line as well
import { january } from './measure-common'
import { simulate as live } from '../src/sim/index'
import type { MonthResult, RoutingNetwork, CityState } from '../src/sim/types'

type Sim = (s: CityState) => MonthResult
/** +1 if the change is meant to help (the figures should get better or stay), −1 if to hinder. */
interface Change {
  name: string
  kind: string
  sign: 1 | -1
  apply: (s: CityState) => CityState
}

/** Main-road links (secondary and above, not the joins of a zone to itself), spread over the city in id order. */
function mainLinks(roads: RoutingNetwork): number[] {
  return roads.links.filter((l) => l.from !== l.to && l.kind !== 'tertiary' && l.kind !== 'motorway').map((l) => l.id)
}

/** The link running the other way along the same road, if any. */
function back(roads: RoutingNetwork, id: number): number | undefined {
  const l = roads.links[id]!
  return roads.links.find((x) => x.from === l.to && x.to === l.from)?.id
}

/** A stretch: the link, its way back, and the links that follow on from it, `n` of them each way. */
function stretchFrom(roads: RoutingNetwork, id: number, n: number): number[] {
  const out = new Set<number>([id])
  let at = roads.links[id]!
  for (let k = 1; k < n; k++) {
    const next = roads.links.find((x) => x.from === at.to && x.to !== at.from && x.kind === at.kind && !out.has(x.id))
    if (!next) break
    out.add(next.id)
    at = next
  }
  for (const x of [...out]) {
    const b = back(roads, x)
    if (b !== undefined) out.add(b)
  }
  return [...out].sort((a, b) => a - b)
}

export function changes(base: CityState): Change[] {
  const roads = base.roads
  const main = mainLinks(roads)
  const pick = (k: number, of: number) => main[Math.floor(((k + 0.5) * main.length) / of) % main.length]!
  const out: Change[] = []
  const withSurface = (ids: number[], c: number) => (s: CityState): CityState => {
    const surface = [...(s.surface ?? roads.links.map(() => 100))]
    for (const id of ids) surface[id] = Math.max(surface[id] ?? 100, c)
    return { ...s, surface }
  }
  // Mending: one link a little; a short stretch patched, resurfaced, laid in concrete.
  for (let k = 0; k < 4; k++) out.push({ name: `link ${pick(k, 4)} surface +15`, kind: 'mend', sign: 1, apply: (s) => withSurface([pick(k, 4)], (s.surface?.[pick(k, 4)] ?? 85) + 15)(s) })
  for (let k = 0; k < 4; k++) {
    const ids = stretchFrom(roads, pick(k + 0.33, 4), 3)
    out.push({ name: `stretch at ${ids[0]} (${ids.length} links) patched`, kind: 'mend', sign: 1, apply: withSurface(ids, 62) })
  }
  for (let k = 0; k < 4; k++) {
    const ids = stretchFrom(roads, pick(k + 0.66, 4), 4)
    out.push({ name: `stretch at ${ids[0]} (${ids.length} links) concrete`, kind: 'mend', sign: 1, apply: withSurface(ids, 100) })
  }
  // A zone's streets mended.
  const wards = base.zones.filter((z) => z.ward !== undefined && z.people > 20_000)
  for (let k = 0; k < 5; k++) {
    const z = wards[Math.floor(((k + 0.5) * wards.length) / 5)]!
    out.push({
      name: `streets of ${z.name} resurfaced`, kind: 'streets', sign: 1,
      apply: (s) => ({ ...s, streets: base.zones.map((x) => (x.id === z.id ? 90 : Math.max(s.streets?.[x.id] ?? 100, 0))) }),
    })
  }
  // Footpaths in a zone.
  for (let k = 0; k < 5; k++) {
    const z = wards[Math.floor(((k + 0.25) * wards.length) / 5)]!
    out.push({ name: `footpaths in ${z.name}`, kind: 'footpaths', sign: 1, apply: (s) => ({ ...s, footpaths: [...(s.footpaths ?? []), z.id] }) })
  }
  // A lane lost to works on a short stretch, both ways.
  for (let k = 0; k < 5; k++) {
    const ids = stretchFrom(roads, pick(k + 0.1, 5), 2).filter((id) => roads.links[id]!.lanes > 1)
    out.push({ name: `works on ${ids.length} links at ${ids[0]}`, kind: 'works', sign: -1, apply: (s) => ({ ...s, works: [...(s.works ?? []), ...ids] }) })
  }
  // A link shut a tenth of the month by a flood.
  for (let k = 0; k < 5; k++) {
    const id = pick(k + 0.8, 5)
    out.push({ name: `link ${id} shut 10% of the month`, kind: 'flood', sign: -1, apply: (s) => ({ ...s, shut: { ...(s.shut ?? {}), [id]: 100 } }) })
  }
  // A short new road, 1 lane each way, between two junctions 400 to 900 m apart that no link joins.
  const at = (n: number) => roads.nodes[n]!.at
  const metres = (a: number, b: number) => {
    const dx = ((at(a)[0] - at(b)[0]) / 1e6) * 108_480
    const dy = ((at(a)[1] - at(b)[1]) / 1e6) * 110_570
    return Math.sqrt(dx * dx + dy * dy)
  }
  let found = 0
  for (let k = 0; found < 5 && k < roads.nodes.length; k += 211) {
    const a = roads.nodes[k]!
    if (a.gateway) continue
    const b = roads.nodes.find((n) => !n.gateway && n.id !== a.id && metres(a.id, n.id) > 400 && metres(a.id, n.id) < 900 && !roads.links.some((l) => l.from === a.id && l.to === n.id))
    if (!b) continue
    found++
    const length = Math.round(metres(a.id, b.id) * 1.2)
    out.push({
      name: `new road ${a.id}–${b.id}, ${length} m`, kind: 'road', sign: 1,
      apply: (s) => {
        const links = s.roads.links.map((l) => ({ ...l }))
        for (const [from, to] of [[a.id, b.id], [b.id, a.id]] as const) {
          links.push({ id: links.length, from, to, length, lanes: 1, kind: 'secondary', speed: 30, capacity: 1100, signals: 0, drawn: [], forward: [] })
        }
        return { ...s, roads: { ...s.roads, links } }
      },
    })
  }
  // Signals at a junction without them: its links in get a signal and a tenth more room.
  const plain = roads.nodes.filter((n) => !n.signal && !n.gateway && roads.links.filter((l) => l.to === n.id && l.kind !== 'tertiary').length >= 3)
  for (let k = 0; k < 4; k++) {
    const n = plain[Math.floor(((k + 0.5) * plain.length) / 4)]!
    out.push({
      name: `signals at junction ${n.id}`, kind: 'junction', sign: 1,
      apply: (s) => ({
        ...s,
        roads: {
          ...s.roads,
          nodes: s.roads.nodes.map((x) => (x.id === n.id ? { ...x, signal: true, work: 'signal' as const } : x)),
          links: s.roads.links.map((l) => (l.to === n.id ? { ...l, signals: (l.signals ?? 0) + 1, capacity: Math.round(l.capacity * 1.1) } : l)),
        },
      }),
    })
  }
  // Bus lanes on a short stretch of a road of two lanes or more.
  for (let k = 0; k < 5; k++) {
    const ids = stretchFrom(roads, pick(k + 0.45, 5), 3).filter((id) => roads.links[id]!.lanes > 1)
    out.push({ name: `bus lanes on ${ids.length} links at ${ids[0]}`, kind: 'busLane', sign: 1, apply: (s) => ({ ...s, busLanes: [...(s.busLanes ?? []), ...ids] }) })
  }
  // A speed limit of 30 on a short stretch.
  for (let k = 0; k < 4; k++) {
    const ids = stretchFrom(roads, pick(k + 0.2, 4), 3)
    out.push({ name: `30 km/h on ${ids.length} links at ${ids[0]}`, kind: 'limit', sign: 1, apply: (s) => ({ ...s, limits: { ...(s.limits ?? {}), ...Object.fromEntries(ids.map((id) => [id, 30])) } }) })
  }
  return out
}

/**
 * Changes too small to matter: a fifth of a point of condition on one busy link, 30 links spread over the city. The
 * true effect of each on the city is a few hundredths of a second: whatever else they move is noise.
 */
export function hairs(base: CityState, busy: MonthResult): Change[] {
  const roads = base.roads
  const ids = roads.links
    .filter((l) => l.from !== l.to && l.kind !== 'tertiary' && (busy.flow.morning[l.id] ?? 0) > 1500)
    .map((l) => l.id)
  const out: Change[] = []
  for (let k = 0; k < 30; k++) {
    const id = ids[Math.floor(((k + 0.5) * ids.length) / 30)]!
    out.push({
      name: `link ${id} surface +0.2`, kind: 'hair', sign: 1,
      apply: (s) => {
        const surface = [...(s.surface ?? roads.links.map(() => 100))]
        surface[id] = Math.min(100, (surface[id] ?? 100) + 0.2)
        return { ...s, surface }
      },
    })
  }
  return out
}

/** Clean trips: bus, metro, rail, cycle and walking, as a share of all, in thousandths. */
export function clean(r: MonthResult): number {
  const t = r.trips
  const all = t.car + t.twoWheeler + t.auto + t.bus + t.metro + t.rail + t.cycle + t.walk
  return ((t.bus + t.metro + t.rail + t.cycle + t.walk) * 1000) / all
}

export interface Effect {
  change: Change
  commute: number
  access: number
  deaths: number
  clean: number
}

export function measure(sim: Sim, base: CityState, list: Change[]): { r0: MonthResult; effects: Effect[] } {
  const r0 = sim(base)
  const effects = list.map((change) => {
    const r = sim(change.apply(base))
    return {
      change,
      commute: (r.commute - r0.commute) / 60,
      access: (r.access - r0.access) / 10,
      deaths: (r.deaths ?? 0) - (r0.deaths ?? 0),
      clean: (clean(r) - clean(r0)) / 10,
    }
  })
  return { r0, effects }
}

/** For each figure: the size of the change at the 50th, 90th and largest; and how many went the wrong way, and the largest of those. */
export function spread(effects: Effect[]) {
  // Better is: a shorter commute, more access, fewer deaths, more clean trips.
  const figures: [keyof Omit<Effect, 'change'>, number, string][] = [['commute', -1, 'min'], ['access', 1, 'points of %'], ['deaths', -1, 'a year'], ['clean', 1, 'points of %']]
  return figures.map(([key, better, unit]) => {
    const sizes = effects.map((e) => Math.abs(e[key])).sort((a, b) => a - b)
    const q = (p: number) => sizes[Math.min(sizes.length - 1, Math.floor(p * sizes.length))]!
    const wrong = effects.filter((e) => e[key] * better * e.change.sign < 0 && e.change.kind !== 'limit' && e.change.kind !== 'busLane')
    const worst = Math.max(0, ...wrong.map((e) => Math.abs(e[key])))
    return { key, unit, median: q(0.5), p90: q(0.9), most: sizes.at(-1)!, wrong: wrong.length, worstWrong: worst }
  })
}

async function main() {
  const sim: Sim = live
  const base = january()
  const list = changes(base)
  const t0 = performance.now()
  const { r0, effects } = measure(sim, base, list)
  console.log(`January 2026 as the season starts: commute ${(r0.commute / 60).toFixed(2)} min, access ${(r0.access / 10).toFixed(1)}%, deaths ${r0.deaths}, clean ${(clean(r0) / 10).toFixed(2)}%; ${list.length} changes in ${((performance.now() - t0) / 1000).toFixed(0)} s`)
  if (process.argv.includes('--list')) {
    for (const e of effects) {
      console.log(`  ${e.change.kind.padEnd(9)} ${e.change.name.padEnd(46)} commute ${e.commute >= 0 ? '+' : ''}${e.commute.toFixed(3)}  access ${e.access >= 0 ? '+' : ''}${e.access.toFixed(1)}  deaths ${e.deaths >= 0 ? '+' : ''}${e.deaths}  clean ${e.clean >= 0 ? '+' : ''}${e.clean.toFixed(3)}`)
    }
  }
  for (const s of spread(effects)) {
    console.log(`${s.key.padEnd(8)} (${s.unit}): median ${s.median.toFixed(3)}, 90% ${s.p90.toFixed(3)}, largest ${s.most.toFixed(3)}; the wrong way ${s.wrong} of ${effects.length}, largest of those ${s.worstWrong.toFixed(3)}`)
  }
  const noise = measure(sim, base, hairs(base, r0)).effects
  console.log('\nthirty changes too small to matter (a fifth of a point of condition on one busy link): what they move')
  for (const s of spread(noise)) console.log(`${s.key.padEnd(8)} (${s.unit}): median ${s.median.toFixed(3)}, 90% ${s.p90.toFixed(3)}, largest ${s.most.toFixed(3)}`)
}

if (!process.env.NO_MAIN) void main()
