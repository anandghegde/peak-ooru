import type { Map as MapLibre } from 'maplibre-gl'
import type { ZoneOutlines } from '../data/zones'

export type Ring = [number, number][]

/**
 * The city's edge, as closed rings: the sides of the city's zones (those in `city`) that no other of them shares.
 * The zones' outlines are simplified together, so a side two zones share has the same corners in both.
 */
export function cityEdge(outlines: ZoneOutlines, city: Set<number>): Ring[] {
  const once = new Map<string, [string, string]>()
  const points = new Map<string, [number, number]>()
  for (const feature of outlines.features) {
    if (!feature.geometry || !city.has(feature.properties.id)) continue
    const { type, coordinates } = feature.geometry
    const rings = (type === 'Polygon' ? coordinates : (coordinates as number[][][][]).flat()) as number[][][]
    for (const ring of rings) {
      for (let i = 1; i < ring.length; i++) {
        const [a, b] = [String(ring[i - 1]), String(ring[i])]
        if (a === b) continue
        points.set(a, ring[i - 1] as [number, number])
        points.set(b, ring[i] as [number, number])
        const key = a < b ? `${a}|${b}` : `${b}|${a}`
        if (once.has(key)) once.delete(key)
        else once.set(key, [a, b])
      }
    }
  }
  // Chain the unshared sides end to end into rings.
  const next = new Map<string, string[]>()
  for (const [a, b] of once.values()) {
    next.set(a, [...(next.get(a) ?? []), b])
    next.set(b, [...(next.get(b) ?? []), a])
  }
  const rings: Ring[] = []
  for (const start of next.keys()) {
    if (!next.get(start)?.length) continue
    const ring: Ring = [points.get(start)!]
    let at = start
    for (;;) {
      const to = next.get(at)?.pop()
      if (to === undefined) break
      const back = next.get(to)!
      back.splice(back.indexOf(at), 1)
      ring.push(points.get(to)!)
      at = to
      if (to === start) break
    }
    if (ring.length > 3) rings.push(ring)
  }
  return rings
}

/** Twice the signed area of a ring, in degrees: its sign says which way round it runs. */
function area(ring: Ring): number {
  let sum = 0
  for (let i = 1; i < ring.length; i++) sum += (ring[i]![0] - ring[i - 1]![0]) * (ring[i]![1] + ring[i - 1]![1])
  return sum
}

/**
 * The city set apart from the country round it: land outside the city under a pale veil, and the city's edge as a
 * quiet line, both when zoomed out only. `edge` may be empty, when the zones are not yet built.
 */
export function addCityEdge(map: MapLibre, edge: Ring[], bounds: [number, number, number, number], before?: string) {
  const [w, s, e, n] = bounds
  const outside: Ring = [[w, s], [e, s], [e, n], [w, n], [w, s]]
  // A hole must run the other way round from the ring it is cut from.
  const holes = edge.map((ring) => (Math.sign(area(ring)) === Math.sign(area(outside)) ? [...ring].reverse() : ring))
  map.addSource('city-edge', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [outside, ...holes] },
          properties: { veil: true },
        },
        { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: edge }, properties: { veil: false } },
      ],
    },
  })
  map.addLayer(
    {
      id: 'city-veil',
      type: 'fill',
      source: 'city-edge',
      filter: ['get', 'veil'],
      paint: {
        'fill-color': '#fbfaf7',
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, 0.5, 13.5, 0],
        'fill-antialias': false,
      },
    },
    before,
  )
  map.addLayer(
    {
      id: 'city-edge',
      type: 'line',
      source: 'city-edge',
      filter: ['!', ['get', 'veil']],
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': '#9a9183',
        'line-width': 1.2,
        'line-dasharray': [3, 2],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, 0.7, 13, 0],
      },
    },
    before,
  )
}

/**
 * The last stretch before the edge of the map data, faded into the background colour so that the map has no hard
 * edge: a wide, blurred line of that colour along the edge, kept about `metres` wide as the map zooms.
 */
export function addEdgeFade(map: MapLibre, bounds: [number, number, number, number], colour: string, before?: string) {
  const [w, s, e, n] = bounds
  map.addSource('edge-fade', {
    type: 'geojson',
    data: {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[w, s], [e, s], [e, n], [w, n], [w, s]] },
      properties: {},
    },
  })
  // Metres a pixel covers at zoom 0 here (512-pixel tiles, latitude 13°), so that the fade is 1.5 km at any zoom.
  const px = (zoom: number) => (2 * 1500) / ((40075016 * Math.cos((13 * Math.PI) / 180)) / 512 / 2 ** zoom)
  map.addLayer(
    {
      id: 'edge-fade',
      type: 'line',
      source: 'edge-fade',
      paint: {
        'line-color': colour,
        'line-width': ['interpolate', ['exponential', 2], ['zoom'], 9, px(9), 15, px(15)],
        'line-blur': ['interpolate', ['exponential', 2], ['zoom'], 9, px(9) / 2, 15, px(15) / 2],
      },
    },
    before,
  )
}
