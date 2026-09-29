import type { Feature, FeatureCollection } from 'geojson'
import type { GeoJSONSource, Map as MapLibre } from 'maplibre-gl'
import type { LngLat, Network } from '../data/types'
import { BUS_COLOUR } from '../game/build'
import { PERIODS, type Period } from '../sim/types'
import { RIGHT_OFFSET } from './kannada'
import { pairs } from './network'
import { HIGHWAY_WIDTH, MAIN_ROAD } from './style'
import { JAM_COLOURS, JAM_TICK } from './traffic'

/** A routing link as the map draws it: the stretches of the drawn network it stands for. */
export interface DrawnLink {
  id: number
  drawn: number[]
  lanes: number
  /** From and to as lng, lat, lng, lat: drawn as the road where the link stands for no drawn stretch. */
  ends?: number[]
}

/** A road the player built, as drawn. */
export interface BuiltRoad {
  path: number[]
  lanes: number
  flyover: boolean
  name: string
}

/** A junction mark for the junction tool. */
export interface JunctionMark {
  id: number
  at: LngLat
  jam: number
  signal: boolean
}

/** A stop of the plan as drawn: where it is, its name, and whether it is chosen. */
export interface PlanStop {
  at: LngLat
  name: string
  nameKn: string | null
  index: number
  existing: boolean
}

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
const SOURCE = 'build'
const NAME_SIZE = 12

/**
 * What building puts on the map: the plan being made (dashed, in its line's colour, with its stops as rings), the
 * suggested routes (faint), works under way (dashed, with the roads that lose a lane), bus lanes, and, for the bus
 * lane tool, the roads that can take one. Everything is a GeoJSON source whose data is replaced as things change.
 */
export class BuildLayer {
  /** Every group's features, kept apart so that one can change without the others. */
  private readonly groups = new Map<string, Feature[]>()
  private pending = 0

