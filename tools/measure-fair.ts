// Fairness (slice 7, job 3): is the worst-served fifth of zones real, or an effect of grouping wards (369 into about
// 130)? And does a line built to serve poor outer zones raise their figures and the measure? January 2026 as the first
// season starts it, worked out with the wards grouped as the model groups them, and again with no grouping at all.
//   npx vite-node tools/measure-fair.ts
import type { Station, TransitLine } from '../src/data/types'
import { fairness } from '../src/rules/score'
import { simulate } from '../src/sim/index'
import { GROUPING } from '../src/sim/params'
import type { CityState, MonthResult } from '../src/sim/types'
import { january } from './measure-common'

/** The zones (by id) holding the worst-served fifth of people by a figure, worst first (as the rules take it). */
function worstFifth(values: ArrayLike<number>, state: CityState, worseLow: boolean): Set<number> {
  const zones = state.zones.filter((z) => z.people > 0)
  const all = zones.reduce((a, z) => a + z.people, 0)
  zones.sort((a, b) => (worseLow ? values[a.id]! - values[b.id]! : values[b.id]! - values[a.id]!) || a.id - b.id)
  const out = new Set<number>()
  let taken = 0
  for (const z of zones) {
    if (taken >= all / 5) break
    out.add(z.id)
    taken += z.people
  }
  return out
}

/** People-weighted averages of a zone figure over a set of zones. */
function mean(values: ArrayLike<number>, state: CityState, ids: Iterable<number>): number {
  let p = 0, s = 0
  for (const id of ids) {
    const z = state.zones[id]!
    p += z.people
    s += z.people * values[id]!
  }
  return s / p
}

function describe(name: string, state: CityState, r: MonthResult) {
  const f = fairness(r, state.zones.map((z) => z.people), state.zones.map((z) => z.id))
  const a = worstFifth(r.accessByZone, state, true)
  const c = worstFifth(r.commuteByZone, state, false)
  const all = state.zones.map((z) => z.id)
  console.log(
    `${name}: fairness ${(f / 10).toFixed(1)}%; access, worst fifth ${(mean(r.accessByZone, state, a) / 10).toFixed(1)}% of jobs against ${(mean(r.accessByZone, state, all) / 10).toFixed(1)}% ` +
      `(${a.size} zones); commute, worst fifth ${(mean(r.commuteByZone, state, c) / 60).toFixed(1)} min against ${(mean(r.commuteByZone, state, all) / 60).toFixed(1)} (${c.size} zones)`,
  )
  return { a, c, f }
}

function overlap(x: Set<number>, y: Set<number>, state: CityState): string {
  let both = 0, px = 0
  for (const id of x) {
    px += state.zones[id]!.people
    if (y.has(id)) both += state.zones[id]!.people
  }
  return `${((100 * both) / px).toFixed(0)}% of the people`
}

