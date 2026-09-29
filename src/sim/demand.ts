import type { Zone } from '../data/types'
import { expNeg } from './fixed'
import { toKm } from './graph'
import { DEMAND } from './params'

/** Round trips a weekday between zones: work, and everything else. Row i is the home zone. */
export interface Tours {
  work: Float64Array
  other: Float64Array
}

/**
 * Trips by a gravity model on distance (a straight line, times the detour of the roads). Work trips are held to both
 * ends (the people who live in a zone, the jobs in another); other trips only to the people who make them, drawn to
 * jobs and to people. Distance, so that where people go does not swing with a month's traffic; and, if `delay` is
 * given, the minutes the roads between a pair have slowed (one way, at the morning peak for work and at midday for the
 * rest) beyond what the city's roads were like in 2026, so that as they fill people take work and errands nearer
 * home, and a new road draws them further.
 */
export function makeTours(zones: Zone[], delay?: { work: Float32Array; other: Float32Array }): Tours {
  const Z = zones.length
  const work = new Float64Array(Z * Z)
  const other = new Float64Array(Z * Z)
  const xy = new Float64Array(2 * Z)
  for (let i = 0; i < Z; i++) toKm(zones[i]!.centre[0], zones[i]!.centre[1], xy, 2 * i)
  const dist = new Float64Array(Z * Z)
  for (let i = 0; i < Z; i++) {
    for (let j = 0; j < Z; j++) {
      const dx = xy[2 * i]! - xy[2 * j]!
      const dy = xy[2 * i + 1]! - xy[2 * j + 1]!
      dist[i * Z + j] = i === j ? DEMAND.intraZone * Math.sqrt(zones[i]!.area) * DEMAND.detour : Math.sqrt(dx * dx + dy * dy) * DEMAND.detour
    }
  }

  let jobs = 0
  for (const z of zones) jobs += z.jobs
  // Workers come from the people who live in a zone, and share out among the jobs: more people means more work trips,
  // wherever the jobs are.
  const workers = new Float64Array(Z)
  const places = new Float64Array(Z)
  let all = 0
  for (let i = 0; i < Z; i++) {
    workers[i] = DEMAND.workersPerPerson * zones[i]!.people
    all += workers[i]!
  }
  for (let i = 0; i < Z; i++) places[i] = jobs > 0 ? (all * zones[i]!.jobs) / jobs : 0

  // Work: the deterrence, then balanced to both ends in a fixed number of rounds.
  for (let i = 0; i < Z; i++) {
    for (let j = 0; j < Z; j++) {
      const ij = i * Z + j
      work[ij] = expNeg(DEMAND.workDecay * dist[ij]! + (delay ? 2 * DEMAND.delayDecay * delay.work[ij]! : 0))
    }
    // Shops, homes, sites and street trade: a share of work is close to home, more than distance alone gives.
    work[i * Z + i]! *= DEMAND.workNearHome
  }
  const row = new Float64Array(Z).fill(1)
  const col = new Float64Array(Z).fill(1)
  for (let round = 0; round < 12; round++) {
    for (let i = 0; i < Z; i++) {
      let s = 0
      for (let j = 0; j < Z; j++) s += work[i * Z + j]! * col[j]!
      row[i] = s > 0 ? workers[i]! / s : 0
    }
    // Column sums, a row at a time, to read the table in the order it lies.
    const sum = new Float64Array(Z)
    for (let i = 0; i < Z; i++) {
      const r = row[i]!
      for (let j = 0; j < Z; j++) sum[j]! += work[i * Z + j]! * r
    }
    for (let j = 0; j < Z; j++) col[j] = sum[j]! > 0 ? places[j]! / sum[j]! : 0
  }
  // Pairs with next to no work trips are left out, and the rest of the row scaled up to the same total, to save work
  // later; the balance to jobs is left out by the little they carried.
  for (let i = 0; i < Z; i++) {
    let all = 0
    let kept = 0
    for (let j = 0; j < Z; j++) {
      const v = work[i * Z + j]! * row[i]! * col[j]!
      all += v
      if (v < DEMAND.negligible) work[i * Z + j] = 0
      else {
        work[i * Z + j] = v
        kept += v
      }
    }
    for (let j = 0; j < Z; j++) work[i * Z + j]! *= all / kept
  }

  // Everything else: held to the people who travel.
  const pull = new Float64Array(Z)
  for (let j = 0; j < Z; j++) pull[j] = zones[j]!.jobs + DEMAND.otherToPeople * zones[j]!.people
  for (let i = 0; i < Z; i++) {
    let s = 0
    for (let j = 0; j < Z; j++) {
      const late = delay ? 2 * DEMAND.delayDecay * delay.other[i * Z + j]! : 0
      const v = pull[j]! * expNeg(DEMAND.otherDecay * dist[i * Z + j]! + late) * (i === j ? DEMAND.otherNearHome : 1)
      other[i * Z + j] = v
      s += v
    }
    // Pairs with next to no trips are left out, and the rest scaled up to the same total, to save work later.
    const tours = DEMAND.otherPerPerson * zones[i]!.people
    const least = (s * DEMAND.negligible) / tours
    let kept = 0
    for (let j = 0; j < Z; j++) {
      const v = other[i * Z + j]!
      if (v < least) other[i * Z + j] = 0
      else kept += v
    }
    const scale = kept > 0 ? tours / kept : 0
    for (let j = 0; j < Z; j++) other[i * Z + j]! *= scale
  }
  return { work, other }
}
