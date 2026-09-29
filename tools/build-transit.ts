// Builds public/data/transit.json, the metro and suburban railway as they stand, from the OpenStreetMap layers that
// tools/fetch-city.sh saves.
// Run with: npx vite-node tools/build-transit.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import type { LngLat, Station, Transit, TransitLine, TransitStatus } from '../src/data/types'

interface LatLon {
  lat: number
  lon: number
}

interface Element {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: LatLon
  nodes?: number[]
  tags?: Record<string, string>
  geometry?: LatLon[]
  members?: { type: 'node' | 'way' | 'relation'; ref: number; role: string; lat?: number; lon?: number; geometry?: LatLon[] }[]
}

const WEST = 77.35
const SOUTH = 12.75
const EAST = 77.85
const NORTH = 13.2
const MX = 111_320 * Math.cos(((SOUTH + NORTH) / 2) * (Math.PI / 180))
const MY = 110_540
/** Stations of different lines this close together are one interchange. */
const INTERCHANGE = 250
/** A station belongs to a line whose track passes within this distance of it. */
const STATION_REACH = 120

/** Each metro line's own colour, as Namma Metro publishes it; the data's colour tags are loose ("yellow", "pink"). */
const METRO: { id: string; name: string; match: RegExp; colour: string }[] = [
  { id: 'purple', name: 'Purple Line', match: /purple/i, colour: '#8e3a9d' },
  { id: 'green', name: 'Green Line', match: /green/i, colour: '#2e9b47' },
  { id: 'yellow', name: 'Yellow Line', match: /yellow/i, colour: '#e3b505' },
  { id: 'pink', name: 'Pink Line', match: /pink/i, colour: '#e0579a' },
  { id: 'blue', name: 'Blue Line', match: /blue|phase 2a|phase 2b/i, colour: '#2f6fc0' },
]
/** Suburban railway has no colours of its own; a quiet grey keeps it below the metro. */
const RAIL_COLOUR = '#7a7a7a'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const layer = (name: string) =>
  JSON.parse(readFileSync(join(root, `tools/data/city.${name}.json`), 'utf8')) as {
    elements: Element[]
    osm3s?: { timestamp_osm_base?: string }
  }

const ll = (p: LatLon): LngLat => [p.lon, p.lat]
const metres = (p: LngLat, q: LngLat) => Math.hypot((q[0] - p[0]) * MX, (q[1] - p[1]) * MY)
const lengthOf = (line: LngLat[]) => line.reduce((sum, p, i) => (i === 0 ? 0 : sum + metres(line[i - 1]!, p)), 0)
const inside = ([x, y]: LngLat) => x >= WEST && x <= EAST && y >= SOUTH && y <= NORTH

/** The nearest point on a line to a point: how far along the line, how far off it, and whether it is past an end. */
function along(line: LngLat[], point: LngLat): { distance: number; offset: number; end: boolean } {
  let best = { distance: 0, offset: Infinity, end: true }
  let travelled = 0
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!
    const b = line[i]!
    const dx = (b[0] - a[0]) * MX
    const dy = (b[1] - a[1]) * MY
    const px = (point[0] - a[0]) * MX
    const py = (point[1] - a[1]) * MY
    const span = Math.hypot(dx, dy)
    const raw = span === 0 ? 0 : (px * dx + py * dy) / (span * span)
    const t = Math.max(0, Math.min(1, raw))
    const offset = Math.hypot(px - dx * t, py - dy * t)
    if (offset < best.offset) {
      const end = (i === 1 && raw <= 0) || (i === line.length - 1 && raw >= 1)
      best = { distance: travelled + span * t, offset, end }
    }
    travelled += span
  }
  return best
}

/** Drops points that lie within `tolerance` metres of the line through their neighbours. */
function simplify(points: LngLat[], tolerance: number): LngLat[] {
  if (points.length < 3) return points
  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = keep[points.length - 1] = true
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [first, last] = stack.pop()!
    let worst = 0
    let index = -1
    for (let i = first + 1; i < last; i++) {
      const { offset } = along([points[first]!, points[last]!], points[i]!)
      if (offset > worst) [worst, index] = [offset, i]
    }
    if (worst > tolerance && index > 0) {
      keep[index] = true
      stack.push([first, index], [index, last])
    }
  }
  return points.filter((_, i) => keep[i])
}

/**
 * Joins pieces of track into one line, end to nearest end, bridging gaps where the mapping has them. Track is often
 * mapped as two rails side by side; a piece that runs alongside what is already joined is left out. A piece only
 * counts as alongside where it lies beside the middle of the line, not past its ends, so that a short piece carrying
 * on from an end is kept.
 */
