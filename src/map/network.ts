import type { Map as MapLibre } from 'maplibre-gl'
import type { Network, NetworkLink, RoadClass } from '../data/types'

/** Colours of the road classes in the view for checking the network. */
export const CLASS_COLOURS: Record<RoadClass, string> = {
  motorway: '#7b3f98',
  trunk: '#c0492b',
  primary: '#d98c1a',
  secondary: '#3f8f5a',
  tertiary: '#4f86c0',
}
const LAYERS = ['network-links', 'network-gateways', 'network-signals']

/** The roads that show with the whole city in view: primary and above, and the ring roads. */
export function isMain(link: NetworkLink): boolean {
  return link.kind === 'motorway' || link.kind === 'trunk' || link.kind === 'primary' || RING.test(link.name ?? '')
}

/** A line kept as lng, lat, lng, lat… as the points GeoJSON wants. */
export function pairs(flat: number[]): [number, number][] {
  return Array.from({ length: flat.length / 2 }, (_, i) => [flat[i * 2]!, flat[i * 2 + 1]!])
}

/**
 * Draws the main-road network the game reasons about. Each stretch keeps its id, so that its colour can be set
 * from outside (by traffic, later) through feature state: the colours go to the graphics card without the
 * lines being rebuilt.
 */
export class NetworkLayer {
  constructor(private readonly map: MapLibre, readonly network: Network, before?: string) {
    map.addSource('network', {
      type: 'geojson',
      promoteId: 'id',
      data: {
        type: 'FeatureCollection',
        features: network.links.map((link) => ({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: pairs(link.line),
          },
          properties: { id: link.id, kind: link.kind, main: isMain(link) },
        })),
      },
    })
    map.addSource('network-nodes', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: network.nodes
          .filter((n) => n.gateway || n.signal)
          .map((n) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: n.at },
            properties: { gateway: !!n.gateway, signal: !!n.signal },
          })),
      },
    })
    const byClass = ['match', ['get', 'kind'], ...Object.entries(CLASS_COLOURS).flat(), '#888888']
    map.addLayer(
      {
        id: 'network-links',
        type: 'line',
        source: 'network',
        layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['coalesce', ['feature-state', 'colour'], byClass] as never,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 15, 3.5],
        },
      },
      before,
    )
    map.addLayer(
      {
        id: 'network-signals',
        type: 'circle',
        source: 'network-nodes',
        filter: ['get', 'signal'],
        minzoom: 12,
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 1.8, 16, 3.5],
          'circle-color': '#26231f',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 0.8,
        },
      },
      before,
    )
    map.addLayer(
      {
        id: 'network-gateways',
        type: 'circle',
        source: 'network-nodes',
        filter: ['get', 'gateway'],
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': 6,
          'circle-color': '#ffffff',
          'circle-stroke-color': '#26231f',
          'circle-stroke-width': 2.4,
        },
      },
      before,
    )
  }

  /** Shows or hides the network. */
  show(visible: boolean): void {
    for (const id of LAYERS) this.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
  }

  /** Colours each stretch in `colours` (by link id), or back to its class colour where the colour is null. */
  paint(colours: Map<number, string | null>): void {
    for (const [id, colour] of colours) this.map.setFeatureState({ source: 'network', id }, { colour })
  }
}

/** The ring roads by name: the shape people know the city by. */
export const RING = /^(outer ring road|nice (road|expressway)|satellite town ring road)/i

/**
 * The ring roads drawn boldly over the base map when zoomed out, from the network, since the base map's zoomed-out
 * tiles lose some of their names and classes. They hand over to the base map's own roads as the map zooms in.
 */
export function addRingRoads(map: MapLibre, network: Network, colour: string, edge: string, before?: string): void {
  map.addSource('rings', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: network.links
        .filter((l) => l.name && RING.test(l.name))
        .map((l) => ({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: pairs(l.line),
          },
          properties: {},
        })),
    },
  })
  const width = ['interpolate', ['exponential', 1.6], ['zoom'], 9, 1.6, 12, 3] as never
  const opacity = ['interpolate', ['linear'], ['zoom'], 12.5, 1, 13.5, 0] as never
  map.addLayer(
    {
      id: 'rings-casing',
      type: 'line',
      source: 'rings',
      maxzoom: 13.5,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': edge, 'line-gap-width': width, 'line-width': 0.8, 'line-opacity': opacity },
    },
    before,
  )
  map.addLayer(
    {
      id: 'rings',
      type: 'line',
      source: 'rings',
      maxzoom: 13.5,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': colour, 'line-width': width, 'line-opacity': opacity },
    },
    before,
  )
}
