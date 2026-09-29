// Scripted players against the server over HTTP, for measuring how many months a second it works out and what it
// carries. Starts its own server on port 5219 with a store in a scratch folder, for each number of workers asked.
//   npm run load -- [--workers 1,2,4] [--players 48] [--seconds 60] [--port 5219]
// Each player makes itself, starts a ranked game, and ends months one after another as fast as the limits let it
// (30 a minute), with a few actions now and then, and reads its game after each month and the board every fifth.
import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { cpus, loadavg, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1]! : fallback
}
const workerCounts = opt('workers', '1,2,4').split(',').map(Number)
const players = Number(opt('players', '48'))
const seconds = Number(opt('seconds', '60'))
const port = Number(opt('port', '5219'))
const scratch = opt('scratch', tmpdir())
const base = `http://127.0.0.1:${port}/api`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The machine's processors, busy share over an interval, from the kernel's counts. */
function cpuTimes() {
  return cpus().reduce((t, c) => ({ busy: t.busy + c.times.user + c.times.sys + c.times.nice + c.times.irq, all: t.all + c.times.user + c.times.sys + c.times.nice + c.times.irq + c.times.idle }), { busy: 0, all: 0 })
}

function processUse(pid: number): { cpu: number; rss: number } {
  // cumulative processor time (seconds) and resident memory (KB) of the server, by ps
  const out = execFileSync('ps', ['-o', 'time=,rss=', '-p', String(pid)], { encoding: 'utf8' }).trim().split(/\s+/)
  const [clock, rss] = out as [string, string]
  const parts = clock.split(/[:.]/).map(Number)
  let secs = 0
  if (clock.includes('.')) {
    const [m, s, cs] = parts.length === 3 ? parts : [0, ...parts]
    secs = m! * 60 + s! + cs! / 100
  } else secs = parts.reduce((t, x) => t * 60 + x, 0)
  return { cpu: secs, rss: Number(rss) }
}

async function call(method: string, path: string, token: string | null, body?: unknown, ip?: string) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(ip ? { 'x-real-ip': ip } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, body: (await response.json()) as any }
}

const ACTIONS = [
  { kind: 'upkeep', level: 'generous' },
  { kind: 'fare', mode: 'bus', perKm: 120 },
  { kind: 'borrow', amount: 20_000 },
  { kind: 'digOnce', on: true },
]

interface Tally {
  months: number
  latencies: number[]
  tooMany: number
  refused: number
  reads: number
  readLatencies: number[]
  failed: number
}

async function player(n: number, until: number, t: Tally): Promise<void> {
  const ip = `10.${(n >> 8) & 255}.${n & 255}.1`
  const made = await call('POST', '/players', null, undefined, ip)
  const token = made.body.token as string
  await call('PUT', '/me/name', token, { name: `Load Player ${n}` }, ip)
  const season = (await call('GET', '/seasons/current', token, undefined, ip)).body.season.id
  const newGame = async (ranked: boolean) => {
    for (;;) {
      const r = await call('POST', '/games', token, { season, ranked }, ip)
      if (r.status === 200) return r.body.game
      if (r.body.error?.code !== 'too-many') throw new Error(r.body.error?.message)
      await sleep(500)
    }
  }
  let game = await newGame(true)
  let last = 0
  while (Date.now() < until) {
    // The limit: 30 months a minute.
    const wait = last + 2000 - Date.now()
    if (wait > 0) await sleep(wait)
    if (Date.now() >= until) break
    last = Date.now()
    const actions = game.month % 7 === 3 ? [ACTIONS[(n + game.month) % ACTIONS.length]] : []
    const s = performance.now()
    const r = await call('POST', `/games/${game.id}/months`, token, { month: game.month, actions, digest: '00000000' }, ip)
    const took = performance.now() - s
    if (r.status === 200) {
      t.months++
      t.latencies.push(took)
      game = r.body.game
      if (game.status !== 'playing') game = await newGame(false)
    } else if (r.body.error?.code === 'too-many') {
      t.tooMany++
      await sleep(500)
    } else if (r.body.error?.code === 'refused') {
      // An action the rules did not allow in this city as it stands: the month is sent again without it.
      t.refused++
      const again = await call('POST', `/games/${game.id}/months`, token, { month: game.month, actions: [] }, ip)
      if (again.status === 200) {
        t.months++
        game = again.body.game
      }
    } else t.failed++
    const rs = performance.now()
    await call('GET', `/games/${game.id}`, token, undefined, ip)
    if (game.month % 5 === 0) await call('GET', `/board?count=50`, token, undefined, ip)
    t.readLatencies.push(performance.now() - rs)
    t.reads++
  }
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]! : 0
}

