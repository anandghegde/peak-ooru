import type { Mode, Period, Prices } from './types'

/**
 * Every constant of the model. Sources and reasons are in docs/MODEL.md, constant by constant.
 * Money in rupees, time in minutes unless a name says otherwise.
 */

/** Wards are grouped with their neighbours into this share as many model zones (see zones.ts). */
export const GROUPING = { share: 0.35 }

/**
 * The four parts of the day: effective hours, so that the period's trips over these hours give its busy-hour flow.
 * The evening is shorter than the morning (2.5 against 3): TomTom finds it the slower of the two.
 */
export const HOURS: Record<Period, number> = { morning: 3, midday: 5, evening: 2.5, night: 10 }

export const ROAD = {
  /**
   * Speed falls as flow nears capacity: time = (free + signals) × (1 + alpha × (flow / capacity)^4), up to `most`
   * times capacity, the most a link passes in the busiest hour. Beyond it the rest are held back into the shoulders of
   * the peak (assign.ts, holdBack), at a cost of `queue` minutes each for every further `most` times capacity that
   * would enter: the average wait in a queue that grows through the busiest hour. The flow that would enter a link is
   * first estimated from one root in `holdSample`. Nothing is shown slower than `crawl` km/h.
   */
  alpha: 1.5,
  most: 1.5,
  queue: 20,
  holdSample: 4,
  crawl: 5,
  /**
   * Rupees a km a car pays on a tolled expressway (every motorway in the network), and the rupees an hour a driver
   * choosing a route would pay to save time. A two-wheeler pays `twoWheelerToll` of the car's toll.
   */
  toll: 6,
  tollValue: 200,
  twoWheelerToll: 0.35,
  /**
   * Free speeds in the network are judgement; this scales them all. And this scales the capacity of every link. Both
   * set in slice 6, when the state of the surface came into the model, so that the city with its roads as the season
   * starts (a little under fair: most main roads poor) meets TomTom's speeds as before (docs/MODEL.md, "Slice 6"): the
   * network's speeds and capacities are those of roads in good repair.
   */
  speedScale: 1.2,
  capacityScale: 1.12,
  /**
   * Junctions each zone joins: at least `joins`, one more for each `joinArea` km² up to `mostJoins`, no two closer than
   * `joinApart` of the reach where the roads allow; the least reach in km to look for them; and the speed and detour
   * of the side streets (the speed in good repair: 15 km/h before slice 6, when the streets' state came in).
   */
  joins: 4,
  mostJoins: 8,
  joinArea: 4,
  joinApart: 0.3,
  joinReach: 1.2,
  joinSpeed: 16.5,
  joinDetour: 1.3,
  /**
   * A junction whose roads carry less than `joinStrong` car units an hour (one lane) is taken as `joinWeak` km further
   * off when choosing where a zone joins: its traffic finds the bigger roads (Panathur's tech parks open on the Outer
   * Ring Road, not only on Panathur Main Road).
   */
  joinStrong: 1500,
  joinWeak: 0.5,
  /** Seconds to which link times are rounded for finding routes (the times reported are not rounded). */
  pathUnit: 2,
  /** Seconds lost at a signal at light traffic. */
  signalDelay: 15,
  /** Share of capacity lost for each share of free speed lost to poor repair (PRD ROAD-3). */
  capacityPerSpeedLost: 0.6,
  /** Road space of each vehicle, in passenger-car units. */
  pcu: { car: 1, twoWheeler: 0.4, auto: 0.9, bus: 3.5, goods: 2 },
}

/**
 * How a pair's trips are shared among its near-best ways (slice 7, spread.ts): a way `extra` seconds slower than the
 * quickest takes e^(−theta × extra) as many; ways more than `flat` seconds slower count less and less, and none past
 * `cut`; a link leading less than `near` seconds further from the root counts in proportion.
 * Judgement: a way a minute slower takes a third as many as the quickest.
 */
export const SPREAD = { theta: 1 / 60, flat: 120, cut: 240, near: 2 }

/**
 * The busy periods, worked out in full as midday is: the first guess at demand loaded a root at a time, each root's ways
 * found on the times the roots before it left, brought up to date after every `refresh` roots; the chosen demand then
 * goes onto those ways. The night is loaded on midday's ways. (Slice 7: the rounds of assignment after the first
 * loading are gone; they were never used.)
 */
export const BUSY: Period[] = ['morning', 'evening']
export const ASSIGNMENT = { refresh: 8 }

