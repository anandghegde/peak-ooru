/**
 * Every amount in the rules. All are game values; docs/RULES.md gives the source or the judgement behind each.
 * Money in whole lakh unless a name says rupees or paise. Rates in hundredths of a percent ("basis points").
 */

/** Days of fares in a month: a weekday's riders times this. Weekends and holidays carry fewer. */
export const FARE_DAYS = 26
/** Days of running in a month: buses and trains run every day. */
export const RUN_DAYS = 30

/** Property tax at the standard rate in the first month, for the people there are then. */
export const TAX_BASE = 16_950

/** Property tax rate, in hundredths of a percent of the standard rate. */
export const TAX = { least: 8000, most: 15_000, step: 100, standard: 10_000 }

/** Fares, in paise a km. The least fare of ₹10 a trip is fixed. */
export const FARES = {
  metro: { least: 200, most: 900, step: 10 },
  bus: { least: 50, most: 400, step: 10 },
  rail: { least: 10, most: 200, step: 10 },
} as const

/**
 * Rises each January: running costs with prices and wages, the value of property that tax is levied on, and the
 * state's grant.
 */
export const YEARLY = { costs: 400, value: 200, grant: 250 }

export const RUNNING = {
  /** Rupees to run a bus a km. */
  busKm: 80,
  /** Passenger-km a bus carries for each km it runs: the fleet grows and shrinks with riders. */
  busLoad: 37,
  /** Rupees to run a metro train a km. */
  metroTrainKm: 950,
  /**
   * Trains each way a day on a metro line, and on the lines named: 18 hours at one and a half times the model's peak
   * headway (5 minutes; Purple 4, Green 5, Yellow 6). A line fuller than its trains carry runs more, in proportion.
   */
  metroTrains: 144,
  lineTrains: { purple: 180, green: 144, yellow: 120 } as Record<string, number>,
  /** Rupees to run a suburban train a km, and trains each way a day on each route. */
  railTrainKm: 300,
  railTrains: 8,
}

export const LOANS = {
  /** Loans come in multiples of ₹100 crore. */
  step: 10_000,
  /** What may be owed in all: this many months of property tax and grant. */
  limitMonths: 12,
  /** The yearly rate: the least, and what is added as what is owed nears the limit. */
  rate: 800,
  rateAtLimit: 400,
  /** Months to repay. */
  months: 60,
}

/**
 * What the tax rate does to the value of property (slice 5): each whole of the rate above the standard takes this many
 * hundredths of a percent a year off its rise (10% above: 1% a year). Judgement, in the direction of tax
 * capitalisation: a dearer property tax is paid out of what property is worth.
 */
export const VALUE = { tax: 1000 }

/** Growth of people, in hundredths of a percent a year. */
export const GROWTH = {
  base: 300,
  /**
   * Taken away for fares above the usual in real terms, per whole of the average of the metro's and the bus's share
   * above (slice 5): fares 10% dear take 0.1% a year off growth (slice 7; 0.3% before), as people and employers go
   * where getting to work costs less. Cheaper fares add nothing. Slice 7 made this and `tax` a quarter as strong:
   * every measure of the score is for each person, so a city that drove people away scored better for it.
   */
  fare: 100,
  /** Added for a commute shorter than the first month's, per whole of it: 10% shorter adds 0.5% a year. */
  commute: 0,
  /** Taken away for a tax rate above the standard, per whole of it: 10% above takes 0.1% a year (slice 7; 0.4% before). */
  tax: 100,
  /** The most the commute can add or take away. */
  commuteMost: 0,
}

/** Months of the next ones looked at to say that money is running low. */
export const LOW_AHEAD = 3
/** Months running with money below nothing that end the game (PRD MONEY-5). */
export const DEFAULT_AFTER = 3

/**
 * Building a metro line. Real costs a km in lakh, 2026 prices: Namma Metro's Phase 3 (44.65 km elevated, ₹15,611 crore,
 * approved August 2024: ₹350 crore a km) and Phase 3A (37.8 km, 14.28 km of it underground, ₹25,999 crore, DPR 2026:
 * about ₹1,250 crore a km underground), each raised 4% a year to 2026. They include stations, trains and depots.
 * The player pays `share` of it (ten-thousandths); the state, the centre and their lenders the rest. A train of six
 * coaches: ₹55 crore (CRRC's 216 coaches for ₹1,578 crore in 2019, raised to 2026).
 */
