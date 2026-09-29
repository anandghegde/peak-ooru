import type { TransitLine } from '../data/types'
import type { MonthResult, Prices, RoutingNetwork, Simulate } from '../sim/types'
import { paise } from './money'
import { cityState } from './state'
import type { Cause, CityData, Entry, Figure, Game, Lakh, Pressure, Report, Setup } from './types'
import { networkOf } from './roads'
import { NOISE } from './params'
import { NO_CHANGE, withinNoise } from './reasons'
import { fairness, fairnessReference } from './score'
import { surfaceMinutes, withoutMended } from './upkeep'
import { crore, MODE_NAMES, perKm, tenths } from './words'

/*
 * Reports with reasons (PRD SCORE-13, TIME-8). Each figure is given with its value before and now, and up to three
 * causes. A cause is found by working the month out again with one thing that changed put back as it was, and
 * taking the difference: a model run for each thing, so it is done only where the player stops.
 */

/** The figures of a month's traffic, as the player reads them. */
export interface Traffic {
  commute: number
  speed: number
  access: number
  clean: number
  /** Road deaths a year at the month's rate; 0 if the model does not give them. */
  safety: number
}
type TrafficKey = keyof Traffic
/** The traffic figures, and fairness (slice 7), in points of a hundred. */
type Parts = Traffic & { fairness: number }

const WORDS: Record<TrafficKey, { name: string; unit: string; causeUnit: string }> = {
  commute: { name: 'Average commute', unit: 'min', causeUnit: 'min' },
  speed: { name: 'Speed on main roads at the peaks', unit: 'km/h', causeUnit: 'km/h' },
  access: { name: 'Jobs within 45 minutes', unit: '%', causeUnit: 'points' },
  clean: { name: 'Trips by bus, train, cycle or on foot', unit: '%', causeUnit: 'points' },
  safety: { name: 'Road deaths a year', unit: 'a year', causeUnit: 'deaths a year' },
}
const KEYS: TrafficKey[] = ['commute', 'speed', 'access', 'clean', 'safety']

const tenth = (x: number) => Math.round(x * 10) / 10
/** Minutes of commute below which a cause is the model's noise, not a cause (docs/MODEL.md; slice 7: `NOISE`). */
const NOISE_MINUTES = NOISE.commute / 60
/** A whole number with its sign: "+12", "−3". */
const whole = (x: number) => (x > 0 ? `+${x}` : x < 0 ? `−${-x}` : '0')

/** Speed over the roads at the morning and evening peaks: vehicle-km over vehicle-hours. */
function peakSpeed(result: MonthResult, roads: RoutingNetwork): number {
  let km = 0
  let hours = 0
  for (const period of ['morning', 'evening'] as const) {
    const flow = result.flow[period]
    const share = result.speed[period]
    for (const l of roads.links) {
      const f = flow[l.id] ?? 0
      const s = share[l.id] ?? 0
      if (f <= 0 || s <= 0) continue
      const k = f * l.length
      km += k
      hours += (k * 1000) / (l.speed * s)
    }
  }
  return hours > 0 ? km / hours : 0
}

export function traffic(result: MonthResult, city: CityData): Traffic {
  const t = result.trips
  const all = t.car + t.twoWheeler + t.auto + t.bus + t.metro + t.rail + t.cycle + t.walk
  const clean = t.bus + t.metro + t.rail + t.cycle + t.walk
  return {
    commute: tenth(result.commute / 60),
    speed: tenth(peakSpeed(result, city.roads)),
    access: tenth(result.access / 10),
    clean: all > 0 ? Math.round((clean * 1000) / all) / 10 : 0,
    safety: result.deaths ?? 0,
  }
}

/** The largest items of the books, as causes of a change in money. */
function moneyCauses(entries: Entry[]): Cause[] {
  return [...entries]
    .filter((e) => e.amount !== 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || (a.key < b.key ? -1 : 1))
    .slice(0, 3)
    .map((e) => {
      const what = e.name.charAt(0).toLowerCase() + e.name.slice(1)
      return { text: `${e.amount > 0 ? '+' : ''}${crore(e.amount)}: ${what}`, amount: e.amount / 100 }
    })
}

/** What moved approval, as causes: the largest pressures, in points. */
export function approvalCauses(pressures: Pressure[]): Cause[] {
  return pressures
    .filter((p) => Math.round(p.points * 10) !== 0)
    .slice(0, 3)
    .map((p) => ({ text: `${tenths(p.points, true)} points: ${p.text.charAt(0).toLowerCase()}${p.text.slice(1)}`, amount: p.points }))
}