/**
 * The first guess at passenger-car units a round trip, for work and other trips, before modes are chosen: with the
 * goods traffic, its pattern finds the routes. Its size is then set, for the morning, midday and evening, to `load`
 * passenger-car units an hour for each unit an hour of the network's capacity (what Bengaluru's roads carried in the
 * guess, September 2026), so that the routes do not change with the city's size.
 */
export const GUESS = {
  work: 0.2,
  other: 0.1,
  load: [0.0252, 0.0252, 0.0294],
  /**
   * Car units for each unit of that pattern, by period, at which travellers meet it on the roads: the scale `load`
   * gives it in the city of January 2026. The routes are found at the network's size; the times travellers choose on
   * are the pattern at the month's size on those routes, so that they see the roads fill as the city grows.
   */
  perUnit: [0.8627, 0.6772, 0.8597],
  /**
   * Car units an hour a lane of the city's own roads is taken to carry at capacity, for sizing the guess: Bengaluru's
   * 10,529,700 over its 9,054 lanes of links (slice 5; slice 4 summed capacity itself, so that more room at a junction
   * made the guess heavier and the roads look slower to travellers).
   */
  perLane: 10_529_700 / 9054,
}

export const DEMAND = {
  /**
   * Workers who travel to work on a weekday, for each person living in a zone: 74% of jobs attended on a weekday,
   * over Bengaluru's 7.24 million jobs and 16.45 million people on the map (the same trips as slice 2 for the city as
   * it is; more people now bring more work trips, and the jobs share them out).
   */
  workersPerPerson: 0.3256,
  /** How much more work there is in a person's own zone than distance alone would give. */
  workNearHome: 12,
  otherNearHome: 12,
  /** Other round trips (school, college, shopping, errands, visits) a person makes on a weekday. */
  otherPerPerson: 0.3,
  /** How quickly the pull of a place falls with distance, per km: work and other trips. */
  workDecay: 0.2,
  otherDecay: 0.35,
  /**
   * How quickly it falls, besides, with each minute of a round trip that the roads between the two places are slower
   * than usual (see makeTours; faster than usual, it rises): people take work and errands nearer home as the roads
   * fill, and further as a new road opens. Judgement, set against what is published on induced traffic (MODEL.md).
   */
  delayDecay: 0.003,
  /**
   * The usual: road times at the morning peak and at midday as multiples of their free-flow times, weighted by trips,
   * in the city of January 2026 with its roads as the first season starts them (slice 6; 3.216 and 1.321 before) (`slowRatio` in index.ts gives them for the month in hand). And a shift of the minutes
   * slower than usual, so that none is below nothing (it changes nothing else).
   */
  slow: [2.74, 1.2],
  slowShift: 60,
  /** Round trips fewer than this between a pair of zones are left out, their number spread over the rest of the row. */
  negligible: 0.5,
  /** Other trips are drawn to jobs and to people in this proportion (people stand for schools and shops). */
  otherToPeople: 0.8,
  /** A zone's own trips cover this share of the square root of its area, in km. */
  intraZone: 0.45,
  /** Detour of the roads over a straight line, where a distance has to be guessed. */
  detour: 1.3,
  /** Passenger-car units a day entering or leaving by the main roads at the edge of the map, each way. */
  external: 220_000,
  /** How quickly traffic from beyond the map thins out with distance into it, per km. */
  externalDecay: 0.03,
  /** Share of that which passes straight through. */
  through: 0.2,
  /**
   * Commercial traffic within the city that residents' trips leave out (goods, deliveries, taxis between fares, business
   * trips), in passenger-car units a day for each other round trip, both ways. A calibration term.
   */
  goods: 0.5,
}

/**
 * When each kind of trip travels: the share of outward and return legs in each period.
 * Work: out in the morning, home in the evening. Other: through the day.
 */
export const TIMING = {
  workOut: [0.8, 0.17, 0.03, 0] as const,
  workBack: [0, 0.12, 0.68, 0.2] as const,
  otherOut: [0.25, 0.5, 0.2, 0.05] as const,
  otherBack: [0.05, 0.5, 0.35, 0.1] as const,
  external: [0.2, 0.35, 0.2, 0.25] as const,
  goods: [0.1, 0.5, 0.1, 0.3] as const,
}

export const DEFAULT_PRICES: Omit<Prices, 'parking'> = {
  fuel: 111,
  metroPerKm: 4.5,
  busPerKm: 1.6,
  railPerKm: 0.4,
  leastFare: 10,
}