function chain(pieces: LngLat[][]): LngLat[] {
  const left = pieces.filter((p) => p.length > 1).sort((a, b) => lengthOf(b) - lengthOf(a))
  const line = [...left.shift()!]
  const beside = (piece: LngLat[]) =>
    piece.filter((p) => {
      const found = along(line, p)
      return found.offset < 40 && !found.end
    }).length >= piece.length * 0.6
  while (left.length > 0) {
    for (let i = left.length - 1; i >= 0; i--) if (beside(left[i]!)) left.splice(i, 1)
    if (left.length === 0) break
    let best = { i: 0, gap: Infinity, how: 0 }
    left.forEach((piece, i) => {
      const gaps = [
        metres(piece[0]!, line.at(-1)!),
        metres(piece.at(-1)!, line.at(-1)!),
        metres(piece.at(-1)!, line[0]!),
        metres(piece[0]!, line[0]!),
      ]
      gaps.forEach((gap, how) => {
        if (gap < best.gap) best = { i, gap, how }
      })
    })
    const piece = left.splice(best.i, 1)[0]!
    if (best.how === 0) line.push(...piece.slice(1))
    else if (best.how === 1) line.push(...[...piece].reverse().slice(1))
    else if (best.how === 2) line.unshift(...piece.slice(0, -1))
    else line.unshift(...[...piece].reverse().slice(0, -1))
  }
  return line
}

const track = layer('track').elements
const routes = layer('routes').elements
const stationLayer = layer('stations').elements
const dataDate = layer('routes').osm3s?.timestamp_osm_base ?? 'unknown date'

const stationAt = (e: Element): LngLat => (e.lat !== undefined ? [e.lon!, e.lat] : ll(e.center!))
const isMetroStation = (e: Element) => {
  const t = e.tags ?? {}
  return t.station === 'subway' || t.subway === 'yes' || /namma metro/i.test(`${t.network} ${t.operator}`)
}
const openStations = stationLayer.filter((e) => e.tags?.railway === 'station' || e.tags?.railway === 'halt')
const metroStations = openStations.filter(isMetroStation)
const railStations = openStations.filter((e) => !isMetroStation(e) && e.tags?.station !== 'monorail' && !!e.tags?.name)
const buildingStations = stationLayer.filter(
  (e) => (e.tags?.railway === 'construction' && e.tags.construction === 'station') || e.tags?.['construction:railway'] === 'station',
)

// Output, with one station per place: a station node used by two lines is one station.
const stations: Station[] = []
const lines: TransitLine[] = []
const stationIds = new Map<number, number>()
/** A station's name without the "(u/c)" that mappers add to stations being built; the line's status says so. */
const nameOf = (e: Element) =>
  (e.tags?.name ?? e.tags?.['name:en'] ?? '').replace(/\s*\(u\/c\)\s*$/i, '').replace(/ (railway|metro) station$/i, '').trim()
function stationFor(e: Element, kind: Station['kind']): number {
  let id = stationIds.get(e.id)
  if (id !== undefined) return id
  const at = stationAt(e)
  const name = nameOf(e)
  // A station is often mapped more than once (a point, the building, each line's platforms): one name at one place
  // is one station.
  id = stations.find((s) => s.kind === kind && s.name === name && metres(s.at, at) < 400)?.id
  if (id === undefined) {
    id = stations.length
    stations.push({
      id,
      name,
      nameKn: e.tags?.['name:kn']?.replace(/\s*\(.*\)\s*$/, '') || null,
      at: [Math.round(at[0] * 1e6) / 1e6, Math.round(at[1] * 1e6) / 1e6],
      kind,
    })
  }
  stationIds.set(e.id, id)
  return id
}
const flat = (line: LngLat[]) => simplify(line, 3).flatMap(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5])

/** The stations within reach of a line, in order along it. */
function servedBy(path: LngLat[], candidates: Element[]): Element[] {
  return candidates
    .map((e) => ({ e, ...along(path, stationAt(e)) }))
    .filter((found) => found.offset < STATION_REACH)
    .sort((a, b) => a.distance - b.distance)
    .map((found) => found.e)
}

