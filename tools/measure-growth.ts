// How the commute answers growth, and what in the model makes it so: the city of 2028 (the season's lines open) and
// of 2035 (people × 1.275, cars × 1.2, two-wheelers × 1.15), as the rules grow it when the player does nothing, with
// one thing changed at a time.
//   npx vite-node tools/measure-growth.ts
import { readFileSync } from 'node:fs'
import type { Transit, Zone } from '../src/data/types'
import { simulate, type MonthDetail } from '../src/sim/index'
import { MODES, type CityState, type RoutingNetwork } from '../src/sim/types'

const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../public/data/${file}`, import.meta.url), 'utf8')) as T

/** The city with people and jobs × `grow`, vehicles to hand as given, and the Blue and Pink Lines open in full. */
export function grown(grow: number, car = 1000, twoWheeler = 1000, month = 0): CityState {
  const zones = read<Zone[]>('zones.json').map((z) => ({ ...z, people: Math.round(z.people * grow), jobs: Math.round(z.jobs * grow) }))
  const transit = read<Transit>('transit.json')
  transit.lines = transit.lines.map((l) => (l.id === 'blue' || l.id === 'pink' ? { ...l, status: 'open' as const } : l))
  return { month, seed: 1, zones, roads: read<RoutingNetwork>('routing.json'), transit, ownership: { car, twoWheeler } }
}

export function line(name: string, r: MonthDetail, base?: MonthDetail) {
  const t = r.trips
  const lakh = (x: number) => (x / 1e5).toFixed(1).padStart(5)
  const d = base ? `  ${((r.commute - base.commute) / 60).toFixed(2).padStart(6)}` : '        '
  return (
    `${name.padEnd(46)} ${(r.commute / 60).toFixed(2).padStart(6)}${d}  delay ${(r.commuteDelay / 60).toFixed(1).padStart(4)}  ` +
    `car ${lakh(t.car)} 2w ${lakh(t.twoWheeler)} auto ${lakh(t.auto)} bus ${lakh(t.bus)} metro ${lakh(t.metro)} foot ${lakh(t.walk + t.cycle)}  ` +
    `work km ${r.workDistance.join('/')}`
  )
}

function main() {
  const now = grown(1)
  const y28 = grown(1.083, 1040, 1030, 24)
  const y35 = grown(1.275, 1198, 1149, 119)
  const r0 = simulate(now)
  console.log(line('2026, the season\'s lines open', r0))
  const r28 = simulate(y28)
  console.log(line('2028', r28, r0))
  const r35 = simulate(y35)
  console.log(line('2035', r35, r0))
  console.log(line('2035, ownership as 2026', simulate(grown(1.275, 1000, 1000, 119)), r0))
  console.log(line('2026 people, 2035 ownership', simulate(grown(1, 1198, 1149, 0)), r0))
  console.log(`modes ${MODES.join(' ')}`)
}

if (!process.env.NO_MAIN) main()
