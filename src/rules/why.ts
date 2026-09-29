import { linkKmh } from '../sim/index'
import { ROAD } from '../sim/params'
import { delayByRoad } from '../sim/reasons'
import type { MonthResult } from '../sim/types'
import { isShut, linkZones } from './roads'
import { worstServed } from './score'
import { cityState } from './state'
import type { Cause, CityData, Game } from './types'
import { grade, namedRoads, placesOf, speedLoss, stretchName } from './upkeep'
import { grouped } from './words'

/*
 * "Why is this bad?" (PRD SCORE-14), for a zone or a road, from last month's traffic: the figures against the city's,
 * and the largest causes, in plain words and numbers. Worked out on demand; changes nothing. A zone's answer runs the
 * model's routes once (`delayByRoad`, about 50 to 100 ms on the real city); a road's is arithmetic.
 */

export interface Why {
  /** "Why Bellandur is badly served", or, where it is not, "Bellandur, against the city". */
  title: string
  /** The figures, each a short sentence, worst first. */
  lines: string[]
  /** The largest causes, largest first, at most three: for a zone the roads its people lose time on, in hours a weekday; for a road the parts of the time it takes, in seconds a vehicle. */
  causes: Cause[]
  /** Routing links the causes are on, for the map. */
  links: number[]
}

const min = (s: number) => Math.round(s / 6) / 10
const pct = (thousandths: number) => Math.round(thousandths) / 10

/** The state last month's traffic was worked out on. */
function lastState(game: Game, city: CityData) {
  const inputs = game.inputs
  const state = inputs ? cityState(game, city, inputs.people, inputs.prices, inputs.setup) : cityState(game, city)
  return { ...state, month: game.last?.month ?? game.month }
}

/** Why a zone is badly off: its commute, reach, road deaths, roads and approval against the city's, and the roads its people lose time on. */
export function whyZone(game: Game, city: CityData, zoneId: number): Why | null {
  const result = game.last
  const k = city.zones.findIndex((z) => z.id === zoneId)
  const zone = city.zones[k]
  if (!result || !zone) return null
  const state = lastState(game, city)
  const people = state.zones[k]?.people ?? 0
  const lines: string[] = []
  if (people <= 0) return { title: `${zone.name}`, lines: ['No one lives here: it is scored as a place people travel to.'], causes: [], links: [] }
  const commute = result.commuteByZone[zone.id] ?? 0
  lines.push(`The commute from here is ${min(commute)} minutes, door to door, against ${min(result.commute)} for the city.`)
  const access = result.accessByZone[zone.id] ?? 0
  lines.push(`Its people can reach ${pct(access)}% of the city's jobs within 45 minutes, against ${pct(result.access)}% for the city.`)
  if (result.deaths !== undefined && result.deathsByZone) {
    let all = 0
    for (const z of state.zones) all += z.people
    const here = ((result.deathsByZone[zone.id] ?? 0) * 100_000) / people
    const there = (result.deaths * 100_000) / all
    lines.push(`Road deaths here are ${Math.round(here * 10) / 10} a year for each lakh people, against ${Math.round(there * 10) / 10} for the city.`)
  }
  const worst = worstServed(result, game, city)
  if (worst.access.includes(zone.id) || worst.commute.includes(zone.id)) {
    lines.push(`It is among the worst-served fifth of the city's people, by ${worst.access.includes(zone.id) ? (worst.commute.includes(zone.id) ? 'reach and commute' : 'reach') : 'commute'}: this counts in fairness.`)
  }
  const a = game.zoneApproval?.[k]
  if (a !== undefined) lines.push(`Approval here is ${a / 10}, against ${(game.approval ?? 550) / 10} for the city.`)
  // Where its people lose their time: the morning's work trips over the month's routes.
  const named = namedRoads(city)
  const delays = delayByRoad(state, result, zone.id, 'morning', 6)
  const byRoad = new Map<string, { seconds: number; links: number[] }>()
  for (const d of delays) {
    const name = d.link < city.roads.links.length ? named.names[named.road[d.link]!]! : 'a road you built'
    const r = byRoad.get(name) ?? { seconds: 0, links: [] }
    r.seconds += d.seconds
    r.links.push(d.link)
    byRoad.set(name, r)
  }
  const causes = [...byRoad]
    .sort((x, y) => y[1].seconds - x[1].seconds || (x[0] < y[0] ? -1 : 1))
    .slice(0, 3)
    .map(([name, r]) => ({ text: `${grouped(Math.round(r.seconds / 3600))} hours lost each morning by people from here on ${name}`, amount: Math.round(r.seconds / 3600), links: r.links }))
  return {
    title: result.commuteByZone[zone.id]! > result.commute || access < result.access ? `Why ${zone.name} is badly served` : `${zone.name}, against the city`,
    lines,
    causes: causes.map(({ text, amount }) => ({ text, amount })),
    links: causes.flatMap((c) => c.links),
  }
}

