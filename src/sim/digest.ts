import { MODES, PERIODS, type MonthResult } from './types'

/**
 * A fingerprint of every number in a month's result but the time it took, to the last bit: two machines agree on a
 * month if and only if (short of a one-in-four-billion accident) their fingerprints agree. FNV-1a over the bytes.
 */
export function digest(r: MonthResult): string {
  let h = 0x811c9dc5
  const bytes = (a: ArrayBufferView) => {
    const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
    for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i]!, 0x01000193)
  }
  const numbers = (xs: number[]) => bytes(Float64Array.from(xs))
  numbers([r.month, r.commute, r.access])
  for (const p of PERIODS) {
    bytes(r.flow[p])
    bytes(r.speed[p])
  }
  bytes(r.commuteByZone)
  bytes(r.accessByZone)
  numbers(MODES.map((m) => r.trips[m]))
  const lines = Object.keys(r.riders).sort()
  numbers(lines.map((k) => r.riders[k]!))
  // Any further numbers the model adds, in a fixed order.
  const extra = JSON.stringify(r, (key, value) =>
    ['flow', 'speed', 'commuteByZone', 'accessByZone', 'took'].includes(key) ? undefined : value,
  )
  for (let i = 0; i < extra.length; i++) h = Math.imul(h ^ extra.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(16).padStart(8, '0')
}
