import { effectsIn } from './events'
import type { Station, Transit, TransitLine } from '../data/types'
import { defaultVehicles as modelDefault } from '../sim/transit'
import { east, metres, micro, north } from './geo'
import { networkOf, onRoadsOf } from './roads'
import { roadWorks, shutIn, surfaceFor } from './upkeep'
import type { Built, CityData, Game, Season, Setup } from './types'

/*
 * The transit of a month, as the model is given it: the city's own lines, the season's lines as far as they have
 * opened, the player's lines, bus lanes and vehicles, and the links beneath works.
 */

export const emptyBuilt = (): Built => ({ lines: [], stations: [], busLanes: [], vehicles: {} })
export const builtOf = (game: Game): Built => game.built ?? emptyBuilt()

const pathMetres = new WeakMap<number[], number>()
/** Length of a line along its path, in whole metres. */
export function lineLength(line: TransitLine): number {
  let m = pathMetres.get(line.path)
  if (m === undefined) {
    m = 0
    const p = line.path
    for (let i = 2; i + 1 < p.length; i += 2) {
      m += metres(east(micro(p[i - 2]!)), north(micro(p[i - 1]!)), east(micro(p[i]!)), north(micro(p[i + 1]!)))
    }
    pathMetres.set(line.path, m)
  }
  return m
}

/**
 * Minutes a vehicle takes to go to the end of its line and back, turning included, as the model has it: trains at
 * 32 km/h (metro) and 35 km/h (rail), buses at 15 km/h in traffic; turning 5 minutes at each end for a metro train
 * or a bus, 15 for a suburban train.
 */
export function cycleMinutes(lengthM: number, kind: TransitLine['kind']): number {
  const kmh = kind === 'metro' ? 32 : kind === 'rail' ? 35 : 15
  const turn = kind === 'rail' ? 30 : 10
  return Math.round((2 * lengthM * 60) / (kmh * 1000)) + turn
}

/** Vehicles a line runs when nobody has changed them, as the model reckons them: enough for its usual headway. */
export function defaultVehicles(transit: Transit, line: TransitLine): number {
  return modelDefault(transit, line.id)
}

/** The season's lines as far as they are open in `month`: each the first stations of a line being built. */
export function seasonLines(season: Season, city: CityData, month: number): TransitLine[] {
  const open = new Map<string, number>()
  for (const o of season.openings ?? []) {
    if (o.month <= month) open.set(o.line, Math.max(open.get(o.line) ?? 0, o.stations))
  }
  const out: TransitLine[] = []
  for (const line of city.transit.lines) {
    const n = open.get(line.id)
    if (n === undefined || line.status === 'open') continue
    out.push(phase(city.transit, line, n))
  }
  return out
}

const phases = new WeakMap<TransitLine, Map<number, TransitLine>>()
/** The first `n` stations of a line, open, with its path cut at the last of them. */
function phase(transit: Transit, line: TransitLine, n: number): TransitLine {
  let known = phases.get(line)
  if (!known) phases.set(line, (known = new Map()))
  const kept = known.get(n)
  if (kept) return kept
  const count = Math.max(2, Math.min(n, line.stations.length))
  const stations = line.stations.slice(0, count)
  let path = line.path
  if (count < line.stations.length) {
    const at = (id: number) => transit.stations.find((s) => s.id === id)!.at
    const xy = (i: number) => [east(micro(path[2 * i]!)), north(micro(path[2 * i + 1]!))] as const
    const near = (lngLat: readonly number[], i: number) => {
      const [x, y] = xy(i)
      return metres(x, y, east(micro(lngLat[0]!)), north(micro(lngLat[1]!)))
    }
    const points = path.length / 2
    const first = at(stations[0]!)
    // The path may be drawn from either end: start it at the line's first station.
    if (near(first, 0) > near(first, points - 1)) {
      const rev: number[] = []
      for (let i = points - 1; i >= 0; i--) rev.push(path[2 * i]!, path[2 * i + 1]!)
      path = rev
    }
    const last = at(stations[count - 1]!)
    let cut = 0
    for (let i = 1; i < points; i++) if (near(last, i) < near(last, cut)) cut = i
    path = [...path.slice(0, 2 * cut + 2), last[0], last[1]]
  }
  const open: TransitLine = { ...line, status: 'open', stations, path }
  known.set(n, open)
  return open
}

