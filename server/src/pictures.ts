import { closeSync, existsSync, linkSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { crc32 } from 'node:zlib'

/*
 * The share pictures (PRD MP-14): a PNG the player's browser drew of their finished game, served to anyone the link
 * reaches. A file from a stranger, so it is taken only as a whole, well-formed PNG of exactly the agreed size, and kept
 * under a name made from the game's id as the store has it.
 */

/** The picture's size: the link's preview in a chat. */
export const WIDTH = 1200
export const HEIGHT = 630
/** The most a picture may weigh. */
export const MOST_BYTES = 400 * 1024

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Why these bytes are not a picture the server will keep, or null if they are: a PNG by its signature, every chunk
 * whole with its checksum right, the header first and saying 1200 × 630, image data present, and nothing after the end.
 */
export function pngProblem(b: Buffer): string | null {
  if (b.length > MOST_BYTES) return 'The picture is too large.'
  if (b.length < SIGNATURE.length + 12 * 3 + 13 || !b.subarray(0, 8).equals(SIGNATURE)) return 'That is not a PNG picture.'
  let at = 8
  let first = true
  let data = false
  while (at + 12 <= b.length) {
    const length = b.readUInt32BE(at)
    const type = b.toString('latin1', at + 4, at + 8)
    if (!/^[A-Za-z]{4}$/.test(type) || length > b.length - at - 12) return 'The picture is not a whole PNG.'
    const body = b.subarray(at + 8, at + 8 + length)
    if (crc32(b.subarray(at + 4, at + 8 + length)) !== b.readUInt32BE(at + 8 + length)) return 'The picture is not a whole PNG.'
    if (first) {
      if (type !== 'IHDR' || length !== 13) return 'The picture is not a whole PNG.'
      if (body.readUInt32BE(0) !== WIDTH || body.readUInt32BE(4) !== HEIGHT) return `The picture must be ${WIDTH} by ${HEIGHT}.`
      first = false
    } else if (type === 'IHDR') return 'The picture is not a whole PNG.'
    if (type === 'IDAT') data = true
    at += 12 + length
    if (type === 'IEND') return at === b.length && data ? null : 'The picture is not a whole PNG.'
  }
  return 'The picture is not a whole PNG.'
}

const SAFE = /^[A-Za-z0-9_-]{1,64}$/

/** The pictures, as files in one folder beside the store. */
export class Pictures {
  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true })
  }

  private file(game: string): string {
    // The id is the store's own; checked again all the same, so that no name can lead out of the folder.
    if (!SAFE.test(game)) throw new Error('A game id that cannot name a file.')
    return join(this.dir, `${game}.png`)
  }

  has(game: string): boolean {
    return existsSync(this.file(game))
  }

  read(game: string): Buffer | null {
    try {
      return readFileSync(this.file(game))
    } catch {
      return null
    }
  }

  /**
   * Keeps a picture, once: false if the game has one already. Written whole to a file of its own and then linked into
   * place, which fails if the name is taken, so that two at once cannot both be kept, nor a half-written one served.
   */
  put(game: string, png: Buffer): boolean {
    const final = this.file(game)
    const temp = join(this.dir, `.${randomBytes(8).toString('hex')}.part`)
    const fd = openSync(temp, 'wx', 0o644)
    try {
      writeSync(fd, png)
    } finally {
      closeSync(fd)
    }
    try {
      linkSync(temp, final)
      return true
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false
      throw e
    } finally {
      unlinkSync(temp)
    }
  }

  drop(game: string): void {
    try {
      unlinkSync(this.file(game))
    } catch {
      // None was kept.
    }
  }
}
