import type { Station, TransitLine } from '../data/types'
import { costIndex, div, installment, loanLimit, owed, paidBy } from './money'
import { east, metres, micro, north } from './geo'
import { builtOf, cycleMinutes, defaultVehicles, isPlayers, lineLength, setupOf, transitOf } from './lines'
import { BUS_ROUTE, CANCEL_BACK, LOANS, MAJORS, METRO } from './params'
import { cleanPlan, planProblem, quote, roadsNow, trainsAtOpening } from './plan'
import { linkZones, roadNodes } from './roads'
import type { Action, Built, CityData, Game, Lakh, Outcome, Plan, Project, Quote } from './types'
import { patchNow, roadWords, stopWorks } from './upkeep'
import { crore, monthName } from './words'

/*
 * Building (PRD section 7.2): a plan quoted, paid for month by month as the work goes, opening when it is done.
 * Metro lines, suburban trains and large bus lane schemes are major actions, three a month. Every action is
 * checked, and a refused one changes nothing.
 */

const no = (reason: string): Outcome => ({ ok: false, reason })
const whole = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && Math.abs(x) <= 1e9

/**
 * Colours and names for the player's metro lines, in the order they are ordered: none near the city's own lines or
 * the traffic's colours, each named as Namma Metro names its lines. The screen's list (src/game/build.ts), kept the
 * same so that a line keeps one colour from proposal to opening.
 */
const LINE_LOOKS = [
  { colour: '#22336e', name: 'Navy' },
  { colour: '#8e5a39', name: 'Brown' },
  { colour: '#7d8b1f', name: 'Olive' },
  { colour: '#4f7482', name: 'Slate' },
  { colour: '#9b7896', name: 'Mauve' },
  { colour: '#3f3b36', name: 'Grey' },
]

/** A line in a sentence: "the Navy Line", "Bus route 2", "the suburban line Baiyappanahalli to Doddajala". */
export function lineNoun(line: TransitLine): string {
  if (line.kind === 'bus') return line.name
  if (line.kind === 'rail') return `the suburban line ${line.name}`
  return `the ${line.name}`
}

/** Work in a sentence: "the Navy Line, JP Nagar to Hebbal", "Bus route 2, …", "4.2 km of bus lanes". */
export function workNoun(p: Project): string {
  switch (p.plan.kind) {
    case 'metro':
      return `the ${p.name}`
    case 'busRoute':
      return p.name
    case 'busLane':
      return `${Math.round(p.quote.length / 100) / 10} km of bus lanes`
    case 'railService':
      return `${p.plan.trains} more trains on the suburban line ${p.name.slice(p.name.indexOf(', ') + 2)}`
    case 'road':
      return `the ${p.plan.flyover ? 'flyover' : 'new road'} ${ends(p.quote, 'from')}`
    case 'junction':
      return `${p.plan.work === 'signal' ? 'signals' : p.plan.work === 'redesign' ? 'the redesign of the junction' : 'the overpass'} at ${p.quote.stations[0]!.name}`
    case 'footpaths':
      return `footpaths in ${p.quote.stations[0]!.name}`
    case 'repair':
    case 'streets':
      return p.name.charAt(0).toLowerCase() + p.name.slice(1)
    default:
      return p.name
  }
}

/** Where a road runs, in words: "from Hebbal to Nagawara", or "in Hebbal" if both ends take one name. */
function ends(q: Quote, from: 'from' | ''): string {
  const a = q.stations[0]?.name ?? ''
  const b = q.stations.at(-1)?.name ?? ''
  return a === b ? `in ${a}` : `${from ? 'from ' : ''}${a} to ${b}`
}

/** Capitalised, for the start of a sentence. */
export const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const BUS_COLOUR = '#0b8793'

/** Payments due over the twelve months from now on the work in hand. */
function dueAhead(projects: Project[], month: number): Lakh {
  let sum = 0
  for (const p of projects) for (let m = month; m < month + 12; m++) sum += installment(p, m)
  return sum
}

