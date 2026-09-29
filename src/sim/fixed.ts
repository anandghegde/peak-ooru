/**
 * Arithmetic that gives the same answer on every machine. JavaScript's Math.exp, Math.log and Math.pow may differ
 * in the last digit between engines; addition, multiplication, division and square root may not. So e to a power
 * is read from a table built here with multiplications only, and interpolated in straight lines.
 */

const STEP = 32 // table entries per unit
const RANGE = 60 // e^-60 is taken as nothing
const table = buildTable()

function buildTable(): Float64Array {
  // e^(-1/32) by its series, then each entry the one before times that: multiplications only.
  const x = -1 / STEP
  let term = 1
  let e = 1
  for (let k = 1; k <= 20; k++) {
    term = (term * x) / k
    e += term
  }
  const out = new Float64Array(RANGE * STEP + 2)
  out[0] = 1
  for (let i = 1; i < out.length; i++) out[i] = out[i - 1]! * e
  return out
}

/** e^(-x) for x ≥ 0, to about one part in eight thousand. Negative x is treated as 0. */
export function expNeg(x: number): number {
  if (x <= 0) return 1
  const f = x * STEP
  if (f >= RANGE * STEP) return 0
  const i = Math.floor(f)
  const r = f - i
  const a = table[i]!
  return a + (table[i + 1]! - a) * r
}
