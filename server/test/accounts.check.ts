import { generateKeyPairSync, sign } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { JsonWebKey } from '../src/google'
import { gameDigest } from '../../src/rules/digest'
import { fromWire } from '../../src/rules/wire'
import { canonical, load } from '../src/game'
import { nameProblem } from '../src/names'
import { closeSeason } from '../src/seasons'
import { fakeSmtp, harness } from './harness'

/*
 * Players, names, signing in by a stand-in mail server and a made-up Google credential, friends, deleting, and the
 * board. No mail leaves this machine and nothing is asked of Google.
 */

const CLIENT = 'test-client.apps.googleusercontent.com'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...(publicKey.export({ format: 'jwk' }) as JsonWebKey), kid: 'k1', alg: 'RS256', use: 'sig' }

function credential(claims: Record<string, unknown>, key = privateKey, kid = 'k1'): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const head = enc({ alg: 'RS256', kid, typ: 'JWT' })
  const body = enc({ iss: 'https://accounts.google.com', aud: CLIENT, exp: Math.floor(Date.parse('2026-10-01T07:00:00Z') / 1000), email_verified: true, ...claims })
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url')}`
}

let h: Awaited<ReturnType<typeof harness>>
let mail: Awaited<ReturnType<typeof fakeSmtp>>
beforeAll(async () => {
  mail = await fakeSmtp()
  h = await harness({ smtp: mail.smtp, mailer: mail.mailer, google: { clientId: CLIENT, keys: async () => [jwk] } })
  await h.addSeason('s1')
})
afterAll(async () => {
  await h.close()
  await mail.close()
})

const until = async (f: () => boolean) => {
  for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 20))
}

describe('names', () => {
  it('are 3 to 20 letters, digits and spaces, in any script', () => {
    expect(nameProblem('Anand Hegde')).toBeNull()
    expect(nameProblem('ಆನಂದ್')).toBeNull()
    expect(nameProblem('Nazir Khan')).toBeNull()
    expect(nameProblem('Hancock 2')).toBeNull()
    expect(nameProblem('ab')).toMatch(/at least 3/)
    expect(nameProblem('a'.repeat(21))).toMatch(/at most 20/)
    expect(nameProblem('<script>')).toMatch(/only letters/)
    expect(nameProblem('123')).toMatch(/a letter/)
    expect(nameProblem(42)).toBe('Choose a name.')
  })

  it('are checked against words not allowed, however spelled', () => {
    for (const bad of ['Fuck You', 'fuuuck', 'Sh1t head', 'B I T C H', 'the admin', 'Peak Ooru', 'nazi', 'big ass']) {
      expect(nameProblem(bad), bad).toMatch(/not allowed/)
    }
  })

  it('are not taken twice, alike whatever the case or spacing', async () => {
    const a = await h.newPlayer()
    const b = await h.newPlayer()
    expect((await h.call('PUT', '/me/name', a.token, { name: '  Kavya   Rao ' })).body.player.name).toBe('Kavya Rao')
    const r = await h.call('PUT', '/me/name', b.token, { name: 'kavyarao' })
    expect(r.status).toBe(409)
    expect(r.body.error.code).toBe('name-taken')
    expect((await h.call('PUT', '/me/name', b.token, { name: 'fuck' })).body.error.code).toBe('name-not-allowed')
  })
})

