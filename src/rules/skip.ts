import type { CityState, MonthResult, Simulate } from '../sim/types'
import { rules } from './index'
import { combine, explain, spanStart } from './report'
import type { CityData, Game, Report } from './types'

/*
 * Skipping ahead (PRD TIME-3 to TIME-6): a month, a number of months, or until something needs the player. A skip
 * stops after any month whose report says something needs the player: money below nothing or running out within
 * three months, and the year's end. So it never passes a moment at which the player could lose: a default takes
 * three months below nothing, and the first of them stops it. One report covers the span, with causes worked out
 * for its end only.
 */

/** A number of months, or 'event': until something needs the player, which is at the latest the year's end. */
export type How = number | 'event'

export interface SkipOptions {
  /** Asked before each month after the first: true stops the skip there. */
  stop?: () => boolean
  /** Told after each month: how many are done, of how many at most. */
  progress?: (done: number, of: number) => void
}

function length(game: Game, how: How): number {
  if (how === 'event') return 12
  if (!Number.isInteger(how) || how < 1) throw new Error('A skip is of one month or more.')
  return Math.min(how, game.season.months - game.month)
}

/** Plays months until the span ends, something needs the player, or the game ends; reports the span with causes. */
export function skip(game: Game, city: CityData, simulate: Simulate, how: How, options: SkipOptions = {}): Report {
  const months = length(game, how)
  const start = spanStart(game)
  const reports: Report[] = []
  for (let k = 0; k < months && game.status === 'playing'; k++) {
    if (k > 0 && options.stop?.()) break
    const report = rules.endMonth(game, city, simulate(rules.state(game, city)))
    reports.push(report)
    options.progress?.(k + 1, months)
    if (report.needs.length) break
  }
  return explain(game, city, simulate, start, combine(reports))
}

/**
 * The same, for a model that answers later (in a worker): waits for each month, and for `pause` between months so
 * that a request to stop can arrive.
 */
export async function skipAsync(
  game: Game,
  city: CityData,
  simulate: (state: CityState) => MonthResult | Promise<MonthResult>,
  how: How,
  options: SkipOptions & { pause?: () => Promise<void> } = {},
): Promise<Report> {
  const months = length(game, how)
  const start = spanStart(game)
  const reports: Report[] = []
  for (let k = 0; k < months && game.status === 'playing'; k++) {
    if (k > 0) {
      await options.pause?.()
      if (options.stop?.()) break
    }
    const report = rules.endMonth(game, city, await simulate(rules.state(game, city)))
    reports.push(report)
    options.progress?.(k + 1, months)
    if (report.needs.length) break
  }
  // The causes need the model again: `explain` asks for its runs in an order that does not depend on their answers,
  // so the states are gathered first, worked out one after another, and handed back in that order.
  const report = combine(reports)
  const asked: CityState[] = []
  explain(game, city, (state) => (asked.push(state), game.last!), start, report)
  const answers: MonthResult[] = []
  for (const state of asked) answers.push(await simulate(state))
  let n = 0
  return explain(game, city, () => answers[n++]!, start, report)
}
