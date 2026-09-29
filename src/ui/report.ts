import type { Cause, Entry, Figure, GameEvent, Report } from '../rules/types'
import { element } from './controls'
import type { Light } from '../sim/worker'
import { change, crore, decimal, grouped, people, span } from './format'
import { GRADES, gradeOf } from '../game/upkeep'

/** Money figures may come in crore or in lakh; everything else is shown in its own unit with one decimal. */
function isMoney(f: Figure): boolean {
  return f.key === 'money' || /crore|lakh|₹/.test(f.unit)
}

function toLakh(f: Figure, n: number): number {
  return /lakh/.test(f.unit) ? n : n * 100
}

/** "Commute 52.4 min, down 0.6", or for money "Money ₹2,140 crore, up ₹14 crore". */
export function figureLine(f: Figure, first = false): string {
  if (isMoney(f)) {
    const now = toLakh(f, f.now)
    const diff = now - toLakh(f, f.before)
    const moved = diff === 0 ? 'no change' : `${diff > 0 ? 'up' : 'down'} ${crore(Math.abs(diff))}`
    return `${f.name} ${crore(now)}, ${moved}`
  }
  // A unit the name already says ("Road deaths a year" in "a year") is not said twice.
  const unit = f.unit === '%' ? '%' : !f.unit || f.name.endsWith(f.unit) ? '' : ` ${f.unit}`
  // Deaths are counted in whole people.
  const places = f.key === 'safety' ? 0 : 1
  // The first month has nothing before it to compare with.
  return first ? `${f.name} ${decimal(f.now, places)}${unit}`
    : `${f.name} ${decimal(f.now, places)}${unit}, ${change(f.now - f.before, places)}`
}

/** A cause in words; where the rules gave the words without the figure, the figure is put in front. */
export function causeLine(text: string, amount: number): string {
  return /\d/.test(text) || amount === 0 ? text : `${decimal(Math.abs(amount))} ${text}`
}

/**
 * Whether a cause is worth showing. The model is noisy, so a small change can be given a cause larger than itself, or
 * one from growth too small to matter ("0.5 minutes saved from 0.21% more people"). Until the model is steadier,
 * neither is shown.
 */
export function believable(cause: Cause, change: number): boolean {
  if (Math.abs(cause.amount) > Math.abs(change) + 1e-9) return false
  const growth = /([\d.]+)% (more|fewer) people/.exec(cause.text)
  return !growth || Number(growth[1]) >= 0.5
}

/** "You took in ₹412 crore and spent ₹398 crore." */
export function booksLine(books: Entry[]): string {
  const income = books.filter((e) => e.amount > 0).reduce((sum, e) => sum + e.amount, 0)
  const spent = -books.filter((e) => e.amount < 0).reduce((sum, e) => sum + e.amount, 0)
  return `You took in ${crore(income)} and spent ${crore(spent)}.`
}

/** "Trips a day by bus 45.7 lakh, up 1.8 lakh; by metro 8.7 lakh, down 0.2 lakh." Only what moved. */
export function tripsLine(before: Light, after: Light): string | null {
  const parts: string[] = []
  for (const [mode, name] of [['bus', 'bus'], ['metro', 'metro'], ['rail', 'suburban rail']] as const) {
    const a = after.trips[mode]
    const d = a - before.trips[mode]
    if (Math.abs(d) < 1000) continue
    // The change in the same unit as the figure, so that the two can be read together.
    const by = a >= 100_000 ? `${decimal(Math.abs(d) / 100_000, Math.abs(d) < 10_000 ? 2 : 1)} lakh` : people(Math.abs(d))
    parts.push(`by ${name} ${people(a)}, ${d > 0 ? 'up' : 'down'} ${by}`)
  }
  return parts.length ? `Trips a day ${parts.join('; ')}.` : null
}

/** A road in poor repair as the report shows it. */
export interface ShownRoad {
  name: string
  km: number
  condition: number
  /** Vehicle-hours lost to its surface a weekday. */
  hours: number
  links: number[]
}

/** A road the player mended, and what came of it. */
export interface ShownMend {
  name: string
  work: 'patch' | 'resurface' | 'concrete'
  kmh: [number, number]
  condition: [number, number]
}

export interface RoadHooks {
  /** Shows a road on the map in the road condition view. */
  show(road: ShownRoad): void
  /** Opens the patch tool with the road chosen. */
  mend(road: ShownRoad): void
}

const MENDED: Record<ShownMend['work'], string> = { patch: 'patched', resurface: 'resurfaced', concrete: 'concrete begun' }

/**
 * The roads in the report (PRD ROAD-6): what the player's mending did, then the worst roads, each with the time its
 * surface costs and a way to go to it and mend it.
 */