export const METRO = {
  viaductKm: 38_000,
  tunnelKm: 135_000,
  share: 3000,
  train: 5500,
  /** Months: `base`, and a month more for each `viaductPerMonth` metres of viaduct or `tunnelPerMonth` of tunnel. */
  base: 20,
  viaductPerMonth: 830,
  tunnelPerMonth: 400,
  least: 24,
  most: 40,
  /** Metres: stations no closer; stations put in between those tapped about this far apart; the longest line. */
  apart: 600,
  every: 1300,
  longest: 40_000,
  shortest: 1200,
  /** A road leads the right way when it is at most this much longer than a straight line (thousandths), plus `slack` m. */
  detour: 1350,
  slack: 300,
  /** A line of this many stations or more opens in two stretches: the first half of its stations at half its months. */
  stretchFrom: 4,
  /** Minutes between trains when a line opens, and the least and most. */
  headway: 5,
  /** Trains on a line: at least, and at most one every `busiest` minutes. */
  fewest: 2,
  busiest: 2,
}

/** A bus route. A bus: ₹50 lakh (an 11 m diesel bus, about ₹40–50 lakh); a stop and its shelter: ₹5 lakh. Judgement. */
export const BUS_ROUTE = {
  bus: 50,
  stop: 5,
  months: 1,
  /** Metres: stops about this far apart; the shortest and longest route. */
  every: 1000,
  shortest: 1000,
  longest: 40_000,
  /** Buses on a route. */
  fewest: 1,
  most: 60,
  /** Km a bus runs in a day: BMTC's 12.39 lakh km a day over about 5,600 schedules. */
  kmPerDay: 220,
}

/**
 * Bus lanes: ₹1.7 crore a km of one direction, with bollards, bus bays and signals that favour buses (the city's
 * 2024 plan for 83 km more of them: ₹280 crore, about ₹3.4 crore a km both ways, Bangalore Mirror, February 2024;
 * the first Outer Ring Road lane, paint and bollards only, cost ₹14.3 crore for 17 km in 2022, The Hindu); ₹1 lakh
 * a km a month to keep clear (judgement). A scheme longer than `major` metres is a major action.
 */
export const BUS_LANE = { km: 170, upkeepKm: 1, major: 5000, months: 1, longMonths: 2, long: 10_000 }

/**
 * More trains on a suburban line: works at stations and signals (₹150 crore), and ₹40 crore a train (an eight-car
 * MEMU), the city's share. Judgement, in proportion to K-RIDE's ₹15,767 crore for 148 km of new line (₹106 crore a km).
 * Each train runs `trips` trips each way a day.
 */
export const RAIL_SERVICE = { works: 15_000, train: 4000, months: 18, most: 12, perOrder: 6, trips: 6 }

/** A project cancelled returns this share of what has been paid (ten-thousandths): the rest is lost. */
export const CANCEL_BACK = 5000

/** Major actions (a metro line, more suburban trains, a large bus lane scheme) that may be started in a month. */
export const MAJORS = 3

/**
 * Approval (slice 7: by zone), in tenths of a point, 0 to 1000. Starts at 550 in every zone and each month moves by a
 * twelfth of the way towards where the zone's results put it (`results`), so that a standing push of P tenths a month
 * settles it 1.2 P points from there. Standing pushes each month, in tenths for a whole (100%) of difference: property
 * tax above the standard rate; each fare above the usual in real terms (or below the fare at the start). Roads losing a
 * lane to works: a tenth for each `worksKm` metres of lane lost, everywhere, and a tenth for each `worksLocal` metres in
 * the zone, at most `worksLocalMost`. One-off, in tenths: something opening. All judgement.
 */
