import { describe, expect, it } from 'vitest'
import type { Transit } from '../src/data/types'
import type { ZoneOutlines } from '../src/data/zones'
import { cityEdge } from '../src/map/frame'
import { shortName, stationPoints } from '../src/map/transit'
import { CongestionLayer } from '../src/map/traffic'
import { breaks } from '../src/map/zones'

describe('station names', () => {
  it('keep the part people know a long official name by', () => {
    expect(shortName('Nadaprabhu Kempegowda Station, Majestic')).toBe('Majestic')
    expect(shortName('Indiranagar')).toBe('Indiranagar')
  })
})

describe('station marks', () => {
  const transit: Transit = {
    stations: [
      { id: 0, name: 'Majestic', nameKn: 'ಮೆಜೆಸ್ಟಿಕ್', at: [77.57, 12.97], kind: 'metro', interchange: 1 },
      { id: 1, name: 'Majestic', nameKn: null, at: [77.571, 12.971], kind: 'metro', interchange: 1 },
      { id: 2, name: 'City Railway Station', nameKn: null, at: [77.568, 12.978], kind: 'rail', interchange: 2 },
      { id: 3, name: 'Krantivira Sangolli Rayanna', nameKn: null, at: [77.567, 12.975], kind: 'metro', interchange: 2 },
      { id: 4, name: 'Cubbon Park', nameKn: null, at: [77.59, 12.98], kind: 'metro' },
    ],
    lines: [
      { id: 'purple', name: 'Purple', kind: 'metro', colour: '#8e3a9d', status: 'open', stations: [3, 0, 4], path: [] },
      { id: 'green', name: 'Green', kind: 'metro', colour: '#2e9b47', status: 'open', stations: [1], path: [] },
      { id: 'rail', name: 'Rail', kind: 'rail', colour: '#777777', status: 'open', stations: [2], path: [] },
    ],
  }
  const marks = stationPoints(transit).features.map((f) => f.properties!)

  it('draw an interchange as one mark', () => {
    expect(marks.filter((m) => m.en === 'Majestic')).toHaveLength(1)
    expect(marks).toHaveLength(3)
  })

  it('name where metro lines meet even with the whole city in view, but not a change to the railway', () => {
    expect(marks.find((m) => m.en === 'Majestic')!.hub).toBe(true)
    expect(marks.find((m) => m.en === 'Krantivira Sangolli Rayanna')!.hub).toBe(false)
    expect(marks.find((m) => m.en === 'Cubbon Park')!.interchange).toBe(false)
  })

  it('show a metro and railway interchange as the metro station', () => {
    expect(marks.find((m) => m.en === 'Krantivira Sangolli Rayanna')!.kind).toBe('metro')
  })
})

describe('shading breaks', () => {
  it('split the zones into fifths, in round numbers', () => {
    const values = Array.from({ length: 100 }, (_, i) => 1000 + i * 123)
    const b = breaks(values)
    expect(b).toHaveLength(4)
    for (const v of b) expect(v % 100).toBe(0)
    expect(b[0]).toBeLessThan(b[3]!)
  })
})

describe('the city’s edge', () => {
  const square = (id: number, x: number): ZoneOutlines['features'][number] => ({
    type: 'Feature',
    properties: { id },
    geometry: { type: 'Polygon', coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] },
  })
  const outlines: ZoneOutlines = { type: 'FeatureCollection', features: [square(0, 0), square(1, 1), square(2, 2)] }

  it('runs round the city’s zones as one ring, leaving out the sides they share', () => {
    const rings = cityEdge(outlines, new Set([0, 1]))
    expect(rings).toHaveLength(1)
    // Two squares side by side: six corners, and back to the first.
    expect(rings[0]).toHaveLength(7)
  })
})

describe('congestion on the map', () => {
  const calls: unknown[] = []
  const map = {
    addLayer: () => {},
    setFeatureState: (target: unknown, state: unknown) => calls.push([target, state]),
  } as unknown as ConstructorParameters<typeof CongestionLayer>[0]
  const layer = new CongestionLayer(map)

  it('colours every stretch the first time, and after that only those whose level changed', () => {
    layer.paint(new Uint8Array([0, 1, 2, 3]))
    expect(calls).toHaveLength(4)
    calls.length = 0
    layer.paint(new Uint8Array([0, 1, 3, 3]))
    expect(calls).toEqual([[{ source: 'network', id: 2 }, { level: 3 }]])
  })
})