describe('signing in', () => {
  it('by email sends a link with a code that joins a second device to the first, keeping the games of both', async () => {
    const first = await h.newPlayer('Two Devices')
    const g1 = (await h.call('POST', '/games', first.token, { season: 's1', ranked: true })).body.game
    expect((await h.call('POST', '/signin/email', first.token, { email: 'Two@Example.com' })).body).toEqual({ sent: true })
    await until(() => mail.got.length >= 1)
    const code1 = /signin=([A-Za-z0-9_-]+)/.exec(mail.got.at(-1)!)![1]!
    expect(mail.got.at(-1)).toContain('https://peakooru.test/?signin=')
    expect(mail.got.at(-1)).toContain('To: two@example.com')
    const confirmed = await h.call('POST', '/signin/email/confirm', first.token, { code: code1 })
    expect(confirmed.body.player).toMatchObject({ id: first.id, signedIn: true, name: 'Two Devices' })
    // The device's token is replaced.
    expect((await h.call('GET', '/me', first.token)).status).toBe(401)
    const firstToken = confirmed.body.token as string
    // The code works once.
    expect((await h.call('POST', '/signin/email/confirm', firstToken, { code: code1 })).status).toBe(404)

    // A second device, with a ranked game and a practice game of its own.
    const second = await h.newPlayer()
    const g2 = (await h.call('POST', '/games', second.token, { season: 's1', ranked: true })).body.game
    const p2 = (await h.call('POST', '/games', second.token, { season: 's1', ranked: false })).body.game
    await h.call('POST', '/signin/email', second.token, { email: 'two@example.com' })
    await until(() => mail.got.length >= 2)
    const code2 = /signin=([A-Za-z0-9_-]+)/.exec(mail.got.at(-1)!)![1]!
    const joined = await h.call('POST', '/signin/email/confirm', second.token, { code: code2 })
    expect(joined.body.player.id).toBe(first.id)
    const games = (await h.call('GET', '/games', joined.body.token)).body.games as { id: string; ranked: boolean }[]
    expect(games.map((g) => g.id).sort()).toEqual([g1.id, g2.id, p2.id].sort())
    // One ranked game a season: the account's stays ranked; the device's becomes practice.
    expect(games.find((g) => g.id === g1.id)!.ranked).toBe(true)
    expect(games.find((g) => g.id === g2.id)!.ranked).toBe(false)
    // Both devices now play as one player.
    expect((await h.call('GET', '/me', firstToken)).body.player.id).toBe(first.id)
    expect(await h.store.player(second.id)).toBeNull()
  })

  it('by email always says sent, and is limited', async () => {
    const p = await h.newPlayer()
    expect((await h.call('POST', '/signin/email', p.token, { email: 'not an address' })).body.error.code).toBe('refused')
    const said = []
    for (let i = 0; i < 4; i++) said.push((await h.call('POST', '/signin/email', p.token, { email: 'many@example.com' })).status)
    expect(said).toEqual([200, 200, 200, 429])
  })

  it('by email says plainly when it is not set up', async () => {
    const bare = await harness()
    const p = await bare.newPlayer()
    const r = await bare.call('POST', '/signin/email', p.token, { email: 'a@example.com' })
    expect(r.status).toBe(422)
    expect(r.body.error).toMatchObject({ code: 'refused', message: 'Signing in by email is not set up on this server.' })
    const g = await bare.call('POST', '/signin/google', p.token, { credential: 'x' })
    expect(g.status).toBe(422)
    expect(g.body.error).toMatchObject({ code: 'refused', message: 'Signing in with Google is not set up on this server.' })
    await bare.close()
  })

  it('with Google, when Google\'s keys cannot be had, is refused in plain words, not as the server failing', async () => {
    const away = await harness({ google: { clientId: CLIENT, keys: async () => { throw new Error('offline') } } })
    const p = await away.newPlayer()
    const r = await away.call('POST', '/signin/google', p.token, { credential: credential({ email: 'k@example.com' }) })
    expect(r.status).toBe(422)
    expect(r.body.error.code).toBe('refused')
    expect(r.body.error.message).toMatch(/^Google sign-in could not be checked/)
    await away.close()
  })

  it('with Google takes a verified address from a credential signed by the key Google publishes', async () => {
    const p = await h.newPlayer()
    const r = await h.call('POST', '/signin/google', p.token, { credential: credential({ email: 'g@example.com' }) })
    expect(r.status).toBe(200)
    expect(r.body.player).toMatchObject({ id: p.id, signedIn: true })
    // The same address by email is the same account.
    const q = await h.newPlayer()
    const again = await h.call('POST', '/signin/google', q.token, { credential: credential({ email: 'G@example.com' }) })
    expect(again.body.player.id).toBe(p.id)
  })

  it('with Google refuses a credential that is forged, for another game, expired or unverified', async () => {
    const p = await h.newPlayer()
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
    const good = credential({ email: 'h@example.com' })
    const [head, body] = good.split('.')
    const tampered = `${head}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, 'base64url').toString()), email: 'victim@example.com' })).toString('base64url')}.${good.split('.')[2]}`
    for (const bad of [
      credential({ email: 'h@example.com' }, other),
      credential({ email: 'h@example.com' }, privateKey, 'k2'),
      credential({ email: 'h@example.com', aud: 'another' }),
      credential({ email: 'h@example.com', iss: 'https://evil.example' }),
      credential({ email: 'h@example.com', exp: 1 }),
      credential({ email: 'h@example.com', email_verified: false }),
      tampered,
      'not.a.credential',
      42,
    ]) {
      const r = await h.call('POST', '/signin/google', p.token, { credential: bad })
      expect(r.status).toBe(401)
      expect(r.body.error.code).toBe('unauthorised')
    }
    expect((await h.call('GET', '/me', p.token)).body.player.signedIn).toBe(false)
  })

  it('out stops the device\'s token', async () => {
    const p = await h.newPlayer()
    expect((await h.call('POST', '/signout', p.token)).body).toEqual({})
    expect((await h.call('GET', '/me', p.token)).status).toBe(401)
  })
})

