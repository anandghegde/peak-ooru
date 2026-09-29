const SVG = 'http://www.w3.org/2000/svg'

/** What the picture of the player's city is drawn from, all as lng, lat. */
export interface CityPicture {
  /** The city's boundary, as rings. */
  edge: [number, number][][]
  /** The ring roads, as lines (lng, lat, lng, lat…), so that the city is known by its shape. */
  rings: number[][]
  /** Lakes, as rings, where known. */
  water?: [number, number][][]
  /** Transit lines: the city's thin and quiet, the player's in their colours and bold. */
  lines: { path: number[]; colour: string; mine: boolean; dashed?: boolean }[]
  /** Roads the player built. */
  roads: number[][]
  /** Roads the player mended with resurfacing or concrete. */
  mended?: number[][]
}

/** The frame of the picture: the Greater Bengaluru Authority's area. */
const AREA: [number, number, number, number] = [77.44, 12.83, 77.79, 13.14]

/** The picture's height for a width, the city's shape kept. */
export function cityHeight(width: number): number {
  const [w, s, e, n] = AREA
  const k = Math.cos(((s + n) / 2) * (Math.PI / 180))
  return Math.round((width * (n - s)) / ((e - w) * k))
}

/**
 * The same picture drawn on a canvas, for the share picture (PRD MP-14): at (`left`, `top`), `width` wide, in the
 * colours of `cityPicture`, the lines thicker so that the player's own still show at the size of a thumbnail, and
 * without the roads mended.
 */
export function drawCity(c: CanvasRenderingContext2D, p: CityPicture, left: number, top: number, width: number): void {
  const [w, s, e, n] = AREA
  const height = cityHeight(width)
  const u = width / 300
  const x = (lng: number) => left + ((lng - w) / (e - w)) * width
  const y = (lat: number) => top + ((n - lat) / (n - s)) * height
  const ring = (r: [number, number][]) => {
    r.forEach(([a, b], i) => (i ? c.lineTo(x(a), y(b)) : c.moveTo(x(a), y(b))))
    c.closePath()
  }
  const line = (l: number[]) => {
    c.beginPath()
    for (let i = 0; i + 1 < l.length; i += 2) (i ? c.lineTo : c.moveTo).call(c, x(l[i]!), y(l[i + 1]!))
  }
  const stroke = (colour: string, width: number, dash: number[] = [], alpha = 1) => {
    c.strokeStyle = colour
    c.lineWidth = width * u
    c.setLineDash(dash.map((d) => d * u))
    c.globalAlpha = alpha
    c.stroke()
    c.globalAlpha = 1
    c.setLineDash([])
  }
  c.save()
  // Lines that run on out of the city (to the airport, the NICE Road's far end) stop a little past its frame, so that
  // they never cross the words beside it.
  const m = width * 0.03
  c.beginPath()
  c.rect(left - m, top - m, width + 2 * m, height + 2 * m)
  c.clip()
  c.lineCap = 'round'
  c.lineJoin = 'round'
  c.beginPath()
  for (const r of p.edge) ring(r)
  c.fillStyle = '#f6f3ed'
  c.fill()
  c.strokeStyle = '#b9b0a2'
  c.lineWidth = 0.8 * u
  c.stroke()
  // Lakes inside the city only, as in the ending's picture.
  c.save()
  c.beginPath()
  for (const r of p.edge) ring(r)
  c.clip()
  c.beginPath()
  for (const r of p.water ?? []) ring(r)
  c.fillStyle = '#b9d8ea'
  c.fill()
  c.restore()
  for (const l of p.rings) {
    line(l)
    stroke('#c9bca5', 3.2)
    stroke('#fbf3dc', 2)
  }
  // Roads mended are left out: a web of grey that, at a thumbnail's size, hides the lines.
  for (const l of p.lines.filter((l) => !l.mine)) {
    line(l.path)
    stroke(l.colour, 1.6, l.dashed ? [3, 2] : [], 0.7)
  }
  for (const l of p.roads) {
    line(l)
    stroke('#26231f', 2.6)
  }
  for (const l of p.lines.filter((l) => l.mine)) {
    line(l.path)
    stroke('#fffdf9', 6.5)
    stroke(l.colour, 4, l.dashed ? [6, 3.5] : [])
  }
  c.restore()
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  return e
}

