import { DEFAULT_PRICES } from '../sim/params'
import type { MonthResult, Prices, Simulate } from '../sim/types'
import { approvalWord, deathRate, moveApproval, noteFirst, pressures, resultsPull } from './approval'
import { allEvents, electionResult, eventsIn } from './events'
import { approvalCauses } from './report'
import { moneyCauses, netMoney, quietCauses } from './reasons'
import { fairnessReference, scoreOf, trafficMeasures } from './score'
import { actBuild, mayBuild, openings, workNoun } from './build'
import { emptyBuilt, setupOf } from './lines'
import { balance, loanDue, loanLimit, loanPayment, loanRate, monthBooks, nextValue, owed, paise } from './money'
import { APPROVAL, DEFAULT_AFTER, FARES, LOANS, LOW_AHEAD, MAJORS, TAX } from './params'
import { builtLaneMetres } from './roads'
import { orderProblem, roadsFigure, roadsMonth, roadsWarning, show, startWear, upkeepCost, worstRoads } from './upkeep'
import { laneMetres } from './money'
import { quote, snap } from './plan'
import { growth, zonePeopleOf } from './growth'
import { figures } from './report'
import { cityState, peopleNow } from './state'
import { suggest } from './suggest'
import { advise } from './advise'
import type { Action, CityData, Done, Entry, Figure, Game, GameEvent, Measured, Outcome, Report, Review, Rules, Season, Upkeep } from './types'
import { crore, monthName, percent, perKm, tenths, yearOf } from './words'

/**
 * The rules of the game: months, money, property tax, fares, loans, building transit and approval. Pure: no page,
 * clock or network. Whole numbers for everything that is kept from month to month. Nothing given is trusted: every
 * action is checked.
 */

/**
 * Raise when a change to the rules would make a kept game play out differently. 6: the score of ten years (slice 8). 7:
 * resurfacing stretch by stretch, and money scoring in full from ₹1,000 crore (slice 9).
 */
export const version = 7

type Fared = 'metro' | 'bus' | 'rail'
const PRICE: Record<Fared, 'metroPerKm' | 'busPerKm' | 'railPerKm'> = { metro: 'metroPerKm', bus: 'busPerKm', rail: 'railPerKm' }
const FARE_WORDS: Record<Fared, string> = { metro: 'The metro fare', bus: 'The bus fare', rail: 'The suburban rail fare' }

const whole = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && Math.abs(x) <= 1e12
const no = (reason: string): Outcome => ({ ok: false, reason })

function checkSeason(season: Season): void {
  const ok = !!season && typeof season === 'object' && typeof season.id === 'string' && whole(season.seed) &&
    whole(season.money) && whole(season.grant) && season.grant >= 0 && whole(season.months) && season.months >= 1 &&
    season.months <= 120 && (season.openings === undefined || (Array.isArray(season.openings) &&
      season.openings.every((o) => !!o && typeof o.line === 'string' && whole(o.month) && whole(o.stations) && o.stations >= 2)))
  if (!ok) throw new Error('The season is not a proper one.')
}

function start(season: Season, city: CityData): Game {
  checkSeason(season)
  const prices: Prices = { ...DEFAULT_PRICES, parking: city.zones.map(() => 0) }
  const game: Game = {
    season,
    month: 0,
    status: 'playing',
    money: season.money,
    taxRate: TAX.standard,
    taxChanged: -1,
    prices,
    loans: [],
    people: 10_000,
    inTheRed: 0,
    done: [],
    projects: [],
    built: emptyBuilt(),
    majors: 0,
    approval: APPROVAL.start,
    pressures: [],
    warnings: 0,
    last: null,
    reports: [],
    taxPeople: 0,
    // Slice 6: the roads as the season has them, a steady upkeep budget, utilities digging when they will.
    wear: startWear(season, city),
    upkeep: 'steady',
    digOnce: false,
    concrete: [],
  }
  show(game, city)
  // Slice 7: the score of the city as it starts, from the season's published figures, before any month is worked out.
  if (season.opening) game.score = scoreOf(game)
  return game
}

