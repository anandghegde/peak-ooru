// Which roads lie low, for the monsoon (slice 6, PRD EVT-1): builds src/sim/lowland.ts, the routing links that flood,
// and checks the list against the flood-prone spots the city and the press name.
//   npx vite-node tools/measure-lowland.ts            build the list and check it
//   npx vite-node tools/measure-lowland.ts --check    only check (the list and other rules beside it), writing nothing
//
// There is no terrain in the game's data. The stand-in: a link lies low if it is an underpass (a drawn stretch below
// ground), or if both
//   - it runs near water: within DRAIN_M metres of a storm-water drain, stream, river or canal, or within LAKE_M of the
//     shore of a lake or reservoir of LAKE_HA hectares or more (OpenStreetMap: the city's extract of slice 1); and
//   - the road dips there: the lowest ground under it is DIP_M metres or more below the average of the lowest ground
//     under the links within two junctions of it (SRTM heights, from the AWS terrain tiles, about 30 m).
// So a road on a ridge or a hilltop is never marked, and a road beside a drain is marked only where it runs down to it.
// Downloads, if not there: the terrain tiles (tools/data/dem/) and the city's three maps of flood points (KSRSAC for the
// BBMP, via OpenCity: tools/data/bbmp-*.kml). Needs osmium-tool and gdal.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Network } from '../src/data/types'
import { toKm } from '../src/sim/graph'
import type { RoutingNetwork } from '../src/sim/types'

const DRAIN_M = 25
const LAKE_M = 40
const LAKE_HA = 5
const DIP_M = 5
/** A spot counts as caught if a marked link passes within this many metres of it. */
const CAUGHT_M = 300
/**
 * Slice 7: the roads within this many metres of a spot that floods every year, named in the published lists, are marked
 * too (or, where none passes so close, the four nearest within three times as far).
 */
const NAMED_M = 200

