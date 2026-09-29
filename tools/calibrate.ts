// Compares the model with published figures and prints the gaps.
//   npx vite-node tools/calibrate.ts             the city as the first season starts, its roads as the rules have them
//   npx vite-node tools/calibrate.ts --perfect   every road and street in perfect repair (as slices 2 to 5 were)
//   npx vite-node tools/calibrate.ts --fit       first fit the modes' fixed bothers to the shares of trips
//   npx vite-node tools/calibrate.ts --deaths    first fit the three rates of road deaths to the traffic police's figures
// Sources are in docs/MODEL.md, figure by figure.
import { readFileSync } from 'node:fs'
import type { Network, Transit, Zone } from '../src/data/types'
import { linkKmh, simulate, slowRatio, guessScale } from '../src/sim/index'
if (process.env.PARAMS) for (const [k, v] of Object.entries(JSON.parse(process.env.PARAMS) as Record<string, object>)) Object.assign((P as unknown as Record<string, object>)[k]!, v)
import { lastDeaths } from '../src/sim/safety'
import { SAFETY, TRAVEL } from '../src/sim/params'
import * as P from '../src/sim/params'
import { rules } from '../src/rules/index'
import { firstSeason } from '../src/seasons/first'
import { MODES, PERIODS, type CityState, type Mode, type Period, type RoutingNetwork } from '../src/sim/types'

