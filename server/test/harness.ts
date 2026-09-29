import { createServer, type Server } from 'node:http'
import { createServer as createTcp, type AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import type { Season } from '../../src/rules/types'
import { firstSeason } from '../../src/seasons/first'
import { app, type Deps } from '../src/app'
import { doJob, type Job, loadCity } from '../src/game'
import type { JsonWebKey } from '../src/google'
import { TooMany } from '../src/pool'
import { send } from '../src/smtp'
import { SqliteStore } from '../src/store'

export const city = loadCity(resolve(__dirname, '../../public/data'))

/** The server on a free port, with a store in memory, months worked out in this thread, and a clock of the test's own. */
export async function harness(opts: Partial<Deps> & { busy?: () => boolean } = {}) {
  const store = new SqliteStore(':memory:')
  const clock = { t: Date.parse('2026-10-01T06:00:00Z') }
  const full = opts.busy ?? (() => false)
  const work = {
    run: async <T>(job: Job) => {
      if (full()) throw new TooMany()
      return doJob(job, city) as T
    },
    full,
  }
  const handler = app({
    store,
    work,
    now: () => clock.t,
    zones: new Set(city.zones.map((z) => z.id)),
    publicUrl: 'https://peakooru.test',
    trustProxy: true,
    log: () => {},
    ...opts,
  })
  const server: Server = createServer((req, res) => void handler.handle(req, res))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`

  async function call(method: string, path: string, token?: string | null, body?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(base + path, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    })
    return { status: response.status, body: (await response.json()) as any }
  }

  async function addSeason(id: string, season: Season = firstSeason, days = 28) {
    await store.addSeason({
      id,
      name: season.name,
      twist: 'A test.',
      opens: new Date(clock.t - 86_400_000).toISOString(),
      closes: new Date(clock.t + days * 86_400_000).toISOString(),
      rules: 5,
      season,
      closed: null,
    })
  }

  async function newPlayer(name?: string) {
    const r = await call('POST', '/players', null, undefined, { 'x-real-ip': `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` })
    const token = r.body.token as string
    if (name) await call('PUT', '/me/name', token, { name })
    return { token, id: r.body.player.id as string, player: r.body.player }
  }

  return { store, clock, handler, call, addSeason, newPlayer, root: base.slice(0, -'/api'.length), close: () => new Promise((r) => server.close(r)) }
}

/** A stand-in mail server on this machine that takes every message and keeps it. */
export async function fakeSmtp() {
  const got: string[] = []
  const server = createTcp((socket) => {
    socket.setEncoding('utf8')
    socket.write('220 fake ESMTP\r\n')
    let data = false
    let buffer = ''
    socket.on('data', (chunk: string) => {
      buffer += chunk
      if (data) {
        const end = buffer.indexOf('\r\n.\r\n')
        if (end < 0) return
        got.push(buffer.slice(0, end))
        buffer = buffer.slice(end + 5)
        data = false
        socket.write('250 kept\r\n')
      }
      let i
      while (!data && (i = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, i)
        buffer = buffer.slice(i + 2)
        if (/^EHLO/i.test(line)) socket.write('250-fake\r\n250 AUTH PLAIN\r\n')
        else if (/^DATA/i.test(line)) {
          data = true
          socket.write('354 go on\r\n')
        } else if (/^QUIT/i.test(line)) socket.end('221 bye\r\n')
        else if (/^AUTH/i.test(line)) socket.write('235 ok\r\n')
        else socket.write('250 ok\r\n')
      }
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  return {
    got,
    smtp: { host: '127.0.0.1', port, from: 'Peak Ooru <game@peakooru.test>', user: 'u', pass: 'p', insecure: true },
    mailer: send,
    close: () => new Promise((r) => server.close(r)),
  }
}

export type { JsonWebKey }
