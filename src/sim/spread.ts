import { expNeg } from './fixed'
import { Tree, type Net } from './graph'
import { SPREAD } from './params'

/**
 * Routes that share a pair's trips among its near-best ways (slice 7). A tree sends all of a pair's trips by its one
 * quickest way, so that a second's change on one link can move every trip between two places at once; and since each
 * root's routes were found on the flows the roots before it left, the next trees moved too: a small change anywhere
 * reshuffled routes across the city. Here each root's trips are shared among the ways that are nearly as quick, a way
 * `extra` seconds slower than the quickest taking e^(−θ × extra) as many (Dial's method: a logit over the ways that lead
 * ever further from the root), so that the share on each link changes smoothly with every link's time, and a small
 * change moves a small share. Ways much slower than the quickest (`SPREAD.cut`) are left out, smoothly, so that few are
 * kept and the work stays small. Trips arriving at a zone are shared among its junctions in the same way.
 *
 * `Ways` keeps, for each root, the ways found (`WayFinder`): its nodes in order of distance from it and, for each node,
 * the links by which trips may reach it; and (`reweight`), at the times of the moment, the share of the trips reaching
 * each node that each of those links brings, and the share of the trips to each zone that arrive by each of its
 * junctions. Each period has its own (index.ts: each root's ways are found as it is loaded, on the times the roots
 * before it left). What is left of the old noise is that loading a root at a time still passes a small change on,
 * smoothly now, to the roots after it (docs/MODEL.md, "Slice 7").
 */
export class Ways {
  /** Where each root's entries begin, and how many nodes it reaches. */
  private readonly base: Int32Array
  readonly count: Int32Array
  /** For each root, its nodes in order (`nodes` a root), and where each node's entries begin, relative to `base`. */
  private readonly order: Int32Array
  private readonly start: Int32Array
  /** For each entry: the link. */
  private link: Int32Array
  /** For each entry, its share of the trips reaching its node. */
  private share: Float64Array
  private used = 0
  /** For each root and join of the net (zone arrivals): the share of the trips to that zone arriving by it. */
  private readonly arrive: Float64Array

  constructor(
    roots: number,
    private net: Net,
  ) {
    const n = net.nodes
    this.base = new Int32Array(roots)
    this.count = new Int32Array(roots)
    this.order = new Int32Array(roots * n)
    this.start = new Int32Array(roots * (n + 1))
    const size = roots * (n + 64)
    this.link = new Int32Array(size)
    this.share = new Float64Array(size)
    this.arrive = new Float64Array(roots * net.joinNode.length)
  }

  /**
   * Ways for `roots` roots on `net`, reusing the one kept for `slot` from an earlier month if its arrays are large
   * enough (a month would otherwise make tens of megabytes of arrays to throw away). Only one month is worked out at a
   * time, and every root's ways are written before they are read, so nothing of an earlier month or another city is
   * ever read. Slice 8: kept by slot alone, not by the network's size, so that a server working out many players'
   * cities, each with its own roads, keeps three and no more.
   */
  static for(roots: number, net: Net, slot: number): Ways {
    let w = pool[slot]
    const n = net.nodes
    if (!w || w.base.length < roots || w.order.length < roots * n || w.start.length < roots * (n + 1) || w.arrive.length < roots * net.joinNode.length) {
      w = new Ways(roots, net)
      pool[slot] = w
    }
    w.net = net
    w.used = 0
    return w
  }

  /**
   * Finds root `o`'s ways from node `root` with `finder` (at the costs last given it) and keeps them, written straight
   * into this root's place. Each root is kept once.
   */
  find(o: number, root: number, finder: WayFinder): void {
    const n = this.net.nodes
    // A root has at most one entry for each link.
    if (this.used + this.net.links > this.link.length) {
      const size = Math.max(this.used + this.net.links, Math.ceil(this.link.length * 1.5))
      const link = new Int32Array(size)
      link.set(this.link.subarray(0, this.used))
      this.link = link
      const share = new Float64Array(size)
      share.set(this.share.subarray(0, this.used))
      this.share = share
    }
    const entries = finder.grow(root, this.order, o * n, this.start, o * (n + 1), this.link, this.share, this.used, this.arrive, o * this.net.joinNode.length)
    this.base[o] = this.used
    this.count[o] = finder.count
    this.used += entries
  }

