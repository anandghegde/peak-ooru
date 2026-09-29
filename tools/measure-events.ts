// What the events of slice 7 do in the model (PRD section 9), January 2026 as the first season starts it: a month of
// festivals (`surge`), the city's buses on strike (`busService`), a line on strike (no vehicles), the price of fuel up and
// down (against published elasticities), and a road shut by a cave-in (`shut`).
//   npx vite-node tools/measure-events.ts
import { january, stretch } from './measure-common'
import { clean } from './measure-noise'
import { simulate, type MonthDetail } from '../src/sim/index'
import { DEFAULT_PRICES } from '../src/sim/params'
import { MODES, PERIODS, type CityState } from '../src/sim/types'

function vehicleKm(state: CityState, r: MonthDetail): number {
  const hours = { morning: 3, midday: 5, evening: 2.5, night: 10 }
  let v = 0
  for (const p of PERIODS) for (const l of state.roads.links) v += (r.flow[p][l.id]! * hours[p] * l.length) / 1000
  return v
}

function line(name: string, s: CityState, r: MonthDetail, r0: MonthDetail, s0: CityState) {
  const pc = (a: number, b: number) => `${a >= b ? '+' : ''}${((100 * (a - b)) / b).toFixed(1)}%`
  const t = (m: (typeof MODES)[number]) => pc(r.trips[m], r0.trips[m])
  console.log(
    `${name.padEnd(40)} commute ${(r.commute / 60).toFixed(2)} (${((r.commute - r0.commute) / 60).toFixed(2)}), clean ${(clean(r) / 10).toFixed(1)}%, ` +
      `trips: car ${t('car')} 2w ${t('twoWheeler')} auto ${t('auto')} bus ${t('bus')} metro ${t('metro')} walk ${t('walk')}; vehicle-km ${pc(vehicleKm(s, r), vehicleKm(s0, r0))}; deaths ${r.deaths}`,
  )
}

function main() {
  const base = january()
  const r0 = simulate(base)
  line('January 2026 as the season starts', base, r0, r0, base)
  for (const surge of [1050, 1100, 1200]) {
    const s = { ...base, surge }
    line(`a month of festivals, trips x ${surge / 1000}`, s, simulate(s), r0, base)
  }
  for (const busService of [750, 500, 0]) {
    const s = { ...base, busService }
    line(`the city's buses at ${busService / 10}% of usual`, s, simulate(s), r0, base)
  }
  {
    const s = { ...base, vehicles: { purple: 0 } }
    const r = simulate(s)
    line('the Purple Line on strike', s, r, r0, base)
  }
  // Fuel: the elasticity of vehicle-km (car and two-wheeler passenger-km) to the price, at +10% and -10%, +50%.
  const km = (r: MonthDetail) => r.passengerKm.car + r.passengerKm.twoWheeler
  for (const k of [0.9, 1.1, 1.5]) {
    const fuel = DEFAULT_PRICES.fuel * k
    const s = { ...base, prices: { fuel } }
    const r = simulate(s)
    line(`fuel at Rs ${fuel.toFixed(0)} a litre`, s, r, r0, base)
    const e = Math.log(km(r) / km(r0)) / Math.log(k)
    const ev = Math.log(vehicleKm(s, r) / vehicleKm(base, r0)) / Math.log(k)
    console.log(`  elasticity to the fuel price: car and two-wheeler passenger-km ${e.toFixed(3)}, all vehicle-km on the roads ${ev.toFixed(3)}`)
  }
  // A cave-in: a stretch of Hosur Road near Madiwala shut all month.
  const ids = stretch(base, /Hosur Road/, 12.9226, 77.6174, 400)
  const s = { ...base, shut: Object.fromEntries(ids.map((id) => [id, 1000])) }
  line(`a cave-in: Hosur Road at Madiwala shut (${ids.length} links)`, s, simulate(s), r0, base)
}

main()
