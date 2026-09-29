import type { Station, Transit, TransitLine, Zone } from '../src/data/types'
import type { CityState, RoutingLink, RoutingNetwork, RoutingNode } from '../src/sim/types'

/**
 * A small city for fast tests, in the agreed shapes: a 12 × 12 grid of junctions a kilometre apart (about 530
 * directed links), main roads every fourth line, four gateways at the edges, twelve zones, a metro line in service,
 * one being built, and a railway.
 */
export function fixtureCity(): CityState {
  const N = 12
  const lng0 = 77.55
  const lat0 = 12.93
  const dLng = 1 / 108.48 // a km east
  const dLat = 1 / 110.57 // a km north
  const at = (x: number, y: number): [number, number] => [lng0 + x * dLng, lat0 + y * dLat]
  const id = (x: number, y: number) => y * N + x

  const nodes: RoutingNode[] = []
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const [lng, lat] = at(x, y)
      const edge = (x === 0 || x === N - 1) && y === 4 || (y === 0 || y === N - 1) && x === 8
      nodes.push({ id: id(x, y), at: [Math.round(lng * 1e6), Math.round(lat * 1e6)], gateway: edge, signal: x % 4 === 0 && y % 4 === 0 })
    }
  }
  const links: RoutingLink[] = []
  const add = (a: number, b: number, main: boolean) => {
    for (const [from, to] of [[a, b], [b, a]] as const) {
      links.push({
        id: links.length,
        from,
        to,
        length: 1000,
        kind: main ? 'primary' : 'secondary',
        lanes: main ? 2 : 1,
        speed: main ? 50 : 30,
        capacity: main ? 2400 : 900,
        drawn: [links.length],
        forward: [from === a],
      })
    }
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (x + 1 < N) add(id(x, y), id(x + 1, y), y % 4 === 0)
      if (y + 1 < N) add(id(x, y), id(x, y + 1), x % 4 === 0)
    }
  }

  const spots: [number, number, number, number, 1 | 2 | 3 | 4 | 5][] = [
    // x, y, people, jobs, income
    [1, 1, 60_000, 10_000, 1],
    [5, 1, 50_000, 20_000, 2],
    [9, 1, 40_000, 15_000, 3],
    [2, 5, 45_000, 30_000, 2],
    [5, 5, 20_000, 120_000, 4],
    [6, 6, 15_000, 90_000, 5],
    [9, 5, 55_000, 25_000, 3],
    [1, 9, 70_000, 12_000, 1],
    [5, 9, 50_000, 18_000, 4],
    [10, 10, 35_000, 60_000, 5],
    [3, 3, 40_000, 8_000, 2],
    [8, 8, 30_000, 20_000, 3],
  ]
  const zones: Zone[] = spots.map(([x, y, people, jobs, income], k) => ({
    id: k,
    name: `Zone ${k}`,
    nameKn: null,
    node: id(x, y),
    centre: at(x + 0.3, y + 0.2),
    area: 2 + (k % 3),
    people,
    jobs,
    income,
    ...(k < 10 ? { ward: { corporation: 'Test', number: k + 1 } } : {}),
  }))
  const roads: RoutingNetwork = { nodes, links, zoneNode: zones.map((z) => z.node) }

  const stations: Station[] = []
  const station = (x: number, y: number, kind: 'metro' | 'rail', interchange?: number) => {
    stations.push({ id: stations.length, name: `S${stations.length}`, nameKn: null, at: at(x, y), kind, interchange })
    return stations.length - 1
  }
  const line = (lineId: string, kind: 'metro' | 'rail', status: 'open' | 'building', points: [number, number][]): TransitLine => {
    const ids = points.map(([x, y]) => station(x, y, kind))
    return { id: lineId, name: lineId, kind, colour: '#000', status, stations: ids, path: points.flatMap(([x, y]) => at(x, y)) }
  }
  const transit: Transit = {
    stations,
    lines: [
      line('east-west', 'metro', 'open', [[0, 5], [2, 5], [4, 5], [5.5, 5], [7, 5], [9, 5], [11, 5]]),
      line('north-south', 'metro', 'building', [[5, 0], [5, 3], [5, 6], [5, 9], [5, 11]]),
      line('railway', 'rail', 'open', [[1, 11], [1, 7], [3, 4], [6, 2], [11, 1]]),
    ],
  }
  return { month: 0, seed: 1, zones, roads, transit }
}

/**
 * A city with its roads in about the state the first season starts them in (slice 6): every main road at 44 and every
 * zone's streets at 50, the means of the rules' start (most main roads poor), at which the model is calibrated.
 */
export function asTheyAre(state: CityState): CityState {
  return { ...state, surface: state.roads.links.map(() => 44), streets: state.zones.map(() => 50) }
}
