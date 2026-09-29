import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { firstSeason } from '../../src/seasons/first'
import { limits } from '../src/limits'
import { closeSeason } from '../src/seasons'
import { harness } from './harness'

/*
 * A player with a changed browser: every way of getting a score the server did not work out, or a month the rules or
 * the allowance do not allow.
 */

let h: Awaited<ReturnType<typeof harness>>
beforeAll(async () => {
  h = await harness()
  await h.addSeason('s1')
  await h.addSeason('lean', { ...firstSeason, id: 'lean', months: 2 })
  await h.addSeason('daily', { ...firstSeason, id: 'daily', allowance: true })
})
afterAll(() => h.close())

async function game(token: string, season = 's1', ranked = true) {
  const r = await h.call('POST', '/games', token, { season, ranked })
  expect(r.status).toBe(200)
  return r.body.game as { id: string; month: number; score: number }
}

describe('a changed browser', () => {
  it('cannot send in a score: the answer and the board are the server\'s own', async () => {
    const p = await h.newPlayer('Cheater One')
    const g = await game(p.token)
    const r = await h.call('POST', `/games/${g.id}/months`, p.token, {
      month: 0,
      actions: [],
      digest: 'ffffffff',
      score: 1000,
      points: [1000, 1000, 1000, 1000, 1000, 1000, 1000],
      game: { score: 1000, month: 119, status: 'finished' },
    })
    expect(r.status).toBe(200)
    expect(r.body.game.month).toBe(1)
    expect(r.body.game.score).toBeLessThan(700)
    expect(r.body.digest).not.toBe('ffffffff')
    expect(r.body.digest).toMatch(/^[0-9a-f]{8}$/)
    const kept = await h.store.game(g.id)
    expect(kept!.score).toBe(r.body.game.score)
    h.handler.board.touch()
    h.clock.t += 5000
    const board = await h.call('GET', '/board?season=s1', p.token)
    expect(board.body.mine.score).toBe(r.body.game.score)
  })

  it('cannot do an action the rules refuse: the month is refused, naming it, and nothing is kept', async () => {
    const p = await h.newPlayer()
    const g = await game(p.token)
    const before = await h.store.state(g.id)
    const r = await h.call('POST', `/games/${g.id}/months`, p.token, {
      month: 0,
      actions: [{ kind: 'borrow', amount: 100_000 }, { kind: 'borrow', amount: 999_999_999 }],
    })
    expect(r.status).toBe(422)
    expect(r.body.error.code).toBe('refused')
    expect(r.body.error.action).toBe(1)
    expect(r.body.error.message).toMatch(/^[A-Z].*\.$/)
    expect(Buffer.from((await h.store.state(g.id))!).equals(Buffer.from(before!))).toBe(true)
    expect((await h.store.game(g.id))!.month).toBe(0)
    expect(await h.store.months(g.id)).toEqual([])
  })

  it('cannot spend money it does not have, or start more than three major works', async () => {
    const p = await h.newPlayer()
    const g = await game(p.token)
    const r = await h.call('POST', `/games/${g.id}/months`, p.token, { month: 0, actions: [{ kind: 'repay', loan: 1 }] })
    expect(r.body.error.code).toBe('refused')
    const on = { kind: 'digOnce', on: true }
    const off = { kind: 'digOnce', on: false }
    const r2 = await h.call('POST', `/games/${g.id}/months`, p.token, { month: 0, actions: [on, off, on, off, on, off, on] })
    expect(r2.body.error).toMatchObject({ code: 'refused', action: 6 })
  })

  it('cannot skip a month, go back a month, or send one twice', async () => {
    const p = await h.newPlayer()
    const g = await game(p.token)
    expect((await h.call('POST', `/games/${g.id}/months`, p.token, { month: 1, actions: [] })).body.error.code).toBe('out-of-step')
    expect((await h.call('POST', `/games/${g.id}/months`, p.token, { month: 0, actions: [] })).status).toBe(200)
    const again = await h.call('POST', `/games/${g.id}/months`, p.token, { month: 0, actions: [] })
    expect(again.body.error.code).toBe('out-of-step')
    expect(again.body.error.game.month).toBe(1)
    expect((await h.call('POST', `/games/${g.id}/months`, p.token, { month: -1, actions: [] })).body.error.code).toBe('out-of-step')
  })

  it('cannot end the same month twice at once', async () => {
    const p = await h.newPlayer()
    const g = await game(p.token)
    const both = await Promise.all([0, 1].map(() => h.call('POST', `/games/${g.id}/months`, p.token, { month: 0, actions: [] })))
    expect(both.map((r) => r.status).sort()).toEqual([200, 409])
    expect((await h.store.months(g.id)).length).toBe(1)
  })

  it('cannot touch another player\'s game', async () => {
    const a = await h.newPlayer('Owner Of Game')
    const b = await h.newPlayer('Not The Owner')
    const g = await game(a.token)
    for (const [method, path, body] of [
      ['POST', `/games/${g.id}/months`, { month: 0, actions: [] }],
      ['GET', `/games/${g.id}`, undefined],
      ['POST', `/games/${g.id}/restart`, undefined],
      ['GET', `/games/${g.id}/city`, undefined],
    ] as const) {
      const r = await h.call(method, path, b.token, body)
      expect(r.status, `${method} ${path}`).toBe(404)
      expect(r.body.error.code).toBe('not-found')
    }
    expect((await h.store.game(g.id))!.month).toBe(0)
  })

  it('cannot play a ranked game after its season has closed, but may practise', async () => {
    await h.addSeason('ending')
    const p = await h.newPlayer('Late Player')
    const g = await game(p.token, 'ending')
    await closeSeason(h.store, 'ending', h.clock.t)
    const r = await h.call('POST', `/games/${g.id}/months`, p.token, { month: 0, actions: [] })
    expect(r.status).toBe(403)
    expect(r.body.error.code).toBe('season-over')
    expect((await h.call('POST', `/games/${g.id}/restart`, p.token)).body.error.code).toBe('season-over')
    const q = await h.newPlayer()
    expect((await h.call('POST', '/games', q.token, { season: 'ending', ranked: true })).body.error.code).toBe('season-over')
    expect((await h.call('POST', '/games', q.token, { season: 'ending', ranked: false })).status).toBe(200)
  })

  it('cannot play past its closing time even before the season is closed by command', async () => {
    await h.addSeason('short', firstSeason, 1)
    const p = await h.newPlayer()
    const g = await game(p.token, 'short')
    h.clock.t += 2 * 86_400_000
    try {
      expect((await h.call('POST', `/games/${g.id}/months`, p.token, { month: 0, actions: [] })).body.error.code).toBe('season-over')
    } finally {
      h.clock.t -= 2 * 86_400_000
    }
  })

  it('cannot play beyond the daily allowance, which the server keeps by its own clock', async () => {
    const p = await h.newPlayer()
    const g = await game(p.token, 'daily')
    expect((await h.call('GET', `/games/${g.id}`, p.token)).body.game.allowance).toMatchObject({ on: true, left: 12 })
    // Eleven months ended earlier today, as the store keeps them; the twelfth by the server.
    for (let i = 0; i < 11; i++) h.store.db.prepare('INSERT INTO spent (player, season, at) VALUES (?, ?, ?)').run(p.id, 'daily', h.clock.t - 1000)
    const twelfth = await h.call('POST', `/games/${g.id}/months`, p.token, { month: 0, actions: [] })
    expect(twelfth.status).toBe(200)
    expect(twelfth.body.game.allowance.left).toBe(0)
    expect(twelfth.body.game.allowance.more).toBe('2026-10-01T18:30:00.000Z')
    const thirteenth = await h.call('POST', `/games/${g.id}/months`, p.token, { month: 1, actions: [] })
    expect(thirteenth.status).toBe(403)
    expect(thirteenth.body.error.code).toBe('allowance')
    // Midnight in India: twelve more.
    h.clock.t = Date.parse('2026-10-01T18:31:00Z')
    const next = await h.call('POST', `/games/${g.id}/months`, p.token, { month: 1, actions: [] })
    expect(next.status).toBe(200)
    expect(next.body.game.allowance.left).toBe(11)
    h.clock.t = Date.parse('2026-10-01T06:00:00Z')
  })

  it('has no allowance in a practice game', async () => {
    const p = await h.newPlayer()
    const g = await game(p.token, 'daily', false)
    for (let i = 0; i < 40; i++) h.store.db.prepare('INSERT INTO spent (player, season, at) VALUES (?, ?, ?)').run(p.id, 'daily', h.clock.t - 1000)
    const r = await h.call('POST', `/games/${g.id}/months`, p.token, { month: 0, actions: [] })
    expect(r.status).toBe(200)
    expect(r.body.game.allowance.on).toBe(false)
    // And a practice game's months do not use the ranked allowance.
    expect((await h.store.spent(p.id, 'daily')).length).toBe(40)
  })

  it('cannot play a month after the last: a finished game refuses any more', async () => {
    const p = await h.newPlayer()
    const g = await game(p.token, 'lean')
    expect((await h.call('POST', `/games/${g.id}/months`, p.token, { month: 0, actions: [] })).status).toBe(200)
    const last = await h.call('POST', `/games/${g.id}/months`, p.token, { month: 1, actions: [] })
    expect(last.body.game).toMatchObject({ month: 2, status: 'finished' })
    expect(last.body.game.ended).not.toBeNull()
    const beyond = await h.call('POST', `/games/${g.id}/months`, p.token, { month: 2, actions: [] })
    expect(beyond.status).toBe(409)
    expect(beyond.body.error.code).toBe('out-of-step')
  })

  it('cannot have two ranked games in a season, or restart more than once', async () => {
    const p = await h.newPlayer()
    const g = await game(p.token)
    const second = await h.call('POST', '/games', p.token, { season: 's1', ranked: true })
    expect(second.status).toBe(409)
    expect(second.body.error.game.id).toBe(g.id)
    await h.call('POST', `/games/${g.id}/months`, p.token, { month: 0, actions: [] })
    const once = await h.call('POST', `/games/${g.id}/restart`, p.token)
    expect(once.body.game).toMatchObject({ id: g.id, month: 0, restarted: true })
    expect(await h.store.months(g.id)).toEqual([])
    expect((await h.call('POST', `/games/${g.id}/restart`, p.token)).body.error.code).toBe('refused')
    // Practice games are many, and are not restarted.
    const a = await game(p.token, 's1', false)
    await game(p.token, 's1', false)
    expect((await h.call('POST', `/games/${a.id}/restart`, p.token)).body.error.code).toBe('refused')
  })

  it('cannot get round the checks with a bad token, a large body, or a body that is not JSON', async () => {
    const p = await h.newPlayer()
    const g = await game(p.token)
    expect((await h.call('GET', '/me', 'not-a-token')).status).toBe(401)
    expect((await h.call('GET', '/me', null)).body.error.code).toBe('unauthorised')
    expect((await h.call('POST', `/games/${g.id}/months`, p.token, '{"month":0,')).status).toBe(400)
    expect((await h.call('POST', `/games/${g.id}/months`, p.token, 'x'.repeat(300_000))).status).toBe(413)
    expect((await h.call('POST', `/games/${g.id}/months`, p.token, { month: 0, actions: new Array(201).fill({ kind: 'x' }) })).body.error.code).toBe('refused')
    expect((await h.call('POST', `/games/${g.id}/months`, p.token, { month: '0', actions: [] })).body.error.code).toBe('refused')
    expect((await h.call('POST', `/games/${g.id}/months`, p.token, { month: 0, actions: 'tax' })).body.error.code).toBe('refused')
    expect((await h.call('POST', `/games/${g.id}/months`, p.token, '{"month":0,"actions":[{"__proto__":{"kind":"tax","rate":10500}}]}')).body.error.code).toBe('refused')
    expect((await h.call('POST', `/games/${g.id}/months`, p.token, { month: 0, actions: [{ kind: 'tax', rate: 10500.5 }] })).body.error.code).toBe('refused')
    expect((await h.store.game(g.id))!.month).toBe(0)
  })

  it('cannot end more than 30 months a minute, or make more new players an hour from one address than set', async () => {
    const p = await h.newPlayer()
    const g = await game(p.token)
    const codes: string[] = []
    // Out of step on purpose, so that no month is worked out: the limit is taken first.
    for (let i = 0; i < 31; i++) codes.push((await h.call('POST', `/games/${g.id}/months`, p.token, { month: 99, actions: [] })).body.error.code)
    expect(codes.slice(0, 30).every((c) => c === 'out-of-step')).toBe(true)
    expect(codes[30]).toBe('too-many')
    // 200 an hour by default (a carrier's address carries many phones); settable, here to 3.
    expect(limits().players.take('x', 0)).toBe(true)
    const few = await harness({ limits: { playersPerHour: 3 } })
    const made = []
    for (let i = 0; i < 4; i++) made.push((await few.call('POST', '/players', null, undefined, { 'x-real-ip': '203.0.113.9' })).status)
    expect(made).toEqual([200, 200, 200, 429])
    await few.close()
    const many = limits()
    const took = Array.from({ length: 201 }, () => many.players.take('203.0.113.9', 0))
    expect(took.filter(Boolean).length).toBe(200)
  })

  it('is refused with too-many when the workers are busy, keeping nothing', async () => {
    let full = false
    const busy = await harness({ busy: () => full })
    await busy.addSeason('s')
    const p = await busy.newPlayer()
    const g = (await busy.call('POST', '/games', p.token, { season: 's', ranked: true })).body.game
    full = true
    const r = await busy.call('POST', `/games/${g.id}/months`, p.token, { month: 0, actions: [] })
    expect(r.status).toBe(429)
    expect(r.body.error.code).toBe('too-many')
    expect((await busy.store.game(g.id))!.month).toBe(0)
    full = false
    expect((await busy.call('POST', `/games/${g.id}/months`, p.token, { month: 0, actions: [] })).status).toBe(200)
    await busy.close()
  })
})
