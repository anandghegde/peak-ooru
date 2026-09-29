// Builds public/data/zones.json and zones.geojson from the data that tools/fetch-zones.sh saves in tools/data.
// Run with: npx vite-node tools/build-zones.ts
// Every figure made here is an estimate; docs/DATA.md says where each comes from and how far to trust it.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LngLat, Network, Zone } from '../src/data/types'

type Ring = LngLat[]
/** Outer ring first, then holes. */
type Polygon = Ring[]
type Shape = Polygon[]
type Props = Record<string, string | number | undefined>
interface Feature {
  properties: Props
  geometry: { type: string; coordinates: unknown }
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const data = join(root, 'tools/data')
const out = join(root, 'public/data')
const BOUNDS = { west: 77.35, south: 12.75, east: 77.85, north: 13.2 }

/** Jobs to the whole population: Bangalore district's workers in the 2011 census, 4,246,927 of 9,621,551. */
const WORK_SHARE = 0.44
/** Jobs that follow where people live (shops round the corner, domestic work, building sites), per resident. */
const LOCAL_JOBS = 0.12
/** Jobs per hectare of land mapped for work, by kind. Tech parks are several storeys of offices. */
const LAND_JOBS = { tech: 1500, campus: 900, commercial: 250, retail: 250, industrial: 120, airport: 20 }
/**
 * One company's own campus (Infosys, Wipro, HCL and the like, and the biotech parks) is lower and greener than a park
 * of towers let to many firms, such as Manyata or Embassy TechVillage: taken at 900 jobs a hectare, not 1,500 (at 1,500
 * Infosys's Electronic City campus, mapped at 29 ha, would hold 43,000). A judgement.
 */
const CAMPUS = /infosys|wipro|\bhcl\b|biotech|biocon|\btcs\b|tata consultancy|accenture|\bibm\b|oracle|cisco|intel\b|bosch|siemens|\bsap\b/i
/**
 * Industrial land counts by how full it is, not by its area alone: an estate has its 120 jobs a hectare only where it
 * is built up as the busier estates are, with `INDUSTRY_FULL` cubic metres of buildings not homes a hectare (the GHSL
 * 2020 grid), and fewer in proportion where it is emptier. KIADB's large estates at the edge of the city are partly
 * plots not yet built on.
 */
const INDUSTRY_FULL = 20_000
/**
 * A cubic metre of building on industrial land holds this share of the jobs a cubic metre of offices or shops does:
 * sheds and warehouses are tall and roomy, at perhaps 40 to 80 m² a worker under 6 to 10 m of roof, against 10 to 15 m²
 * under 3.5 m in an office. A judgement.
 */
const INDUSTRY_VOLUME = 0.25
/** Hectares above which named office land is taken as a mixed estate, not a tech park of tall blocks. */
const TECH_PARK_MAX = 80
const TECH_PARK = /tech ?park|techno ?park|tech ?village|tech gardens|tech hub|technostar|software|\bsez\b|business park|\bit park|ipark|knowledge park|infosys|wipro|manyata|itpl|embassy golf/i
/** Jobs at one mapped workplace, by its tag. */
const PLACE_JOBS: Record<string, number> = {
  office: 40, 'office=government': 60, shop: 3, hospital: 300, clinic: 6, doctors: 4, school: 40, college: 80,
  university: 400, marketplace: 100, bank: 12, restaurant: 8, cafe: 5, fast_food: 5, cinema: 20, townhall: 150,
  courthouse: 150, police: 40, fire_station: 30, post_office: 10, hotel: 40,
}
/** Sizes an outer zone grows to before it stops taking in its neighbours. */
const OUTER_PEOPLE = 150_000
const OUTER_AREA = 50
/**
 * Growth from 2011 to 2026 that every place gets whether or not anything is built: births over deaths, and more
 * people in the same homes. Urban Karnataka's natural increase is under one per cent a year.
 */
const BASE_GROWTH = 1.12

// ---------------------------------------------------------------- reading

const readLines = (file: string) =>
  readFileSync(join(data, file), 'utf8').split('\n').filter((line) => line.trim())
const readSeq = (file: string): Feature[] => readLines(file).map((line) => JSON.parse(line.replace(/^\x1e/, '')))

/** Polygons of a GeoJSON geometry, or none if it is not an area. */
function shapeOf(geometry: Feature['geometry']): Shape {
  if (geometry.type === 'Polygon') return [geometry.coordinates as Polygon]
  if (geometry.type === 'MultiPolygon') return geometry.coordinates as Shape
  return []
}

function readKml(file: string): { fields: Props; shape: Shape }[] {
  const kml = readFileSync(join(data, file), 'utf8')
  return [...kml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)].map(([, body]) => {
    const fields: Props = {}
    for (const [, key, value] of body!.matchAll(/<SimpleData name="([^"]+)">([^<]*)</g)) fields[key!] = value!.trim()
    for (const [, key, value] of body!.matchAll(/<Data name='([^']+)'>\s*<value>([^<]*)</g)) fields[key!.trim()] = value!.trim()
    fields.name ??= body!.match(/<name>([^<]*)<\/name>/)?.[1]
    const shape = [...body!.matchAll(/<Polygon>([\s\S]*?)<\/Polygon>/g)].map(([, polygon]) =>
      [...polygon!.matchAll(/<coordinates>([^<]*)<\/coordinates>/g)].map(([, text]) =>
        text!.trim().split(/\s+/).map((pair) => pair.split(',').slice(0, 2).map(Number) as LngLat),
      ),
    )
    return { fields, shape }
  })
}