export const APPROVAL = {
  start: 550,
  drift: 12,
  tax: 80,
  fare: { metro: 10, bus: 15, rail: 3 },
  worksKm: 8000,
  worksLocal: 250,
  worksLocalMost: 50,
  /**
   * Bus lanes: a tenth a month for each this many vehicle-km an hour driven at the two peaks on the roads that gave a
   * lane, for as long as the lane stands. 5 km both ways on the Outer Ring Road (about 72,000) costs 0.18 a month.
   * A lane on an empty road costs little and gives nothing.
   */
  busLaneDriven: 40_000,
  opens: {
    metro: 40, busRoute: 5, busLane: 3, railService: 20, season: 30,
    'metro-stretch': 20, road: 20, footpaths: 2, 'junction-signal': 1, 'junction-redesign': 2, 'junction-overpass': 15,
  } as Record<string, number>,
  /**
   * Once, when a road on the ground is ordered: a tenth everywhere for each `landPer` lakh of land taken, at most
   * `landMost`; and in the zones it is taken from, a tenth for each `landLocal` lakh, at most `landLocalMost`. Once, for
   * each road made one-way (`oneWay` everywhere, `oneWayLocal` in its zone) and each zone allowed to build taller
   * (`dense`, `denseLocal`). Standing, while speed limits stand: a tenth for each `limitDriven` vehicle-km an hour driven
   * at the two peaks on the roads limited, times the share of their speed the limit takes away.
   */
  landPer: 10_000,
  landMost: 50,
  landLocal: 1000,
  landLocalMost: 300,
  oneWay: 1,
  oneWayLocal: 20,
  dense: 5,
  denseLocal: 50,
  limitDriven: 150_000,
  /**
   * Bus lanes and speed limits are felt in full for `full` months after they are ordered, then less, to `least`
   * thousandths after `over` months more, as drivers get used to them (slice 7).
   */
  fade: { full: 12, over: 24, least: 333 },
  /**
   * How lives changed (slice 7), for each zone against its first month: tenths for each whole of its commute shorter
   * (`commute`), for each whole more of the jobs within 45 minutes (`access`), for each whole of fewer
   * road deaths a person (`deaths`), for each point better of its roads and streets (`roads`); each at most `each`,
   * together at most `up` above and `down` below; counting in full from month `ramp`, in proportion before. `down` is
   * smaller so that a city merely getting worse as it grows does not by itself bring approval under 30: being replaced
   * takes annoying people as well.
   */
  results: { commute: 1500, access: 1000, deaths: 500, roads: 6, each: 300, up: 400, down: 200, ramp: 48 },
  /** In a flooded month: a tenth everywhere for each `floodKmDays` km-days of main road shut; in a zone, a tenth for each `floodLocal` m-days, at most `floodLocalMost`. */
  floodKmDays: 40,
  floodLocal: 2000,
  floodLocalMost: 50,
  /**
   * Once, in the month roads are mended (patched, resurfaced, laid in concrete): a tenth for each `mendedPer` m of road,
   * and (slice 7) for each `mendedStreets` zones' streets, at most `mendedMost`. Slice 6 gave a tenth for each zone's
   * streets, and a standing order to patch at 30 then held approval 12 points up by itself.
   */
  mendedPer: 20_000,
  mendedStreets: 3,
  mendedMost: 10,
  /** Below this at a December review is a warning; this many warnings running and the player is replaced. */
  warning: 300,
  warnings: 2,
}

/** Trips a weekday and their km, used for the books before the first month has been worked out. */
export const FIRST_GUESS = {
  trips: { metro: 870_000, bus: 4_570_000, rail: 104_000 },
  km: { metro: 13.7, bus: 10, rail: 20 },
}

/**
 * Roads and flyovers (slice 5), in lakh at 2026 prices; the city pays all of it. A lane-km is a km of one lane in one
 * direction. On the ground: ₹12 crore a lane-km to build (the Peripheral Ring Road: ₹27,000 crore for 73 km of eight
 * lanes, ₹20,511 crore of it land, so about ₹11 crore a lane-km of works; Bangalore Mirror, 2026), and the land under
 * it: `width` metres a lane each way and `verge` more, at `landBase` rupees a m² and `landDense` more for each person
 * or job a km² in the zone it runs through (judgement: about ₹44,000 a m² at the Peripheral Ring Road's 3,000 a km²,
 * where compensation was ₹15.6 crore an acre, and ₹2.6 lakh a m² in the densest wards). A flyover: ₹25 crore a
 * lane-km (the Ejipura flyover, 2.5 km of four lanes, ₹275 crore, The Hindu, August 2024; the Indiranagar elevated
 * corridor, 11.6 km of four lanes, ₹852 crore of works, NDTV, June 2026), and no land. Months: `base` and one more for
 * each `perMonth` metres, within `least` and `most`. Lengths and snapping in metres.
 */
