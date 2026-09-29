import type { ExpressionSpecification, Map as MapLibre } from 'maplibre-gl'
import type { Zone } from '../data/types'
import type { ZoneOutlines } from '../data/zones'
import { gradeOf } from '../game/upkeep'
import { STREET_SHADES } from './condition'

/** The figures a zone can be shaded by. */
export type ZoneView = 'plain' | 'people' | 'jobs' | 'commute' | 'access' | 'deaths' | 'roads' | 'clean' | 'fairness'
/** The figures that come from a month's traffic, kept in each zone's feature state rather than its properties. */
const MONTHLY = new Set<ZoneView>(['commute', 'access', 'deaths', 'clean'])
/**
 * What each view marks with a dashed outline, of what the player has done by zone: footpaths and limits in the road
 * deaths view, taller building in the people view. Not on the plain map.
 */
const MARKED: Partial<Record<ZoneView, 'safer' | 'dense'>> = { deaths: 'safer', people: 'dense' }

/** Light to dark: a warm brown that sits under the pale map and does not fight the lines' colours. */
export const SHADES = ['#f1e7d6', '#e3cfae', '#d0ae85', '#b38760', '#8a6444']

/**
 * Where each shade starts, for a figure per square kilometre: the fifths of the zones, rounded, so that each shade
 * covers about as many zones and the key reads in round numbers.
 */
export function breaks(values: number[]): number[] {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (!sorted.length) return [0, 0, 0, 0]
  const round = (v: number) => {
    if (v <= 0) return 0
    const unit = 10 ** Math.floor(Math.log10(v) - 1)
    return Math.round(v / unit) * unit
  }
  return [0.2, 0.4, 0.6, 0.8].map((q) => round(sorted[Math.floor(q * (sorted.length - 1))]!))
}

/** Per square kilometre, as each view shades it. */
export function density(zone: Zone, view: 'people' | 'jobs'): number {
  return zone.area > 0 ? zone[view] / zone.area : 0
}

/** Zones with fewer people than this are not shaded by deaths per person: a handful of deaths there says little. */
export const FEW_PEOPLE = 2000

/**
 * Road deaths a year for each lakh of people living in each zone, by zone id; −1 where too few live there to say.
 * `people` is the people by zone now, where the rules keep it; else the zones' own figures.
 */
export function deathRates(zones: Zone[], deaths: ArrayLike<number>, people?: number[]): number[] {
  const out: number[] = []
  for (const z of zones) {
    const n = people?.[z.id] ?? z.people
    out[z.id] = n >= FEW_PEOPLE ? ((deaths[z.id] ?? 0) * 100_000) / n : -1
  }
  return out
}

function shading(view: ZoneView, steps: number[]): ExpressionSpecification {
  const value = MONTHLY.has(view) ? ['coalesce', ['feature-state', view], -1] : ['get', view]
  // Below nothing (a zone with no figure) is left clear.
  const expression: unknown[] = ['step', value, 'rgba(0, 0, 0, 0)', 0, SHADES[0]]
  let last = 0
  steps.forEach((b, i) => {
    // Rounded fifths can repeat when most zones share a figure; a step must rise.
    if (b > last) expression.push(b, SHADES[i + 1])
    last = Math.max(last, b)
  })
  return expression as ExpressionSpecification
}

/** Draws the zones: quiet outlines, a fill to tap, and shading by the chosen figure. */
export class ZoneLayer {
  /** Where each shade starts, by view; the monthly views have none until a month has been worked out. */
  readonly steps: Partial<Record<Exclude<ZoneView, 'plain'>, number[]>>
  private view: ZoneView = 'plain'
  private readonly features: { properties: { id: number }; geometry: unknown }[]

