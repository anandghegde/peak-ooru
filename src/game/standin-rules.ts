import type { Action, CityData, Entry, Figure, Game, Loan, Outcome, Report, Rules, Season, Quote, Plan } from '../rules/types'
import type { CityState, MonthResult, Prices } from '../sim/types'

/*
 * A stand-in for the rules (person D's `rules`), so that the screen can be built before they land. The amounts are
 * plausible, not considered: the worker uses this only while src/rules/index.ts is missing.
 */

export const STANDIN_SEASON: Season = {
  id: 'standin',
  name: 'Stand-in season',
  seed: 1,
  money: 150_000,
  grant: 15_000,
  months: 120,
}

/** Fares in paise a km, as the actions carry them. */
const FARE_LIMITS = { metro: [200, 900], bus: [50, 400], rail: [10, 200] } as const
const TAX_LIMITS = [8000, 14000]
const LOAN_LIMIT = 300_000
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December']
const monthName = (m: number) => `${MONTH_NAMES[m % 12]} ${2026 + Math.floor(m / 12)}`

function prices(): Prices {
  return { fuel: 111, metroPerKm: 4.5, busPerKm: 1.6, railPerKm: 0.4, leastFare: 10, parking: [] }
}

/** Fares for a weekday's riders over a month of 22 weekdays, in lakh, at an average trip length by mode. */
function fare(trips: number, km: number, perKm: number): number {
  return Math.round((trips * 22 * km * perKm) / 100_000)
}

function books(game: Game, city: CityData): Entry[] {
  const r = game.last
  const trips = r?.trips ?? { metro: 850_000, bus: 4_100_000, rail: 40_000 }
  const growth = game.people
  const entries: Entry[] = [
    { key: 'tax', name: 'Property tax', amount: Math.round((35_000 * game.taxRate * growth) / 1e8) },
    { key: 'grant', name: 'Grant from the state', amount: game.season.grant },
    { key: 'fares-metro', name: 'Metro fares', amount: fare(trips.metro, 9, game.prices.metroPerKm) },
    { key: 'fares-bus', name: 'Bus fares', amount: Math.round(fare(trips.bus, 7, game.prices.busPerKm) * 0.4) },
    { key: 'fares-rail', name: 'Suburban rail fares', amount: fare(trips.rail, 20, game.prices.railPerKm) },
    { key: 'run-metro', name: 'Running the metro', amount: -7_000 },
    { key: 'run-bus', name: 'Running the buses', amount: -16_000 },
    { key: 'run-rail', name: 'Running suburban rail', amount: -500 },
    { key: 'roads', name: 'Roads and city services', amount: -43_000 - city.zones.length },
  ]
  const payments = game.loans.reduce((sum, l) => sum + Math.min(l.payment, l.owed + interest(l)), 0)
  if (payments) entries.push({ key: 'loans', name: 'Loan repayments', amount: -payments })
  return entries
}

const interest = (l: Loan) => Math.floor((l.owed * l.rate) / 120_000)
const owed = (game: Game) => game.loans.reduce((sum, l) => sum + l.owed, 0)

function may(game: Game, _city: CityData, action: Action): Outcome {
  if (game.status !== 'playing') return { ok: false, reason: 'The game is over.' }
  if (action.kind === 'build' || action.kind === 'cancel' || action.kind === 'vehicles' || action.kind === 'close') {
    return { ok: false, reason: 'This cannot be built yet.' }
  }
  switch (action.kind) {
    case 'tax': {
      if (action.rate < TAX_LIMITS[0]! || action.rate > TAX_LIMITS[1]!) {
        return { ok: false, reason: `The rate must be between ${TAX_LIMITS[0]! / 100}% and ${TAX_LIMITS[1]! / 100}% of the standard.` }
      }
      if (game.taxChanged >= 0 && game.month - game.taxChanged < 12) {
        return {
          ok: false,
          reason: `The rate was changed in ${monthName(game.taxChanged)}. It can change again in ${monthName(game.taxChanged + 12)}.`,
        }
      }
      return { ok: true }
    }
    case 'fare': {
      const [least, most] = FARE_LIMITS[action.mode]
      if (action.perKm < least || action.perKm > most) {
        return { ok: false, reason: `The fare must be between ₹${least / 100} and ₹${most / 100} a kilometre.` }
      }
      return { ok: true }
    }
    case 'borrow':
      if (action.amount <= 0 || action.amount % 10_000) return { ok: false, reason: 'Loans come in steps of ₹100 crore.' }
      if (owed(game) + action.amount > LOAN_LIMIT) {
        return { ok: false, reason: `The city may owe at most ₹${LOAN_LIMIT / 100} crore.` }
      }
      return { ok: true }
    case 'repay': {
      const loan = game.loans.find((l) => l.id === action.loan)
      if (!loan) return { ok: false, reason: 'There is no such loan.' }
      if (game.money < loan.owed) return { ok: false, reason: 'There is not enough money to repay it.' }
      return { ok: true }
    }
  }
  return { ok: false, reason: 'This cannot be done yet.' }
}

