import type { Game } from './types'

/*
 * A game as plain JSON, for sending a kept game whole (slice 8: another player's city, opened without playing its
 * months again). Typed arrays (the last month's flows and speeds) become `{ "$typed": "Int32Array", "values": [...] }`;
 * a property whose value is `undefined` becomes `{ "$undefined": true }`, so that the game comes back exactly as it
 * was. Reports are left out: the server does not keep them.
 */

const TYPED = {
  Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array,
} as const
type TypedName = keyof typeof TYPED

function encode(x: unknown): unknown {
  if (x === undefined) return { $undefined: true }
  if (ArrayBuffer.isView(x)) {
    const name = x.constructor.name as TypedName
    if (!(name in TYPED)) throw new Error(`A ${name} cannot be sent.`)
    return { $typed: name, values: Array.from(x as unknown as ArrayLike<number>) }
  }
  if (typeof x === 'number' && !Number.isFinite(x)) throw new Error('A number that is not finite cannot be sent.')
  if (Array.isArray(x)) return x.map(encode)
  if (x && typeof x === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(x)) out[k] = encode(v)
    return out
  }
  return x
}

function decode(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(decode)
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>
    if (o.$undefined === true) return undefined
    if (typeof o.$typed === 'string' && Array.isArray(o.values)) {
      const make = TYPED[o.$typed as TypedName]
      if (!make) throw new Error(`There is no ${o.$typed}.`)
      return make.from(o.values as number[])
    }
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(o)) out[k] = decode(v)
    return out
  }
  return x
}

/** The game, reports aside, as a value JSON.stringify keeps whole. */
export function toWire(game: Game): unknown {
  return encode({ ...game, reports: [] })
}

/** The game back from `toWire`'s value (after JSON.parse). */
export function fromWire(wire: unknown): Game {
  return decode(wire) as Game
}
