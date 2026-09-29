import type { Zone } from './types'

/**
 * Outlines of the zones for drawing: one feature per zone, whose `properties.id` is the zone's id.
 * Built with the figures by tools/build-zones.ts.
 */
export interface ZoneOutlines {
  type: 'FeatureCollection'
  features: {
    type: 'Feature'
    properties: { id: number }
    geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] }
  }[]
}

async function load<T>(file: string, what: string): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/${file}`)
  if (!response.ok) throw new Error(`The ${what} could not be loaded (${response.status}).`)
  return (await response.json()) as T
}

/** Loads the zones' figures from public/data/zones.json. A zone's id is its place in the list. */
export function loadZones(): Promise<Zone[]> {
  return load('zones.json', 'zones')
}

/** Loads the zones' outlines from public/data/zones.geojson. */
export function loadZoneOutlines(): Promise<ZoneOutlines> {
  return load('zones.geojson', 'zone outlines')
}