const LEVELS: Upkeep[] = ['bare', 'steady', 'generous']
/** The upkeep budget a month at a level, as the books would have it now. */
const budget = (game: Game, city: CityData, level: Upkeep) =>
  upkeepCost(game, city, level, laneMetres(city.roads) + builtLaneMetres(city, game.built ?? { lines: [], stations: [], busLanes: [], vehicles: {} }))

function may(game: Game, city: CityData, action: Action): Outcome {
  if (game.status !== 'playing') return no('The game is over.')
  if (!action || typeof action !== 'object') return no('That is not something the city can do.')
  switch (action.kind) {
    case 'tax': {
      const rate = action.rate
      if (!whole(rate)) return no('The tax rate must be a whole number of hundredths of a percent.')
      if (rate < TAX.least || rate > TAX.most) {
        return no(`The tax rate must be between ${percent(TAX.least)} and ${percent(TAX.most)} of the standard rate.`)
      }
      if (rate % TAX.step !== 0) return no(`The tax rate moves in steps of ${percent(TAX.step)}.`)
      if (rate === game.taxRate) return no(`The tax rate is already ${percent(rate)} of the standard rate.`)
      if (game.taxChanged >= 0 && yearOf(game.taxChanged) === yearOf(game.month)) {
        return no(
          `The tax rate can change once a year. It changed in ${monthName(game.taxChanged)}, and can change again ` +
            `from ${monthName((yearOf(game.month) - 2025) * 12)}.`,
        )
      }
      return { ok: true }
    }
    case 'fare': {
      const mode = action.mode
      if (mode !== 'metro' && mode !== 'bus' && mode !== 'rail') return no('There is no such fare.')
      const limits = FARES[mode]
      const p = action.perKm
      if (!whole(p)) return no('A fare must be a whole number of paise a km.')
      if (p < limits.least || p > limits.most) {
        return no(`${FARE_WORDS[mode]} must be between ${perKm(limits.least)} and ${perKm(limits.most)}.`)
      }
      if (p % limits.step !== 0) return no(`Fares move in steps of ${limits.step} paise.`)
      if (p === paise(game.prices[PRICE[mode]])) return no(`${FARE_WORDS[mode]} is already ${perKm(p)}.`)
      return { ok: true }
    }
    case 'borrow': {
      const amount = action.amount
      if (!whole(amount) || amount <= 0) return no('A loan must be a whole amount above nothing.')
      if (amount % LOANS.step !== 0) return no(`Loans come in steps of ${crore(LOANS.step)}.`)
      const limit = loanLimit(game)
      const room = Math.max(0, limit - owed(game))
      if (amount > room) {
        return no(`The city may owe at most ${crore(limit)}. It can borrow ${crore(room - (room % LOANS.step))} more.`)
      }
      return { ok: true }
    }
    case 'repay': {
      const loan = game.loans.find((l) => l.id === action.loan && l.owed > 0)
      if (!whole(action.loan) || !loan) return no('There is no such loan to repay.')
      if (game.money < loan.owed) return no(`Repaying it takes ${crore(loan.owed)}, and there is ${crore(game.money)}.`)
      return { ok: true }
    }
    case 'build':
    case 'cancel':
    case 'vehicles':
    case 'close':
      return mayBuild(game, city, action)
    case 'upkeep': {
      if (!LEVELS.includes(action.level)) return no('Choose an upkeep budget: bare, steady or generous.')
      const problem = orderProblem(action.patchBelow)
      if (problem) return no(problem)
      const order = action.patchBelow === undefined ? game.patchBelow : action.patchBelow ?? undefined
      if (action.level === (game.upkeep ?? 'steady') && order === game.patchBelow) {
        return no(action.patchBelow === undefined ? `The upkeep budget is already ${action.level}.` : 'The upkeep budget and the standing order are already as they are asked to be.')
      }
      return { ok: true }
    }
    case 'digOnce': {
      if (typeof action.on !== 'boolean') return no('Say whether utilities may dig only in set months.')
      if (action.on === !!game.digOnce) return no(action.on ? 'Utilities already dig only in set months.' : 'Utilities may already dig in any month.')
      if (action.on && (game.majors ?? 0) >= MAJORS) {
        return no(`Three major works may be started in a month, and three have been. Start this in ${monthName(game.month + 1)}.`)
      }
      return { ok: true }
    }
    default:
      return no('That is not something the city can do.')
  }
}