/**
 * The figures, before and now, without causes from the model: the money's causes are its books, approval's what
 * pushed it (in tenths of a point, `approval`).
 */
export function figures(
  now: MonthResult,
  before: MonthResult | null,
  city: CityData,
  money: [Lakh, Lakh],
  entries: Entry[],
  approval: [number, number] = [550, 550],
  pressures: Pressure[] = [],
): Figure[] {
  const a = traffic(now, city)
  const b = before ? traffic(before, city) : a
  // Road deaths only once the model gives them.
  const keys = now.deaths === undefined ? KEYS.filter((k) => k !== 'safety') : KEYS
  const out: Figure[] = keys.map((key) => ({ key, name: WORDS[key].name, now: a[key], before: b[key], unit: WORDS[key].unit, causes: [] }))
  out.push({ key: 'money', name: 'Money', now: money[1] / 100, before: money[0] / 100, unit: 'crore', causes: moneyCauses(entries) })
  out.push({ key: 'approval', name: 'Approval', now: approval[1] / 10, before: approval[0] / 10, unit: 'of 100', causes: approvalCauses(pressures) })
  return out
}

/** One report for a span of months: figures from the first's before to the last's now, books summed, all the news. */
export function combine(reports: Report[]): Report {
  const first = reports[0]
  const last = reports[reports.length - 1]
  if (!first || !last) throw new Error('There is no month to report.')
  if (reports.length === 1) return last
  const books: Entry[] = []
  for (const r of reports) {
    for (const e of r.books) {
      const kept = books.find((b) => b.key === e.key)
      if (kept) kept.amount += e.amount
      else books.push({ ...e })
    }
  }
  // Approval's causes over the span, and the roads' (slice 6): each cause's points added up over the months.
  const summed = (key: Figure['key']): Pressure[] => {
    const pushed = new Map<string, number>()
    for (const r of reports) {
      for (const c of r.figures.find((f) => f.key === key)?.causes ?? []) {
        const text = c.text.slice(c.text.indexOf(': ') + 2)
        pushed.set(text, (pushed.get(text) ?? 0) + Math.round(c.amount * 10))
      }
    }
    return [...pushed]
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || (a[0] < b[0] ? -1 : 1))
      .map(([text, t]) => ({ text: text.charAt(0).toUpperCase() + text.slice(1), points: t / 10 }))
  }
  const figuresNow = last.figures.map((f) => {
    const before = first.figures.find((g) => g.key === f.key)?.before ?? f.before
    const causes = f.key === 'money' ? moneyCauses(books) : f.key === 'approval' || f.key === 'roads' ? approvalCauses(summed(f.key)) : []
    return { ...f, before, causes }
  })
  const combined: Report = { from: first.from, to: last.to, figures: figuresNow, books, news: reports.flatMap((r) => r.news), needs: last.needs }
  if (last.urgent) combined.urgent = last.urgent
  // Slice 7: the score from the span's start to its end, its money and approval causes over the span; the traffic
  // measures' causes over the span are the model's, found by `explain`: until then, "no measurable change" only where
  // the span moved a measure by less than the noise, and nothing otherwise (never the last month's word).
  const measured = last.measured ? { ...(first.measured?.before ? { before: first.measured.before } : {}), now: last.measured.now } : undefined
  if (measured) combined.measured = measured
  if (first.score && last.score) {
    const approvalCausesNow = approvalCauses(summed('approval'))
    const now = {
      ...last.score.now,
      measures: last.score.now.measures.map((m) => {
        if (m.key === 'approval') return { ...m, causes: approvalCausesNow }
        if (m.key === 'money') return { ...m, causes: spanMoney(reports) }
        const quiet = measured?.before && withinNoise(m.key, measured.now[m.key] - measured.before[m.key])
        return { ...m, causes: quiet ? [NO_CHANGE] : [] }
      }),
    }
    combined.score = { now, before: first.score.before }
  }
  const events = reports.flatMap((r) => r.events ?? [])
  if (events.length) combined.events = [...new Map(events.map((e) => [e.id, e])).values()]
  const review = [...reports].reverse().find((r) => r.review)?.review
  if (review) combined.review = review
  if (last.worstRoads) combined.worstRoads = last.worstRoads
  const flooded = new Map<number, number>()
  for (const r of reports) for (const f of r.flooded ?? []) flooded.set(f.link, (flooded.get(f.link) ?? 0) + f.days)
  if (flooded.size) combined.flooded = [...flooded].sort((a, b) => a[0] - b[0]).map(([link, days]) => ({ link, days }))
  return combined
}

