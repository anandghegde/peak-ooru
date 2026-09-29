import type { MonthResult } from '../sim/types'
import { firstSeason } from '../seasons/first'
import { div } from './money'
import { SCORE } from './params'
import type { Cause, CityData, Game, Marks, Measure, MeasureKey, Measured, Score, Season } from './types'

/*
 * The governance score (PRD section 6): 0 to 1,000 from seven measures, each turned into points from 0 to 100 against
 * the season's marks and weighted. Each measure is the average of its figure over the last twelve months (approval:
 * thirty-six, PRD SCORE-7), so that one month does not decide a game; slice 8: each year is so scored at its December,
 * and the game's score weighs the ten years, later years counting more (`scoreOf`). Whole numbers throughout: each month's figures
 * are kept whole (`Game.measured`), averages are exact sums over a whole count rounded half up, points are kept in
 * tenths, and the total is a whole number. A server playing the list of actions again gets the same score exactly.
 */

export const MEASURES: MeasureKey[] = ['access', 'commute', 'clean', 'safety', 'fairness', 'money', 'approval']

/** Names and units for the player, and how a month's whole figure is shown. */
const SHOWN: Record<MeasureKey, { name: string; unit: string; shown: (x: number) => number }> = {
  access: { name: 'Access', unit: '% of jobs within 45 minutes', shown: (x) => x / 10 },
  commute: { name: 'Commute', unit: 'minutes', shown: (x) => Math.round(x / 6) / 10 },
  clean: { name: 'Clean travel', unit: '% of trips', shown: (x) => x / 10 },
  safety: { name: 'Safety', unit: 'road deaths a year for each lakh people', shown: (x) => Math.round(x / 10) / 10 },
  fairness: { name: 'Fairness', unit: '% of the average, for the worst-served fifth', shown: (x) => x / 10 },
  money: { name: 'Money', unit: '₹ crore, less debts and work still to pay for', shown: (x) => Math.round(x / 100) },
  approval: { name: 'Approval', unit: 'of 100', shown: (x) => x / 10 },
}

export const measureName = (key: MeasureKey) => SHOWN[key].name
export const measureUnit = (key: MeasureKey) => SHOWN[key].unit
/** A month's whole figure for a measure, in the unit the player reads. */
export const shownValue = (key: MeasureKey, x: number) => SHOWN[key].shown(x)

/** The marks of a season: its own, or the first season's. */
export const marksOf = (game: Game): Marks => game.season.marks ?? firstSeason.marks!

/**
 * The worst-served fifth of the city's people, by one figure a zone: zones ordered worst first, ties by id, taken
 * until they hold a fifth of the people (the last in part). Gives the fifth's figure summed over its people, and the
 * city's, both over the people counted five times over, so that the fifth is exact in whole numbers. `worseLow`: a low
 * figure is worse (access); otherwise a high one is (commute).
 */
function worstFifth(values: ArrayLike<number>, people: ArrayLike<number>, ids: ArrayLike<number>, worseLow: boolean) {
  const order: number[] = []
  let all = 0
  let sum = 0
  for (let k = 0; k < people.length; k++) {
    const p = people[k]!
    if (p <= 0) continue
    order.push(k)
    all += p
    sum += p * (values[ids[k]!] ?? 0)
  }
  order.sort((a, b) => {
    const va = values[ids[a]!] ?? 0
    const vb = values[ids[b]!] ?? 0
    return (worseLow ? va - vb : vb - va) || ids[a]! - ids[b]!
  })
  // Five times the people: the fifth is `all` of these.
  let taken = 0
  let worst = 0
  const zones: number[] = []
  for (const k of order) {
    if (taken >= all) break
    const w = Math.min(5 * people[k]!, all - taken)
    taken += w
    worst += w * (values[ids[k]!] ?? 0)
    zones.push(ids[k]!)
  }
  // The fifth's average is worst ÷ all; the city's is sum ÷ all.
  return { worst, city: sum, zones }
}

/**
 * Fairness (PRD SCORE-5), in thousandths: the access of the worst-served fifth of people (by zone) against the city's
 * average, and the city's average commute against the commute of the fifth with the longest, the two averaged. 1000
 * would be a city where everyone is served alike. By people, not by count of zones.
 *
 * Slice 7: against the city's average **as the city starts** (`reference`, people times figure over the people, as
 * `fairnessReference` gives it), not this month's, where the game has one. B found (docs/MODEL.md, slice 7, 4) that a
 * ratio to this month's average rewards leaving the centre alone: a line that raises the city's average more than the
 * worst fifth's lowers it. Against a fixed average, only the worst fifth's own reach and commute count.
 */