function act(game: Game, city: CityData, action: Action): Outcome {
  const outcome = may(game, city, action)
  if (!outcome.ok) return outcome
  // What is recorded is a clean copy, so that nothing else passed in rides along.
  let kept: Action
  switch (action.kind) {
    case 'tax':
      game.taxRate = action.rate
      game.taxChanged = game.month
      kept = { kind: 'tax', rate: action.rate }
      break
    case 'fare':
      game.prices = { ...game.prices, [PRICE[action.mode]]: action.perKm / 100 }
      kept = { kind: 'fare', mode: action.mode, perKm: action.perKm }
      break
    case 'borrow': {
      const rate = loanRate(owed(game) + action.amount, loanLimit(game))
      const id = game.done.filter((d) => d.action.kind === 'borrow').length + 1
      game.loans.push({
        id,
        amount: action.amount,
        owed: action.amount,
        rate,
        payment: loanPayment(action.amount, rate, LOANS.months),
        monthsLeft: LOANS.months,
        taken: game.month,
      })
      game.money += action.amount
      kept = { kind: 'borrow', amount: action.amount }
      break
    }
    case 'repay': {
      const loan = game.loans.find((l) => l.id === action.loan)!
      game.money -= loan.owed
      // Kept, owing nothing, until the month ends, so that the report can say what was repaid.
      loan.owed = 0
      loan.monthsLeft = 0
      kept = { kind: 'repay', loan: action.loan }
      break
    }
    case 'build':
    case 'cancel':
    case 'vehicles':
    case 'close': {
      const done = actBuild(game, city, action)
      kept = done.kept
      if (action.kind === 'build' && !done.news) {
        const p = game.projects!.at(-1)!
        done.news = `You ordered ${workNoun(p)}. It costs ${crore(p.cost)}, paid over ${p.opens - p.started} ` +
          `month${p.opens - p.started === 1 ? '' : 's'}, and opens in ${monthName(p.opens)}.`
      }
      if (done.news) game.told = [...(game.told ?? []), done.news]
      break
    }
    case 'upkeep': {
      const was = game.upkeep ?? 'steady'
      const news: string[] = []
      if (action.level !== was) {
        news.push(`You set the upkeep budget to ${action.level}: ${crore(budget(game, city, action.level))} a month, from ${crore(budget(game, city, was))} at ${was}.` +
          (action.level === 'bare' ? ' At bare nothing is mended: the roads fall about a grade in three years, and slow the city, its buses and its riders as they go.' : ''))
      }
      game.upkeep = action.level
      kept = { kind: 'upkeep', level: action.level }
      if (action.patchBelow !== undefined) {
        kept.patchBelow = action.patchBelow
        if (action.patchBelow === null) {
          if (game.patchBelow !== undefined) news.push('You stopped the standing order to patch potholes.')
          delete game.patchBelow
        } else {
          game.patchBelow = action.patchBelow
          news.push(`You ordered the potholes of any zone patched when its roads fall below ${action.patchBelow}. The city pays for each patch.`)
        }
      }
      game.told = [...(game.told ?? []), ...news]
      break
    }
    case 'digOnce':
      game.digOnce = action.on
      if (action.on) game.majors = (game.majors ?? 0) + 1
      kept = { kind: 'digOnce', on: action.on }
      game.told = [...(game.told ?? []), action.on
        ? 'You ruled that utilities dig only in February and November, and put back every road as it was. They resent it, and new connections come more slowly.'
        : 'Utilities may dig in any month again.']
      break
  }
  game.done.push({ month: game.month, action: kept! })
  return outcome
}