/** The project a plan would make if ordered now, before the checks of money and majors. */
function projectFor(game: Game, city: CityData, plan: Plan, q: Quote): Project {
  const orders = game.done.filter((d) => d.action.kind === 'build')
  const ofKind = orders.filter((d) => d.action.kind === 'build' && d.action.plan.kind === plan.kind).length
  const between = q.stations.length >= 2 ? `, ${q.stations[0]!.name} to ${q.stations.at(-1)!.name}` : ''
  let name: string
  let line: string | undefined
  switch (plan.kind) {
    case 'metro':
      name = `${LINE_LOOKS[ofKind % LINE_LOOKS.length]!.name} Line${between}`
      line = `player-metro-${ofKind + 1}`
      break
    case 'busRoute':
      name = `Bus route ${ofKind + 1}${between}`
      line = `player-bus-${ofKind + 1}`
      break
    case 'busLane':
      name = `Bus lanes, ${Math.round(q.length / 100) / 10} km`
      break
    case 'railService': {
      const rail = city.transit.lines.find((l) => l.id === plan.line)!
      name = `${plan.trains} more trains, ${rail.name}`
      break
    }
    case 'road':
      name = `${plan.flyover ? 'Flyover' : 'New road'}, ${ends(q, '')}`
      break
    case 'junction':
      name = `${plan.work === 'signal' ? 'Signals' : plan.work === 'redesign' ? 'Junction redesign' : 'Overpass'} at ${q.stations[0]!.name}`
      break
    case 'footpaths':
      name = `Footpaths in ${q.stations[0]!.name}`
      break
    case 'repair': {
      const links = plan.links.filter((id) => q.disrupted.includes(id))
      name = `${plan.work === 'concrete' ? 'Concrete on' : 'Resurfacing'} ${km(q.length)} of ${roadWords(city, links.length ? links : plan.links)}`
      break
    }
    case 'streets':
      name = `Resurfacing the streets of ${q.stations[0]!.name}`
      break
    default:
      name = ''
  }
  const project: Project = {
    id: orders.length + 1,
    plan: cleanPlan(plan),
    name,
    started: game.month,
    opens: game.month + q.months,
    cost: q.cost,
    quote: q,
  }
  if (line) project.line = line
  return project
}

export function mayBuild(game: Game, city: CityData, action: Action): Outcome {
  switch (action.kind) {
    case 'build': {
      const problem = planProblem(action.plan)
      if (problem) return no(problem)
      const q = quote(game, city, action.plan)
      if (!q.ok) return no(q.reason ?? 'That cannot be built.')
      if (q.major && (game.majors ?? 0) >= MAJORS) {
        return no(`Three major works may be started in a month, and three have been. Start this in ${monthName(game.month + 1)}.`)
      }
      if (game.month + q.months > game.season.months) {
        return no(`It would take ${q.months} months, and would not be done before the term ends.`)
      }
      // Done at once, and paid at once.
      if (q.months === 0) {
        if (q.cost > Math.max(0, game.money)) return no(`It costs ${crore(q.cost)}, and the city has ${crore(Math.max(0, game.money))}.`)
        return { ok: true }
      }
      // The city refuses work it cannot pay for (PRD MONEY-4): what it and the work in hand fall due over the next
      // twelve months, against the money in hand and what may still be borrowed.
      const p = projectFor(game, city, action.plan, q)
      const ahead = dueAhead([...(game.projects ?? []), p], game.month)
      const room = Math.max(0, loanLimit(game) - owed(game))
      const canBorrow = room - (room % LOANS.step)
      if (Math.max(0, game.money) + canBorrow < ahead) {
        return no(
          `The work in hand and this would cost ${crore(ahead)} over the next twelve months. The city has ` +
            `${crore(Math.max(0, game.money))}, and can borrow ${crore(canBorrow)} more.`,
        )
      }
      return { ok: true }
    }
    case 'cancel': {
      if (!whole(action.project) || !(game.projects ?? []).some((p) => p.id === action.project)) {
        return no('There is no such work under way.')
      }
      return { ok: true }
    }
    case 'vehicles': {
      if (typeof action.line !== 'string') return no('There is no such line.')
      if (!whole(action.change) || action.change === 0 || Math.abs(action.change) > 50) {
        return no('Add or take away between 1 and 50 at a time.')
      }
      const v = vehicleLimits(game, city, action.line)
      if (typeof v === 'string') return no(v)
      const after = v.now + action.change
      if (after < v.fewest) return no(`${upper(v.name)} needs at least ${v.fewest} ${v.what}.`)
      if (after > v.most) return no(`${upper(v.name)} can run at most ${v.most} ${v.what}.`)
      const cost = action.change > 0 ? action.change * v.price : 0
      if (cost > game.money) return no(`They cost ${crore(cost)}, and the city has ${crore(Math.max(0, game.money))}.`)
      return { ok: true }
    }
    case 'close': {
      if (typeof action.line !== 'string' || !builtOf(game).lines.some((l) => l.id === action.line)) {
        return no('Only a line you have built can be closed.')
      }
      return { ok: true }
    }
  }
  return no('That is not something the city can do.')
}

