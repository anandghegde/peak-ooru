import type { GeoJSONSource, Map as MapLibre } from 'maplibre-gl'
import type { GameEvent } from '../rules/types'

/** A road shut by an event: drawn in the ink of the map's names, broken, over a pale casing. */
export const SHUT_COLOUR = '#3b3631'

/**
 * Events on the map (PRD EVT-10): a quiet pin where an event has a place, named close in, and roads an event shuts
 * drawn shut. Weather, not alarms: a white pin with a dark ring, like the stations.
 */
export class EventLayer {
  constructor(private readonly map: MapLibre, before?: string) {
    map.addSource('events', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addSource('events-shut', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({
      id: 'events-shut-casing', type: 'line', source: 'events-shut',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#fffdf9', 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 10, 4, 14, 8, 18, 20] },
    }, before)
    map.addLayer({
      id: 'events-shut', type: 'line', source: 'events-shut',
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': SHUT_COLOUR,
        'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 10, 2, 14, 4, 18, 10],
        'line-dasharray': [1.2, 1],
      },
    }, before)
    map.addLayer({
      id: 'events-pin', type: 'circle', source: 'events',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 5, 14, 8],
        'circle-color': '#fffdf9',
        'circle-stroke-color': SHUT_COLOUR,
        'circle-stroke-width': 2,
      },
    })
    map.addLayer({
      id: 'events-dot', type: 'circle', source: 'events',
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 1.8, 14, 3], 'circle-color': SHUT_COLOUR },
    })
    map.addLayer({
      id: 'events-name', type: 'symbol', source: 'events',
      minzoom: 11,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Medium'],
        'text-size': 12,
        'text-anchor': 'top',
        'text-offset': [0, 0.9],
        'text-max-width': 12,
        'text-optional': true,
      },
      paint: { 'text-color': SHUT_COLOUR, 'text-halo-color': '#fffdf9', 'text-halo-width': 1.6 },
    })
  }

  /** Shows the events in force: a pin for each with a place, and the lines of the roads they shut. */
  show(events: GameEvent[], shut: number[][]): void {
    const pins = events.filter((e) => e.at).map((e) => ({
      type: 'Feature' as const,
      properties: { id: e.id, name: PIN_NAMES[e.kind] ?? short(e.title) },
      geometry: { type: 'Point' as const, coordinates: e.at! },
    }))
    const lines = shut.filter((l) => l.length >= 4).map((l) => ({
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: Array.from({ length: l.length / 2 }, (_, i) => [l[i * 2]!, l[i * 2 + 1]!]) },
    }))
    ;(this.map.getSource('events') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: pins })
    ;(this.map.getSource('events-shut') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: lines })
  }

/** A pin's name, in a word or two: the news and the card say the rest. */
  /** Puts the roads shut above the traffic, which is added after: a shut road is shut, whatever its jam. */
  raise(before?: string): void {
    for (const id of ['events-shut-casing', 'events-shut']) this.map.moveLayer(id, before)
  }
}

/** A pin's name, in a word or two: the news and the card say the rest. */
const PIN_NAMES: Partial<Record<GameEvent['kind'], string>> = {
  cavein: 'Road shut', employer: 'New jobs', festival: 'Crowds', opening: 'Line opens', strike: 'Strike',
}

/** A title short enough to sit beside a pin: its first clause. */
function short(title: string): string {
  const cut = title.split(/[,:;]/)[0]!
  return cut.length > 40 ? `${cut.slice(0, 38)}…` : cut
}