  constructor(private readonly map: MapLibre, private network: Network | null, labels?: string) {
    // One source for everything building draws, each feature marked with its group, and each layer filtered to one.
    // Nine sources, measured, held some 50 MB more after panning: each is cut into tiles at every zoom, even empty.
    map.addSource(SOURCE, { type: 'geojson', data: EMPTY, maxzoom: 14 })
    const width = (low: number, high: number) => ['interpolate', ['linear'], ['zoom'], 10, low, 15, high] as never
    const group = (g: string) => ['==', ['get', 'group'], g] as never
    // Roads the player built, drawn as the base map draws a main road of their class and among its road layers, so
    // that they are part of the map: the edge under the base map's streets and the fill over them, so that where
    // the new road crosses one they meet as one junction. Flyovers go over everything, with the darker edge of bridges.
    const before = (id: string) => (map.getLayer(id) ? id : labels)
    map.addLayer({
      id: 'built-road-casing', type: 'line', source: SOURCE, filter: group('built-road'),
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': MAIN_ROAD.casing as never, 'line-gap-width': MAIN_ROAD.width as never,
        'line-width': ['interpolate', ['linear'], ['zoom'], 11.9, 0.6, 12, 1] as never, 'line-opacity': MAIN_ROAD.opacity as never,
      },
    }, before('roads_other'))
    map.addLayer({
      id: 'built-road', type: 'line', source: SOURCE, filter: group('built-road'),
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': MAIN_ROAD.colour as never, 'line-width': MAIN_ROAD.width as never, 'line-opacity': MAIN_ROAD.opacity as never },
    }, before('roads_rail'))
    // A flyover along the line of a metro or railway would be hidden beneath it: it is drawn beside it, as the base map
    // draws a road beside a railway, far enough to clear the line and its white edge at every zoom.
    const beside = ['interpolate', ['linear'], ['zoom'], 10, ['*', ['get', 'beside'], 4], 12, ['*', ['get', 'beside'], 6],
      15, ['*', ['get', 'beside'], 9], 18, ['*', ['get', 'beside'], 16]] as never
    map.addLayer({
      id: 'built-flyover-casing', type: 'line', source: SOURCE, filter: group('built-flyover'),
      layout: { 'line-join': 'round', 'line-cap': 'butt' },
      paint: {
        'line-color': '#8e877b', 'line-gap-width': HIGHWAY_WIDTH as never,
        'line-width': ['interpolate', ['linear'], ['zoom'], 11.9, 0.8, 12, 1.5] as never,
        'line-offset': beside,
      },
    }, labels)
    map.addLayer({
      id: 'built-flyover', type: 'line', source: SOURCE, filter: group('built-flyover'),
      layout: { 'line-join': 'round', 'line-cap': 'butt' },
      paint: { 'line-color': MAIN_ROAD.colour as never, 'line-width': HIGHWAY_WIDTH as never, 'line-offset': beside },
    }, labels)
    // Traffic on the player's roads, which the drawn network does not have: coloured as the congestion layer colours.
    map.addLayer({
      id: 'road-traffic', type: 'line', source: SOURCE, filter: group('road-traffic'),
      layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': 'rgba(0, 0, 0, 0)',
        'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 9, 2.2, 12, 3.6, 15, 4, 18, 13] as never,
      },
    }, labels)
    // Jammed stretches of them carry the same pale ticks as the rest of the map's, to be told without colour.
    map.addLayer({
      id: 'road-traffic-jam', type: 'line', source: SOURCE, filter: group('road-traffic'),
      layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'butt' },
      paint: {
        'line-color': JAM_TICK,
        'line-opacity': 0,
        'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 9, 1, 12, 1.4, 15, 2, 18, 5] as never,
        'line-dasharray': [1, 2.5],
      },
    }, labels)
    // Roads first, under the lines: bus lanes and roads losing a lane to works.
    map.addLayer({
      id: 'bus-lanes', type: 'line', source: SOURCE, filter: ['==', ['get', 'group'], 'bus-lanes'],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': BUS_COLOUR, 'line-width': width(3, 10), 'line-opacity': 0.5 },
    }, 'transit-bus-casing')
    map.addLayer({
      id: 'works-roads', type: 'line', source: SOURCE, filter: ['==', ['get', 'group'], 'works-roads'],
      layout: { 'line-join': 'round' },
      paint: { 'line-color': '#8a7f6e', 'line-width': width(1.5, 5), 'line-opacity': 0.45, 'line-dasharray': [1, 1] },
    }, 'transit-bus-casing')
    map.addLayer({
      id: 'lane-candidates', type: 'line', source: SOURCE, filter: ['==', ['get', 'group'], 'lane-candidates'],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': BUS_COLOUR, 'line-width': width(2, 6), 'line-opacity': 0.28 },
    })
    map.addLayer({
      id: 'lane-chosen', type: 'line', source: SOURCE, filter: ['==', ['get', 'group'], 'lane-chosen'],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': BUS_COLOUR, 'line-width': width(3.5, 9), 'line-opacity': 0.9 },
    })
    map.addLayer({
      id: 'suggestions', type: 'line', source: SOURCE, filter: ['==', ['get', 'group'], 'suggestions'],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['get', 'colour'],
        'line-width': ['case', ['get', 'chosen'], 5, 3.5],
        'line-opacity': ['case', ['get', 'chosen'], 0.75, 0.3],
      },
    })
    map.addLayer({
      id: 'works', type: 'line', source: SOURCE, filter: ['==', ['get', 'group'], 'works'],
      layout: { 'line-join': 'round' },
      paint: { 'line-color': ['get', 'colour'], 'line-width': width(2, 4), 'line-opacity': 0.85, 'line-dasharray': [2, 1.5] },
    })
    map.addLayer({
      id: 'plan-casing', type: 'line', source: SOURCE, filter: ['==', ['get', 'group'], 'plan-path'],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': width(6, 10), 'line-opacity': 0.9 },
    })
    map.addLayer({
      id: 'plan-path', type: 'line', source: SOURCE, filter: ['==', ['get', 'group'], 'plan-path'],
      layout: { 'line-join': 'round' },
      paint: { 'line-color': ['get', 'colour'], 'line-width': width(3, 5.5), 'line-dasharray': [2, 1] },
    })
    map.addLayer({
      id: 'plan-tap', type: 'circle', source: SOURCE, filter: ['==', ['get', 'group'], 'plan-tap'],
      paint: { 'circle-radius': 5, 'circle-color': '#8a8275', 'circle-opacity': 0.6 },
    })
    map.addLayer({
      id: 'plan-stops', type: 'circle', source: SOURCE, filter: ['==', ['get', 'group'], 'plan-stops'],
      paint: {
        'circle-color': '#ffffff',
        'circle-radius': ['case', ['get', 'chosen'], 10, ['<', ['get', 'index'], 0], 5, 7.5],
        'circle-stroke-color': ['case', ['get', 'chosen'], '#26231f', ['get', 'colour']],
        'circle-stroke-width': ['case', ['get', 'chosen'], 4, ['<', ['get', 'index'], 0], 2.5, 3.5],
      },
    })
    const names = (id: string, handles: boolean) => map.addLayer({
      id, type: 'symbol', source: SOURCE,
      filter: ['all', ['==', ['get', 'group'], 'plan-stops'], handles ? ['>=', ['get', 'index'], 0] : ['<', ['get', 'index'], 0]],
      layout: {
        'text-field': ['get', 'en'],
        'text-font': ['Noto Sans Medium'],
        'text-size': handles ? NAME_SIZE : NAME_SIZE - 1,
        'text-anchor': 'left',
        'text-offset': [RIGHT_OFFSET + 0.3, 0],
        // The stops the player chose are always named, and the station names and stops put between that would run
        // into them make way (these layers are placed first, being on top); those the rules put between, where there
        // is room.
        'text-allow-overlap': handles,
        'text-ignore-placement': false,
        'text-padding': 4,
      },
      paint: {
        'text-color': handles ? '#26231f' : '#4a453e',
        'text-halo-color': 'rgba(255, 255, 255, 0.95)',
        'text-halo-width': 1.6,
      },
    })
    names('plan-names-between', false)
    names('plan-names', true)

    // Junction work done: a small mark, close in.
    map.addLayer({
      id: 'junction-work', type: 'circle', source: SOURCE, filter: group('junction-work'), minzoom: 12,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.5, 16, 5] as never,
        'circle-color': '#ffffff', 'circle-stroke-color': '#26231f',
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 1.2, 16, 2] as never,
      },
    })
    // One-way streets: the roads that may be made one-way, the one chosen, and arrows on those one-way now.
    map.addLayer({
      id: 'oneway-candidates', type: 'line', source: SOURCE, filter: group('oneway-candidates'),
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#26231f', 'line-width': width(2, 7), 'line-opacity': 0.06 },
    })
    map.addLayer({
      id: 'oneway-chosen', type: 'line', source: SOURCE, filter: group('oneway-chosen'),
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#26231f', 'line-width': width(3, 8), 'line-opacity': 0.55 },
    })
    if (!map.hasImage('oneway-arrow')) map.addImage('oneway-arrow', arrow(), { pixelRatio: 2 })
    map.addLayer({
      id: 'oneway-arrows', type: 'symbol', source: SOURCE, filter: group('oneway-arrows'), minzoom: 12,
      layout: {
        'symbol-placement': 'line', 'symbol-spacing': 70, 'icon-image': 'oneway-arrow',
        'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.7, 16, 1.1] as never,
      },
    })
    // Roads chosen to mend: the run of a named road offered whole, faintly, and the stretches chosen, firmly.
    map.addLayer({
      id: 'repair-run', type: 'line', source: SOURCE, filter: group('repair-run'),
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#26231f', 'line-width': width(4, 10), 'line-opacity': 0.14 },
    })
    map.addLayer({
      id: 'repair-chosen', type: 'line', source: SOURCE, filter: group('repair-chosen'),
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#26231f', 'line-width': width(3, 8), 'line-opacity': 0.85 },
    })
    // Flooded roads, named with the days they were shut, in the traffic view close in.
    map.addLayer({
      id: 'flood-names', type: 'symbol', source: SOURCE, filter: group('flood-names'), minzoom: 12.5,
      layout: {
        visibility: 'none',
        'text-field': ['get', 'text'],
        'text-font': ['Noto Sans Medium'],
        'text-size': 11,
        'text-anchor': 'top',
        'text-offset': [0, 0.9],
        'text-padding': 6,
      },
      paint: { 'text-color': '#2f6f93', 'text-halo-color': 'rgba(255, 255, 255, 0.95)', 'text-halo-width': 1.6 },
    })
    // Junctions the junction tool can work on, only those in view, ringed by how jammed they are.
    map.addLayer({
      id: 'junction-marks', type: 'circle', source: SOURCE, filter: group('junction-marks'),
      paint: {
        'circle-color': '#ffffff',
        // The worse the jam, the larger and heavier the ring as well as the redder, so that it reads without colour.
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          11, ['case', ['get', 'chosen'], 8, ['match', ['get', 'jam'], 3, 5, 2, 4, 3]],
          15, ['case', ['get', 'chosen'], 11, ['match', ['get', 'jam'], 3, 9, 2, 7.5, 6]]] as never,
        'circle-stroke-color': ['case', ['get', 'chosen'], '#26231f',
          ['match', ['get', 'jam'], 1, JAM_COLOURS[0]!, 2, JAM_COLOURS[1]!, 3, JAM_COLOURS[2]!, '#8a8275']] as never,
        'circle-stroke-width': ['case', ['get', 'chosen'], 4, ['match', ['get', 'jam'], 3, 3.5, 2, 2.5, 1.5]] as never,
      },
    })
  }

  /**
   * The roads the player has built, and the junctions worked on. `tracks` are the lines of the metro and railways, as
   * lng, lat, lng, lat…: a flyover that runs along one is drawn beside it.
   */
  showBuilt(roads: BuiltRoad[], junctions: LngLat[], tracks: number[][] = []): void {
    const line = (r: BuiltRoad): Feature => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: pairs(r.path) },
      // Named and classed as the tiles name and class a road, so that the base map's widths apply as they are.
      properties: { kind_detail: r.lanes >= 2 ? 'primary' : 'secondary', name: r.name, beside: r.flyover && alongside(r.path, tracks) ? 1 : 0 },
    })
    this.set('built-road', roads.filter((r) => !r.flyover && r.path.length >= 4).map(line))
    this.set('built-flyover', roads.filter((r) => r.flyover && r.path.length >= 4).map(line))
    this.set('junction-work', junctions.map((at) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: at }, properties: {} })))
  }

  /** Traffic on the player's roads for a part of the day, or none. */
  showRoadTraffic(extra: { line: number[]; level: number[] }[], period: Period | null): void {
    this.set('road-traffic', extra.map((e) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: pairs(e.line) },
      properties: Object.fromEntries(PERIODS.map((p, i) => [p, e.level[i] ?? 0])),
    })))
    this.map.setLayoutProperty('road-traffic', 'visibility', period ? 'visible' : 'none')
    this.map.setLayoutProperty('road-traffic-jam', 'visibility', period ? 'visible' : 'none')
    if (!period) return
    const level = ['get', period]
    this.map.setPaintProperty('road-traffic', 'line-color',
      ['match', level, 1, JAM_COLOURS[0]!, 2, JAM_COLOURS[1]!, 3, JAM_COLOURS[2]!, 'rgba(0, 0, 0, 0)'] as never)
    // As wide as the congestion layer draws a main road at each level: wider as the jam is worse.
    this.map.setPaintProperty('road-traffic', 'line-width', [
      'interpolate', ['exponential', 1.6], ['zoom'],
      9, ['match', level, 3, 2.8, 2, 2.1, 1.5],
      12, ['match', level, 3, 4.4, 2, 3.5, 2.6],
      15, ['match', level, 3, 5, 2, 4.2, 3.2],
      18, ['match', level, 3, 14, 2, 13, 11],
    ] as never)
    this.map.setPaintProperty('road-traffic-jam', 'line-opacity', ['case', ['==', level, 3], 0.95, 0] as never)
  }

  /** The junctions the junction tool can work on, and the one chosen; null takes them away. */
  showJunctions(marks: JunctionMark[] | null, chosen: number | null): void {
    this.set('junction-marks', (marks ?? []).map((m) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: m.at },
      properties: { id: m.id, jam: m.jam, chosen: m.id === chosen },
    })))
  }

  /** For the one-way tool: the roads that may be made one-way, the one chosen, and arrows; null takes them away. */
  showOneWay(candidates: DrawnLink[] | null, chosen: DrawnLink[], arrows: { drawn: number[]; forward: boolean[]; line?: number[] }[]): void {
    this.set('oneway-candidates', candidates ? this.roads(candidates) : [])
    this.set('oneway-chosen', this.roads(chosen))
    const network = this.network
    const features: Feature[] = []
    for (const a of arrows) {
      // Each stretch drawn the way traffic runs on it, so that the arrows along it point that way.
      if (a.line) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pairs(a.line) }, properties: {} })
      a.drawn.forEach((d, k) => {
        const line = network?.links[d]?.line
        if (!line || line.length < 4) return
        const coords = pairs(line)
        if (!a.forward[k]) coords.reverse()
        features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} })
      })
    }
    this.set('oneway-arrows', features)
  }

  /** For the upkeep tools: the stretches chosen to mend, and the rest of the named road offered whole. */
  showRepair(chosen: DrawnLink[], run: DrawnLink[]): void {
    this.set('repair-chosen', this.roads(chosen))
    this.set('repair-run', this.roads(run))
  }

  /** Names the roads flooded this month with the days they were shut, where `visible` (the traffic view). */
  showFloods(floods: { at: LngLat; days: number }[], visible: boolean): void {
    this.set('flood-names', floods.map((f) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: f.at },
      properties: { text: `Flooded, shut ${f.days} day${f.days === 1 ? '' : 's'}` },
    })))
    this.map.setLayoutProperty('flood-names', 'visibility', visible ? 'visible' : 'none')
  }

  /** Gives the drawn network, once loaded, so that roads can be drawn by their stretches. */
  setNetwork(network: Network): void {
    this.network = network
  }

  /** A road's name, from the drawn stretches of a routing link in `links`, if the map has one. */
  nameOf(id: number, links: { id: number; drawn: number[] }[]): string | null {
    const l = links.find((x) => x.id === id)
    for (const d of l?.drawn ?? []) {
      const name = this.network?.links[d]?.name
      if (name) return name
    }
    return null
  }

  /** Replaces one group's features; the source is sent them all once, at the next frame. */
  private set(group: string, features: Feature[]): void {
    for (const f of features) f.properties = { ...f.properties, group }
    this.groups.set(group, features)
    if (this.pending) return
    this.pending = requestAnimationFrame(() => {
      this.pending = 0
      const all = [...this.groups.values()].flat()
      ;(this.map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: all })
    })
  }

  /** The stretches of road a set of routing links stand for, as one feature each; a new road by its own line. */
  private roads(links: DrawnLink[], props: (l: DrawnLink) => Record<string, unknown> = () => ({})): Feature[] {
    const network = this.network
    if (!network) return []
    return links.map((l) => ({
      type: 'Feature',
      id: l.id,
      geometry: {
        type: 'MultiLineString',
        coordinates: l.drawn.length
          ? l.drawn.map((d) => pairs(network.links[d]?.line ?? [])).filter((c) => c.length > 1)
          : l.ends ? [pairs(l.ends)] : [],
      },
      properties: { id: l.id, ...props(l) },
    }))
  }

  /** The plan being made: its line, its stops, and a tap not yet answered. */
  showPlan(colour: string, path: number[], stops: PlanStop[], chosen: number | null, tap: LngLat | null): void {
    const line: Feature[] = path.length >= 4
      ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: pairs(path) }, properties: { colour } }]
      : []
    this.set('plan-path', line)
    this.set('plan-stops', stops.map((s) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: s.at },
      properties: {
        index: s.index, en: s.name, colour, chosen: s.index === chosen,
      },
    })))
    this.set('plan-tap', tap ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: tap }, properties: {} }] : [])
  }

  /** Just the tap, while its stop is being worked out. */
  showTap(tap: LngLat | null): void {
    this.set('plan-tap', tap ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: tap }, properties: {} }] : [])
  }

  clearPlan(): void {
    for (const id of ['plan-path', 'plan-stops', 'plan-tap']) this.set(id, [])
  }

  /** The suggested routes, faint, with the one being looked at stronger. */
  showSuggestions(paths: { path: number[]; colour: string }[], chosen: number | null): void {
    this.set('suggestions', paths.map((s, i): Feature => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: pairs(s.path) },
      properties: { index: i, colour: s.colour, chosen: i === chosen },
    })))
  }

  /** Work under way: each line on its course, and the roads losing a lane to it. */
  showWorks(works: { path: number[]; colour: string }[], disrupted: DrawnLink[]): void {
    this.set('works', works.filter((w) => w.path.length >= 4).map((w): Feature => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: pairs(w.path) },
      properties: { colour: w.colour },
    })))
    this.set('works-roads', this.roads(disrupted))
  }

  /** The bus lanes that are open. */
  showBusLanes(links: DrawnLink[]): void {
    this.set('bus-lanes', this.roads(links))
  }

  /** For the bus lane tool: the roads that can take a lane, and those chosen. Null takes them away. */
  showLanes(candidates: DrawnLink[] | null, chosen: DrawnLink[]): void {
    this.set('lane-candidates', candidates ? this.roads(candidates) : [])
    this.set('lane-chosen', this.roads(chosen))
  }

  /** Frames a set of points in the part of the map not covered by the page's cards. */
  frame(points: LngLat[], padding: { top: number; bottom: number; left: number; right: number }): void {
    if (!points.length) return
    let [w, s, e, n] = [points[0]![0], points[0]![1], points[0]![0], points[0]![1]]
    for (const [x, y] of points) {
      w = Math.min(w, x)
      e = Math.max(e, x)
      s = Math.min(s, y)
      n = Math.max(n, y)
    }
    this.map.fitBounds([w, s, e, n], { padding, maxZoom: 14, duration: 600 })
  }
}