/** What a line runs now, what it may run, and what one more costs. */
function vehicleLimits(game: Game, city: CityData, lineId: string) {
  const built = builtOf(game)
  const transit = transitOf(city, setupOf(game, city))
  const line = transit.lines.find((l) => l.id === lineId && l.status === 'open')
  if (!line) return 'There is no such line open.'
  const price = Math.round((METRO.train * METRO.share * costIndex(game.month)) / 100_000_000)
  if (line.kind === 'bus') {
    return { now: built.vehicles[lineId] ?? 0, fewest: BUS_ROUTE.fewest, most: BUS_ROUTE.most, price: div(BUS_ROUTE.bus * costIndex(game.month), 10_000), name: lineNoun(line), what: 'buses' }
  }
  const cycle = cycleMinutes(lineLength(line), line.kind)
  if (line.kind === 'rail') {
    // Suburban trains are added by ordering more (a major work); here only those added may be taken away.
    const added = built.vehicles[lineId] ?? 0
    return { now: added, fewest: 0, most: added, price: 0, name: lineNoun(line), what: 'more trains than the railway runs' }
  }
  const base = isPlayers(lineId) ? 0 : defaultVehicles(transit, line)
  return {
    now: base + (built.vehicles[lineId] ?? 0),
    fewest: METRO.fewest,
    most: Math.ceil(cycle / METRO.busiest),
    price,
    name: lineNoun(line),
    what: 'trains',
  }
}

export function actBuild(game: Game, city: CityData, action: Action): { kept: Action; news?: string } {
  switch (action.kind) {
    case 'build': {
      const q = quote(game, city, action.plan)
      if (q.months === 0) return actAtOnce(game, city, action.plan, q)
      const p = projectFor(game, city, action.plan, q)
      game.projects = [...(game.projects ?? []), p]
      if (q.major) game.majors = (game.majors ?? 0) + 1
      return { kept: { kind: 'build', plan: p.plan } }
    }
    case 'cancel': {
      const p = game.projects!.find((x) => x.id === action.project)!
      const back = div(paidBy(p, game.month) * CANCEL_BACK, 10_000)
      // Roads it had dug up are handed back as they are (slice 6).
      stopWorks(game, city, p)
      game.money += back
      game.projects = game.projects!.filter((x) => x !== p)
      return {
        kept: { kind: 'cancel', project: action.project },
        news: `You stopped work on ${workNoun(p)}. Of ${crore(paidBy(p, game.month))} paid, ${crore(back)} came back.`,
      }
    }
    case 'vehicles': {
      const v = vehicleLimits(game, city, action.line) as Exclude<ReturnType<typeof vehicleLimits>, string>
      const built = copyBuilt(game)
      built.vehicles = { ...built.vehicles, [action.line]: (built.vehicles[action.line] ?? 0) + action.change }
      if (built.vehicles[action.line] === 0 && !isPlayers(action.line)) delete built.vehicles[action.line]
      game.built = built
      const cost = action.change > 0 ? action.change * v.price : 0
      game.money -= cost
      const n = Math.abs(action.change)
      const what = v.what === 'buses' ? (n === 1 ? 'bus' : 'buses') : n === 1 ? 'train' : 'trains'
      return {
        kept: { kind: 'vehicles', line: action.line, change: action.change },
        news: action.change > 0
          ? `You added ${n} ${what} to ${v.name}, for ${crore(cost)}. It now runs ${v.now + action.change}.`
          : `You took ${n} ${what} off ${v.name}. It now runs ${v.now + action.change}.`,
      }
    }
    case 'close': {
      const built = copyBuilt(game)
      const line = built.lines.find((l) => l.id === action.line)!
      built.lines = built.lines.filter((l) => l !== line)
      const used = new Set(built.lines.flatMap((l) => l.stations))
      built.stations = built.stations.filter((s) => used.has(s.id))
      const vehicles = { ...built.vehicles }
      delete vehicles[line.id]
      built.vehicles = vehicles
      game.built = built
      return { kept: { kind: 'close', line: action.line }, news: `You closed ${lineNoun(line)}.` }
    }
  }
  throw new Error('Not a building action.')
}