export const ROAD = {
  laneKm: 1200,
  /** Decimetres of land a lane each way, and more for footpaths and a median. */
  widthDm: 35,
  vergeDm: 70,
  landBase: 20_000,
  landDense: 8,
  /** Rupees a m² at most: the guidance values of the costliest streets, about ₹4 lakh a m² (₹37,000 a sq ft). */
  landMost: 400_000,
  flyoverLaneKm: 2500,
  months: { base: 12, perMonth: 800, least: 12, most: 24 },
  flyoverMonths: { base: 12, perMonth: 300, least: 12, most: 24 },
  shortest: 300,
  longest: 15_000,
  flyoverLongest: 8000,
  /** A tap snaps to the nearest junction within this. */
  reach: 2000,
  /** A road on the ground meets a road it crosses at that road's nearer junction if it is this near the crossing. */
  meet: 400,
  most: 10,
  /** New links: capacity a lane, car units an hour, and free speed, km/h, as the city's roads of their class. */
  capacity: 1290,
  capacityOneLane: 900,
  speed: 50,
  speedOneLane: 40,
  flyoverSpeed: 60,
}

/**
 * Work at a junction. Signals: ₹50 lakh and a month (adaptive signals at 110 junctions for ₹56.45 crore, The Hindu,
 * 2025); the roads into it carry a tenth more, and lose 15 s at each signal at light traffic. A redesign (islands,
 * crossings, turning pockets, with signals): ₹5 crore and 4 months, a quarter more (judgement). An overpass: the main
 * road lifted over the junction for `length` m, `lanes` lanes each way at the flyover's rate, 18 months; the main road
 * through carries `overpass` more and loses its signal there. Capacity factors in thousandths.
 */
export const JUNCTION = {
  signal: { cost: 50, months: 1, capacity: 1100 },
  redesign: { cost: 500, months: 4, capacity: 1250 },
  overpass: { months: 18, capacity: 1600, length: 800, lanes: 2 },
}

/**
 * Footpaths and crossings: ₹1.5 crore a km of footpath, both sides of every main road in the zone (the city's model
 * footpaths cost ₹0.9 to 1.5 crore a km, Deccan Chronicle, June 2016; TenderSURE's whole-street rebuilds ₹15 crore a
 * km, Times of India, November 2017). Months: 2, and one more for each 4 km of footpath, at most 6. Kept at ₹0.5 lakh
 * a km a month (₹5 lakh for ten). The roads there give up a little width: capacity × `capacity` thousandths. Judgement.
 */
export const FOOTPATHS = { km: 150, upkeepTenKm: 5, months: 2, perMonth: 4000, most: 6, capacity: 950 }

/** Speed limits: km/h allowed, and the cost of signs and cameras in a zone (judgement). One-way streets: signs. */
export const LIMITS = { allowed: [30, 40, 50], cost: 10 }
export const ONE_WAY = { cost: 5 }

/**
 * Taller building near stations (PRD POL-2, REV-5): a zone whose centre is within `reach` m of a metro or suburban
 * station (open, being built or ordered). It draws `pull` thousandths more of the city's growth than it would, until it
 * has `most` thousandths of its people at the start; the city sells the right to build taller, ₹`perTenPeople` lakh for
 * each ten people who comes to live there (Karnataka's premium FAR: 50% of the guidance value of the extra notional land,
 * Gazette, March 2025; about ₹1.5 lakh a person at 25 m² a person and guidance values of ₹1 lakh a m², scaled as the
 * game's tax is to the city's). Judgement.
 */
export const DENSITY = { reach: 1000, pull: 3000, most: 1500, perTenPeople: 5 }