// ---------------------------------------------------------------- geometry

const RADIUS = 6_371_008.8

/** Square metres enclosed by a ring of longitude and latitude, on a sphere. */
function ringArea(ring: Ring): number {
  let sum = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[j]!
    const [x2, y2] = ring[i]!
    sum += (((x2 - x1) * Math.PI) / 180) * (2 + Math.sin((y1 * Math.PI) / 180) + Math.sin((y2 * Math.PI) / 180))
  }
  return Math.abs((sum * RADIUS * RADIUS) / 2)
}

const shapeArea = (shape: Shape) =>
  shape.reduce((sum, [outer, ...holes]) => sum + ringArea(outer!) - holes.reduce((h, r) => h + ringArea(r), 0), 0)

function inRing(point: LngLat, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!
    const [xj, yj] = ring[j]!
    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** True if the point is inside the shape and outside its holes. */
const inShape = (point: LngLat, shape: Shape) =>
  shape.some(([outer, ...holes]) => inRing(point, outer!) && !holes.some((hole) => inRing(point, hole)))

function bbox(shape: Shape): [number, number, number, number] {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const polygon of shape) {
    for (const [x, y] of polygon[0]!) {
      w = Math.min(w, x)
      s = Math.min(s, y)
      e = Math.max(e, x)
      n = Math.max(n, y)
    }
  }
  return [w, s, e, n]
}

/** Squared distance in degrees (longitude shrunk to match) from a point to the shape's nearest edge. */
function edgeDistance(point: LngLat, shape: Shape): number {
  const k = Math.cos((point[1] * Math.PI) / 180)
  const [px, py] = [point[0] * k, point[1]]
  let best = Infinity
  for (const ring of shape.flat()) {
    for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = [ring[i - 1]![0] * k, ring[i - 1]![1]]
      const [dx, dy] = [ring[i]![0] * k - ax, ring[i]![1] - ay]
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)))
      best = Math.min(best, (ax + t * dx - px) ** 2 + (ay + t * dy - py) ** 2)
    }
  }
  return best
}

/**
 * A point well inside the shape, for its label: the point of a fine grid farthest from any edge.
 * The centroid of a crescent-shaped ward can fall outside it.
 */
function interior(shape: Shape): LngLat {
  const [w, s, e, n] = bbox(shape)
  let best: LngLat = shape[0]![0]![0]!
  let bestDistance = -1
  const steps = 30
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const point: LngLat = [w + ((e - w) * i) / steps, s + ((n - s) * j) / steps]
      if (!inShape(point, shape)) continue
      const distance = edgeDistance(point, shape)
      if (distance > bestDistance) [bestDistance, best] = [distance, point]
    }
  }
  return best
}

/** Mean of a ring's points: good enough to place a small building or plot. */
function roughCentre(geometry: Feature['geometry']): LngLat | undefined {
  if (geometry.type === 'Point') return geometry.coordinates as LngLat
  const ring = shapeOf(geometry)[0]?.[0]
  if (!ring) return undefined
  return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length]
}

// ---------------------------------------------------------------- the population grid

/** A grid of about 90 m cells over the game's area, as the GHSL files give it, north row first. */
interface Grid {
  cols: number
  rows: number
  west: number
  north: number
  size: number
}