function books(game: Game, city: CityData): Entry[] {
  return monthBooks(game, city, game.last)
}

/** What the player did this month, in words, with what each thing was before. */
function doneNews(game: Game, month: number): string[] {
  let rate: number = TAX.standard
  const fare: Record<Fared, number> = {
    metro: paise(DEFAULT_PRICES.metroPerKm),
    bus: paise(DEFAULT_PRICES.busPerKm),
    rail: paise(DEFAULT_PRICES.railPerKm),
  }
  const news: string[] = []
  let borrowed = 0
  for (const d of game.done) {
    if (d.month > month) break
    const a = d.action
    const now = d.month === month
    if (a.kind === 'tax') {
      if (now) news.push(`You set property tax at ${percent(a.rate)} of the standard rate, from ${percent(rate)}.`)
      rate = a.rate
    } else if (a.kind === 'fare') {
      if (now) {
        const way = a.perKm > fare[a.mode] ? 'went up' : 'came down'
        news.push(`${FARE_WORDS[a.mode]} ${way} from ${perKm(fare[a.mode])} to ${perKm(a.perKm)}.`)
      }
      fare[a.mode] = a.perKm
    } else if (a.kind === 'borrow') {
      borrowed++
      const loan = game.loans.find((l) => l.id === borrowed)
      if (now && loan) {
        news.push(
          `You borrowed ${crore(a.amount)} at ${percent(loan.rate)} a year, repaid at ${crore(loan.payment)} a month ` +
            `for ${loan.monthsLeft / 12} years from next month.`,
        )
      }
    }
  }
  return news
}