/**
 * Growth by zone (PRD CITY-15): each zone's share of the city's growth is its people times a weight, in thousandths:
 * 1000, plus `commute` for each whole of a commute shorter than the city's (a fifth shorter: +200), plus `access` for
 * each whole of the share of jobs within reach above the city's, within `least` and `most`. Judgement.
 */
export const ZONE_GROWTH = { commute: 250, access: 250, least: 250, most: 3000 }

/*
 * Slice 6: the state of the roads. Condition is kept in thousandths of a point (100,000 is new); grades are good from
 * 75, fair from 50, poor from 25, broken under that. docs/RULES.md ("The state of the roads") gives the source or the
 * judgement behind each amount.
 */
export const GRADES = { good: 75, fair: 50, poor: 25 }

/**
 * Where the roads start (PRD ROAD-8), in points: by class of road, less for the outer roads (up to `outer` beyond
 * `outerFrom` km from the centre, reached at `outerTo` km) and for the tech corridors (`corridor`), with a spread by
 * road (±`road`) and by stretch (±`stretch`) from the season's seed; within `least` and `most`. Streets: `streets`,
 * less out of the centre and in poorer zones, more in richer (`income` a step from the middle), ±`zone` by the seed.
 */
export const START = {
  kind: { motorway: 70, trunk: 58, primary: 54, secondary: 51, tertiary: 50 } as Record<string, number>,
  outer: 14,
  outerFrom: 6000,
  outerTo: 22_000,
  corridor: 10,
  road: 12,
  stretch: 8,
  least: 8,
  most: 92,
  streets: 52,
  income: 4,
  zone: 10,
  /** The centre, in millionths of a degree: Vidhana Soudha. */
  centre: [77_590_800, 12_979_300] as const,
  /** Roads through the city's technology parks, whose surfaces are known to be worst (names as mapped). */
  corridors: ['Outer Ring Road', 'Hosur Road', 'Sarjapura Road', 'Sarjapur Road', 'Whitefield Road', 'Whitefield Main Road',
    'Varthur Road', 'Varthur - Sarjapur Road', 'Old Madras Road', 'Bellary Road', 'Bannerghatta Road', 'Bannerghatta Main Road',
    'ITPL Main Road', 'Marathahalli - Sarjapur Outer Ring Road', 'Electronic City Flyover', 'Thanisandra Main Road',
    'Hennur Main Road', 'Kundalahalli Main Road', 'Old Airport Road'],
}

/**
 * Wear, in thousandths of a point a month (PRD ROAD-2). A dry month: `base`, and `traffic` for each 10,000 of load a
 * lane a day, where load is car units a day and `heavy` more for each heavy one (buses and goods vehicles: a road
 * wears with the fourth power of axle weight). Until the model gives vehicles by link, `heavyShare` thousandths of the
 * car units are heavy. Rain: each `rain` mm in the month adds as much again. Poor drains (`poorDrains` thousandths of
 * stretches by the seed, and every low-lying one) wear `drain` thousandths as fast in the rain. Below 50 a road wears
 * faster, up to `worse` thousandths more at 0: potholes grow. A road dug by a utility wears `scar` thousandths as fast
 * for `scarMonths` months. Concrete wears `concrete` thousandths as fast. Streets: `streets` a dry month, `streetsHeavy`
 * more for each whole of the zone's people and jobs a km² over 30,000.
 */
export const WEAR = {
  base: 150,
  traffic: 100,
  heavy: 9,
  heavyShare: 80,
  rain: 100,
  drain: 1500,
  poorDrains: 100,
  worse: 500,
  scar: 1500,
  scarMonths: 12,
  concrete: 250,
  streets: 250,
  streetsBusy: 100,
}

/**
 * Utilities dig (PRD ROAD-2, POL-4): each stretch has `chance` in 10,000 of being dug in a month (`slow` as much for
 * an expressway or concrete, whose services run in ducts), and it drops to `to` points and loses a lane that month.
 * Streets: `streets` in 10,000 of a zone's being dug in a month, losing `streetsLoss` thousandths. With dig once they
 * dig only in `months` (0 is January), the year's digging at once, and put the road back as it was; utilities resent
 * it (`approval` tenths a month off approval) and new connections are slower (`growth` hundredths of a percent a year
 * off growth).
 */
