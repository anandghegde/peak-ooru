import type { Transit, TransitLine } from '../data/types'
import { BUS, DEFAULT_PRICES, TRANSIT } from '../sim/params'
import type { MonthResult, RoutingNetwork } from '../sim/types'
import { growth } from './growth'
import { builtOf, cycleMinutes, defaultVehicles, isPlayers, lineLength, setupOf, transitOf } from './lines'
import { builtLaneMetres, networkOf, sidesIn } from './roads'
import { BUS_LANE, BUS_ROUTE, FARE_DAYS, FIRST_GUESS, FOOTPATHS, LOANS, RAIL_SERVICE, RUN_DAYS, RUNNING, TAX, TAX_BASE, VALUE, YEARLY } from './params'
import type { CityData, Entry, Game, Lakh, Loan, Project } from './types'
import { busWear, upkeepCost } from './upkeep'

/*
 * The books: what the city earns and spends in a month. Whole numbers throughout: every step is a product of whole
 * numbers divided and rounded, which every machine does alike.
 */

/** a ÷ b, rounded to a whole number. */
export const div = (a: number, b: number) => Math.round(a / b)

/** Rupees, as the model takes prices, to whole paise. */
export const paise = (rupees: number) => Math.round(rupees * 100)

/** 10000 grown by `basis` hundredths of a percent a year, for each January since the start. */
function yearly(basis: number, month: number): number {
  let x = 10_000
  for (let y = 0; y < Math.floor(month / 12); y++) x = div(x * (10_000 + basis), 10_000)
  return x
}
/** Running costs against the first year's, in ten-thousandths. */
export const costIndex = (month: number) => yearly(YEARLY.costs, month)
/** The value of property against the first year's, in ten-thousandths, as it rises when the tax is standard. */
export const valueIndex = (month: number) => yearly(YEARLY.value, month)

/**
 * The value of property for next year, at the end of a December (slice 5): it rises 4% a year, less `VALUE.tax` for
 * each whole of the tax rate above the standard (more below it), since a dearer tax is paid out of what property is
 * worth. So a tax of 125% of the standard has values rising 1.5% a year, and the tax base with them.
 */
export function nextValue(game: Game): number {
  const now = game.value ?? valueIndex(game.month)
  return div(now * (10_000 + YEARLY.value - div((game.taxRate - TAX.standard) * VALUE.tax, 10_000)), 10_000)
}

/** The state's grant this month: it rises each January, and the last election may have cut or raised it (slice 7). */
export const grantNow = (game: Game): Lakh =>
  div(div(game.season.grant * yearly(YEARLY.grant, game.month), 10_000) * (game.grantShare ?? 10_000), 10_000)

/** What a project pays in `month`: its cost spread evenly over its months, whole lakh, adding up to the cost exactly. */
export function installment(p: Project, month: number): Lakh {
  const months = p.opens - p.started
  const k = month - p.started
  if (k < 0 || k >= months) return 0
  return Math.floor((p.cost * (k + 1)) / months) - Math.floor((p.cost * k) / months)
}

/** What a project has paid by the start of `month`. */
export const paidBy = (p: Project, month: number): Lakh =>
  Math.floor((p.cost * Math.max(0, Math.min(p.opens - p.started, month - p.started))) / (p.opens - p.started))

/** Property tax for the month: grows with people and with the value of property, and with the rate. */
export function taxIncome(game: Game): Lakh {
  const people = div(TAX_BASE * game.people, 10_000)
  return div(div(people * (game.value ?? valueIndex(game.month)), 10_000) * game.taxRate, 10_000)
}

/**
 * What may be owed in all, and what is owed now. The limit is twelve months of the city's own and the state's money:
 * property tax, the grant, and the state's payment for free bus rides as last month's traffic had them.
 */
export function loanLimit(game: Game): Lakh {
  return LOANS.limitMonths * (taxIncome(game) + grantNow(game) + shakti(faresPaid(game, game.last, 'bus'), game))
}

