import type { Feature, FeatureCollection, LineString, Point } from 'geojson'
import type { ExpressionSpecification, GeoJSONSource, Map as MapLibre } from 'maplibre-gl'
import type { Transit } from '../data/types'
import { BUS_COLOUR } from '../game/build'
import { RIGHT_OFFSET, roomBelow } from './kannada'
import { pairs } from './network'

/** The zooms from which station names are shown, and their Kannada names under them. Whole numbers: a zoom in a
 * filter is read at whole zooms. */
export const STATION_NAMES = { metro: 13, rail: 14, kannada: 13 }
const RING = '#2b2a27'
const RAIL = '#9d968b'
const NAME_SIZE = 11.5

/**
 * A station's name as the map shows it. Long official names end in the place people know the station by, after a
 * comma ("Nadaprabhu Kempegowda Station, Majestic"), so the map gives that part only.
 */
export function shortName(name: string): string {
  if (name in KNOWN_AS) return KNOWN_AS[name]!
  const comma = name.lastIndexOf(', ')
  return comma > 0 ? name.slice(comma + 2) : name
}

/** Stations that people call by a shorter name than the one on the sign. */
const KNOWN_AS: Record<string, string> = {
  'Rashtreeya Vidyalaya Road': 'RV Road',
}

/**
 * Whether two station names are the same place spelt differently: "Nagavara" and "Nagawara", "Whitefield" and
 * "Whitefield (Kadugodi)". Case, a part in brackets, v and w, and doubled or final vowels are set aside.
 */
export function sameName(a: string, b: string): boolean {
  const key = (s: string) => s.replace(/\(.*\)/g, '').toLowerCase().replace(/[^a-z]/g, '').replace(/w/g, 'v')
    .replace(/([aeiou])\1+/g, '$1').replace(/[aeiou]$/, '')
  const x = key(a)
  return x.length > 2 && x === key(b)
}

/** Metres between two points, flat. */
function apart(a: [number, number], b: [number, number]): number {
  const k = Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180))
  return Math.hypot((b[0] - a[0]) * 111_320 * k, (b[1] - a[1]) * 110_540)
}

/** Stations within this many metres that bear the same name are named once. */
export const SAME_PLACE_M = 1000

/** One mark per station, or per interchange where lines meet, in the colour of a line through it. */
export function stationPoints(transit: Transit): FeatureCollection<Point> {
  const lines = new Map<number, Transit['lines']>()
  for (const line of transit.lines) {
    for (const id of line.stations) lines.set(id, [...(lines.get(id) ?? []), line])
  }
  const groups = new Map<string, Transit['stations']>()
  for (const station of transit.stations) {
    const key = station.interchange === undefined ? `s${station.id}` : `i${station.interchange}`
    groups.set(key, [...(groups.get(key) ?? []), station])
  }
  const features: Feature<Point>[] = []
  for (const stations of groups.values()) {
    const through = stations.flatMap((s) => lines.get(s.id) ?? [])
    if (!through.length) continue
    const open = through.filter((l) => l.status === 'open')
    // A metro station and a railway station that make one interchange are named and drawn as the metro's.
    const first = stations.find((s) => s.kind === 'metro') ?? stations[0]!
    const lng = stations.reduce((sum, s) => sum + s.at[0], 0) / stations.length
    const lat = stations.reduce((sum, s) => sum + s.at[1], 0) / stations.length
    const kn = first.nameKn ? shortName(first.nameKn) : null
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: {
        en: shortName(first.name),
        // The Kannada name is shortened the same way only where it has the same shape.
        kn: kn && (first.nameKn === kn) === (shortName(first.name) === first.name) ? kn : null,
        lng,
        lat,
        size: NAME_SIZE,
        side: 'right',
        kind: first.kind,
        station: first.id,
        colour: (open[0] ?? through[0]!).colour,
        open: open.length > 0,
        // An extension shares its line's colour, and is the same line to the rider.
        interchange: new Set(through.map((l) => l.colour)).size > 1,
        // Where open lines already meet, as at Majestic: named even with the whole city in view.
        hub: new Set(open.filter((l) => l.kind === 'metro').map((l) => l.colour)).size > 1,
      },
    })
  }
  // Where two stations near each other bear the same name, only the first in rank is named: a metro station before
  // a railway or bus station, an open one before one being built.
  const rank = (f: Feature<Point>) => {
    const p = f.properties!
    return (p.hub ? 0 : 4) + (p.kind === 'metro' ? 0 : p.kind === 'rail' ? 1 : 2) + (p.open ? 0 : 1)
  }
  const named = [...features].sort((a, b) => rank(a) - rank(b))
  const kept: Feature<Point>[] = []
  for (const f of named) {
    const p = f.properties!
    const twin = kept.find((k) => sameName(k.properties!.en, p.en) &&
      apart(k.geometry.coordinates as [number, number], f.geometry.coordinates as [number, number]) < SAME_PLACE_M)
    if (twin) {
      p.en = ''
      p.kn = null
    } else kept.push(f)
  }
  return { type: 'FeatureCollection', features }
}

/** The tracks of every line, as lines to draw. */
export function linePaths(transit: Transit): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: transit.lines.map((line) => ({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: pairs(line.path),
      },
      properties: { id: line.id, kind: line.kind, status: line.status, colour: line.colour },
    })),
  }
}