export const DIG = { chance: 80, slow: 250, to: 40_000, streets: 300, streetsLoss: 6000, months: [1, 10], approval: 2, growth: 10 }

/**
 * The monsoon (PRD EVT-1): June to September. Each year of the game takes the rain of June to September of one year
 * from 1996 to 2025, chosen by the season's seed (IMD's monthly rainfall at Bengaluru, OpenCity, 1901-2025): [year,
 * June, July, August, September], mm. Of the low-lying links (the model's list), each floods in a month with a chance in
 * 10,000 of `chance` for each mm of rain above `above`, by the seed: an underpass (`under`) far likelier than another
 * low link (`low`), so that a month of 200 mm floods some 25 links and one of 380 mm some 80. One that floods is shut a
 * day for each `per` mm above `from`, at least one, at most `most`.
 */
export const RAIN: readonly (readonly [number, number, number, number, number])[] = [
  [1996, 228, 51, 303, 276], [1997, 79, 26, 162, 277], [1998, 61, 258, 387, 235], [1999, 76, 114, 95, 164],
  [2000, 92, 116, 277, 209], [2001, 27, 112, 85, 249], [2002, 181, 37, 46, 95], [2003, 86, 96, 139, 44],
  [2004, 76, 210, 65, 187], [2005, 128, 136, 194, 174], [2006, 190, 54, 44, 32], [2007, 57, 154, 146, 224],
  [2008, 59, 182, 247, 106], [2009, 125, 30, 162, 335], [2010, 67, 112, 121, 150], [2011, 58, 93, 278, 111],
  [2012, 7, 67, 189, 68], [2013, 177, 140, 94, 353], [2014, 172, 101, 102, 319], [2015, 85, 94, 110, 190],
  [2016, 191, 209, 83, 33], [2017, 25, 59, 352, 514], [2018, 30, 94, 71, 107], [2019, 58, 94, 143, 211],
  [2020, 115, 158, 76, 300], [2021, 91, 203, 98, 188], [2022, 256, 137, 379, 353], [2023, 72, 142, 13, 248],
  [2024, 205, 93, 230, 24], [2025, 58, 88, 162, 242],
]
export const FLOOD = {
  under: { from: 120, per: 30, most: 10, chance: 25, above: 100 },
  low: { from: 180, per: 60, most: 5, chance: 2, above: 150 },
}

/**
 * Mending (PRD UPK-1 to UPK-3), in lakh a lane-km at 2026 prices. A patch: potholes filled at ₹1,500–1,942 a m²
 * (BBMP, 2024) over about a twentieth of the surface: ₹3 lakh a lane-km; it raises a road to `to` and wears off over
 * `months` months (`monsoon` if done from May to September). Resurfacing: ₹2 crore a km of arterial road of about four
 * lanes (GBA, 550 km for ₹1,100 crore, October 2025): ₹50 lakh a lane-km; a month, and one more for each `perMonth`
 * lane-m, at most `most`; to `to`. Concrete: white-topping at ₹12–16 crore a km (Bangalore Mirror, December 2024) of
 * about five lanes: ₹2.5 crore a lane-km; `base` months and one more for each `perMonth` lane-m, at most `most`. A
 * plan holds at most `links` stretches.
 */
export const REPAIR = {
  patch: { laneKm: 3, to: 62_000, months: 12, monsoon: 6 },
  resurface: { laneKm: 50, to: 90_000, perMonth: 20_000, most: 3 },
  concrete: { laneKm: 250, to: 100_000, base: 6, perMonth: 10_000, most: 12 },
  links: 2000,
}

/**
 * A zone's streets: `perThousand` m of street for each 1,000 people (the GBA's 11,533 km of ward roads, October 2025,
 * over the 1.24 crore people of the wards), each at least `least` m. Patching ₹`patchKm` lakh a km (as the main roads',
 * over a narrower street), resurfacing ₹`resurfaceKm` lakh a km (₹2,000 crore for the city's ward roads, New Indian
 * Express, June 2026), 1 month, or 2 over `long` m.
 */
export const STREETS = { perThousand: 927, least: 5000, patchKm: 2, resurfaceKm: 17, long: 60_000 }

