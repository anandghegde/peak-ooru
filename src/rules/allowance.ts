/*
 * The daily allowance (PRD TIME-7): 12 game months a day, what is not used carrying over to at most 36, the day
 * turning at midnight India time. A pure function of when the player ended each past month and the time now, so that
 * the server can keep it by its own clock (MP-33) and the screen can show it.
 */

export const PER_DAY = 12
export const MOST = 36

const DAY = 86_400_000
/** India is five and a half hours ahead of UTC all year, with no summer time: its midnight is 18:30 UTC. */
const INDIA = 19_800_000

/** The India day a moment falls in, counted from 1 January 1970. */
export const indiaDay = (t: number) => Math.floor((t + INDIA) / DAY)

export interface Allowance {
  /** Whether the allowance applies (the season's `allowance`, off while the game is being built). */
  on: boolean
  /** Months that may be played now: without end when it is off. */
  left: number
  /** When the next day's months arrive: the coming midnight in India, in milliseconds since 1970 (UTC). */
  next: number
}

/**
 * Months that may be played now. The first day on which a month was ended brings 12; each day after brings 12 more,
 * and no more than 36 may be held at the turn of a day. Each month ended uses one. Times after `now`, and times that
 * are not finite, are not counted. With `on` false (a season without the allowance) there is no limit.
 */
export function allowance(ended: number[], now: number, on = true): Allowance {
  const today = indiaDay(now)
  const next = (today + 1) * DAY - INDIA
  if (!on) return { on, left: Number.POSITIVE_INFINITY, next }
  const days = ended.filter((t) => Number.isFinite(t) && t <= now).map(indiaDay).sort((a, b) => a - b)
  if (!days.length) return { on, left: PER_DAY, next }
  let left = PER_DAY
  let day = days[0]!
  let i = 0
  while (true) {
    while (i < days.length && days[i] === day) {
      left--
      i++
    }
    if (day === today) break
    day++
    left = Math.min(MOST, Math.max(0, left) + PER_DAY)
  }
  return { on, left: Math.max(0, left), next }
}

/** Whether one more month may be ended now. */
export const mayEnd = (ended: number[], now: number, on = true) => allowance(ended, now, on).left > 0
