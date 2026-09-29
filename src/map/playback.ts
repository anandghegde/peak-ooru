import type { Map as MapLibre } from 'maplibre-gl'
import type { Network } from '../data/types'
import type { TrafficView } from '../game/traffic'
import { PERIODS, type Period } from '../sim/types'
import type { CongestionLayer } from './traffic'
import { isMain } from './network'
import { VehicleLayer } from './vehicles'

/** Seconds the whole day takes to play. */
export const DAY_SECONDS = 15
/** Seconds over which one part of the day blends into the next. */
const BLEND = 0.6

/** Where the playback is at `seconds`: the part of the day shown, and how much of each part the dots show. */
export function phase(seconds: number): { period: number; weight: [number, number, number, number] } {
  const part = DAY_SECONDS / PERIODS.length
  const t = Math.min(Math.max(seconds, 0), DAY_SECONDS - 1e-6)
  const period = Math.floor(t / part)
  const weight: [number, number, number, number] = [0, 0, 0, 0]
  const into = t - period * part
  const blend = period < PERIODS.length - 1 ? Math.max(0, (into - (part - BLEND)) / BLEND) : 0
  weight[period] = 1 - blend
  if (blend > 0) weight[period + 1] = blend
  return { period: blend > 0.5 ? period + 1 : period, weight }
}

/**
 * A weekday played back in about 15 seconds: the four parts of the day in turn, congestion recoloured as each comes,
 * and vehicles moving along the roads.
 */
export class Playback {
  private vehicles: VehicleLayer | null = null
  private started = 0
  private last = 0
  private frame = 0
  private shown = -1
  /** Frames drawn in the current or last playback, and over how long, for measuring. */
  readonly frames: number[] = []

  constructor(
    private readonly map: MapLibre,
    private readonly network: Network,
    private readonly congestion: CongestionLayer,
    private readonly budget: number,
    private readonly before: string | undefined,
    private readonly onPeriod: (period: Period) => void,
    private readonly onEnd: () => void,
  ) {}

  get playing(): boolean {
    return this.frame !== 0
  }

  /** How many dots are loaded. */
  get dots(): number {
    return this.vehicles?.dots ?? 0
  }

  /** Plays the day with `view`'s traffic. */
  play(view: TrafficView): void {
    this.stop()
    if (!this.vehicles) {
      this.vehicles = new VehicleLayer(this.network, this.network.links.map(isMain))
      this.map.addLayer(this.vehicles, this.before)
    }
    this.vehicles.load(view, this.budget)
    this.vehicles.visible = true
    this.congestion.show(true)
    this.shown = -1
    this.frames.length = 0
    this.started = this.last = performance.now()
    // Asked for less motion, the vehicles stand still where they are: the day's parts still come in turn.
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    const tick = (now: number) => {
      const seconds = (now - this.started) / 1000
      const { period, weight } = phase(seconds)
      this.frames.push(now)
      this.vehicles!.weight.set(weight)
      this.vehicles!.advance(still ? 0 : (now - this.last) / 1000)
      this.last = now
      if (period !== this.shown) {
        this.shown = period
        this.congestion.paint(view.level[PERIODS[period]!])
        this.onPeriod(PERIODS[period]!)
      }
      this.map.triggerRepaint()
      if (seconds >= DAY_SECONDS) {
        this.stop()
        return
      }
      this.frame = requestAnimationFrame(tick)
    }
    this.frame = requestAnimationFrame(tick)
  }

  /** Stops the playback, leaving the last part of the day shown. */
  stop(): void {
    if (!this.frame) return
    cancelAnimationFrame(this.frame)
    this.frame = 0
    if (this.vehicles) this.vehicles.visible = false
    this.map.triggerRepaint()
    this.onEnd()
  }
}