/** Metres within which a flyover is taken to run along a track, and the share of its length that must. */
const ALONG_M = 40
const ALONG_SHARE = 0.3

/** Whether a line runs along any of `tracks` for a good part of its length: points every 50 m, tested for nearness. */
export function alongside(path: number[], tracks: number[][]): boolean {
  if (path.length < 4 || !tracks.length) return false
  const k = Math.cos((path[1]! * Math.PI) / 180) * 111_320
  const points: [number, number][] = []
  for (let i = 2; i < path.length; i += 2) {
    const [x1, y1, x2, y2] = [path[i - 2]!, path[i - 1]!, path[i]!, path[i + 1]!]
    const n = Math.max(1, Math.ceil(Math.hypot((x2 - x1) * k, (y2 - y1) * 110_540) / 50))
    for (let j = 0; j < n; j++) points.push([x1 + ((x2 - x1) * j) / n, y1 + ((y2 - y1) * j) / n])
  }
  let near = 0
  for (const [px, py] of points) {
    let hit = false
    for (const t of tracks) {
      for (let i = 2; i < t.length && !hit; i += 2) {
        const ax = (t[i - 2]! - px) * k, ay = (t[i - 1]! - py) * 110_540
        const bx = (t[i]! - px) * k, by = (t[i + 1]! - py) * 110_540
        const dx = bx - ax, dy = by - ay
        const u = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)))
        hit = Math.hypot(ax + u * dx, ay + u * dy) <= ALONG_M
      }
      if (hit) break
    }
    if (hit) near++
  }
  return near / points.length >= ALONG_SHARE
}

/** A small arrow pointing along a line, for one-way streets: white with a dark edge, drawn once. */
function arrow(): ImageData {
  const size = 24
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const c = canvas.getContext('2d')!
  c.lineJoin = 'round'
  c.lineCap = 'round'
  c.beginPath()
  c.moveTo(7, 5)
  c.lineTo(17, 12)
  c.lineTo(7, 19)
  c.strokeStyle = '#ffffff'
  c.lineWidth = 7
  c.stroke()
  c.strokeStyle = '#26231f'
  c.lineWidth = 3
  c.stroke()
  return c.getImageData(0, 0, size, size)
}
