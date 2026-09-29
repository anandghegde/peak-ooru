import { Worker } from 'node:worker_threads'
import type { Job } from './game'

/**
 * A few worker threads, each with its own copy of the city, working out months one at a time, so that the model's
 * quarter of a second never holds up other requests. Jobs wait in one queue; past `queue` waiting, `run` refuses at
 * once rather than let answers grow slow for everyone.
 */
export class Pool {
  private idle: Worker[] = []
  private all: Worker[] = []
  private waiting: { job: Job; resolve: (v: unknown) => void; reject: (e: Error) => void }[] = []
  private pending = new Map<Worker, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private next = 0

  constructor(
    private file: URL,
    private data: string,
    size: number,
    private queue: number,
  ) {
    for (let i = 0; i < size; i++) this.add()
  }

  private add(): void {
    const worker = new Worker(this.file, { workerData: { data: this.data } })
    worker.on('message', (m: { result?: unknown; error?: string }) => {
      const p = this.pending.get(worker)
      this.pending.delete(worker)
      if (p) {
        if (m.error === undefined) p.resolve(m.result)
        else p.reject(new Error(m.error))
      }
      this.release(worker)
    })
    worker.on('error', (e: Error) => {
      // A worker that dies takes its job with it; another takes its place.
      this.pending.get(worker)?.reject(e)
      this.pending.delete(worker)
      this.all = this.all.filter((w) => w !== worker)
      this.idle = this.idle.filter((w) => w !== worker)
      if (!this.closing) this.add()
    })
    this.all.push(worker)
    this.idle.push(worker)
    this.pump()
  }

  private closing = false

  private release(worker: Worker): void {
    this.idle.push(worker)
    this.pump()
  }

  private pump(): void {
    while (this.idle.length && this.waiting.length) {
      const worker = this.idle.shift()!
      const { job, resolve, reject } = this.waiting.shift()!
      this.pending.set(worker, { resolve, reject })
      worker.postMessage({ id: this.next++, job })
    }
  }

  /** Jobs waiting for a worker. */
  get backlog(): number {
    return this.waiting.length
  }

  get size(): number {
    return this.all.length
  }

  /** Whether a job would be taken now, or refused as too many. */
  full(): boolean {
    return this.idle.length === 0 && this.waiting.length >= this.queue
  }

  run<T>(job: Job): Promise<T> {
    if (this.full()) return Promise.reject(new TooMany())
    return new Promise<T>((resolve, reject) => {
      this.waiting.push({ job, resolve: resolve as (v: unknown) => void, reject })
      this.pump()
    })
  }

  async close(): Promise<void> {
    this.closing = true
    await Promise.all(this.all.map((w) => w.terminate()))
  }
}

export class TooMany extends Error {
  constructor() {
    super('The server is busy.')
  }
}