/** Draws transit again when lines open, close or are added: the city's, the season's and the player's. */
export function setTransit(map: MapLibre, transit: Transit): void {
  const lines = map.getSource('transit-lines')
  const stations = map.getSource('transit-stations')
  if (lines?.type === 'geojson') (lines as GeoJSONSource).setData(linePaths(transit))
  if (stations?.type === 'geojson') (stations as GeoJSONSource).setData(stationPoints(transit))
}

/**
 * Draws transit: metro in its lines' colours, lines being built dashed, suburban rail thinner and paler, the player's
 * bus routes in the buses' blue-green.
 */
export function addTransit(map: MapLibre, transit: Transit, before?: string): { id: string; from: number }[] {
  map.addSource('transit-lines', { type: 'geojson', data: linePaths(transit) })
  map.addSource('transit-stations', { type: 'geojson', data: stationPoints(transit) })
  const width = (low: number, high: number) => ['interpolate', ['linear'], ['zoom'], 10, low, 15, high] as never
  const metro: ExpressionSpecification = ['==', ['get', 'kind'], 'metro']
  // The player's bus routes, with a white edge as the metro has, so that they stand clear of the roads beneath.
  map.addLayer(
    {
      id: 'transit-bus-casing',
      type: 'line',
      source: 'transit-lines',
      filter: ['==', ['get', 'kind'], 'bus'],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': width(3.4, 7), 'line-opacity': 0.9 },
    },
    before,
  )
  map.addLayer(
    {
      id: 'transit-bus',
      type: 'line',
      source: 'transit-lines',
      filter: ['==', ['get', 'kind'], 'bus'],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': BUS_COLOUR, 'line-width': width(2, 4.2) },
    },
    before,
  )
  map.addLayer(
    {
      id: 'transit-rail',
      type: 'line',
      source: 'transit-lines',
      filter: ['==', ['get', 'kind'], 'rail'],
      layout: { 'line-join': 'round' },
      // One quiet colour for all suburban lines: several run on the same track, and see-through lines would darken.
      paint: { 'line-color': RAIL, 'line-width': width(1, 2.5) },
    },
    before,
  )
  map.addLayer(
    {
      id: 'transit-casing',
      type: 'line',
      source: 'transit-lines',
      filter: ['all', metro, ['==', ['get', 'status'], 'open']],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': width(4, 8) },
    },
    before,
  )
  map.addLayer(
    {
      id: 'transit-building',
      type: 'line',
      source: 'transit-lines',
      filter: ['all', metro, ['!=', ['get', 'status'], 'open']],
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'colour'],
        'line-width': width(1.8, 3.5),
        'line-opacity': 0.8,
        'line-dasharray': [2, 1.5],
      },
    },
    before,
  )
  map.addLayer(
    {
      id: 'transit-metro',
      type: 'line',
      source: 'transit-lines',
      filter: ['all', metro, ['==', ['get', 'status'], 'open']],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'colour'], 'line-width': width(2.4, 5) },
    },
    before,
  )
  const isMetro: ExpressionSpecification = ['==', ['get', 'kind'], 'metro']
  map.addLayer(
    {
      id: 'transit-stations',
      type: 'circle',
      source: 'transit-stations',
      // Suburban stations only close in; metro stations from the city's first view.
      filter: ['any', isMetro, ['>=', ['zoom'], 12]],
      paint: {
        'circle-color': '#ffffff',
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          10, ['case', ['get', 'interchange'], 3.4, isMetro, 2.2, 1.6],
          15, ['case', ['get', 'interchange'], 7.5, isMetro, 5.5, 4],
        ],
        'circle-stroke-color': [
          'case', ['get', 'interchange'], RING, isMetro, ['get', 'colour'], ['==', ['get', 'kind'], 'bus'], BUS_COLOUR, RAIL,
        ],
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 15, 2.4],
        'circle-stroke-opacity': ['case', ['get', 'open'], 1, 0.6],
      },
    },
    before,
  )
  map.addLayer(
    {
      id: 'transit-names',
      type: 'symbol',
      source: 'transit-stations',
      filter: [
        'any',
        ['get', 'hub'],
        ['all', isMetro, ['>=', ['zoom'], STATION_NAMES.metro]],
        ['>=', ['zoom'], STATION_NAMES.rail],
      ],
      layout: {
        ...roomBelow(map, NAME_SIZE),
        'text-field': ['get', 'en'],
        'text-font': ['Noto Sans Medium'],
        'text-size': NAME_SIZE,
        'text-anchor': 'left',
        'text-justify': 'left',
        'text-offset': [RIGHT_OFFSET, 0],
        // One line only: the Kannada name goes under the first.
        'text-max-width': 40,
        'text-padding': 3,
        // Interchanges first, then open stations, when names compete for room.
        'symbol-sort-key': ['case', ['get', 'hub'], 0, ['get', 'interchange'], 1, ['get', 'open'], 2, 3],
      },
      paint: { 'text-color': RING, 'text-halo-color': 'rgba(255, 255, 255, 0.9)', 'text-halo-width': 1.4 },
    },
    before,
  )
  return [{ id: 'transit-names', from: STATION_NAMES.kannada }]
}
