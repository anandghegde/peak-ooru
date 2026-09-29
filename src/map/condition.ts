import type { ExpressionSpecification, Map as MapLibre } from 'maplibre-gl'
import { palette } from './style'

/**
 * The colours of road condition: a scale of its own that cannot be taken for traffic (amber, orange, red). Good roads
 * keep the map's own cream; fair is a light grey-brown, poor a mid brown, broken a dark brown drawn broken (dashed),
 * which says "broken" without a key. Concrete is a cool grey.
 */
export const SURFACE_COLOURS = { fair: '#c9bca8', poor: '#93704f', broken: '#553722', concrete: '#8d989e' }
/** A zone's minor streets, shaded faintly under the roads: fair, poor, broken. */
export const STREET_SHADES = ['#ebe3d5', '#d8c3a6', '#bf9d74']
/** Flooded roads: the map's own water, a little deeper so that a thin road still shows it. */
export const FLOOD_COLOUR = '#8cc3e0'

const grade: ExpressionSpecification = ['coalesce', ['feature-state', 'grade'], 0]
const main: ExpressionSpecification = ['get', 'main']

/** How much time a stretch's surface costs, by the kilometre: 0, 1 (the costliest 40%) or 2 (the costliest tenth). */
const cost: ExpressionSpecification = ['coalesce', ['feature-state', 'cost'], 0]
/**
 * Wider than the congestion's lines, so that a road's colour reads at a glance; as wide as the road close in. Fair
 * roads are drawn thinner; roads whose surfaces cost the most time, wider, so that when most of the city is poor the
 * eye still finds the roads that matter.
 */
const weight = (w: number): ExpressionSpecification =>
  ['*', w, ['case', ['==', grade, 1], 0.6, ['match', cost, 2, 1.8, 1, 1.25, 1]]]
const WIDTH: ExpressionSpecification = [
  'interpolate', ['exponential', 1.6], ['zoom'],
  9, ['case', main, weight(2), 0.6],
  12, ['case', main, weight(3.2), weight(1.6)],
  15, weight(4.2),
  18, weight(13),
]

/**
 * Road condition on the drawn roads, from the network's source, by each stretch's grade through feature state, as the
 * congestion layer is coloured. With the whole city in view only the main roads that are poor or broken show; the
 * rest come in as the map zooms. Flooded roads are drawn here too, for the traffic view in a monsoon month.
 */
export class ConditionLayer {
  private shown: Uint8Array | null = null
  private flooded = new Set<number>()

  constructor(private readonly map: MapLibre, before?: string) {
    const opacity: ExpressionSpecification = [
      'interpolate', ['linear'], ['zoom'],
      11.5, ['case', ['all', main, ['>=', grade, 2]], 1, 0],
      12.5, 1,
    ]
    map.addLayer({
      id: 'flooded', type: 'line', source: 'network',
      layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': FLOOD_COLOUR,
        'line-opacity': ['case', ['>', ['coalesce', ['feature-state', 'shut'], 0], 0], 0.95, 0],
        'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 9, 2.4, 12, 4.4, 15, 7, 18, 18],
      },
    }, before)
    map.addLayer({
      id: 'condition', type: 'line', source: 'network',
      layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['match', grade, 1, SURFACE_COLOURS.fair, 2, SURFACE_COLOURS.poor, 'rgba(0, 0, 0, 0)'],
        'line-opacity': opacity,
        'line-width': WIDTH,
      },
    }, before)
    // Broken roads dashed: the map's cream shows between the dashes, as a road with holes in it.
    map.addLayer({
      id: 'condition-broken', type: 'line', source: 'network',
      layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'butt' },
      paint: {
        'line-color': ['match', grade, 3, SURFACE_COLOURS.broken, 'rgba(0, 0, 0, 0)'],
        'line-opacity': opacity,
        'line-width': WIDTH,
        'line-dasharray': [1.6, 1],
      },
    }, before)
    // Concrete: a cool grey stripe down the middle of the road.
    map.addLayer({
      id: 'condition-concrete', type: 'line', source: 'network',
      layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': SURFACE_COLOURS.concrete,
        'line-opacity': ['case', ['boolean', ['feature-state', 'concrete'], false], 1, 0],
        'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 9, 1.4, 12, 2.4, 15, 3, 18, 9],
      },
    }, before)
  }

  /** Shows or hides the condition of the roads. */
  show(visible: boolean): void {
    for (const id of ['condition', 'condition-broken', 'condition-concrete']) {
      this.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
    }
  }

  /**
   * Colours each stretch by its grade (0 good to 3 broken, plus 4 for concrete, plus 8 or 16 for the time its surface
   * costs), setting only those that changed.
   */
  paint(stretch: Uint8Array): void {
    const before = this.shown
    for (let id = 0; id < stretch.length; id++) {
      if (before && before[id] === stretch[id]) continue
      const v = stretch[id]!
      this.map.setFeatureState({ source: 'network', id }, { grade: v & 3, concrete: (v & 4) !== 0, cost: (v >> 3) & 3 })
    }
    this.shown = stretch.slice()
  }

  /** Marks the stretches of roads flooded this month with the days each was shut; shows them if `visible`. */
  flood(stretches: Map<number, number>, visible: boolean): void {
    for (const id of this.flooded) if (!stretches.has(id)) this.map.setFeatureState({ source: 'network', id }, { shut: 0 })
    for (const [id, days] of stretches) this.map.setFeatureState({ source: 'network', id }, { shut: days })
    this.flooded = new Set(stretches.keys())
    this.map.setLayoutProperty('flooded', 'visibility', visible && stretches.size ? 'visible' : 'none')
  }
}

/** The land under the key's swatches, for drawing a broken road as it shows on the map. */
export const ROAD_CREAM = palette.roadMajor
