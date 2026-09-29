import type { Zone } from '../data/types'
import type { Game, GameEvent, Measure, MeasureKey, Score } from '../rules/types'
import type { MonthResult } from '../sim/types'

/*
 * The screen's side of the score (PRD section 6): what each measure is called, which map view belongs to it, what
 * helps it, and a stand-in score in the agreed shape for as long as the rules have none of their own.
 */

/** The map view that shows a measure, where one does. */
export type MeasureView = 'access' | 'commute' | 'clean' | 'deaths' | 'fairness'

export interface MeasureInfo {
  key: MeasureKey
  name: string
  /** Its share of the score, in thousandths (PRD SCORE-1 to SCORE-7). */
  weight: number
  /** What it is, in a line. */
  what: string
  view: MeasureView | null
  /** What helps it most, and what hurts it (PRD 7.5), in words for the player. */
  helps: string
  hurts: string
}

/** The seven measures in the order the player reads them: the largest share first. */
export const MEASURES: MeasureInfo[] = [
  {
    key: 'access', name: 'Access', weight: 250, view: 'access',
    what: 'Share of the city’s jobs the average person can reach within 45 minutes.',
    helps: 'Metro lines, more trains on the suburban railway, bus routes, taller building near stations.',
    hurts: 'Poor roads and high fares.',
  },
  {
    key: 'commute', name: 'Commute', weight: 200, view: 'commute',
    what: 'The average commute, door to door.',
    helps: 'Metro lines, bus lanes, resurfacing and concrete on busy roads, junction work.',
    hurts: 'Works under way and poor roads.',
  },
  {
    key: 'clean', name: 'Clean travel', weight: 150, view: 'clean',
    what: 'Share of trips by bus, metro, train, cycle or on foot.',
    helps: 'Parking charges, bus routes, footpaths, cheaper fares.',
    hurts: 'New roads and flyovers, which draw more driving; high fares.',
  },
  {
    key: 'safety', name: 'Safety', weight: 100, view: 'deaths',
    what: 'Road deaths a year for each lakh people.',
    helps: 'Footpaths and crossings, speed limits, patching potholes, junction work.',
    hurts: 'Poor roads and fast roads.',
  },
  {
    key: 'fairness', name: 'Fairness', weight: 100, view: 'fairness',
    what: 'How the worst-served fifth of zones fare against the average, in jobs in reach and commute.',
    helps: 'Suburban rail, bus routes to the outer zones, keeping all roads up.',
    hurts: 'Charges and fares with no transit to match.',
  },
  {
    key: 'money', name: 'Money', weight: 100, view: null,
    what: 'Cash less debt, and whether the city ever defaulted.',
    helps: 'Property tax, fares, parking, building rights near stations.',
    hurts: 'Metro lines, roads and concrete, and debt.',
  },
  {
    key: 'approval', name: 'Approval', weight: 100, view: null,
    what: 'What people think of you, each year averaged over the thirty-six months to its December.',
    helps: 'Openings, good roads, shorter commutes.',
    hurts: 'Tax rises, charges, works, poor roads.',
  },
]

export const MEASURE_INFO = Object.fromEntries(MEASURES.map((m) => [m.key, m])) as Record<MeasureKey, MeasureInfo>

/** What a measure adds to the total of 1,000: its points (tenths of 0 to 100) by its weight. */
export function contribution(m: Pick<Measure, 'points' | 'weight'>): number {
  return (m.points * m.weight) / 1000
}

/** A measure's points as the player reads them: 0 to 100, whole. */
export function points(m: Pick<Measure, 'points'>): number {
  return Math.round(m.points / 10)
}

/** The measures of a score in the order the player reads them, whatever order the rules give them in. */
export function ordered(score: Score): Measure[] {
  const at = (k: MeasureKey) => MEASURES.findIndex((m) => m.key === k)
  return [...score.measures].sort((a, b) => at(a.key) - at(b.key))
}

/** Which measure moved the total most between two scores, with its change in points of the total. */
export function movedMost(now: Score, before: Score): { measure: Measure; change: number } | null {
  let best: { measure: Measure; change: number } | null = null
  for (const m of now.measures) {
    const b = before.measures.find((x) => x.key === m.key)
    if (!b) continue
    const change = contribution(m) - contribution(b)
    if (!best || Math.abs(change) > Math.abs(best.change)) best = { measure: m, change }
  }
  return best
}

/** Zones this small say little about how well a place is served. */
const FEW_PEOPLE = 2000

/**
 * How well served each zone is, against the city: its jobs in reach over the city's, and the city's commute over its
 * own, averaged, so that 1 is as the city and less is worse. By zone id; NaN where too few live there to say.
 */
