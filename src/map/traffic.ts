import type { ExpressionSpecification, Map as MapLibre } from 'maplibre-gl'

/** The congestion colours of the accepted look: slow, very slow, jammed. Roads moving well keep their own colour. */
export const JAM_COLOURS = ['#f2a531', '#e4592b', '#a51d1d']
/** The pale ticks along a jammed road, so that jammed is told from very slow without colour (as stop-start traffic). */
export const JAM_TICK = '#fffdf9'
/**
 * The three levels as a key draws them (CSS backgrounds): each a little wider than the last, and jammed broken by the
 * ticks the map draws on it, so that the key reads without colour as the map does.
 */
export const JAM_SWATCHES = [
  JAM_COLOURS[0]!,
  JAM_COLOURS[1]!,
  `repeating-linear-gradient(90deg, ${JAM_COLOURS[2]} 0 5px, ${JAM_TICK} 5px 7px)`,
]

const level: ExpressionSpecification = ['coalesce', ['feature-state', 'level'], 0]
const main: ExpressionSpecification = ['get', 'main']
/**
 * Wider as the jam is worse, at every zoom, so that the three levels differ in more than colour: with the whole city in
 * view only the main roads show; close in, every road as wide as it is drawn, the worst a little wider.
 */
const WIDTH: ExpressionSpecification = [
  'interpolate', ['exponential', 1.6], ['zoom'],
  9, ['case', main, ['match', level, 3, 2.8, 2, 2.1, 1.5], 0.6],
  12, ['case', main, ['match', level, 3, 4.4, 2, 3.5, 2.6], ['match', level, 3, 2, 2, 1.5, 1.1]],
  15, ['match', level, 3, 5, 2, 4.2, 3.2],
  18, ['match', level, 3, 14, 2, 13, 11],
]

/**
 * Congestion on the drawn roads, from the network's source, coloured by each stretch's level through feature state,
 * so that a new month or a new part of the day recolours every stretch without the lines being rebuilt. With the
 * whole city in view only the worst of the main roads show, a little wider, so that the city's jams are what the eye
 * finds.
 */
export class CongestionLayer {
  private shown: Uint8Array | null = null

  constructor(private readonly map: MapLibre, before?: string) {
    map.addLayer(
      {
        id: 'congestion',
        type: 'line',
        source: 'network',
        layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['match', level, 1, JAM_COLOURS[0]!, 2, JAM_COLOURS[1]!, 3, JAM_COLOURS[2]!, 'rgba(0, 0, 0, 0)'],
          // With the whole city in view, only main roads that are very slow or jammed; the merely slow, and the
          // lesser roads, come in as the map zooms.
          'line-opacity': [
            'interpolate', ['linear'], ['zoom'],
            11.5, ['case', ['all', main, ['>=', level, 2]], 1, 0],
            12.5, 1,
          ],
          'line-width': WIDTH,
        },
      },
      before,
    )
    // Jammed roads carry pale ticks along them: without colour (or seen without red), jammed is still told from very
    // slow. They are drawn on the same stretches and follow the same feature state.
    map.addLayer(
      {
        id: 'congestion-jam',
        type: 'line',
        source: 'network',
        layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'butt' },
        paint: {
          'line-color': JAM_TICK,
          'line-opacity': [
            'interpolate', ['linear'], ['zoom'],
            11.5, ['case', ['all', main, ['==', level, 3]], 0.95, 0],
            12.5, ['case', ['==', level, 3], 0.95, 0],
          ],
          'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 9, 1, 12, 1.4, 15, 2, 18, 5],
          'line-dasharray': [1, 2.5],
        },
      },
      before,
    )
  }

  /** Shows or hides congestion. */
  show(visible: boolean): void {
    for (const id of ['congestion', 'congestion-jam']) this.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
  }

  /** Colours each stretch by its level (by stretch id), setting only those that changed. */
  paint(levels: Uint8Array): void {
    const before = this.shown
    for (let id = 0; id < levels.length; id++) {
      if (before && before[id] === levels[id]) continue
      this.map.setFeatureState({ source: 'network', id }, { level: levels[id] })
    }
    this.shown = levels.slice()
  }
}
