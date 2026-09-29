import { layers, namedFlavor } from '@protomaps/basemaps'
import type { StyleSpecification } from 'maplibre-gl'

/** The colours of the map: calm and pale, so that traffic and transit stand out when they are drawn on top. */
export const palette = {
  land: '#f3f0ea',
  homes: '#ece8df',
  work: '#efe2dc',
  military: '#e3e6d8',
  park: '#cfe5bb',
  water: '#a8d2e8',
  street: '#ffffff',
  rail: '#a9a39a',
  casing: '#c4bdb0',
  roadMajor: '#fdf6dc',
  roadLead: '#f8e3a6',
  casingLead: '#c9b58c',
  label: '#4a453e',
  halo: 'rgba(243, 240, 234, 0.85)',
}

const flavor = {
  ...namedFlavor('light'),
  background: palette.land,
  earth: palette.land,
  park_a: palette.park,
  park_b: palette.park,
  wood_a: palette.park,
  wood_b: palette.park,
  scrub_a: '#dfe8cf',
  scrub_b: '#dfe8cf',
  hospital: palette.homes,
  school: palette.homes,
  industrial: palette.work,
  aerodrome: palette.military,
  runway: '#d6d9cb',
  military: palette.military,
  zoo: palette.park,
  pedestrian: palette.homes,
  sand: palette.land,
  beach: palette.land,
  water: palette.water,
  buildings: '#e9e4da',
  pier: palette.land,
  other: palette.street,
  minor_service: palette.street,
  minor_a: palette.street,
  minor_b: palette.street,
  link: palette.roadMajor,
  major: palette.roadMajor,
  highway: palette.roadMajor,
  minor_service_casing: palette.land,
  minor_casing: '#e2ddd2',
  link_casing: palette.casing,
  major_casing_early: palette.casing,
  major_casing_late: palette.casing,
  highway_casing_early: palette.casing,
  highway_casing_late: palette.casing,
  bridges_other: palette.street,
  bridges_minor: palette.street,
  bridges_link: palette.roadMajor,
  bridges_major: palette.roadMajor,
  bridges_highway: palette.roadMajor,
  bridges_other_casing: palette.casing,
  bridges_minor_casing: palette.casing,
  bridges_link_casing: '#8e877b',
  bridges_major_casing: '#8e877b',
  bridges_highway_casing: '#8e877b',
  tunnel_other: '#f2efe8',
  tunnel_minor: '#f2efe8',
  tunnel_link: '#f4eed8',
  tunnel_major: '#f4eed8',
  tunnel_highway: '#f4eed8',
  railway: palette.rail,
  boundaries: '#b9b2a6',
  roads_label_minor: '#7d776d',
  roads_label_minor_halo: palette.halo,
  roads_label_major: '#5f5a52',
  roads_label_major_halo: palette.halo,
  subplace_label: palette.label,
  subplace_label_halo: palette.halo,
  city_label: palette.label,
  city_label_halo: palette.halo,
  state_label: '#9a948a',
  state_label_halo: palette.halo,
  country_label: '#9a948a',
  address_label: '#9a948a',
  address_label_halo: palette.halo,
  ocean_label: '#6f98ad',
}

/** The zoom below which the map shows the whole city: main roads by class, minor streets gone, few names. */
export const GLANCE_ZOOM = 12.5

const name = ['coalesce', ['get', 'name:en'], ['get', 'name'], '']
/** The ring roads by name, since parts of the Outer Ring Road are mapped as lesser roads than they are. */
const ringRoad = ['any', ...['Outer Ring Road', 'Outer ring road', 'NICE'].map((n) => ['>=', ['index-of', n, name], 0])]
/** 'bold' for ring roads and highways, else the road's class. */
const highway = ['in', ['get', 'kind_detail'], ['literal', ['trunk', 'motorway']]]
const weight = ['case', ['any', highway, ringRoad], 'bold', ['get', 'kind_detail']]
/** A road width that grows with zoom, by weight, so that the rings and the highways into the city lead the eye. */
const majorWidth = [
  'interpolate', ['exponential', 1.6], ['zoom'],
  9, ['match', weight, 'bold', 1.6, 'primary', 0.6, 'secondary', 0.35, 0.2],
  12, ['match', weight, 'bold', 3, 'primary', 1.6, 'secondary', 1.1, 0.8],
  15, 3, 18, 13,
]
/** Zoomed out, all but the bold roads are pale; they come up to full strength as the streets come in. */
const majorOpacity = [
  'interpolate', ['linear'], ['zoom'],
  10, ['match', weight, 'bold', 1, 'primary', 0.8, 'secondary', 0.5, 0.3],
  13.5, 1,
]
/** Zoomed out, the bold roads are a deeper cream with a firmer edge. */
const majorColour = [
  'interpolate', ['linear'], ['zoom'],
  12, ['match', weight, 'bold', palette.roadLead, palette.roadMajor],
  14, palette.roadMajor,
]
const casingColour = [
  'interpolate', ['linear'], ['zoom'],
  12, ['match', weight, 'bold', palette.casingLead, palette.casing],
  14, palette.casing,
]
/**
 * How the base map draws a main road, by zoom, for the roads the player builds to be drawn the same: fill width,
 * opacity and colour, and the colour of its edge. Each reads the feature's `kind_detail` and name as the tiles give them.
 */