function readGrid(file: string): { grid: Grid; values: Float64Array } {
  const lines = readFileSync(join(data, file), 'utf8').split('\n')
  const header = Object.fromEntries(lines.slice(0, 6).map((line) => line.trim().split(/\s+/) as [string, string]))
  const cols = Number(header.ncols)
  const rows = Number(header.nrows)
  const size = Number(header.cellsize)
  const values = new Float64Array(cols * rows)
  let k = 0
  for (const line of lines.slice(6)) {
    for (const value of line.trim().split(/\s+/)) if (value) values[k++] = Math.max(0, Number(value))
  }
  const grid = { cols, rows, size, west: Number(header.xllcorner), north: Number(header.yllcorner) + rows * size }
  return { grid, values }
}

const g2010 = readGrid('zones.pop2010.asc')
const grid = g2010.grid
const epoch = (year: number) => readGrid(`zones.pop${year}.asc`).values
const [p2015, p2025, p2030] = [epoch(2015), epoch(2025), epoch(2030)]
const cells = grid.cols * grid.rows
/** Straight-line between the grid's five-yearly epochs. */
const people2011 = new Float64Array(cells).map((_, i) => g2010.values[i]! + 0.2 * (p2015[i]! - g2010.values[i]!))
const people2026 = new Float64Array(cells).map((_, i) => p2025[i]! + 0.2 * (p2030[i]! - p2025[i]!))
const cellCentre = (i: number): LngLat => [
  grid.west + ((i % grid.cols) + 0.5) * grid.size,
  grid.north - (Math.floor(i / grid.cols) + 0.5) * grid.size,
]
const cellAt = ([x, y]: LngLat) => {
  const col = Math.floor((x - grid.west) / grid.size)
  const row = Math.floor((grid.north - y) / grid.size)
  return col < 0 || row < 0 || col >= grid.cols || row >= grid.rows ? -1 : row * grid.cols + col
}

/** Cells whose centre lies in the shape. */
function cellsIn(shape: Shape): number[] {
  const [w, s, e, n] = bbox(shape)
  const [c0, c1] = [Math.max(0, Math.floor((w - grid.west) / grid.size)), Math.min(grid.cols - 1, Math.floor((e - grid.west) / grid.size))]
  const [r0, r1] = [Math.max(0, Math.floor((grid.north - n) / grid.size)), Math.min(grid.rows - 1, Math.floor((grid.north - s) / grid.size))]
  const found: number[] = []
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const i = row * grid.cols + col
      if (inShape(cellCentre(i), shape)) found.push(i)
    }
  }
  return found
}

/** Marks each cell whose centre lies in one of the shapes with that shape's index, and returns the marks. */
function rasterise(shapes: Shape[]): Int32Array {
  const marks = new Int32Array(cells).fill(-1)
  shapes.forEach((shape, index) => {
    for (const i of cellsIn(shape)) if (marks[i] === -1) marks[i] = index
  })
  return marks
}

function sumBy(marks: Int32Array, values: Float64Array, count: number): number[] {
  const sums = new Array<number>(count).fill(0)
  marks.forEach((mark, i) => {
    if (mark >= 0) sums[mark]! += values[i]!
  })
  return sums
}

// ---------------------------------------------------------------- the wards

const wards = readKml('gba-369-wards-2025-12.kml')
  .map(({ fields, shape }) => ({
    corporation: String(fields.Corporation),
    number: Number(fields.ward_id),
    name: String(fields.ward_name),
    nameKn: fields.ward_name_kn ? String(fields.ward_name_kn) : null,
    census2011: Number(fields.TOT_P),
    shape,
  }))
  .sort((a, b) => a.corporation.localeCompare(b.corporation) || a.number - b.number)

// ---------------------------------------------------------------- the outer zones

/** Named places from OpenStreetMap, for cutting up and naming the ground outside the wards. */
const places = readSeq('zones.places.geojsonseq')
  .filter((f) => f.geometry.type === 'Point' && f.properties.name)
  .map((f) => ({ at: f.geometry.coordinates as LngLat, tags: f.properties }))

/** The part of the game's area nearer to each site than to any other, as a ring for each site. */
function voronoi(sites: LngLat[]): Ring[] {
  const k = Math.cos((13 * Math.PI) / 180)
  const { west, south, east, north } = BOUNDS
  return sites.map(([x, y], i) => {
    let ring: Ring = [[west, south], [east, south], [east, north], [west, north]]
    sites.forEach(([sx, sy], j) => {
      if (j === i || (sx === x && sy === y)) return
      // Keep the side of the perpendicular bisector nearer to site i.
      const [nx, ny] = [(sx - x) * k * k, sy - y]
      const limit = (nx * (sx + x)) / 2 + (ny * (sy + y)) / 2
      const side = (p: LngLat) => nx * p[0] + ny * p[1] - limit
      const next: Ring = []
      ring.forEach((p, n) => {
        const q = ring[(n + 1) % ring.length]!
        const [a, b] = [side(p), side(q)]
        if (a <= 0) next.push(p)
        if (a * b < 0) next.push([p[0] + ((q[0] - p[0]) * a) / (a - b), p[1] + ((q[1] - p[1]) * a) / (a - b)])
      })
      ring = next
    })
    return ring.length ? [...ring, ring[0]!] : ring
  })
}