function act(game: Game, city: CityData, action: Action): Outcome {
  const outcome = may(game, city, action)
  if (!outcome.ok) return outcome
  switch (action.kind) {
    case 'tax':
      game.taxRate = action.rate
      game.taxChanged = game.month
      break
    case 'fare':
      game.prices = { ...game.prices, [`${action.mode}PerKm`]: action.perKm / 100 }
      break
    case 'borrow': {
      const rate = 800 + Math.floor((owed(game) + action.amount) / 1000)
      const months = 60
      const payment = Math.ceil(action.amount / months + (action.amount * rate) / 120_000)
      const id = game.loans.reduce((most, l) => Math.max(most, l.id), 0) + 1 + game.done.length
      game.loans.push({ id, amount: action.amount, owed: action.amount, rate, payment, monthsLeft: months, taken: game.month })
      game.money += action.amount
      break
    }
    case 'repay': {
      const loan = game.loans.find((l) => l.id === action.loan)!
      game.money -= loan.owed
      game.loans = game.loans.filter((l) => l !== loan)
      break
    }
  }
  game.done.push({ month: game.month, action })
  return outcome
}

function state(game: Game, city: CityData): CityState {
  const zones = city.zones.map((z) => ({ ...z, people: Math.round((z.people * game.people) / 10_000) }))
  return { month: game.month, seed: game.season.seed, zones, roads: city.roads, transit: city.transit, prices: game.prices }
}

function clean(r: MonthResult): number {
  const all = Object.values(r.trips).reduce((a, b) => a + b, 0)
  const good = r.trips.bus + r.trips.metro + r.trips.rail + r.trips.cycle + r.trips.walk
  return all ? Math.round((good * 1000) / all) / 10 : 0
}

function endMonth(game: Game, city: CityData, result: MonthResult): Report {
  const before = game.last
  const moneyBefore = game.money
  const entries = books({ ...game, last: result }, city)
  game.money += entries.reduce((sum, e) => sum + e.amount, 0)
  for (const loan of game.loans) {
    loan.owed = Math.max(0, loan.owed + interest(loan) - loan.payment)
    loan.monthsLeft--
  }
  const news: string[] = []
  const paid = game.loans.filter((l) => l.owed === 0 || l.monthsLeft <= 0)
  for (const l of paid) news.push(`A loan of ₹${l.amount / 100} crore is paid off.`)
  game.loans = game.loans.filter((l) => !paid.includes(l))
  const growth = 15 - Math.max(0, Math.floor((game.taxRate - 10_000) / 200))
  game.people += growth
  game.inTheRed = game.money < 0 ? game.inTheRed + 1 : 0
  const changed = game.done.filter((d) => d.month === game.month)
  const month = game.month
  game.last = result
  game.month++
  if (game.inTheRed >= 3) game.status = 'default'
  else if (game.month >= game.season.months) game.status = 'finished'

  const causes = (change: number) => {
    if (!before || Math.abs(change) < 0.05) return []
    const fares = changed.filter((d) => d.action.kind === 'fare')
    if (!fares.length) return [{ text: `${Math.abs(change).toFixed(1)} from the city growing`, amount: change }]
    const main = Math.round(change * 7) / 10
    return [
      { text: `${Math.abs(main).toFixed(1)} from the new fares`, amount: main },
      { text: `${Math.abs(change - main).toFixed(1)} from the city growing`, amount: change - main },
    ]
  }
  const commuteNow = Math.round(result.commute / 6) / 10
  const commuteBefore = before ? Math.round(before.commute / 6) / 10 : commuteNow
  const figures: Figure[] = [
    { key: 'commute', name: 'Commute', now: commuteNow, before: commuteBefore, unit: 'min', causes: causes(commuteNow - commuteBefore) },
    { key: 'access', name: 'Jobs within 45 minutes', now: result.access / 10, before: (before ?? result).access / 10, unit: '%', causes: [] },
    { key: 'clean', name: 'Trips by bus, train, cycle or on foot', now: clean(result), before: clean(before ?? result), unit: '%', causes: [] },
    { key: 'money', name: 'Money', now: game.money / 100, before: moneyBefore / 100, unit: 'crore', causes: [] },
  ]
  const needs: string[] = []
  if (game.money < 20_000 && game.money >= 0) needs.push('Money is running low.')
  if (game.money < 0) needs.push(`Money is below nothing. ${3 - game.inTheRed} more months of this and the state takes over.`)
  if (game.month % 12 === 0 && game.status === 'playing') needs.push(`The year ${2025 + game.month / 12} is over.`)
  if (month === 0) news.unshift('Your term as commissioner has begun.')
  const report: Report = { from: month, to: month, figures, books: entries, news, needs }
  game.reports.push(report)
  return report
}

function start(season: Season): Game {
  return {
    season, month: 0, status: 'playing', money: season.money, taxRate: 10_000, taxChanged: -12, prices: prices(),
    loans: [], people: 10_000, inTheRed: 0, done: [], last: null, reports: [],
  }
}

export const standInRules: Rules = {
  start,
  may,
  act,
  state,
  // Building is not written yet: slice 4.
  quote: (): Quote => ({ ok: false, reason: 'This cannot be built yet.', cost: 0, months: 0, running: 0, length: 0, stations: [], path: [], disrupted: [], major: false }),
  suggest: (): Plan[] => [],
  endMonth,
  books,
  replay(season, city, done, simulate) {
    const game = start(season)
    // Plays up to the month of the last action, and does it; the months after are the caller's to play.
    const last = done.at(-1)?.month ?? 0
    let i = 0
    while (game.status === 'playing') {
      while (i < done.length && done[i]!.month === game.month) act(game, city, done[i++]!.action)
      if (game.month >= last) break
      endMonth(game, city, simulate(state(game, city)))
    }
    return game
  },
}