export const MAIN_ROAD = { width: majorWidth, opacity: majorOpacity, colour: majorColour, casing: casingColour }
/** The width of a highway by zoom, as the base map draws it: for flyovers, which carry a main road over others. */
export const HIGHWAY_WIDTH = ['interpolate', ['exponential', 1.6], ['zoom'], 9, 1.6, 12, 3, 15, 5, 18, 15]

/** A name MapLibre can draw: one that starts in a Latin script. Kannada is drawn by the browser instead. */
const latinName = ['<', name, '\u0c80']

type Layer = ReturnType<typeof layers>[number]

/** The base layers' simple old-style filters (["in", key, …] and ["==", key, value]) as expressions, to add to. */
function expression(filter: unknown): unknown {
  const [op, key, ...values] = filter as [string, string, ...unknown[]]
  if (op === 'in') return ['in', ['get', key], ['literal', values]]
  if (op === '==') return ['==', ['get', key], values[0]]
  throw new Error(`No rewrite for the filter ${JSON.stringify(filter)}`)
}

/** Changes to the base layers that make the zoomed-out city read clearly, leaving the zoomed-in map as it was. */
function glance(layer: Layer, known: string[]): Layer | null {
  const l = layer as Layer & { paint: Record<string, unknown>; layout?: Record<string, unknown>; filter?: unknown }
  switch (l.id) {
    case 'roads_major':
      l.paint['line-width'] = majorWidth
      l.paint['line-opacity'] = majorOpacity
      l.paint['line-color'] = majorColour
      break
    case 'roads_highway':
      l.paint['line-color'] = ['interpolate', ['linear'], ['zoom'], 11.5, palette.roadLead, 13.5, palette.roadMajor]
      l.paint['line-width'] = HIGHWAY_WIDTH
      break
    case 'roads_major_casing_early':
      // A thin edge on the main roads only: an edge on every lane of the outskirts is what made the tangle.
      l.paint['line-gap-width'] = majorWidth
      l.paint['line-width'] = 0.6
      l.paint['line-opacity'] = ['match', weight, 'bold', 1, 'primary', 0.6, 0]
      l.paint['line-color'] = casingColour
      break
    case 'roads_major_casing_late':
      l.paint['line-gap-width'] = majorWidth
      l.paint['line-opacity'] = majorOpacity
      l.paint['line-color'] = casingColour
      break
    case 'roads_highway_casing_early':
      l.paint['line-width'] = 0.8
      l.paint['line-color'] = palette.casingLead
      l.paint['line-gap-width'] = ['interpolate', ['exponential', 1.6], ['zoom'], 9, 1.6, 12, 3]
      break
    case 'roads_minor':
    case 'roads_minor_casing':
    case 'roads_minor_service':
    case 'roads_minor_service_casing':
    case 'roads_other':
      // Minor streets come in as the city fills the screen, not before.
      l.paint['line-opacity'] = ['interpolate', ['linear'], ['zoom'], GLANCE_ZOOM - 0.5, 0, GLANCE_ZOOM + 0.5, 1]
      break
    case 'roads_shields':
      l.minzoom = 12
      break
    case 'roads_labels_major':
      l.minzoom = 13
      l.filter = ['all', expression(l.filter), latinName]
      break
    case 'roads_labels_minor':
      l.filter = ['all', expression(l.filter), latinName]
      break
    case 'places_subplace':
      // The browser draws the areas people know, with their Kannada names; the tiles give the rest, close up.
      l.minzoom = 13
      l.paint['text-opacity'] = ['interpolate', ['linear'], ['zoom'], 13, 0, 13.6, 1]
      l.filter = ['all', expression(l.filter), latinName, ['!', ['in', ['get', 'name'], ['literal', known]]]]
      break
    case 'places_locality':
      // Villages at the edge of the map crowd it when zoomed out.
      l.filter = [
        'all', expression(l.filter), latinName,
        ['!', ['in', ['get', 'name'], ['literal', known]]],
        // The city's own name only when zoomed out, the villages' only when zoomed in.
        ['==', ['==', ['get', 'kind_detail'], 'city'], ['<', ['zoom'], 12]],
      ]
      l.paint['text-opacity'] = [
        'interpolate', ['linear'], ['zoom'],
        12, ['case', ['==', ['get', 'kind_detail'], 'city'], 1, 0],
        12.6, 1,
      ]
      break
    case 'roads_tunnels_other_casing':
    case 'roads_tunnels_minor_casing':
    case 'roads_tunnels_link_casing':
    case 'roads_tunnels_major_casing':
    case 'roads_tunnels_highway_casing':
    case 'roads_tunnels_other':
    case 'roads_tunnels_minor':
    case 'roads_tunnels_link':
    case 'roads_tunnels_major':
    case 'roads_tunnels_highway':
      // Underpasses are too short to see further out, and drawing them there costs graphics memory (about 45 MB
      // after panning, measured); screenshots before and after differ by a dozen pixels at most.
      l.minzoom = Math.max(l.minzoom ?? 0, 14)
      break
    case 'pois':
    case 'boundaries':
    case 'boundaries_country':
      return null
  }
  return l
}

/**
 * The style of the base map, drawn from the tiles at `tiles` (a pmtiles address), with fonts from `fonts`.
 * Place names in `known` are left out, since the browser draws those.
 */
export function baseStyle(tiles: string, fonts: string, known: string[] = []): StyleSpecification {
  return {
    version: 8,
    glyphs: `${fonts}{fontstack}/{range}.pbf`,
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${tiles}`,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: layers('protomaps', flavor, { lang: 'en' }).flatMap((layer) => glance(layer, known) ?? []),
  }
}
