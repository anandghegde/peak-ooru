import { describe, expect, it } from 'vitest'
import { firstSeason } from '../src/seasons/first'
import { Outbox, type OutboxHooks } from '../src/net/outbox'
import { standInApi } from '../src/net/standin'
import { ApiError, type Api, type GameSummary } from '../src/net/types'
import { howItStands, ordinal, pointsOf } from '../src/ui/board'

/** A storage in memory, as the browser's would be, shared between outboxes to stand for a page closed and opened. */
function memory(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  }
}

async function player(api: Api, ranked = true): Promise<GameSummary> {
  api.token = (await api.newPlayer()).token
  const season = (await api.season()).season.id
  return (await api.newGame(season, ranked)).game
}

function hooks(api: Api) {
  const seen = { checked: [] as number[], refused: [] as [number, string][], apart: 0, same: [] as boolean[] }
  const h: OutboxHooks = {
    api: () => api,
    checked: (_g, month, _s, same) => {
      seen.checked.push(month)
      seen.same.push(same)
    },
    refused: (_g, month, e) => void seen.refused.push([month, e.code]),
    apart: () => void seen.apart++,
    changed: () => {},
  }
  return { h, seen }
}

const settle = async (box: Outbox) => {
  void box.pump()
  for (let i = 0; i < 200 && box.queue.length; i++) await new Promise((r) => setTimeout(r, 5))
  await new Promise((r) => setTimeout(r, 5))
}

describe('months sent to the server', () => {
  it('go one at a time, in order, and are acknowledged', async () => {
    const api = standInApi({ season: { ...firstSeason, allowance: false }, rules: 1 })
    const game = await player(api)
    const { h, seen } = hooks(api)
    const box = new Outbox('q', h, memory())
    for (let m = 0; m < 5; m++) box.queue.push({ game: game.id, month: m, actions: [], digest: `d${m}` })
    await settle(box)
    expect(seen.checked).toEqual([0, 1, 2, 3, 4])
    expect(seen.same.every(Boolean)).toBe(true)
    expect((await api.game(game.id)).game.month).toBe(5)
  })

  it('are kept while the server is away, survive the page closing, and go when it is back', async () => {
    const real = standInApi({ season: { ...firstSeason, allowance: false }, rules: 1 })
    const game = await player(real)
    let away = true
    const flaky: Api = { ...real, endMonth: (id, m) => (away ? Promise.reject(new ApiError('offline', 'away')) : real.endMonth(id, m)) }
    const storage = memory()
    const first = new Outbox('q', hooks(flaky).h, storage)
    first.add({ game: game.id, month: 0, actions: [{ kind: 'tax', rate: 10500 }], digest: 'a' })
    first.add({ game: game.id, month: 1, actions: [], digest: 'b' })
    await new Promise((r) => setTimeout(r, 30))
    expect(first.offline).toBe(true)
    expect(first.queue).toHaveLength(2)
    // The page closes; a new one opens with what was kept, and the server is back.
    away = false
    const { h, seen } = hooks(flaky)
    const second = new Outbox('q', h, storage)
    expect(second.queue.map((q) => q.month)).toEqual([0, 1])
    await settle(second)
    expect(seen.checked).toEqual([0, 1])
    const kept = await real.game(game.id)
    expect(kept.game.month).toBe(2)
    expect(kept.done).toEqual([{ month: 0, action: { kind: 'tax', rate: 10500 } }])
  })

  it('that the server already has (their answer lost) are dropped, and the rest go on', async () => {
    const api = standInApi({ season: { ...firstSeason, allowance: false }, rules: 1 })
    const game = await player(api)
    await api.endMonth(game.id, { month: 0, actions: [], digest: 'x' })
    const { h, seen } = hooks(api)
    const box = new Outbox('q', h, memory())
    box.queue.push({ game: game.id, month: 0, actions: [], digest: 'x' }, { game: game.id, month: 1, actions: [], digest: 'y' })
    await settle(box)
    expect(seen.checked).toEqual([1])
    expect(seen.apart).toBe(0)
  })

  it('that do not follow the server’s game are dropped and the game called apart', async () => {
    const api = standInApi({ season: { ...firstSeason, allowance: false }, rules: 1 })
    const game = await player(api)
    const { h, seen } = hooks(api)
    const box = new Outbox('q', h, memory())
    box.queue.push({ game: game.id, month: 3, actions: [], digest: 'x' }, { game: game.id, month: 4, actions: [], digest: 'y' })
    await settle(box)
    expect(seen.apart).toBe(1)
    expect(box.queue).toHaveLength(0)
  })

  it('beyond the day’s allowance are refused, with the months after them', async () => {
    const api = standInApi({ season: { ...firstSeason, allowance: true }, rules: 1, now: () => Date.parse('2026-10-01T06:00:00Z') })
    const game = await player(api)
    const { h, seen } = hooks(api)
    const box = new Outbox('q', h, memory())
    for (let m = 0; m < 14; m++) box.queue.push({ game: game.id, month: m, actions: [], digest: 'd' })
    await settle(box)
    expect(seen.checked).toHaveLength(12)
    expect(seen.refused).toEqual([[12, 'allowance']])
    expect(box.queue).toHaveLength(0)
    expect((await api.game(game.id)).game.allowance.left).toBe(0)
  })

  it('with a fingerprint that differs from the server’s are acknowledged as differing', async () => {
    const real = standInApi({ season: { ...firstSeason, allowance: false }, rules: 1 })
    const game = await player(real)
    const other: Api = { ...real, endMonth: async (id, m) => ({ ...(await real.endMonth(id, m)), digest: 'ffffffff' }) }
    const { h, seen } = hooks(other)
    const box = new Outbox('q', h, memory())
    box.add({ game: game.id, month: 0, actions: [], digest: '00000000' })
    await settle(box)
    expect(seen.same).toEqual([false])
  })
})

