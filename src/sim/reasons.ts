import { loadTree } from './assign'
import { makeTours } from './demand'
import { buildNet, Tree } from './graph'
import { TIMING } from './params'
import type { CityState, MonthResult, Period } from './types'
import { PERIODS } from './types'
import { modelZones } from './zones'

/** A road's part in a zone's delay: the routing link, and the seconds its residents lose on it a weekday. */
export interface RoadDelay {
  link: number
  seconds: number
}

/**
 * Which roads a zone's commuters lose their time on (PRD SCORE-14, "why is this bad?"): the zone's work trips
 * leaving it in the period, sent over its quickest routes at the month's speeds, and on each link the time lost to
 * traffic there, largest first. Worked out on demand from the month's result, so the result need not carry it.
 */
export function delayByRoad(state: CityState, result: MonthResult, zone: number, period: Period, top = 5): RoadDelay[] {
  const grouped = modelZones(state.zones, state.roads.zoneNode)
  const net = buildNet(state.roads, grouped.zones, grouped.node, state.condition, { works: state.works, bus: state.busLanes, limits: state.limits })
  const Z = grouped.zones.length
  const speed = result.speed[period]
  // Link times at the month's speeds, and at free flow.
  const cost = new Float64Array(net.links)
  const free = new Float64Array(net.links)
  const route = new Float64Array(net.links)
  for (let l = 0; l < net.links; l++) {
    free[l] = net.free[l]! + net.delay[l]!
    // Speed is a share of the speed at light traffic, stops at signals included.
    cost[l] = l < net.roadLinks ? ((Math.max(net.base[l]!, net.least[l]!) + net.delay[l]!) * 1000) / Math.max(1, speed[l]!) : free[l]!
    route[l] = cost[l]! + net.tollSeconds[l]!
  }
  const tree = new Tree(net)
  tree.setCost(route, cost)
  const i = grouped.of[zone]!
  tree.grow(net.firstZone + i)
  // The zone's work trips leaving in the period, to the best junction of each destination.
  const work = makeTours(grouped.zones).work
  const share = TIMING.workOut[PERIODS.indexOf(period)]!
  const atNode = new Float64Array(net.nodes)
  for (let j = 0; j < Z; j++) {
    if (j === i) continue
    let best = Infinity
    let at = -1
    for (let k = net.joinStart[j]!; k < net.joinStart[j + 1]!; k++) {
      const t = tree.time[net.joinNode[k]!]! + net.joinTime[k]!
      if (t < best) {
        best = t
        at = net.joinNode[k]!
      }
    }
    atNode[at]! += work[i * Z + j]! * share
  }
  const trips = new Float64Array(net.links)
  loadTree(tree, net, atNode, trips)
  const out: RoadDelay[] = []
  for (let l = 0; l < net.roadLinks; l++) {
    const lost = trips[l]! * (cost[l]! - free[l]!)
    if (lost > 0) out.push({ link: l, seconds: Math.round(lost) })
  }
  return out.sort((a, b) => b.seconds - a.seconds || a.link - b.link).slice(0, top)
}
