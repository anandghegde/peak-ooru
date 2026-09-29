import { allowance } from '../rules/allowance'
import type { Done, Season } from '../rules/types'
import { ApiError, type Api, type BoardRow, type Friend, type GameSummary, type Player, type Scope, type SeasonInfo } from './types'

/*
 * The server as docs/API.md has it, answered in the browser from memory. It is what a practice game uses when the
 * server cannot be reached, what the screen's tests run against, and what the screen was built against before the
 * server existed. It keeps the rules of the interface (months in step, the allowance, one ranked game with one restart,
 * names) but not the rules of the game: it has no model, so it takes the screen's fingerprint as its own.
 */

interface Kept {
  players: Record<string, Player & { token: string; friends: string[] }>
  games: Record<string, { summary: GameSummary; done: Done[]; times: number[]; owner: string }>
  next: number
}

export interface StandInOptions {
  /** Where its memory is kept between visits, or nothing to keep it only while the page is open. */
  storage?: string
  season: Season
  rules: number
  /** Made-up players on the board, to see how it looks full. */
  crowd?: number
  /** The score and points of a game as the screen has it, since the stand-in cannot work them out. */
  scoreOf?: (game: string) => { score: number; points: number[] } | null
  /** The clock, for the allowance. */
  now?: () => number
  /** Put before every id it makes, to tell its games from the server's. */
  prefix?: string
}

const DAY = 86_400_000
const NAMES = ['Asha', 'Bhaskar', 'Chitra', 'Deepak', 'Esha', 'Farhan', 'Gowri', 'Harish', 'Indu', 'Jagdish', 'Kavya',
  'Lokesh', 'Meera', 'Naveen', 'Omkar', 'Prakash', 'Rukmini', 'Suresh', 'Tanvi', 'Uday', 'Vani', 'Yashas', 'Zoya']

/** A made-up player's row, the same each time it is asked for. */
function crowdRow(i: number, total: number): Omit<BoardRow, 'rank'> {
  let h = Math.imul(i + 1, 2654435761) >>> 0
  const rand = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) % 1000) / 1000
  const score = Math.round(905 - 560 * Math.pow(i / Math.max(1, total), 0.8))
  const year = rand() < 0.3 ? 2036 : 2027 + Math.floor(rand() * 9)
  const status = year < 2036 ? 'playing' : rand() < 0.08 ? 'replaced' : 'finished'
  const name = `${NAMES[i % NAMES.length]} ${String.fromCharCode(65 + (Math.floor(i / NAMES.length) % 26))}${i > 500 ? i : ''}`
  return {
    player: { id: `crowd-${i}`, name },
    game: `crowd-${i}`,
    score,
    points: Array.from({ length: 7 }, () => Math.round(Math.min(100, Math.max(0, score / 10 + (rand() - 0.5) * 50)))),
    status,
    year,
    open: status !== 'playing',
  }
}

