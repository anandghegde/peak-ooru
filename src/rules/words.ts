/** Words and numbers for the player: plain English, Indian digit grouping. */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December']

/** "March 2028" for month 26. */
export function monthName(month: number): string {
  return `${MONTHS[((month % 12) + 12) % 12]} ${2026 + Math.floor(month / 12)}`
}

/** The calendar year a month falls in. */
export const yearOf = (month: number) => 2026 + Math.floor(month / 12)

/** Indian grouping of a whole number: 1,23,45,678. */
export function grouped(n: number): string {
  const s = String(Math.abs(Math.round(n)))
  const head = s.slice(0, -3)
  const tail = s.slice(-3)
  const body = head ? `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}` : tail
  return n < 0 ? `−${body}` : body
}

/** Money for the player, from lakh: "₹2,140 crore", "−₹35 crore", "₹4.5 crore" when small. */
export function crore(lakh: number): string {
  const sign = lakh < 0 ? '−' : ''
  const a = Math.abs(lakh)
  const text = a >= 1000 ? grouped(Math.round(a / 100)) : String(Math.round(a / 10) / 10)
  return `${sign}₹${text} crore`
}

/** A fare in paise a km, for the player: "₹4.50 a km". */
export function perKm(paise: number): string {
  return `₹${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')} a km`
}

/** A rate in hundredths of a percent: "9.5%". */
export function percent(basis: number): string {
  return `${Math.round(basis) / 100}%`
}

/** A number with one decimal, and its sign when asked: "+0.4". */
export function tenths(x: number, signed = false): string {
  const r = Math.round(x * 10) / 10
  const s = Math.abs(r).toFixed(1)
  if (!signed) return r < 0 ? `−${s}` : s
  return r > 0 ? `+${s}` : r < 0 ? `−${s}` : s
}

export const MODE_NAMES = { metro: 'metro', bus: 'bus', rail: 'suburban rail' } as const