const copyBuilt = (game: Game): Built => ({ ...builtOf(game) })

/** Policies that take effect at once: one-way streets, speed limits, taller building. Paid at once. */
function actAtOnce(game: Game, city: CityData, plan: Plan, q: Quote): { kept: Action; news: string } {
  const built = copyBuilt(game)
  const place = q.stations[0]?.name
  let news = ''
  switch (plan.kind) {
    case 'oneWay': {
      built.oneWay = plan.on ? [...(built.oneWay ?? []), plan.link] : (built.oneWay ?? []).filter((l) => l !== plan.link)
      const zone = city.zones.find((z) => z.id === linkZones(city, roadsNow(game, city))[plan.link])!.name
      news = plan.on
        ? `You made a stretch of main road in ${zone} one-way, ${km(q.length)}. Traffic the other way goes round.`
        : `You made a stretch of main road in ${zone} two-way again.`
      break
    }
    case 'speedLimit': {
      const rest = (built.limits ?? []).filter((l) => l.zone !== plan.zone)
      built.limits = plan.limit === null ? rest : [...rest, { zone: plan.zone, limit: plan.limit }].sort((a, b) => a.zone - b.zone)
      news = plan.limit === null
        ? `You lifted the speed limit in ${place}.`
        : `You set a speed limit of ${plan.limit} km/h on ${km(q.length)} of main road in ${place}.`
      break
    }
    case 'repair':
    case 'streets':
      news = patchNow(game, city, plan, q)
      break
    case 'density': {
      const rest = (built.dense ?? []).filter((z) => z !== plan.zone)
      built.dense = plan.on ? [...rest, plan.zone].sort((a, b) => a - b) : rest
      news = plan.on
        ? `You allowed taller building in ${place}, near its station. More of the city's growth will come there, and the city sells the right to build.`
        : `Taller building is no longer allowed in ${place}.`
      break
    }
  }
  game.built = built
  game.money -= q.cost
  if (q.major) game.majors = (game.majors ?? 0) + 1
  if (q.cost > 0) news += ` It cost ${crore(q.cost)}.`
  return { kept: { kind: 'build', plan: cleanPlan(plan) }, news }
}

const km = (m: number) => `${Math.round(m / 100) / 10} km`

/**
 * At the end of a month: work finished opens (its line, stations, lanes or trains become the city's), and the
 * season's lines open as the season has them. Returns what opened, for the news and approval.
 */
/** Something that opened: its kind, and a few words for approval ("The Navy Line opening") and for needs. */
export interface Opened {
  kind: string
  push: string
  need: string
}

export function openings(game: Game, city: CityData, month: number): { news: string[]; opened: Opened[] } {
  const news: string[] = []
  const opened: Opened[] = []
  const done = (game.projects ?? []).filter((p) => p.opens === month + 1)
  const stretches = (game.projects ?? []).filter((p) => p.opens > month + 1 && stretchOf(p)?.month === month + 1)
  if (stretches.length) {
    const built = copyBuilt(game)
    for (const p of stretches) {
      const { stations } = stretchOf(p)!
      const line = openLine(city, built, p, stations)
      const from = p.quote.stations[0]!.name
      const to = p.quote.stations[stations - 1]!.name
      news.push(`The ${line.name} opens its first stretch, from ${from} to ${to}, ${stations} stations. The rest opens in ${monthName(p.opens)}.`)
      opened.push({ kind: 'metro-stretch', push: `The ${line.name} opening its first stretch`, need: `The ${line.name} has opened from ${from} to ${to}.` })
    }
    game.built = built
  }
  if (done.length) {
    const built = copyBuilt(game)
    for (const p of done) {
      const line = openProject(city, built, p)
      opened.push({ kind: p.plan.kind === 'junction' ? `junction-${p.plan.work}` : p.plan.kind, ...shortWords(p, line) })
      news.push(openingWords(p))
    }
    game.built = built
    game.projects = game.projects!.filter((p) => !done.includes(p))
  }
  for (const o of game.season.openings ?? []) {
    if (o.month !== month + 1) continue
    const line = city.transit.lines.find((l) => l.id === o.line)
    if (!line) continue
    const byId = new Map(city.transit.stations.map((s) => [s.id, s]))
    const first = byId.get(line.stations[0]!)!.name
    const last = byId.get(line.stations[Math.min(o.stations, line.stations.length) - 1]!)!.name
    const all = o.stations >= line.stations.length
    const before = (game.season.openings ?? []).some((x) => x.line === o.line && x.month < o.month)
    const stretch = all ? 'in full' : before ? 'further' : 'its first stretch'
    news.push(`The ${line.name} opens ${stretch}, from ${first} to ${last}. The city pays for running it.`)
    opened.push({ kind: 'season', push: `The ${line.name} opening`, need: `The ${line.name} has opened, from ${first} to ${last}.` })
  }
  return { news, opened }
}

