import type { Zone } from '../data/types'
import type { CityState, Prices } from '../sim/types'
import { DEFAULT_PRICES } from '../sim/params'
import { defaultVehicles, setupOf, transitOf, vehiclesFor } from './lines'
import { div } from './money'
import { limitsOf, networkOf } from './roads'
import type { CityData, Game, Setup } from './types'

/**
 * What decides a month's traffic: the city, with its people and jobs grown by `people` (ten-thousandths of those at
 * the start), at the given prices, with the transit, bus lanes, vehicles and works of `setup`. People and jobs stay
 * whole numbers.
 */
export function cityState(
  game: Game,
  city: CityData,
  people = game.people,
  prices: Prices = game.prices,
  setup: Setup = setupOf(game, city),
): CityState {
  // Each zone's people as they have grown (or, before they grew apart, the city's share), scaled to `people` when a
  // report puts the city's growth back; jobs grow alike everywhere.
  const own = game.zonePeople
  // Slice 7: jobs a new employer has brought, by zone id, from the events of this month and before (for good).
  const added = jobsAdded(setup)
  let zones: Zone[] = people === 10_000 && !own
    ? city.zones
    : city.zones.map((z, k) => ({
      ...z,
      people: own ? (people === game.people ? own[k]! : Math.round((own[k]! * people) / game.people)) : Math.round((z.people * people) / 10_000),
      jobs: Math.round((z.jobs * people) / 10_000),
    }))
  if (added.size) zones = zones.map((z) => (added.has(z.id) ? { ...z, jobs: z.jobs + added.get(z.id)! } : z))
  // People buy vehicles as they grow richer: judgement, 2% more cars and 1.5% more two-wheelers a person each year.
  const ownership = {
    car: 1000 + Math.round((game.month * OWNERSHIP.car) / 12),
    twoWheeler: 1000 + Math.round((game.month * OWNERSHIP.twoWheeler) / 12),
  }
  const transit = transitOf(city, setup)
  const roads = networkOf(city, setup.onRoads)
  const state: CityState = {
    month: game.month,
    seed: game.season.seed,
    zones,
    roads,
    transit,
    prices,
    ownership,
  }
  if (setup.onRoads?.footpaths?.length) state.footpaths = [...setup.onRoads.footpaths].sort((a, b) => a - b)
  const limits = limitsOf(city, roads, setup.onRoads?.limits ?? [])
  if (limits) state.limits = limits
  if (setup.works.length) state.works = setup.works
  if (setup.surface) state.surface = setup.surface
  if (setup.streets) state.streets = setup.streets
  if (setup.shut) state.shut = setup.shut
  if (setup.busLanes.length) state.busLanes = [...setup.busLanes].sort((a, b) => a - b)
  let vehicles = vehiclesFor(transit, setup)
  // Slice 7: the events in force: more trips, the city's buses on strike, fuel dearer or cheaper, roads shut, a line
  // on strike running its trains for a share of the month.
  for (const e of setup.events ?? []) {
    if (e.surge !== undefined) state.surge = div((state.surge ?? 1000) * e.surge, 1000)
    if (e.busService !== undefined) state.busService = Math.min(state.busService ?? 1000, e.busService)
    if (e.fuel !== undefined) state.prices = { ...state.prices, fuel: Math.round(((state.prices?.fuel ?? DEFAULT_PRICES.fuel) * e.fuel) / 10) / 100 }
    if (e.shut?.length) {
      const shut = { ...(state.shut ?? {}) }
      for (const id of e.shut) shut[id] = 1000
      state.shut = shut
    }
    if (e.lines) {
      const line = transit.lines.find((l) => l.id === e.lines!.line && l.status === 'open')
      if (line) {
        const v = vehicles?.[line.id] ?? defaultVehicles(transit, line)
        vehicles = { ...(vehicles ?? {}), [line.id]: div(v * e.lines.share, 1000) }
      }
    }
  }
  if (vehicles) state.vehicles = vehicles
  return state
}

/** Jobs new employers have added, by zone id (slice 7, PRD EVT-3): in `setup.events`, for good. */
function jobsAdded(setup: Setup): Map<number, number> {
  const out = new Map<number, number>()
  for (const e of setup.events ?? []) if (e.jobs) out.set(e.jobs.zone, (out.get(e.jobs.zone) ?? 0) + e.jobs.jobs)
  return out
}

/** Growth in vehicles a person each year, in thousandths of today's. */
const OWNERSHIP = { car: 20, twoWheeler: 15 }

const totals = new WeakMap<Zone[], number>()
/** People in the city now, whole. */
export function peopleNow(game: Game, city: CityData): number {
  if (game.zonePeople) return game.zonePeople.reduce((a, b) => a + b, 0)
  let sum = totals.get(city.zones)
  if (sum === undefined) {
    sum = 0
    for (const z of city.zones) sum += z.people
    totals.set(city.zones, sum)
  }
  return Math.round((sum * game.people) / 10_000)
}
