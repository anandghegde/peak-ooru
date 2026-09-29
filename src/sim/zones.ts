import type { Zone } from '../data/types'
import { toKm } from './graph'
import { GROUPING } from './params'

/** The zones the model works on: wards grouped with their neighbours, and the zones outside the wards as they are. */
export interface ModelZones {
  zones: Zone[]
  /** For each zone of the game, the model zone it belongs to. */
  of: Int32Array
  /** For each model zone, the routing node of its most populous member. */
  node: number[]
}

/**
 * Groups the city's small wards (the median is 1.1 km²) with their nearest neighbours, so that the model works on
 * about half as many zones as the game shows: the work of choosing modes grows with the square of their number. The
 * smallest group is joined to the nearest other, again and again, until the wards are in `GROUPING.share` as many
 * groups. Results for a group are given to each of its wards.
 */
export function modelZones(zones: Zone[], zoneNode: number[]): ModelZones {
  const Z = zones.length
  const group = Int32Array.from({ length: Z }, (_, z) => z)
  const area = Float64Array.from(zones, (z) => z.area)
  const people = Float64Array.from(zones, (z) => z.people)
  const xy = new Float64Array(2 * Z)
  for (let z = 0; z < Z; z++) toKm(zones[z]!.centre[0], zones[z]!.centre[1], xy, 2 * z)
  const alive = zones.map((z) => z.ward !== undefined)
  let wards = alive.filter((a) => a).length
  const target = Math.ceil(wards * GROUPING.share)
  while (wards > target) {
    // The smallest group (by area, then by number), and its nearest other group of wards.
    let a = -1
    for (let z = 0; z < Z; z++) if (alive[z] && (a < 0 || area[z]! < area[a]!)) a = z
    let b = -1
    let near = Infinity
    for (let z = 0; z < Z; z++) {
      if (!alive[z] || z === a) continue
      const dx = xy[2 * z]! - xy[2 * a]!
      const dy = xy[2 * z + 1]! - xy[2 * a + 1]!
      const d = dx * dx + dy * dy
      if (d < near) {
        near = d
        b = z
      }
    }
    if (b < 0) break
    // Group a joins group b, whose centre moves to the weighted middle of the two.
    const pa = people[a]!
    const pb = people[b]!
    xy[2 * b] = (xy[2 * a]! * pa + xy[2 * b]! * pb) / (pa + pb)
    xy[2 * b + 1] = (xy[2 * a + 1]! * pa + xy[2 * b + 1]! * pb) / (pa + pb)
    area[b]! += area[a]!
    people[b]! += pa
    alive[a] = false
    for (let z = 0; z < Z; z++) if (group[z] === a) group[z] = b
    wards--
  }

  // Number the groups in the order of their first member, and build each.
  const index = new Int32Array(Z).fill(-1)
  const members: number[][] = []
  for (let z = 0; z < Z; z++) {
    const g = group[z]!
    if (index[g]! < 0) {
      index[g] = members.length
      members.push([])
    }
    members[index[g]!]!.push(z)
  }
  const of = Int32Array.from(group, (g) => index[g]!)
  const node: number[] = []
  const model = members.map((list, id) => {
    let p = 0, j = 0, a = 0, lng = 0, lat = 0, income = 0
    let biggest = list[0]!
    for (const z of list) {
      const zone = zones[z]!
      p += zone.people
      j += zone.jobs
      a += zone.area
      lng += zone.centre[0] * zone.people
      lat += zone.centre[1] * zone.people
      income += zone.income * zone.people
      if (zone.people > zones[biggest]!.people) biggest = z
    }
    node.push(zoneNode[biggest]!)
    const first = zones[list[0]!]!
    const zone: Zone = {
      id,
      name: first.name,
      nameKn: first.nameKn,
      node: first.node,
      centre: [lng / p, lat / p],
      area: a,
      people: p,
      jobs: j,
      income: Math.min(5, Math.max(1, Math.round(income / p))) as Zone['income'],
    }
    if (first.ward) zone.ward = first.ward
    return zone
  })
  return { zones: model, of, node }
}
