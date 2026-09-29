/** A point as [longitude, latitude], in degrees. */
export type LngLat = [number, number]

export type RoadClass = 'motorway' | 'trunk' | 'primary' | 'secondary' | 'tertiary'

/** A junction, or a place where a main road leaves the map. */
export interface NetworkNode {
  id: number
  at: LngLat
  /** True where a road carries on beyond the edge of the map. */
  gateway?: boolean
  signal?: boolean
}

/** A stretch of main road between two junctions. */
export interface NetworkLink {
  id: number
  a: number
  b: number
  /** The line of the road from a to b, as lng, lat, lng, lat… */
  line: number[]
  /** Metres. */
  length: number
  kind: RoadClass
  /** A slip road joining two roads, such as the ramp of a flyover. Absent on ordinary stretches. */
  link?: boolean
  /** Lanes in each direction, or in all if one-way. */
  lanes: number
  /** One-way from a to b. */
  oneway: boolean
  /** Free speed, km/h. */
  speed: number
  name: string | null
  /** 0 on the ground, 1 or more on a flyover, below 0 in an underpass. */
  level: number
}

export interface Network {
  nodes: NetworkNode[]
  links: NetworkLink[]
}

export type TransitKind = 'metro' | 'rail' | 'bus'
export type TransitStatus = 'open' | 'building' | 'planned'

export interface Station {
  id: number
  name: string
  nameKn: string | null
  at: LngLat
  kind: TransitKind
  /** Stations of the same interchange share a number. */
  interchange?: number
}

export interface TransitLine {
  id: string
  name: string
  kind: TransitKind
  colour: string
  status: TransitStatus
  /** Stations in order along the line. */
  stations: number[]
  /** The line of the track, as lng, lat, lng, lat… */
  path: number[]
}

export interface Transit {
  stations: Station[]
  lines: TransitLine[]
}

/** An area of the city that trips start and end in. */
export interface Zone {
  id: number
  name: string
  nameKn: string | null
  /** Where its trips join the main roads. */
  node: number
  centre: LngLat
  /** Square kilometres. */
  area: number
  people: number
  jobs: number
  /** 1 (poorest) to 5 (richest). */
  income: 1 | 2 | 3 | 4 | 5
  /** For a ward of the city, its corporation and its number there. Zones outside the wards have none. */
  ward?: { corporation: string; number: number }
}
