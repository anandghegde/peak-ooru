/*
 * Slice 9: the order the levers arrive in a first game (SLICE9, B job 3). A new player meets the cheap and quick levers
 * first (mending roads, buses, fares), and the dear and slow ones (metro, new roads, taller building) later, all within
 * the first year. This limits what the screen offers, never what the rules allow: `may`, `act` and the server know
 * nothing of it. A returning player, or one who asks, has everything at once (the screen decides that).
 */

/** Every lever the screen offers: the kinds of plan, and the actions that are not building. */
export type Lever =
  | 'repair' | 'streets' | 'busRoute' | 'fare'
  | 'busLane' | 'upkeep'
  | 'junction' | 'footpaths'
  | 'vehicles' | 'speedLimit'
  | 'tax' | 'borrow'
  | 'metro'
  | 'road' | 'railService'
  | 'density' | 'oneWay' | 'digOnce'

/**
 * From which month of the game (0 is January 2026) each lever is offered, in order, with the one line that announces
 * it. Cancelling work, closing a line and repaying a loan are always offered: they concern what the player already has.
 */
export const ARRIVALS: { month: number; levers: Lever[]; text: string }[] = [
  { month: 0, levers: ['repair', 'streets', 'busRoute', 'fare'], text: 'Mend roads, run bus routes and set the fares.' },
  { month: 1, levers: ['busLane', 'upkeep'], text: 'New: bus lanes, which let buses run free of the traffic, and the budget for keeping roads up.' },
  { month: 2, levers: ['junction', 'footpaths'], text: 'New: work on junctions where traffic jams, and footpaths that make streets safer to walk.' },
  { month: 3, levers: ['vehicles', 'speedLimit'], text: 'New: more buses or trains on a line, and speed limits that save lives.' },
  { month: 4, levers: ['tax', 'borrow'], text: 'New: the property tax rate, and loans.' },
  { month: 6, levers: ['metro'], text: 'New: metro lines. They are dear and take years, and carry more than anything else.' },
  { month: 8, levers: ['road', 'railService'], text: 'New: roads and flyovers, and more suburban trains.' },
  { month: 10, levers: ['density', 'oneWay', 'digOnce'], text: 'New: taller building near stations, one-way streets, and making utilities dig only in set months.' },
]

/** The levers offered in a first game at `month` (0 is January 2026): all of them from November 2026. */
export function unlocked(month: number): Lever[] {
  return ARRIVALS.filter((a) => a.month <= month).flatMap((a) => a.levers)
}

/** The levers that arrive at `month`, with the line that announces them, or null if none arrive then. */
export function arriving(month: number): { levers: Lever[]; text: string } | null {
  const a = ARRIVALS.find((x) => x.month === month)
  return a ? { levers: a.levers, text: a.text } : null
}

/** The lever an action uses, for checking it against `unlocked`; null for those always offered. */
export function leverOf(action: { kind: string; plan?: { kind: string } }): Lever | null {
  if (action.kind === 'build') return (action.plan?.kind ?? null) as Lever | null
  if (action.kind === 'cancel' || action.kind === 'close' || action.kind === 'repay') return null
  return action.kind as Lever
}