describe('the board', () => {
  it('gives a page of 50,000 rows in rank order, with the player’s own row wherever it stands', async () => {
    const api = standInApi({ season: firstSeason, rules: 1, crowd: 50_000, scoreOf: () => ({ score: 600, points: [60, 60, 60, 60, 60, 60, 60] }) })
    const game = await player(api)
    await api.setName('Somebody')
    const season = (await api.season()).season.id
    const page = await api.board(season, 'all', 30_000, 50)
    expect(page.total).toBe(50_001)
    expect(page.rows).toHaveLength(50)
    expect(page.rows.map((r) => r.rank)).toEqual(Array.from({ length: 50 }, (_, i) => 30_001 + i))
    expect(page.mine?.game).toBe(game.id)
    const around = await api.board(season, 'all', page.mine!.rank - 2, 3)
    expect(around.rows[1]!.game).toBe(game.id)
    expect(around.rows[0]!.score).toBeGreaterThanOrEqual(600)
    expect(around.rows[2]!.score).toBeLessThanOrEqual(600)
  })

  it('leaves off players with no name', async () => {
    const api = standInApi({ season: firstSeason, rules: 1 })
    await player(api)
    const season = (await api.season()).season.id
    expect(await api.board(season, 'all', 0, 10)).toEqual({ rows: [], total: 0, mine: null })
  })

  it('writes places and endings plainly', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 1203].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '1,203rd'])
    expect(howItStands({ status: 'playing', year: 2029 })).toBe('Playing, in 2029')
    expect(howItStands({ status: 'finished', year: 2036 })).toBe('Term completed')
    expect(howItStands({ status: 'default', year: 2031 })).toBe('Defaulted in 2031')
  })

  it('reads the measures’ points whole or in tenths', () => {
    expect(pointsOf([64.6, 40, 60])).toEqual([64.6, 40, 60])
    expect(pointsOf([646, 400, 600])).toEqual([64.6, 40, 60])
  })
})

describe('names', () => {
  it('are refused when too short or taken', async () => {
    const api = standInApi({ season: firstSeason, rules: 1 })
    await player(api)
    await expect(api.setName('ab')).rejects.toMatchObject({ code: 'name-not-allowed' })
    await api.setName('Asha')
    await player(api)
    await expect(api.setName('asha')).rejects.toMatchObject({ code: 'name-taken' })
  })
})

describe('a ranked game', () => {
  it('may be restarted once a season; practice games have no allowance', async () => {
    const api = standInApi({ season: { ...firstSeason, allowance: true }, rules: 1 })
    const game = await player(api)
    const again = (await api.restart(game.id)).game
    expect(again.restarted).toBe(true)
    await expect(api.restart(again.id)).rejects.toMatchObject({ code: 'refused' })
    const practice = (await api.newGame((await api.season()).season.id, false)).game
    expect(practice.allowance.on).toBe(false)
    expect(again.allowance.on).toBe(true)
  })
})