// Metro lines in service: those with a Namma Metro route relation.
const report: string[] = []
const openIds = new Set<string>()
const openPaths: LngLat[][] = []
const onRoutes = new Set<number>()
for (const metro of METRO) {
  const own = routes.filter(
    (r) => r.tags?.route === 'subway' && /namma metro/i.test(r.tags.network ?? '') && metro.match.test(r.tags.name ?? ''),
  )
  if (own.length === 0) continue
  // The routes of a line (each direction, and short workings) are not always mapped alike: one may stop short of
  // the terminus. So the line is the track of all its routes joined, and its stations all the stops any of them
  // lists, in order along the track.
  const pieces: LngLat[][] = []
  const stops: LngLat[] = []
  for (const r of own) {
    for (const m of r.members ?? []) {
      if (m.type === 'way') onRoutes.add(m.ref)
      if (m.type === 'way' && m.geometry && m.role === '') pieces.push(m.geometry.map(ll))
      if (m.type === 'node' && /^stop/.test(m.role) && m.lat !== undefined) stops.push([m.lon!, m.lat])
    }
  }
  const path = chain(pieces)
  openPaths.push(path)
  const served = new Map<number, Element>()
  for (const at of stops) {
    // Each stop is taken to the station it stands in.
    const near = metroStations
      .map((e) => ({ e, d: metres(at, stationAt(e)) }))
      .filter((found) => found.d < 400)
      .sort((a, b) => a.d - b.d)[0]
    if (near) served.set(stationFor(near.e, 'metro'), near.e)
  }
  const ordered = [...served.entries()].sort((a, b) => along(path, stationAt(a[1])).distance - along(path, stationAt(b[1])).distance)
  lines.push({
    id: metro.id,
    name: metro.name,
    kind: 'metro',
    colour: metro.colour,
    status: 'open',
    stations: ordered.map(([id]) => id),
    path: flat(path),
  })
  openIds.add(metro.id)
  report.push(`${metro.name}: open, from ${own.length} routes: ${own.map((r) => `${r.id} "${r.tags!.name}"`).join(', ')}`)
}

// Metro lines under construction: track tagged as being built, or laid but on no route, that is not yard or depot.
const building = new Map<string, LngLat[][]>()
for (const e of track) {
  const t = e.tags ?? {}
  if (!e.geometry || t.service) continue
  const metroTrack = t.railway === 'subway' || (t.railway === 'construction' && t.construction === 'subway')
  if (!metroTrack || onRoutes.has(e.id) || /depot|test track/i.test(t.name ?? '')) continue
  // The second rail of a line in service, where its routes list only one.
  const piece = e.geometry.map(ll)
  const beside = (path: LngLat[]) => piece.filter((p) => along(path, p).offset < 40).length >= piece.length * 0.6
  if (openPaths.some(beside)) continue
  const metro = METRO.find((m) => m.match.test(`${t.name ?? ''} ${t.colour ?? ''}`))
  const id = metro?.id ?? (t.name ?? 'unnamed').toLowerCase().replace(/[^a-z0-9]+/g, '-')
  // Pieces of a line in service that are still being built extend it; they are drawn as a line being built.
  const key = metro && openIds.has(metro.id) ? `${metro.id}-extension` : id
  building.set(key, [...(building.get(key) ?? []), piece])
}
for (const [key, pieces] of building) {
  const metro = METRO.find((m) => key.startsWith(m.id))
  const path = chain(pieces)
  // Stations being built carry the line's name only in their own; those of lines in service it meets are found as
  // interchanges below.
  const served = servedBy(path, buildingStations.filter((e) => nameOf(e) !== ''))
  if (lengthOf(path) < 1000 || served.length < 2) {
    const [x, y] = path[0]!
    report.push(`left out ${key}: ${Math.round(lengthOf(path))} m of track, ${served.length} stations, near ${y.toFixed(3)} N ${x.toFixed(3)} E`)
    continue
  }
  const west = path[0]![0] <= path.at(-1)![0]
  lines.push({
    id: key,
    name: metro ? (key.endsWith('-extension') ? `${metro.name} extension` : metro.name) : key,
    kind: 'metro',
    colour: metro?.colour ?? '#999999',
    status: 'building' as TransitStatus,
    stations: [...new Set((west ? served : [...served].reverse()).map((e) => stationFor(e, 'metro')))],
    path: flat(west ? path : [...path].reverse()),
  })
  report.push(`${key}: building, ${pieces.length} pieces of track, ${Math.round(lengthOf(path) / 1000)} km`)
}

