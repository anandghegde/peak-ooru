import { mkdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { availableParallelism } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from './app'
import { googleKeys } from './google'
import { Pictures } from './pictures'
import { Pool } from './pool'
import { closeDue, current, openSeason, SETUPS } from './seasons'
import { send, type Smtp } from './smtp'
import { SqliteStore } from './store'

/*
 * The server. Settings come from the environment (deploy/peak-ooru.env lists them all):
 *   PORT (5210), HOST (127.0.0.1), STORE (the SQLite file), PICTURES (the share pictures' folder), DATA (the city's data folder), WORKERS, QUEUE,
 *   PUBLIC_URL, TRUST_PROXY, CORS_ORIGIN, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, GOOGLE_CLIENT_ID,
 *   OPEN_SEASON (a set-up to open if no season has been: for running it here).
 */

const here = dirname(fileURLToPath(import.meta.url))
const env = process.env
const port = Number(env.PORT ?? 5210)
const host = env.HOST ?? '127.0.0.1'
const storeFile = resolve(env.STORE ?? resolve(here, '../.data/dev.db'))
const data = resolve(env.DATA ?? resolve(here, '../../public/data'))
const workers = Number(env.WORKERS ?? Math.max(1, Math.min(4, availableParallelism() - 1)))
const queue = Number(env.QUEUE ?? workers * 8)

mkdirSync(dirname(storeFile), { recursive: true })
const store = new SqliteStore(storeFile)
if (env.SCRATCH === '1' && !(await store.meta('scratch'))) await store.setMeta('scratch', 'This store is a scratch one: `fill` may write to it.')
const pool = new Pool(new URL('./worker.js', import.meta.url), data, workers, queue)
const zones = new Set((JSON.parse(readFileSync(resolve(data, 'zones.json'), 'utf8')) as { id: number }[]).map((z) => z.id))

const smtp: Smtp | undefined = env.SMTP_HOST
  ? { host: env.SMTP_HOST, port: Number(env.SMTP_PORT ?? 587), user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.SMTP_FROM ?? `Peak Ooru <no-reply@${env.SMTP_HOST}>` }
  : undefined

const log = (line: string) => console.error(line)
const server = app({
  store,
  work: pool,
  now: Date.now,
  zones,
  publicUrl: (env.PUBLIC_URL ?? `http://localhost:5190`).replace(/\/$/, ''),
  smtp,
  mailer: send,
  google: env.GOOGLE_CLIENT_ID ? { clientId: env.GOOGLE_CLIENT_ID, keys: googleKeys() } : undefined,
  limits: {
    playersPerHour: env.NEW_PLAYERS_PER_HOUR ? Number(env.NEW_PLAYERS_PER_HOUR) : undefined,
    requestsPerMinute: env.REQUESTS_PER_MINUTE ? Number(env.REQUESTS_PER_MINUTE) : undefined,
  },
  trustProxy: env.TRUST_PROXY !== '0',
  corsOrigin: env.CORS_ORIGIN,
  log,
  // The share pictures, as files in a folder beside the store (PICTURES to put them elsewhere).
  pictures: new Pictures(resolve(env.PICTURES ?? resolve(dirname(storeFile), 'pictures'))),
})

if (env.OPEN_SEASON && !(await current(store, Date.now()))) {
  if (!SETUPS[env.OPEN_SEASON]) throw new Error(`No set-up called ${env.OPEN_SEASON}.`)
  const s = await openSeason(store, env.OPEN_SEASON, {}, Date.now())
  log(`Opened the season ${s.id}, to ${s.closes}.`)
}

// Seasons close on time, and the limits forget what they no longer need.
const tick = setInterval(() => {
  const t = Date.now()
  closeDue(store, t).then((ids) => ids.length && (server.board.touch(), log(`Closed ${ids.join(', ')}.`)), (e) => log(String(e)))
  for (const l of Object.values(server.limit)) l.sweep(t)
}, 60_000)

const http = createServer((req, res) => void server.handle(req, res))
http.keepAliveTimeout = 65_000
http.requestTimeout = 30_000
http.listen(port, host, () => log(`Peak Ooru server on http://${host}:${port}, ${workers} workers, store ${storeFile}`))

const stop = async () => {
  clearInterval(tick)
  http.close()
  await pool.close()
  await store.close()
  process.exit(0)
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
