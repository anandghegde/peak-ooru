import type { Cause, Figure, Game, Report } from '../rules/types'
import type { Light } from '../sim/worker'
import { element } from './controls'
import { decimal, monthLong, people } from './format'
import type { ShownMend } from './report'
import './first.css'

/** Causes that are the player's own doing, by their words in the report (`src/rules/report.ts`). */
const OWN = /\byou\b|\byour\b|fare (rising|falling)|new bus lanes|new footpaths|work at junctions|speed limits|one-way|property tax|change in buses/i

const FIGURE_WORDS: Partial<Record<Figure['key'], { name: string; unit: string; less: string; more: string }>> = {
  commute: { name: 'The commute', unit: 'min', less: 'shorter', more: 'longer' },
  access: { name: 'Jobs in reach', unit: 'points', less: 'fewer', more: 'more' },
  clean: { name: 'Clean travel', unit: 'points', less: 'down', more: 'up' },
  safety: { name: 'Road deaths', unit: 'a year', less: 'fewer', more: 'more' },
}

/** "The commute 0.3 min shorter", from a cause's amount in the figure's own unit. */
function effect(key: Figure['key'], amount: number): string | null {
  const w = FIGURE_WORDS[key]
  if (!w || amount === 0) return null
  if (key === 'safety') return `${Math.abs(Math.round(amount))} ${amount < 0 ? 'fewer' : 'more'} road deaths a year`
  if (key === 'commute') return `the commute ${decimal(Math.abs(amount))} min ${amount < 0 ? 'shorter' : 'longer'}`
  return `${w.name.toLowerCase()} ${amount > 0 ? 'up' : 'down'} ${decimal(Math.abs(amount))} ${w.unit}`
}

/** The causes in a report's figures that mention `what`, as effects: "the commute 0.3 min shorter". */
function effectsOf(report: Report, test: (c: Cause) => boolean): string[] {
  const out: string[] = []
  for (const f of report.figures) {
    for (const c of f.causes) {
      if (!test(c)) continue
      const e = effect(f.key, c.amount)
      if (e) out.push(e)
    }
  }
  return out
}

/** "A and B", "A, B and C". */
function and(parts: string[]): string {
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** "bus route 1, Hebbal to Majestic" for a line named "Bus route 1, Hebbal to Majestic"; else "bus route Blue". */
function called(what: string, name: string): string {
  return name.toLowerCase().startsWith(what) ? name.charAt(0).toLowerCase() + name.slice(1) : `${what} ${name}`
}

export interface YoursInput {
  report: Report
  game: Game
  /** The roads mended in the span, and what came of it. */
  mended: ShownMend[]
  /** The traffic at the span's start and end. */
  before: Light | null
  now: Light | null
}

/**
 * What the player's own acts did (slice 9), in the city's terms, to head the report: the lines of theirs that run and
 * the people they carried, the roads they mended and how fast traffic runs on them, what they ordered and when it
 * opens, and the report's causes that are theirs. Null when the player did nothing that shows.
 */
export function yours({ report, game, mended, before, now }: YoursInput): HTMLElement | null {
  const lines: string[] = []
  const used = new Set<string>()
  // The player's lines that run: the people they carried, and what the model puts down to them.
  for (const line of game.built?.lines ?? []) {
    const riders = now?.riders[line.id] ?? 0
    const was = before?.riders[line.id] ?? 0
    const what = line.kind === 'bus' ? 'bus route' : line.kind === 'metro' ? 'metro line' : 'line'
    const name = line.name
    const said = effectsOf(report, (c) => c.text.includes(name))
    for (const c of report.figures.flatMap((f) => f.causes)) if (c.text.includes(name)) used.add(c.text)
    const started = !was && riders > 0
    let text = `Your ${called(what, name)} ${started ? 'started running and carried' : 'carried'} ${people(riders)} people a day.`
    if (said.length) text += ` ${cap(said[0]!)}.`
    if (riders > 0) lines.push(text)
    // Opened at the month's end: it has carried no one in the traffic reported yet.
    else lines.push(`Your ${called(what, name)} started running. The next report says how many it carried.`)
  }
  // Roads mended that changed.
  for (const m of mended.filter((x) => x.condition[1] - x.condition[0] >= 5)) {
    const d = m.kmh[1] - m.kmh[0]
    const done = m.work === 'patch' ? 'patched' : m.work === 'resurface' ? 'resurfaced' : 'laid concrete on'
    lines.push(Math.abs(d) >= 0.5
      ? `You ${done} ${m.name}: traffic there ran at ${Math.round(m.kmh[1])} km/h in the evening, against ${Math.round(m.kmh[0])} had it been left.`
      : `You ${done} ${m.name}: its traffic ran at about the same speed, ${Math.round(m.kmh[1])} km/h in the evening.`)
  }
  const roadsCause = effectsOf(report, (c) => /roads you mended/.test(c.text))
  if (roadsCause.length && mended.length) lines.push(`Across the city, the roads you mended made ${and(roadsCause.slice(0, 2))}.`)
  for (const c of report.figures.flatMap((f) => f.causes)) if (/roads you mended/.test(c.text)) used.add(c.text)
  // Other acts of the player's the report gives a part to: fares, bus lanes, footpaths, junctions, limits, the tax.
  const byWhy = new Map<string, string[]>()
  for (const f of report.figures) {
    for (const c of f.causes) {
      if (used.has(c.text) || !OWN.test(c.text)) continue
      const e = effect(f.key, c.amount)
      const why = /from (.*)$/.exec(c.text)?.[1]
      if (e && why) byWhy.set(why, [...(byWhy.get(why) ?? []), e])
      used.add(c.text)
    }
  }
  for (const [why, effects] of byWhy) lines.push(`${cap(why)}: ${and(effects.slice(0, 3))}.`)
  // What the player ordered in the span, and when it opens.
  for (const p of game.projects ?? []) {
    if (p.started < report.from || p.started > report.to) continue
    const kind = p.plan.kind === 'busRoute' ? 'bus route' : p.plan.kind === 'metro' ? 'metro line' : null
    if (!kind) continue
    lines.push(`Your ${called(kind, p.name)} ${p.plan.kind === 'busRoute' ? 'starts running' : 'opens'} in ${monthLong(p.opens)}.`)
  }
  if (!lines.length) return null
  const box = element('section', 'report-yours')
  box.append(element('h3', '', 'What you did'))
  const list = element('ul')
  for (const l of lines.slice(0, 5)) list.append(element('li', '', l))
  box.append(list)
  return box
}