function main() {
  const base = january()
  const share = GROUPING.share
  const grouped = simulate(base)
  const g = describe(`grouped (${share} of the wards' number)`, base, grouped)
  GROUPING.share = 1
  const t = performance.now()
  const whole = simulate(base)
  const w = describe(`no grouping (${((performance.now() - t) / 1000).toFixed(1)} s)`, base, whole)
  console.log(`  the worst fifth by access, grouped and not, in common: ${overlap(g.a, w.a, base)}; by commute: ${overlap(g.c, w.c, base)}`)
  // Zone by zone: how far the grouped figures are from the ungrouped, among the worst-served and the rest.
  const gap = (ids: Iterable<number>, x: ArrayLike<number>, y: ArrayLike<number>, scale: number) => {
    let p = 0, s = 0
    for (const id of ids) {
      p += base.zones[id]!.people
      s += base.zones[id]!.people * Math.abs(x[id]! - y[id]!)
    }
    return (s / p / scale).toFixed(1)
  }
  console.log(`  zone by zone, grouped against not, the average gap: access ${gap(base.zones.map((z) => z.id), grouped.accessByZone, whole.accessByZone, 10)} points, commute ${gap(base.zones.map((z) => z.id), grouped.commuteByZone, whole.commuteByZone, 60)} min`)
  GROUPING.share = share

  // A metro line for the worst served: from the most populous zone of the worst fifth by access through two more of
  // them near it, to the city centre (MG Road).
  const worst = [...g.a].map((id) => base.zones[id]!).sort((a, b) => b.people - a.people || a.id - b.id)
  const dist = (p: [number, number], q: [number, number]) => Math.hypot((p[0] - q[0]) * 108.48, (p[1] - q[1]) * 110.57)
  const centre: [number, number] = [77.6066, 12.9756]
  // The most populous of them within `FAIR_KM` km of the centre (all of them with FAIR_KM=99).
  const first = worst.find((z) => dist(z.centre, centre) < Number(process.env.FAIR_KM ?? 99))!
  const along = worst.filter((z) => z.id !== first.id && dist(z.centre, first.centre) < 8 && dist(z.centre, centre) < dist(first.centre, centre)).slice(0, 2)
  const stops = [first, ...along.sort((a, b) => dist(b.centre, centre) - dist(a.centre, centre))].map((z) => z.centre)
  // Stations every 1.5 km or so on the way to the centre.
  const way: [number, number][] = []
  for (let k = 0; k < stops.length; k++) {
    const p = stops[k]!, q = k + 1 < stops.length ? stops[k + 1]! : centre
    const n = Math.max(1, Math.round(dist(p, q) / 1.5))
    for (let i = 0; i < n; i++) way.push([p[0] + ((q[0] - p[0]) * i) / n, p[1] + ((q[1] - p[1]) * i) / n])
  }
  way.push(centre)
  const stations: Station[] = [...base.transit.stations]
  const ids = way.map((at) => {
    stations.push({ id: 90_000 + stations.length, name: 'fair', nameKn: null, at, kind: 'metro' })
    return 90_000 + stations.length - 1
  })
  const line: TransitLine = { id: 'fair', name: 'fair', kind: 'metro', colour: '#123456', status: 'open', stations: ids, path: [] }
  const served = { ...base, transit: { stations, lines: [...base.transit.lines, line] } }
  console.log(`\na metro line of ${ids.length} stations from ${first.name}${along.map((z) => ', ' + z.name).join('')} to MG Road:`)
  for (const [label, s] of [['grouped', share], ['no grouping', 1]] as const) {
    GROUPING.share = s
    const r0 = simulate(base)
    const r = simulate(served)
    const f0 = fairness(r0, base.zones.map((z) => z.people), base.zones.map((z) => z.id))
    const f1 = fairness(r, base.zones.map((z) => z.people), base.zones.map((z) => z.id))
    const near = base.zones.filter((z) => way.some((p) => dist(z.centre, p) < 1)).map((z) => z.id)
    console.log(
      `  ${label}: fairness ${(f0 / 10).toFixed(1)} -> ${(f1 / 10).toFixed(1)}%; the zones within 1 km of its stations (${near.length}): access ${(mean(r0.accessByZone, base, near) / 10).toFixed(1)} -> ${(mean(r.accessByZone, base, near) / 10).toFixed(1)}%, ` +
        `commute ${(mean(r0.commuteByZone, base, near) / 60).toFixed(1)} -> ${(mean(r.commuteByZone, base, near) / 60).toFixed(1)} min; riders ${r.riders.fair}`,
    )
    const ends = [first.id, ...along.map((z) => z.id)]
    const fifth = [...worstFifth(r0.accessByZone, base, true)]
    const all = base.zones.map((z) => z.id)
    console.log(
      `    the worst-served zones it starts from: access ${(mean(r0.accessByZone, base, ends) / 10).toFixed(1)} -> ${(mean(r.accessByZone, base, ends) / 10).toFixed(1)}%, commute ${(mean(r0.commuteByZone, base, ends) / 60).toFixed(1)} -> ${(mean(r.commuteByZone, base, ends) / 60).toFixed(1)} min; ` +
        `the worst fifth as it was: access ${(mean(r0.accessByZone, base, fifth) / 10).toFixed(2)} -> ${(mean(r.accessByZone, base, fifth) / 10).toFixed(2)}%; the city ${(mean(r0.accessByZone, base, all) / 10).toFixed(2)} -> ${(mean(r.accessByZone, base, all) / 10).toFixed(2)}%`,
    )
  }
  GROUPING.share = share
}

main()
