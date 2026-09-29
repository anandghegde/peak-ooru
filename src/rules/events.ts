import { DEFAULT_PRICES } from '../sim/params'
import { nearestArea } from './areas'
import { east, north } from './geo'
import { paise } from './money'
import { EVENTS } from './params'
import { isShut } from './roads'
import type { CityData, EventEffect, Game, GameEvent, Season } from './types'
import { mix, nameOf, namedRoads, rainIn } from './upkeep'
import { grouped, monthName } from './words'

/*
 * Events (PRD section 9): what happens to the city that the player did not order. The season's are fixed by its seed
 * and its dates, the same for every player of the season: the monsoon each June to September, the season's lines
 * opening, the festival season each October, a big match, cave-ins and burst mains, new employers, changes in the price
 * of fuel, and the corporation's elections. A strike follows the player's own doing: a fare raised sharply. At most
 * three are in force in any month, and none of the season's in the first three (PRD EVT-11). Each is worked out from
 * the season and the list of actions alone, so when it ends exactly what it did is undone (EVT-12): nothing an event
 * does is kept in the game but the grant an election sets, which lasts until the next.
 */

/** An event, and what it does to the model's month, if anything. */
export interface Planned {
  event: GameEvent
  effect?: Omit<EventEffect, 'id'>
  /** Whether it needs the player's attention when it begins: a skip stops (PRD TIME-4). */
  needs: boolean
}