  /** Keeps root `o`'s ways as `other` has them (found on the same costs, so the same ways). */
  copy(o: number, other: Ways): void {
    const n = this.net.nodes
    const J = this.net.joinNode.length
    const count = other.count[o]!
    const entries = other.start[o * (n + 1) + count]!
    if (this.used + entries > this.link.length) {
      const size = Math.max(this.used + entries, Math.ceil(this.link.length * 1.5))
      const link = new Int32Array(size)
      link.set(this.link.subarray(0, this.used))
      this.link = link
      const share = new Float64Array(size)
      share.set(this.share.subarray(0, this.used))
      this.share = share
    }
    const b = other.base[o]!
    this.base[o] = this.used
    this.count[o] = count
    this.order.set(other.order.subarray(o * n, o * n + count), o * n)
    this.start.set(other.start.subarray(o * (n + 1), o * (n + 1) + count + 1), o * (n + 1))
    this.link.set(other.link.subarray(b, b + entries), this.used)
    this.share.set(other.share.subarray(b, b + entries), this.used)
    this.arrive.set(other.arrive.subarray(o * J, o * J + J), o * J)
    this.used += entries
  }

  /**
   * Adds up `value` of each link from root `o` to each node (into `out`, by node) along its ways: averaged by the shares
   * ; or, with `least`, the least over the ways kept (for times: the quickest of them at those costs).
   */
  times(o: number, value: Float64Array, out: Float64Array, least = false): void {
    const n = this.net.nodes
    const { order, start, link } = this
    const share = this.share
    const from = this.net.from
    const count = this.count[o]!
    const at = o * n
    const st = o * (n + 1)
    const b = this.base[o]!
    out.fill(Infinity)
    out[order[at]!] = 0
    if (least) {
      for (let k = 1; k < count; k++) {
        let t = Infinity
        for (let j = b + start[st + k]!, end = b + start[st + k + 1]!; j < end; j++) {
          const l = link[j]!
          const x = out[from[l]!]! + value[l]!
          if (x < t) t = x
        }
        out[order[at + k]!] = t
      }
      return
    }
    for (let k = 1; k < count; k++) {
      let t = 0
      for (let j = b + start[st + k]!, end = b + start[st + k + 1]!; j < end; j++) {
        const s = share[j]!
        if (s === 0) continue
        const l = link[j]!
        t += s * (out[from[l]!]! + value[l]!)
      }
      out[order[at + k]!] = t
    }
  }

  /**
   * For each zone, `value` at its junctions (by node) with `extra` for its side streets (by join), averaged over the
   * junctions the trips from root `o` arrive by; or, with `least`, the least of them. Into `out` from `row`.
   */
  arrivals(o: number, value: Float64Array, extra: Float64Array, out: Float32Array | Float64Array, row: number, least = false): void {
    const { joinStart, joinNode } = this.net
    const J = joinNode.length
    const a = this.arrive
    const Z = joinStart.length - 1
    for (let z = 0; z < Z; z++) {
      let t = least ? Infinity : 0
      for (let k = joinStart[z]!, end = joinStart[z + 1]!; k < end; k++) {
        const s = a[o * J + k]!
        if (!(s > 0)) continue
        const x = value[joinNode[k]!]! + extra[k]!
        if (!least) t += s * x
        else if (x < t) t = x
      }
      out[row + z] = t
    }
  }

  /**
   * Several of `times` from root `o` in one pass over its ways (slice 8, for speed): `k` values a link, interleaved
   * (`value[l × k + i]`), into `out` by node, interleaved likewise (`out[v × k + i]`). The first `least` of them take
   * the least over the ways, as `times` with `least`; the rest the average by the shares. Each is added up exactly as
   * `times` adds it up alone.
   */
  sweep(o: number, k: number, least: number, value: Float64Array, out: Float64Array): void {
    const n = this.net.nodes
    const { order, start, link } = this
    const share = this.share
    const from = this.net.from
    const count = this.count[o]!
    const at = o * n
    const st = o * (n + 1)
    const b = this.base[o]!
    out.fill(Infinity, 0, n * k)
    const r = order[at]! * k
    for (let i = 0; i < k; i++) out[r + i] = 0
    for (let q = 1; q < count; q++) {
      const v = order[at + q]! * k
      for (let i = 0; i < least; i++) out[v + i] = Infinity
      for (let i = least; i < k; i++) out[v + i] = 0
      for (let j = b + start[st + q]!, end = b + start[st + q + 1]!; j < end; j++) {
        const l = link[j]!
        const u = from[l]! * k
        const c = l * k
        for (let i = 0; i < least; i++) {
          const x = out[u + i]! + value[c + i]!
          if (x < out[v + i]!) out[v + i] = x
        }
        const s = share[j]!
        if (s === 0) continue
        for (let i = least; i < k; i++) out[v + i] = out[v + i]! + s * (out[u + i]! + value[c + i]!)
      }
    }
  }