/**
 * Cuts the game's area outside the wards into pieces along village boundaries from OpenStreetMap,
 * and adds the ground that no mapped village covers.
 */
function outerPieces(): { name: string; nameKn: string | null; shape: Shape }[] {
  const villages = readSeq('zones.villages.geojsonseq').filter(
    (f) => f.properties.admin_level === '9' && shapeOf(f.geometry).length > 0,
  )
  const write = (file: string, features: object[]) =>
    writeFileSync(join(data, file), JSON.stringify({ type: 'FeatureCollection', features }))
  write('zones.wards.geojson', wards.map((w) => ({ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: w.shape } })))
  // A hole in a village that no other village or ward fills is taken as part of it, so that no ground is left out.
  const others = [...villages.flatMap((f) => shapeOf(f.geometry)), ...wards.flatMap((w) => w.shape)].map((p) => p[0]![0]!)
  const filled = (shape: Shape) =>
    shape.map(([outer, ...holes]) => [outer!, ...holes.filter((hole) => others.some((point) => inRing(point, hole)))])
  write('zones.villages.geojson', villages.map((f, i) => (
    { type: 'Feature', properties: { piece: i }, geometry: { type: 'MultiPolygon', coordinates: filled(shapeOf(f.geometry)) } })))
  const { west, south, east, north } = BOUNDS
  write('zones.cells.geojson', voronoi(places.map((p) => p.at)).map((ring, site) => (
    { type: 'Feature', properties: { site }, geometry: { type: 'Polygon', coordinates: [ring] } })))
  execFileSync(
    'npx',
    ['-y', 'mapshaper', '-i', join(data, 'zones.wards.geojson'), join(data, 'zones.villages.geojson'),
      join(data, 'zones.cells.geojson'), 'combine-files', '-rename-layers', 'wards,villages,cells',
      '-rectangle', `bbox=${west},${south},${east},${north}`, 'name=box',
      '-erase', 'wards', 'target=box', 'name=outside',
      '-clip', 'outside', 'target=villages', '+', 'name=inside',
      '-erase', 'villages', 'target=outside', 'name=gaps',
      // Ground with no mapped village is cut up by which mapped place is nearest, so that it can be grouped like villages.
      '-clip', 'gaps', 'target=cells', 'name=rest',
      '-explode', 'target=rest',
      '-merge-layers', 'target=inside,rest', 'force', 'name=pieces',
      '-o', 'target=pieces', 'format=geojson', join(data, 'zones.pieces.geojson'), 'force'],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  )
  const pieces = (JSON.parse(readFileSync(join(data, 'zones.pieces.geojson'), 'utf8')).features as Feature[])
    .map((f) => ({ village: f.properties.piece as number | undefined, site: f.properties.site as number | undefined, shape: shapeOf(f.geometry) }))
    .filter((piece) => shapeArea(piece.shape) > 100)
  return pieces.map(({ village, site, shape }) => {
    const tags = village !== undefined ? villages[village]!.properties : site !== undefined ? places[site]!.tags : {}
    return { name: String(tags.name ?? ''), nameKn: tags['name:kn'] ? String(tags['name:kn']) : null, shape }
  })
}

/**
 * Joins the outer pieces into coarse zones: the smallest zone takes in its smallest neighbour until each holds about
 * OUTER_PEOPLE people or OUTER_AREA square kilometres. Returns each piece's zone.
 */