const at = (lng: number, lat: number): [number, number] => [lng / 1e6, lat / 1e6]
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`

const cache = new WeakMap<Season, WeakMap<object, Planned[]>>()

/** The season's events, in order of the month they begin, then by kind. The same for every player of the season. */
export function seasonEvents(season: Season, city: CityData): Planned[] {
  let bySeason = cache.get(season)
  if (!bySeason) cache.set(season, (bySeason = new WeakMap()))
  const known = bySeason.get(city.roads)
  if (known) return known
  const planned = plan(season, city)
  bySeason.set(city.roads, planned)
  return planned
}

function plan(season: Season, city: CityData): Planned[] {
  const months = season.months
  const fixed: Planned[] = []
  const free: Planned[] = []
  let id = 0
  const next = () => ++id
  // The monsoon, each year (EVT-1): its roads and floods are the rules' already (upkeep.ts); here it is announced.
  for (let y = 0; y * 12 + 5 < months; y++) {
    const from = y * 12 + 5
    const mm = [0, 1, 2, 3].map((k) => rainIn(season, from + k))
    fixed.push({
      event: {
        id: next(), kind: 'monsoon', started: from, ends: Math.min(months - 1, from + 3),
        title: 'The monsoon',
        text: `The rains are here until the end of September: ${mm.join(', ')} mm in June, July, August and September. Roads wear faster, and low-lying ones flood and shut for days.`,
      },
      needs: false,
    })
  }
  // The season's lines opening (EVT-6): announced; the rules open them (build.ts).
  const opened = new Set<string>()
  for (const o of [...(season.openings ?? [])].sort((a, b) => a.month - b.month)) {
    if (o.month >= months) continue
    const line = city.transit.lines.find((l) => l.id === o.line)
    const name = line?.name ?? `The ${o.line} line`
    const further = opened.has(o.line)
    opened.add(o.line)
    const first = line?.stations[0] !== undefined ? city.transit.stations.find((s) => s.id === line.stations[0]) : undefined
    const last = line ? city.transit.stations.find((s) => s.id === line.stations[Math.min(line.stations.length, o.stations) - 1]) : undefined
    fixed.push({
      event: {
        id: next(), kind: 'opening', started: o.month, ends: o.month,
        title: `The ${name.replace(/^The /, '')} opens${further ? ' further' : ''}`,
        text: first && last ? `The ${name.replace(/^The /, '')} runs from ${first.name} to ${last.name} from this month.` : `The ${name.replace(/^The /, '')} opens further this month.`,
        ...(last ? { at: last.at } : {}),
        lines: [o.line],
      },
      needs: false,
    })
  }
  // Elections (EVT-7), on the season's dates.
  for (const m of season.elections ?? []) {
    if (m < EVENTS.quiet || m >= months) continue
    fixed.push({
      event: {
        id: next(), kind: 'election', started: m, ends: m,
        title: 'The corporation elections',
        text: `The city votes for its corporation this month. The new council will ask the state to cut its grant to the city by a fifth if approval is under ${EVENTS.election.low / 10} at the end of ${monthName(m)}, and to raise it by a fifth if it is over ${EVENTS.election.high / 10}.`,
      },
      needs: true,
    })
  }
  // The festival season each October (EVT-4): Dasara and Deepavali, more trips for the month.
  for (let m = 9; m < months; m += 12) {
    fixed.push({
      event: {
        id: next(), kind: 'festival', started: m, ends: m,
        title: 'The festival season',
        text: `Dasara and Deepavali: shopping, visits and outings bring ${(EVENTS.festival - 1000) / 10}% more trips this month.`,
      },
      effect: { what: 'the festival season', surge: EVENTS.festival },
      needs: false,
    })
  }
  // A big match at the stadium, once, on a date by the seed.
  {
    const m = EVENTS.quiet + 12 + (mix(season.seed, 21, 0) % Math.max(1, months - 30))
    free.push({
      event: {
        id: next(), kind: 'festival', started: m, ends: m,
        title: 'A cricket final at Chinnaswamy Stadium',
        text: `A final at the stadium, and the screenings round the city, bring ${(EVENTS.match - 1000) / 10}% more trips this month.`,
        at: at(77_599_300, 12_978_800),
      },
      effect: { what: 'the final at the stadium', surge: EVENTS.match },
      needs: false,
    })
  }
  // Cave-ins and burst mains (EVT-2): a stretch of a main road shut both ways for one to three months.
  const roads = city.roads
  const names = namedRoads(city)
  // Named main roads, not expressways, away from the map's edge, long enough to matter (EVENTS.caveLeast m).
  const named = roads.links.some((l) => nameOf(city, l.id) !== null)
  const candidates = roads.links.filter((l) => !isShut(l) && l.kind !== 'motorway' && l.kind !== 'tertiary' && l.length >= EVENTS.caveLeast &&
    !roads.nodes[l.from]!.gateway && !roads.nodes[l.to]!.gateway && l.from < l.to && (!named || (nameOf(city, l.id) ?? '').endsWith(' Road')))
  for (let k = 0; k < EVENTS.caveins && candidates.length; k++) {
    const link = candidates[mix(season.seed, 22, k) % candidates.length]!
    const back = roads.links.find((l) => l.from === link.to && l.to === link.from)
    const links = back ? [link.id, back.id] : [link.id]
    const long = 1 + (mix(season.seed, 23, k) % 3)
    const m = EVENTS.quiet + (mix(season.seed, 24, k) % Math.max(1, months - EVENTS.quiet - long))
    const a = roads.nodes[link.from]!.at
    const b = roads.nodes[link.to]!.at
    const place = nearestArea(east((a[0] + b[0]) / 2), north((a[1] + b[1]) / 2)).name
    const road = nameOf(city, link.id) ?? names.names[names.road[link.id]!]!.replace(/,.*$/, '')
    const burst = mix(season.seed, 25, k) % 2 === 1
    const what = burst ? 'A water main has burst under' : 'The road has caved in on'
    const where = road.startsWith('Roads ') ? `a main road near ${place}` : `${road} near ${place}`
    free.push({
      event: {
        id: next(), kind: 'cavein', started: m, ends: m + long - 1,
        title: `${what} ${where}`,
        text: `${Math.round(link.length / 100) / 10} km of ${road.startsWith('Roads ') ? 'road' : road} is shut both ways until the end of ${monthName(m + long - 1)}. Traffic goes round.`,
        at: at((a[0] + b[0]) / 2, (a[1] + b[1]) / 2),
        links,
      },
      effect: { what: `${burst ? 'the burst main under' : 'the cave-in on'} ${where}`, shut: links },
      needs: true,
    })
  }
  // New employers (EVT-3): jobs added to a zone for good. Among the zones with the most jobs, by the seed.
  const busy = [...city.zones].filter((z) => z.people > 0 || z.jobs > 0).sort((x, y) => y.jobs - x.jobs || x.id - y.id).slice(0, 80)
  for (let k = 0; k < EVENTS.employers && busy.length; k++) {
    const zone = busy[mix(season.seed, 26, k) % busy.length]!
    const jobs = EVENTS.jobs[0]! + (mix(season.seed, 27, k) % (EVENTS.jobs[1]! - EVENTS.jobs[0]! + 1))
    const rounded = Math.round(jobs / 1000) * 1000
    const m = EVENTS.quiet + (mix(season.seed, 28, k) % Math.max(1, months - EVENTS.quiet - 1))
    const what = ['A technology company opens a campus', 'A bank opens its offices', 'A hospital group opens a medical college', 'A logistics firm opens a hub'][mix(season.seed, 29, k) % 4]!
    const near = nearestArea(east(Math.round(zone.centre[0] * 1e6)), north(Math.round(zone.centre[1] * 1e6)))
    const place = near.metres < 3000 && near.name !== zone.name ? `${zone.name}, near ${near.name}` : zone.name
    free.push({
      event: {
        id: next(), kind: 'employer', started: m, ends: m,
        title: `${what} in ${place}`,
        text: `It brings ${grouped(rounded)} jobs to ${zone.name}, for good. More people will travel there each day.`,
        at: zone.centre,
        zones: [zone.id],
      },
      effect: { what: `new jobs in ${zone.name}`, jobs: { zone: zone.id, jobs: rounded } },
      needs: true,
    })
  }
  // The price of fuel (EVT-5): up or down for some months.
  for (let k = 0; k < EVENTS.fuel.length; k++) {
    const f = EVENTS.fuel[k]!
    const m = EVENTS.quiet + (mix(season.seed, 30, k) % Math.max(1, months - EVENTS.quiet - f.months))
    const up = f.share > 1000
    const pct = Math.abs(f.share - 1000) / 10
    free.push({
      event: {
        id: next(), kind: 'fuel', started: m, ends: m + f.months - 1,
        title: up ? `The price of fuel rises ${pct}%` : `The price of fuel falls ${pct}%`,
        text: `Petrol and diesel cost ${pct}% ${up ? 'more' : 'less'} until the end of ${monthName(m + f.months - 1)}. Driving costs ${up ? 'more, and some will take the bus or the metro' : 'less, and some will drive who took the bus'}.`,
      },
      effect: { what: `fuel ${pct}% ${up ? 'dearer' : 'cheaper'}`, fuel: f.share },
      needs: true,
    })
  }
  // The fixed ones first, then the rest in order of the month the seed gave them; each moved later a month at a time
  // until no more than `EVENTS.most` of the season's are in force in any month of it (a strike may make one more).
  const placed: Planned[] = []
  const count = (m: number) => placed.filter((p) => p.event.started <= m && p.event.ends >= m).length
  for (const p of fixed) placed.push(p)
  free.sort((a, b) => a.event.started - b.event.started || a.event.id - b.event.id)
  for (const p of free) {
    const long = p.event.ends - p.event.started
    let m = p.event.started
    while (m + long < months) {
      let fits = true
      for (let k = m; k <= m + long; k++) if (count(k) >= EVENTS.most) fits = false
      if (fits) break
      m++
    }
    if (m + long >= months) continue
    if (m !== p.event.started) {
      const shift = m - p.event.started
      p.event = { ...p.event, started: m, ends: p.event.ends + shift }
      if (p.event.kind === 'cavein' || p.event.kind === 'fuel') {
        p.event.text = p.event.text.replace(/until the end of [A-Z][a-z]+ \d{4}/, `until the end of ${monthName(p.event.ends)}`)
      }
    }
    placed.push(p)
  }
  placed.sort((a, b) => a.event.started - b.event.started || a.event.id - b.event.id)
  return placed
}

type Fared = 'metro' | 'bus'

/**
 * Strikes (EVT-8), from the list of actions: a month that ends with the bus or metro fare a fifth or more above where
 * it began brings a strike the next month, the city's buses (a bus fare) or the busiest metro line (a metro fare)
 * stopped for three to seven days, by the seed. A strike waits a month if another is on. The player's own doing, so the
 * first three months are not kept free of them.
 */
export function strikes(game: Game): Planned[] {
  const fare: Record<Fared, number> = { metro: paise(DEFAULT_PRICES.metroPerKm), bus: paise(DEFAULT_PRICES.busPerKm) }
  const out: Planned[] = []
  let month = -1
  let begun: Record<Fared, number> = { ...fare }
  const close = () => {
    for (const mode of ['bus', 'metro'] as const) {
      if (fare[mode] * 1000 < begun[mode] * EVENTS.strike.rise) continue
      let m = month + 1
      while (out.some((p) => p.event.started === m)) m++
      if (m >= game.season.months) continue
      const n = EVENTS.strike.days[0]! + (mix(game.season.seed, 31, m, mode === 'bus' ? 0 : 1) % (EVENTS.strike.days[1]! - EVENTS.strike.days[0]! + 1))
      const share = 1000 - Math.round((n * 1000) / 30)
      const rise = Math.round(((fare[mode] - begun[mode]) * 100) / begun[mode])
      out.push({
        event: mode === 'bus'
          ? {
            id: 1000 + out.length, kind: 'strike', started: m, ends: m,
            title: 'The city\'s buses are on strike',
            text: `Bus crews stop work for ${days(n)} after the bus fare rose ${rise}% in ${monthName(month)}. Riders go another way, or stay at home.`,
          }
          : {
            id: 1000 + out.length, kind: 'strike', started: m, ends: m,
            title: 'The Purple Line is on strike',
            text: `Metro staff stop work on the Purple Line for ${days(n)} after the metro fare rose ${rise}% in ${monthName(month)}. Riders go another way.`,
            lines: [EVENTS.strike.line],
          },
        effect: mode === 'bus'
          ? { what: 'the bus strike', busService: share }
          : { what: 'the strike on the Purple Line', lines: { line: EVENTS.strike.line, share } },
        needs: true,
      })
    }
  }
  for (const d of game.done) {
    if (d.month !== month) {
      if (month >= 0) close()
      month = d.month
      begun = { ...fare }
    }
    const a = d.action
    if (a.kind === 'fare' && (a.mode === 'bus' || a.mode === 'metro')) fare[a.mode] = a.perKm
  }
  if (month >= 0) close()
  return out
}

/** Every event of the game so far and to come: the season's, and the strikes the player's actions have brought. */
export function allEvents(game: Game, city: CityData): Planned[] {
  const s = strikes(game)
  return s.length ? [...seasonEvents(game.season, city), ...s].sort((a, b) => a.event.started - b.event.started || a.event.id - b.event.id) : seasonEvents(game.season, city)
}

/** The events in force in a month. */
export function eventsIn(game: Game, city: CityData, month = game.month): Planned[] {
  return allEvents(game, city).filter((p) => p.event.started <= month && p.event.ends >= month)
}

/**
 * What the events in force do to the month's model, in order of id (`Setup.events`); and the jobs of every new
 * employer that has come, which stay for good.
 */
export function effectsIn(game: Game, city: CityData, month = game.month): EventEffect[] {
  return allEvents(game, city)
    .filter((p) => p.effect && p.event.started <= month && (p.event.ends >= month || p.effect.jobs))
    .map((p) => ({ id: p.event.id, ...p.effect! }))
}

/**
 * The election's result, at the end of its month (EVT-7): the state's grant from then until the next, in
 * ten-thousandths of the season's, and the news.
 */
export function electionResult(approval: number): { share: number; news: string } {
  const a = approval / 10
  if (approval < EVENTS.election.low) {
    return { share: 10_000 - EVENTS.election.change, news: `The corporation elections are over. With approval at ${a}, the new council has fallen out with the state, which cuts its grant to the city by a fifth until the next elections.` }
  }
  if (approval > EVENTS.election.high) {
    return { share: 10_000 + EVENTS.election.change, news: `The corporation elections are over. With approval at ${a}, the state backs the city's plans and raises its grant by a fifth until the next elections.` }
  }
  return { share: 10_000, news: `The corporation elections are over. With approval at ${a}, the state keeps its grant to the city as it was.` }
}
