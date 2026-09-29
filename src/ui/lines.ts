import type { TransitLine } from '../data/types'
import { metres } from '../game/build'
import type { Action, Game, Outcome } from '../rules/types'
import { element } from './controls'
import { grouped } from './format'
import { signal } from './signals'

/** People a vehicle carries at a crush, and the speed it keeps along the line, km/h: for how full a line is. */
const ROOM = { metro: 1000, bus: 70, rail: 1500 }
const KMH = { metro: 34, bus: 16, rail: 45 }
/** Hours a day a line runs. */
const HOURS = 18
/** What one tap of add or take away changes. */
const STEP = { metro: 1, bus: 5, rail: 2 }

function lengthKm(line: TransitLine): number {
  let m = 0
  for (let i = 2; i < line.path.length; i += 2) {
    m += metres([line.path[i - 2]!, line.path[i - 1]!], [line.path[i]!, line.path[i + 1]!])
  }
  return m / 1000
}

/**
 * Riders a trip, as a share of the room in a vehicle: a rough measure of how full a line is, from its riders a day,
 * its vehicles, and how many trips each can make in a day along it. An estimate, not the model's own figure.
 */
export function fullness(line: TransitLine, riders: number, vehicles: number): number {
  const kind = line.kind
  const trips = vehicles * ((HOURS * KMH[kind]) / Math.max(1, lengthKm(line)))
  return trips > 0 ? riders / (trips * ROOM[kind]) : 0
}

function button(className: string, text: string, label?: string): HTMLButtonElement {
  const b = element('button', className, text)
  b.type = 'button'
  if (label) b.setAttribute('aria-label', label)
  return b
}

let closing: string | null = null

/**
 * The player's lines in the City page: riders, how full, vehicles with add and take away, and close.
 * `redraw` draws the page again after a change.
 */
/** What the model says of each line, where it says it: riders, how crowded at the busiest point, how often it runs. */
export interface LineFigures {
  riders: Record<string, number>
  /** Riders an hour where most crowded, in thousandths of what its vehicles carry. */
  crowding?: Record<string, number>
  /** Minutes between vehicles at the peak. */
  headway?: Record<string, number>
}

function crowdWord(share: number): string {
  return share > 1 ? 'crowded' : share > 0.6 ? 'busy' : share > 0.25 ? 'comfortable' : 'mostly empty'
}

export function drawLines(
  body: HTMLElement, game: Game, month: LineFigures | null, act: (a: Action) => Promise<Outcome>, redraw: () => void,
): void {
  const riders = month?.riders ?? null
  const lines = game.built?.lines ?? []
  if (!lines.length) return
  const box = element('section', 'your-lines')
  box.append(element('h3', '', 'Your lines'))
  const over = game.status !== 'playing'
  for (const line of lines) {
    const row = element('div', 'your-line')
    const title = element('div', 'work-title')
    const swatch = element('i', 'line-swatch')
    swatch.style.background = line.colour
    title.append(swatch, element('strong', '', line.name))
    row.append(title)
    const r = riders?.[line.id] ?? 0
    const vehicles = game.built?.vehicles[line.id]
    const noun = line.kind === 'bus' ? 'buses' : 'trains'
    const parts = [`${grouped(r)} riders a day`]
    const crowd = month?.crowding?.[line.id]
    if (crowd !== undefined) parts.push(`${crowdWord(crowd / 1000)} at the busiest point`)
    else if (vehicles) parts.push(crowdWord(fullness(line, r, vehicles)))
    const headway = month?.headway?.[line.id]
    if (headway) parts.push(`every ${headway < 10 ? headway.toFixed(1).replace(/\.0$/, '') : Math.round(headway)} minutes at the peak`)
    row.append(element('p', 'small', `${parts.join(', ')}.`))
    const tools = element('div', 'line-tools')
    if (vehicles !== undefined) {
      const step = STEP[line.kind]
      const stepper = element('div', 'stepper')
      const less = button('', '−', `Take ${step} ${noun} off the ${line.name}`)
      const more = button('', '+', `Add ${step} ${noun} to the ${line.name}`)
      less.disabled = over || vehicles - step < 1
      more.disabled = over
      const change = async (by: number) => {
        const out = await act({ kind: 'vehicles', line: line.id, change: by })
        signal(out.ok ? 'changed' : 'refused')
        if (!out.ok) row.append(element('p', 'reason', out.reason))
      }
      less.addEventListener('click', () => void change(-step))
      more.addEventListener('click', () => void change(step))
      stepper.append(less, element('span', 'value', `${vehicles} ${noun}`), more)
      tools.append(stepper)
    }
    row.append(tools)
    if (closing === line.id) {
      const yes = button('commit', `Close the ${line.name}`)
      const no = button('quiet', 'Keep it open')
      yes.addEventListener('click', async () => {
        closing = null
        const out = await act({ kind: 'close', line: line.id })
        signal(out.ok ? 'changed' : 'refused')
        if (!out.ok) row.append(element('p', 'reason', out.reason))
      })
      no.addEventListener('click', () => {
        closing = null
        redraw()
      })
      const buttons = element('div', 'outlook-buttons')
      buttons.append(yes, no)
      row.append(element('p', 'reason', 'Its riders go back to the roads, and what it cost to build is not returned.'), buttons)
    } else {
      const close = button('quiet', 'Close the line')
      close.disabled = over
      close.addEventListener('click', () => {
        closing = line.id
        redraw()
      })
      row.append(close)
    }
    box.append(row)
  }
  box.append(element('p', 'muted small', 'Figures are the model’s estimates.'))
  body.append(box)
}