function groupPieces(marks: Int32Array, count: number, people: number[], areas: number[]): number[] {
  const zoneOf = Array.from({ length: count }, (_, i) => i)
  const find = (i: number): number => (zoneOf[i] === i ? i : (zoneOf[i] = find(zoneOf[i]!)))
  const neighbours = Array.from({ length: count }, () => new Set<number>())
  for (let i = 0; i < cells; i++) {
    const a = marks[i]!
    if (a < 0) continue
    for (const j of [i + 1, i + grid.cols]) {
      const b = marks[j]
      if (j < cells && b !== undefined && b >= 0 && b !== a && (j !== i + 1 || (i + 1) % grid.cols !== 0)) {
        neighbours[a]!.add(b)
        neighbours[b]!.add(a)
      }
    }
  }
  // A sliver too thin to hold a cell's centre joins the piece that holds the nearest cell.
  const held = new Set(marks.filter((m) => m >= 0))
  for (let i = 0; i < count; i++) {
    if (held.has(i)) continue
    const [col, row] = [(i: number) => i % grid.cols, (i: number) => Math.floor(i / grid.cols)]
    const start = cellAt(interior(pieces[i]!.shape))
    if (start < 0) continue
    let near = -1
    for (let reach = 1; near < 0 && reach < 60; reach++) {
      for (let dr = -reach; dr <= reach && near < 0; dr++) {
        for (let dc = -reach; dc <= reach && near < 0; dc++) {
          const [c, r] = [col(start) + dc, row(start) + dr]
          const m = c >= 0 && r >= 0 && c < grid.cols && r < grid.rows ? marks[r * grid.cols + c]! : -1
          if (m >= 0) near = m
        }
      }
    }
    if (near >= 0) zoneOf[i] = near
  }
  const size = (i: number) => people[i]! / OUTER_PEOPLE + areas[i]! / OUTER_AREA
  const live = new Set(zoneOf.filter((i) => neighbours[i]!.size > 0 && zoneOf[i] === i))
  for (;;) {
    let small = -1
    for (const i of live) if (size(i) < 1 && (small < 0 || size(i) < size(small))) small = i
    if (small < 0) break
    let into = -1
    for (const j of neighbours[small]!) {
      const k = find(j)
      if (k !== small && (into < 0 || size(k) < size(into) || (size(k) === size(into) && k < into))) into = k
    }
    live.delete(small)
    if (into < 0) continue
    zoneOf[small] = into
    people[into]! += people[small]!
    areas[into]! += areas[small]!
    for (const j of neighbours[small]!) neighbours[into]!.add(j)
    neighbours[into]!.delete(small)
  }
  return zoneOf.map((_, i) => find(i))
}

// ---------------------------------------------------------------- jobs

/**
 * Estimated jobs in each grid cell, from mapped land and workplaces, before scaling to the city's total; and which
 * cells lie on industrial land.
 */
function jobsGrid(): { jobs: Float64Array; industrial: Uint8Array } {
  const jobs = new Float64Array(cells)
  const industrial = new Uint8Array(cells)
  const buildings = readGrid('zones.built_NRES2020.asc').values
  const land = readSeq('zones.land.geojsonseq').filter((f) => f.geometry.type === 'MultiPolygon')
  let industrialBefore = 0
  let industrialAfter = 0
  for (const feature of land) {
    const use = String(feature.properties.landuse)
    const name = String(feature.properties.name ?? '')
    const shape = shapeOf(feature.geometry)
    const hectares = shapeArea(shape) / 1e4
    // The airport's land is mapped as commercial but is mostly runway.
    const kind = /airport/i.test(name) || feature.properties.aeroway ? 'airport'
      : use === 'commercial' && TECH_PARK.test(name) && hectares <= TECH_PARK_MAX ? (CAMPUS.test(name) ? 'campus' : 'tech') : use
    const perHectare = LAND_JOBS[kind as keyof typeof LAND_JOBS]
    if (!perHectare) continue
    let total = hectares * perHectare
    const inside = cellsIn(shape)
    if (kind === 'industrial' && inside.length > 0) {
      let volume = 0
      for (const i of inside) {
        volume += buildings[i]!
        industrial[i] = 1
      }
      industrialBefore += total
      total *= Math.min(1, volume / hectares / INDUSTRY_FULL)
      industrialAfter += total
    }
    if (inside.length === 0) {
      const cell = cellAt(interior(shape))
      if (cell >= 0) jobs[cell]! += total
    } else for (const i of inside) jobs[i]! += total / inside.length
  }
  for (const feature of readSeq('zones.work.geojsonseq')) {
    const tags = feature.properties
    const key = tags.office === 'government' ? 'office=government'
      : tags.office ? 'office'
      : tags.amenity && PLACE_JOBS[String(tags.amenity)] ? String(tags.amenity)
      : tags.tourism === 'hotel' ? 'hotel'
      : tags.shop ? 'shop' : undefined
    // Areas come twice, as an outline and as a line; count each once.
    if (!key || (feature.geometry.type === 'LineString' && tags['@type'] === 'way' && tags.area !== 'no')) continue
    const at = roughCentre(feature.geometry)
    const cell = at ? cellAt(at) : -1
    if (cell >= 0) jobs[cell]! += PLACE_JOBS[key]!
  }
  console.log(`industrial land: ${Math.round(industrialBefore)} jobs by area, ${Math.round(industrialAfter)} by how full it is`)
  return { jobs, industrial }
}