/**
 * A plain picture of the player's city for the ending (PRD UI-18, MP-14): its outline in the land's colour, the ring
 * roads in cream, the city's metro faint, and what the player built bold in its own colours. Drawn as SVG, so that it
 * is sharp at any size and can later be made into the share picture.
 */
export function cityPicture(p: CityPicture): SVGSVGElement {
  const [w, s, e, n] = AREA
  const k = Math.cos(((s + n) / 2) * (Math.PI / 180))
  const width = 300
  const height = Math.round((width * (n - s)) / ((e - w) * k))
  const x = (lng: number) => ((lng - w) / (e - w)) * width
  const y = (lat: number) => ((n - lat) / (n - s)) * height
  const flat = (line: number[]) => {
    const out: string[] = []
    for (let i = 0; i + 1 < line.length; i += 2) out.push(`${x(line[i]!).toFixed(1)},${y(line[i + 1]!).toFixed(1)}`)
    return out.join(' ')
  }
  const ring = (r: [number, number][]) => r.map(([a, b]) => `${x(a).toFixed(1)},${y(b).toFixed(1)}`).join(' ')
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, class: 'city-picture', role: 'img' })
  svg.setAttribute('aria-label', 'A map of Bengaluru with what you built')
  for (const r of p.edge) svg.append(el('polygon', { points: ring(r), fill: '#f6f3ed', stroke: '#b9b0a2', 'stroke-width': 0.8, 'stroke-linejoin': 'round' }))
  // Lakes inside the city only: the country round it stays plain, so that the city's shape reads first.
  const clip = el('clipPath', { id: 'city-picture-edge' })
  for (const r of p.edge) clip.append(el('polygon', { points: ring(r) }))
  const defs = el('defs', {})
  defs.append(clip)
  svg.append(defs)
  const water = el('g', { 'clip-path': 'url(#city-picture-edge)' })
  for (const r of p.water ?? []) water.append(el('polygon', { points: ring(r), fill: '#b9d8ea' }))
  svg.append(water)
  for (const line of p.rings) {
    svg.append(el('polyline', { points: flat(line), fill: 'none', stroke: '#c9bca5', 'stroke-width': 3.2, 'stroke-linecap': 'round' }))
    svg.append(el('polyline', { points: flat(line), fill: 'none', stroke: '#fbf3dc', 'stroke-width': 2, 'stroke-linecap': 'round' }))
  }
  for (const line of p.mended ?? []) {
    svg.append(el('polyline', { points: flat(line), fill: 'none', stroke: '#8d989e', 'stroke-width': 2, 'stroke-linecap': 'round' }))
  }
  for (const l of p.lines.filter((l) => !l.mine)) {
    svg.append(el('polyline', {
      points: flat(l.path), fill: 'none', stroke: l.colour, 'stroke-width': 1.6, 'stroke-opacity': 0.7, 'stroke-linejoin': 'round',
      ...(l.dashed ? { 'stroke-dasharray': '3 2' } : {}),
    }))
  }
  for (const line of p.roads) {
    svg.append(el('polyline', { points: flat(line), fill: 'none', stroke: '#26231f', 'stroke-width': 2.2, 'stroke-linecap': 'round' }))
  }
  for (const l of p.lines.filter((l) => l.mine)) {
    svg.append(el('polyline', {
      points: flat(l.path), fill: 'none', stroke: '#fffdf9', 'stroke-width': 5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }))
    svg.append(el('polyline', {
      points: flat(l.path), fill: 'none', stroke: l.colour, 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      ...(l.dashed ? { 'stroke-dasharray': '5 3' } : {}),
    }))
  }
  return svg
}