  constructor(private readonly map: MapLibre, readonly zones: Zone[], outlines: ZoneOutlines, before?: string) {
    this.steps = {
      people: breaks(zones.map((z) => density(z, 'people'))),
      jobs: breaks(zones.map((z) => density(z, 'jobs'))),
    }
    const byId = new Map(zones.map((z) => [z.id, z]))
    const features = outlines.features.flatMap((f) => {
      const zone = byId.get(f.properties.id)
      if (!zone) return []
      return [{ ...f, properties: { id: zone.id, people: density(zone, 'people'), jobs: density(zone, 'jobs') } }]
    })
    this.features = features as never
    map.addSource('zones', { type: 'geojson', data: { type: 'FeatureCollection', features } as never, promoteId: 'id' })
    map.addLayer(
      {
        id: 'zones-fill',
        type: 'fill',
        source: 'zones',
        paint: { 'fill-color': SHADES[0]!, 'fill-opacity': 0 },
      },
      before,
    )
    map.addLayer(
      {
        id: 'zones-line',
        type: 'line',
        source: 'zones',
        paint: {
          'line-color': '#8a8275',
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.12, 13, 0.3, 15, 0.4],
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.4, 15, 1],
        },
      },
      before,
    )
    map.addLayer({
      id: 'zones-marked',
      type: 'line',
      source: 'zones',
      layout: { 'line-join': 'round' },
      paint: { 'line-color': '#3f6f4c', 'line-width': 1.6, 'line-dasharray': [2, 1.5], 'line-opacity': 0 },
    })
    map.addLayer({
      id: 'zones-picked',
      type: 'line',
      source: 'zones',
      filter: ['==', ['get', 'id'], -1],
      layout: { 'line-join': 'round' },
      paint: { 'line-color': '#26231f', 'line-width': 2.2, 'line-opacity': 0.8 },
    })
  }

  /** Shades the zones by `view`, or not at all. */
  show(view: ZoneView): void {
    this.view = view
    const marked = MARKED[view]
    this.map.setPaintProperty('zones-marked', 'line-opacity',
      marked ? ['case', ['boolean', ['feature-state', marked], false], 0.85, 0] : 0)
    if (this.tool) return
    const steps = view === 'plain' ? undefined : this.steps[view]
    if (!steps) {
      this.map.setPaintProperty('zones-fill', 'fill-opacity', 0)
      return
    }
    if (view === 'fairness') {
      // The worst-served fifth of zones, in the darkest shade; the rest clear.
      this.map.setPaintProperty('zones-fill', 'fill-color',
        ['case', ['boolean', ['feature-state', 'worst'], false], SHADES[4]!, 'rgba(0, 0, 0, 0)'])
      this.map.setPaintProperty('zones-fill', 'fill-opacity', ['interpolate', ['linear'], ['zoom'], 11, 0.45, 13, 0.35, 15, 0.25])
      return
    }
    if (view === 'roads') {
      // The streets of each zone by their grade, faintly, under the main roads that carry the view.
      this.map.setPaintProperty('zones-fill', 'fill-color', ['match', ['coalesce', ['feature-state', 'streets'], 0],
        1, STREET_SHADES[0]!, 2, STREET_SHADES[1]!, 3, STREET_SHADES[2]!, 'rgba(0, 0, 0, 0)'])
      // Firm enough at middle zooms to tell the grades apart under the roads; fainter close in, where streets show.
      this.map.setPaintProperty('zones-fill', 'fill-opacity', ['interpolate', ['linear'], ['zoom'], 11, 0.6, 13.5, 0.65, 15, 0.45])
      return
    }
    this.map.setPaintProperty('zones-fill', 'fill-color', shading(view, steps))
    // Strong enough to read with the whole city in view; fainter close in, where the streets matter more.
    const opacity: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 11, 0.6, 13, 0.4, 15, 0.25]
    this.map.setPaintProperty('zones-fill', 'fill-opacity', opacity)
  }

  /**
   * Takes a month's commute (seconds, by zone id) and access to jobs (thousandths of the city's jobs, by zone id),
   * as minutes and per cent, for the monthly views.
   */
  setMonth(commute: Int32Array, access: Int16Array, deaths?: Int32Array, people?: number[], clean?: Int16Array): void {
    const minutes = Array.from(commute, (s) => s / 60)
    const percent = Array.from(access, (a) => a / 10)
    const rates = deaths ? deathRates(this.zones, deaths, people) : null
    const cleanPercent = clean ? Array.from(clean, (c) => c / 10) : null
    for (const zone of this.zones) {
      const state: Record<string, number> = { commute: minutes[zone.id] ?? 0, access: percent[zone.id] ?? 0 }
      if (rates) state.deaths = rates[zone.id] ?? -1
      if (cleanPercent) state.clean = cleanPercent[zone.id] ?? -1
      this.map.setFeatureState({ source: 'zones', id: zone.id }, state)
    }
    this.steps.commute = breaks(minutes)
    this.steps.access = breaks(percent)
    if (rates) this.steps.deaths = breaks(rates.filter((r) => r >= 0))
    if (cleanPercent) this.steps.clean = breaks(cleanPercent)
    if (MONTHLY.has(this.view)) this.show(this.view)
  }

  /** Marks the worst-served fifth of zones, for the fairness view. */
  setWorst(worst: Set<number>): void {
    for (const zone of this.zones) this.map.setFeatureState({ source: 'zones', id: zone.id }, { worst: worst.has(zone.id) })
    this.steps.fairness = [1]
    if (this.view === 'fairness') this.show('fairness')
  }

  /** Takes the condition of each zone's minor streets (0 to 100, by zone id), for the road condition view. */
  setStreets(streets: number[] | null): void {
    for (const zone of this.zones) {
      const c = streets?.[zone.id]
      this.map.setFeatureState({ source: 'zones', id: zone.id }, { streets: c === undefined ? 0 : gradeOf(c) })
    }
    this.steps.roads = [1, 2, 3]
    if (this.view === 'roads') this.show('roads')
  }

  /** Marks the zones with footpaths or a limit, and those allowed taller building, for the views that show them. */
  setMarks(safer: number[], dense: number[]): void {
    const s = new Set(safer)
    const d = new Set(dense)
    for (const zone of this.zones) {
      this.map.setFeatureState({ source: 'zones', id: zone.id }, { safer: s.has(zone.id), dense: d.has(zone.id) })
    }
  }

  private tool = false

  /**
   * For a tool that works by zone: shades the zones where it would do most, 1 to 3 from some to most, over the view.
   * Null gives the view back.
   */
  highlight(levels: Map<number, number> | null): void {
    for (const zone of this.zones) this.map.setFeatureState({ source: 'zones', id: zone.id }, { tool: levels?.get(zone.id) ?? 0 })
    this.tool = !!levels
    if (!levels) return this.show(this.view)
    // Transparency by feature state is carried in the colour: the fill's opacity does not take feature state.
    this.map.setPaintProperty('zones-fill', 'fill-color',
      ['match', ['coalesce', ['feature-state', 'tool'], 0], 1, SHADES[2]!, 2, SHADES[3]!, 3, SHADES[4]!, 'rgba(0, 0, 0, 0)'])
    this.map.setPaintProperty('zones-fill', 'fill-opacity', ['interpolate', ['linear'], ['zoom'], 11, 0.7, 13, 0.5, 15, 0.3])
  }

  /** Outlines the zone `id` while a tool is on it, and what the map shows of its shape. */
  outline(id: number): number[][][] | null {
    const f = this.features.find((x) => x.properties.id === id)
    if (!f) return null
    const g = f.geometry as { type: string; coordinates: unknown }
    // The largest part of a zone in several parts is enough to say which roads are in it.
    if (g.type === 'Polygon') return g.coordinates as number[][][]
    if (g.type === 'MultiPolygon') {
      const parts = g.coordinates as number[][][][]
      return parts.reduce((a, b) => (b[0]!.length > a[0]!.length ? b : a))
    }
    return null
  }

  /** Outlines the zone `id`, or none. */
  pick(id: number | null): void {
    this.map.setFilter('zones-picked', ['==', ['get', 'id'], id ?? -1])
  }
}