/**
 * The upkeep budget (PRD UPK-4, UPK-13): rupees a month for each lane-km of main road and each km of street, at 2026
 * prices. It slows wear everywhere (`slow`: thousandths of the wear that remains: drains cleared, cracks sealed, small
 * potholes filled as they open) and mends the worst of itself: each month the stretches in the worst repair, worst
 * first, up to `renew` ten-thousandths of the network's lane-km (and `renewStreets` of the streets' length), are brought
 * back to `to`.
 */
export const UPKEEP = {
  laneKm: { bare: 60_000, steady: 120_000, generous: 160_000 } as Record<string, number>,
  streetKm: { bare: 3000, steady: 7000, generous: 9000 } as Record<string, number>,
  slow: { bare: 1000, steady: 750, generous: 550 } as Record<string, number>,
  renew: { bare: 0, steady: 125, generous: 210 } as Record<string, number>,
  renewStreets: { bare: 0, steady: 135, generous: 220 } as Record<string, number>,
  to: 65_000,
}

/** The standing order to patch a zone's potholes: the conditions it may be set at. */
export const ORDER = { least: 10, most: 70 }

/**
 * Running a bus costs more on a poor road (PRD ROAD-5): tyres, springs, breakdowns. Thousandths more for each bus-km on
 * a good, fair, poor and broken road: 2%, 5%, 10% (judgement, B's suggestion).
 */
export const BUS_WEAR = [0, 20, 50, 100] as const

/**
 * The score (slice 7, PRD section 6). Weights in thousandths (PRD SCORE-1 to SCORE-7). Each measure is the average of
 * its last `months` months (PRD SCORE-11), approval of its last `approvalMonths` (SCORE-7). A game that ends by
 * default or by being replaced loses `lost` ten-thousandths of its score (judgement: half).
 */
export const SCORE = {
  weights: { access: 250, commute: 200, clean: 150, safety: 100, fairness: 100, money: 100, approval: 100 } as Record<'access' | 'commute' | 'clean' | 'safety' | 'fairness' | 'money' | 'approval', number>,
  months: 12,
  approvalMonths: 36,
  lost: 5000,
}

/**
 * Below these, a month's change in a measure is the model's noise, not a change (slice 7, from B's fifty small changes
 * to the network, docs/MODEL.md, slice 7, 3: commute 0.2 minutes, access 0.2 points, deaths 3 a year, clean trips 0.05
 * points): the report says "no measurable change" and gives no cause, and a cause smaller than this is left out. In the
 * units of `Measured`: seconds of commute, thousandths of access, clean trips and fairness, deaths a year for each ten
 * million people (3 deaths a year in 1.6 to 2.2 crore people). Fairness was not measured: 3 thousandths, judgement.
 */
export const NOISE = { commute: 12, access: 2, clean: 1, safety: 2, fairness: 3 }

/**
 * Events (slice 7, PRD section 9). None of the season's in the first `quiet` months, and at most `most` of them in force
 * at once, so that a strike makes three at most (EVT-11). Trips in the festival season (each October) and in the month
 * of a big match, thousandths of the usual. Cave-ins and burst mains: `caveins` in the ten years, each shutting a
 * stretch of a named road at least `caveLeast` m long both ways for one to three months. New employers: `employers`, each adding `jobs` (least, most) to a zone for
 * good. Fuel: its price as a share of the usual, thousandths, for some months. Elections: approval (tenths) under `low`
 * cuts the state's grant by `change` ten-thousandths until the next, over `high` raises it. Strikes: a fare that ends a
 * month `rise` thousandths or more of where it began, and the strike's days (least, most); the metro line struck.
 * All judgement.
 */
export const EVENTS = {
  quiet: 3,
  most: 2,
  festival: 1060,
  match: 1030,
  caveins: 6,
  caveLeast: 600,
  employers: 4,
  jobs: [10_000, 30_000],
  fuel: [{ share: 1200, months: 6 }, { share: 900, months: 4 }, { share: 1150, months: 5 }],
  election: { low: 400, high: 600, change: 2000 },
  strike: { rise: 1200, days: [3, 7], line: 'purple' },
}
