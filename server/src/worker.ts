import { parentPort, workerData } from 'node:worker_threads'
import { doJob, type Job, loadCity } from './game'

/** A worker thread: holds the city once and works out months for any game, one at a time. */

const city = loadCity((workerData as { data: string }).data)

parentPort!.on('message', ({ id, job }: { id: number; job: Job }) => {
  try {
    parentPort!.postMessage({ id, result: doJob(job, city) })
  } catch (e) {
    parentPort!.postMessage({ id, error: e instanceof Error ? e.message : String(e) })
  }
})
