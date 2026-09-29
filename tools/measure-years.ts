// Where ten years go: plays the real city for 120 months with the rules and the model, the player doing nothing, and
// prints what each month came to; then, with --lines, what a line or bus lanes do in 2026 and in 2035.
//   npx vite-node tools/measure-years.ts             month by month (every third month, and each opening)
//   npx vite-node tools/measure-years.ts --lines     and a metro line and bus lanes opened in 2026, 2030 and 2035
//   npx vite-node tools/measure-years.ts --every=1   every month
import { readFileSync } from 'node:fs'
import type { LngLat, Station, Transit, TransitLine, Zone } from '../src/data/types'
import { rules } from '../src/rules/index'
import type { CityData, Season } from '../src/rules/types'
import { firstSeason } from '../src/seasons/first'
import { busPath } from '../src/sim/bus'
import { linkKmh, simulate, type MonthDetail } from '../src/sim/index'
import { modelZones } from '../src/sim/zones'
import { MODES, PERIODS, type CityState, type Period, type RoutingNetwork } from '../src/sim/types'

const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../public/data/${file}`, import.meta.url), 'utf8')) as T
const at = (lat: number, lng: number): LngLat => [lng, lat]

export function loadData(): CityData {
  return { zones: read<Zone[]>('zones.json'), roads: read<RoutingNetwork>('routing.json'), transit: read<Transit>('transit.json') }
}

/** The states of the 120 months of a game in which the player does nothing, and each month's result. */
export function playNothing(city: CityData, season: Season = firstSeason, keep?: (month: number) => boolean) {
  const game = rules.start(season, city)
  const out: { month: number; state: CityState; result: MonthDetail }[] = []
  while (game.status === 'playing') {
    const state = rules.state(game, city)
    const result = simulate(state)
    if (!keep || keep(game.month)) out.push({ month: game.month, state, result })
    rules.endMonth(game, city, result)
  }
  return out
}

/** Speed on all modelled roads by period: vehicle-km over vehicle-hours. */
export function roadSpeeds(state: CityState, r: MonthDetail): Record<Period, { all: number }> {
  const out = {} as Record<Period, { all: number }>
  for (const p of PERIODS) {
    let km = 0, h = 0
    for (const l of state.roads.links) {
      const k = (r.flow[p][l.id]! * l.length) / 1000
      km += k
      h += k / linkKmh(state.roads, r, p, l)
    }
    out[p] = { all: km / h }
  }
  return out
}

const people = (s: CityState) => s.zones.reduce((a, z) => a + z.people, 0)
const openLines = (s: CityState) => s.transit.lines.filter((l) => l.status === 'open').map((l) => l.id)

function row(month: number, s: CityState, r: MonthDetail) {
  const sp = roadSpeeds(s, r)
  const t = r.trips
  const lakh = (x: number) => (x / 1e5).toFixed(1).padStart(5)
  const cbm = (m: keyof typeof r.commuteByMode) => (r.commuteByMode[m].seconds / 60).toFixed(0).padStart(3)
  return (
    `${String(2026 + Math.floor(month / 12)).padStart(4)}-${String((month % 12) + 1).padStart(2, '0')} ` +
    `${(people(s) / 1e5).toFixed(1).padStart(6)} ${String(s.ownership?.car ?? 1000).padStart(5)} ${String(s.ownership?.twoWheeler ?? 1000).padStart(5)}  ` +
    `${lakh(t.car)} ${lakh(t.twoWheeler)} ${lakh(t.auto)} ${lakh(t.bus)} ${lakh(t.metro)} ${lakh(t.walk + t.cycle)}  ` +
    `${sp.morning.all.toFixed(1).padStart(5)} ${sp.evening.all.toFixed(1).padStart(5)}  ` +
    `${(r.commute / 60).toFixed(1).padStart(5)} ${(r.commuteDelay / 60).toFixed(1).padStart(5)}  ` +
    `car ${cbm('car')} 2w ${cbm('twoWheeler')} bus ${cbm('bus')} metro ${cbm('metro')}  ` +
    `blue ${String(r.riders.blue ?? 0).padStart(6)} pink ${String(r.riders.pink ?? 0).padStart(6)}  ` +
    `deaths ${String(r.deaths ?? '').padStart(4)} (${r.deathsBy?.walk ?? ''}/${r.deathsBy?.twoWheeler ?? ''}/${r.deathsBy?.other ?? ''})  ${r.took.toFixed(0)} ms`
  )
}

const HEAD =
  'month    lakh   car   2wh    car   2wh  auto   bus metro  foot  am km/h pm    commute delay  minutes door to door by mode (work)        riders                   deaths a year (on foot/2-wheeler/other)'

/** A metro line from MG Road to Sarjapura by Koramangala (tools/measure-line.ts), and bus lanes along Hosur Road. */
function sarjapur(state: CityState): { state: CityState; line: TransitLine } {
  const places: LngLat[] = [
    at(12.964, 77.616), at(12.953, 77.623), at(12.942, 77.625), at(12.933, 77.631), at(12.925, 77.64),
    at(12.921, 77.6631), at(12.913, 77.674), at(12.909, 77.688), at(12.905, 77.705), at(12.896, 77.725),
    at(12.883, 77.749), at(12.87, 77.768), at(12.858, 77.787),
  ]
  return addLine(state, 'x-sarjapur', 'metro', [18, ...places])
}

function addLine(state: CityState, id: string, kind: 'metro' | 'bus', stops: (number | LngLat)[], vehicles?: number, lanes = false) {
  const stations: Station[] = [...state.transit.stations]
  let next = stations.reduce((m, s) => Math.max(m, s.id), -1) + 1
  const ids = stops.map((s) => {
    if (typeof s === 'number') return s
    stations.push({ id: next, name: `${id} ${next}`, nameKn: null, at: s, kind })
    return next++
  })
  const byId = new Map(stations.map((s) => [s.id, s]))
  const line: TransitLine = { id, name: id, kind, colour: '#888', status: 'open', stations: ids, path: ids.flatMap((k) => byId.get(k)!.at) }
  const out: CityState = { ...state, transit: { stations, lines: [...state.transit.lines, line] } }
  if (vehicles !== undefined) out.vehicles = { ...state.vehicles, [id]: vehicles }
  if (lanes) {
    const back = { ...line, stations: [...ids].reverse() }
    const l = [...busPath(state.roads, line, stations), ...busPath(state.roads, back, stations)]
    out.busLanes = [...(state.busLanes ?? []), ...l.filter((k) => state.roads.links[k]!.lanes >= 2)]
  }
  return { state: out, line }
}

/** Bus lanes and a route of 40 buses along Hosur Road and Mysore Road through the middle. */
function hosurBus(state: CityState) {
  const places: LngLat[] = [
    at(12.8452, 77.6602), at(12.8612, 77.6533), at(12.8797, 77.6448), at(12.8965, 77.6341), at(12.9166, 77.6206),
    at(12.9279, 77.6109), at(12.9406, 77.6037), at(12.9571, 77.5979), at(12.9658, 77.5864), at(12.9577, 77.5634),
    at(12.9503, 77.5405), at(12.9443, 77.5215),
  ]
  return addLine(state, 'x-hosur-bus', 'bus', places, 40, true)
}

/** Bus routes of 40 buses in bus lanes along five radial roads: Old Madras, Tumkur, Bannerghatta, Sarjapur and Bellary Roads. */
const CORRIDORS: [string, LngLat[]][] = [
  ['x-omr', [at(12.9756, 77.6047), at(12.9784, 77.6230), at(12.9905, 77.6520), at(13.0010, 77.6780), at(13.0080, 77.6960), at(13.0200, 77.7250)]],
  ['x-tumkur', [at(12.9770, 77.5710), at(12.9960, 77.5500), at(13.0130, 77.5370), at(13.0290, 77.5190), at(13.0450, 77.5000), at(13.0600, 77.4800)]],
  ['x-bannerghatta', [at(12.9580, 77.5980), at(12.9380, 77.5990), at(12.9170, 77.6000), at(12.8960, 77.5980), at(12.8760, 77.5960), at(12.8560, 77.5900)]],
  ['x-sarjapur-road', [at(12.9350, 77.6240), at(12.9230, 77.6500), at(12.9120, 77.6770), at(12.9050, 77.7000), at(12.8960, 77.7250), at(12.8830, 77.7490)]],
  ['x-bellary', [at(12.9920, 77.5850), at(13.0100, 77.5880), at(13.0350, 77.5920), at(13.0600, 77.5950), at(13.0850, 77.5970), at(13.1000, 77.5960)]],
]

/** Metro lines of the kind BMRCL plans: the western Outer Ring Road (JP Nagar to Hebbal) and Magadi Road. */
const METROS: [string, LngLat[]][] = [
  ['x-west-orr', [at(12.9063, 77.5857), at(12.9160, 77.5620), at(12.9250, 77.5500), at(12.9430, 77.5270), at(12.9600, 77.5100), at(12.9850, 77.5050), at(13.0130, 77.5250), at(13.0280, 77.5400), at(13.0400, 77.5600), at(13.0350, 77.5910)]],
  ['x-magadi', [at(12.9750, 77.5450), at(12.9830, 77.5250), at(12.9850, 77.5000), at(12.9870, 77.4750), at(12.9860, 77.4500), at(12.9850, 77.4300)]],
]

/** A sensible builder's city: three metro lines and bus routes in lanes along six roads. */
export function builder(state: CityState): CityState {
  let s = hosurBus(sarjapur(state).state).state
  for (const [id, stops] of METROS) s = addLine(s, id, 'metro', stops).state
  for (const [id, stops] of CORRIDORS) s = addLine(s, id, 'bus', stops, 40, true).state
  return s
}

function lines(all: { month: number; state: CityState; result: MonthDetail }[]) {
  console.log('\nWhat a line does, opened at once in the month shown (commute minutes, and change):')
  for (const m of [0, 48, 119]) {
    const x = all.find((a) => a.month === m)
    if (!x) continue
    const base = x.result.commute / 60
    const cases: [string, CityState][] = [
      ['metro MG Road-Sarjapura', sarjapur(x.state).state],
      ['bus route + lanes, Hosur-Mysore Rd', hosurBus(x.state).state],
      ['both', hosurBus(sarjapur(x.state).state).state],
      ['three metro lines, six bus corridors', builder(x.state)],
    ]
    for (const [name, s] of cases) {
      const r = simulate(s)
      const c = r.commute / 60
      console.log(
        `  ${2026 + Math.floor(m / 12)}  ${name.padEnd(36)} ${base.toFixed(2)} -> ${c.toFixed(2)}  ${(c - base).toFixed(2)} min ` +
          `deaths ${x.result.deaths} -> ${r.deaths}  ` +
          `(${((100 * (c - base)) / base).toFixed(1)}%)  metro ${r.trips.metro - x.result.trips.metro}, car ${r.trips.car - x.result.trips.car}, 2w ${r.trips.twoWheeler - x.result.trips.twoWheeler}` +
          `  riders ${r.riders['x-sarjapur'] ?? ''} ${r.riders['x-hosur-bus'] ?? ''}`,
      )
    }
  }
}

function main() {
  const args = process.argv.slice(2)
  const every = Number(args.find((a) => a.startsWith('--every='))?.slice(8) ?? 3)
  const city = loadData()
  const all = playNothing(city)
  console.log(HEAD)
  let open = ''
  for (const { month, state, result } of all) {
    const o = openLines(state).join(',')
    if (month % every === 0 || month === 119 || o !== open) console.log(row(month, state, result) + (o !== open && open ? '  opened' : ''))
    open = o
  }
  const first = all[0]!
  const last = all[all.length - 1]!
  console.log(`\nmodes ${MODES.join(', ')}`)
  console.log(`people ${(people(first.state) / 1e5).toFixed(1)} -> ${(people(last.state) / 1e5).toFixed(1)} lakh; commute ${(first.result.commute / 60).toFixed(1)} -> ${(last.result.commute / 60).toFixed(1)}`)
  if (args.includes('--lines')) lines(all)
  // Whether the wards group alike from the first month to the last as people grow apart.
  const a = modelZones(first.state.zones, first.state.roads.zoneNode)
  const b = modelZones(last.state.zones, last.state.roads.zoneNode)
  let moved = 0
  for (let k = 0; k < a.of.length; k++) if (a.of[k] !== b.of[k]) moved++
  const nodes = a.node.filter((n, g) => n !== b.node[g]).length
  console.log(`\ngrouping of wards, first month against last: ${moved} wards in another group, ${nodes} groups joining the roads elsewhere`)
}

if (!process.env.NO_MAIN) main()