/** Why a road is slow: its traffic against what it holds, its surface, its junctions, and what else takes its lanes. */
export function whyRoad(game: Game, city: CityData, linkId: number): Why | null {
  const result: MonthResult | null = game.last
  const state = lastState(game, city)
  const roads = state.roads
  const link = roads.links[linkId]
  if (!result || !link || isShut(link)) return null
  const named = namedRoads(city)
  const name = linkId < city.roads.links.length ? named.names[named.road[linkId]!]! : 'Your new road'
  const where = linkId < city.roads.links.length ? stretchName(roads, [linkId], name.replace(/,.*$/, '')) : name
  // The busier peak.
  const busier = (Number(result.flow.evening[linkId]) || 0) > (Number(result.flow.morning[linkId]) || 0) ? 'evening' : 'morning'
  const flow = Number(result.flow[busier][linkId]) || 0
  const kmh = linkKmh(roads, result, busier, link)
  const lines: string[] = []
  lines.push(`At the ${busier} peak it carries ${grouped(flow)} vehicles an hour, against about ${grouped(Math.round(link.capacity * ROAD.capacityScale))} it can hold.`)
  lines.push(`Traffic moves at ${Math.round(kmh)} km/h, against ${Math.round(link.speed * ROAD.speedScale)} when the road is clear.`)
  const surface = state.surface?.[linkId] ?? 100
  lines.push(`Its surface is ${grade(surface)} (${surface} of 100).`)
  const works = (state.works ?? []).filter((id) => id === linkId).length
  if (works) lines.push(`It has ${works === 1 ? 'a lane' : `${works} lanes`} shut for works.`)
  if ((state.busLanes ?? []).includes(linkId)) lines.push('One lane is kept for buses.')
  if (state.limits?.[linkId]) lines.push(`It has a speed limit of ${state.limits[linkId]} km/h.`)
  if (state.shut?.[linkId]) lines.push(`It was shut for ${Math.round((state.shut[linkId]! * 30) / 1000)} days of the month.`)
  // The seconds a vehicle takes over its length, in parts: at light traffic on a new surface, what the surface adds,
  // what the signals add, and what the traffic adds.
  const clear = (link.length * 3.6) / (link.speed * ROAD.speedScale)
  const loss = speedLoss(surface * 1000 + 500) / 1000
  const bySurface = loss > 0 && loss < 1 ? clear / (1 - loss) - clear : 0
  const bySignals = (link.signals ?? 0) * ROAD.signalDelay
  const actual = kmh > 0 ? (link.length * 3.6) / kmh : clear
  const byTraffic = Math.max(0, actual - clear - bySurface - bySignals)
  const causes: Cause[] = [
    { text: `${Math.round(byTraffic)} seconds a vehicle from more traffic than it holds`, amount: Math.round(byTraffic) },
    { text: `${Math.round(bySurface)} seconds a vehicle from its ${grade(surface)} surface`, amount: Math.round(bySurface) },
    { text: `${Math.round(bySignals)} seconds a vehicle at ${link.signals ?? 0} signal${link.signals === 1 ? '' : 's'}`, amount: Math.round(bySignals) },
  ].filter((c) => c.amount > 0).sort((x, y) => y.amount - x.amount)
  // Which way it runs, for the title: its places.
  const p = placesOf(roads, [linkId])
  const zoneOf = linkZones(city, roads)
  const zone = city.zones.find((z) => z.id === zoneOf[linkId])
  return {
    title: kmh < link.speed * ROAD.speedScale * 0.6 ? `Why ${where} is slow` : `${where}, against the road when clear`,
    lines: [...lines, `It runs ${p.from === p.to ? `near ${p.from}` : `from near ${p.from} towards ${p.to}`}${zone ? `, in ${zone.name}` : ''}.`],
    causes,
    links: [linkId],
  }
}