export function servedByZone(zones: Zone[], access: ArrayLike<number>, commute: ArrayLike<number>, people?: number[]): number[] {
  let n = 0, a = 0, c = 0
  for (const z of zones) {
    const p = people?.[z.id] ?? z.people
    if (p < FEW_PEOPLE || !(commute[z.id]! > 0)) continue
    n += p
    a += p * access[z.id]!
    c += p * commute[z.id]!
  }
  const out: number[] = []
  for (const z of zones) {
    const p = people?.[z.id] ?? z.people
    out[z.id] = p < FEW_PEOPLE || !(commute[z.id]! > 0) || !n || !a ? NaN
      : ((access[z.id]! / (a / n)) + ((c / n) / commute[z.id]!)) / 2
  }
  return out
}

/** The worst-served fifth of the zones where enough people live to say (PRD SCORE-5), by zone id. */
export function worstFifth(served: number[]): Set<number> {
  const ids = served.map((s, id) => [id, s] as const).filter(([, s]) => Number.isFinite(s)).sort((x, y) => x[1] - y[1] || x[0] - y[0])
  return new Set(ids.slice(0, Math.ceil(ids.length / 5)).map(([id]) => id))
}

/** Trips by bus, metro, train, cycle or on foot, as a share of all, in per cent. */
export function cleanShare(trips: MonthResult['trips']): number {
  const all = Object.values(trips).reduce((s, n) => s + n, 0)
  const clean = trips.bus + trips.metro + trips.rail + trips.cycle + trips.walk
  return all > 0 ? (clean * 100) / all : 0
}

/**
 * The marks of the stand-in score: the figure that scores 0 and the one that scores 100, set so that the city as it
 * starts scores about 40 on each. Made up, until the season publishes its own (PRD SCORE-15).
 */
const STANDIN_MARKS: Record<MeasureKey, { none: number; full: number; unit: string }> = {
  access: { none: 7.3, full: 25.5, unit: '%' },
  commute: { none: 70, full: 38.75, unit: 'min' },
  clean: { none: 40, full: 70, unit: '%' },
  safety: { none: 10.2, full: 5.5, unit: 'deaths a year per lakh people' },
  fairness: { none: 40.7, full: 97.5, unit: '%' },
  money: { none: 0, full: 5000, unit: 'crore' },
  approval: { none: 30, full: 92.5, unit: 'of 100' },
}

/**
 * A stand-in for the rules' score, in the agreed shape: each measure from the last month worked out, not yet the
 * average of twelve, turned into points against made-up marks. For the screen only, until `rules.score` exists.
 */
export function standInScore(game: Game, zones: Zone[], result: MonthResult | null = game.last): Score {
  const people = zones.reduce((s, z) => s + z.people, 0) * (game.people / 10_000)
  const owed = game.loans.reduce((s, l) => s + l.owed, 0)
  const served = result ? servedByZone(zones, result.accessByZone, result.commuteByZone, game.zonePeople) : []
  const worst = worstFifth(served)
  const fair = worst.size ? ([...worst].reduce((s, id) => s + served[id]!, 0) / worst.size) * 100 : 60
  const value: Record<MeasureKey, number> = {
    access: result ? result.access / 10 : 13.8,
    commute: result ? result.commute / 60 : 57.5,
    clean: result ? cleanShare(result.trips) : 52,
    safety: result?.deaths !== undefined && people > 0 ? (result.deaths * 100_000) / people : 10,
    fairness: fair,
    money: (game.money - owed) / 100,
    approval: (game.approval ?? 550) / 10,
  }
  const measures: Measure[] = MEASURES.map((info) => {
    const mark = STANDIN_MARKS[info.key]
    const share = (value[info.key] - mark.none) / (mark.full - mark.none)
    const pts = Math.round(Math.max(0, Math.min(1, share)) * 1000)
    return { key: info.key, name: info.name, weight: info.weight, value: value[info.key], unit: mark.unit, points: pts, causes: [] }
  })
  return { total: Math.round(measures.reduce((s, m) => s + contribution(m), 0)), measures }
}

/**
 * Made-up events in the agreed shape, for the screen to be built and looked at before the rules bring their own: a
 * festival, a burst main that shuts a road, and a strike. Display only: they change nothing in the city.
 */
export function standInEvents(link: { id: number; at: [number, number] } | null): GameEvent[] {
  const out: GameEvent[] = [
    {
      id: 9001, kind: 'festival', started: 3, ends: 3,
      title: 'Bengaluru Karaga brings the city out',
      text: 'More trips than usual this month, above all in the old city at night.',
      at: [77.5775, 12.9634], zones: [],
    },
    {
      id: 9003, kind: 'strike', started: 8, ends: 8,
      title: 'Bus drivers strike over their hours',
      text: 'The city’s buses run at a fraction of the usual for some days. Their riders go by other ways, or not at all.',
    },
  ]
  if (link) {
    out.splice(1, 0, {
      id: 9002, kind: 'cavein', started: 5, ends: 6,
      title: 'A water main has burst under a main road',
      text: 'The road is shut for two months while it is dug up and mended. Traffic goes round.',
      at: link.at, links: [link.id],
    })
  }
  return out
}

/** Kinds of event that ask for the player's eye when they begin: a card, once. The rest are a line in the news. */
export const NEEDS_EYE = new Set<GameEvent['kind']>(['cavein', 'strike', 'election'])