/** Everything about the ways of travelling. Index by income 1–5 with [income - 1]. */
export const TRAVEL = {
  /** Logit scale: how sharply people choose the cheaper way, per minute of cost. */
  scale: 0.055,
  /** Rupees an hour a traveller would pay to save time, by income. */
  valueOfTime: [45, 80, 130, 210, 340],
  /**
   * How much more a rupee of fare weighs than a rupee of fuel, by mode: a fare is paid in cash at every trip, and riders
   * answer it more sharply than the value of time alone gives. Set so that paying riders answer fares as published
   * short-run figures say, an elasticity of −0.2 to −0.5 (Litman, Transit Price Elasticities and Cross-Elasticities,
   * VTPI). Bus riders are held to their mode more (most have no vehicle), and 55% pay nothing, so the bus needs more.
   */
  fareWeight: { bus: 3, metro: 2, rail: 2 } as Record<'bus' | 'metro' | 'rail', number>,
  /** Chance a traveller has a car, and a two-wheeler, to use that day, by income. */
  hasCar: [0.04, 0.09, 0.17, 0.3, 0.46],
  hasTwoWheeler: [0.34, 0.46, 0.55, 0.55, 0.48],
  /** How much worse a minute of walking and of waiting feels than a minute riding. */
  walkWeight: 1.8,
  waitWeight: 1.8,
  /** How much worse a minute riding each way feels than in a car: comfort. */
  rideWeight: { car: 1, twoWheeler: 1.15, auto: 1.05, bus: 1.25, metro: 1.05, rail: 1.1, cycle: 1.5, walk: 1 } as Record<Mode, number>,
  /**
   * Minutes of bother each leg of a trip carries whatever its length: everything about a mode the rest leaves out
   * (crowding, heat, hassle, habit). Fitted by `tools/calibrate.ts --fit` so that the shares of trips match the
   * published ones, walking held at 0.
   */
  constant: { car: 6.6, twoWheeler: 16.8, auto: 13.1, bus: -31.2, metro: -4.8, rail: 7, cycle: 95.3, walk: 0 } as Record<Mode, number>,
  /** Minutes of felt danger per km, and how much each income minds it (by income). */
  dangerPerKm: { car: 0, twoWheeler: 0.35, auto: 0.05, bus: 0, metro: 0, rail: 0, cycle: 1.2, walk: 0.6 } as Record<Mode, number>,
  dangerDread: [0.6, 0.8, 1, 1.2, 1.4],
  /** Km a litre, and people in each vehicle. */
  carKmPerLitre: 13,
  twoWheelerKmPerLitre: 45,
  carOccupancy: 1.6,
  twoWheelerOccupancy: 1.5,
  autoOccupancy: 1.8,
  /** Autos and cabs run empty between fares: road use per fare. */
  autoEmpty: 1.3,
  /** Auto fare: least, the km it covers, and per km after. */
  autoLeast: 36,
  autoLeastKm: 2,
  autoPerKm: 18,
  /** Minutes to find an auto or cab. */
  autoWait: 5,
  /** Minutes at each end of a drive: parking and walking to the door. By car, by two-wheeler. */
  carEnds: 8,
  twoWheelerEnds: 3,
  /** A two-wheeler loses this share of the delay a car suffers in traffic, by filtering through it. */
  twoWheelerFilter: 0.3,
  /** Minutes of walking or cycling after which each further minute feels twice as bad as the first. */
  tiring: 50,
  /** Km an hour on foot and by cycle. */
  walkSpeed: 4.5,
  cycleSpeed: 13,
  /** Km an hour by car on a zone's own streets in good repair (slice 6: 18 before the streets' state was modelled). */
  localSpeed: 19.8,
}

/** The bus service, which the data does not yet have routes for: a coverage following the main roads. */
export const BUS = {
  /** Seconds added per metre for stops and pulling in and out. */
  stopPerMetre: 0.055,
  /** Minutes of waiting in a city ward and outside the wards. */
  wait: 6,
  outerWait: 12,
  /** Beyond this many km a bus trip usually needs a change, with another wait. */
  changeBeyond: 12,
  /** Metres to walk to a stop, and the share of the zone's spread added to it: stops lie along the main roads. */
  walkBase: 300,
  walkSpread: 0.3,
  /** The most an ordinary bus ticket costs, rupees. */
  mostFare: 32,
  /** Share of riders who pay: women ride free under the Shakti scheme. */
  paying: 0.45,
  /**
   * Slice 7: in a strike, the city's buses come as much less often as there are fewer of them, but the wait counted is
   * at most this many times the usual (those who know the few that run come to them).
   */
  mostSlower: 4,
  /**
   * And the buses that run carry up to this many times their usual riders (fuller, and off the peak): judgement, the
   * city's buses run at about four-fifths of their room on average.
   */
  spare: 1.25,
  /** Riders a bus carries on average, for its road use. */
  load: 37,
  /**
   * The player's bus routes. A route stops about every `stopSpacing` metres, as the city's buses do, and loses
   * `stopPerMetre` to stopping as they do. A route runs every `routeHeadway` minutes when the city gives no number of
   * buses; `routeSpeed` km/h is only for guessing that number before traffic is known.
   */
  stopSpacing: 1000,
  routeHeadway: 10,
  routeSpeed: 15,
}