/** Everything that settles at the end of a month; `quiet` leaves out the look ahead, for forecasts. */
function settle(game: Game, city: CityData, result: MonthResult, quiet: boolean): Report {
  if (game.status !== 'playing') throw new Error('The game is over.')
  const month = game.month
  const before = game.last
  const moneyBefore = game.money
  const approvalBefore = game.approval ?? APPROVAL.start
  const setup = setupOf(game, city)
  const entries = monthBooks(game, city, result)
  const news = quiet ? [] : [...doneNews(game, month), ...(game.told ?? [])]
  if (month === 0 && !quiet) news.unshift('Your term as commissioner has begun.')
  game.told = []

  // The roads at the month's end (slice 6): wear, digs, mending finished, the budget, the standing order.
  const roads = roadsMonth(game, city, result, quiet)
  if (roads.order > 0) entries.push({ key: 'order', name: 'Patching by standing order', amount: -roads.order })

  game.money += balance(entries)
  const loans = []
  let interest = 0
  for (const loan of game.loans) {
    const early = loan.owed === 0
    const due = loanDue(loan, month)
    interest += due.interest
    loan.owed -= due.principal
    if (loan.taken < month && !early) loan.monthsLeft--
    if (loan.owed > 0) loans.push(loan)
    else if (!quiet) {
      const which = `The ${crore(loan.amount)} loan of ${monthName(loan.taken)}`
      news.push(early ? `${which} is repaid early.` : `${which} is paid off.`)
    }
  }
  game.loans = loans

  // Slice 7: the month's figures for the score, and each zone's first, for approval, from the people the month was
  // worked out for (before they grow).
  const zonePeople = [...zonePeopleOf(game, city)]
  noteFirst(game, city, result, zonePeople)
  const traffic = trafficMeasures(result, city, zonePeople, fairnessReference(game, city))

  // Growth: faster when the commute is shorter than it was at the start, slower when the tax rate is high; shared
  // among the zones by their commutes, their reach and taller building.
  game.firstCommute ??= result.commute
  if (result.deaths !== undefined) game.firstDeaths ??= deathRate(game, city, result.deaths)
  const people = game.people
  const grown = growth(game, city, result)
  game.people = grown.people
  game.taxPeople = (game.taxPeople ?? 0) + grown.byTax
  game.zonePeople = grown.zonePeople

  // Work finished opens, and so do the season's lines, for next month; approval moves.
  const opened = openings(game, city, month)
  if (!quiet) news.push(...opened.news, ...roads.news)
  moveApproval(game, city, pressures(game, city, result, setup, opened.opened), resultsPull(game, city, result, zonePeople), zonePeople)
  game.majors = 0
  // Slice 7: the corporation's elections, at the end of their month (PRD EVT-7).
  if ((game.season.elections ?? []).includes(month)) {
    const vote = electionResult(game.approval!)
    game.grantShare = vote.share
    if (!quiet) news.push(vote.news)
  }
  let review: string[] = []
  let reviewed: Review | undefined
  if (month % 12 === 11) {
    game.value = nextValue(game)
    const a = game.approval!
    if (a < APPROVAL.warning) game.warnings = (game.warnings ?? 0) + 1
    else game.warnings = 0
    reviewed = {
      year: yearOf(month),
      approval: a / 10,
      word: approvalWord(a),
      warning: a < APPROVAL.warning,
      warnings: game.warnings,
      replaced: game.warnings >= APPROVAL.warnings,
    }
    review = [`The yearly review: approval stands at ${a / 10}, ${approvalWord(a)}.`]
    if (game.warnings! >= APPROVAL.warnings) {
      review.push(`Approval has been under ${APPROVAL.warning / 10} at ${APPROVAL.warnings} reviews running. The state has replaced you as commissioner.`)
    } else if (game.warnings! > 0) {
      review.push(`That is under ${APPROVAL.warning / 10}: a warning. If it is under ${APPROVAL.warning / 10} at the next review as well, the state will replace you.`)
    }
  }

  game.inTheRed = game.money < 0 ? game.inTheRed + 1 : 0
  game.inputs = { prices: { ...game.prices }, people, setup }
  game.last = { ...result, took: 0 }
  game.month = month + 1
  if (game.inTheRed >= DEFAULT_AFTER) game.status = 'default'
  else if ((game.warnings ?? 0) >= APPROVAL.warnings) game.status = 'replaced'
  else if (game.month >= game.season.months) game.status = 'finished'

  // Slice 7: the score, from the month's figures and those before (PRD section 6).
  const scoreBefore = game.score
  const measured: Measured = { month, ...traffic, money: netMoney(game), approval: game.approval! }
  const lastMeasured = game.measured?.at(-1)
  game.measured = [...(game.measured ?? []), measured]
  game.score = scoreOf(game, {
    ...quietCauses(lastMeasured, measured),
    money: moneyCauses(game, entries, month, interest),
    approval: approvalCauses(game.pressures ?? []),
  })
  if (month % 12 === 11 || game.status !== 'playing') game.scores = [...(game.scores ?? []), game.score.total]
  const began = eventsIn(game, city).filter((p) => p.event.started === game.month)
  const ended = allEvents(game, city).filter((p) => p.event.ends === month)
  game.events = eventsIn(game, city).map((p) => p.event)

  const needs: string[] = []
  // Slice 9: of those, what the player must act on.
  const urgent: string[] = []
  if (!quiet) {
    // Events that end with this month, and those that begin with the next (PRD EVT-10).
    for (const p of ended) if (p.event.kind === 'cavein' || ((p.event.kind === 'fuel' || p.event.kind === 'monsoon') && p.event.ends > p.event.started)) news.push(endWords(p.event))
    if (game.status === 'playing') {
      for (const p of began) {
        if (p.event.kind === 'opening') continue
        news.push(`${p.event.title}. ${p.event.text}`)
        if (p.needs) needs.push(`${p.event.title}.`)
      }
    }
    if (game.status !== 'playing') news.push(...review)
    if (game.status === 'default') {
      news.push(
        `Money has been below nothing for ${DEFAULT_AFTER} months running. The state has taken over the city's ` +
          'books, and your term is over.',
      )
    } else if (game.status === 'finished') {
      news.push(`Your term is over. The city ends ${monthName(month)} with ${crore(game.money)}.`)
    } else if (game.status === 'replaced') {
      // Said in the review above.
    } else {
      for (const o of opened.opened) needs.push(o.need)
      if (month % 12 === 11) {
        const yearStart = game.reports[month - 11]?.figures.find((f) => f.key === 'money')?.before
        const from = yearStart === undefined ? '' : ` from ${crore(Math.round(yearStart * 100))}`
        news.push(
          `${yearOf(month)} is over. Money went${from} to ${crore(game.money)}. The city has ` +
            `${(Math.round(peopleNow(game, city) / 100_000) / 100).toFixed(2)} crore people.`,
        )
        news.push(...review)
        needs.push(`${yearOf(month)} is over: a moment to look over the year before going on.`)
        // Slice 7: the roads, if they are falling, in good time (PRD UPK-13).
        const yearAgo = game.reports[month - 11]?.figures.find((f) => f.key === 'roads')?.before
        const warn = roadsWarning(game, city, yearAgo)
        if (warn) {
          news.push(warn)
          needs.push(warn)
          urgent.push(warn)
        }
        if (reviewed?.warning) urgent.push(review.join(' '))
      } else if (month % 12 === 4 && (game.upkeep ?? 'steady') === 'bare') {
        // Before the monsoon, with nothing being mended.
        const warn = roadsWarning(game, city, undefined)
        if (warn) news.push(`The monsoon comes next month. ${warn}`)
      }
      if (game.inTheRed > 0) {
        needs.push(
          `Money is below nothing, at ${crore(game.money)}. If it is still below nothing at the end of ` +
            `${monthName(month + DEFAULT_AFTER - game.inTheRed)}, the state takes over.`,
        )
        urgent.push(needs.at(-1)!)
      } else {
        const low = forecast(game, city, LOW_AHEAD, result).find((m) => m.money < 0)
        if (low) {
          needs.push(`At this rate money runs out at the end of ${monthName(low.month - 1)}.`)
          urgent.push(needs.at(-1)!)
        }
      }
    }
  }
  const report: Report = {
    from: month,
    to: month,
    figures: [
      ...figures(result, before, city, [moneyBefore, game.money], entries, [approvalBefore, game.approval!], game.pressures ?? []),
      roadsFigureOf(game, city, roads.before, roads.causes),
    ],
    books: entries,
    news,
    needs,
  }
  if (reviewed) report.review = reviewed
  if (!quiet) report.urgent = urgent
  report.score = { now: game.score, before: scoreBefore ?? game.score }
  report.measured = lastMeasured ? { before: lastMeasured, now: measured } : { now: measured }
  const events = [...ended.map((p) => p.event), ...(game.status === 'playing' ? began.map((p) => p.event) : [])]
  if (events.length) report.events = events
  if (!quiet) {
    report.worstRoads = worstRoads(game, city, result, setup.surface)
    if (roads.flooded.length) report.flooded = roads.flooded
  }
  if (!quiet) game.reports.push(report)
  return report
}