/**
 * The state's payment for the bus rides it makes free (the Shakti scheme): the fares the riders who ride free would
 * have paid, as the state pays the bus corporation. So more riders on the buses bring in more.
 */
export function shakti(busFares: Lakh, game?: Game): Lakh {
  const paying = Math.round(BUS.paying * 1000)
  const paid = div(busFares * (1000 - paying), paying)
  if (!game) return paid
  // The state pays at the usual fare, which rises with costs; a fare set above it is the city's own affair (slice 5).
  const usual = div(paise(DEFAULT_PRICES.busPerKm) * costIndex(game.month), 10_000)
  const now = paise(game.prices.busPerKm)
  return now > usual ? div(paid * usual, now) : paid
}

/** Fares paid in a month by one mode, in lakh: as the model says, or else estimated from its trips. */
function faresPaid(game: Game, result: MonthResult | null, mode: Fared): Lakh {
  const given = (result as Detail | null)?.fares?.[mode]
  if (given !== undefined) return faresMonth(given)
  const r = ridership(result, mode)
  return fareIncome(mode, r.trips, r.km10, paise(game.prices[`${mode}PerKm`]), paise(game.prices.leastFare))
}
export const owed = (game: Game) => game.loans.reduce((sum, l) => sum + l.owed, 0)

/** The yearly rate for a new loan, which rises with what will then be owed. In steps of a quarter percent. */
export function loanRate(owedAfter: Lakh, limit: Lakh): number {
  const extra = limit > 0 ? Math.floor((owedAfter * LOANS.rateAtLimit) / limit / 25) * 25 : LOANS.rateAtLimit
  return LOANS.rate + Math.min(LOANS.rateAtLimit, extra)
}

/** The fixed monthly payment that repays `amount` at `rate` over `months`, rounded up to a whole lakh. */
export function loanPayment(amount: Lakh, rate: number, months: number): Lakh {
  const r = rate / 120_000
  let f = 1
  for (let k = 0; k < months; k++) f *= 1 + r
  return Math.ceil((amount * r * f) / (f - 1))
}

/** What a loan takes this month: interest on what is owed, and the rest of the payment off what is owed. */
export function loanDue(loan: Loan, month: number): { interest: Lakh; principal: Lakh } {
  if (loan.taken >= month) return { interest: 0, principal: 0 }
  const interest = div(loan.owed * loan.rate, 120_000)
  const principal = loan.monthsLeft <= 1 ? loan.owed : Math.min(loan.owed, Math.max(0, loan.payment - interest))
  return { interest, principal }
}

/** Length of a line along its track, in whole metres. */
export const lineMetres = (_transit: Transit, line: TransitLine): number => lineLength(line)

const lanes = new WeakMap<RoutingNetwork, number>()
/** Lane-metres of main road. */
export function laneMetres(roads: RoutingNetwork): number {
  let m = lanes.get(roads)
  if (m === undefined) {
    m = 0
    for (const l of roads.links) m += l.length * l.lanes
    lanes.set(roads, m)
  }
  return m
}

type Fared = 'metro' | 'bus' | 'rail'

/** What the model may give beyond the agreed result: fares paid and distances ridden, a weekday (`MonthDetail`). */
interface Detail {
  lineKm?: Record<string, number>
  tripKm?: Partial<Record<Fared, number>>
  fares?: Partial<Record<Fared, number>>
  passengerKm?: Partial<Record<Fared, number>>
  lineFare?: Record<string, number>
  crowding?: Record<string, number>
}

/** Trips a weekday and their average length in tenths of a km, from the month's traffic or a first guess. */
function ridership(result: MonthResult | null, mode: Fared): { trips: number; km10: number } {
  const km = (result as Detail | null)?.tripKm?.[mode] ?? FIRST_GUESS.km[mode]
  return { trips: result ? result.trips[mode] : FIRST_GUESS.trips[mode], km10: Math.round(km * 10) }
}

