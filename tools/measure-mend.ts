// A short stretch mended (slice 7, job 1): does the stretch come out slower, and why? The city is January 2026 with its
// roads as the first season starts them. For each stretch: the links' own speed at the evening peak (as the screen reads
// it, and per vehicle), the vehicles on them, the minutes a vehicle takes over the stretch, and how far routes moved
// elsewhere in the city.
//   npx vite-node tools/measure-mend.ts
import { simulate } from '../src/sim/index'
import { PERIODS } from '../src/sim/types'
import { along, january, moved, stretch } from './measure-common'

function main() {
  const base = january()
  const r0 = simulate(base)
  console.log(`January 2026 as the season starts: commute ${(r0.commute / 60).toFixed(2)} min`)
  const cases: [string, RegExp, number, number, number, number][] = [
    ['ORR at Marathahalli, concrete', /Outer Ring Road/, 12.9569, 77.7011, 900, 100],
    ['ORR at Marathahalli, resurfaced', /Outer Ring Road/, 12.9569, 77.7011, 900, 90],
    ['Hosur Road at Madiwala, patched', /Hosur Road/, 12.9226, 77.6174, 650, 62],
    ['ORR at Bellandur, concrete', /Outer Ring Road/, 12.9260, 77.6762, 900, 100],
    ['Bellary Road at Hebbal, concrete', /Bellary Road|Ballari Road/, 13.0358, 77.5970, 900, 100],
  ]
  for (const [name, re, lat, lng, m, c] of cases) {
    const ids = stretch(base, re, lat, lng, m)
    if (!ids.length) {
      console.log(`${name}: no links`)
      continue
    }
    const surface = [...base.surface!]
    const was = ids.reduce((a, id) => a + (surface[id] ?? 100), 0) / ids.length
    for (const id of ids) surface[id] = Math.max(surface[id] ?? 100, c)
    const s = { ...base, surface }
    const r = simulate(s)
    console.log(`\n${name}: ${ids.length} links, ${(along(base, r0, ids).km).toFixed(2)} km, condition ${was.toFixed(0)} -> ${c}; city commute ${(r0.commute / 60).toFixed(2)} -> ${(r.commute / 60).toFixed(2)}`)
    for (const p of PERIODS) {
      const x = along(base, r0, ids, p)
      const y = along(s, r, ids, p)
      console.log(
        `  ${p.padEnd(8)} km/h by length ${x.kmh.toFixed(1)} -> ${y.kmh.toFixed(1)}, per vehicle ${x.perVehicleKmh.toFixed(1)} -> ${y.perVehicleKmh.toFixed(1)}; ` +
          `vehicles an hour a link ${x.vehicles.toFixed(0)} -> ${y.vehicles.toFixed(0)}; minutes over the stretch ${x.minutes.toFixed(2)} -> ${y.minutes.toFixed(2)}; ` +
          `links elsewhere moved >5% ${moved(r0, r, p)}`,
      )
    }
  }
}

main()
