const SVG = 'http://www.w3.org/2000/svg'

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  return el
}

export interface Line {
  values: number[]
  colour: string
  dashed?: boolean
}

/**
 * A small line chart, drawn to fit its box: the lines, a line at nothing where the values cross it, and the lowest
 * and highest values named at the left. `labels` go under the first and last points.
 */
export function lineChart(lines: Line[], labels: [string, string], format: (n: number) => string): SVGSVGElement {
  const width = 300
  const height = 96
  const left = 52
  const all = lines.flatMap((l) => l.values)
  let low = Math.min(...all)
  let high = Math.max(...all)
  if (high === low) {
    high += 1
    low -= 1
  }
  const x = (i: number, n: number) => left + (n <= 1 ? 0 : (i / (n - 1)) * (width - left - 4))
  const y = (v: number) => 6 + ((high - v) / (high - low)) * (height - 26)
  const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img' })
  const text = (t: string, tx: number, ty: number, anchor = 'start') => {
    const el = svg('text', { x: tx, y: ty, 'text-anchor': anchor })
    el.textContent = t
    chart.append(el)
  }
  chart.append(svg('line', { x1: left, x2: width - 4, y1: y(high), y2: y(high), class: 'grid' }))
  chart.append(svg('line', { x1: left, x2: width - 4, y1: y(low), y2: y(low), class: 'grid' }))
  if (low < 0 && high > 0) chart.append(svg('line', { x1: left, x2: width - 4, y1: y(0), y2: y(0), class: 'zero' }))
  text(format(high), left - 6, y(high) + 4, 'end')
  text(format(low), left - 6, y(low) + 4, 'end')
  for (const line of lines) {
    const n = line.values.length
    const points = line.values.map((v, i) => `${x(i, n).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
    chart.append(svg('polyline', {
      points, fill: 'none', stroke: line.colour, 'stroke-width': 2, 'stroke-linejoin': 'round',
      ...(line.dashed ? { 'stroke-dasharray': '4 3' } : {}),
    }))
  }
  text(labels[0], left, height - 4)
  text(labels[1], width - 4, height - 4, 'end')
  return chart
}
