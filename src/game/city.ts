import type { Answer, Ask, Light, Question, Questions } from '../sim/worker'
import type { TrafficView } from './traffic'

/** A month worked out, with how long the page waited for it. */
export interface Month {
  result: Light
  view: TrafficView
  /** Milliseconds from asking to the answer arriving. */
  waited: number
}

type Waiting = { resolve(value: unknown): void; reject(e: Error): void }

/**
 * The page's side of the worker that holds the game and works out the months. The fixed data (zones, roads,
 * transit) is loaded by the worker; the page asks questions and is answered with the game as it stands.
 */
export class City {
  /** Whether the worker is using stand-ins for the routing network, the model or the rules. */
  stand: { routing: boolean; model: boolean; rules: boolean; building: boolean } | null = null
  /** The version of the rules the worker plays by, once loaded. */
  rules = 0
  /** Called while a kept game is played again, with the month reached and the month it is going to. */
  onProgress: ((month: number, of: number) => void) | null = null
  private readonly worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' })
  private readonly waiting = new Map<number, Waiting>()
  private asked = 0
  readonly loaded: Promise<void>

  /** `standIn` uses the stand-in model even where the real one exists, to look at the map apart from the model. */
  constructor(base: string, standIn = false) {
    this.loaded = new Promise((resolve, reject) => {
      // A worker that fails to start says so only here.
      this.worker.onerror = (event) => {
        const error = new Error(`The traffic worker failed: ${event.message || 'it could not be loaded'}`)
        reject(error)
        for (const wait of this.waiting.values()) wait.reject(error)
        this.waiting.clear()
      }
      this.worker.onmessage = ({ data }: MessageEvent<Answer>) => {
        if (data.type === 'loaded') {
          this.stand = data.stand
          this.rules = data.rules
          resolve()
        } else if (data.type === 'progress') {
          this.onProgress?.(data.month, data.of)
        } else if (data.type === 'error' && data.id === null) {
          reject(new Error(data.message))
        } else if (data.id !== null) {
          const wait = this.waiting.get(data.id)
          if (!wait) return
          this.waiting.delete(data.id)
          if (data.type === 'error') wait.reject(new Error(data.message))
          else wait.resolve(data.value)
        }
      }
    })
    this.post({ type: 'load', base: new URL(base, location.href).href, standIn })
  }

  private post(ask: Ask): void {
    this.worker.postMessage(ask)
  }

  /** Asks the worker a question about the game, once the city has loaded. */
  async ask<Q extends Question>(type: Q, question: Questions[Q][0]): Promise<Questions[Q][1]> {
    await this.loaded
    const id = ++this.asked
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (value: unknown) => void, reject })
      this.post({ ...question, type, id } as Ask)
    })
  }

  /** Works out the current month as it stands, for the map. */
  async work(): Promise<Month> {
    const asked = performance.now()
    const { result, view } = await this.ask('show', {})
    return { result, view, waited: performance.now() - asked }
  }
}