export function fairness(result: MonthResult, people: ArrayLike<number>, ids: ArrayLike<number>, reference?: { access: number; commute: number }): number {
  const a = worstFifth(result.accessByZone, people, ids, true)
  const c = worstFifth(result.commuteByZone, people, ids, false)
  let total = 0
  for (let k = 0; k < people.length; k++) if (people[k]! > 0) total += people[k]!
  // The average the fifth is set against, over the people counted five times over as `worstFifth` gives it.
  const cityAccess = reference ? reference.access * total : a.city
  const cityCommute = reference ? reference.commute * total : c.city
  const access = cityAccess > 0 ? Math.min(1000, div(a.worst * 1000, cityAccess)) : 0
  const commute = c.worst > 0 ? Math.min(1000, div(cityCommute * 1000, c.worst)) : 0
  return div(access + commute, 2)
}

/**
 * The city's average access and commute by people as it starts, for fairness (thousandths and seconds, whole): from
 * each zone's figures in the first month (`Game.firstZones`) and its people then. None before the first month.
 */
export function fairnessReference(game: Game, city: CityData): { access: number; commute: number } | undefined {
  const first = game.firstZones
  if (!first) return undefined
  let people = 0
  let access = 0
  let commute = 0
  city.zones.forEach((z, k) => {
    if (z.people <= 0) return
    people += z.people
    access += z.people * first.access[k]!
    commute += z.people * first.commute[k]!
  })
  return people > 0 ? { access: div(access, people), commute: div(commute, people) } : undefined
}

/** The zones (by id) that hold the worst-served fifth of people, by access and by commute, for the map's fairness view. */
export function worstServed(result: MonthResult, game: Game, city: CityData): { access: number[]; commute: number[] } {
  const people = game.zonePeople ?? city.zones.map((z) => z.people)
  const ids = city.zones.map((z) => z.id)
  return {
    access: worstFifth(result.accessByZone, people, ids, true).zones,
    commute: worstFifth(result.commuteByZone, people, ids, false).zones,
  }
}

/**
 * The traffic measures of a month, from its result and the people it was worked out for (by zone, in the order of the
 * city's zones).
 */
export function trafficMeasures(result: MonthResult, city: CityData, people: ArrayLike<number>, reference?: { access: number; commute: number }): Pick<Measured, 'access' | 'commute' | 'clean' | 'safety' | 'fairness'> {
  const t = result.trips
  const all = t.car + t.twoWheeler + t.auto + t.bus + t.metro + t.rail + t.cycle + t.walk
  const clean = t.bus + t.metro + t.rail + t.cycle + t.walk
  let total = 0
  for (let k = 0; k < people.length; k++) total += people[k]!
  return {
    access: Math.round(result.access),
    commute: Math.round(result.commute),
    clean: all > 0 ? div(Math.round(clean) * 1000, Math.round(all)) : 0,
    safety: total > 0 ? div(Math.round(result.deaths ?? 0) * 10_000_000, total) : 0,
    fairness: fairness(result, people, city.zones.map((z) => z.id), reference),
  }
}

/** Points, in tenths from 0 to 1000, for a figure against its marks. The marks may run either way. */
export function pointsFor(value: number, marks: { none: number; full: number }): number {
  if (marks.full === marks.none) return 0
  return Math.max(0, Math.min(1000, div((value - marks.none) * 1000, marks.full - marks.none)))
}

/**
 * The average of a measure over the last months it is taken over, whole, rounded half up: the last of `measured`, or
 * (slice 8) the last up to and including `measured[end - 1]`.
 */
export function averageOf(measured: Measured[], key: MeasureKey, end = measured.length): number {
  const n = key === 'approval' ? SCORE.approvalMonths : SCORE.months
  const from = Math.max(0, end - n)
  let sum = 0
  for (let i = from; i < end; i++) sum += measured[i]![key]
  return end > from ? div(sum, end - from) : 0
}

/** The weights of the years in a season's score (slice 8): its own, or the first season's. */
export function yearWeights(season: Season): number[] {
  return season.years ?? firstSeason.years ?? [...Array.from({ length: 9 }, () => 0), 1000]
}

/**
 * The score of one year, by the rule of a year: each measure's average over the twelve months to `end` (approval
 * thirty-six), its points against the marks, and the total, before any penalty. Money scores nothing if `defaulted`.
 */
function yearScore(measured: Measured[], end: number, marks: Marks, defaulted: boolean): { total: number; points: number[] } {
  let sum = 0
  const points = MEASURES.map((key) => {
    const p = key === 'money' && defaulted ? 0 : pointsFor(averageOf(measured, key, end), marks[key])
    sum += p * SCORE.weights[key]
    return p
  })
  return { total: div(sum, 1000), points }
}