/** Money's causes for the score over a span: each month's causes added up by what they are. */
function spanMoney(reports: Report[]): Cause[] {
  const by = new Map<string, number>()
  for (const r of reports) {
    for (const c of r.score?.now.measures.find((m) => m.key === 'money')?.causes ?? []) {
      const text = c.text.slice(c.text.indexOf(': ') + 2)
      by.set(text, (by.get(text) ?? 0) + Math.round(c.amount * 100))
    }
  }
  return [...by]
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || (a[0] < b[0] ? -1 : 1))
    .slice(0, 3)
    .map(([text, lakh]) => ({ text: `${lakh > 0 ? '+' : ''}${crore(lakh)}: ${text}`, amount: lakh / 100 }))
}

/** What the game stood at when a span of months began, for explaining the span afterwards. */
export interface SpanStart {
  last: MonthResult | null
  inputs: { prices: Prices; people: number; setup?: Setup } | null
  taxRate: number
  taxPeople: number
}

export function spanStart(game: Game): SpanStart {
  return { last: game.last, inputs: game.inputs ?? null, taxRate: game.taxRate, taxPeople: game.taxPeople ?? 0 }
}

type Fared = 'metro' | 'bus' | 'rail'
const PRICE: Record<Fared, 'metroPerKm' | 'busPerKm' | 'railPerKm'> = { metro: 'metroPerKm', bus: 'busPerKm', rail: 'railPerKm' }

/**
 * The report's figures with their causes: each thing that changed over the span (a fare, the growth of the city, the
 * tax rate's part in that growth) is put back as it was in a run of the model, and the difference is its part.
 */
