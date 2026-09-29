import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { firstSeason } from '../../src/seasons/first'
import { keptOf, load, save } from '../src/game'
import { Pictures, pngProblem } from '../src/pictures'
import { harness } from './harness'

/*
 * The share picture and page (slice 9, PRD MP-14). The upload takes a file from a stranger's browser and serves it to
 * others, so each test here attacks one of its rules: whose game, which game, what bytes, how large, how often, under
 * what name; and whether anything a browser sends can reach the share page's words.
 */

const dir = mkdtempSync(join(tmpdir(), 'peakooru-pictures-'))
let h: Awaited<ReturnType<typeof harness>>
beforeAll(async () => {
  h = await harness({ pictures: new Pictures(dir) })
  await h.addSeason('s1')
})
afterAll(async () => {
  await h.close()
  rmSync(dir, { recursive: true, force: true })
})

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])))
  return Buffer.concat([head, body, crc])
}

/** A real PNG, grey, of the size given; `extra` chunks before the image data. */
function png(width = 1200, height = 630, extra: Buffer[] = []): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // greyscale
  const rows = Buffer.alloc(height * (width + 1), 0xee)
  for (let y = 0; y < height; y++) rows[y * (width + 1)] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...extra,
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

async function put(id: string, token: string | null, body: Buffer | string, type = 'image/png') {
  const r = await fetch(`${h.root}/api/games/${id}/picture`, {
    method: 'PUT',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': type },
    body,
  })
  return { status: r.status, body: (await r.json()) as any }
}

const get = (path: string, method = 'GET') => fetch(`${h.root}${path}`, { method })

/** A player with a ranked game in s1, made finished in the store, with figures that bear out a line. */
async function finished(name?: string, ranked = true) {
  const p = await h.newPlayer(name)
  const game = (await h.call('POST', '/games', p.token, { season: 's1', ranked })).body.game
  const g = load((await h.store.state(game.id))!)
  g.status = 'finished'
  g.month = 120
  // Twelve months with the commute 14 minutes under the city's as it began.
  g.measured = Array.from({ length: 12 }, (_, k) => ({ ...firstSeason.opening!, month: 108 + k, commute: firstSeason.opening!.commute - 14 * 60 - 30 }))
  const at = new Date(h.clock.t).toISOString()
  await h.store.endMonth(game.id, keptOf(g), save(g), { month: 0, at, actions: [], digest: keptOf(g).digest }, at, null)
  return { ...p, game: game.id as string }
}

it('keeps a well-formed 1200 × 630 PNG of the player’s own finished game, once, and serves it as a PNG that is not sniffed', async () => {
  const p = await finished('Share One')
  const picture = png()
  expect((await put(p.game, p.token, picture)).status).toBe(200)
  const again = await put(p.game, p.token, png())
  expect(again.status).toBe(409)
  const r = await get(`/share/${p.game}.png`)
  expect(r.status).toBe(200)
  expect(r.headers.get('content-type')).toBe('image/png')
  expect(r.headers.get('x-content-type-options')).toBe('nosniff')
  expect(Buffer.from(await r.arrayBuffer()).equals(picture)).toBe(true)
  // Kept under a name made from the game's id, and nothing else left in the folder.
  expect(readdirSync(dir)).toContain(`${p.game}.png`)
  expect(readdirSync(dir).filter((f) => f.startsWith('.'))).toEqual([])
})

it('refuses a picture without a token, for another player’s game, a practice game, or a game still playing', async () => {
  const owner = await finished('Share Owner')
  const other = await h.newPlayer('Share Other')
  expect((await put(owner.game, null, png())).status).toBe(401)
  expect((await put(owner.game, other.token, png())).status).toBe(404)
  const practice = await finished('Share Practice', false)
  expect((await put(practice.game, practice.token, png())).body.error.code).toBe('refused')
  const playing = await h.newPlayer('Share Playing')
  const game = (await h.call('POST', '/games', playing.token, { season: 's1', ranked: true })).body.game
  const r = await put(game.id, playing.token, png())
  expect(r.status).toBe(422)
  expect(readdirSync(dir)).not.toContain(`${game.id}.png`)
  expect(readdirSync(dir)).not.toContain(`${owner.game}.png`)
})

it('judges the bytes, not what the request says they are', async () => {
  const p = await finished('Share Bytes')
  // HTML called a PNG.
  const html = '<!doctype html><script>alert(1)</script>'
  expect((await put(p.game, p.token, html, 'image/png')).status).toBe(422)
  // A JPEG's first bytes.
  expect((await put(p.game, p.token, Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.alloc(200)]))).status).toBe(422)
  // A PNG's signature and nothing whole after it.
  expect((await put(p.game, p.token, png().subarray(0, 60))).status).toBe(422)
  // A PNG with a chunk whose checksum is wrong.
  const bad = png()
  bad[40] = bad[40]! ^ 0xff
  expect((await put(p.game, p.token, bad)).status).toBe(422)
  // A PNG with a page hidden after its end.
  expect((await put(p.game, p.token, Buffer.concat([png(), Buffer.from(html)]))).status).toBe(422)
  // A good PNG sent as text/html is still a good PNG: kept, and served as a PNG.
  expect((await put(p.game, p.token, png(), 'text/html')).status).toBe(200)
  expect((await get(`/share/${p.game}.png`)).headers.get('content-type')).toBe('image/png')
})