// ---------------------------------------------------------------- income

const normalise = (name: string) => name.toLowerCase().replace(/\(ct\)|- ward no\.\d+|[^a-z]/g, '')

/**
 * Share of households owning a car, plus share with a computer and internet, in the 2011 census: for the old
 * corporation's wards by number, and for towns and villages by name.
 */
function readAssets(): { wards: Map<number, number>; places: Map<string, number> } {
  const [, ...rows] = readFileSync(join(data, 'census2011-assets.csv'), 'utf8').split(/\r?\n(?=[A-Z])/)
  const wardScores = new Map<number, number>()
  const placeScores = new Map<string, number[]>()
  for (const row of rows) {
    const cols = row.match(/("[^"]*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, '').replace(/"/g, ''))
    const [area, internet, car] = [cols[2]!, Number(cols[6]), Number(cols[13])]
    if (!Number.isFinite(internet + car)) continue
    const ward = area.match(/^BBMP \(M Corp\. \+ OG\) - Ward No\.(\d+)$/)
    if (ward) wardScores.set(Number(ward[1]), car + internet)
    else if (!/^(District|Sub-Dist) - |BBMP/.test(area)) {
      const key = normalise(area)
      placeScores.set(key, [...(placeScores.get(key) ?? []), car + internet])
    }
  }
  const places = new Map([...placeScores].map(([key, list]) => [key, list.reduce((a, b) => a + b, 0) / list.length]))
  return { wards: wardScores, places }
}

// ---------------------------------------------------------------- joining the roads

/** Each zone to the junction nearest its centre on a road of secondary class or above inside it, if it has one. */
function attach(zones: Zone[], shapes: Shape[]): number {
  const file = join(out, 'network.json')
  if (!existsSync(file)) return 0
  const network = JSON.parse(readFileSync(file, 'utf8')) as Network
  const major = new Set<number>()
  for (const link of network.links) if (link.kind !== 'tertiary') major.add(link.a).add(link.b)
  const k = Math.cos((13 * Math.PI) / 180)
  const distance = (a: LngLat, b: LngLat) => ((a[0] - b[0]) * k) ** 2 + (a[1] - b[1]) ** 2
  const nodes = network.nodes.filter((node) => !node.gateway)
  let fallback = 0
  zones.forEach((zone, z) => {
    const nearest = (list: typeof nodes) =>
      list.reduce<(typeof nodes)[number] | undefined>(
        (best, node) => (!best || distance(node.at, zone.centre) < distance(best.at, zone.centre) ? node : best),
        undefined,
      )
    const [w, s, e, n] = bbox(shapes[z]!)
    const inside = nodes.filter(({ at }) => at[0] >= w && at[0] <= e && at[1] >= s && at[1] <= n && inShape(at, shapes[z]!))
    const choice = nearest(inside.filter((node) => major.has(node.id))) ?? nearest(inside)
    if (!inside.length) fallback++
    zone.node = (choice ?? nearest(nodes))?.id ?? -1
  })
  return fallback
}

// ---------------------------------------------------------------- building

const pieces = outerPieces()
const shapes = [...wards.map((w) => w.shape), ...pieces.map((p) => p.shape)]
const marks = rasterise(shapes)
const count = shapes.length
const areas = shapes.map((shape) => shapeArea(shape) / 1e6)
const now = sumBy(marks, people2026, count)
const then = sumBy(marks, people2011, count)

// People in 2026. The start is 2011: the census count for a ward, the grid's figure elsewhere. Every place then grows
// by BASE_GROWTH, and the rest of the growth that the grid puts on the whole map goes where new homes were built
// between 2010 and 2020. The grid's own spread of people inside the city is not used: it puts far too many in the old
// core and far too few in the new suburbs.
const homes = (year: number) => {
  const all = readGrid(`zones.built${year}.asc`).values
  const work = readGrid(`zones.built_NRES${year}.asc`).values
  return all.map((v, i) => Math.max(0, v - work[i]!))
}
const [homes2010, homes2020] = [homes(2010), homes(2020)]
const newHomes = sumBy(marks, homes2020.map((v, i) => Math.max(0, v - homes2010[i]!)), count)
const base = [...wards.map((w) => w.census2011), ...then.slice(wards.length)]
const target = now.reduce((a, b) => a + b, 0)
const perNewHome = (target - BASE_GROWTH * base.reduce((a, b) => a + b, 0)) / newHomes.reduce((a, b) => a + b, 0)
const people = base.map((p, i) => BASE_GROWTH * p + perNewHome * newHomes[i]!)

// Outer pieces become zones.
const pieceZone = groupPieces(
  marks.map((m) => (m >= wards.length ? m - wards.length : -1)),
  pieces.length,
  people.slice(wards.length),
  areas.slice(wards.length),
)
const groups = [...new Set(pieceZone)]
const outerPeople = people.slice(wards.length)
const outerMembers = groups.map((g) => pieces.map((_, i) => i).filter((i) => pieceZone[i] === g))
const zoneOfPiece = (m: number) => (m < wards.length ? m : wards.length + groups.indexOf(pieceZone[m - wards.length]!))
const zoneCount = wards.length + groups.length
const zoneMarks = marks.map((m) => (m < 0 ? -1 : zoneOfPiece(m)))
const zonePeople = [
  ...people.slice(0, wards.length),
  ...outerMembers.map((members) => members.reduce((s, i) => s + outerPeople[i]!, 0)),
]

// Jobs: local jobs follow people. The rest are shared out half by mapped workplaces and half by the volume of
// buildings that the GHSL takes to be not homes, so that neither gaps in the map nor errors in the satellite
// reading decide a zone alone. Together they make the city's total.
const share = (list: number[]) => {
  const total = list.reduce((a, b) => a + b, 0)
  return list.map((v) => v / total)
}
const workplaces = jobsGrid()
const mappedJobs = sumBy(zoneMarks, workplaces.jobs, zoneCount)
// Buildings on industrial land hold fewer jobs to the cubic metre than offices and shops.
const workVolume = sumBy(
  zoneMarks,
  readGrid('zones.built_NRES2020.asc').values.map((v, i) => (workplaces.industrial[i] ? v * INDUSTRY_VOLUME : v)),
  zoneCount,
)
const [mapped, built] = [share(mappedJobs), share(workVolume)]
const totalPeople = zonePeople.reduce((a, b) => a + b, 0)
const totalJobs = WORK_SHARE * totalPeople
const zoneJobs = zonePeople.map((p, z) => LOCAL_JOBS * p + (totalJobs - LOCAL_JOBS * totalPeople) * (mapped[z]! + built[z]!) / 2)

// Income: household assets in 2011, averaged over each zone by where its people lived then.
const assets = readAssets()
const oldWards = readKml('bbmp-198-wards-2015.kml')
const oldMarks = rasterise(oldWards.map((w) => w.shape))
const oldNumber = oldWards.map((w) => Number(String(w.fields.name).replace(/\D/g, '')))
const score = new Float64Array(zoneCount)
const weight = new Float64Array(zoneCount)
oldMarks.forEach((old, i) => {
  const z = zoneMarks[i]!
  const value = old >= 0 ? assets.wards.get(oldNumber[old]!) : undefined
  if (z < 0 || value === undefined) return
  score[z]! += value * (people2011[i]! + 1e-3)
  weight[z]! += people2011[i]! + 1e-3
})
outerMembers.forEach((members, g) => {
  for (const i of members) {
    const value = assets.places.get(normalise(pieces[i]!.name))
    if (value === undefined) continue
    score[wards.length + g]! += value * (outerPeople[i]! + 1e-3)
    weight[wards.length + g]! += outerPeople[i]! + 1e-3
  }
})
const scores = Array.from(score, (s, z) => (weight[z]! > 0 ? s / weight[z]! : NaN))
// An outer zone with no village found in the census tables takes the middle value of those that were found.
const known = scores.slice(wards.length).filter((s) => !Number.isNaN(s)).sort((a, b) => a - b)
const outerMiddle = known[Math.floor(known.length / 2)]!
const zoneScore = scores.map((s) => (Number.isNaN(s) ? outerMiddle : s))
// Five classes, each holding about a fifth of the people.
const byScore = zoneScore.map((s, z) => [s, z] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1])
const income = new Array<Zone['income']>(zoneCount)
let running = 0
for (const [, z] of byScore) {
  income[z] = Math.min(5, 1 + Math.floor((5 * (running + zonePeople[z]! / 2)) / totalPeople)) as Zone['income']
  running += zonePeople[z]!
}

