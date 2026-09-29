import { describe, expect, it } from 'vitest'
import { holdBack, linkTimes, loadTree, movingTime } from '../src/sim/assign'
import { buildNet, Tree } from '../src/sim/graph'
import { WayFinder, Ways } from '../src/sim/spread'
import { ROAD } from '../src/sim/params'
import { fixtureCity } from './sim-fixture'

describe('traffic on the roads', () => {
  const city = fixtureCity()
  const net = buildNet(city.roads, city.zones, city.roads.zoneNode)

  it('slows a link as its flow nears and passes its capacity, faster in PCU than a straight line', () => {
    const flow = new Float64Array(net.links)
    const out = new Float64Array(net.links)
    let last = 0
    for (const x of [0, 0.5, 1, 1.5, 2, 3, 5]) {
      flow[0] = x * net.capacity[0]!
      linkTimes(net, flow, out)
      expect(out[0]!).toBeGreaterThan(last)
      last = out[0]!
    }
    flow[0] = net.capacity[0]!
    linkTimes(net, flow, out)
    expect(out[0]!).toBeCloseTo((net.free[0]! + net.delay[0]!) * (1 + ROAD.alpha), 9)
  })

  it('shows no link slower than a crawl, nor passing more than it can', () => {
    const l = 0
    const most = ROAD.most * net.capacity[l]!
    const crawl = (net.length[l]! * 3.6) / ROAD.crawl
    expect(movingTime(net, l, 10 * most)).toBe(movingTime(net, l, most))
    expect(movingTime(net, l, most)).toBeLessThanOrEqual(Math.max(crawl, net.free[l]! + net.delay[l]!) + 1e-9)
    expect(movingTime(net, l, 0)).toBeCloseTo(net.free[l]! + net.delay[l]!, 9)
  })

  /** The ways from zone 0 at free flow, shared at the costs given; and the zone furthest from it. */
  const waysFrom = (cost: Float64Array) => {
    const finder = new WayFinder(net)
    finder.setCost(cost)
    const ways = new Ways(1, net)
    ways.find(0, net.firstZone, finder)
    const Z = net.joinStart.length - 1
    const time = new Float64Array(net.nodes)
    ways.times(0, cost, time, true)
    let far = 1
    for (let z = 1; z < Z; z++) if (time[net.joinNode[net.joinStart[z]!]!]! > time[net.joinNode[net.joinStart[far]!]!]!) far = z
    return { ways, Z, far }
  }
  const freeCost = () => {
    const cost = new Float64Array(net.links)
    linkTimes(net, new Float64Array(net.links), cost)
    return cost
  }

  it('holds back what a link cannot pass, so that it never reaches the links after it', () => {
    // One root, one destination far off; a flow three times what the roads can pass.
    const cost = freeCost()
    const { ways, Z, far } = waysFrom(cost)
    const demand = new Float64Array(Z)
    demand[far] = 3 * 2400 * ROAD.most
    const raw = new Float64Array(net.links)
    const atNode = new Float64Array(net.nodes)
    ways.place(0, demand, 0, 1, atNode)
    const ends = Array.from(atNode.keys()).filter((v) => atNode[v]! > 0)
    ways.load(0, atNode, raw)
    const inflow = new Float64Array(net.links)
    const pass = new Float64Array(net.links)
    holdBack(net, ways, demand, 1, 1, Z, new Int32Array(0), raw, inflow, pass)
    for (let l = 0; l < net.roadLinks; l++) {
      expect(pass[l]!).toBeLessThanOrEqual(ROAD.most * net.capacity[l]! + 1e-6)
      expect(pass[l]!).toBeLessThanOrEqual(inflow[l]! + 1e-6)
      expect(inflow[l]!).toBeLessThanOrEqual(raw[l]! + 1e-6)
    }
    // What arrives is what the narrowest links on the way let through.
    let into = 0
    for (let l = 0; l < net.links; l++) if (ends.includes(net.to[l]!)) into += pass[l]!
    expect(into).toBeLessThan(demand[far]!)
    expect(into).toBeGreaterThan(0)
  })

  it('shares trips among the near-best ways, and what leaves the start arrives at the end', () => {
    const cost = freeCost()
    const { ways, Z, far } = waysFrom(cost)
    const demand = new Float64Array(Z)
    demand[far] = 100
    const atNode = new Float64Array(net.nodes)
    ways.place(0, demand, 0, 1, atNode)
    const ends = Array.from(atNode.keys()).filter((v) => atNode[v]! > 0)
    const flow = new Float64Array(net.links)
    ways.load(0, atNode, flow)
    let into = 0, out = 0
    for (let l = 0; l < net.links; l++) {
      if (ends.includes(net.to[l]!)) into += flow[l]!
      if (net.from[l] === net.firstZone) out += flow[l]!
    }
    expect(out).toBeCloseTo(100, 9)
    expect(into).toBeGreaterThanOrEqual(100 - 1e-9)
    expect(Array.from(atNode).every((x) => x === 0)).toBe(true)
    // More than one way is used somewhere, and no link carries more than all of it.
    expect(Array.from(flow).filter((f) => f > 0 && f < 100 - 1e-9).length).toBeGreaterThan(0)
    expect(Math.max(...flow)).toBeLessThanOrEqual(100 + 1e-9)
  })

  it('moves a small share for a small change in the time of a link, and more for a larger one, away from the slower link', () => {
    const cost = freeCost()
    const { ways, Z, far } = waysFrom(cost)
    const demand = new Float64Array(Z)
    demand[far] = 100
    void ways
    const flows = (c: Float64Array) => {
      const w = waysFrom(c).ways
      const atNode = new Float64Array(net.nodes)
      w.place(0, demand, 0, 1, atNode)
      const flow = new Float64Array(net.links)
      w.load(0, atNode, flow)
      return flow
    }
    const f0 = flows(cost)
    // The busiest road link that does not carry all of it.
    let l = -1
    for (let k = 0; k < net.roadLinks; k++) if (f0[k]! > 0 && f0[k]! < 99 && (l < 0 || f0[k]! > f0[l]!)) l = k
    expect(l).toBeGreaterThanOrEqual(0)
    const moved = (seconds: number) => {
      const c = new Float64Array(cost)
      c[l]! += seconds
      return f0[l]! - flows(c)[l]!
    }
    const tiny = moved(0.001)
    const small = moved(1)
    const large = moved(60)
    expect(tiny).toBeGreaterThanOrEqual(0)
    expect(tiny).toBeLessThan(0.01)
    expect(small).toBeGreaterThan(tiny)
    expect(large).toBeGreaterThan(small)
    expect(large).toBeLessThanOrEqual(f0[l]! + 1e-9)
  })

  it('makes a link in poor repair slower and narrower', () => {
    const condition = city.roads.links.map((l) => (l.id === 0 ? 0.6 : 1))
    const poor = buildNet(city.roads, city.zones, city.roads.zoneNode, condition)
    expect(poor.free[0]!).toBeCloseTo(net.free[0]! / 0.6, 9)
    expect(poor.capacity[0]!).toBeLessThan(net.capacity[0]!)
    expect(poor.free[1]!).toBe(net.free[1]!)
  })

  it('finds the quickest routes, and never passes through a zone', () => {
    const cost = new Float64Array(net.links)
    linkTimes(net, new Float64Array(net.links), cost)
    const tree = new Tree(net)
    tree.setCost(cost)
    tree.grow(net.firstZone)
    // Every road node is reached, and each by a link whose end is reached no sooner than its start.
    for (let v = 0; v < net.firstZone; v++) {
      expect(tree.time[v]).toBeLessThan(Infinity)
      const l = tree.pred[v]!
      expect(tree.time[v]!).toBeCloseTo(tree.time[net.from[l]!]! + cost[l]!, 9)
      expect(net.from[l]! < net.firstZone || net.from[l] === net.firstZone).toBe(true)
    }
    // No link offers a shorter way than the tree found (to within the rounding the search uses).
    for (let l = 0; l < net.roadLinks; l++) {
      expect(tree.time[net.to[l]!]!).toBeLessThanOrEqual(tree.time[net.from[l]!]! + cost[l]! + 2 * ROAD.pathUnit * 12)
    }
  })

  it('loads trips along the tree so that what leaves the start arrives at the end', () => {
    const cost = new Float64Array(net.links)
    linkTimes(net, new Float64Array(net.links), cost)
    const tree = new Tree(net)
    tree.setCost(cost)
    tree.grow(net.firstZone)
    const atNode = new Float64Array(net.nodes)
    const flow = new Float64Array(net.links)
    const far = 143
    atNode[far] = 100
    loadTree(tree, net, atNode, flow)
    let into = 0
    let out = 0
    for (let l = 0; l < net.links; l++) {
      if (net.to[l] === far) into += flow[l]!
      if (net.from[l] === net.firstZone) out += flow[l]!
    }
    expect(into).toBeCloseTo(100, 9)
    expect(out).toBeCloseTo(100, 9)
    expect(Array.from(atNode).every((x) => x === 0)).toBe(true)
  })

})
