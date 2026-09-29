// A city with many more lines than Bengaluru has, for measuring how long a month takes (tools/measure-line.ts --load,
// tools/run-month.ts --engines --loaded).
import type { Station, TransitLine } from '../src/data/types'
import type { CityState } from '../src/sim/types'

/**
 * The city with ten more metro lines (16 stations over 24 km, through the middle at every 18°) and twenty bus routes
 * (25 stops over 16 km, at every 9°, crossing a little off the middle), all open.
 */
export function loaded(state: CityState): CityState {
  const stations: Station[] = [...state.transit.stations]
  const lines: TransitLine[] = [...state.transit.lines]
  const vehicles: Record<string, number> = {}
  let next = stations.reduce((m, s) => Math.max(m, s.id), -1) + 1
  const add = (id: string, kind: 'metro' | 'bus', angle: number, km: number, stops: number, off: number) => {
    const ids: number[] = []
    const c = Math.cos((angle * Math.PI) / 180)
    const s = Math.sin((angle * Math.PI) / 180)
    for (let k = 0; k < stops; k++) {
      const t = (k / (stops - 1) - 0.5) * km
      const x = t * c - off * s
      const y = t * s + off * c
      stations.push({ id: next, name: `${id} ${k}`, nameKn: null, at: [77.59 + x / 108.48, 12.97 + y / 110.57], kind })
      ids.push(next++)
    }
    lines.push({ id, name: id, kind, colour: '#888888', status: 'open', stations: ids, path: [] })
  }
  for (let k = 0; k < 10; k++) add(`metro-${k}`, 'metro', k * 18, 24, 16, 0)
  for (let k = 0; k < 20; k++) {
    add(`bus-${k}`, 'bus', k * 9 + 4, 16, 25, 1.5)
    vehicles[`bus-${k}`] = 30
  }
  return { ...state, transit: { stations, lines }, vehicles }
}