/** A few words for something opening: for approval's pushes, and for what needs the player. */
function shortWords(p: Project, line: TransitLine | null): { push: string; need: string } {
  switch (p.plan.kind) {
    case 'metro':
      return { push: `The ${line!.name} opening`, need: `The ${line!.name} has opened.` }
    case 'busRoute':
      return { push: `${line!.name} starting`, need: `${line!.name} has started running.` }
    case 'busLane':
      return { push: 'New bus lanes opening', need: `${upper(workNoun(p))} have opened.` }
    case 'railService':
      return { push: 'More suburban trains starting', need: `${upper(workNoun(p))} have started running.` }
    case 'footpaths':
      return { push: `${upper(workNoun(p))} laid`, need: `${upper(workNoun(p))} are laid.` }
    case 'repair':
    case 'streets':
      return { push: `${p.name} done`, need: `${p.name} is done.` }
    case 'junction':
      if (p.plan.work === 'signal') return { push: `${upper(workNoun(p))} working`, need: `${upper(workNoun(p))} are working.` }
      return { push: `${upper(workNoun(p))} done`, need: `${upper(workNoun(p))} is done.` }
    default:
      return { push: `${upper(workNoun(p))} opening`, need: `${upper(workNoun(p))} has opened.` }
  }
}

function openingWords(p: Project): string {
  switch (p.plan.kind) {
    case 'metro':
      return `${upper(workNoun(p))} opens, with ${p.quote.stations.length} stations over ${Math.round(p.quote.length / 100) / 10} km.`
    case 'busRoute':
      return `${p.name} begins running, with ${p.plan.buses} buses.`
    case 'busLane':
      return `${upper(workNoun(p))} are open: buses run free of the traffic there, and other vehicles have a lane less.`
    case 'railService':
      return `${upper(workNoun(p))} begin running.`
    case 'road':
      return `${upper(workNoun(p))} opens: ${km(p.quote.length)}, ${p.plan.lanes} lane${p.plan.lanes === 1 ? '' : 's'} each way.` +
        (p.plan.flyover ? ' It meets no road between its ends.' : ` It meets ${Math.max(0, p.quote.stations.length - 2)} roads on the way, at new signals.`)
    case 'junction':
      if (p.plan.work === 'signal') return `${upper(workNoun(p))} are working.`
      if (p.plan.work === 'redesign') return `${upper(workNoun(p))} is done: more room to turn, and safer crossings.`
      return `${upper(workNoun(p))} opens: the main road runs over the junction.`
    case 'footpaths':
      return `Footpaths and crossings are laid in ${p.quote.stations[0]!.name}.`
    case 'repair':
      return p.plan.work === 'concrete'
        ? `${p.name} is done: the road is as new, and the lanes are open again.`
        : `${p.name} is done: the road is good again, and its lane is open.`
    case 'streets':
      return `${p.name} is done: they are good again.`
    default:
      return `${upper(workNoun(p))} is done.`
  }
}