// Names of outer zones: the biggest town or suburb mapped inside, else the most populous village, else any place
// inside; each name used once, since many villages share a name.
const rank: Record<string, number> = { city: 0, town: 1, suburb: 2, village: 3 }
const usedNames = new Set(wards.map((w) => w.name))
function outerName(g: number, shape: Shape, members: number[]): { name: string; nameKn: string | null } {
  const inside = places
    .filter((p) => zoneMarks[cellAt(p.at)] === wards.length + g && inShape(p.at, shape))
    .sort((a, b) => rank[String(a.tags.place)]! - rank[String(b.tags.place)]! ||
      Number(b.tags.population ?? 0) - Number(a.tags.population ?? 0) || String(a.tags.name).localeCompare(String(b.tags.name)))
    .map((p) => ({ name: String(p.tags.name), nameKn: p.tags['name:kn'] ? String(p.tags['name:kn']) : null, big: rank[String(p.tags.place)]! <= 2 }))
  const villages = members.filter((i) => pieces[i]!.name).sort((a, b) => outerPeople[b]! - outerPeople[a]!).map((i) => pieces[i]!)
  const choice = [...inside.filter((p) => p.big), ...villages, ...inside].find((p) => !usedNames.has(p.name)) ??
    { name: `Outskirts ${g + 1}`, nameKn: null }
  usedNames.add(choice.name)
  return { name: choice.name, nameKn: choice.nameKn }
}