  /** As `arrivals`, for the `i`th of the `k` values interleaved in `value` (as `sweep` gives them). */
  arrivalsOf(o: number, value: Float64Array, k: number, i: number, extra: Float64Array, out: Float32Array | Float64Array, row: number, least = false): void {
    const { joinStart, joinNode } = this.net
    const J = joinNode.length
    const a = this.arrive
    const Z = joinStart.length - 1
    for (let z = 0; z < Z; z++) {
      let t = least ? Infinity : 0
      for (let q = joinStart[z]!, end = joinStart[z + 1]!; q < end; q++) {
        const s = a[o * J + q]!
        if (!(s > 0)) continue
        const x = value[joinNode[q]! * k + i]! + extra[q]!
        if (!least) t += s * x
        else if (x < t) t = x
      }
      out[row + z] = t
    }
  }

  /** Puts `trips` to each zone (from `row`, times `scale`) at the junctions they arrive by, into `atNode`. */
  place(o: number, trips: ArrayLike<number>, row: number, scale: number, atNode: Float64Array): void {
    const { joinStart, joinNode } = this.net
    const J = joinNode.length
    const a = this.arrive
    const Z = joinStart.length - 1
    for (let z = 0; z < Z; z++) {
      const d = trips[row + z]!
      if (d === 0) continue
      for (let k = joinStart[z]!, end = joinStart[z + 1]!; k < end; k++) {
        const s = a[o * J + k]!
        if (s > 0) atNode[joinNode[k]!]! += d * scale * s
      }
    }
  }

  /** Adds the trips ending at each node (`atNode`, emptied as it goes) along root `o`'s ways into `flow`. */
  load(o: number, atNode: Float64Array, flow: Float64Array): void {
    const n = this.net.nodes
    const { order, start, link } = this
    const share = this.share
    const from = this.net.from
    const at = o * n
    const st = o * (n + 1)
    const b = this.base[o]!
    for (let k = this.count[o]! - 1; k > 0; k--) {
      const v = order[at + k]!
      const f = atNode[v]!
      if (f === 0) continue
      atNode[v] = 0
      for (let j = b + start[st + k]!, end = b + start[st + k + 1]!; j < end; j++) {
        const s = share[j]!
        if (s === 0) continue
        const l = link[j]!
        const x = f * s
        flow[l]! += x
        atNode[from[l]!]! += x
      }
    }
    atNode[order[at]!] = 0
  }

  /**
   * As `load`, keeping besides what each of root `o`'s entries carried (into `kept`, by entry, 0 for those that carried
   * nothing), so that `follow` need not find it again.
   */
  loadKeep(o: number, atNode: Float64Array, flow: Float64Array, kept: Float64Array): void {
    const n = this.net.nodes
    const { order, start, link } = this
    const share = this.share
    const from = this.net.from
    const at = o * n
    const st = o * (n + 1)
    const b = this.base[o]!
    const count = this.count[o]!
    kept.fill(0, b, b + start[st + count]!)
    for (let k = count - 1; k > 0; k--) {
      const v = order[at + k]!
      const f = atNode[v]!
      if (f === 0) continue
      atNode[v] = 0
      for (let j = b + start[st + k]!, end = b + start[st + k + 1]!; j < end; j++) {
        const s = share[j]!
        if (s === 0) continue
        const l = link[j]!
        const x = f * s
        flow[l]! += x
        atNode[from[l]!]! += x
        kept[j] = x
      }
    }
    atNode[order[at]!] = 0
  }

  /** Entries kept for all roots so far: the size `kept` must have for `loadKeep`. */
  get entries(): number {
    return this.used
  }