/** Metro and rail. */
export const TRANSIT = {
  /** Km an hour between stations, stops included. */
  speed: { metro: 32, rail: 35 } as Record<'metro' | 'rail', number>,
  /**
   * Minutes a train or bus stands at each end of its line before going back, for working out how often a line with
   * a given number of vehicles runs (judgement); and the closest headway each system can run at: metro 2 minutes
   * (Namma Metro's newer lines are signalled for 90 seconds), a suburban line 10 (it shares its track), a bus 1.
   */
  turn: { metro: 5, rail: 15, bus: 5 } as Record<'metro' | 'rail' | 'bus', number>,
  leastHeadway: { metro: 2, rail: 10, bus: 1 } as Record<'metro' | 'rail' | 'bus', number>,
  /**
   * Minutes between trains at the peak, by system, and by line where published: Purple 3.3 minutes on its busy central
   * section and 5 beyond (taken as 4), Green 5 (BMRCL via Moneycontrol, 4 Dec 2025); Yellow 6 since 15 Aug 2026, with
   * 13 of its 15 trains in service (The Hindu, 15 Aug 2026). A new metro line (the season's and the player's) runs every
   * 4 minutes by default: BMRCL's aim for every corridor (Moneycontrol, 4 Dec 2025). Rail: judgement (trains every 30 to
   * 90 minutes, closer at the peak).
   */
  headway: { metro: 4, rail: 45 } as Record<'metro' | 'rail', number>,
  lineHeadway: { purple: 4, green: 5, yellow: 6 } as Record<string, number>,
  /**
   * Riders a train carries at crush load: a six-coach Namma Metro train 2,000 (1,580 at its normal load; BMRCL via
   * Deccan Herald, 5 Jul 2024), on every line. A suburban train: judgement (an eight-car MEMU, about 2,500). A 12 m
   * city bus, seated and standing: judgement, 80.
   */
  train: { metro: 2000, rail: 2500, bus: 80 } as Record<'metro' | 'rail' | 'bus', number>,
  lineTrain: {} as Record<string, number>,
  /**
   * Crowding: each minute riding feels up to `crowd` more as trains fill to crush load; beyond it riders are left
   * behind, and each minute costs `refuse` more for each further share of capacity that would board. Judgement.
   */
  crowd: 0.9,
  refuse: 8,
  /** Rounds in which the crowding and the riders it leaves are found together; and those left behind by full trains. */
  crowdRounds: 12,
  boardRounds: 8,
  /** Longest wait counted: people who know the timetable come to the train. */
  mostWait: { metro: 15, rail: 45, bus: 20 } as Record<'metro' | 'rail' | 'bus', number>,
  /** The most a metro or rail fare costs, rupees. */
  mostFare: 90,
  /** Minutes to walk between lines at an interchange. */
  change: 4,
  /** Km of the furthest walk, and the furthest ride by auto or two-wheeler, to a station. */
  walkReach: 2,
  rideReach: 5,
  /**
   * Km an hour and minutes of waiting for the ride to a station, and the share of an auto fare it costs on average:
   * about half ride their own two-wheeler, for little and with no wait, and half take an auto, found in about 5 minutes
   * (`TRAVEL.autoWait`).
   */
  rideSpeed: 12,
  rideWait: 2.5,
  rideFareShare: 0.5,
  /** Stations each zone considers at each end: the nearest on each line, up to this many. */
  choices: 4,
  /** Km from a stop of one of the player's bus routes to a station within which the route feeds it (a short walk). */
  feederWalk: 0.4,
}

/** A job counts toward access if the trip to it takes at most `minutes`, and in part up to `minutes` + `soft`. */
export const ACCESS = { minutes: 45, soft: 5 }

/**
 * Footpaths and crossings in a zone (slice 5, PRD BLD-7), for the share of its people whose streets have them. A
 * minute walking to the bus or a station weighs `walkWeight` rather than `TRAVEL.walkWeight`; a walked trip feels
 * `pleasant` less long and `safer` less dangerous; the walk to a station reaches `reach` times as far. Judgement.
 * `deaths`: the share of people killed on foot that footpaths and crossings save: installing footpaths cuts crashes
 * with people walking along the road by about two thirds (FHWA CMF Clearinghouse, CMF 0.35 to 0.6 for sidewalks) and
 * marked, signalled crossings those crossing it by a quarter to a half; taken together, 40%.
 */
