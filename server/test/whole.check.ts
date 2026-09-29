import { afterAll, beforeAll, expect, it } from 'vitest'
import { gameDigest } from '../../src/rules/digest'
import { firstSeason } from '../../src/seasons/first'
import { load, replayMonths } from '../src/game'
import { city, harness } from './harness'

/*
 * A whole game through the server: 120 months, a few actions on the way, the 121st refused; then played again from
 * what the store kept, month by month, and found the same. About a minute and a half.
 */

let h: Awaited<ReturnType<typeof harness>>
beforeAll(async () => {
  h = await harness()
  await h.addSeason('s1')
})
afterAll(() => h.close())

it('plays 120 months, refuses the 121st, and plays again from the store to the same game', async () => {
  const p = await h.newPlayer('Whole Game')
  let game = (await h.call('POST', '/games', p.token, { season: 's1', ranked: true })).body.game
  const sent: string[] = []
  for (let m = 0; m < 120; m++) {
    const actions = m % 12 === 0 && m > 0 ? [{ kind: 'tax', rate: Math.min(15_000, 10000 + (m / 12) * 500) }] : []
    // 30 months a minute is the limit; the test's clock moves on two seconds a month.
    h.clock.t += 2000
    const r = await h.call('POST', `/games/${game.id}/months`, p.token, { month: m, actions, digest: '00000000' })
    expect(r.status, `month ${m}: ${JSON.stringify(r.body.error)}`).toBe(200)
    game = r.body.game
    sent.push(r.body.digest)
    if (game.status !== 'playing') break
  }
  // The rules may end a game early (a default, or the player replaced); either way no month follows its last.
  expect(game.status).not.toBe('playing')
  if (game.status === 'finished') expect(game.month).toBe(120)
  h.clock.t += 2000
  const beyond = await h.call('POST', `/games/${game.id}/months`, p.token, { month: game.month, actions: [] })
  expect(beyond.body.error.code).toBe('out-of-step')

  const months = await h.store.months(game.id)
  expect(months.length).toBe(game.month)
  const again = replayMonths(firstSeason, city, months.map((m) => m.actions))
  expect(again.digests).toEqual(months.map((m) => m.digest))
  expect(again.digests).toEqual(sent)
  const kept = load((await h.store.state(game.id))!)
  expect(gameDigest(kept)).toBe(gameDigest(again.game))
  expect(kept.score?.total).toBe(game.score)
  console.log(`a whole game: ${game.status} at month ${game.month}, score ${game.score}, state kept ${((await h.store.state(game.id))!.length / 1024).toFixed(0)} KB`)
}, 300_000)
