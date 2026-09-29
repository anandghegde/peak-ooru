import type { Net, Tree } from './graph'
import type { Ways } from './spread'
import { ROAD } from './params'

/**
 * Seconds to cross a link of free time t0, signal delay d and capacity c when v passenger-car units an hour would
 * enter it at the busiest hour. Up to `ROAD.most` times capacity, the time grows with the fourth power of the flow
 * (BPR's form); beyond, the link passes no more, and those who would enter wait in a queue before it or set out
 * earlier or later, which costs `ROAD.queue` minutes for each further `most` times capacity that would enter.
 */
function linkTime(t0: number, d: number, c: number, v: number, least: number): number {
  const a = ROAD.alpha
  const m = ROAD.most
  const x = v / c
  let t: number
  if (x <= m) {
    const x2 = x * x
    t = (t0 + d) * (1 + a * x2 * x2)
  } else {
    const m2 = m * m
    t = (t0 + d) * (1 + a * m2 * m2) + ROAD.queue * 60 * (x / m - 1)
  }
  // A speed limit: never quicker than it allows, and no slower for it where traffic is slower anyway.
  return least + d > t ? least + d : t
}

/**
 * Seconds to cross each link when the given flows would enter it, the queue before it included: what routes and
 * travellers weigh.
 */
export function linkTimes(net: Net, flow: Float64Array, out: Float64Array): void {
  for (let l = 0; l < net.links; l++) out[l] = linkTime(net.free[l]!, net.delay[l]!, net.capacity[l]!, flow[l]!, net.least[l]!)
}

/**
 * Seconds to cross a link, queue left out, at the flow it passes (at most `ROAD.most` times capacity): what is seen
 * on the road. Never slower than a crawl.
 */
export function movingTime(net: Net, l: number, pass: number): number {
  const x = pass / net.capacity[l]!
  const m = ROAD.most
  const y = x < m ? x : m
  const y2 = y * y
  const free = net.free[l]! + net.delay[l]!
  let t = free * (1 + ROAD.alpha * y2 * y2)
  const limited = net.least[l]! + net.delay[l]!
  if (limited > t) t = limited
  const crawl = (net.length[l]! * 3.6) / ROAD.crawl
  return t < crawl ? t : crawl > free ? crawl : free
}

/**
 * As `movingTime` and `lightTime`, but on the road as it would be with its surface in perfect repair and open all month
 * (slice 6): for road deaths, which must not fall because a road is slow for its potholes, and for the delay a road's
 * surface causes. Exactly `movingTime` and `lightTime` on a road in perfect repair.
 */
export function goodMovingTime(net: Net, l: number, pass: number): number {
  const x = (pass * net.surfaceCapacity[l]!) / net.capacity[l]!
  const m = ROAD.most
  const y = x < m ? x : m
  const y2 = y * y
  const free = goodFree(net, l) + net.delay[l]!
  let t = free * (1 + ROAD.alpha * y2 * y2)
  const limited = net.least[l]! + net.delay[l]!
  if (limited > t) t = limited
  const crawl = (net.length[l]! * 3.6) / ROAD.crawl
  return t < crawl ? t : crawl > free ? crawl : free
}

export function goodLightTime(net: Net, l: number): number {
  const f = goodFree(net, l)
  return net.least[l]! > f ? net.least[l]! : f
}

function goodFree(net: Net, l: number): number {
  const ks = net.surfaceSpeed[l]!
  const sh = net.shut[l]!
  if (ks === 1 && sh === 0) return net.free[l]!
  return sh < 1 ? net.free[l]! * ks * (1 - sh) : net.base[l]!
}

/** Seconds to cross a link at light traffic in the month's condition, held to its speed limit, signals left out. */
export function lightTime(net: Net, l: number): number {
  return net.least[l]! > net.free[l]! ? net.least[l]! : net.free[l]!
}

/** Adds the demand at each node (`atNode`, emptied as it goes) along the tree in hand into `flow`. */
export function loadTree(tree: Tree, net: Net, atNode: Float64Array, flow: Float64Array): void {
  const { order, pred } = tree
  const from = net.from
  for (let k = tree.count - 1; k > 0; k--) {
    const v = order[k]!
    const f = atNode[v]!
    if (f === 0) continue
    atNode[v] = 0
    const l = pred[v]!
    flow[l]! += f
    atNode[from[l]!]! += f
  }
  atNode[order[0]!] = 0
}

/**
 * The peak spreads (PRD CITY-22a). A link passes at most `ROAD.most` times its capacity in the busiest hour; the
 * trips beyond that are held back before it, into the shoulders of the peak, and so never reach the links after it
 * in that hour. Each trip's ways are followed from its start: the share of it that gets through each link is the
 * share that got through the links before, times the share the link lets pass, which is set by the flow that reaches
 * it. That flow is first estimated from one root in `ROAD.holdSample` (at each link, the share of those roots' flow
 * that reaches it, held back by the links before as their own flows would hold it), then worked out for every root.
 * Writes the flow that would enter each link after the holding back upstream (`inflow`), and the flow it passes
 * (`pass`). Given `kept` (slice 8), what each root's entries carried, as `Ways.loadKeep` kept it when `raw` was
 * loaded, it is not found again.
 */
export function holdBack(
  net: Net,
  ways: Ways,
  demand: Float64Array,
  perHour: number,
  roots: number,
  stride: number,
  gatewayNodes: Int32Array,
  raw: Float64Array,
  inflow: Float64Array,
  pass: Float64Array,
  kept?: Float64Array,
): void {
  const L = net.links
  const N = net.nodes
  const zones = net.joinStart.length - 1
  const most = ROAD.most
  const share = new Float64Array(L)
  const atNode = new Float64Array(N)
  const onLink = new Float64Array(L)
  const reach = new Float64Array(N)
  const sampled = new Float64Array(L)
  /** Follows every `every`th root's trips, adding what would enter each link to `into`, what passes to `out`, and all of it to `all`. */
  const follow = (every: number, into: Float64Array, out: Float64Array, all: Float64Array | null) => {
    for (let o = 0; o < roots; o += every) {
      if (!kept) {
        const row = o * stride
        ways.place(o, demand, row, perHour, atNode)
        for (let g = 0; g < gatewayNodes.length; g++) atNode[gatewayNodes[g]!]! += demand[row + zones + g]! * perHour
      }
      ways.follow(o, atNode, share, onLink, reach, into, out, all, kept)
    }
  }
  const setShares = (u: Float64Array) => {
    for (let l = 0; l < L; l++) {
      const cap = most * net.capacity[l]!
      share[l] = u[l]! > cap ? cap / u[l]! : 1
    }
  }
  // The estimate, on the flows before any holding back.
  setShares(raw)
  inflow.fill(0)
  pass.fill(0)
  follow(ROAD.holdSample, inflow, pass, sampled)
  for (let l = 0; l < L; l++) inflow[l] = sampled[l]! > 0 ? (raw[l]! * inflow[l]!) / sampled[l]! : raw[l]!
  setShares(inflow)
  inflow.fill(0)
  pass.fill(0)
  follow(1, inflow, pass, null)
  for (let l = 0; l < L; l++) {
    const cap = most * net.capacity[l]!
    if (pass[l]! > cap) pass[l] = cap
  }
}