// Outer outlines are the pieces dissolved by group, which mapshaper does with the ward outlines so borders match.
const outerShapes: Shape[] = outerMembers.map((members) => members.flatMap((i) => pieces[i]!.shape))
const zoneShapes = [...wards.map((w) => w.shape), ...outerShapes]
const round5 = (value: number) => Math.round(value * 1e5) / 1e5

const zones: Zone[] = zoneShapes.map((shape, id) => {
  const ward = wards[id]
  const naming = ward ? { name: ward.name, nameKn: ward.nameKn } : outerName(id - wards.length, shape, outerMembers[id - wards.length]!)
  return {
    id,
    ...naming,
    node: -1,
    centre: interior(shape).map(round5) as LngLat,
    area: Math.round(shapeArea(shape) / 1e4) / 100,
    people: Math.round(zonePeople[id]!),
    jobs: Math.round(zoneJobs[id]!),
    income: income[id]!,
    ...(ward ? { ward: { corporation: ward.corporation, number: ward.number } } : {}),
  }
})

const features = zoneShapes.flatMap((shape, id) =>
  shape.map((polygon) => ({ type: 'Feature', properties: { id }, geometry: { type: 'Polygon', coordinates: polygon } })),
)
const fullFile = join(data, 'zones.full.geojson')
writeFileSync(fullFile, JSON.stringify({ type: 'FeatureCollection', features }))
// Mapshaper simplifies each shared border once, so that neighbouring outlines still meet; dissolving by id joins the
// pieces of each outer zone into one outline.
execFileSync(
  'npx',
  ['-y', 'mapshaper', '-i', fullFile, 'snap', '-dissolve2', 'id', '-simplify', 'weighted', '15%', 'keep-shapes', '-clean',
    '-o', 'precision=0.00001', 'format=geojson', join(out, 'zones.geojson'), 'force'],
  { stdio: ['ignore', 'ignore', 'inherit'] },
)
// Zones join the roads inside their outlines as drawn, so that what the player sees and what the game uses agree.
const drawn = new Map<number, Shape>()
for (const f of JSON.parse(readFileSync(join(out, 'zones.geojson'), 'utf8')).features as Feature[]) {
  drawn.set(f.properties.id as number, [...(drawn.get(f.properties.id as number) ?? []), ...shapeOf(f.geometry)])
}
const unjoined = attach(zones, zones.map((zone) => drawn.get(zone.id)!))
writeFileSync(join(out, 'zones.json'), JSON.stringify(zones))

const sum = (list: number[]) => Math.round(list.reduce((a, b) => a + b, 0))
console.log(`${zones.length} zones (${wards.length} wards, ${groups.length} outer, from ${pieces.length} pieces)`)
console.log(`people 2026: ${sum(zones.map((z) => z.people))} (wards ${sum(zonePeople.slice(0, wards.length))}; ` +
  `wards in 2011 census ${sum(wards.map((w) => w.census2011))}; grid in wards 2011 ${sum(then.slice(0, wards.length))})`)
console.log(`jobs: ${sum(zones.map((z) => z.jobs))}; mapped workplaces ${sum(mappedJobs)}; work buildings ${sum(workVolume) / 1e6} million m3`)
console.log(`people: base 2011 ${sum(base)}, grid 2026 ${sum(now)}, per m3 of new homes ${perNewHome.toFixed(3)}`)
console.log(`income classes: ${[1, 2, 3, 4, 5].map((c) => zones.filter((z) => z.income === c).length).join(' ')}; ` +
  `outer zones with no census match ${scores.slice(wards.length).filter(Number.isNaN).length}`)
console.log(`joined to roads: ${zones.filter((z) => z.node >= 0).length}, of which ${unjoined} with no junction inside`)