/** Puts a finished project into what is built; returns its line, if it has one. */
function openProject(city: CityData, built: Built, p: Project): TransitLine | null {
  const plan = p.plan
  if (plan.kind === 'busLane') {
    built.busLanes = [...new Set([...built.busLanes, ...plan.links])].sort((a, b) => a - b)
    return null
  }
  if (plan.kind === 'railService') {
    built.vehicles = { ...built.vehicles, [plan.line]: (built.vehicles[plan.line] ?? 0) + plan.trains }
    return null
  }
  if (plan.kind === 'road') {
    const road = { id: p.id, name: p.name, path: p.quote.path, lanes: plan.lanes, flyover: plan.flyover, nodes: roadNodes(city.roads, p.quote) }
    built.roads = [...(built.roads ?? []), road]
    return null
  }
  if (plan.kind === 'junction') {
    built.junctions = [...(built.junctions ?? []), { node: plan.node, work: plan.work }]
    return null
  }
  if (plan.kind === 'footpaths') {
    built.footpaths = [...(built.footpaths ?? []), plan.zone].sort((a, b) => a - b)
    return null
  }
  if (plan.kind !== 'metro' && plan.kind !== 'busRoute') return null
  return openLine(city, built, p, p.quote.stations.length)
}

/**
 * A metro line opens in two stretches, as Namma Metro's do: its first half of stations once the works on the roads are
 * over (half its months), the rest at the end. A line of fewer than four stations opens at once. Null if in one.
 */
export function stretchOf(p: Project): { month: number; stations: number } | null {
  const n = p.quote.stations.length
  if (p.plan.kind !== 'metro' || n < METRO.stretchFrom) return null
  return { month: p.started + Math.floor((p.opens - p.started) / 2), stations: Math.ceil(n / 2) }
}

/**
 * Opens a project's line, as far as its first `count` stations: new stations numbered after every station there is
 * (those opened with a first stretch kept), the path cut at the last, and trains for the length open (never fewer than
 * it runs already).
 */
function openLine(city: CityData, built: Built, p: Project, count: number): TransitLine {
  const kind = p.plan.kind === 'metro' ? 'metro' : 'bus'
  let next = 1 + Math.max(0, ...city.transit.stations.map((s) => s.id), ...built.stations.map((s) => s.id))
  const stations: number[] = []
  const added: Station[] = []
  for (const s of p.quote.stations.slice(0, count)) {
    if (s.existing !== undefined) {
      stations.push(s.existing)
      continue
    }
    const kept = built.stations.find((t) => t.kind === kind && t.name === s.name && t.at[0] === s.at[0] && t.at[1] === s.at[1])
    if (kept) {
      stations.push(kept.id)
      continue
    }
    const station: Station = { id: next++, name: s.name, nameKn: s.nameKn, at: s.at, kind }
    added.push(station)
    stations.push(station.id)
  }
  const id = p.line ?? `player-${kind}-${p.id}`
  const order = Number(id.slice(id.lastIndexOf('-') + 1)) - 1
  const look = kind === 'metro' ? LINE_LOOKS[order % LINE_LOOKS.length]! : null
  const line: TransitLine = {
    id,
    name: look ? `${look.name} Line` : `Bus route ${order + 1}`,
    kind,
    colour: look ? look.colour : BUS_COLOUR,
    status: 'open',
    stations,
    path: count < p.quote.stations.length ? cutAt(p.quote.path, p.quote.stations[count - 1]!.at) : p.quote.path,
  }
  const had = built.lines.some((l) => l.id === id)
  built.lines = had ? built.lines.map((l) => (l.id === id ? line : l)) : [...built.lines, line]
  built.stations = [...built.stations, ...added]
  const trains = p.plan.kind === 'busRoute' ? p.plan.buses : trainsAtOpening(lineLength(line))
  built.vehicles = { ...built.vehicles, [id]: had ? Math.max(trains, built.vehicles[id] ?? 0) : trains }
  return line
}

/** A path as lng, lat, … cut at the point nearest a place, ending at the place. */
function cutAt(path: number[], place: [number, number]): number[] {
  const px = east(micro(place[0]))
  const py = north(micro(place[1]))
  let cut = 0
  let best = Infinity
  for (let i = 0; 2 * i + 1 < path.length; i++) {
    const d = metres(px, py, east(micro(path[2 * i]!)), north(micro(path[2 * i + 1]!)))
    if (d < best) {
      best = d
      cut = i
    }
  }
  return [...path.slice(0, 2 * cut), place[0], place[1]]
}