export function explain(game: Game, city: CityData, simulate: Simulate, start: SpanStart, report: Report): Report {
  const now = game.inputs
  const was = start.inputs
  if (!game.last || !now || !was || !start.last) return report
  // Worked out for the month the last traffic was, with one thing put back.
  const month = game.last.month
  const setupNow = now.setup
  const ids = city.zones.map((z) => z.id)
  // Fairness needs each zone's people as the month was worked out for them.
  const baseState = cityState(game, city, now.people, now.prices, setupNow)
  const reference = fairnessReference(game, city)
  const fair = (result: MonthResult, zones: { people: number }[]) => fairness(result, zones.map((z) => z.people), ids, reference) / 10
  const base = { ...traffic(game.last, city), fairness: fair(game.last, baseState.zones) }
  const parts: { what: string; part: Parts }[] = []
  const without = (people: number, prices: Prices, setup = setupNow): Parts => {
    const state = { ...cityState(game, city, people, prices, setup), month }
    const result = simulate(state)
    return { ...traffic(result, city), fairness: fair(result, state.zones) }
  }
  const diff = (t: Parts): Parts => ({
    commute: base.commute - t.commute,
    speed: base.speed - t.speed,
    access: base.access - t.access,
    clean: base.clean - t.clean,
    safety: base.safety - t.safety,
    fairness: base.fairness - t.fairness,
  })

  for (const mode of ['metro', 'bus', 'rail'] as const) {
    const p = paise(now.prices[PRICE[mode]])
    const q = paise(was.prices[PRICE[mode]])
    if (p === q) continue
    const prices = { ...now.prices, [PRICE[mode]]: was.prices[PRICE[mode]] }
    const what = `the ${MODE_NAMES[mode]} fare ${p > q ? 'rising' : 'falling'} to ${perKm(p)}`
    parts.push({ what, part: diff(without(now.people, prices)) })
  }
  if (now.people !== was.people) {
    const all = diff(without(was.people, now.prices))
    const byTax = (game.taxPeople ?? 0) - start.taxPeople
    let taxPart: Parts | null = null
    if (byTax !== 0 && game.taxRate !== start.taxRate) {
      taxPart = diff(without(now.people - byTax, now.prices))
      const what = byTax < 0 ? 'slower growth under the higher property tax' : 'faster growth under the lower property tax'
      parts.push({ what, part: taxPart })
    }
    const grown = now.people - was.people - (taxPart ? byTax : 0)
    const growth: Parts = taxPart
      ? {
        commute: all.commute - taxPart.commute,
        speed: all.speed - taxPart.speed,
        access: all.access - taxPart.access,
        clean: all.clean - taxPart.clean,
        safety: all.safety - taxPart.safety,
        fairness: all.fairness - taxPart.fairness,
      }
      : all
    const share = Math.round((grown * 10_000) / was.people) / 100
    parts.push({ what: `${Math.abs(share)}% ${grown >= 0 ? 'more' : 'fewer'} people`, part: growth })
  }

  // What the season and the building changed: each line opened or closed, the works, the vehicles, the bus lanes; and
  // (slice 7) each event that began or ended.
  if (setupNow && was.setup) {
    for (const change of setupChanges(was.setup, setupNow)) {
      parts.push({ what: change.what, part: diff(without(now.people, now.prices, change.setup)) })
    }
    // Slice 6: the roads and streets the player mended over the span, put back as they were, in a run of the model;
    // the rest of the change in the roads (wear, the monsoon, digging, the budget) by arithmetic, for the commute only.
    const mended = withoutMended(game, setupNow, was.setup, report.from)
    if (mended) parts.push({ what: 'the roads you mended', part: diff(without(now.people, now.prices, mended.setup)) })
    if (setupNow.surface && was.setup.surface) {
      const roads = networkOf(city, setupNow.onRoads)
      const minutes = surfaceMinutes(game.last, roads, was.setup.surface, setupNow.surface, mended?.links ?? new Set())
      if (minutes !== 0) {
        const what = minutes > 0 ? 'the roads wearing' : 'the roads kept up by the budget'
        parts.push({ what, part: { commute: minutes, speed: 0, access: 0, clean: 0, safety: 0, fairness: 0 } })
      }
    }
  }

  const causesOf = (key: TrafficKey | 'fairness', unit: string, noise: number): Cause[] => parts
    .map(({ what, part }) => ({ amount: key === 'safety' ? Math.round(part[key]) : tenth(part[key]), what }))
    // The model's routes move a little with any change to the roads: a part smaller than its noise is left out.
    .filter((c) => c.amount !== 0 && Math.abs(c.amount) >= noise)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || (a.what < b.what ? -1 : 1))
    .slice(0, 3)
    .map((c) => ({ text: `${key === 'safety' ? whole(c.amount) : tenths(c.amount, true)} ${unit} from ${c.what}`, amount: c.amount }))

  const withCauses = report.figures.map((f) => {
    if (f.key === 'money' || f.key === 'approval' || f.key === 'roads') return f
    const key = f.key as TrafficKey
    return { ...f, causes: causesOf(key, WORDS[key].causeUnit, key === 'commute' ? NOISE_MINUTES : 0) }
  })
  const out: Report = { ...report, figures: withCauses }
  // Slice 7 (PRD SCORE-13): each measure of the score with the change in its month's figure over the span and its
  // largest causes, in its own unit; "no measurable change" where the change is within the model's noise.
  if (report.score) {
    const people = baseState.zones.reduce((a, z) => a + z.people, 0)
    const lakh = people / 100_000
    // The noise of each measure, in the units of the causes (safety's in deaths a year, for the city's people now).
    const noiseOf = { access: NOISE.access / 10, commute: NOISE.commute / 60, clean: NOISE.clean / 10, safety: (NOISE.safety * people) / 10_000_000, fairness: NOISE.fairness / 10 }
    // Whether the span moved each measure by more than its noise: from the months' kept figures, over the whole span.
    const from = report.measured?.before
    const to = report.measured?.now
    const measures = report.score.now.measures.map((m) => {
      if (m.key === 'money' || m.key === 'approval') return m
      const noise = noiseOf[m.key]
      if (from && to && withinNoise(m.key, to[m.key] - from[m.key])) return { ...m, causes: [NO_CHANGE] }
      const unit = m.key === 'commute' ? 'min' : m.key === 'safety' ? 'deaths a year' : 'points'
      const causes = causesOf(m.key, unit, noise).map((c) => (m.key === 'safety' ? { ...c, amount: Math.round((c.amount / lakh) * 100) / 100 } : c))
      return { ...m, causes: causes.length ? causes : [{ text: 'Many small changes, none large enough to name', amount: 0 }] }
    })
    out.score = { now: { ...report.score.now, measures }, before: report.score.before }
  }
  return out
}

const lineKey = (l: TransitLine) => `${l.id}:${l.stations.length}`

/**
 * The changes between two setups, each with the setup now as it would be with that one change put back: a line
 * opened (or further opened), a line closed, the works, the vehicles, the bus lanes.
 */