// Suburban railway. Bengaluru's suburban trains run on the main railway lines, and the data has no route for most
// of them, so each line here is the railway from the city station out to where a line leaves the map, found as the
// shortest way over the main track.
const key = ([x, y]: LngLat) => `${x},${y}`
const graph = new Map<string, { to: string; length: number }[]>()
const pointOf = new Map<string, LngLat>()
const exits: LngLat[] = []
for (const e of track) {
  const t = e.tags ?? {}
  if (t.railway !== 'rail' || !e.geometry) continue
  const points = e.geometry.map(ll)
  points.forEach((p, i) => {
    pointOf.set(key(p), p)
    const q = points[i - 1]
    if (!q) return
    // Station and yard tracks join the main lines at the big stations, but trains keep to the main line elsewhere.
    const length = metres(p, q) * (t.service ? 5 : 1)
    for (const [from, to] of [[p, q], [q, p]] as const) {
      const list = graph.get(key(from)) ?? graph.set(key(from), []).get(key(from))!
      list.push({ to: key(to), length })
    }
    if (!t.service && inside(p) !== inside(q)) exits.push(inside(p) ? p : q)
  })
}
// Double track leaves the map as two or more rails; one exit stands for them all.
const railExits: LngLat[] = []
for (const exit of exits) if (!railExits.some((e) => metres(e, exit) < 1500)) railExits.push(exit)
/** Distances over the track from a point, with the way back to it. */
function over(start: string) {
  const distance = new Map<string, number>([[start, 0]])
  const previous = new Map<string, string>()
  const open = new Set([start])
  while (open.size > 0) {
    // The track has a few thousand points, so a plain search for the nearest open point is quick enough.
    let at = ''
    for (const k of open) if (!at || distance.get(k)! < distance.get(at)!) at = k
    open.delete(at)
    for (const { to, length } of graph.get(at) ?? []) {
      const d = distance.get(at)! + length
      if (d < (distance.get(to) ?? Infinity)) {
        distance.set(to, d)
        previous.set(to, at)
        open.add(to)
      }
    }
  }
  return { distance, previous }
}
/** Searches from the track nearest a station, moving out until most of the track can be reached: platform tracks are often mapped apart. */
function from(station: Element) {
  const byDistance = [...pointOf.keys()].sort(
    (a, b) => metres(pointOf.get(a)!, stationAt(station)) - metres(pointOf.get(b)!, stationAt(station)),
  )
  let search = over(byDistance[0]!)
  for (const start of byDistance) {
    if (search.distance.size > pointOf.size / 2) break
    if (!search.distance.has(start)) search = over(start)
  }
  return search
}
// Lines run out from the city station, then from the two junctions whose lines pass it by. A line from a junction is
// kept only where it serves a station that no line before it does, such as the chords through Hebbal and Channasandra.
const HUBS = [/Sangolli Rayanna|^KSR Bengaluru/i, /^Yesvantpur|^Yeshwantpur/i, /^Baiy+appanahalli/i]
const railServed = new Set<number>()
for (const pattern of HUBS) {
  const hub = railStations.find((e) => pattern.test(e.tags?.name ?? ''))
  if (!hub) throw new Error(`No station matching ${pattern} in the data.`)
  const { distance, previous } = from(hub)
  for (const exit of railExits) {
    let at: string | undefined = key(exit)
    if (!distance.has(at)) continue
    const path: LngLat[] = []
    while (at) path.push(pointOf.get(at)!), (at = previous.get(at))
    path.reverse()
    const served = [...new Set(servedBy(path, railStations).map((e) => stationFor(e, 'rail')))]
    if (served.length < 2 || served.every((s) => railServed.has(s))) continue
    served.forEach((s) => railServed.add(s))
    const first = stations[served[0]!]!.name
    const last = stations[served.at(-1)!]!.name
    lines.push({
      id: `rail-${first}-${last}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name: `${first} to ${last}`,
      kind: 'rail',
      colour: RAIL_COLOUR,
      status: 'open',
      stations: served,
      path: flat(path),
    })
  }
}

// Interchanges: a metro station shared by two lines, or at the same place as a station of another line. The railway
// lines share stations too, but running on from one to the other is not a change of line.
const metroLines = lines.filter((l) => l.kind === 'metro')
const linesAt = new Map<number, number>()
for (const line of metroLines) for (const s of line.stations) linesAt.set(s, (linesAt.get(s) ?? 0) + 1)
let interchanges = 0
for (const line of metroLines) {
  for (const s of line.stations) {
    const station = stations[s]!
    const near = stations.filter((o) => o.id !== s && metres(o.at, station.at) < INTERCHANGE && !line.stations.includes(o.id))
    if (near.length === 0 && linesAt.get(s)! < 2) continue
    const number = station.interchange ?? near.find((o) => o.interchange !== undefined)?.interchange ?? interchanges++
    station.interchange = number
    for (const o of near) o.interchange = number
  }
}

const transit: Transit = { stations, lines }
const text = JSON.stringify(transit)
writeFileSync(join(root, 'public/data/transit.json'), text)
console.log(`data of ${dataDate}`)
for (const r of report) console.log(r)
for (const line of lines) {
  console.log(`\n${line.name} (${line.status}), ${line.stations.length} stations:`)
  console.log(line.stations.map((s) => stations[s]!.name).join(' - '))
}
const groups = new Map<number, string[]>()
for (const s of stations) if (s.interchange !== undefined) groups.set(s.interchange, [...(groups.get(s.interchange) ?? []), s.name])
console.log('\ninterchanges:', [...groups.values()].map((g) => g.join(' / ')).join('; '))
console.log(`${Math.round(text.length / 1024)} KB, ${Math.round(gzipSync(text).length / 1024)} KB compressed`)