const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../public/data/${file}`, import.meta.url), 'utf8')) as T
const base: CityState = {
  month: 0,
  seed: 1,
  zones: read<Zone[]>('zones.json'),
  roads: read<RoutingNetwork>('routing.json'),
  transit: read<Transit>('transit.json'),
}
// Slice 6: the city is calibrated with its roads as the first season starts them (the rules' starting condition of every
// road and every zone's streets), which is what the published figures of 2025–26 saw.
const start = (() => {
  const city = { zones: base.zones, roads: base.roads, transit: base.transit }
  const s = rules.state(rules.start(firstSeason, city), city)
  return { surface: s.surface, streets: s.streets }
})()
const state: CityState = process.argv.includes('--perfect') ? base : { ...base, ...start }
// Targets for the share of trips by mode, %: the CMP's 2015 shares, with bus and metro brought to their 2025-26
// counts (judgement; see MODEL.md).
const share: Record<Mode, number> = { car: 8, twoWheeler: 28, auto: 8, bus: 21, metro: 4.1, rail: 0.5, cycle: 1, walk: 24 }

// With --fit, first set each mode's fixed bother so that the shares come out at the targets, and print the values.
if (process.argv.includes('--fit')) {
  for (let round = 0; round < 20; round++) {
    const t = simulate(state).trips
    const all = MODES.reduce((s, m) => s + t[m], 0)
    for (const m of MODES) {
      if (m === 'walk') continue
      // A minute of bother on each leg changes a mode's odds by e^(−2 × scale); walking is held at 0.
      const ratio = (t[m] / all) / (share[m] / 100) / (t.walk / all / (share.walk / 100))
      // Damped, as the crowding on the trains answers each change.
      TRAVEL.constant[m] = Math.round((TRAVEL.constant[m] + (0.7 * Math.log(ratio)) / (2 * TRAVEL.scale)) * 10) / 10
    }
  }
  console.log('constant:', JSON.stringify(TRAVEL.constant))
}
// With --deaths, scale each of the three rates of road deaths so that the wards come to the traffic police's figures.
if (process.argv.includes('--deaths')) {
  const wards = state.zones.filter((z) => z.ward !== undefined).map((z) => z.id)
  const inWards = (a: Float64Array) => wards.reduce((x, k) => x + a[k]!, 0)
  for (let round = 0; round < 2; round++) {
    simulate(state)
    const walk = inWards(lastDeaths.walk), two = inWards(lastDeaths.twoWheeler), other = inWards(lastDeaths.other)
    SAFETY.onFoot *= 240 / walk
    SAFETY.perTwoWheelerKm *= 515 / two
    SAFETY.perCarUnitKm *= 123 / other
  }
  console.log('deaths: onFoot', SAFETY.onFoot, 'perTwoWheelerKm', SAFETY.perTwoWheelerKm, 'perCarUnitKm', SAFETY.perCarUnitKm)
}
const r = simulate(state)
const names = new Map(read<Network>('network.json').links.map((l) => [l.id, l.name]))
const nameOf = (l: RoutingNetwork['links'][number]) => l.drawn.map((d) => names.get(d)).find((x) => x) ?? ''

const rows: [string, number, number | string, string][] = []
const row = (what: string, model: number, published: number | string, source: string) =>
  rows.push([what, model, published, source])

const people = state.zones.reduce((s, z) => s + z.people, 0)
const trips = MODES.reduce((s, m) => s + r.trips[m], 0)
row('Trips a person a weekday, walking included', trips / people, 1.24, 'CMP 2020 (2015 survey)')
for (const m of MODES) row(`Share of trips, ${m} (%)`, (100 * r.trips[m]) / trips, share[m], 'CMP 2015, updated (see MODEL.md)')
row('Bus trips a weekday (M)', r.trips.bus / 1e6, 4.3, 'BMTC 42.98 lakh, Economic Survey 2025-26')
const boardings = Object.entries(r.riders)
  .filter(([id]) => ['purple', 'green', 'yellow'].includes(id))
  .reduce((s, [, v]) => s + v, 0)
row('Metro trips a weekday (M)', r.trips.metro / 1e6, 0.84, 'BMRCL 10 Aug 2026: 8.45 lakh entries')
row('Metro boardings a weekday (M)', boardings / 1e6, 1.12, 'BMRCL 10 Aug 2026 record: 11.2 lakh')
row('  Purple Line boardings (k)', r.riders.purple! / 1e3, 466 + 275 / 2, 'BMRCL 10 Aug 2026 (with half the changes)')
row('  Green Line boardings (k)', r.riders.green! / 1e3, 285 + 275 / 2, 'BMRCL 10 Aug 2026 (with half the changes)')
row('  Yellow Line boardings (k)', r.riders.yellow! / 1e3, 93, 'BMRCL 10 Aug 2026')
row('Suburban rail trips a weekday (k)', r.trips.rail / 1e3, 150, 'SWR, TOI Dec 2019 (old)')
const km: Record<Mode, number> = { car: 12.8, twoWheeler: 8, auto: 3.7, bus: 10.7, metro: NaN, rail: NaN, cycle: 2.6, walk: 1 }
for (const m of MODES) if (!Number.isNaN(km[m])) row(`Trip length, ${m} (km)`, r.tripKm[m], km[m], 'CMP 2020 Table 2-30')
const census = [19.6, 28.1, 25.9, 16.0, 5.8, 3.3, 1.4]
const band = ['0-1', '2-5', '6-10', '11-20', '21-30', '31-50', '51+']
band.forEach((b, k) => row(`Work trips ${b} km (%)`, r.workDistance[k]! / 10, census[k]!, 'Census 2011 B-28, Bangalore urban'))
row('Commute, door to door (min)', r.commute / 60, '40-60', 'Brief; Ola 2022 survey 31 min')
row('  of it lost to traffic (min)', r.commuteDelay / 60, '', '')

// Speeds: vehicle-km over vehicle-hours on the modelled roads.
for (const p of PERIODS) {
  let vkm = 0, vh = 0, mkm = 0, mh = 0
  for (const l of state.roads.links) {
    const f = r.flow[p][l.id]!
    const v = linkKmh(state.roads, r, p, l)
    const k = (f * l.length) / 1000
    vkm += k
    vh += k / v
    if (l.kind !== 'tertiary' && l.kind !== 'secondary') {
      mkm += k
      mh += k / v
    }
  }
  const tomtom: Record<Period, number | string> = { morning: 14.6, midday: 16.6, evening: 13.2, night: '' }
  row(`Speed, ${p}, all modelled roads (km/h)`, vkm / vh, tomtom[p], 'TomTom 2025 (city, all roads; midday = all-day)')
  row(`Speed, ${p}, primary and above (km/h)`, mkm / mh, p === 'night' ? '' : '15-20', 'Brief; CMP: arterials under 20')
}

// Junctions: passenger-car units an hour entering, at the busier peak.
const at = (lat: number, lng: number, metres: number) => {
  const inside = new Set<number>()
  for (const n of state.roads.nodes) {
    const dy = (n.at[1] / 1e6 - lat) * 110570
    const dx = (n.at[0] / 1e6 - lng) * 108480
    if (dx * dx + dy * dy < metres * metres) inside.add(n.id)
  }
  return inside
}
const junction = (name: string, lat: number, lng: number, published: number) => {
  const inside = at(lat, lng, 350)
  let best = 0
  for (const p of ['morning', 'evening'] as Period[]) {
    let pcu = 0
    for (const l of state.roads.links) if (inside.has(l.to) && !inside.has(l.from)) pcu += r.flow[p][l.id]!
    best = Math.max(best, pcu / r.vehiclesPerPcu[p])
  }
  row(`${name}, peak PCU an hour entering`, best, published, 'CMP Table 2-14 (RMP 2031 counts)')
}
junction('Silk Board', 12.9172, 77.6228, 18180)
junction('Hebbal', 13.0405, 77.5897, 18154)
junction('Tin Factory', 12.9987, 77.6687, 16919)
{
  let most = 0, sum = 0, len = 0
  for (const l of state.roads.links) {
    if (!/Outer Ring Road/.test(nameOf(l))) continue
    const perLane = Math.max(r.flow.morning[l.id]!, r.flow.evening[l.id]!) / r.vehiclesPerPcu.morning / l.lanes
    most = Math.max(most, perLane)
    sum += perLane * l.length
    len += l.length
  }
  row('Outer Ring Road, peak PCU a lane an hour, average', sum / len, 2800, 'Deccan Herald 19 Aug 2026, BTP')
}

{
  // Road deaths (slice 5): the wards are the city the Bengaluru Traffic Police count.
  const wards = state.zones.filter((z) => z.ward !== undefined).map((z) => z.id)
  const inWards = (a: Float64Array) => wards.reduce((x, k) => x + a[k]!, 0)
  const walk = inWards(lastDeaths.walk), two = inWards(lastDeaths.twoWheeler), other = inWards(lastDeaths.other)
  row('Road deaths a year in the wards', walk + two + other, 878, 'BTP accident statistics, 2025 (878; 2024: 894)')
  row('  of them on foot (and cycling)', walk, 240, 'The Hindu 11 Jan 2026: 225 pedestrians in 2025; cyclists judgement')
  row('  of them on two-wheelers', two, 518, 'BTP Road Safety Report 2023: 59% of the killed')
  row('Road deaths a year beyond the wards (not counted by BTP)', (r.deaths ?? 0) - walk - two - other, '—', 'same rates')
}

console.log(`took ${r.took.toFixed(0)} ms; the roads' slowness, work and other trips (DEMAND.slow) ${slowRatio.map((x) => x.toFixed(3)).join(', ')}; the guess's scale (GUESS.perUnit) ${guessScale.slice(0, 3).map((x) => x.toFixed(4)).join(', ')}\n`)
console.log('figure'.padEnd(52), 'model'.padStart(9), 'published'.padStart(10), '  gap    source')
for (const [what, model, published, source] of rows) {
  const gap = typeof published === 'number' ? `${model >= published ? '+' : ''}${((100 * (model - published)) / published).toFixed(0)}%` : ''
  console.log(what.padEnd(52), model.toFixed(model < 10 ? 2 : 0).padStart(9), String(published).padStart(10), gap.padStart(6), '  ' + source)
}

// Where the evening jams are: vehicle-hours lost an hour, by road name, and speeds at the places everyone knows.
{
  const lost = new Map<string, number>()
  for (const l of state.roads.links) {
    const name = nameOf(l) || `(unnamed ${l.kind})`
    const f = r.flow.evening[l.id]!
    const hours = l.length / 1000 / linkKmh(state.roads, r, 'evening', l)
    lost.set(name, (lost.get(name) ?? 0) + f * hours * (1 - r.speed.evening[l.id]! / 1000))
  }
  console.log('\nroads losing the most vehicle-hours an hour at the evening peak:')
  ;[...lost.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([n, h]) => console.log(`  ${n.slice(0, 50).padEnd(50)} ${h.toFixed(0).padStart(6)}`))

  const places: [string, number, number][] = [
    ['Silk Board', 12.9172, 77.6228],
    ['Outer Ring Road, Bellandur', 12.9304, 77.6784],
    ['Outer Ring Road, Marathahalli', 12.9569, 77.7011],
    ['Hebbal', 13.0405, 77.5897],
    ['KR Puram / Tin Factory', 12.9987, 77.6687],
    ['Mysore Road, Nayandahalli', 12.9460, 77.5310],
    ['Hosur Road, Bommanahalli', 12.9010, 77.6300],
    ['Bannerghatta Road, Jayadeva', 12.9180, 77.6000],
    ['Majestic', 12.9767, 77.5713],
    ['MG Road', 12.9756, 77.6066],
    ['Whitefield', 12.9698, 77.7500],
    ['Yeshwanthpur', 13.0280, 77.5400],
    ['Electronic City', 12.8450, 77.6600],
    ['Rajajinagar', 12.9900, 77.5550],
  ]
  console.log('\nspeed on primary roads and above within 1.5 km, share of free speed (morning / evening / night):')
  for (const [name, lat, lng] of places) {
    const inside = at(lat, lng, 1500)
    const share = (p: Period) => {
      let fl = 0, fs = 0
      for (const l of state.roads.links) {
        if (l.kind === 'secondary' || l.kind === 'tertiary') continue
        if (!inside.has(l.from) && !inside.has(l.to)) continue
        const f = r.flow[p][l.id]! * l.length
        fl += f
        fs += f * r.speed[p][l.id]!
      }
      return fl > 0 ? `${(fs / fl / 10).toFixed(0)}%` : '-'
    }
    console.log(`  ${name.padEnd(32)} ${share('morning').padStart(5)} ${share('evening').padStart(5)} ${share('night').padStart(5)}`)
  }
}
