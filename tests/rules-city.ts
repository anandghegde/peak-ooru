import type { CityData, Season } from '../src/rules/types'
import { fixtureCity } from './sim-fixture'

/** The small city of the model's tests, as the rules take it, and a season for it. */
export function smallCity(): CityData {
  const { zones, roads, transit } = fixtureCity()
  return { zones, roads, transit }
}

export const testSeason: Season = { id: 'test', name: 'Test season', seed: 1, money: 200_000, grant: 14_000, months: 120 }
