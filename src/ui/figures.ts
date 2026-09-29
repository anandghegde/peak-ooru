import type { Transit } from '../data/types'
import type { Mode } from '../sim/types'
import type { Light } from '../sim/worker'
import { decimal, monthLong } from './format'
import type { TrafficView } from '../game/traffic'
import { count as grouped, element } from './controls'

/** A figure in Indian digit grouping, or a dash where the model gave none. */
function count(n: number): string {
  return Number.isFinite(n) ? grouped(n) : '–'
}

const MODE_NAMES: Record<Mode, string> = {
  twoWheeler: 'Two-wheeler',
  walk: 'On foot',
  bus: 'Bus',
  car: 'Car',
  auto: 'Auto or cab',
  metro: 'Metro',
  cycle: 'Cycle',
  rail: 'Suburban rail',
}

/**
 * The city's figures for a month: the average commute, speed on the main roads at the peaks, trips by mode and
 * riders by line. Drawn into the panel's City page. `stand` says that they come from a stand-in, not the model.
 */
export function drawFigures(body: HTMLElement, result: Light, view: TrafficView, transit: Transit | null, stand: boolean): void {
  const minutes = Number.isFinite(result.commute) ? decimal(result.commute / 60) : '–'
  const kmh = view.peakKmh > 0 ? String(Math.round(view.peakKmh)) : '–'
  const access = Number.isFinite(result.access) ? (result.access / 10).toFixed(0) : '–'
  const table = (rows: [string, string, string?][]) => {
    const dl = element('dl', 'figures')
    for (const [name, value, colour] of rows) {
      const dt = element('dt', '', name)
      if (colour) dt.prepend(Object.assign(element('i', 'swatch'), { style: `background:${colour}` }))
      dl.append(dt, element('dd', '', value))
    }
    return dl
  }
  const trips = Object.entries(result.trips).sort((a, b) => b[1] - a[1]) as [Mode, number][]
  const total = trips.reduce((sum, [, n]) => sum + n, 0)
  const lines = (transit?.lines ?? []).filter((l) => l.status === 'open')
  const metro = lines.filter((l) => l.kind === 'metro')
  const rail = lines.filter((l) => l.kind === 'rail').reduce((sum, l) => sum + (result.riders[l.id] ?? 0), 0)
  body.append(
    element('p', 'muted small', `A weekday in ${monthLong(result.month)}.`),
    table([
      ['Average commute', `${minutes} min`],
      ['Main roads at the peaks', `${kmh} km/h`],
      ['Jobs within 45 minutes', `${access}%`],
      ...(result.deaths !== undefined ? [['Road deaths a year', count(result.deaths)] as [string, string]] : []),
    ]),
    element('h3', '', `Trips a day: ${count(total)}`),
    table(trips.map(([mode, n]) => [MODE_NAMES[mode], count(n)])),
    element('h3', '', 'Riders a day'),
    table([
      ...metro.map((l): [string, string, string] => [l.name, count(result.riders[l.id] ?? 0), l.colour]),
      ...(rail ? [['Suburban rail', count(rail)] as [string, string]] : []),
    ]),
    element('p', 'muted small', stand ? 'Made-up figures, until the traffic model is ready.' : 'Figures are estimates.'),
  )
}