async function run(workers: number) {
  const dir = mkdtempSync(join(scratch, 'peak-ooru-load-'))
  const server = spawn(process.execPath, [resolve(here, 'main.js')], {
    env: { ...process.env, PORT: String(port), STORE: join(dir, 'load.db'), WORKERS: String(workers), QUEUE: String(workers * 8), OPEN_SEASON: 'first', TRUST_PROXY: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let log = ''
  server.stderr.on('data', (d) => (log += d))
  process.on('exit', () => server.kill('SIGTERM'))
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => process.exit(1))
  for (let i = 0; i < 100 && !log.includes('server on'); i++) await sleep(100)
  if (!log.includes('server on')) throw new Error(`The server did not start:\n${log}`)
  await sleep(1500)
  const idle = processUse(server.pid!)
  const t: Tally = { months: 0, latencies: [], tooMany: 0, refused: 0, reads: 0, readLatencies: [], failed: 0 }
  const machine0 = cpuTimes()
  const load0 = loadavg()[0]!
  const start = Date.now()
  await Promise.all(Array.from({ length: players }, (_, n) => player(n + workers * 1000, start + seconds * 1000, t)))
  const took = (Date.now() - start) / 1000
  const machine1 = cpuTimes()
  const used = processUse(server.pid!)
  server.kill('SIGTERM')
  await sleep(500)
  rmSync(dir, { recursive: true, force: true })
  const busy = (machine1.busy - machine0.busy) / (machine1.all - machine0.all)
  return {
    workers,
    monthsPerSecond: t.months / took,
    perWorker: t.months / took / workers,
    p50: pct(t.latencies, 50),
    p95: pct(t.latencies, 95),
    readP50: pct(t.readLatencies, 50),
    readP95: pct(t.readLatencies, 95),
    tooMany: t.tooMany,
    refused: t.refused,
    failed: t.failed,
    serverCpu: (used.cpu - idle.cpu) / took,
    rssIdle: idle.rss / 1024,
    rssAfter: used.rss / 1024,
    machineBusy: busy,
    loadBefore: load0,
    loadAfter: loadavg()[0]!,
  }
}

console.log(`${players} scripted players, ${seconds} s each run, ${cpus().length} processors here, load average ${loadavg().map((x) => x.toFixed(1)).join(' ')}`)
const rows = []
for (const w of workerCounts) {
  const r = await run(w)
  rows.push(r)
  console.log(
    `${w} worker${w > 1 ? 's' : ' '}: ${r.monthsPerSecond.toFixed(2)} months/s (${r.perWorker.toFixed(2)} a worker), ` +
      `month p50 ${r.p50.toFixed(0)} ms p95 ${r.p95.toFixed(0)} ms, reads p50 ${r.readP50.toFixed(0)} ms p95 ${r.readP95.toFixed(0)} ms, ` +
      `too-many ${r.tooMany}, failed ${r.failed}; server ${r.serverCpu.toFixed(2)} processors busy, ` +
      `memory ${r.rssIdle.toFixed(0)} MB idle, ${r.rssAfter.toFixed(0)} MB after; machine ${(r.machineBusy * 100).toFixed(0)}% busy ` +
      `(load ${r.loadBefore.toFixed(1)} to ${r.loadAfter.toFixed(1)})`,
  )
}
