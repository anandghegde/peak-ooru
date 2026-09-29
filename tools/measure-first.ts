// Slice 9, job 2: what each cheap first act does to the score within the first year. Each act is done in January
// 2026 (month 0) and nothing else; the game is played 12 months and compared with doing nothing after 3, 6 and 12
// months: the score, and each measure's points (tenths shown as points) and figure.
//   npx vite-node tools/measure-first.ts [--months=12] [--only=name,name]
import { readFileSync } from 'node:fs'
import type { Transit, Zone } from '../src/data/types'
import { rules } from '../src/rules/index'
import { MEASURES, averageOf } from '../src/rules/score'
import type { Action, CityData, Game, Plan } from '../src/rules/types'
import { firstSeason } from '../src/seasons/first'
import { simulate } from '../src/sim/index'
import type { MonthResult, RoutingNetwork } from '../src/sim/types'
import { namedRoads } from '../src/rules/upkeep'
import { roadIndex, micro } from '../src/rules/geo'

const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../public/data/${file}`, import.meta.url), 'utf8')) as T
const city: CityData = { zones: read<Zone[]>('zones.json'), roads: read<RoutingNetwork>('routing.json'), transit: read<Transit>('transit.json') }

/** The `n` named roads whose poor or broken stretches cost most time, by the model's `surfaceDelay`, as link lists. */
export function worstRoadLinks(game: Game, result: MonthResult, n: number): number[][] {
  const delay = (result as MonthResult & { surfaceDelay?: Int32Array }).surfaceDelay
  if (!delay) return []
  const named = namedRoads(city)
  const by = new Map<number, { links: number[]; lost: number }>()
  for (const l of city.roads.links) {
    if ((game.condition?.[l.id] ?? 100) >= 50 || !(delay[l.id]! > 0)) continue
    const k = named.road[l.id]!
    const r = by.get(k) ?? { links: [], lost: 0 }
    r.links.push(l.id)
    r.lost += delay[l.id]!
    by.set(k, r)
  }
  return [...by.values()].sort((a, b) => b.lost - a.lost).slice(0, n).map((r) => r.links.sort((a, b) => a - b))
}

/** Bus lanes on every stretch of two lanes or more along a planned bus route's path. */
function lanesAlong(path: number[]): number[] {
  const ix = roadIndex(city.roads)
  const n = city.roads.nodes.length
  const byAt = new Map(city.roads.nodes.map((node) => [`${node.at[0]},${node.at[1]}`, node.id]))
  const nodes: (number | undefined)[] = []
  for (let i = 0; i + 1 < path.length; i += 2) nodes.push(byAt.get(`${micro(path[i]!)},${micro(path[i + 1]!)}`))
  const out = new Set<number>()
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1]
    const b = nodes[i]
    if (a === undefined || b === undefined) continue
    for (const id of [ix.between.get(a * n + b), ix.between.get(b * n + a)]) if (id !== undefined && city.roads.links[id]!.lanes >= 2) out.add(id)
  }
  return [...out].sort((a, b) => a - b)
}

type Acts = (g: Game, first: MonthResult) => Action[]
const build = (plan: Plan): Action => ({ kind: 'build', plan })

const ACTS: Record<string, Acts> = {
  nothing: () => [],
  'patch worst road': (g, r) => worstRoadLinks(g, r, 1).map((links) => build({ kind: 'repair', links, work: 'patch' })),
  'resurface worst road': (g, r) => worstRoadLinks(g, r, 1).map((links) => build({ kind: 'repair', links, work: 'resurface' })),
  'patch ten worst': (g, r) => [build({ kind: 'repair', links: worstRoadLinks(g, r, 10).flat().sort((a, b) => a - b), work: 'patch' })],
  'resurface ten worst': (g, r) => [build({ kind: 'repair', links: worstRoadLinks(g, r, 10).flat().sort((a, b) => a - b), work: 'resurface' })],
  'bus route': (g) => rules.suggest(g, city, 'busRoute').slice(0, 1).map(build),
  'bus route + lanes': (g) => {
    const plan = rules.suggest(g, city, 'busRoute')[0]
    if (!plan) return []
    const q = rules.quote(g, city, plan)
    return [build(plan), build({ kind: 'busLane', links: lanesAlong(q.path) })]
  },
  'bus lanes only': (g) => {
    const plan = rules.suggest(g, city, 'busRoute')[0]
    if (!plan) return []
    return [build({ kind: 'busLane', links: lanesAlong(rules.quote(g, city, plan).path) })]
  },
  'footpaths one zone': (g, r) => {
    const by = r.deathsByZone
    const zones = city.zones.filter((z) => z.ward && z.people > 0).map((z) => z.id)
    zones.sort((a, b) => (by?.[b] ?? 0) - (by?.[a] ?? 0) || a - b)
    for (const zone of zones) if (rules.quote(g, city, { kind: 'footpaths', zone }).ok) return [build({ kind: 'footpaths', zone })]
    return []
  },
  'bus fare cut 20%': () => [{ kind: 'fare', mode: 'bus', perKm: 130 }],
  'metro fare cut 20%': () => [{ kind: 'fare', mode: 'metro', perKm: 360 }],
  'intro: patch worst + bus route': (g, r) => [...ACTS['patch worst road']!(g, r), ...ACTS['bus route']!(g, r)],
  'intro: resurface worst + bus route': (g, r) => [...ACTS['resurface worst road']!(g, r), ...ACTS['bus route']!(g, r)],
}

function main() {
  const args = process.argv.slice(2)
  const months = Number(args.find((a) => a.startsWith('--months='))?.slice(9) ?? 12)
  const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',')
  const at = [3, 6, 12].filter((m) => m <= months)
  const first = simulate(rules.state(rules.start(firstSeason, city), city))
  const rows: { name: string; told: string; by: Map<number, { total: number; points: number[]; avg: number[] }> }[] = []
  const t0 = performance.now()
  for (const [name, acts] of Object.entries(ACTS)) {
    if (only && name !== 'nothing' && !only.includes(name)) continue
    const g = rules.start(firstSeason, city)
    const told: string[] = []
    for (const a of acts(g, first)) {
      const q = a.kind === 'build' ? rules.quote(g, city, a.plan) : null
      const o = rules.act(g, city, a)
      told.push(o.ok ? (q && a.kind === 'build' ? `${a.plan.kind} ₹${(q.cost / 100).toFixed(1)} cr, ${q.months} mo, ${(q.length / 1000).toFixed(1)} km` : `${a.kind}`) : `REFUSED ${o.reason}`)
    }
    const by = new Map<number, { total: number; points: number[]; avg: number[] }>()
    while (g.month < months) {
      rules.endMonth(g, city, simulate(rules.state(g, city)))
      if (at.includes(g.month)) {
        by.set(g.month, {
          total: g.score!.total,
          points: g.score!.measures.map((m) => m.points),
          avg: MEASURES.map((k) => averageOf(g.measured ?? [], k)),
        })
      }
    }
    rows.push({ name, told: told.join('; '), by })
    console.error(`  played ${name} (${((performance.now() - t0) / 1000).toFixed(0)} s)`)
  }
  const base = rows.find((r) => r.name === 'nothing')!
  console.log('The score after 3, 6 and 12 months, and against doing nothing; each measure\'s points against doing nothing at 12')
  console.log('(access, commute, clean, safety, fairness, money, approval; tenths of a point, so 10 is a point of the measure)')
  for (const r of rows) {
    const cells = at.map((m) => {
      const x = r.by.get(m)!
      const d = x.total - base.by.get(m)!.total
      return `${String(x.total).padStart(4)} (${d >= 0 ? '+' : ''}${d})`
    })
    const last = r.by.get(at.at(-1)!)!
    const b = base.by.get(at.at(-1)!)!
    const dp = last.points.map((p, k) => p - b.points[k]!)
    console.log(`  ${r.name.padEnd(36)} ${cells.join('  ')}   [${dp.map((d) => String(d).padStart(5)).join('')}]   ${r.told}`)
  }
  console.log('\nEach measure\'s points against doing nothing after 3, 6 and 12 months (tenths)')
  for (const r of rows) {
    const cells = at.map((m) => `[${r.by.get(m)!.points.map((p, k) => String(p - base.by.get(m)!.points[k]!).padStart(5)).join('')}]`)
    console.log(`  ${r.name.padEnd(36)} ${cells.join(' ')}`)
  }
  console.log('\nThe figures scored after 12 months against doing nothing (access ‰, commute s, clean ‰, deaths/10M, fairness ‰, money lakh, approval tenths)')
  for (const r of rows) {
    const x = r.by.get(at.at(-1)!)!.avg
    const b = base.by.get(at.at(-1)!)!.avg
    console.log(`  ${r.name.padEnd(36)} ${x.map((v, k) => `${v - b[k]! >= 0 ? '+' : ''}${v - b[k]!}`.padStart(8)).join('')}`)
  }
}

main()