/** A weekday's rupees of fares as the month's, in lakh. */
const faresMonth = (rupees: number) => div(Math.round(rupees) * FARE_DAYS, 100_000)

/**
 * Fares for a month, in lakh: a weekday's trips times the fare for a trip of average length, within the least and
 * most fares, for the share who pay (on the bus, women ride free), over the month's fare days.
 */
export function fareIncome(mode: Fared, trips: number, km10: number, perKm: number, least: number): Lakh {
  const most = (mode === 'bus' ? BUS.mostFare : TRANSIT.mostFare) * 100
  const fare = Math.min(most, Math.max(least, div(perKm * km10, 10)))
  const paying = mode === 'bus' ? Math.round(BUS.paying * 1000) : 1000
  return div(trips * fare * paying * FARE_DAYS, 10_000_000_000)
}

/** Running a line's trains for a month, in lakh, before the rise in costs. */
function trainCost(metresLong: number, trainsEachWay: number, rupeesPerKm: number): Lakh {
  return div(metresLong * 2 * trainsEachWay * RUN_DAYS * rupeesPerKm, 100_000_000)
}

/**
 * The month's books, from its traffic (or the last month's, or a first guess), at the game's prices, people, rate
 * and loans. Income is positive, costs negative.
 */
export function monthBooks(game: Game, city: CityData, result: MonthResult | null): Entry[] {
  const index = costIndex(game.month)
  const cost = (x: number) => -div(x * index, 10_000)
  const setup = setupOf(game, city)
  const transit = transitOf(city, setup)
  const entries: Entry[] = [
    { key: 'tax', name: 'Property tax', amount: taxIncome(game) },
    { key: 'grant', name: 'Grant from the state', amount: grantNow(game) },
  ]

  // Fares as the model says they were paid, where it says so; otherwise the fare of a trip of average length.
  const detail = result as Detail | null
  const paid = (mode: Fared) => faresPaid(game, result, mode)
  const metroFares = paid('metro')
  const metroLines = transit.lines.filter((l) => l.kind === 'metro' && l.status === 'open')
  // Each line's fares as the model shares them out, or by its riders; the last line takes what rounding leaves.
  const shares = metroLines.map((l) => detail?.lineFare?.[l.id] ?? result?.riders[l.id] ?? 1)
  const allShares = shares.reduce((a, b) => a + b, 0)
  let left = metroFares
  metroLines.forEach((line, k) => {
    const amount = k === metroLines.length - 1 ? left : allShares > 0 ? div(metroFares * Math.round(shares[k]!), Math.round(allShares)) : 0
    left -= amount
    entries.push({ key: `fares-metro-${line.id}`, name: `${line.name} fares`, amount })
  })
  const busFares = paid('bus')
  entries.push({ key: 'fares-bus', name: 'Bus fares', amount: busFares })
  entries.push({ key: 'shakti', name: 'Free bus rides, paid by the state', amount: shakti(busFares, game) })
  entries.push({ key: 'fares-rail', name: 'Suburban rail fares', amount: paid('rail') })

  for (const line of metroLines) {
    const length = lineLength(line)
    const set = setup.vehicles[line.id]
    let trains: number
    if (set !== undefined) {
      // Trains as the player has them: those the line runs, at one and a half times the peak headway for 18 hours.
      const vehicles = isPlayers(line.id) ? set : defaultVehicles(transit, line) + set
      trains = div(720 * vehicles, cycleMinutes(length, 'metro'))
    } else {
      const timetable = RUNNING.lineTrains[line.id] ?? RUNNING.metroTrains
      // Crowding: riders where the line is fullest, in thousandths of what its trains carry (from the model).
      const crowding = Math.round(detail?.crowding?.[line.id] ?? 0)
      trains = crowding > 1000 ? div(timetable * crowding, 1000) : timetable
    }
    entries.push({ key: `run-metro-${line.id}`, name: `Running the ${line.name}`, amount: cost(trainCost(length, trains, RUNNING.metroTrainKm)) })
  }
  // The fleet follows the riders: bus-km run are the passenger-km carried over the passengers a bus-km carries. The
  // player's routes run the buses they are given, and their riders are not counted twice.
  const bus = ridership(result, 'bus')
  const routes = transit.lines.filter((l) => l.kind === 'bus' && l.status === 'open')
  let routeKm = 0
  for (const r of routes) routeKm += Math.round(detail?.lineKm?.[r.id] ?? 0)
  const busPassengerKm10 = detail?.passengerKm?.bus !== undefined
    ? Math.max(0, Math.round(detail.passengerKm.bus) - routeKm) * 10
    : bus.trips * bus.km10
  const busKm = div(busPassengerKm10 * RUN_DAYS * RUNNING.busKm, 10 * RUNNING.busLoad * 100_000)
  entries.push({ key: 'run-bus', name: 'Running the buses', amount: cost(busKm) })
  // Slice 6: what poor roads add to running them.
  const worn = busWear(game, result)
  if (worn > 0) entries.push({ key: 'bus-roads', name: 'Buses worn by poor roads', amount: -worn })
  for (const r of routes) {
    const buses = setup.vehicles[r.id] ?? 0
    entries.push({ key: `run-bus-${r.id}`, name: `Running ${r.name}`, amount: cost(div(buses * BUS_ROUTE.kmPerDay * RUN_DAYS * RUNNING.busKm, 100_000)) })
  }
  let railRunning = 0
  for (const line of transit.lines) {
    if (line.kind !== 'rail' || line.status !== 'open') continue
    const more = Math.max(0, setup.vehicles[line.id] ?? 0) * RAIL_SERVICE.trips
    railRunning += trainCost(lineLength(line), RUNNING.railTrains + more, RUNNING.railTrainKm)
  }
  entries.push({ key: 'run-rail', name: 'Running suburban trains', amount: cost(railRunning) })
  // The upkeep budget (slice 6, PRD UPK-4): the city's roads and streets, and for good the roads the player built
  // (PRD UPK-14), at the level set.
  const built = builtOf(game)
  entries.push({
    key: 'upkeep',
    name: 'Upkeep of roads',
    amount: -upkeepCost(game, city, game.upkeep ?? 'steady', laneMetres(city.roads) + builtLaneMetres(city, built)),
  })
  if (built.footpaths?.length) {
    const roads = networkOf(city, setup.onRoads)
    let m = 0
    for (const z of built.footpaths) m += sidesIn(city, roads, z)
    entries.push({ key: 'footpaths', name: 'Upkeep of footpaths', amount: cost(div(m * FOOTPATHS.upkeepTenKm, 10_000)) })
  }
  if (result && built.dense?.length) {
    const rights = growth(game, city, result).rights
    if (rights > 0) entries.push({ key: 'rights', name: 'Building rights sold near stations', amount: rights })
  }
  if (setup.busLanes.length) {
    let m = 0
    for (const id of setup.busLanes) m += city.roads.links[id]?.length ?? 0
    entries.push({ key: 'bus-lanes', name: 'Keeping the bus lanes clear', amount: cost(div(m * BUS_LANE.upkeepKm, 1000)) })
  }
  for (const p of game.projects ?? []) {
    const amount = installment(p, game.month)
    if (amount > 0) entries.push({ key: `build-${p.id}`, name: `Building: ${p.name}`, amount: -amount })
  }

  let payments = 0
  for (const loan of game.loans) {
    const due = loanDue(loan, game.month)
    payments += due.interest + due.principal
  }
  if (payments > 0) entries.push({ key: 'loans', name: 'Loan payments', amount: -payments })
  return entries
}

export const balance = (entries: Entry[]) => entries.reduce((sum, e) => sum + e.amount, 0)
