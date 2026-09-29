import { workNoun } from './build'
import { owed, paidBy } from './money'
import { NOISE } from './params'
import { measureName } from './score'
import type { Cause, Entry, Game, Lakh, MeasureKey, Measured } from './types'
import { crore } from './words'

/*
 * The reasons for the score's measures (PRD SCORE-13), where no run of the model is needed: money from the books and
 * the work ordered, approval from what pushed it, and "no measurable change" where a measure moved by less than the
 * model's noise. The traffic measures' causes come from runs of the model at the end of a skip (`explain`, report.ts).
 */

/** Money for the score: what the city has, less what it owes and what it has still to pay on work under way (SCORE-12). */
export function netMoney(game: Game): Lakh {
  let toPay = 0
  for (const p of game.projects ?? []) toPay += p.cost - paidBy(p, game.month)
  return game.money - owed(game) - toPay
}

/** The words for a month's change in a measure too small to tell from the model's noise. */
export const NO_CHANGE: Cause = { text: 'No measurable change', amount: 0 }

type Traffic = 'access' | 'commute' | 'clean' | 'safety' | 'fairness'
export const TRAFFIC: Traffic[] = ['access', 'commute', 'clean', 'safety', 'fairness']

/** Whether a month's change in a traffic measure is within the model's noise. */
export const withinNoise = (key: Traffic, change: number) => Math.abs(change) < NOISE[key]

/** For the traffic measures, "no measurable change" where the month moved them by less than the noise; else nothing yet. */
export function quietCauses(last: Measured | undefined, now: Measured): Partial<Record<MeasureKey, Cause[]>> {
  const out: Partial<Record<MeasureKey, Cause[]>> = {}
  for (const key of TRAFFIC) out[key] = last && withinNoise(key, now[key] - last[key]) ? [NO_CHANGE] : []
  return out
}

/**
 * What moved money for the score this month, largest first, three at most: the books' items (a loan's interest, not
 * its repayment, which leaves the city no poorer; not the payments on work, which were counted when it was ordered),
 * and each work ordered, whose whole cost counts at once.
 */
export function moneyCauses(game: Game, entries: Entry[], month: number, interest: Lakh): Cause[] {
  const items: { text: string; lakh: number }[] = []
  if (interest) items.push({ text: 'interest on loans', lakh: -interest })
  for (const e of entries) {
    if (e.key.startsWith('build-') || e.key === 'loans' || e.amount === 0) continue
    items.push({ text: e.name.charAt(0).toLowerCase() + e.name.slice(1), lakh: e.amount })
  }
  for (const p of game.projects ?? []) if (p.started === month) items.push({ text: `ordering ${workNoun(p)}`, lakh: -p.cost })
  return items
    .sort((a, b) => Math.abs(b.lakh) - Math.abs(a.lakh) || (a.text < b.text ? -1 : 1))
    .slice(0, 3)
    .map((c) => ({ text: `${c.lakh > 0 ? '+' : ''}${crore(c.lakh)}: ${c.text}`, amount: c.lakh / 100 }))
}

/** "Commute", for the player, lower case in a sentence. */
export const measureWords = (key: MeasureKey) => measureName(key).toLowerCase()