it('refuses a PNG of any other size, read from its header', async () => {
  const p = await finished('Share Size')
  for (const [w, hgt] of [[1201, 630], [630, 1200], [1080, 1350], [1, 1]]) {
    const r = await put(p.game, p.token, png(w, hgt))
    expect(r.status, `${w} × ${hgt}`).toBe(422)
    expect(r.body.error.message).toMatch(/1200 by 630/)
  }
  expect(pngProblem(png())).toBeNull()
})

it('refuses anything over 400 KB, however it is sent', async () => {
  const p = await finished('Share Large')
  // A well-formed PNG made heavy with a text chunk.
  const heavy = png(1200, 630, [chunk('tEXt', Buffer.alloc(401 * 1024, 0x41))])
  expect((await put(p.game, p.token, heavy)).status).toBe(413)
  // Sent in pieces, without saying its length.
  const r = await fetch(`${h.root}/api/games/${p.game}/picture`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${p.token}` },
    body: new ReadableStream({
      start(c) {
        for (let i = 0; i < 10; i++) c.enqueue(new Uint8Array(50 * 1024))
        c.close()
      },
    }),
    duplex: 'half',
  } as RequestInit)
  expect(r.status).toBe(413)
  expect(readdirSync(dir)).not.toContain(`${p.game}.png`)
})

it('takes the file’s name from the game as kept, never from the request', async () => {
  const p = await finished('Share Name')
  for (const id of ['..%2F..%2Fevil', '../evil', `${p.game}.png`, `${p.game}%00`]) {
    const r = await fetch(`${h.root}/api/games/${id}/picture`, { method: 'PUT', headers: { authorization: `Bearer ${p.token}` }, body: png() })
    expect(r.status, id).toBe(404)
  }
  expect(readdirSync(dir).every((f) => /^[A-Za-z0-9_-]+\.png$/.test(f))).toBe(true)
})

it('says the title and line from the server’s own figures, escaped, and nothing the browser sent', async () => {
  const p = await finished('Asha K')
  await put(p.game, p.token, png())
  const r = await get(`/share/${p.game}?title=%3Cscript%3Ealert(1)%3C/script%3E&line=I+won`)
  expect(r.status).toBe(200)
  expect(r.headers.get('content-type')).toBe('text/html; charset=utf-8')
  expect(r.headers.get('content-security-policy')).toContain("default-src 'none'")
  const page = await r.text()
  expect(page).not.toContain('<script')
  expect(page).not.toContain('I won')
  expect(page).toContain('<title>Asha K’s Bengaluru:')
  expect(page).toContain('I cut Bengaluru’s commute by 14 minutes.')
  expect(page).toContain(`<meta property="og:image" content="https://peakooru.test/share/${p.game}.png">`)
  expect(page).toContain(`url=https://peakooru.test/?city=${p.game}`)
  // A name the rules would refuse cannot be set, so cannot reach the page.
  const bad = await h.call('PUT', '/me/name', p.token, { name: '<b>x</b>' })
  expect(bad.status).toBe(422)
  // A chat's reader may ask for the head alone.
  const head = await get(`/share/${p.game}`, 'HEAD')
  expect(head.status).toBe(200)
})

it('has no share page or picture for a game others may not look round', async () => {
  const practice = await finished('Share Hidden', false)
  expect((await get(`/share/${practice.game}`)).status).toBe(404)
  expect((await get(`/share/${practice.game}.png`)).status).toBe(404)
  const playing = await h.newPlayer('Share Busy')
  const game = (await h.call('POST', '/games', playing.token, { season: 's1', ranked: true })).body.game
  expect((await get(`/share/${game.id}`)).status).toBe(404)
  expect((await get('/share/nosuchgame')).status).toBe(404)
  // A finished game without a picture still has its page, with no picture named.
  const bare = await finished('Share Bare')
  const page = await (await get(`/share/${bare.game}`)).text()
  expect(page).not.toContain('og:image')
})

it('forgets the picture when the game is restarted, and when the player is deleted', async () => {
  const p = await finished('Share Gone')
  await put(p.game, p.token, png())
  expect((await h.call('POST', `/games/${p.game}/restart`, p.token)).status).toBe(200)
  expect(readdirSync(dir)).not.toContain(`${p.game}.png`)
  const q = await finished('Share Deleted')
  await put(q.game, q.token, png())
  expect(readdirSync(dir)).toContain(`${q.game}.png`)
  expect((await h.call('DELETE', '/me', q.token)).status).toBe(200)
  expect(readdirSync(dir)).not.toContain(`${q.game}.png`)
})