const data = (f: string) => new URL(`./data/${f}`, import.meta.url).pathname
const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../public/data/${file}`, import.meta.url), 'utf8')) as T

/**
 * Road spots that flood, as the city, the traffic police and the press name them (2023–2026), where each is: judgement
 * from maps, to a few hundred metres, not checked on a map one by one. Sources in docs/MODEL.md, "Slice 6".
 */
const PRESS: [string, number, number][] = [
  ['Silk Board junction', 12.9172, 77.6229], ['Outer Ring Road at Bellandur', 12.9266, 77.6784],
  ['Outer Ring Road at Marathahalli bridge', 12.9569, 77.7011], ['Sarjapur Road at Iblur', 12.9223, 77.6653],
  ['KR Puram', 13.007, 77.696], ['Benniganahalli bridge', 12.996, 77.664], ['Hebbal flyover', 13.0405, 77.5897],
  ['Hebbal–Kempapura', 13.047, 77.601], ['Veerannapalya, Manyata', 13.043, 77.62], ['Manpho Convention Centre', 13.043, 77.626],
  ['Hennur–Bagalur Road', 13.035, 77.645], ['Amruthahalli', 13.066, 77.602], ['Kogilu Cross', 13.106, 77.596],
  ['Bhadrappa Layout', 13.058, 77.589], ['Tindlu underpass', 13.069, 77.57], ['Kodigehalli underpass', 13.06, 77.58],
  ['Devinagar underpass', 13.028, 77.57], ['Anandnagar underpass', 13.033, 77.588], ['Sanjaynagar Cross', 13.036, 77.576],
  ['Mekhri Circle underpass', 13.0141, 77.5836], ['CNR Rao Circle underpass', 13.015, 77.571], ['BEL Circle', 13.0445, 77.556],
  ['Kaveri Theatre underpass', 13.0005, 77.578], ['Cunningham–Sankey Road underpass', 12.9905, 77.585],
  ['Basaveshwara Circle', 12.9876, 77.5857], ['Ramana Maharshi Road', 13.008, 77.578], ['Jayamahal Road', 13.0, 77.596],
  ['Cantonment underpass', 12.9935, 77.599], ['KR Circle underpass', 12.9745, 77.587], ['Kempegowda Road', 12.976, 77.579],
  ['Okalipuram underpass', 12.984, 77.561], ['Nayandahalli underpass', 12.941, 77.522], ['Goraguntepalya', 13.028, 77.54],
  ['Peenya 3rd Phase', 13.029, 77.514], ['Sony World signal, Koramangala', 12.937, 77.627], ['Wind Tunnel Road', 12.957, 77.652],
  ['MG Road, Shantala Nagar', 12.973, 77.606], ['Tavarekere Main Road', 12.928, 77.61], ['Varthur Kodi', 12.954, 77.747],
  ['Panathur underpass', 12.935, 77.701], ['Doddanekkundi underpass', 12.978, 77.696], ['Hoodi', 12.991, 77.716],
  ['Whitefield Main Road, Hope Farm', 12.983, 77.752], ['Kumaraswamy Layout', 12.906, 77.562],
]

/** The city's maps of flood points (KSRSAC for the BBMP), from OpenCity. */
const KML = 'https://data.opencity.in/dataset/b03218ea-4b7c-4fa9-ab67-b9054d7ecc4c/resource'
const MAPS: [string, string, string][] = [
  ['BBMP flood-vulnerable locations', 'bbmp-flood-vulnerable.kml', `${KML}/a7d8a01f-1fbc-41e1-85f0-f15ea16b2d27/download/6b3c63b0-f461-4e9c-a2c2-006f734c5b41.kml`],
  ['BBMP flood-prone locations', 'bbmp-flood-prone.kml', `${KML}/d90fe768-caba-4c6e-b6b5-a75acd5e88a9/download/00fb1229-dcfd-4f59-813f-885e0c629add.kml`],
  ['BBMP low-lying areas', 'bbmp-low-lying.kml', `${KML}/62ceac3b-f6e2-4dd1-ae9f-be80b1f2fda8/download/8e87a2fc-e014-4c6e-81f1-d5cb4db57a46.kml`],
]

function spots(): [string, [number, number][]][] {
  const out: [string, [number, number][]][] = [['named road spots (press, 2023–2026)', PRESS.map(([, lat, lng]) => [lng, lat])]]
  for (const [name, file, url] of MAPS) {
    if (!existsSync(data(file))) execFileSync('curl', ['-sSL', '--fail', '-o', data(file), url])
    const text = readFileSync(data(file), 'utf8')
    const pts: [number, number][] = []
    for (const m of text.matchAll(/<Placemark[\s\S]*?<coordinates>\s*([-\d.]+),([-\d.]+)/g)) pts.push([Number(m[1]), Number(m[2])])
    out.push([name, pts])
  }
  return out
}

/** Heights: SRTM from the AWS terrain tiles (zoom 12, GeoTIFF), put together over the map at 0.0002° a cell. */
interface Terrain {
  cols: number
  rows: number
  west: number
  north: number
  cell: number
  z: Float64Array
}

function terrain(): Terrain {
  const dir = data('dem')
  mkdirSync(dir, { recursive: true })
  const asc = join(dir, 'dem.asc')
  if (!existsSync(asc)) {
    const tiles: string[] = []
    for (let x = 2928; x <= 2933; x++) {
      for (let y = 1896; y <= 1901; y++) {
        const f = join(dir, `12-${x}-${y}.tif`)
        if (!existsSync(f)) execFileSync('curl', ['-sSL', '--fail', '-o', f, `https://s3.amazonaws.com/elevation-tiles-prod/geotiff/12/${x}/${y}.tif`])
        tiles.push(f)
      }
    }
    execFileSync('gdalbuildvrt', ['-q', '-overwrite', join(dir, 'all.vrt'), ...tiles])
    execFileSync('gdalwarp', ['-q', '-overwrite', '-t_srs', 'EPSG:4326', '-te', '77.35', '12.75', '77.85', '13.2', '-tr', '0.0002', '0.0002', '-r', 'bilinear', join(dir, 'all.vrt'), join(dir, 'dem.tif')])
    execFileSync('gdal_translate', ['-q', '-of', 'AAIGrid', join(dir, 'dem.tif'), asc])
  }
  const lines = readFileSync(asc, 'utf8').split('\n')
  const head = (k: number) => Number(lines[k]!.trim().split(/\s+/)[1])
  const cols = head(0), rows = head(1), west = head(2), south = head(3), cell = head(4)
  const z = new Float64Array(cols * rows)
  let k = 0
  for (let r = 6; r < lines.length && k < z.length; r++) for (const v of lines[r]!.trim().split(/\s+/)) if (v) z[k++] = Number(v)
  return { cols, rows, west, north: south + rows * cell, cell, z }
}