  /**
   * As `load` twice, for two sets of trips (`atA` into `flowA`, `atB` into `flowB`) in one pass over the ways: each
   * flow gets the same sums in the same order as from `load` alone, so the result is the same to the last bit.
   */
  load2(o: number, atA: Float64Array, flowA: Float64Array, atB: Float64Array, flowB: Float64Array): void {
    const n = this.net.nodes
    const { order, start, link } = this
    const share = this.share
    const from = this.net.from
    const at = o * n
    const st = o * (n + 1)
    const b = this.base[o]!
    for (let k = this.count[o]! - 1; k > 0; k--) {
      const v = order[at + k]!
      const fa = atA[v]!
      const fb = atB[v]!
      if (fa === 0 && fb === 0) continue
      atA[v] = 0
      atB[v] = 0
      for (let j = b + start[st + k]!, end = b + start[st + k + 1]!; j < end; j++) {
        const s = share[j]!
        if (s === 0) continue
        const l = link[j]!
        const u = from[l]!
        if (fa !== 0) {
          const x = fa * s
          flowA[l]! += x
          atA[u]! += x
        }
        if (fb !== 0) {
          const x = fb * s
          flowB[l]! += x
          atB[u]! += x
        }
      }
    }
    atA[order[at]!] = 0
    atB[order[at]!] = 0
  }

  /**
   * The peak spreads (see `holdBack` in assign.ts): the trips ending at each node (`atNode`, emptied) followed along
   * root `o`'s ways, each link letting through `pass` of what reaches it. Adds to `into` what would
   * enter each link, to `out` what it passes, and to `all` (if given) all that was sent along it.
   */
  follow(
    o: number,
    atNode: Float64Array,
    pass: Float64Array,
    onLink: Float64Array,
    reach: Float64Array,
    into: Float64Array,
    out: Float64Array,
    all: Float64Array | null,
    kept?: Float64Array,
  ): void {
    const n = this.net.nodes
    const { order, start, link } = this
    const share = this.share
    const from = this.net.from
    const count = this.count[o]!
    const at = o * n
    const st = o * (n + 1)
    const b = this.base[o]!
    if (kept) {
      // What each entry carried from this root, as `loadKeep` kept it: the same as the pass below finds.
      reach[order[at]!] = 1
      for (let k = 1; k < count; k++) {
        let r = 0
        for (let j = b + start[st + k]!, end = b + start[st + k + 1]!; j < end; j++) {
          const s = share[j]!
          if (s === 0) continue
          const l = link[j]!
          const got = reach[from[l]!]!
          const t = got * pass[l]!
          r += s * t
          const f = kept[j]!
          if (f === 0) continue
          into[l]! += f * got
          out[l]! += f * t
          if (all) all[l]! += f
        }
        reach[order[at + k]!] = r
      }
      return
    }
    // What each link carries from this root.
    for (let k = count - 1; k > 0; k--) {
      const v = order[at + k]!
      const f = atNode[v]!
      if (f === 0) continue
      atNode[v] = 0
      for (let j = b + start[st + k]!, end = b + start[st + k + 1]!; j < end; j++) {
        const s = share[j]!
        if (s === 0) continue
        const l = link[j]!
        const x = f * s
        onLink[l] = x
        atNode[from[l]!]! += x
      }
    }
    atNode[order[at]!] = 0
    // The share of it that gets through to each node, and so what enters and passes each link.
    reach[order[at]!] = 1
    for (let k = 1; k < count; k++) {
      let r = 0
      for (let j = b + start[st + k]!, end = b + start[st + k + 1]!; j < end; j++) {
        const s = share[j]!
        if (s === 0) continue
        const l = link[j]!
        const got = reach[from[l]!]!
        const t = got * pass[l]!
        r += s * t
        const f = onLink[l]!
        if (f === 0) continue
        onLink[l] = 0
        into[l]! += f * got
        out[l]! += f * t
        if (all) all[l]! += f
      }
      reach[order[at + k]!] = r
    }
  }
}

const pool: (Ways | undefined)[] = []

/**
 * Finds each root's ways (see `Ways`), reusing its arrays from root to root: the quickest tree at the costs given, and
 * besides each tree link, every link that leads further from the root on a way less than `SPREAD.cut` slower than the
 * quickest. One barely leading further (under `SPREAD.near` seconds) counts in proportion, so that a link turning round
 * comes into and goes out of the ways smoothly.
 */
export class WayFinder {
  readonly tree: Tree
  /** Distance of each node from the root along the quickest tree, at the costs routes are found on. */
  readonly dist: Float64Array
  /** Nodes reached by the last root. */
  count = 0
  /** The weight of the ways from the root to each node. */
  private readonly total: Float64Array
  private route: Float64Array | null = null

  constructor(private readonly net: Net) {
    const n = net.nodes
    this.tree = new Tree(net)
    this.dist = new Float64Array(n)
    this.total = new Float64Array(n)
  }

