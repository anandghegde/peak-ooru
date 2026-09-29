import { SURFACE } from './params'

/**
 * What the state of a road's surface does to it (PRD ROAD-3): the share of its free speed and of its capacity it
 * keeps at a condition of 0 (broken) to 100 (new). Straight lines between marks set at the middle of each grade
 * (`SURFACE.marks`), so that every point of condition is worth something and 100 is exactly as the road is built.
 * Not a number, or below 0, is taken as 0; above 100, as 100.
 */
export function surfaceSpeed(condition: number): number {
  return 1 - between(condition, SURFACE.speedLost)
}

export function surfaceCapacity(condition: number): number {
  return 1 - between(condition, SURFACE.capacityLost)
}

/** The grade of a condition, as the rules and the screen name it: good 75 and above, fair 50–74, poor 25–49, broken under 25. */
export function grade(condition: number): 0 | 1 | 2 | 3 {
  return condition >= 75 ? 0 : condition >= 50 ? 1 : condition >= 25 ? 2 : 3
}

function between(condition: number, lost: readonly number[]): number {
  const marks = SURFACE.marks
  if (condition >= 100) return 0
  const c = condition >= 0 ? condition : 0
  // Marks run from 100 down to 0.
  for (let k = 1; k < marks.length; k++) {
    const hi = marks[k - 1]!
    const lo = marks[k]!
    if (c >= lo) return lost[k]! + ((lost[k - 1]! - lost[k]!) * (c - lo)) / (hi - lo)
  }
  return lost[lost.length - 1]!
}