export function setupChanges(was: Setup, now: Setup): { what: string; setup: Setup }[] {
  const out: { what: string; setup: Setup }[] = []
  const before = new Map(was.lines.map((l) => [l.id, l]))
  const after = new Map(now.lines.map((l) => [l.id, l]))
  for (const line of now.lines) {
    const old = before.get(line.id)
    if (old && lineKey(old) === lineKey(line)) continue
    const lines = old ? now.lines.map((l) => (l.id === line.id ? old : l)) : now.lines.filter((l) => l.id !== line.id)
    out.push({ what: line.kind === 'bus' ? `${line.name} starting` : `the ${line.name} opening`, setup: { ...now, lines } })
  }
  for (const line of was.lines) {
    if (after.has(line.id)) continue
    out.push({ what: `closing ${line.kind === 'bus' ? '' : 'the '}${line.name}`, setup: { ...now, lines: [...now.lines, line], stations: [...now.stations, ...was.stations.filter((s) => !now.stations.includes(s))] } })
  }
  if (was.works.join() !== now.works.join()) {
    const what = now.works.length > was.works.length ? 'roads losing lanes to works' : 'lanes given back after works'
    out.push({ what, setup: { ...now, works: was.works } })
  }
  const vk = (v: Record<string, number>) => JSON.stringify(Object.keys(v).sort().map((k) => [k, v[k]]))
  if (vk(was.vehicles) !== vk(now.vehicles)) {
    // Vehicles on lines that were there before; a new line's own are part of its opening.
    const vehicles: Record<string, number> = { ...now.vehicles }
    for (const k of Object.keys(vehicles)) if (before.has(k) || !k.startsWith('player-')) vehicles[k] = was.vehicles[k] ?? 0
    for (const k of Object.keys(vehicles)) if (vehicles[k] === 0 && !k.startsWith('player-')) delete vehicles[k]
    if (vk(vehicles) !== vk(now.vehicles)) out.push({ what: 'the change in buses and trains', setup: { ...now, vehicles } })
  }
  if (was.busLanes.join() !== now.busLanes.join()) out.push({ what: 'the new bus lanes', setup: { ...now, busLanes: was.busLanes } })
  // Slice 9: the roads the monsoon's floods shut, or opened again, so that a month of rain has a cause of its own.
  const shutKey = (x: Setup['shut']) => JSON.stringify(Object.entries(x ?? {}).sort((a, b) => Number(a[0]) - Number(b[0])))
  if (shutKey(was.shut) !== shutKey(now.shut)) {
    const more = Object.keys(now.shut ?? {}).length >= Object.keys(was.shut ?? {}).length
    const setup: Setup = { ...now }
    if (was.shut) setup.shut = was.shut
    else delete setup.shut
    out.push({ what: more ? 'roads shut by the monsoon floods' : 'flooded roads opening again', setup })
  }
  // Slice 7: each event that began, put back by leaving it out; each that ended, by putting it in.
  const evWas = new Map((was.events ?? []).map((e) => [e.id, e]))
  const evNow = new Map((now.events ?? []).map((e) => [e.id, e]))
  for (const e of now.events ?? []) {
    if (!evWas.has(e.id)) out.push({ what: e.what, setup: { ...now, events: (now.events ?? []).filter((x) => x.id !== e.id) } })
  }
  for (const e of was.events ?? []) {
    if (!evNow.has(e.id)) out.push({ what: `the end of ${e.what}`, setup: { ...now, events: [...(now.events ?? []), e].sort((a, b) => a.id - b.id) } })
  }
  // On the roads: each road opened, and the junctions, footpaths, speed limits and one-way streets as a whole.
  const a = was.onRoads
  const b = now.onRoads
  if (a !== b && JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) {
    const empty = { roads: [], junctions: [], footpaths: [], limits: [], oneWay: [] }
    const on = { ...empty, ...b }
    const before = { ...empty, ...a }
    const put = (change: Partial<typeof on>): Setup => ({ ...now, onRoads: { ...on, ...change } })
    const had = new Set(before.roads!.map((r) => r.id))
    for (const r of on.roads!) {
      if (had.has(r.id)) continue
      const where = r.name.slice(r.name.indexOf(', ') + 2)
      out.push({ what: `the ${r.flyover ? 'flyover' : 'new road'} ${where.includes(' to ') ? `from ${where}` : `at ${where}`} opening`, setup: put({ roads: on.roads!.filter((x) => x !== r) }) })
    }
    const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y)
    if (!same(before.junctions, on.junctions)) out.push({ what: 'the work at junctions', setup: put({ junctions: before.junctions }) })
    if (!same(before.footpaths, on.footpaths)) out.push({ what: 'the new footpaths', setup: put({ footpaths: before.footpaths }) })
    if (!same(before.limits, on.limits)) out.push({ what: 'the change in speed limits', setup: put({ limits: before.limits }) })
    if (!same(before.oneWay, on.oneWay)) out.push({ what: 'the change in one-way streets', setup: put({ oneWay: before.oneWay }) })
  }
  return out
}