describe('friends and deleting', () => {
  it('adds a friend by code, both ways, and drops them', async () => {
    const a = await h.newPlayer('Friend A')
    const b = await h.newPlayer('Friend B')
    expect((await h.call('POST', '/friends', a.token, { code: 'NOPE' })).body.error.code).toBe('not-found')
    expect((await h.call('POST', '/friends', a.token, { code: a.player.friendCode })).body.error.code).toBe('refused')
    const added = await h.call('POST', '/friends', a.token, { code: b.player.friendCode.toLowerCase() })
    expect(added.body.friends.map((f: { id: string }) => f.id)).toEqual([b.id])
    expect((await h.call('GET', '/friends', b.token)).body.friends.map((f: { id: string }) => f.id)).toEqual([a.id])
    expect((await h.call('DELETE', `/friends/${b.id}`, a.token)).body.friends).toEqual([])
    expect((await h.call('GET', '/friends', b.token)).body.friends).toEqual([])
  })

  it('deleting a player deletes everything kept with them', async () => {
    const p = await h.newPlayer('Soon Gone')
    const f = await h.newPlayer('Stays Here')
    await h.call('POST', '/friends', p.token, { code: f.player.friendCode })
    const g = (await h.call('POST', '/games', p.token, { season: 's1', ranked: true })).body.game
    await h.call('POST', `/games/${g.id}/months`, p.token, { month: 0, actions: [] })
    await h.call('PUT', '/me/zone', p.token, { zone: 3 })
    expect((await h.call('DELETE', '/me', p.token)).body).toEqual({})
    const left = (table: string, column: string, value: string) =>
      (h.store.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).get(value) as { n: number }).n
    expect(left('players', 'id', p.id)).toBe(0)
    expect(left('tokens', 'player', p.id)).toBe(0)
    expect(left('games', 'player', p.id)).toBe(0)
    expect(left('states', 'game', g.id)).toBe(0)
    expect(left('months', 'game', g.id)).toBe(0)
    expect(left('spent', 'player', p.id)).toBe(0)
    expect(left('friends', 'player', p.id) + left('friends', 'friend', p.id)).toBe(0)
    expect((await h.call('GET', '/me', p.token)).status).toBe(401)
    expect((await h.call('GET', '/friends', f.token)).body.friends).toEqual([])
  })

  it('a home zone must be a zone of the city', async () => {
    const p = await h.newPlayer()
    expect((await h.call('PUT', '/me/zone', p.token, { zone: 999_999 })).body.error.code).toBe('refused')
    expect((await h.call('PUT', '/me/zone', p.token, { zone: '3' })).body.error.code).toBe('refused')
    expect((await h.call('PUT', '/me/zone', p.token, { zone: 3 })).body.player.zone).toBe(3)
    expect((await h.call('PUT', '/me/zone', p.token, { zone: null })).body.player.zone).toBeNull()
  })
})

