/** How the game writes numbers, money and months for the player. Money inside the game is whole lakh. */

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December']

/** Months count from January 2026 as 0. */
export const year = (month: number) => 2026 + Math.floor(month / 12)

/** "Mar 2027". */
export function monthShort(month: number): string {
  return `${SHORT[month % 12]} ${year(month)}`
}

/** "March 2027". */
export function monthLong(month: number): string {
  return `${LONG[month % 12]} ${year(month)}`
}

/** "March 2027", or for a span "January to June 2027", or "November 2026 to February 2027". */
export function span(from: number, to: number): string {
  if (from === to) return monthLong(from)
  if (year(from) === year(to)) return `${LONG[from % 12]} to ${monthLong(to)}`
  return `${monthLong(from)} to ${monthLong(to)}`
}

/** Whole numbers as people in India write them: 2,05,83,674. */
export function grouped(n: number): string {
  return Math.round(n).toLocaleString('en-IN')
}

/** Lakh as crore, in Indian grouping: "₹2,140 crore", or "₹2.5 crore" where it is small. */
export function crore(lakh: number, unit = ' crore'): string {
  // Under ₹10 lakh (a patch of pothole) is said in lakh, since a tenth of a crore would round it to nothing.
  if (lakh !== 0 && Math.abs(lakh) < 10 && unit === ' crore') return `${lakh < 0 ? '−' : ''}₹${grouped(Math.abs(lakh))} lakh`
  const c = Math.abs(lakh) / 100
  const text = c >= 100 || Number.isInteger(c) ? grouped(c) : c.toLocaleString('en-IN', { maximumFractionDigits: 1 })
  return `${lakh < 0 ? '−' : ''}₹${text}${unit}`
}

/** A change in money with its sign: "+₹28 crore", "−₹3 crore". */
export function signedCrore(lakh: number, unit = ' crore'): string {
  return lakh >= 0 ? `+${crore(lakh, unit)}` : crore(lakh, unit)
}

/** A figure with one decimal, as a person would say it. */
export function decimal(n: number, places = 1): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: places, maximumFractionDigits: places })
}

/** "up 0.6", "down 1.2", or "no change", for a difference in the figure's own units. */
export function change(difference: number, places = 1): string {
  const size = decimal(Math.abs(difference), places)
  if (size === decimal(0, places)) return 'no change'
  return `${difference > 0 ? 'up' : 'down'} ${size}`
}

/** Rupees a kilometre: "₹4.50 a km". */
export function perKm(rupees: number): string {
  return `₹${rupees.toFixed(2)} a km`
}

/** A people count in lakh where large: "1.8 lakh", else in full. */
export function people(n: number): string {
  return Math.abs(n) >= 100_000 ? `${decimal(n / 100_000)} lakh` : grouped(n)
}