function heightAt(t: Terrain, lng: number, lat: number): number {
  const c = Math.floor((lng - t.west) / t.cell)
  const r = Math.floor((t.north - lat) / t.cell)
  if (c < 0 || r < 0 || c >= t.cols || r >= t.rows) return NaN
  return t.z[r * t.cols + c]!
}

interface Water {
  /** Segments in km, four numbers each: x1, y1, x2, y2; and whether each is a lake's shore. */
  seg: number[]
  shore: number[]
}

function loadWater(): Water {
  const dir = mkdtempSync(join(tmpdir(), 'lowland-'))
  const cut = join(dir, 'water.osm.pbf')
  const out = join(dir, 'water.geojsonseq')
  execFileSync('osmium', ['tags-filter', data('city.osm.pbf'), 'w/waterway=drain,stream,river,canal', 'nwr/natural=water', 'nwr/landuse=reservoir', '-o', cut, '--overwrite'])
  execFileSync('osmium', ['export', cut, '-f', 'geojsonseq', '-o', out, '--overwrite'])
  const water: Water = { seg: [], shore: [] }
  const a = new Float64Array(2)
  const b = new Float64Array(2)
  const addLine = (pts: number[][], shore: boolean) => {
    for (let k = 1; k < pts.length; k++) {
      toKm(pts[k - 1]![0]!, pts[k - 1]![1]!, a, 0)
      toKm(pts[k]![0]!, pts[k]![1]!, b, 0)
      water.seg.push(a[0]!, a[1]!, b[0]!, b[1]!)
      water.shore.push(shore ? 1 : 0)
    }
  }
  for (const text of readFileSync(out, 'utf8').split('\n')) {
    const line = text.replace(/^\x1e/, '').trim()
    if (!line) continue
    const f = JSON.parse(line) as { geometry: { type: string; coordinates: unknown }; properties: Record<string, string> }
    const p = f.properties
    const g = f.geometry
    if (p.waterway && ['drain', 'stream', 'river', 'canal'].includes(p.waterway)) {
      if (g.type === 'LineString') addLine(g.coordinates as number[][], false)
      else if (g.type === 'MultiLineString') for (const l of g.coordinates as number[][][]) addLine(l, false)
      continue
    }
    if (g.type !== 'MultiPolygon' && g.type !== 'Polygon') continue
    if (p.natural !== 'water' && p.landuse !== 'reservoir') continue
    if (p.water && !['lake', 'reservoir', 'river'].includes(p.water)) continue
    const polys = g.type === 'Polygon' ? [g.coordinates as number[][][]] : (g.coordinates as number[][][][])
    for (const poly of polys) {
      const r = new Float64Array(poly[0]!.length * 2)
      poly[0]!.forEach(([lng, lat], k) => toKm(lng!, lat!, r, 2 * k))
      if (area(r) * 100 < LAKE_HA) continue
      addLine(poly[0]!, true)
    }
  }
  return water
}

/** Km² of a ring. */
function area(r: Float64Array): number {
  let s = 0
  for (let k = 0, n = r.length / 2; k < n; k++) {
    const j = (k + 1) % n
    s += r[2 * k]! * r[2 * j + 1]! - r[2 * j]! * r[2 * k + 1]!
  }
  return Math.abs(s) / 2
}

function segDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1
  const len = dx * dx + dy * dy
  let t = len > 0 ? ((px - x1) * dx + (py - y1) * dy) / len : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const ex = x1 + t * dx - px, ey = y1 + t * dy - py
  return Math.sqrt(ex * ex + ey * ey)
}

/** A grid of the water's segments, 250 m a cell, for finding those near a point. */
class Grid {
  readonly cells = new Map<string, number[]>()
  constructor(readonly water: Water, readonly size = 0.25) {
    const s = water.seg
    for (let k = 0; k < s.length / 4; k++) {
      const x0 = Math.floor(Math.min(s[4 * k]!, s[4 * k + 2]!) / size), x1 = Math.floor(Math.max(s[4 * k]!, s[4 * k + 2]!) / size)
      const y0 = Math.floor(Math.min(s[4 * k + 1]!, s[4 * k + 3]!) / size), y1 = Math.floor(Math.max(s[4 * k + 1]!, s[4 * k + 3]!) / size)
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) (this.cells.get(`${x},${y}`) ?? this.cells.set(`${x},${y}`, []).get(`${x},${y}`)!).push(k)
    }
  }
  /** Metres to the nearest drain or stream, and to the nearest lake shore, from a point in km. */
  near(x: number, y: number): [number, number] {
    let drain = Infinity, lake = Infinity
    const cx = Math.floor(x / this.size), cy = Math.floor(y / this.size)
    const s = this.water.seg
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cy - 1; j <= cy + 1; j++) {
        for (const k of this.cells.get(`${i},${j}`) ?? []) {
          const d = segDist(x, y, s[4 * k]!, s[4 * k + 1]!, s[4 * k + 2]!, s[4 * k + 3]!) * 1000
          if (this.water.shore[k]) lake = Math.min(lake, d)
          else drain = Math.min(drain, d)
        }
      }
    }
    return [drain, lake]
  }
}