describe('the board', () => {
  it('ranks named players\' ranked games by score, then the earlier finish; friends and zone are the same ranks', async () => {
    const b = await harness()
    await b.addSeason('s')
    const t = '2026-10-01T00:00:00.000Z'
    const players = []
    for (const [name, score, ended, zone] of [
      ['Low Score', 300, null, 1], ['Late Finish', 700, '2026-10-05T00:00:00.000Z', 1], ['Early Finish', 700, '2026-10-02T00:00:00.000Z', 2],
      ['Top Score', 800, null, 1], [null, 999, null, 1],
    ] as const) {
      const p = await b.newPlayer(name ?? undefined)
      players.push(p)
      if (zone !== null) await b.call('PUT', '/me/zone', p.token, { zone })
      await b.store.addGame({ id: `g-${players.length}`, player: p.id, season: 's', ranked: true, restarted: false, month: ended ? 120 : 40,
        status: ended ? 'finished' : 'playing', score, points: [1, 2, 3, 4, 5, 6, 7], digest: '', started: t, ended, rank: null, filled: false }, new Uint8Array())
    }
    const all = await b.call('GET', '/board?season=s', players[0]!.token)
    expect(all.body.rows.map((r: { player: { name: string } }) => r.player.name)).toEqual(['Top Score', 'Early Finish', 'Late Finish', 'Low Score'])
    expect(all.body.rows.map((r: { rank: number }) => r.rank)).toEqual([1, 2, 3, 4])
    expect(all.body.total).toBe(4)
    expect(all.body.rows[0]).toMatchObject({ year: 2029, open: false, status: 'playing', points: [1, 2, 3, 4, 5, 6, 7] })
    expect(all.body.rows[1]).toMatchObject({ year: 2036, open: true })
    expect(all.body.mine).toMatchObject({ rank: 4, player: { name: 'Low Score' } })
    // The unnamed player is on no board, and has no row of their own.
    expect((await b.call('GET', '/board?season=s', players[4]!.token)).body.mine).toBeNull()
    const zone = await b.call('GET', '/board?season=s&scope=zone', players[0]!.token)
    expect(zone.body.rows.map((r: { rank: number }) => r.rank)).toEqual([1, 3, 4])
    await b.call('POST', '/friends', players[0]!.token, { code: players[2]!.player.friendCode })
    const friends = await b.call('GET', '/board?season=s&scope=friends', players[0]!.token)
    expect(friends.body.rows.map((r: { rank: number }) => r.rank)).toEqual([2, 4])
    const page = await b.call('GET', '/board?season=s&from=1&count=2', players[0]!.token)
    expect(page.body.rows.map((r: { rank: number }) => r.rank)).toEqual([2, 3])
    expect((await b.call('GET', '/board?season=s&scope=everyone', players[0]!.token)).body.error.code).toBe('refused')

    // Closed: ranks fixed as they stood, games in progress included; every city may be looked round.
    await closeSeason(b.store, 's', b.clock.t)
    await b.store.endMonth('g-1', { month: 41, status: 'playing', score: 950, points: [], digest: '' }, new Uint8Array(), { month: 40, at: t, actions: [], digest: '' }, null, null)
    b.clock.t += 5000
    const closed = await b.call('GET', '/board?season=s', players[0]!.token)
    expect(closed.body.rows.map((r: { player: { name: string }; open: boolean }) => [r.player.name, r.open])).toEqual([
      ['Top Score', true], ['Early Finish', true], ['Late Finish', true], ['Low Score', true],
    ])
    expect(closed.body.mine.rank).toBe(4)
    const city = await b.call('GET', '/games/g-4/city', players[0]!.token)
    expect(city.status).toBe(200)
    expect(city.body.player.name).toBe('Top Score')
    await b.close()
  })

  it('never opens a made-up city, and marks its row not open', async () => {
    const b = await harness()
    await b.addSeason('s')
    const p = await b.newPlayer('Made Up One')
    const t = '2026-10-01T00:00:00.000Z'
    await b.store.addGame({ id: 'filled1', player: p.id, season: 's', ranked: true, restarted: false, month: 120, status: 'finished',
      score: 900, points: [1, 2, 3, 4, 5, 6, 7], digest: '', started: t, ended: t, rank: null, filled: true }, new Uint8Array())
    const q = await b.newPlayer('Looker')
    const board = await b.call('GET', '/board?season=s', q.token)
    expect(board.body.rows[0]).toMatchObject({ game: 'filled1', open: false })
    const r = await b.call('GET', '/games/filled1/city', q.token)
    expect(r.status).toBe(404)
    expect(r.body.error.code).toBe('not-found')
    await closeSeason(b.store, 's', b.clock.t)
    expect((await b.call('GET', '/board?season=s', q.token)).body.rows[0].open).toBe(false)
    await b.close()
  })

  it('shows a player\'s row at once after they name themselves', async () => {
    const b = await harness()
    await b.addSeason('s')
    const p = await b.newPlayer()
    await b.call('POST', '/games', p.token, { season: 's', ranked: true })
    expect((await b.call('GET', '/board?season=s', p.token)).body.mine).toBeNull()
    await b.call('PUT', '/me/name', p.token, { name: 'Just Named' })
    expect((await b.call('GET', '/board?season=s', p.token)).body.mine.player.name).toBe('Just Named')
    await b.call('PUT', '/me/name', p.token, { name: 'Named Again' })
    expect((await b.call('GET', '/board?season=s', p.token)).body.mine.player.name).toBe('Named Again')
    await b.close()
  })

  it('shows another\'s city only once finished, with what they did and when', async () => {
    const a = await h.newPlayer('City Owner')
    const b = await h.newPlayer('City Visitor')
    const g = (await h.call('POST', '/games', a.token, { season: 's1', ranked: true })).body.game
    await h.call('POST', `/games/${g.id}/months`, a.token, { month: 0, actions: [{ kind: 'tax', rate: 10500 }] })
    expect((await h.call('GET', `/games/${g.id}/city`, b.token)).status).toBe(404)
    const own = await h.call('GET', `/games/${g.id}/city`, a.token)
    expect(own.body.done).toEqual([{ month: 0, action: { kind: 'tax', rate: 10500 }, at: '2026-10-01T06:00:00.000Z' }])
    h.store.db.prepare("UPDATE games SET status = 'finished' WHERE id = ?").run(g.id)
    const seen = await h.call('GET', `/games/${g.id}/city`, b.token)
    expect(seen.status).toBe(200)
    expect(seen.body.player).toEqual({ id: a.id, name: 'City Owner' })
    expect(seen.body.done.length).toBe(1)
    // The kept game itself, so that the screen need not play the months again.
    const state = fromWire(seen.body.state)
    const kept = load((await h.store.state(g.id))!)
    expect(canonical(state)).toStrictEqual(canonical({ ...kept, reports: [] }))
    expect(gameDigest(state)).toBe((await h.store.game(g.id))!.digest)
  })
})
