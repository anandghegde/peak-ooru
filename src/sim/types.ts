import type { RoadClass, Transit, Zone } from '../data/types'

/**
 * The roads as traffic sees them: a simplified form of the drawn network, small enough to work out a month
 * in a fraction of a second. Each link stands for one or more stretches of the drawn network.
 */
export interface RoutingNode {
  id: number
  /** Longitude and latitude in millionths of a degree, as whole numbers. */
  at: [number, number]
  gateway: boolean
  signal: boolean
  /** Work the player has done at this junction, for road deaths: signals, a redesign, or the main road lifted over. */
  work?: 'signal' | 'redesign' | 'overpass'
}

/** One direction of travel along a road. A two-way road is two links. */
export interface RoutingLink {
  id: number
  from: number
  to: number
  /** Metres, whole. */
  length: number
  kind: RoadClass
  /** Lanes in this direction. */
  lanes: number
  /** Free speed, km/h, whole. */
  speed: number
  /** Vehicles an hour this direction can carry, whole. */
  capacity: number
  /** Signalled junctions along this link, counting the one at its end, for the delay they add at free flow. */
  signals?: number
  /** Ids of the stretches of the drawn network that this link stands for, for showing traffic on the map. */
  drawn: number[]
  /** For each of `drawn`, whether this link runs the way the stretch is drawn (a to b). */
  forward: boolean[]
}

export interface RoutingNetwork {
  nodes: RoutingNode[]
  links: RoutingLink[]
  /** For each zone id, the routing node its trips join the roads at. */
  zoneNode: number[]
}

/** The four parts of a weekday that traffic is worked out for. */
export type Period = 'morning' | 'midday' | 'evening' | 'night'
export const PERIODS: Period[] = ['morning', 'midday', 'evening', 'night']

/** How people travel. */
export type Mode = 'car' | 'twoWheeler' | 'auto' | 'bus' | 'metro' | 'rail' | 'cycle' | 'walk'
export const MODES: Mode[] = ['car', 'twoWheeler', 'auto', 'bus', 'metro', 'rail', 'cycle', 'walk']

/** Everything that decides a month's traffic. The same input gives the same result on every machine. */
export interface CityState {
  /** Months since January 2026. */
  month: number
  seed: number
  zones: Zone[]
  roads: RoutingNetwork
  transit: Transit
  /** Share of free speed each routing link can give, 0 to 1, by link id: 1 unless the road is in poor repair or under works. */
  condition?: number[]
  /** Routing links, by id, on which buses have a lane to themselves: buses run free there, and others lose a lane. */
  busLanes?: number[]
  /**
   * Routing links, by id, that lose a lane to works this month (beneath a metro line being built): a link listed
   * twice loses two. Traffic squeezes past works that take every lane as if by half a lane. Optional (slice 4, B).
   */
  works?: number[]
  /** Vehicles on each transit line, by line id, where it differs from what the line would run by default. */
  vehicles?: Record<string, number>
  /** The condition of each routing link's surface, 0 (broken) to 100 (new), by link id. 100 when omitted. */
  surface?: number[]
  /** The condition of each zone's minor streets, 0 to 100, by zone id: poor streets slow the first and last stretch of every trip. */
  streets?: number[]
  /** Routing links under water or shut this month, by id, with the share of the month each is shut, in thousandths. */
  shut?: Record<number, number>
  /** Zones, by id, with footpaths and crossings laid: walking there is safer and more pleasant. */
  footpaths?: number[]
  /** Speed limits on routing links, km/h, by link id. */
  limits?: Record<number, number>
  /** Trips this month as a share of the usual, in thousandths: 1100 in a month of festivals. 1000 when omitted. */
  surge?: number
  /** The city's own bus service as a share of the usual, in thousandths: 0 in a strike. 1000 when omitted. */
  busService?: number
  /** Rupees. Omitted means the defaults. */
  prices?: Partial<Prices>
  /**
   * Cars and two-wheelers to hand, in thousandths of today's (1000 is as in 2026), for the city as a whole: vehicles
   * grow with income (PRD CITY-15). Omitted means today's.
   */
  ownership?: { car: number; twoWheeler: number }
}

export interface Prices {
  /** Fuel, rupees a litre. */
  fuel: number
  /** Fares, rupees a kilometre, with a least fare. */
  metroPerKm: number
  busPerKm: number
  railPerKm: number
  leastFare: number
  /** Parking, rupees a trip, by zone id; 0 where parking is free. */
  parking: number[]
}

/** What a month's traffic came to. Every number that feeds the score is a whole number or a fixed-point one. */
export interface MonthResult {
  month: number
  /** For each period, for each routing link by id: vehicles an hour, and speed as a share of free speed in thousandths. */
  flow: Record<Period, Int32Array>
  speed: Record<Period, Int16Array>
  /** Door-to-door commute in seconds, averaged over travellers: for the city, and for each zone by id. */
  commute: number
  commuteByZone: Int32Array
  /** Trips a weekday by each mode. */
  trips: Record<Mode, number>
  /** Share of the city's jobs the average resident can reach within 45 minutes, in thousandths. */
  access: number
  accessByZone: Int16Array
  /** Road deaths a year at this month's rate, whole, for the city and by zone. Optional until the model gives it. */
  deaths?: number
  deathsByZone?: Int32Array
  /**
   * Slice 7, optional (added by C for the clean travel view): for each zone by id, the share of trips made by its
   * residents by bus, metro, rail, cycle or on foot, in thousandths.
   */
  cleanByZone?: Int16Array
  /** Riders a weekday on each transit line, by line id. */
  riders: Record<string, number>
  /** Milliseconds the working-out took, for checking speed. Not part of the result proper. */
  took: number
}

/** Works out a month. */
export type Simulate = (state: CityState) => MonthResult