/**
 * For each routing link, from points every 25 m along its drawn stretches: metres to the nearest drain and lake shore,
 * the lowest ground under it, how far that lies below the lowest ground of the links within two junctions (the dip),
 * whether it is an underpass; and the points themselves, in km.
 */
function measure(roads: RoutingNetwork, network: Network, water: Water, t: Terrain) {
  const grid = new Grid(water)
  const stretch = new Map(network.links.map((l) => [l.id, l]))
  const L = roads.links.length
  const drain = new Float64Array(L).fill(Infinity)
  const lake = new Float64Array(L).fill(Infinity)
  const low = new Float64Array(L).fill(NaN)
  const under = new Uint8Array(L)
  const pts: number[][] = roads.links.map(() => [])
  const q = new Float64Array(2)
  for (const l of roads.links) {
    for (const id of l.drawn) {
      const s = stretch.get(id)
      if (!s) continue
      if ((s.level ?? 0) < 0) under[l.id] = 1
      const line = s.line
      for (let k = 0; k + 1 < line.length; k += 2) {
        const last = k + 3 >= line.length
        const [a, b] = [line[k]!, line[k + 1]!]
        const [c, d] = last ? [a, b] : [line[k + 2]!, line[k + 3]!]
        toKm(a, b, q, 0)
        const x0 = q[0]!, y0 = q[1]!
        toKm(c, d, q, 0)
        const steps = Math.max(1, Math.ceil(Math.sqrt((q[0]! - x0) ** 2 + (q[1]! - y0) ** 2) / 0.025))
        for (let i = 0; i <= steps; i++) {
          const lng = a + ((c - a) * i) / steps, lat = b + ((d - b) * i) / steps
          toKm(lng, lat, q, 0)
          const [dr, sh] = grid.near(q[0]!, q[1]!)
          if (dr < drain[l.id]!) drain[l.id] = dr
          if (sh < lake[l.id]!) lake[l.id] = sh
          const h = heightAt(t, lng, lat)
          if (!(h >= low[l.id]!)) low[l.id] = Number.isNaN(low[l.id]!) || h < low[l.id]! ? h : low[l.id]!
          pts[l.id]!.push(q[0]!, q[1]!)
        }
        if (last) break
      }
    }
  }
  // The dip: against the links within two junctions (sharing an end, or an end of one that does).
  const at = new Map<number, number[]>()
  for (const l of roads.links) {
    if (l.from === l.to) continue
    for (const n of [l.from, l.to]) (at.get(n) ?? at.set(n, []).get(n)!).push(l.id)
  }
  const dip = new Float64Array(L).fill(-Infinity)
  for (const l of roads.links) {
    if (l.from === l.to || Number.isNaN(low[l.id]!)) continue
    const seen = new Set<number>([l.id])
    let front = [l.id]
    for (let hop = 0; hop < 2; hop++) {
      const next: number[] = []
      for (const i of front) for (const n of [roads.links[i]!.from, roads.links[i]!.to]) for (const j of at.get(n) ?? []) if (!seen.has(j)) { seen.add(j); next.push(j) }
      front = next
    }
    seen.delete(l.id)
    let sum = 0, n = 0
    for (const j of seen) if (!Number.isNaN(low[j]!)) { sum += low[j]!; n++ }
    if (n > 0) dip[l.id] = sum / n - low[l.id]!
  }
  return { drain, lake, low, dip, under, pts }
}
type Measured = ReturnType<typeof measure>

function pick(roads: RoutingNetwork, m: Measured, drainM: number, lakeM: number, dipM: number): number[] {
  return roads.links
    .filter((l) => l.from !== l.to && (m.under[l.id] || ((m.drain[l.id]! <= drainM || m.lake[l.id]! <= lakeM) && m.dip[l.id]! >= dipM)))
    .map((l) => l.id)
}