export function drawRoads(body: HTMLElement, worst: ShownRoad[], all: ShownMend[], hooks: RoadHooks): void {
  // Work still under way (resurfacing, concrete) has not changed the surface yet: the Build page's works list has it.
  const mended = all.filter((m) => m.condition[1] - m.condition[0] >= 5)
  if (mended.length) {
    const list = element('ul', 'news mended')
    for (const m of mended) {
      const grade = (c: number) => GRADES[gradeOf(c)]
      const d = m.kmh[1] - m.kmh[0]
      const speed = Math.abs(d) >= 0.5
        ? `${Math.round(m.kmh[1])} km/h at the evening peak, against ${Math.round(m.kmh[0])} had it been left`
        : `about the same speed at the evening peak (${Math.round(m.kmh[1])} km/h) as had it been left`
      list.append(element('li', '', `${m.name}, ${MENDED[m.work]}: ${grade(m.condition[0])} → ${grade(m.condition[1])}; ${speed}.`))
    }
    body.append(element('h3', '', 'Roads you mended'), list)
  }
  if (!worst.length) return
  const box = element('section', 'worst-roads')
  box.append(element('h3', '', 'The worst roads'))
  box.append(element('p', 'muted small', 'Where potholes cost drivers the most time, as the model estimates it.'))
  for (const r of worst) {
    const row = element('div', 'worst-road')
    row.append(element('strong', '', r.name))
    row.append(element('span', 'small', `${decimal(r.km)} km ${GRADES[gradeOf(r.condition)]}: about ${grouped(r.hours)} hours lost a weekday.`))
    const buttons = element('div', 'outlook-buttons')
    const show = element('button', 'quiet', 'Show it')
    show.type = 'button'
    show.addEventListener('click', () => hooks.show(r))
    const mend = element('button', 'quiet mend', 'Mend it')
    mend.type = 'button'
    mend.dataset.mend = r.name
    mend.addEventListener('click', () => hooks.mend(r))
    buttons.append(mend, show)
    row.append(buttons)
    box.append(row)
  }
  body.append(box)
}

/**
 * What opened or began in the span, from what stopped it that is not urgent: lines and lanes opening, not the year's
 * end (the review says that) nor warnings (under "Needs you").
 */
export function openedLines(report: Report): string[] {
  const urgent = new Set(report.urgent ?? [])
  // An event that began (a cave-in, a strike) has its own list, under "Events".
  const event = (n: string) => (report.events ?? []).some((e) => n.toLowerCase().includes(e.title.toLowerCase().replace(/\.$/, '')))
  return report.needs.filter((n) => !urgent.has(n) && !/ is over\b/.test(n) && !event(n) && !/caved in|burst|strike/i.test(n))
}

/**
 * The report after a month or a skip (PRD UI-12): the score first, what it was, what it is and what moved it most;
 * then what needs the player, the figures with their reasons beside them, the money, events and the news. Short
 * enough for a phone's sheet.
 */
export function drawReport(
  body: HTMLElement,
  report: Report | null,
  notice: string | null,
  trips: string | null = null,
  lead: ((report: Report) => HTMLElement | null) | null = null,
  events: ((events: GameEvent[]) => HTMLElement) | null = null,
  head: HTMLElement[] = [],
  /** The names of the player's own lines, said under "What you did" and not again under "What opened". */
  mine: string[] = [],
): void {
  if (notice) body.append(element('p', 'notice', notice))
  if (!report) {
    body.append(
      element('p', '', 'Your term as commissioner of Bengaluru runs from January 2026 to December 2035.'),
      element('p', 'muted', 'You are scored on how well you govern it, from 0 to 1,000: the Score page says how. Build ' +
        'under Build. Set the property tax, the fares and the loans under Money. Then end the month. After each month ' +
        'this page says what moved the score, and why.'),
      element('p', 'muted small', 'Figures from the model are estimates.'),
    )
    return
  }
  body.append(element('h3', 'report-when', span(report.from, report.to)))
  const scored = lead?.(report)
  if (scored) body.append(scored)
  // What arrived this month, and what the player's own acts did, before the city's figures.
  body.append(...head)
  // Only what the player must act on is said as needing them; what opened or started is said plainly.
  const urgent = report.urgent ?? []
  if (urgent.length) {
    const needs = element('div', 'needs')
    needs.append(element('strong', '', 'Needs you'))
    const list = element('ul')
    for (const n of urgent) list.append(element('li', '', n))
    needs.append(list)
    body.append(needs)
  }
  const opened = openedLines(report).filter((n) => !mine.some((m) => n.startsWith(m)))
  if (opened.length) {
    const list = element('ul', 'news opened')
    for (const n of opened) list.append(element('li', '', n))
    body.append(element('h3', '', 'What opened'), list)
  }
  const figures = element('ul', 'report-figures')
  for (const f of report.figures) {
    const li = element('li')
    li.append(element('span', 'figure', figureLine(f, report.from === 0 && report.to === 0)))
    // The money's causes are its books, which the line after the figures sums up.
    const shown = f.key === 'money' ? [] : f.causes.filter((c) => believable(c, f.now - f.before))
    if (shown.length) {
      const causes = element('ul', 'causes')
      for (const c of shown) causes.append(element('li', '', causeLine(c.text, c.amount)))
      li.append(causes)
    }
    figures.append(li)
  }
  body.append(figures)
  if (trips) body.append(element('p', 'report-trips', trips))
  if (report.books.length) body.append(element('p', 'report-money', booksLine(report.books)))
  if (report.events?.length && events) body.append(element('h3', '', 'Events'), events(report.events))
  if (report.news.length) {
    const news = element('ul', 'news')
    // The events have their own list above: their lines in the news are not said twice.
    const above = new Set([...urgent, ...opened])
    const told = (n: string) => above.has(n)
      || (!!events && !!report.events?.some((e) => n.toLowerCase().includes(e.title.toLowerCase())))
    for (const n of report.news.filter((n) => !told(n)).slice(0, 6)) news.append(element('li', '', n))
    body.append(news)
  }
}