/** Everything is scored at nought before the first month has been worked out. */
export function emptyScore(): Score {
  return {
    total: 0,
    measures: MEASURES.map((key) => ({ key, name: SHOWN[key].name, weight: SCORE.weights[key], value: 0, unit: SHOWN[key].unit, points: 0, causes: [] })),
  }
}

/**
 * The score as the game stands (slice 8: the score of ten years). Each year is scored by the rule of a year: each
 * measure's average over that year's twelve months (approval: the thirty-six to its end), its points against the
 * marks, weighed. A year counts once its December has been worked out, as that December stood; the year in hand counts
 * as it stands. The game's score weighs the years reached by the season's weights (`yearWeights`), the weights of the
 * years not yet reached left out and the rest scaled up to the whole, so that the score as the game goes is the final
 * score so far, by the same rule, and does not jump at the end: each measure's points are the years' points so
 * weighed, and the total their weighted sum. Where every year reached weighs nothing (a season that counts the last
 * year alone, before it), the year in hand alone.
 *
 * A game that ended by default scores nothing on money in its last year; one that ended by default or by being
 * replaced loses half of what it had (PRD MONEY-5, APP-4). `causes` gives each measure's causes, where they are known.
 */
export function scoreOf(game: Game, causes: Partial<Record<MeasureKey, Cause[]>> = {}): Score {
  // Before the first month is worked out: the city as it starts, as the season publishes it (slice 7).
  const opening = game.season.opening
  const measured = game.measured?.length ? game.measured : opening ? [{ month: -1, ...opening }] : []
  if (!measured.length) return emptyScore()
  const marks = marksOf(game)
  const weights = yearWeights(game.season)
  const defaulted = game.status === 'default'
  const lastMonth = measured[measured.length - 1]!.month
  const lastYear = lastMonth < 0 ? 0 : Math.floor(lastMonth / 12)
  const years: { year: number; total: number; points: number[]; weight: number; done: boolean }[] = []
  for (let i = 0; i < measured.length; i++) {
    const m = measured[i]!.month
    const done = m % 12 === 11
    if (!done && i < measured.length - 1) continue
    const y = m < 0 ? 0 : Math.floor(m / 12)
    const s = yearScore(measured, i + 1, marks, defaulted && y === lastYear)
    years.push({ year: 2026 + y, ...s, weight: weights[y] ?? 0, done })
  }
  let weight = 0
  for (const y of years) weight += y.weight
  const counted = weight > 0 ? years : [{ ...years[years.length - 1]!, weight: 1 }]
  if (weight === 0) weight = 1
  let sum = 0
  const measures: Measure[] = MEASURES.map((key, k) => {
    let p = 0
    for (const y of counted) p += y.weight * y.points[k]!
    const points = div(p, weight)
    sum += points * SCORE.weights[key]
    const avg = averageOf(measured, key)
    return { key, name: SHOWN[key].name, weight: SCORE.weights[key], value: SHOWN[key].shown(avg), unit: SHOWN[key].unit, points, causes: causes[key] ?? [] }
  })
  let total = div(sum, 1000)
  const score: Score = { total, measures, years: years.map((y) => ({ year: y.year, total: y.total, weight: y.weight, done: y.done })) }
  if (game.status === 'default' || game.status === 'replaced') {
    const points = total - div(total * (10_000 - SCORE.lost), 10_000)
    total -= points
    score.total = total
    score.penalty = {
      points,
      text: game.status === 'default'
        ? 'The city defaulted, and the state took over its books: money scores nothing in the last year, and half the score is lost.'
        : 'The state replaced you as commissioner: half the score is lost.',
    }
  }
  return score
}

/**
 * For a forecast (PRD UI-5): the score the game would have if the traffic of `result` held for a whole year, its
 * approval as it stands, and its money for the score as given (lakh: `netMoney(game)` less what the plan costs, and
 * twelve months of what it changes in the books), or as it stands. The screen takes it for the month with a plan and
 * without, and shows the difference, marked as a forecast: no months are played, so it costs one model run a side.
 * `people` is each zone's people the month was worked out for (the state's zones), by default the game's.
 */
export function scoreWith(game: Game, city: CityData, result: MonthResult, people?: ArrayLike<number>, money?: number): Score {
  const zones = people ?? game.zonePeople ?? city.zones.map((z) => z.people)
  const traffic = trafficMeasures(result, city, zones, fairnessReference(game, city))
  const last = game.measured?.at(-1)
  const month: Measured = { month: game.month, ...traffic, money: money ?? last?.money ?? game.money, approval: last?.approval ?? game.approval ?? 550 }
  const measured = Array.from({ length: SCORE.approvalMonths }, (_, k) => ({ ...month, month: game.month + k }))
  return scoreOf({ ...game, measured, status: 'playing' })
}
