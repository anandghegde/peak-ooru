import { PERIODS, type MonthResult, type Period, type RoutingLink, type RoutingNetwork } from '../sim/types'

/** How slow a stretch is, as the map colours it: 0 moving well, 1 slow, 2 very slow, 3 jammed. */
export type Level = 0 | 1 | 2 | 3

/**
 * Where each level starts, as a share of free speed in thousandths: under 65% of free speed is slow, under 45% very
 * slow, under 30% jammed. On a road free at 50 km/h that is 32, 22 and 15 km/h.
 */
export const LEVELS = [650, 450, 300]

export function level(share: number): Level {
  return share < LEVELS[2]! ? 3 : share < LEVELS[1]! ? 2 : share < LEVELS[0]! ? 1 : 0
}

/**
 * A month's traffic as the map draws it: by drawn stretch rather than routing link. Worked out in the worker, and
 * sent to the page without copying.
 */
export interface TrafficView {
  /** Drawn stretches, by id. */
  stretches: number
  /** For each period, each stretch's level, the worse of its two directions. */
  level: Record<Period, Uint8Array>
  /**
   * For each stretch, direction (0: the way it is drawn, 1: against) and period, in that order: vehicles on each
   * kilometre, and their speed in km/h. Zero where no traffic runs that way.
   */
  density: Float32Array
  kmh: Float32Array
  /** Average speed on the main roads (primary and above) at the morning and evening peaks, km/h, by distance. */
  peakKmh: number
  /** Roads the player built, which stand for no drawn stretch: each link's line and its level in each period. */
  extra?: { link: number; line: number[]; level: number[] }[]
  /** Roads shut by flooding this month: each link's stretches, its ends, and the days it was shut. */
  flooded?: { link: number; drawn: number[]; days: number; ends: number[] }[]
}

/** Index into `density` and `kmh`. */
export function slot(stretch: number, direction: 0 | 1, period: number): number {
  return (stretch * 2 + direction) * 4 + period
}

/** Turns a month's traffic on the routing links into the view the map draws. */
export function trafficView(
  roads: RoutingNetwork,
  result: MonthResult,
  /** Km an hour on a link, from the model, which knows how long its signals hold traffic. */
  kmhOf?: (period: Period, link: RoutingLink) => number,
): TrafficView {
  let stretches = 0
  for (const l of roads.links) for (const d of l.drawn) stretches = Math.max(stretches, d + 1)
  const levels = {} as Record<Period, Uint8Array>
  const density = new Float32Array(stretches * 8)
  const kmh = new Float32Array(stretches * 8)
  let distance = 0
  let hours = 0
  PERIODS.forEach((period, p) => {
    const worst = (levels[period] = new Uint8Array(stretches))
    const flows = result.flow[period]
    const shares = result.speed[period]
    roads.links.forEach((link, i) => {
      const share = shares[i]!
      const speed = Math.max(1, kmhOf ? kmhOf(period, link) : (link.speed * share) / 1000)
      const flow = flows[i]!
      const l = level(share)
      link.drawn.forEach((s, k) => {
        if (l > worst[s]!) worst[s] = l
        const at = slot(s, link.forward[k] ? 0 : 1, p)
        // Where several links stand on one stretch, the busiest is shown.
        if (flow / speed > density[at]!) {
          density[at] = flow / speed
          kmh[at] = speed
        }
      })
      const main = link.kind === 'motorway' || link.kind === 'trunk' || link.kind === 'primary'
      if (main && (period === 'morning' || period === 'evening') && flow > 0) {
        distance += flow * link.length
        hours += (flow * link.length) / speed
      }
    })
  })
  return { stretches, level: levels, density, kmh, peakKmh: hours > 0 ? distance / hours : 0 }
}

/** The arrays in a view, to hand to another thread without copying. */
export function transferables(result: MonthResult | null, view: TrafficView): ArrayBuffer[] {
  const arrays = [
    ...(result ? [...Object.values(result.flow), ...Object.values(result.speed), result.commuteByZone, result.accessByZone] : []),
    ...Object.values(view.level),
    view.density,
    view.kmh,
  ]
  return [...new Set(arrays.map((a) => a.buffer as ArrayBuffer))]
}