export const FOOT = { walkWeight: 1.5, pleasant: 0.15, safer: 0.5, reach: 1.25, deaths: 0.4 }

/**
 * The state of the roads (slice 6, PRD ROAD-3 to ROAD-5): see surface.ts and docs/MODEL.md, "Slice 6".
 *
 * Speed and capacity lost at a condition of 0 to 100, straight between marks at 100 and at the middle of each grade
 * (fair 62.5, poor 37.5, broken 12.5) and at 0: the PRD's fair −5% speed; poor −20% speed, −10% capacity; broken −40%
 * speed, −25% capacity; carried on to 0 at the same slope. Capacity at fair: judgement (a third of the way to poor's).
 */
export const SURFACE = {
  marks: [100, 62.5, 37.5, 12.5, 0] as const,
  speedLost: [0, 0.05, 0.2, 0.4, 0.5] as const,
  capacityLost: [0, 0.03, 0.1, 0.25, 0.325] as const,
  /** A walk on broken streets loses this share of what a vehicle loses (judgement: puddles, rubble, no footway). */
  walkShare: 0.5,
  /**
   * Share of the traffic from beyond the map, in car units, that is lorries (at `ROAD.pcu.goods` each), for the heavy
   * vehicles that wear the roads: judgement, from classified counts on the national highways into Bengaluru, where
   * goods vehicles are a fifth to a third of the traffic.
   */
  outsideHeavy: 0.3,
  /**
   * Share of the commercial traffic's car units (`DEMAND.goods`: goods, deliveries, taxis between fares) that is lorries
   * and vans (judgement): so that heavy vehicles, with the buses, are about 6–8% of the vehicle-km on the modelled roads,
   * as classified counts on Bengaluru's arterial roads find goods vehicles and buses (CMP 2020, chapter 2).
   */
  goodsHeavy: 0.3,
}

/** Road deaths (slice 5): see safety.ts and docs/MODEL.md. */
export const SAFETY = {
  /** Km walked to and from a station at each end of a trip by metro or rail, on average (judgement). */
  stationWalk: 0.5,
  /** Km/h at which a person on foot struck has an even chance of dying (Tefft 2011). */
  walkSpeed: 68,
  /** Km/h at which the risk to two-wheeler riders, and to everyone else riding, is half its most (calibration shape: judgement). */
  twoWheelerSpeed: 60,
  otherSpeed: 80,
  /**
   * Deaths at a junction's roads after work on it, as a share of before. About half of urban deaths are at junctions
   * (judgement); signals where there were none cut them there by about a third, a redesign (islands, crossings, tighter
   * turns) and lifting the main road over by about half (FHWA CMF Clearinghouse ranges).
   */
  junction: { signal: 0.85, redesign: 0.75, overpass: 0.75 } as Record<'signal' | 'redesign' | 'overpass', number>,
  /** More risk on a road in poor repair, for each share of its free speed lost: two-wheelers most (PRD ROAD-4). */
  repairTwoWheeler: 1,
  repairOther: 0.3,
  /**
   * More risk on a road for each share of free speed its surface costs (slice 6, PRD ROAD-4), two-wheeler riders and
   * everyone else riding; the risk itself is taken at the speed the road would have in good repair (safety.ts). See
   * docs/MODEL.md, "Slice 6", for what is published and how the size was set.
   */
  surfaceTwoWheeler: 1,
  surfaceOther: 0.3,
  /** Cyclists meet traffic as people on foot do, km for km. */
  cycleAsWalk: 1,
  /** Share of walking in each period: morning, midday, evening, night (from the timing of trips). */
  walkTiming: [0.25, 0.35, 0.3, 0.1],
  /**
   * Calibration: deaths a year for each unit of each part, set so that in January 2026 the 369 wards (the city the
   * Bengaluru Traffic Police count) have its 878 deaths of 2025, of them 225 on foot (with about 15 cyclists, 240), 59%
   * two-wheeler riders (its 2023 report), and the rest in cars, autos, buses and lorries. The zones beyond the wards
   * take the same rates (docs/MODEL.md, "Road deaths"). Slice 6: fitted with the roads as the first season starts them
   * (`tools/calibrate.ts --deaths`), since the traffic police counted deaths on the roads as they are.
   */
  perTwoWheelerKm: 515 / 12_354_500,
  perCarUnitKm: 123 / 6_877_300,
  onFoot: 240 / 5_100_600,
}
