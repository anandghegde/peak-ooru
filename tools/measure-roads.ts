// What the road levers do in the model (slice 5): a flyover, a new road, twenty new links, a one-way street, work on a
// junction, footpaths, speed limits, fewer two-wheelers; each against the city of January 2026: commute, deaths, trips,
// vehicle-km, and the time a month takes. Slice 6: `repair`, what mending roads and streets is worth;
// `flood`, low-lying roads shut. The city is January 2026 with its roads as the first season starts them (--perfect: all
// at 100).
//   npx vite-node tools/measure-roads.ts            every case
//   npx vite-node tools/measure-roads.ts flyover    one case, or several, by name
import { readFileSync } from 'node:fs'
import type { Transit, Zone } from '../src/data/types'
import { rules } from '../src/rules/index'
import { firstSeason } from '../src/seasons/first'
import { toKm } from '../src/sim/graph'
import { LOWLAND, UNDERPASSES } from '../src/sim/lowland'
import { linkKmh, simulate, type MonthDetail } from '../src/sim/index'
import { PERIODS, type CityState, type RoutingLink, type RoutingNetwork, type RoutingNode } from '../src/sim/types'

const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../public/data/${file}`, import.meta.url), 'utf8')) as T

/** January 2026, its roads and streets as the first season starts them (slice 6; with --perfect, all at 100). */
export function january(): CityState {
  const city = { zones: read<Zone[]>('zones.json'), roads: read<RoutingNetwork>('routing.json'), transit: read<Transit>('transit.json') }
  const state: CityState = { month: 0, seed: 1, ...city }
  if (process.argv.includes('--perfect')) return state
  const s = rules.state(rules.start(firstSeason, city), city)
  return { ...state, surface: s.surface, streets: s.streets }
}

/** The junction nearest a place. */
function nodeAt(roads: RoutingNetwork, lat: number, lng: number): number {
  const p = new Float64Array(2)
  const q = new Float64Array(2)
  toKm(lng, lat, p, 0)
  let best = -1
  let near = Infinity
  for (const n of roads.nodes) {
    if (n.gateway) continue
    toKm(n.at[0] / 1e6, n.at[1] / 1e6, q, 0)
    const d = (p[0]! - q[0]!) ** 2 + (p[1]! - q[1]!) ** 2
    if (d < near) {
      near = d
      best = n.id
    }
  }
  return best
}

function metres(roads: RoutingNetwork, a: number, b: number): number {
  const p = new Float64Array(2)
  const q = new Float64Array(2)
  toKm(roads.nodes[a]!.at[0] / 1e6, roads.nodes[a]!.at[1] / 1e6, p, 0)
  toKm(roads.nodes[b]!.at[0] / 1e6, roads.nodes[b]!.at[1] / 1e6, q, 0)
  return Math.round(Math.sqrt((p[0]! - q[0]!) ** 2 + (p[1]! - q[1]!) ** 2) * 1000)
}

/** A copy of the network, as the rules make one: nodes and links copied, new links appended both ways. */
function copy(roads: RoutingNetwork): { nodes: RoutingNode[]; links: RoutingLink[]; zoneNode: number[] } {
  return { nodes: roads.nodes.map((n) => ({ ...n })), links: roads.links.map((l) => ({ ...l })), zoneNode: roads.zoneNode }
}

function addRoad(roads: RoutingNetwork, nodes: number[], lanes: number, flyover: boolean): { roads: RoutingNetwork; added: number[] } {
  const out = copy(roads)
  const added: number[] = []
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1]!
    const b = nodes[i]!
    const length = Math.max(1, metres(roads, a, b))
    for (const [from, to] of [[a, b], [b, a]] as const) {
      added.push(out.links.length)
      out.links.push({
        id: out.links.length, from, to, length, lanes,
        kind: flyover ? 'trunk' : 'primary', speed: flyover ? 60 : 50, capacity: lanes * 1290,
        signals: flyover ? 0 : out.nodes[to]!.signal ? 1 : 0, drawn: [], forward: [],
      })
    }
  }
  return { roads: out, added }
}

interface Figures {
  commute: number
  deaths: number
  parts: string
  car: number
  tw: number
  walk: number
  metro: number
  vkm: number
  took: number
}

function figures(state: CityState, r: MonthDetail): Figures {
  let vkm = 0
  for (const p of PERIODS) {
    const hours = { morning: 3, midday: 5, evening: 2.5, night: 10 }[p]
    for (const l of state.roads.links) vkm += (r.flow[p][l.id]! * hours * l.length) / 1000
  }
  return {
    commute: r.commute / 60,
    deaths: r.deaths ?? 0,
    parts: `${r.deathsBy.walk}/${r.deathsBy.twoWheeler}/${r.deathsBy.other}`,
    car: r.trips.car,
    tw: r.trips.twoWheeler,
    walk: r.trips.walk,
    metro: r.trips.metro,
    vkm,
    took: r.took,
  }
}

function show(name: string, f: Figures, b: Figures, extra = '') {
  const pc = (x: number, y: number) => `${x - y >= 0 ? '+' : ''}${((100 * (x - y)) / y).toFixed(2)}%`
  console.log(
    `${name.padEnd(44)} commute ${f.commute.toFixed(2)} (${(f.commute - b.commute).toFixed(2)})  deaths ${f.deaths} (${f.deaths - b.deaths >= 0 ? '+' : ''}${f.deaths - b.deaths}; ${f.parts})  ` +
      `car ${pc(f.car, b.car)} 2w ${pc(f.tw, b.tw)} walk ${pc(f.walk, b.walk)} metro ${pc(f.metro, b.metro)}  vehicle-km ${pc(f.vkm, b.vkm)}  ${extra}`,
  )
}

/** Km/h at the peaks, vehicle-km over vehicle-hours, on the links given. */
function speedOn(state: CityState, r: MonthDetail, links: number[], periods = ['morning', 'evening'] as const): number {
  let km = 0, h = 0
  for (const id of links) {
    const l = state.roads.links[id]!
    if (l.from === l.to) continue
    for (const p of periods) {
      const k = (r.flow[p][id]! * l.length) / 1000 + 1e-9
      km += k
      h += k / linkKmh(state.roads, r, p, l)
    }
  }
  return km / h
}

/** Links within `m` metres of a node. */
function linksNear(roads: RoutingNetwork, node: number, m: number): number[] {
  return roads.links.filter((l) => l.from !== l.to && (metres(roads, l.from, node) < m || metres(roads, l.to, node) < m)).map((l) => l.id)
}

function main() {
  const want = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const on = (name: string) => want.length === 0 || want.includes(name)
  const base = january()
  simulate(base)
  const r0 = simulate(base)
  const b = figures(base, r0)
  console.log(`January 2026: commute ${b.commute.toFixed(2)} min, deaths ${b.deaths} a year (on foot/two-wheeler/other ${b.parts}), ${r0.took.toFixed(0)} ms`)

  // Silk Board: a flyover carrying the Outer Ring Road over the junction, where its queues are, 2 lanes each way.
  if (on('flyover')) {
    const sb = nodeAt(base.roads, 12.9172, 77.6227)
    const ends = base.roads.links.filter((l) => l.to === sb && l.kind === 'trunk' && l.lanes === 3).map((l) => l.from)
    const { roads, added } = addRoad(base.roads, ends, 2, true)
    const s = { ...base, roads }
    const r = simulate(s)
    const near = linksNear(base.roads, sb, 1500)
    const into = base.roads.links.filter((l) => l.to === sb).map((l) => l.id)
    const on = added.reduce((x, id) => x + r.flow.evening[id]!, 0) / added.length
    show(`flyover, ORR over Silk Board, ${(metres(base.roads, ends[0]!, ends[1]!) / 1000).toFixed(1)} km, 2 lanes each way`, figures(s, r), b,
      `carries ${on.toFixed(0)} veh/h each way at the evening peak; roads into the junction ${speedOn(base, r0, into).toFixed(1)} -> ${speedOn(s, r, into).toFixed(1)} km/h, ` +
        `within 1.5 km ${speedOn(base, r0, near).toFixed(1)} -> ${speedOn(s, r, near).toFixed(1)}`)
  }

  // A new road on the ground, 2 lanes each way, where there is none: Hennur Road to Thanisandra, across the gap.
  if (on('road')) {
    const a = nodeAt(base.roads, 13.0358, 77.6433)
    const c = nodeAt(base.roads, 13.0600, 77.6300)
    const { roads, added } = addRoad(base.roads, [a, c], 2, false)
    const s = { ...base, roads }
    const r = simulate(s)
    const on = added.reduce((x, id) => x + r.flow.evening[id]!, 0) / added.length
    show(`new road, ${(metres(base.roads, a, c) / 1000).toFixed(1)} km, 2 lanes each way`, figures(s, r), b, `carries ${on.toFixed(0)} veh/h each way at the evening peak`)
  }

  // Twenty new links: ten short roads both ways between junctions 1 to 2 km apart, spread over the city; and the time.
  if (on('twenty')) {
    let roads: RoutingNetwork = base.roads
    const picked: number[] = []
    for (let k = 0; picked.length < 10 && k < base.roads.nodes.length; k += 97) {
      const a = base.roads.nodes[k]!
      if (a.gateway) continue
      const c = base.roads.nodes.find((n) => !n.gateway && n.id !== a.id && metres(base.roads, a.id, n.id) > 1000 && metres(base.roads, a.id, n.id) < 2000)
      if (!c) continue
      roads = addRoad(roads, [a.id, c.id], 1, false).roads
      picked.push(a.id)
    }
    const s = { ...base, roads }
    const t0: number[] = []
    const t1: number[] = []
    for (let k = 0; k < 5; k++) {
      t0.push(simulate(base).took)
      t1.push(simulate(s).took)
    }
    const med = (t: number[]) => [...t].sort((x, y) => x - y)[2]!
    show(`twenty new links (${roads.links.length - base.roads.links.length})`, figures(s, simulate(s)), b, `month ${med(t0).toFixed(0)} -> ${med(t1).toFixed(0)} ms (median of 5)`)
  }

  // One-way: a stretch of a secondary road made one-way, the other direction shut (as the rules shut it).
  if (on('oneway')) {
    const out = copy(base.roads)
    const l = out.links.find((x) => x.kind === 'secondary' && x.lanes === 1 && out.links.some((y) => y.from === x.to && y.to === x.from))!
    const back = out.links.find((y) => y.from === l.to && y.to === l.from)!
    l.lanes += back.lanes
    l.capacity += back.capacity
    back.to = back.from
    const s = { ...base, roads: out }
    const r = simulate(s)
    show(`one-way: link ${l.id} (${l.kind}), ${back.id} shut`, figures(s, r), b, `flow ${r0.flow.evening[l.id]} -> ${r.flow.evening[l.id]} veh/h; shut link ${r.flow.evening[back.id]}`)
  }

  // Junction work at Silk Board: signals, redesign, and the main road lifted over it.
  if (on('junction')) {
    const n = nodeAt(base.roads, 12.9172, 77.6227)
    const near = linksNear(base.roads, n, 800)
    for (const work of ['signal', 'redesign', 'overpass'] as const) {
      const out = copy(base.roads)
      const node = out.nodes[n] as RoutingNode & { work?: string }
      const into = out.links.filter((l) => l.to === n)
      if (work !== 'overpass' && !node.signal) {
        node.signal = true
        for (const l of into) l.signals = (l.signals ?? 0) + 1
      }
      const factor = { signal: 1.1, redesign: 1.25, overpass: 1 }[work]
      for (const l of into) l.capacity = Math.round(l.capacity * factor)
      if (work === 'overpass') {
        const main = [...into].sort((x, y) => y.capacity - x.capacity)[0]!
        main.capacity = Math.round(main.capacity * 1.6)
        if ((main.signals ?? 0) > 0) main.signals = main.signals! - 1
      }
      node.work = work
      const s = { ...base, roads: out }
      const r = simulate(s)
      show(`junction at Silk Board: ${work}`, figures(s, r), b, `peak km/h within 800 m ${speedOn(base, r0, near).toFixed(1)} -> ${speedOn(s, r, near).toFixed(1)}`)
    }
  }

  // Zones where most are killed on foot, and where most are killed at all.
  const byZone = [...r0.deathsByZone!].map((d, z) => [d, z] as const).sort((x, y) => y[0] - x[0] || x[1] - y[1])
  const worst = byZone.slice(0, 20).map(([, z]) => z)
  if (on('zones')) {
    console.log('\nzones with the most deaths a year:')
    for (const [d, z] of byZone.slice(0, 12)) console.log(`  ${base.zones[z]!.name.padEnd(28)} ${d}  (${(base.zones[z]!.people / 1000).toFixed(0)} k people, ${base.zones[z]!.area.toFixed(1)} km²)`)
    const wards = base.zones.filter((z) => z.ward !== undefined).reduce((x, z) => x + r0.deathsByZone![z.id]!, 0)
    console.log(`  in the wards ${wards}, outside ${b.deaths - wards}`)
  }

  if (on('footpaths')) {
    const s = { ...base, footpaths: [...worst].sort((x, y) => x - y) }
    const r = simulate(s)
    const f = figures(s, r)
    const inZones = (res: MonthDetail) => worst.reduce((x, z) => x + res.deathsByZone![z]!, 0)
    show('footpaths in the 20 deadliest zones', f, b, `deaths there ${inZones(r0)} -> ${inZones(r)}`)
    const all = { ...base, footpaths: base.zones.map((z) => z.id) }
    show('footpaths everywhere', figures(all, simulate(all)), b)
  }

  if (on('limits')) {
    for (const limit of [30, 40, 50]) {
      const limits: Record<number, number> = {}
      const zoneOf = new Set(worst)
      const where = new Float64Array(2)
      const zxy = base.zones.map((z) => {
        const p = new Float64Array(2)
        toKm(z.centre[0], z.centre[1], p, 0)
        return p
      })
      let n = 0
      for (const l of base.roads.links) {
        if (l.kind === 'motorway' || l.speed <= limit) continue
        const a = base.roads.nodes[l.from]!.at
        toKm(a[0] / 1e6, a[1] / 1e6, where, 0)
        let best = 0, near = Infinity
        zxy.forEach((p, z) => {
          const d = (p[0]! - where[0]!) ** 2 + (p[1]! - where[1]!) ** 2
          if (d < near) {
            near = d
            best = z
          }
        })
        if (!zoneOf.has(best)) continue
        limits[l.id] = limit
        n++
      }
      const s = { ...base, limits }
      const r = simulate(s)
      const ids = Object.keys(limits).map(Number)
      show(`limit ${limit} km/h in the 20 deadliest zones (${n} links)`, figures(s, r), b,
        n ? `speed there: peaks ${speedOn(base, r0, ids).toFixed(1)} -> ${speedOn(s, r, ids).toFixed(1)}, night ${speedOn(base, r0, ids, ['night'] as never).toFixed(1)} -> ${speedOn(s, r, ids, ['night'] as never).toFixed(1)} km/h` : 'no road there runs faster')
    }
  }

  // More road, more driving: a lane more each way on every link of the Outer Ring Road (Hebbal to Silk Board round the
  // east), against the lane-km added; the vehicle-km that follow, on the ring road and in all.
  if (on('widen')) {
    const names = new Map(read<{ links: { id: number; name?: string }[] }>('network.json').links.map((l) => [l.id, l.name ?? '']))
    const out = copy(base.roads)
    const ring = out.links.filter((l) => l.drawn.some((d) => /Outer Ring Road/.test(names.get(d) ?? '')))
    let laneKm = 0, addKm = 0
    for (const l of base.roads.links) laneKm += (l.lanes * l.length) / 1000
    for (const l of ring) {
      l.capacity = Math.round((l.capacity * (l.lanes + 1)) / l.lanes)
      l.lanes += 1
      addKm += l.length / 1000
    }
    const s = { ...base, roads: out }
    const r = simulate(s)
    const f = figures(s, r)
    const ids = ring.map((l) => l.id)
    const vkmOn = (x: MonthDetail) => ids.reduce((a, id) => a + PERIODS.reduce((q, p) => q + (x.flow[p][id]! * { morning: 3, midday: 5, evening: 2.5, night: 10 }[p] * base.roads.links[id]!.length) / 1000, 0), 0)
    show(`a lane more each way on the Outer Ring Road (${ring.length} links)`, f, b,
      `lane-km +${((100 * addKm) / laneKm).toFixed(2)}%; ring road vehicle-km ${((100 * (vkmOn(r) - vkmOn(r0))) / vkmOn(r0)).toFixed(1)}%, peak speed ${speedOn(base, r0, ids).toFixed(1)} -> ${speedOn(s, r, ids).toFixed(1)} km/h; ` +
        `elasticity of all vehicle-km to lane-km ${(((f.vkm - b.vkm) / b.vkm) / (addKm / laneKm)).toFixed(2)}`)
  }

  // Slice 6: what repair is worth. The city with every road at 100, 60 and 40; the Outer Ring Road alone from 40 to 100
  // (the rest at 100, and again with the rest at 60); an empty road from 40 to 100; a zone's streets from 30 to 90.
  if (on('repair')) repair(base, r0)

  // Slice 6: floods. The low-lying links (src/sim/lowland.ts) shut for a share of the month, and the underpasses alone.
  if (on('flood')) {
    const vehOn = (r: MonthDetail, ids: readonly number[]) => ids.reduce((a, id) => a + r.vehiclesByLink![id]!, 0)
    for (const [name, ids, share] of [['underpasses', UNDERPASSES, 300], ['every low-lying link', LOWLAND, 100], ['every low-lying link', LOWLAND, 300]] as const) {
      const shut: Record<number, number> = {}
      for (const id of ids) shut[id] = share
      const s = { ...base, shut }
      const r = simulate(s)
      show(`${name} (${ids.length}) shut ${share / 10}% of the month`, figures(s, r), b,
        `vehicles a weekday on them ${(vehOn(r0, ids) / 1e6).toFixed(2)} M -> ${(vehOn(r, ids) / 1e6).toFixed(2)} M; ${r.took.toFixed(0)} ms`)
    }
  }

  if (on('twowheelers')) {
    const s = { ...base, ownership: { car: 1000, twoWheeler: 800 } }
    show('a fifth fewer two-wheelers to hand', figures(s, simulate(s)), b)
  }
}

/** Km/h at the peaks on the links given, and vehicles a weekday on them (the average link). */
function roadFigures(state: CityState, r: MonthDetail, ids: number[]): string {
  const veh = ids.reduce((a, id) => a + (r.vehiclesByLink?.[id] ?? 0), 0) / ids.length
  return `${speedOn(state, r, ids).toFixed(1)} km/h at the peaks, ${(veh / 1000).toFixed(1)} k vehicles a weekday`
}

/** Commute of the zones given, weighted by their people, in minutes; and their deaths a year. */
function zoneFigures(state: CityState, r: MonthDetail, zones: number[]): { commute: number; deaths: number } {
  let p = 0, c = 0, d = 0
  for (const z of zones) {
    const people = state.zones[z]!.people
    p += people
    c += people * r.commuteByZone[z]!
    d += r.deathsByZone![z]!
  }
  return { commute: c / p / 60, deaths: d }
}

/**
 * The cost of running buses, as an index: bus-km a weekday weighted by what each grade adds to a bus's running cost
 * (good 0, fair +2%, poor +5%, broken +10%: see docs/MODEL.md, "Slice 6").
 */
function busCost(r: MonthDetail): string {
  const k = r.busKmByGrade ?? [0, 0, 0, 0]
  const extra = 0.02 * k[1] + 0.05 * k[2] + 0.1 * k[3]
  const all = k[0] + k[1] + k[2] + k[3]
  return `bus-km ${(all / 1000).toFixed(0)} k (poor or broken ${((k[2] + k[3]) / 1000).toFixed(0)} k), running cost +${((100 * extra) / all).toFixed(1)}%`
}

function repair(base: CityState, r0: MonthDetail) {
  const L = base.roads.links.length
  const at = (c: number) => new Array<number>(L).fill(c)
  const start = base.surface ?? at(100)
  console.log('\nwhat repair is worth (surface 0 to 100 on every routing link; streets by zone):')
  const main = base.roads.links.filter((l) => l.kind === 'motorway' || l.kind === 'trunk' || l.kind === 'primary').map((l) => l.id)
  for (const [name, c] of [['every road and street at 100', 100], ['every road and street at 60 (fair)', 60], ['every road and street at 40 (poor)', 40]] as const) {
    const s = { ...base, surface: at(c), streets: base.zones.map(() => c) }
    const r = simulate(s)
    show(name, figures(s, r), figures(base, r0), `main roads ${speedOn(s, r, main).toFixed(1)} km/h at the peaks (${speedOn(base, r0, main).toFixed(1)} as it starts); ${busCost(r)} (${busCost(r0)})`)
  }

  // The Outer Ring Road: every link standing for a stretch of it; the zones whose centre is within 1.5 km of it.
  const names = new Map(read<{ links: { id: number; name?: string }[] }>('network.json').links.map((l) => [l.id, l.name ?? '']))
  const ring = base.roads.links.filter((l) => l.drawn.some((d) => /Outer Ring Road/.test(names.get(d) ?? ''))).map((l) => l.id)
  const along = zonesNear(base, ring, 1.5)
  for (const [label, rest] of [['as the season starts', start], ['at 100', at(100)]] as const) {
    const bad = [...rest]
    for (const id of ring) bad[id] = 40
    const good = [...rest]
    for (const id of ring) good[id] = 100
    const sb = { ...base, surface: bad }
    const sg = { ...base, surface: good }
    const rb = simulate(sb)
    const rg = simulate(sg)
    const zb = zoneFigures(base, rb, along)
    const zg = zoneFigures(base, rg, along)
    const fb = figures(sb, rb)
    const lost = ring.reduce((a, id) => a + (rb.surfaceDelay?.[id] ?? 0), 0)
    console.log(`Outer Ring Road (${ring.length} links, ${along.length} zones within 1.5 km), the rest ${label}: 40 -> 100`)
    show('  ring road at 40', fb, figures(base, r0), `the road: ${roadFigures(base, rb, ring)}, ${(lost / 60).toFixed(0)} vehicle-hours a weekday lost to its surface; zones along it ${zb.commute.toFixed(2)} min, deaths ${zb.deaths}; ${busCost(rb)}`)
    show('  ring road at 100', figures(sg, rg), fb, `the road: ${roadFigures(base, rg, ring)}; zones along it ${zg.commute.toFixed(2)} min, deaths ${zg.deaths}; ${busCost(rg)}`)
  }

  // A quiet road: the main-road links (secondary and above, not the ring road) carrying least of those with 1,000
  // vehicles a weekday or more, as many as the ring road has, taken from 40 to 100 with the rest as the season starts.
  const quiet = base.roads.links
    .filter((l) => l.from !== l.to && l.kind !== 'tertiary' && !ring.includes(l.id) && r0.vehiclesByLink![l.id]! >= 1000)
    .sort((a, b) => (r0.vehiclesByLink![a.id]! - r0.vehiclesByLink![b.id]!) || a.id - b.id)
    .slice(0, ring.length)
    .map((l) => l.id)
  {
    const bad = [...start]
    for (const id of quiet) bad[id] = 40
    const good = [...start]
    for (const id of quiet) good[id] = 100
    const sb = { ...base, surface: bad }
    const sg = { ...base, surface: good }
    const rb = simulate(sb)
    const rg = simulate(sg)
    console.log(`the ${quiet.length} quietest main-road links with 1,000 vehicles a weekday or more: 40 -> 100`)
    show('  at 40', figures(sb, rb), figures(base, r0), `those links: ${roadFigures(base, rb, quiet)}`)
    show('  at 100', figures(sg, rg), figures(sb, rb), `those links: ${roadFigures(base, rg, quiet)}`)
  }

  // A zone's streets from 30 to 90, the rest as the season starts: a busy ward in the east, and the largest zone
  // beyond the wards.
  const picks = [base.zones.find((z) => z.name === 'Marathahalli')!, [...base.zones].filter((z) => z.ward === undefined).sort((a, b) => b.people - a.people)[0]!]
  for (const z of picks) {
    const street = (c: number) => base.zones.map((x) => (x.id === z.id ? c : base.streets?.[x.id] ?? 100))
    const s30 = { ...base, streets: street(30) }
    const s90 = { ...base, streets: street(90) }
    const r30 = simulate(s30)
    const r90 = simulate(s90)
    const zc = (r: MonthDetail) => r.commuteByZone[z.id]! / 60
    console.log(`streets of ${z.name} (${(z.people / 1000).toFixed(0)} k people; ${base.streets?.[z.id] ?? 100} as the season starts): 30 -> 90`)
    show('  at 30', figures(s30, r30), figures(base, r0), `the zone's commute ${zc(r30).toFixed(2)} min, deaths ${r30.deathsByZone![z.id]}`)
    show('  at 90', figures(s90, r90), figures(s30, r30), `the zone's commute ${zc(r90).toFixed(2)} min, deaths ${r90.deathsByZone![z.id]}`)
  }
}

/** Zones whose centre is within `km` of the middle of any of the links given. */
function zonesNear(state: CityState, ids: number[], km: number): number[] {
  const p = new Float64Array(2)
  const q = new Float64Array(2)
  const mids = ids.map((id) => {
    const l = state.roads.links[id]!
    const a = state.roads.nodes[l.from]!.at
    const b = state.roads.nodes[l.to]!.at
    toKm((a[0] + b[0]) / 2e6, (a[1] + b[1]) / 2e6, q, 0)
    return [q[0]!, q[1]!] as const
  })
  return state.zones
    .filter((z) => {
      toKm(z.centre[0], z.centre[1], p, 0)
      return mids.some(([x, y]) => (x - p[0]!) ** 2 + (y - p[1]!) ** 2 < km * km)
    })
    .map((z) => z.id)
}

if (!process.env.NO_MAIN) main()