/** The news when an event of more than a month ends. */
export function endWords(e: GameEvent): string {
  switch (e.kind) {
    case 'cavein': return `${e.title.replace(/^A water main has burst under |^The road has caved in on /, 'The road is open again: ')}.`
    case 'fuel': return 'The price of fuel is back to what it was.'
    case 'monsoon': return 'The monsoon is over for the year.'
    default: return `Over: ${e.title.charAt(0).toLowerCase()}${e.title.slice(1)}.`
  }
}

/** The report's figure for the state of the roads: the share of main-road length in good or fair repair, and why it moved. */
function roadsFigureOf(game: Game, city: CityData, before: number, causes: { text: string; amount: number }[]): Figure {
  return {
    key: 'roads',
    name: 'Main roads in good or fair repair',
    now: roadsFigure(game, city),
    before: Math.round(before / 100) / 10,
    unit: '%',
    causes: [...causes]
      .filter((c) => Math.round(c.amount / 100) !== 0)
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || (a.text < b.text ? -1 : 1))
      .slice(0, 3)
      .map((c) => ({ text: `${tenths(c.amount / 1000, true)} points: ${c.text.charAt(0).toLowerCase()}${c.text.slice(1)}`, amount: Math.round(c.amount / 100) / 10 })),
  }
}