/**
 * How good a list is against each set of published points. A point is reachable if any link passes within CAUGHT_M of
 * it, and caught if a marked one does. The points lie mostly in the dense centre, where many links pass near each, so
 * a list picked at random would catch many: `chance` is what one of the same size is expected to catch. Link by link:
 * the share marked of the links near published points, against the share of the other links in the same area (within
 * 2.5 km of a point): `ratio` above 1 means the list finds the flooding roads better than chance.
 */
function check(roads: RoutingNetwork, m: Measured, sets: [string, [number, number][]][], ids: number[]) {
  const L = roads.links.length
  const marked = new Uint8Array(L)
  for (const id of ids) marked[id] = 1
  const real = roads.links.filter((l) => l.from !== l.to).map((l) => l.id)
  const p = ids.length / real.length
  const nearLinks = (x: number, y: number, km: number) => {
    const out: number[] = []
    for (const id of real) {
      const pts = m.pts[id]!
      for (let k = 0; k < pts.length; k += 2) if ((pts[k]! - x) ** 2 + (pts[k + 1]! - y) ** 2 <= km * km) { out.push(id); break }
    }
    return out
  }
  const q = new Float64Array(2)
  const near = new Uint8Array(L)
  const area = new Uint8Array(L)
  const lines: string[] = []
  for (const [name, pts] of sets) {
    let reach = 0, caught = 0, chance = 0
    for (const [lng, lat] of pts) {
      toKm(lng, lat, q, 0)
      const ns = nearLinks(q[0]!, q[1]!, CAUGHT_M / 1000)
      for (const id of nearLinks(q[0]!, q[1]!, 2.5)) area[id] = 1
      if (ns.length === 0) continue
      reach++
      for (const id of ns) near[id] = 1
      if (ns.some((id) => marked[id])) caught++
      chance += 1 - (1 - p) ** ns.length
    }
    lines.push(`    ${name}: ${pts.length} points, ${reach} with a road within ${CAUGHT_M} m; caught ${caught} (${((100 * caught) / reach).toFixed(0)}%), a list at random ${chance.toFixed(0)}`)
  }
  let a = 0, an = 0, b = 0, bn = 0
  for (const id of real) {
    if (!area[id]) continue
    if (near[id]) { an++; a += marked[id]! } else { bn++; b += marked[id]! }
  }
  lines.push(`    link by link: marked ${((100 * a) / an).toFixed(1)}% of the ${an} links near a published point, ${((100 * b) / bn).toFixed(1)}% of the other ${bn} nearby; ratio ${(a / an / (b / bn)).toFixed(2)}`)
  return lines.join('\n')
}

