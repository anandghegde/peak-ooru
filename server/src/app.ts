import { createHash, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { gzipSync } from 'node:zlib'
import { allowance, MOST } from '../../src/rules/allowance'
import { version } from '../../src/rules/index'
import { toWire } from '../../src/rules/wire'
import type { Action } from '../../src/rules/types'
import { shareLine } from '../../src/share/line'
import { Board } from './board'
import { type Job, type Kept, load, type MonthOutcome } from './game'
import { googleEmail, type JsonWebKey } from './google'
import { limits } from './limits'
import { nameKey, nameProblem, tidy } from './names'
import { HEIGHT, MOST_BYTES, type Pictures, pngProblem, WIDTH } from './pictures'
import { TooMany } from './pool'
import { current, over } from './seasons'
import type { Mail, Smtp } from './smtp'
import type { GameRow, PlayerRow, SeasonRow, Store } from './store'

/*
 * The server's answers to docs/API.md. Every request is checked before anything is done: its size, its token, every
 * field, and how often the same player or address has asked. Months are worked out in the worker threads; nothing a
 * request says about the game is taken but the month it is in and the actions done in it.
 */

export interface Deps {
  store: Store
  work: { run<T>(job: Job): Promise<T>; full(): boolean }
  now: () => number
  /** Zone ids a player may call home. */
  zones: Set<number>
  /** Where the game is served, for the link in a sign-in email: https://example.com */
  publicUrl: string
  smtp?: Smtp
  mailer?: (smtp: Smtp, mail: Mail) => Promise<void>
  google?: { clientId: string; keys: () => Promise<JsonWebKey[]> }
  /** The limits that are settable (NEW_PLAYERS_PER_HOUR, REQUESTS_PER_MINUTE). */
  limits?: { playersPerHour?: number; requestsPerMinute?: number }
  /** Take the address from nginx's X-Real-IP when the request comes from this machine. */
  trustProxy?: boolean
  corsOrigin?: string
  /** Told of failures that are the server's fault, in words without addresses or emails. */
  log?: (line: string) => void
  /** Slice 9: where share pictures are kept (a folder beside the store). Without it, pictures are refused. */
  pictures?: Pictures
}

/** An answer that is not JSON: the share page and its picture. */
class Raw {
  constructor(
    public status: number,
    public type: string,
    public body: string | Buffer,
    public cache: string,
  ) {}
}

/** Text made safe to put in HTML, in an element or an attribute. */
const escape = (s: string) =>
  s.replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' })[c]!)

interface Player {
  id: string
  name: string | null
  signedIn: boolean
  friendCode: string
  zone: number | null
}

interface GameSummary {
  id: string
  season: string
  ranked: boolean
  month: number
  status: Kept['status']
  score: number
  points: number[]
  restarted: boolean
  allowance: { on: boolean; left: number; more: string | null }
  started: string
  ended: string | null
}

class Refusal extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

const refuse = (status: number, code: string, message: string, extra?: Record<string, unknown>): never => {
  throw new Refusal(status, code, message, extra)
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const newId = () => randomBytes(9).toString('base64url')
const newToken = () => randomBytes(32).toString('base64url')
/** Friend codes: eight letters and digits that cannot be mistaken for one another. */
const FRIEND = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const newFriendCode = () => [...randomBytes(8)].map((b) => FRIEND[b % FRIEND.length]).join('')

/** The largest body the server reads: a month's actions, a repair of every road in the city included, fit well within it. */
const MOST_BODY = 256 * 1024
/** Actions in one month: the rules allow three major ones; minor ones are unlimited, but not without end. */
const MOST_ACTIONS = 200
const CODE_LIFE = 30 * 60_000

const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/

export function playerOf(p: PlayerRow): Player {
  return { id: p.id, name: p.name, signedIn: p.email !== null, friendCode: p.friendCode, zone: p.zone }
}

export function app(deps: Deps) {
  const { store, work, now } = deps
  const board = new Board(store, now)
  const limit = limits(deps.limits)
  const busy = new Set<string>()
  const mail = deps.mailer ?? (async () => {})

  async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    const length = Number(req.headers['content-length'] ?? 0)
    if (length > MOST_BODY) refuse(413, 'refused', 'That request is too large.')
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += (chunk as Buffer).length
      if (size > MOST_BODY) refuse(413, 'refused', 'That request is too large.')
      chunks.push(chunk as Buffer)
    }
    if (!size) return {}
    let body: unknown
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      refuse(400, 'refused', 'That request could not be read.')
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) refuse(400, 'refused', 'That request could not be read.')
    return body as Record<string, unknown>
  }

  function address(req: IncomingMessage): string {
    const socket = req.socket.remoteAddress ?? ''
    const local = socket === '127.0.0.1' || socket === '::1' || socket === '::ffff:127.0.0.1'
    const real = req.headers['x-real-ip']
    return deps.trustProxy && local && typeof real === 'string' ? real : socket
  }

  async function who(req: IncomingMessage): Promise<{ player: PlayerRow; token: string }> {
    const auth = req.headers.authorization
    const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
    if (!token || token.length > 100) refuse(401, 'unauthorised', 'Your device is not known to the game. Start again.')
    const id = await store.tokenPlayer(hash(token))
    const player = id ? await store.player(id) : null
    if (!player) refuse(401, 'unauthorised', 'Your device is not known to the game. Start again.')
    return { player: player!, token }
  }

  async function seasonOrRefuse(id: unknown): Promise<SeasonRow> {
    if (typeof id !== 'string' || id.length > 64) refuse(404, 'not-found', 'There is no such season.')
    const s = await store.season(id as string)
    if (!s || Date.parse(s.opens) > now()) refuse(404, 'not-found', 'There is no such season.')
    return s!
  }

  function seasonInfo(s: SeasonRow) {
    // The rules the server plays by now, which may be newer than those the season opened with: a screen with others reloads.
    return { id: s.id, name: s.name, twist: s.twist, opens: s.opens, closes: s.closes, rules: version, season: s.season }
  }

  async function summary(g: GameRow, s?: SeasonRow | null): Promise<GameSummary> {
    const season = s ?? (await store.season(g.season))
    const on = g.ranked && season?.season.allowance !== false
    let a: GameSummary['allowance']
    if (on) {
      const kept = allowance(await store.spent(g.player, g.season), now(), true)
      a = { on, left: kept.left, more: kept.left < MOST ? new Date(kept.next).toISOString() : null }
    } else a = { on: false, left: (season?.season.months ?? 120) - g.month, more: null }
    return {
      id: g.id,
      season: g.season,
      ranked: g.ranked,
      month: g.month,
      status: g.status,
      score: g.score,
      points: g.points,
      restarted: g.restarted,
      allowance: a,
      started: g.started,
      ended: g.ended,
    }
  }

  async function ownGame(player: PlayerRow, id: string): Promise<GameRow> {
    const g = await store.game(id)
    if (!g || g.player !== player.id) refuse(404, 'not-found', 'There is no such game.')
    return g!
  }

  async function done(id: string) {
    return (await store.months(id)).flatMap((m) => m.actions.map((action) => ({ month: m.month, action, at: m.at })))
  }

  /** Gives this device a fresh token for `player`, in place of the one it had. */
  async function reissue(player: PlayerRow, old: string | null) {
    if (old) await store.dropToken(hash(old))
    const token = newToken()
    await store.addToken(hash(token), player.id, new Date(now()).toISOString())
    return token
  }

  /**
   * Joins this device's player to the account of a verified email address: to the player who has it already, keeping
   * the games of both, or else by giving it to this player.
   */
  async function join(me: PlayerRow, token: string, email: string) {
    const account = await store.playerByEmail(email)
    if (account && account.id !== me.id) {
      await store.merge(me.id, account.id)
      board.touch()
      const joined = (await store.player(account.id))!
      return { player: playerOf(joined), token: await reissue(joined, null) }
    }
    if (!account) await store.setEmail(me.id, email)
    const player = (await store.player(me.id))!
    return { player: playerOf(player), token: await reissue(player, token) }
  }

  type Handler = (req: IncomingMessage, params: string[], url: URL) => Promise<unknown>
  const routes: [string, RegExp, Handler][] = []
  const route = (method: string, path: string, handler: Handler) =>
    routes.push([method, new RegExp(`^${path.replace(/:[a-z]+/g, '([A-Za-z0-9_-]{1,64})')}$`), handler])

  route('POST', '/api/players', async (req) => {
    if (!limit.players.take(address(req), now())) refuse(429, 'too-many', 'Too many new players from this address. Try again in an hour.')
    const row: PlayerRow = { id: newId(), name: null, email: null, friendCode: newFriendCode(), zone: null, created: new Date(now()).toISOString() }
    await store.addPlayer(row)
    return { player: playerOf(row), token: await reissue(row, null) }
  })

  route('GET', '/api/me', async (req) => ({ player: playerOf((await who(req)).player) }))

  route('PUT', '/api/me/name', async (req) => {
    const { player } = await who(req)
    const body = await readBody(req)
    const problem = nameProblem(body.name)
    if (problem) refuse(422, 'name-not-allowed', problem)
    const name = tidy(body.name as string)
    if (!(await store.setName(player.id, name, nameKey(name)))) refuse(409, 'name-taken', 'Someone has that name already. Choose another.')
    board.drop()
    return { player: playerOf((await store.player(player.id))!) }
  })

  route('PUT', '/api/me/zone', async (req) => {
    const { player } = await who(req)
    const body = await readBody(req)
    const zone = body.zone
    if (zone !== null && !(typeof zone === 'number' && deps.zones.has(zone))) refuse(422, 'refused', 'There is no such zone.')
    await store.setZone(player.id, zone as number | null)
    board.drop()
    return { player: playerOf((await store.player(player.id))!) }
  })

  route('POST', '/api/signin/email', async (req) => {
    await who(req)
    if (!deps.smtp) refuse(422, 'refused', 'Signing in by email is not set up on this server.')
    const body = await readBody(req)
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (email.length > 254 || !EMAIL.test(email)) refuse(422, 'refused', 'That does not look like an email address.')
    const t = now()
    if (!limit.mailsByAddress.take(address(req), t) || !limit.mailsByEmail.take(hash(email), t)) {
      refuse(429, 'too-many', 'Too many sign-in links asked for. Try again in an hour.')
    }
    const code = randomBytes(24).toString('base64url')
    await store.addCode(hash(code), email, t + CODE_LIFE)
    const link = `${deps.publicUrl}/?signin=${code}`
    mail(deps.smtp!, {
      to: email,
      subject: 'Your Peak Ooru sign-in link',
      text:
        `Open this link to sign in to Peak Ooru on this device:\n\n${link}\n\n` +
        'It works once, for 30 minutes. If you did not ask for it, you need do nothing.\n',
    }).catch((e: unknown) => deps.log?.(`A sign-in email could not be sent: ${e instanceof Error ? e.message : String(e)}`))
    return { sent: true }
  })

  route('POST', '/api/signin/email/confirm', async (req) => {
    const { player, token } = await who(req)
    const body = await readBody(req)
    if (!limit.guesses.take(address(req), now())) refuse(429, 'too-many', 'Too many tries. Try again in an hour.')
    const code = typeof body.code === 'string' && body.code.length <= 100 ? body.code : ''
    const email = code ? await store.takeCode(hash(code), now()) : null
    if (!email) refuse(404, 'not-found', 'That link has been used or has run out. Ask for another.')
    return join(player, token, email!)
  })

  route('POST', '/api/signin/google', async (req) => {
    const { player, token } = await who(req)
    if (!deps.google) refuse(422, 'refused', 'Signing in with Google is not set up on this server.')
    const body = await readBody(req)
    if (!limit.guesses.take(address(req), now())) refuse(429, 'too-many', 'Too many tries. Try again in an hour.')
    let email: string | null = null
    try {
      email = await googleEmail(body.credential, deps.google!.clientId, deps.google!.keys, now())
    } catch (e) {
      deps.log?.(`Google sign-in could not be checked: ${e instanceof Error ? e.message : String(e)}`)
      refuse(422, 'refused', 'Google sign-in could not be checked just now. Try again in a minute.')
    }
    if (!email) refuse(401, 'unauthorised', 'Google did not confirm that sign-in. Try again.')
    return join(player, token, email!)
  })

  route('POST', '/api/signout', async (req) => {
    const { token } = await who(req)
    await store.dropToken(hash(token))
    return {}
  })

  route('DELETE', '/api/me', async (req) => {
    const { player } = await who(req)
    const games = await store.games(player.id)
    await store.deletePlayer(player.id)
    for (const g of games) deps.pictures?.drop(g.id)
    board.touch()
    return {}
  })

  const friendList = async (id: string) => ({ friends: (await store.friends(id)).map(playerOf) })

  route('POST', '/api/friends', async (req) => {
    const { player } = await who(req)
    const body = await readBody(req)
    if (!limit.guesses.take(address(req), now())) refuse(429, 'too-many', 'Too many tries. Try again in an hour.')
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : ''
    const friend = code.length === 8 ? await store.playerByFriendCode(code) : null
    if (!friend) refuse(404, 'not-found', 'No player has that friend code.')
    if (friend!.id === player.id) refuse(422, 'refused', 'That is your own friend code.')
    await store.addFriend(player.id, friend!.id)
    return friendList(player.id)
  })

  route('DELETE', '/api/friends/:id', async (req, [id]) => {
    const { player } = await who(req)
    await store.dropFriend(player.id, id!)
    return friendList(player.id)
  })

  route('GET', '/api/friends', async (req) => friendList((await who(req)).player.id))

  route('GET', '/api/seasons/current', async (req) => {
    await who(req)
    const s = await current(store, now())
    if (!s) refuse(404, 'not-found', 'No season is open.')
    return { season: seasonInfo(s!) }
  })

  route('GET', '/api/seasons', async (req) => {
    await who(req)
    return { seasons: (await store.seasons()).filter((s) => Date.parse(s.opens) <= now()).map(seasonInfo) }
  })

  route('POST', '/api/games', async (req) => {
    const { player } = await who(req)
    const body = await readBody(req)
    const season = await seasonOrRefuse(body.season)
    if (typeof body.ranked !== 'boolean') refuse(422, 'refused', 'Say whether the game is ranked.')
    const ranked = body.ranked as boolean
    if (ranked) {
      if (over(season, now())) refuse(403, 'season-over', 'This season is over. You can still play it for practice.')
      const had = (await store.games(player.id, season.id)).find((g) => g.ranked)
      if (had) refuse(409, 'refused', 'You have a ranked game in this season already.', { game: await summary(had, season) })
    }
    // Busy is said before the limit is counted, so that a player told to wait is not also charged for asking.
    if (work.full()) refuse(429, 'too-many', 'The server is busy. Try again in a moment.')
    if (!limit.games.take(player.id, now())) refuse(429, 'too-many', 'Too many new games. Try again in an hour.')
    const started = await runWork<{ state: Uint8Array; kept: Kept }>({ kind: 'start', season: season.season })
    const row: GameRow = {
      id: newId(),
      player: player.id,
      season: season.id,
      ranked,
      restarted: false,
      ...started.kept,
      started: new Date(now()).toISOString(),
      ended: null,
      rank: null,
      filled: false,
    }
    await store.addGame(row, started.state)
    if (ranked) board.touch(season.id)
    return { game: await summary(row, season) }
  })

  route('GET', '/api/games', async (req, _, url) => {
    const { player } = await who(req)
    const season = url.searchParams.get('season') ?? undefined
    const rows = await store.games(player.id, season || undefined)
    return { games: await Promise.all(rows.map((g) => summary(g))) }
  })

  route('GET', '/api/games/:id', async (req, [id]) => {
    const { player } = await who(req)
    const g = await ownGame(player, id!)
    return { game: await summary(g), done: await done(g.id) }
  })

  route('GET', '/api/games/:id/city', async (req, [id]) => {
    const { player } = await who(req)
    const g = await store.game(id!)
    const season = g ? await store.season(g.season) : null
    const mine = g?.player === player.id
    // Another's city may be looked round once it is finished, or its season is over (PRD MP-13).
    // Made-up games (`fill`) were never played, and have no city to look round.
    if (!g || !season || g.filled || (!mine && !(g.ranked && (g.status !== 'playing' || over(season, now())))))
      refuse(404, 'not-found', 'There is no such city to look round.')
    const owner = mine ? player : await store.player(g!.player)
    const kept = await store.state(g!.id)
    return {
      game: await summary(g!, season),
      done: await done(g!.id),
      player: { id: owner!.id, name: owner!.name },
      // The game as kept, so that the screen opens the city without playing its months again.
      state: kept && kept.length ? toWire(load(kept)) : null,
    }
  })

  route('POST', '/api/games/:id/months', async (req, [id]) => {
    const { player } = await who(req)
    const rules = req.headers['x-rules']
    if (typeof rules === 'string' && rules !== String(version)) {
      refuse(409, 'older-version', 'The game has been updated. It will reload without losing anything.', { rules: version })
    }
    const body = await readBody(req)
    const g = await ownGame(player, id!)
    const season = (await store.season(g.season))!
    const month = body.month
    const actions = body.actions ?? []
    if (typeof month !== 'number' || !Number.isInteger(month)) refuse(422, 'refused', 'Say which month is ending.')
    if (!Array.isArray(actions) || actions.length > MOST_ACTIONS) refuse(422, 'refused', 'Those actions could not be read.')
    if (work.full()) refuse(429, 'too-many', 'The server is busy. Try again in a moment.')
    if (!limit.months.take(player.id, now())) refuse(429, 'too-many', 'That is a lot of months in a minute. Slow down a little.')
    if (g.status !== 'playing') refuse(409, 'out-of-step', 'This game is over.', { game: await summary(g, season) })
    if (month !== g.month) refuse(409, 'out-of-step', 'That month does not follow the game as it is kept.', { game: await summary(g, season) })
    if (g.ranked && over(season, now())) refuse(403, 'season-over', 'This season is over. The game stands as it is.')
    const on = g.ranked && season.season.allowance !== false
    if (on && allowance(await store.spent(player.id, g.season), now(), true).left <= 0) {
      refuse(403, 'allowance', 'You have played all your months for today. More come at midnight, India time.', { game: await summary(g, season) })
    }
    if (busy.has(g.id)) refuse(409, 'out-of-step', 'The last month of this game is still being worked out.', { game: await summary(g, season) })
    busy.add(g.id)
    try {
      const state = await store.state(g.id)
      const out = await runWork<MonthOutcome>({ kind: 'month', state: state!, month: month as number, actions: actions as unknown[] })
      if (!out.ok) {
        if (out.code === 'refused') refuse(422, 'refused', out.message, { action: out.action })
        refuse(409, 'out-of-step', out.message, { game: await summary(g, season) })
      }
      const ok = out as Extract<MonthOutcome, { ok: true }>
      const t = now()
      const at = new Date(t).toISOString()
      await store.endMonth(
        g.id,
        ok.kept,
        ok.state,
        { month: month as number, at, actions: ok.actions as Action[], digest: ok.kept.digest },
        ok.kept.status === 'playing' ? null : at,
        g.ranked ? { player: player.id, season: g.season, at: t } : null,
      )
      if (g.ranked) board.touch(g.season)
      const after = (await store.game(g.id))!
      return { game: await summary(after, season), digest: ok.kept.digest }
    } finally {
      busy.delete(g.id)
    }
  })

  route('POST', '/api/games/:id/restart', async (req, [id]) => {
    const { player } = await who(req)
    const g = await ownGame(player, id!)
    const season = (await store.season(g.season))!
    if (!g.ranked) refuse(422, 'refused', 'A practice game is not restarted. Start a new one instead.')
    if (g.restarted) refuse(422, 'refused', 'A ranked game can be restarted once, and this one has been.')
    if (over(season, now())) refuse(403, 'season-over', 'This season is over. The game stands as it is.')
    if (busy.has(g.id)) refuse(409, 'out-of-step', 'The last month of this game is still being worked out.')
    const started = await runWork<{ state: Uint8Array; kept: Kept }>({ kind: 'start', season: season.season })
    await store.restart(g.id, started.kept, started.state, new Date(now()).toISOString())
    // The picture was of the game before; the game played again gives its own.
    deps.pictures?.drop(g.id)
    board.touch(g.season)
    return { game: await summary((await store.game(g.id))!, season) }
  })

  route('GET', '/api/board', async (req, _, url) => {
    const { player } = await who(req)
    const q = url.searchParams
    const season = q.get('season') ? await seasonOrRefuse(q.get('season')) : await current(store, now())
    if (!season) refuse(404, 'not-found', 'No season is open.')
    const scope = (q.get('scope') ?? 'all') as 'all' | 'friends' | 'zone'
    if (scope !== 'all' && scope !== 'friends' && scope !== 'zone') refuse(422, 'refused', 'There is no such board.')
    const from = Math.max(0, Math.min(1_000_000, Number.parseInt(q.get('from') ?? '0', 10) || 0))
    const count = Math.max(1, Math.min(100, Number.parseInt(q.get('count') ?? '50', 10) || 50))
    const friends = scope === 'friends' ? (await store.friends(player.id)).map((f) => f.id) : []
    return board.page(season!.id, season!.closed !== null, scope, from, count, { id: player.id, zone: player.zone, friends })
  })

  /** Whether anyone may look round a game's city: the rule of `/api/games/:id/city` for another's game. */
  async function openToAll(id: string): Promise<{ game: GameRow; season: SeasonRow } | null> {
    const g = await store.game(id)
    const season = g ? await store.season(g.season) : null
    if (!g || !season || g.filled || !g.ranked || (g.status === 'playing' && !over(season, now()))) return null
    return { game: g, season }
  }

  // Slice 9: the share picture (PRD MP-14). The player's own ranked game, finished, once; a PNG of 1200 × 630 by its
  // own bytes, whatever the request says it is.
  route('PUT', '/api/games/:id/picture', async (req, [id]) => {
    const { player } = await who(req)
    const g = await ownGame(player, id!)
    if (!deps.pictures) refuse(422, 'refused', 'Pictures are not kept on this server.')
    if (!g.ranked || g.filled) refuse(422, 'refused', 'Only a ranked game has a picture to share.')
    if (g.status === 'playing') refuse(422, 'refused', 'The game is not over yet.')
    if (deps.pictures!.has(g.id)) refuse(409, 'refused', 'This game has its picture already.')
    const length = Number(req.headers['content-length'] ?? 0)
    if (length > MOST_BYTES) refuse(413, 'refused', 'The picture is too large.')
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += (chunk as Buffer).length
      if (size > MOST_BYTES) refuse(413, 'refused', 'The picture is too large.')
      chunks.push(chunk as Buffer)
    }
    const problem = pngProblem(Buffer.concat(chunks))
    if (problem) refuse(422, 'refused', problem)
    if (!deps.pictures!.put(g.id, Buffer.concat(chunks))) refuse(409, 'refused', 'This game has its picture already.')
    return { kept: true }
  })

  route('GET', '/share/:id\\.png', async (_, [id]) => {
    const open = await openToAll(id!)
    const png = open && deps.pictures ? deps.pictures.read(open.game.id) : null
    if (!png) return new Raw(404, 'text/plain; charset=utf-8', 'There is no such picture.', 'no-store')
    return new Raw(200, 'image/png', png, 'public, max-age=3600')
  })

  route('GET', '/share/:id', async (_, [id]) => {
    const home = `${deps.publicUrl}/`
    const open = await openToAll(id!)
    if (!open) {
      return new Raw(404, 'text/html; charset=utf-8', sharePage({ title: 'Peak Ooru', line: 'There is no such city to look round.', to: home, image: null, url: home }), 'no-store')
    }
    const g = open.game
    const owner = await store.player(g.player)
    const kept = await store.state(g.id)
    // The line from the server's own copy of the game, never from anything a browser sent.
    const line = kept && kept.length ? shareLine(load(kept)).text : ''
    const score = g.score.toLocaleString('en-IN')
    const title = owner?.name ? `${owner.name}’s Bengaluru: ${score} of 1,000` : `Bengaluru, 2026–2036: ${score} of 1,000`
    const image = deps.pictures?.has(g.id) ? `${deps.publicUrl}/share/${g.id}.png` : null
    return new Raw(200, 'text/html; charset=utf-8', sharePage({ title, line, to: `${home}?city=${g.id}`, image, url: `${deps.publicUrl}/share/${g.id}` }), 'public, max-age=300')
  })

  route('GET', '/api/health', async () => ({ ok: true, rules: version, busy: work.full() }))

  async function runWork<T>(job: Job): Promise<T> {
    try {
      return await work.run<T>(job)
    } catch (e) {
      if (e instanceof TooMany) refuse(429, 'too-many', 'The server is busy. Try again in a moment.')
      throw e
    }
  }

  function send(res: ServerResponse, status: number, body: unknown, req?: IncomingMessage): void {
    let text: string | Buffer = JSON.stringify(body)
    const headers: Record<string, string> = {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    }
    if (deps.corsOrigin) {
      headers['access-control-allow-origin'] = deps.corsOrigin
      headers['access-control-allow-headers'] = 'authorization, content-type, x-rules'
      headers['access-control-allow-methods'] = 'GET, POST, PUT, DELETE'
    }
    // Large answers (a city's state) are compressed here, so that they are small without nginx too (the dev server);
    // nginx passes an answer already compressed as it is.
    if (text.length > 16_384 && /\bgzip\b/.test(String(req?.headers['accept-encoding'] ?? ''))) {
      text = gzipSync(text, { level: 6 })
      headers['content-encoding'] = 'gzip'
      headers.vary = 'Accept-Encoding'
    }
    res.writeHead(status, headers)
    res.end(text)
  }

  function sendRaw(res: ServerResponse, out: Raw, head: boolean): void {
    const body = typeof out.body === 'string' ? Buffer.from(out.body, 'utf8') : out.body
    res.writeHead(out.status, {
      'content-type': out.type,
      'content-length': String(body.length),
      'cache-control': out.cache,
      'x-content-type-options': 'nosniff',
      // The share page runs no script and loads nothing but its own picture; the picture itself, nothing at all.
      'content-security-policy': out.type === 'image/png' ? "default-src 'none'; sandbox" : "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      'referrer-policy': 'no-referrer',
    })
    res.end(head ? undefined : body)
  }

  /** The request handler for node:http. */
  return {
    board,
    limit,
    async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
      try {
        const url = new URL(req.url ?? '/', 'http://x')
        if (req.method === 'OPTIONS' && deps.corsOrigin) return send(res, 204, null)
        if (!limit.requests.take(address(req), now())) refuse(429, 'too-many', 'Too many requests. Slow down a little.')
        for (const [method, pattern, handler] of routes) {
          const m = pattern.exec(url.pathname)
          const head = req.method === 'HEAD' && method === 'GET' && url.pathname.startsWith('/share/')
          if (m && (method === req.method || head)) {
            const out = await handler(req, m.slice(1), url)
            if (out instanceof Raw) return sendRaw(res, out, head)
            return send(res, 200, out, req)
          }
        }
        refuse(404, 'not-found', 'There is nothing here.')
      } catch (e) {
        // A body left unread by a refusal is read and dropped, so that the answer reaches the asker rather than the
        // connection being cut under it; one refused for its size is not read on, and its connection is closed after.
        if (!req.complete) {
          if (e instanceof Refusal && e.status === 413) res.setHeader('connection', 'close')
          else req.resume()
        }
        if (e instanceof Refusal) return send(res, e.status, { error: { code: e.code, message: e.message, ...e.extra } })
        deps.log?.(`Failed: ${req.method} ${(req.url ?? '').split('?')[0]}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
        send(res, 500, { error: { code: 'server', message: 'Something went wrong on the server. Try again.' } })
      }
    },
  }
}

/**
 * The share page: what a chat reads to show a link's preview (the title, the line, the picture), and a person is sent
 * on at once to the city itself. No script: a chat's reader runs none, and the person's browser needs none.
 */
function sharePage(p: { title: string; line: string; to: string; image: string | null; url: string }): string {
  const title = escape(p.title)
  const line = escape(p.line)
  const to = escape(p.to)
  const image = p.image
    ? `<meta property="og:image" content="${escape(p.image)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="${WIDTH}">
<meta property="og:image:height" content="${HEIGHT}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${escape(p.image)}">`
    : '<meta name="twitter:card" content="summary">'
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${line}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Peak Ooru">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${line}">
<meta property="og:url" content="${escape(p.url)}">
${image}
<meta http-equiv="refresh" content="0; url=${to}">
<style>body{margin:0;padding:40px 20px;background:#f3f0ea;color:#26231f;font:16px/1.5 system-ui,sans-serif}a{color:#26231f}</style>
</head>
<body>
<h1 style="font-size:22px">${title}</h1>
<p>${line}</p>
<p><a href="${to}">Look round this city in Peak Ooru</a></p>
</body>
</html>
`
}