/** A stand-in for the server that answers from memory in the page. */
export function standInApi(options: StandInOptions): Api {
  const now = options.now ?? Date.now
  const opens = new Date(now() - 5 * DAY).toISOString()
  const info: SeasonInfo = {
    id: options.season.id,
    name: options.season.name,
    twist: 'The city as it stands in January 2026, with the Pink and Blue lines opening on the published dates.',
    opens,
    closes: new Date(Date.parse(opens) + 28 * DAY).toISOString(),
    rules: options.rules,
    season: options.season,
  }
  let kept: Kept = { players: {}, games: {}, next: 1 }
  try {
    if (options.storage) kept = JSON.parse(localStorage.getItem(options.storage) ?? 'null') ?? kept
  } catch {
    // Nothing kept, or nothing readable: start empty.
  }
  const save = () => {
    try {
      if (options.storage) localStorage.setItem(options.storage, JSON.stringify(kept))
    } catch {
      // A browser that keeps nothing loses the stand-in's memory on leaving, which only a practice game uses.
    }
  }
  const id = (kind: string) => `${options.prefix ?? ''}${kind}-${kept.next++}-${Math.floor(now() % 1e6)}`
  const refuse = (code: string, message: string, status = 400, game?: GameSummary): never => {
    throw new ApiError(code, message, status, game)
  }
  const me = () => {
    const p = Object.values(kept.players).find((x) => x.token === api.token)
    return p ?? refuse('unauthorised', 'Not signed in.', 401)
  }
  const plain = (p: Kept['players'][string]): Player =>
    ({ id: p.id, name: p.name, signedIn: p.signedIn, friendCode: p.friendCode, zone: p.zone })
  const friendsOf = (p: Kept['players'][string]): { friends: Friend[] } =>
    ({ friends: p.friends.map((f) => ({ id: f, name: kept.players[f]?.name ?? null })) })
  const own = (gameId: string) => {
    const g = kept.games[gameId]
    if (!g || g.owner !== me().id) refuse('not-found', 'There is no such game.', 404)
    return g!
  }
  const summary = (g: Kept['games'][string]): GameSummary => {
    const s = options.scoreOf?.(g.summary.id)
    const on = g.summary.ranked && options.season.allowance !== false
    const a = allowance(g.times, now(), on)
    return {
      ...g.summary,
      ...(s ?? {}),
      allowance: { on, left: on ? a.left : 120, more: on ? new Date(a.next).toISOString() : null },
    }
  }
  const crowd = options.crowd ?? 0
  const sleep = () => new Promise((r) => setTimeout(r, 0))

  const api: Api = {
    token: null,
    async newPlayer() {
      const token = `t-${id('token')}`
      const p = { id: id('player'), name: null, signedIn: false, friendCode: `F${kept.next++}${Math.floor(now() % 1e4)}`, zone: null, token, friends: [] }
      kept.players[p.id] = p
      save()
      return { player: plain(p), token }
    },
    async me() {
      return { player: plain(me()) }
    },
    async setName(name) {
      const p = me()
      const clean = name.trim()
      if (!/^[\p{L}\p{N} ]{3,20}$/u.test(clean)) refuse('name-not-allowed', 'A name is 3 to 20 letters, digits or spaces.')
      if (Object.values(kept.players).some((o) => o.id !== p.id && o.name?.toLowerCase() === clean.toLowerCase())) {
        refuse('name-taken', 'Someone has that name already.')
      }
      p.name = clean
      save()
      return { player: plain(p) }
    },
    async setZone(zone) {
      const p = me()
      p.zone = zone
      save()
      return { player: plain(p) }
    },
    async signInEmail() {
      me()
      return { sent: true }
    },
    async confirmEmail(code) {
      const p = me()
      if (code !== 'standin') refuse('not-found', 'That link has expired. Ask for a new one.', 404)
      p.signedIn = true
      save()
      return { player: plain(p), token: p.token }
    },
    async signInGoogle() {
      return refuse('refused', 'Google sign-in is not set up here.')
    },
    async signOut() {
      me()
      api.token = null
      return {}
    },
    async deleteMe() {
      const p = me()
      delete kept.players[p.id]
      for (const [k, g] of Object.entries(kept.games)) if (g.owner === p.id) delete kept.games[k]
      save()
      return {}
    },
    async addFriend(code) {
      const p = me()
      const f = Object.values(kept.players).find((o) => o.friendCode === code.trim().toUpperCase())
      if (!f || f.id === p.id) refuse('not-found', 'No player has that friend code.', 404)
      if (!p.friends.includes(f!.id)) p.friends.push(f!.id)
      save()
      return friendsOf(p)
    },
    async dropFriend(friend) {
      const p = me()
      p.friends = p.friends.filter((f) => f !== friend)
      save()
      return friendsOf(p)
    },
    async friends() {
      return friendsOf(me())
    },
    async season() {
      return { season: info }
    },
    async newGame(season, ranked) {
      const p = me()
      if (season !== info.id) refuse('season-over', 'That season has closed.')
      if (ranked && Object.values(kept.games).some((g) => g.owner === p.id && g.summary.ranked && g.summary.season === season)) {
        refuse('refused', 'You have a ranked game this season already.')
      }
      const g = {
        owner: p.id, done: [], times: [],
        summary: {
          id: id(ranked ? 'ranked' : 'practice'), season, ranked, month: 0, status: 'playing' as const, score: 0,
          points: [0, 0, 0, 0, 0, 0, 0], restarted: false, allowance: { on: false, left: 0, more: null },
          started: new Date(now()).toISOString(), ended: null,
        },
      }
      kept.games[g.summary.id] = g
      save()
      return { game: summary(g) }
    },
    async games(season) {
      const p = me()
      return { games: Object.values(kept.games).filter((g) => g.owner === p.id && g.summary.season === season).map(summary) }
    },
    async game(gameId) {
      const g = own(gameId)
      return { game: summary(g), done: g.done }
    },
    async endMonth(gameId, sent) {
      await sleep()
      const g = own(gameId)
      if (sent.month !== g.summary.month) refuse('out-of-step', 'This month does not follow your game.', 409, summary(g))
      if (g.summary.status !== 'playing') refuse('refused', 'This game is over.')
      const on = g.summary.ranked && options.season.allowance !== false
      if (allowance(g.times, now(), on).left <= 0) refuse('allowance', 'You have played all your months for today.', 429)
      g.done.push(...sent.actions.map((action) => ({ month: sent.month, action })))
      g.times.push(now())
      g.summary.month++
      if (g.summary.month >= options.season.months) {
        g.summary.status = 'finished'
        g.summary.ended = new Date(now()).toISOString()
      }
      save()
      return { game: summary(g), digest: sent.digest }
    },
    async restart(gameId) {
      const g = own(gameId)
      if (!g.summary.ranked || g.summary.restarted) refuse('refused', 'A ranked game may be restarted once a season.')
      const fresh = { ...g, done: [], times: [], summary: { ...g.summary, id: id('ranked'), month: 0, status: 'playing' as const, restarted: true, started: new Date(now()).toISOString(), ended: null } }
      delete kept.games[gameId]
      kept.games[fresh.summary.id] = fresh
      save()
      return { game: summary(fresh) }
    },
    async city(gameId) {
      const g = kept.games[gameId]
      if (g) {
        const owner = kept.players[g.owner]
        return { game: summary(g), done: g.done, player: { id: g.owner, name: owner?.name ?? null } }
      }
      const i = Number(/^crowd-(\d+)$/.exec(gameId)?.[1] ?? NaN)
      if (!(i >= 0 && i < crowd)) return refuse('not-found', 'There is no such game.', 404)
      const row = crowdRow(i, crowd)
      if (!row.open) refuse('not-found', 'That city can be seen once its game is over.', 404)
      return {
        game: {
          id: gameId, season: info.id, ranked: true, month: options.season.months, status: row.status, score: row.score,
          points: row.points, restarted: false, allowance: { on: false, left: 0, more: null }, started: opens, ended: opens,
        },
        done: [],
        player: row.player,
      }
    },
    async board(season, scope, from, count) {
      await sleep()
      const p = me()
      if (season !== info.id) return { rows: [], total: 0, mine: null }
      const named = Object.values(kept.games).filter((g) => g.summary.ranked && g.summary.season === season && kept.players[g.owner]?.name)
      const real = named.map((g): Omit<BoardRow, 'rank'> => {
        const s = summary(g)
        return {
          player: { id: g.owner, name: kept.players[g.owner]!.name! }, game: s.id, score: s.score, points: s.points,
          status: s.status, year: 2026 + Math.floor(s.month / 12), open: s.status !== 'playing',
        }
      }).filter((r) => scope !== 'friends' || r.player.id === p.id || p.friends.includes(r.player.id))
        .filter((r) => scope !== 'zone' || kept.players[r.player.id]?.zone === p.zone)
        .sort((a, b) => b.score - a.score)
      // The made-up crowd is everyone's; friends and zone boards have only the real players.
      const others = scope === 'all' ? crowd : 0
      // Real rows go in among the crowd by score; the crowd's scores fall with their place.
      const places = real.map((r) => {
        let lo = 0, hi = others
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          if (crowdRow(mid, others).score > r.score) lo = mid + 1
          else hi = mid
        }
        return lo
      })
      const total = others + real.length
      const at = (rank0: number): BoardRow => {
        // The rows before this place: real ones placed before it, and the crowd.
        let realBefore = 0
        for (let k = 0; k < real.length; k++) {
          if (places[k]! + k === rank0) return { rank: rank0 + 1, ...real[k]! }
          if (places[k]! + k < rank0) realBefore++
        }
        return { rank: rank0 + 1, ...crowdRow(rank0 - realBefore, others) }
      }
      const rows: BoardRow[] = []
      for (let r = from; r < Math.min(total, from + count); r++) rows.push(at(r))
      const k = real.findIndex((r) => r.player.id === p.id)
      return { rows, total, mine: k >= 0 ? { rank: places[k]! + k + 1, ...real[k]! } : null }
    },
  }
  return api
}
