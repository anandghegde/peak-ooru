import { ApiError, type Api, type GameSummary, type MonthSent } from './types'

/** A month waiting to be acknowledged by the server, for one game. */
export interface Queued extends MonthSent {
  game: string
}

export interface OutboxHooks {
  /** The interface a game's months go to: the server's, or the stand-in's for a game kept only here. */
  api(game: string): Api
  /** The server kept a month: its summary, and whether its fingerprint is the screen's. */
  checked(game: string, month: number, summary: GameSummary, same: boolean): void
  /** The server refused a month; it and the months queued after it for the game have been dropped. */
  refused(game: string, month: number, error: ApiError): void
  /** The server has the game at a month the queue does not follow on from; the game's months have been dropped. */
  apart(game: string, summary: GameSummary | undefined): void
  /** The number waiting, or whether the server can be reached, has changed. */
  changed(): void
}

/** The refusals docs/API.md names: the month is not to be sent again as it is. */
const REFUSALS = new Set(['unauthorised', 'not-found', 'refused', 'allowance', 'out-of-step', 'season-over', 'older-version'])

/** How long to wait before trying the server again, after each failure in a row: at most half a minute. */
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15_000, 30_000]

/**
 * The months ended and not yet acknowledged, kept in the browser and sent in order, one at a time, until the server
 * answers. They survive the connection dropping, the tab closing and the server being away: each is written down
 * before it is sent, and the queue is sent again from the start when the page next opens.
 */
export class Outbox {
  queue: Queued[] = []
  /** Whether the last try found the server away. */
  offline = false
  private sending = false
  private failures = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private wake: (() => void) | null = null

  constructor(private readonly key: string, private readonly hooks: OutboxHooks, private readonly storage: Storage | null = safeStorage()) {
    try {
      const kept = JSON.parse(this.storage?.getItem(key) ?? '[]') as Queued[]
      if (Array.isArray(kept)) this.queue = kept.filter((q) => q && typeof q.game === 'string' && typeof q.month === 'number')
    } catch {
      this.queue = []
    }
  }

  /** Months waiting for a game. */
  pending(game: string): Queued[] {
    return this.queue.filter((q) => q.game === game)
  }

  add(entry: Queued): void {
    this.queue.push(entry)
    this.save()
    this.hooks.changed()
    void this.pump()
  }

  /** Drops a game's months from `month` on (all of them if not given). */
  drop(game: string, month = -Infinity): void {
    this.queue = this.queue.filter((q) => q.game !== game || q.month < month)
    this.save()
    this.hooks.changed()
  }

  /** Tries again now, as when the connection comes back. */
  poke(): void {
    this.failures = 0
    if (this.wake) this.wake()
    else void this.pump()
  }

  /** Sends what is waiting, in order, until the queue is empty or the server is away. */
  async pump(): Promise<void> {
    if (this.sending) return
    this.sending = true
    try {
      while (this.queue.length) {
        const entry = this.queue[0]!
        try {
          const { game, digest } = await this.hooks.api(entry.game).endMonth(entry.game, {
            month: entry.month, actions: entry.actions, digest: entry.digest,
          })
          this.failures = 0
          this.setOffline(false)
          // Dropped meanwhile (a refusal handled, a game left), then nothing more is to be done with it.
          if (this.queue[0] !== entry) continue
          this.queue.shift()
          this.save()
          this.hooks.changed()
          this.hooks.checked(entry.game, entry.month, game, digest === entry.digest)
        } catch (error) {
          const e = error instanceof ApiError ? error : new ApiError('offline', String(error))
          // A fault in the server itself, which is not a refusal of the month, is tried again like an absence.
          const fault = e.status >= 500 && !REFUSALS.has(e.code)
          if (e.code === 'offline' || e.code === 'too-many' || fault) {
            this.setOffline(e.code !== 'too-many')
            await this.wait(e.code === 'too-many' ? 10_000 : BACKOFF_MS[Math.min(this.failures++, BACKOFF_MS.length - 1)]!)
            continue
          }
          this.failures = 0
          this.setOffline(false)
          if (this.queue[0] !== entry) continue
          // The screen is older than the server's rules: the months stay, to be sent again by the newer screen.
          if (e.code === 'older-version') {
            this.hooks.refused(entry.game, entry.month, e)
            return
          }
          if (e.code === 'out-of-step') this.outOfStep(entry, e.game)
          else {
            this.drop(entry.game, entry.month)
            this.hooks.refused(entry.game, entry.month, e)
          }
        }
      }
    } finally {
      this.sending = false
    }
  }

  /**
   * The server has the game at another month. Months it has already (sent before, their answer lost) are dropped; if
   * the next is the month it is at, sending goes on; otherwise the game has moved apart from the queue.
   */
  private outOfStep(entry: Queued, summary: GameSummary | undefined): void {
    const at = summary?.month
    if (at !== undefined) this.queue = this.queue.filter((q) => q.game !== entry.game || q.month >= at)
    const next = this.queue.find((q) => q.game === entry.game)
    if (at !== undefined && (!next || next.month === at) && entry.month < at) {
      this.save()
      this.hooks.changed()
      return
    }
    this.drop(entry.game)
    this.hooks.apart(entry.game, summary)
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.wake = () => {
        if (this.timer) clearTimeout(this.timer)
        this.wake = null
        resolve()
      }
      this.timer = setTimeout(() => this.wake?.(), ms)
    })
  }

  private setOffline(offline: boolean): void {
    if (this.offline === offline) return
    this.offline = offline
    this.hooks.changed()
  }

  private save(): void {
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.queue))
    } catch {
      // A browser that keeps nothing still sends while the page is open.
    }
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}