  /** Sets the costs ways are found on, in seconds (tolls included, as the time they are worth). */
  setCost(route: Float64Array): void {
    this.route = route
    this.tree.setCost(route)
  }

  /**
   * Finds the ways from `root`, and writes them from the places given: the nodes in order (`order` from `orderAt`),
   * where each node's entries begin (`start` from `startAt`, counted from the first entry), each entry's link and
   * share (`links` and `shares` from `linkAt`), and the share of the trips to each zone arriving by each of its
   * junctions (`arrive` from `arriveAt`, by join). Gives the number of entries.
   */
  grow(
    root: number,
    order: Int32Array,
    orderAt: number,
    start: Int32Array,
    startAt: number,
    links: Int32Array,
    share: Float64Array,
    linkAt: number,
    arrive: Float64Array,
    arriveAt: number,
  ): number {
    const { tree, dist, net } = this
    const route = this.route!
    tree.grow(root)
    // Distances along the tree found on whole seconds, added up exactly, and the nodes put in their order (the tree's
    // order is nearly that already, but for a few swaps where whole seconds rounded differently; ties keep the tree's
    // order, which puts a node after the one it is reached from).
    dist.set(tree.time)
    const n = tree.count
    const { inStart, inLink, from } = net
    const pred = tree.pred
    for (let k = 0; k < n; k++) {
      const v = tree.order[k]!
      const d = dist[v]!
      let i = k - 1
      while (i >= 0) {
        const u = order[orderAt + i]!
        if (dist[u]! <= d) break
        order[orderAt + i + 1] = u
        i--
      }
      order[orderAt + i + 1] = v
    }
    this.count = n
    const { theta, flat, cut, near } = SPREAD
    const slope = 1 / (cut - flat)
    const total = this.total
    let e = linkAt
    start[startAt] = 0
    start[startAt + 1] = 0
    total[order[orderAt]!] = 1
    for (let k = 1; k < n; k++) {
      const v = order[orderAt + k]!
      const dv = dist[v]!
      const own = pred[v]!
      const first = e
      let kept = first
      let w = 0
      for (let j = inStart[v]!, end = inStart[v + 1]!; j < end; j++) {
        const l = inLink[j]!
        const u = from[l]!
        const du = dist[u]!
        if (l === own) kept = e
        else if (!(du < dv)) continue
        const extra = du + route[l]! - dv
        if (!(extra < cut)) continue
        // As many by each way as it is nearly the quickest; one barely leading further counts in proportion, so that a
        // way comes into and goes out of those kept smoothly.
        const ahead = dv - du
        let a = extra > 0 ? expNeg(theta * extra) : 1
        if (extra > flat) a *= (cut - extra) * slope
        if (ahead < near) a *= ahead > 0 ? ahead / near : 0
        a *= total[u]!
        links[e] = l
        share[e] = a
        w += a
        e++
      }
      if (w > 0) {
        total[v] = w
        const inv = 1 / w
        for (let j = first; j < e; j++) share[j] = share[j]! * inv
      } else {
        // Reached only by links of no length: by the tree's own, all.
        total[v] = total[from[own]!]!
        for (let j = first; j < e; j++) share[j] = j === kept ? 1 : 0
      }
      start[startAt + k + 1] = e - linkAt
    }
    // Trips to a zone arrive by its junctions in the same way.
    arrivalShares(net, dist, arrive, arriveAt)
    return e - linkAt
  }
}

/** The share of trips to each zone arriving by each of its junctions (by join, into `out` from `at`), given the times to each junction. */
function arrivalShares(net: Net, time: Float64Array, out: Float64Array, at: number): void {
  const { joinStart, joinNode, joinTime } = net
  const { theta, flat, cut } = SPREAD
  const Z = joinStart.length - 1
  for (let z = 0; z < Z; z++) {
    let best = Infinity
    const b = joinStart[z]!, end = joinStart[z + 1]!
    for (let k = b; k < end; k++) {
      const x = time[joinNode[k]!]! + joinTime[k]!
      if (x < best) best = x
    }
    let w = 0
    for (let k = b; k < end; k++) {
      const extra = time[joinNode[k]!]! + joinTime[k]! - best
      let a = 0
      if (best < Infinity && extra < cut) {
        a = extra > 0 ? expNeg(theta * extra) : 1
        if (extra > flat) a *= (cut - extra) / (cut - flat)
      }
      out[at + k] = a
      w += a
    }
    for (let k = b; k < end; k++) out[at + k] = w > 0 ? out[at + k]! / w : 0
  }
}
