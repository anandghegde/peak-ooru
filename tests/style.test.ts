import { existsSync } from 'node:fs'
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import { describe, expect, it } from 'vitest'
import { KNOWN_PLACES } from '../src/map/places'
import { baseStyle } from '../src/map/style'

const style = baseStyle('pmtiles://tiles.pmtiles', 'http://localhost/fonts/', KNOWN_PLACES.map((p) => p.osm))
const layer = (id: string) => style.layers.find((l) => l.id === id) as Record<string, any> | undefined

describe('the base map style', () => {
  it('passes MapLibre’s own check of a style', () => {
    expect(validateStyleMin(style)).toEqual([])
  })

  it('takes its fonts from our own site, and every font it names is there', () => {
    expect(style.glyphs).toBe('http://localhost/fonts/{fontstack}/{range}.pbf')
    const named = style.layers.map((l) => JSON.stringify((l as any).layout?.['text-font'] ?? []))
    const fonts = new Set(named.flatMap((text) => text.match(/Noto Sans \w+/g) ?? []))
    expect(fonts.size).toBeGreaterThan(0)
    for (const font of fonts) {
      expect(existsSync(new URL(`../public/fonts/${font}/0-255.pbf`, import.meta.url))).toBe(true)
    }
  })

  it('leaves out shops and boundaries, which crowd the map', () => {
    expect(layer('pois')).toBeUndefined()
    expect(layer('boundaries')).toBeUndefined()
  })

  it('hides the base map’s own labels for the places the browser names', () => {
    expect(JSON.stringify(layer('places_subplace')!.filter)).toContain('Koramangala')
    expect(layer('places_subplace')!.minzoom).toBeGreaterThanOrEqual(13)
  })

  it('leaves underpasses out until the streets are close enough to see them', () => {
    const tunnels = style.layers.filter((l) => l.id.startsWith('roads_tunnels_'))
    expect(tunnels.length).toBeGreaterThan(0)
    for (const l of tunnels) expect(l.minzoom).toBe(14)
  })

  it('fades minor streets in as the map zooms, rather than all at once', () => {
    expect(layer('roads_minor')!.paint['line-opacity'][0]).toBe('interpolate')
  })
})

describe('the known places', () => {
  it('names about 25 places with the whole city in view, each with its Kannada name', () => {
    const first = KNOWN_PLACES.filter((p) => p.rank === 1)
    expect(first.length).toBe(25)
    for (const p of first) expect(p.kn).toBeTruthy()
  })

  it('puts every place inside the map', () => {
    for (const { at } of KNOWN_PLACES) {
      expect(at[0]).toBeGreaterThan(77.35)
      expect(at[0]).toBeLessThan(77.85)
      expect(at[1]).toBeGreaterThan(12.75)
      expect(at[1]).toBeLessThan(13.2)
    }
  })
})