/** What the season and the player have changed for the month the game is in. */
export function setupOf(game: Game, city: CityData): Setup {
  const built = builtOf(game)
  const works: number[] = []
  for (const p of game.projects ?? []) {
    // Beneath a metro viaduct for the first half of the work; at the ends of a road, and along the main road at an
    // overpass, for all of it.
    const whole = p.plan.kind === 'road' || p.plan.kind === 'junction'
    if ((p.plan.kind === 'metro' || whole) && game.month < p.started + (whole ? p.opens - p.started : Math.floor((p.opens - p.started) / 2))) {
      works.push(...p.quote.disrupted)
    }
  }
  // Slice 6: resurfacing and concrete under way take a lane, concrete half the road.
  works.push(...roadWorks(game))
  const setup: Setup = {
    lines: [...seasonLines(game.season, city, game.month), ...built.lines],
    stations: built.stations,
    busLanes: built.busLanes,
    vehicles: built.vehicles,
    works: works.sort((a, b) => a - b),
  }
  if (built.roads?.length || built.junctions?.length || built.footpaths?.length || built.limits?.length || built.oneWay?.length) {
    setup.onRoads = onRoadsOf(built)
  }
  // The state of the roads as the model is given it (slice 6).
  const { surface, streets } = surfaceFor(game, city, networkOf(city, setup.onRoads).links.length)
  setup.surface = surface
  setup.streets = streets
  const shut = shutIn(game, city)
  if (Object.keys(shut).length) setup.shut = shut
  // Slice 7: what the events in force do.
  const events = effectsIn(game, city)
  if (events.length) setup.events = events
  return setup
}

let lastTransit: { city: Transit; lines: TransitLine[]; stations: Station[]; transit: Transit } | null = null
/** The city's transit with the setup's lines open and the player's stations added. */
export function transitOf(city: CityData, setup: Setup): Transit {
  const t = lastTransit
  if (t && t.city === city.transit && same(t.lines, setup.lines) && same(t.stations, setup.stations)) return t.transit
  if (!setup.lines.length && !setup.stations.length) return city.transit
  const byId = new Map(setup.lines.map((l) => [l.id, l]))
  const lines = city.transit.lines.map((l) => byId.get(l.id) ?? l)
  for (const l of setup.lines) if (!city.transit.lines.some((c) => c.id === l.id)) lines.push(l)
  const transit = { stations: [...city.transit.stations, ...setup.stations], lines }
  lastTransit = { city: city.transit, lines: setup.lines, stations: setup.stations, transit }
  return transit
}

const same = <T>(a: T[], b: T[]) => a.length === b.length && a.every((x, i) => x === b[i])

/**
 * Vehicles on each line for the model, where they differ from what the line would run by default: the player's
 * lines as they are; the city's lines their default and what the player added or took away.
 */
export function vehiclesFor(transit: Transit, setup: Setup): Record<string, number> | undefined {
  const keys = Object.keys(setup.vehicles).sort()
  if (!keys.length) return undefined
  const out: Record<string, number> = {}
  for (const id of keys) {
    const line = transit.lines.find((l) => l.id === id)
    if (!line) continue
    out[id] = isPlayers(id) ? setup.vehicles[id]! : defaultVehicles(transit, line) + setup.vehicles[id]!
  }
  return out
}

/** The player's lines have ids of their own. */
export const isPlayers = (lineId: string) => lineId.startsWith('player-')
