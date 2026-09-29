import type { Season } from '../rules/types'
import { firstSeason } from './first'

/**
 * Slice 8: the first season as the server will set it when the game goes to other players: the same city, events,
 * money, marks and weights of the years, with the daily allowance on (PRD TIME-7: 12 months a day, carrying over to 36,
 * kept by the server's clock). Everything that decides a score is the first season's, so a game scores the same under
 * either; only how fast it may be played differs. Its own id, so that the two are never taken for one another.
 */
export const openSeason: Season = { ...firstSeason, id: 'first-open', allowance: true }