function main() {
  const onlyCheck = process.argv.includes('--check')
  const roads = read<RoutingNetwork>('routing.json')
  const network = read<Network>('network.json')
  const sets = spots()
  const t = terrain()
  const water = loadWater()
  console.log(`water: ${water.seg.length / 4} segments of drains, streams, rivers, canals and the shores of lakes of ${LAKE_HA} ha or more`)
  const m = measure(roads, network, water, t)
  const km = (ids: number[]) => ids.reduce((a, id) => a + roads.links[id]!.length, 0) / 1000
  const real = roads.links.filter((l) => l.from !== l.to)
  const allKm = km(real.map((l) => l.id))
  const report = (label: string, ids: number[]) =>
    console.log(`${label}: ${ids.length} links (${((100 * ids.length) / real.length).toFixed(1)}%), ${km(ids).toFixed(0)} of ${allKm.toFixed(0)} km\n${check(roads, m, sets, ids)}`)
  const found = pick(roads, m, DRAIN_M, LAKE_M, DIP_M)
  report(`from the terrain: underpasses, and near water (drains ${DRAIN_M} m, lakes ${LAKE_M} m) where the road dips ${DIP_M} m or more`, found)
  // Slice 7: beside those, the roads at the spots the city, the traffic police and the press name as flooding every
  // year (KR Puram, Hebbal, Manyata and the rest the terrain misses), by name.
  const byName = new Map<string, number[]>()
  for (const [n, lat, lng] of PRESS) {
    const q = new Float64Array(2)
    toKm(lng, lat, q, 0)
    const gap = (id: number) => {
      const pts = m.pts[id]!
      let d = Infinity
      for (let k = 0; k < pts.length; k += 2) d = Math.min(d, Math.sqrt((pts[k]! - q[0]!) ** 2 + (pts[k + 1]! - q[1]!) ** 2) * 1000)
      return d
    }
    let near = real.filter((l) => gap(l.id) <= NAMED_M).map((l) => l.id)
    // Where no road passes that close (the spot is placed from maps, to a few hundred metres), the four nearest within 600 m.
    if (near.length === 0) near = real.map((l) => l.id).filter((id) => gap(id) <= 3 * NAMED_M).sort((a, b) => gap(a) - gap(b) || a - b).slice(0, 4)
    byName.set(n, near.sort((a, b) => a - b))
  }
  const named = new Set([...byName.values()].flat())
  const ids = [...new Set([...found, ...named])].sort((a, b) => a - b)
  report(`the list: those, and the roads within ${NAMED_M} m of the ${PRESS.length} named spots (${named.size} links, ${[...named].filter((id) => !found.includes(id)).length} of them new)`, ids)
  // Hilltops and ridges: links whose lowest ground is above that of the links around them.
  const high = real.filter((l) => m.dip[l.id]! < 0)
  console.log(`  of the ${high.length} links whose ground is higher than that of the links around them (ridges, hilltops, slopes up), marked: ${high.filter((l) => ids.includes(l.id)).length}, all underpasses`)
  const caught = PRESS.map(([n, lat, lng]) => {
    const q = new Float64Array(2)
    toKm(lng, lat, q, 0)
    const hit = found.some((id) => {
      const pts = m.pts[id]!
      for (let k = 0; k < pts.length; k += 2) if ((pts[k]! - q[0]!) ** 2 + (pts[k + 1]! - q[1]!) ** 2 <= (CAUGHT_M / 1000) ** 2) return true
      return false
    })
    return `${hit ? '+' : '-'}${n}`
  })
  console.log(`  named spots caught by the terrain alone (+ caught, - missed): ${caught.join('; ')}`)
  if (onlyCheck) {
    const under = real.filter((l) => m.under[l.id]).map((l) => l.id)
    report('underpasses alone', under)
    report(`near water alone (drains ${DRAIN_M} m, lakes ${LAKE_M} m)`, real.filter((l) => m.under[l.id] || m.drain[l.id]! <= DRAIN_M || m.lake[l.id]! <= LAKE_M).map((l) => l.id))
    report(`dips of ${DIP_M} m alone`, real.filter((l) => m.under[l.id] || m.dip[l.id]! >= DIP_M).map((l) => l.id))
    report('near water where the road dips 3 m', pick(roads, m, DRAIN_M, LAKE_M, 3))
    report('near water where the road dips 8 m', pick(roads, m, DRAIN_M, LAKE_M, 8))
    return
  }
  const under = ids.filter((id) => m.under[id])
  const body = [
    '// Written by tools/measure-lowland.ts: do not edit by hand. See docs/MODEL.md, "Slice 6", "Where the roads flood".',
    '/**',
    ` * Routing links that lie low and flood in a heavy monsoon month (slice 6, PRD EVT-1): the underpasses, and links within`,
    ` * ${DRAIN_M} m of a storm-water drain, stream, river or canal or ${LAKE_M} m of a lake of ${LAKE_HA} ha or more (OpenStreetMap) where the road`,
    ` * dips ${DIP_M} m or more below the links around it (SRTM); and (slice 7) the roads within ${NAMED_M} m of the ${PRESS.length} spots the city,`,
    ` * the traffic police and the press name as flooding (NAMED). ${ids.length} of ${real.length} links, ${km(ids).toFixed(0)} of ${allKm.toFixed(0)} km. Ids in order.`,
    ' */',
    `export const LOWLAND: readonly number[] = [${ids.join(', ')}]`,
    '',
    '/** Of those, the underpasses (a drawn stretch below ground level): they fill first and deepest. */',
    `export const UNDERPASSES: readonly number[] = [${under.join(', ')}]`,
    '',
    '/** The spots named as flooding every year, and the routing links within reach of each (slice 7), for naming a flood. */',
    `export const NAMED: readonly { name: string; links: readonly number[] }[] = [`,
    ...[...byName].map(([n, l]) => `  { name: ${JSON.stringify(n)}, links: [${l.join(', ')}] },`),
    ']',
    '',
  ].join('\n')
  writeFileSync(new URL('../src/sim/lowland.ts', import.meta.url), body)
  console.log(`wrote src/sim/lowland.ts: ${ids.length} links, of them ${under.length} underpasses`)
}

if (!process.env.NO_MAIN) main()
