import { MEASURES } from './score'
import type { Game } from './types'

/*
 * The game's fingerprint (slice 8, docs/API.md): what the server and the screen compare after each month. Eight hex
 * digits of FNV-1a (as the model's `src/sim/digest.ts`) over the score's total and the points of its seven measures,
 * the money, the month, the status, and every month's figures kept for the score (`Game.measured`). Not reports,
 * words or timings, which the server does not keep.
 *
 * Exact on every engine: every number is taken as a whole number and hashed as two 32-bit words (low, then high), by
 * integer arithmetic only. A number that is not whole (none should be) is hashed by its shortest decimal form, which
 * ECMAScript fixes exactly.
 */
export function gameDigest(game: Game): string {
  let h = 0x811c9dc5
  const word = (w: number) => {
    for (let s = 0; s < 32; s += 8) h = Math.imul(h ^ ((w >>> s) & 0xff), 0x01000193)
  }
  const text = (t: string) => {
    for (let i = 0; i < t.length; i++) h = Math.imul(h ^ (t.charCodeAt(i) & 0xff), 0x01000193)
    word(t.length)
  }
  const num = (n: number) => {
    if (Number.isSafeInteger(n)) {
      word(n >>> 0)
      word(Math.floor(n / 4294967296) | 0)
    } else text(String(n))
  }

  const score = game.score
  num(score ? score.total : -1)
  for (const key of MEASURES) num(score?.measures.find((m) => m.key === key)?.points ?? -1)
  num(game.money)
  num(game.month)
  text(game.status)
  const measured = game.measured ?? []
  num(measured.length)
  for (const m of measured) {
    num(m.month)
    for (const key of MEASURES) num(m[key])
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