function endMonth(game: Game, city: CityData, result: MonthResult): Report {
  return settle(game, city, result, false)
}

/** A copy of the game that can be played forward without touching the original. */
function copy(game: Game): Game {
  return {
    ...game,
    prices: { ...game.prices },
    loans: game.loans.map((l) => ({ ...l })),
    done: [...game.done],
    reports: [],
    inputs: game.inputs && { ...game.inputs },
    told: [],
  }
}

/**
 * Money at the end of each of the next `months` months as things stand: the month's traffic taken as it was last
 * month (or `result`), the loans paid as they fall due, the costs rising each January. No model runs. Empty before the first month.
 */
export function forecast(game: Game, city: CityData, months = 12, result = game.last): { month: number; money: number }[] {
  const out: { month: number; money: number }[] = []
  if (!result) return out
  const g = copy(game)
  for (let k = 0; k < months && g.status === 'playing'; k++) {
    settle(g, city, { ...result, month: g.month }, true)
    out.push({ month: g.month, money: g.money })
  }
  return out
}

/**
 * Plays a whole game again from its season and list of actions (MP-30), to the end or to month `until`: one run of the
 * model a month and nothing else (no causes, no forecasts). Slice 8: with `reports` false, as the server checks a game,
 * no reports are written either, and the game is the same in everything else (`gameDigest` agrees).
 */
function replay(season: Season, city: CityData, done: Done[], simulate: Simulate, until?: number, reports = true): Game {
  const game = start(season, city)
  const end = until ?? season.months
  if (!whole(end) || end < 0 || end > season.months) throw new Error('The month to play to is not a proper one.')
  if (!Array.isArray(done)) throw new Error('The list of actions is not a proper one.')
  let i = 0
  const actNow = () => {
    while (i < done.length && done[i]?.month === game.month) {
      const d = done[i]!
      const outcome = act(game, city, d.action)
      if (!outcome.ok) throw new Error(`An action of ${monthName(d.month)} is not allowed: ${outcome.reason}`)
      i++
    }
    const next = done[i]
    if (i < done.length && (!next || typeof next !== 'object' || !whole(next.month))) {
      throw new Error('An action in the list is not a proper one.')
    }
    if (next && next.month < game.month) throw new Error('An action is dated in a month that had already passed.')
  }
  while (game.status === 'playing' && game.month < end) {
    actNow()
    settle(game, city, simulate(cityState(game, city)), !reports)
  }
  if (game.status === 'playing') actNow()
  if (i < done.length) throw new Error('An action is dated in a month that was never reached.')
  return game
}

export const rules = {
  start,
  score: (game: Game, _city: CityData) => game.score ?? scoreOf(game),
  may,
  act,
  state: (game: Game, city: CityData) => cityState(game, city),
  quote,
  suggest,
  snap,
  endMonth,
  books,
  replay,
  advise: (game: Game, city: CityData, options?: Parameters<NonNullable<Rules['advise']>>[2]) => advise(game, city, options ?? {}, { may, act, endMonth, forecast }),
} satisfies Rules
