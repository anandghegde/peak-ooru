// Slice 8 (B): whether the model and the rules can live for days in one process, as on the server, working out months
// for many players' cities in turn. Memory is read after a full collection every block of months; it must not grow.
//   npx vite-node tools/measure-long.ts [months]           the small city through the rules: many games in turn,
//                                                          each a different player, restarted every 30 months (10,000)
//   npx vite-node tools/measure-long.ts --real [months]    Bengaluru through the model, every month a different city:
//                                                          roads, surface, lanes, works, floods, lines, people (300)
import { readFileSync } from 'node:fs'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import type { Transit, TransitLine, Zone } from '../src/data/types'
import { gameDigest } from '../src/rules/digest'
import { rules } from '../src/rules/index'
import type { Action, Game, Season } from '../src/rules/types'
import { firstSeason } from '../src/seasons/first'
import { simulate } from '../src/sim/index'
import type { CityState, RoutingLink, RoutingNetwork } from '../src/sim/types'
import { smallCity, testSeason } from '../tests/rules-city'
import { loaded } from './measure-city'

setFlagsFromString('--expose_gc')
const gc = runInNewContext('gc') as () => void

function memory(): string {
  gc()
  gc()
  const m = process.memoryUsage()
  const mb = (x: number) => (x / 1e6).toFixed(1).padStart(6)
  return `heap ${mb(m.heapUsed)} MB, typed arrays ${mb(m.arrayBuffers)} MB, external ${mb(m.external)} MB, resident ${mb(m.rss)} MB`
}

/** A small generator of whole numbers, the same every run. */
function lcg(seed: number) {
  let s = seed >>> 0
  return (n: number) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s % n
  }
}

function small(months: number) {
  const city = smallCity()
  const season: Season = { ...testSeason, marks: firstSeason.marks, openings: [{ line: 'north-south', month: 4, stations: 3 }] }
  const twoLane = city.roads.links.filter((l) => l.lanes >= 2).map((l) => l.id)
  const at = (x: number, y: number) => ({ at: [77.55 + x / 108.48, 12.93 + y / 110.57] as [number, number] })
  const pick = lcg(7)
  /** Each player's actions for a month: different for every player and every game. */
  const actions = (player: number, g: Game): Action[] => {
    const r = (player * 7919 + g.month * 104729) % 97
    if (g.month === 0 && player % 3 === 0) return [{ kind: 'borrow', amount: 50_000 }, { kind: 'build', plan: { kind: 'metro', stops: [at(1, 8), at(6, 8.2), at(10, 8)] } }]
    if (g.month === 1 && player % 3 === 1) return [{ kind: 'build', plan: { kind: 'busRoute', stops: [at(1, 4), at(8, 4), { station: 3 }], buses: 4 + (player % 5) } }]
    if (r === 5) return [{ kind: 'build', plan: { kind: 'busLane', links: [twoLane[pick(twoLane.length)]!] } }]
    if (r === 11) return [{ kind: 'fare', mode: 'bus', perKm: 80 + pick(80) }]
    if (r === 17) return [{ kind: 'build', plan: { kind: 'footpaths', zone: city.zones[pick(city.zones.length)]!.id } }]
    if (r === 23) return [{ kind: 'upkeep', level: (['bare', 'steady', 'generous'] as const)[pick(3)]! }]
    return []
  }
  const players = 40
  const games: Game[] = Array.from({ length: players }, () => rules.start(season, city))
  const started = performance.now()
  console.log(`start: ${memory()}`)
  for (let m = 1; m <= months; m++) {
    const p = pick(players)
    let g = games[p]!
    if (g.status !== 'playing' || g.month >= 30) g = games[p] = rules.start(season, city)
    // As the server does: the game kept as JSON, loaded, a month ended, kept again.
    g = JSON.parse(JSON.stringify(g)) as Game
    for (const a of actions(p, g)) rules.act(g, city, a)
    rules.endMonth(g, city, simulate(rules.state(g, city)))
    gameDigest(g)
    g.reports = g.reports.slice(-1)
    games[p] = g
    if (m % 1000 === 0) console.log(`${String(m).padStart(6)} months (${((performance.now() - started) / m).toFixed(1)} ms each): ${memory()}`)
  }
}

const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../public/data/${file}`, import.meta.url), 'utf8')) as T

function real(months: number) {
  const base: CityState = { month: 0, seed: 1, zones: read<Zone[]>('zones.json'), roads: read<RoutingNetwork>('routing.json'), transit: read<Transit>('transit.json') }
  const pick = lcg(11)
  const L = base.roads.links.length
  const started = performance.now()
  console.log(`start: ${memory()}`)
  for (let m = 1; m <= months; m++) {
    // Every month a different city: some links added (as the player's roads add them), the surface, lanes, works,
    // floods, lines and people all different.
    const extra = pick(6)
    const links: RoutingLink[] = [...base.roads.links]
    for (let k = 0; k < extra; k++) {
      const l = base.roads.links[pick(L)]!
      links.push({ ...l, id: links.length, drawn: [] })
    }
    const state: CityState = {
      ...base,
      month: m % 120,
      roads: { ...base.roads, links },
      surface: Array.from({ length: links.length }, () => 30 + pick(71)),
      streets: base.zones.map(() => 40 + pick(61)),
      busLanes: Array.from({ length: pick(30) }, () => pick(L)),
      works: Array.from({ length: pick(12) }, () => pick(L)),
      shut: Object.fromEntries(Array.from({ length: pick(4) }, () => [pick(L), 100 + pick(900)])),
      zones: base.zones.map((z) => ({ ...z, people: Math.round(z.people * (0.95 + pick(20) / 100)) })),
      prices: { busPerKm: 1 + pick(3), metroPerKm: 2 + pick(3) },
    }
    const month = m % 3 === 0 ? loaded(state) : state
    if (m % 5 === 0) month.transit = { ...month.transit, lines: month.transit.lines.map((l): TransitLine => (l.kind === 'metro' ? { ...l, status: 'open' } : l)) }
    simulate(month)
    if (m % 25 === 0) console.log(`${String(m).padStart(6)} months (${((performance.now() - started) / m).toFixed(0)} ms each): ${memory()}`)
  }
}

const args = process.argv.slice(2)
const n = Number(args.find((a) => /^\d+$/.test(a)) ?? 0)
if (args.includes('--real')) real(n || 300)
else small(n || 10_000)
