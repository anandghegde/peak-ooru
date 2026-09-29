import { ApiError, type Api, type GameSummary } from './types'

/** How long a request may take before it counts as the server not answering. A phone on a poor signal is slow. */
const WAIT_MS = 15_000

/** The server's interface over the network, at `base` (`/api` unless the build says otherwise). */
export function httpApi(base: string): Api {
  const api: Api = {
    token: null,
    newPlayer: () => call('POST', '/players'),
    me: () => call('GET', '/me'),
    setName: (name) => call('PUT', '/me/name', { name }),
    setZone: (zone) => call('PUT', '/me/zone', { zone }),
    signInEmail: (email) => call('POST', '/signin/email', { email }),
    confirmEmail: (code) => call('POST', '/signin/email/confirm', { code }),
    signInGoogle: (credential) => call('POST', '/signin/google', { credential }),
    signOut: () => call('POST', '/signout'),
    deleteMe: () => call('DELETE', '/me'),
    addFriend: (code) => call('POST', '/friends', { code }),
    dropFriend: (id) => call('DELETE', `/friends/${encodeURIComponent(id)}`),
    friends: () => call('GET', '/friends'),
    season: () => call('GET', '/seasons/current'),
    newGame: (season, ranked) => call('POST', '/games', { season, ranked }),
    games: (season) => call('GET', `/games?season=${encodeURIComponent(season)}`),
    game: (id) => call('GET', `/games/${encodeURIComponent(id)}`),
    endMonth: (id, month) => call('POST', `/games/${encodeURIComponent(id)}/months`, month, true),
    restart: (id) => call('POST', `/games/${encodeURIComponent(id)}/restart`),
    city: (id) => call('GET', `/games/${encodeURIComponent(id)}/city`),
    board: (season, scope, from, count) =>
      call('GET', `/board?season=${encodeURIComponent(season)}&scope=${scope}&from=${from}&count=${count}`),
    picture: async (id, png) => {
      const headers: Record<string, string> = { 'Content-Type': 'image/png' }
      if (api.token) headers.Authorization = `Bearer ${api.token}`
      const stop = new AbortController()
      const timer = setTimeout(() => stop.abort(), WAIT_MS)
      let response: Response
      try {
        response = await fetch(`${base}/games/${encodeURIComponent(id)}/picture`, { method: 'PUT', headers, body: png, signal: stop.signal })
      } catch {
        throw new ApiError('offline', 'The game’s server cannot be reached.')
      } finally {
        clearTimeout(timer)
      }
      // Kept already, from this device or another: as good as sent.
      if (response.ok || response.status === 409) return
      const error = (await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null)?.error
      throw new ApiError(error?.code ?? 'offline', error?.message ?? 'The picture was not taken.', response.status)
    },
  }

  async function call<T>(method: string, path: string, body?: unknown, rules = false): Promise<T> {
    const headers: Record<string, string> = {}
    if (api.token) headers.Authorization = `Bearer ${api.token}`
    // So that the server can tell a screen whose rules are older than its own.
    if (rules && api.rules) headers['X-Rules'] = String(api.rules)
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const stop = new AbortController()
    const timer = setTimeout(() => stop.abort(), WAIT_MS)
    let response: Response
    try {
      response = await fetch(`${base}${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: stop.signal,
      })
    } catch {
      throw new ApiError('offline', 'The game’s server cannot be reached.')
    } finally {
      clearTimeout(timer)
    }
    // A server that is not the game's (a proxy with nothing behind it, a page of HTML) is as good as none.
    const json = await response.json().catch(() => null) as
      | (T & { error?: { code?: string; message?: string; game?: GameSummary; action?: number } })
      | null
    if (response.ok && json) return json
    const error = json?.error
    if (response.status === 401 && !error?.code) throw new ApiError('unauthorised', 'Not signed in.', 401)
    // A server that fails in itself without saying why is tried again later, as if it were away.
    if (!error?.code) {
      throw new ApiError('offline', 'The game’s server is not answering as it should.', response.status)
    }
    throw new ApiError(error.code, error.message ?? 'The server refused.', response.status, error.game, error.action)
  }

  return api
}
