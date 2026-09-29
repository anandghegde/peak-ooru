import type { Cause, Figure, Game, GameEvent, Measure, MeasureKey, Report, Score } from '../rules/types'
import { contribution, MEASURE_INFO, movedMost, ordered, points, type MeasureView } from '../game/score'
import type { ScoreAhead } from '../sim/worker'
import { element } from './controls'
import { crore, decimal, grouped, monthShort } from './format'
import { believable, causeLine } from './report'
import { yearWeights } from '../rules/score'

/** The figure of the report that says the same as a measure, for its causes where the rules give the measure none. */
const FIGURE_OF: Partial<Record<MeasureKey, Figure['key']>> = {
  access: 'access', commute: 'commute', clean: 'clean', safety: 'safety', approval: 'approval',
}

/** A measure's figure in its own unit, as a person would say it: "57.5 min", "13.8%", "₹2,140 crore". */
export function measureValue(m: Pick<Measure, 'value' | 'unit'>): string {
  const { value, unit } = m
  if (unit === '%') return `${decimal(value)}%`
  if (unit.startsWith('%')) return `${decimal(value)}${unit}`
  if (unit === 's' || unit === 'seconds') return `${decimal(value / 60)} min`
  if (unit === 'min' || unit === 'minutes') return `${decimal(value)} min`
  if (/crore/.test(unit)) return crore(Math.round(value * 100))
  if (/lakh/.test(unit) && !/people/.test(unit)) return crore(Math.round(value))
  if (unit === 'of 100') return `${Math.round(value)} of 100`
  return `${decimal(value)} ${unit}`
}

/** "+1.2", "−0.4", "0": a change in points of 0 to 100, from points in tenths. */
export function signed(tenths: number, places = 1): string {
  const v = tenths / 10
  const text = decimal(Math.abs(v), places)
  if (text === decimal(0, places)) return '0'
  return `${v > 0 ? '+' : '−'}${text}`
}

/** The causes of a measure's change: the rules' own, or those of the report's figure that says the same. */
export function causesOf(m: Measure, report: Report | null, change: number | null): Cause[] {
  if (m.causes.length) return m.causes
  const key = FIGURE_OF[m.key]
  const f = key ? report?.figures.find((x) => x.key === key) : undefined
  if (!f) return []
  return f.causes.filter((c) => believable(c, change ?? f.now - f.before))
}

/** The rules' "no measurable change": a cause with no amount and no figure in its words. */
function isQuiet(c: Cause): boolean {
  return c.amount === 0 && !/\d/.test(c.text)
}

/** A small arrow for which way a measure went: up is always better, since points rise as the city does better. */
function way(change: number | null): HTMLElement {
  // Before the first month has ended there is nothing to compare with, and no arrow.
  if (change === null) return element('span', 'way')
  if (Math.round(change) === 0) return element('span', 'way muted', '→')
  return element('span', `way ${change < 0 ? 'down' : 'up'}`, change > 0 ? '↑' : '↓')
}

/** A plain bar of a measure's points out of 100. */
export function pointsBar(tenths: number): HTMLElement {
  const bar = element('span', 'points-bar')
  const fill = element('i')
  fill.style.width = `${Math.max(0, Math.min(100, tenths / 10))}%`
  bar.append(fill)
  return bar
}

export interface ScoreHooks {
  /** Shows a map view, and on a phone puts the sheet away so that it can be seen. */
  view(view: MeasureView): void
  /** Whether a view can be shown yet (the clean travel view needs the model's trips by zone). */
  canView(view: MeasureView): boolean
  money(): void
  /** Frames an event's place on the map. */
  showEvent(event: GameEvent): void
}

let opened: MeasureKey | null = null

/**
 * The score page (PRD 13.1, SCORE-13): the total, large, with which way it went; the seven measures, each with its
 * points, its figure, its weight and its direction; tapping one says why it moved, what helps it, and offers its map
 * view. Then the events in force.
 */
export function drawScore(body: HTMLElement, game: Game, report: Report | null, hooks: ScoreHooks): void {
  const score = game.score
  if (!score) {
    body.append(element('p', 'muted', 'Working out the score…'))
    return
  }
  const last = game.reports.at(-1)?.score
  const before = last?.before ?? null
  const head = element('div', 'score-head')
  const total = element('div', 'score-total')
  total.append(element('strong', '', grouped(score.total)), element('span', 'muted', ' of 1,000'))
  head.append(total)
  if (before) {
    const d = score.total - before.total
    head.append(element('p', `score-moved ${d < 0 ? 'down' : d === 0 ? 'same' : ''}`, d === 0 ? 'No change last month.'
      : `${d > 0 ? 'Up' : 'Down'} ${Math.abs(d)} last month, from ${grouped(before.total)}.`))
  }
  body.append(head)
  // How much the first and last years count, from the season's own weights.
  const weights = yearWeights(game.season)
  const share = (w: number | undefined) => `${Math.round((w ?? 0) / 10)}%`
  body.append(element('p', 'muted small', 'Your score is the average of your years so far, each year scored on its own ' +
    'twelve months, and each counting more than the year before' +
    (weights?.length ? `: 2026 counts ${share(weights[0])} of the final score, ${2025 + weights.length} counts ${share(weights.at(-1))}` : '') +
    '. Seven measures make each year’s score, each 0 to 100, weighed by its share.'))
  if (score.years?.length) body.append(yearBars(score.years))

  const list = element('div', 'measures')
  for (const m of ordered(score)) list.append(measureRow(m, before, report, game, hooks, () => {
    opened = opened === m.key ? null : m.key
    body.replaceChildren()
    drawScore(body, game, report, hooks)
  }))
  body.append(list)

  const events = game.events ?? []
  if (events.length) {
    body.append(element('h3', '', 'In force now'))
    body.append(eventList(events, game.month, hooks.showEvent))
  }
}

function measureRow(m: Measure, before: Score | null, report: Report | null, game: Game, hooks: ScoreHooks, toggle: () => void): HTMLElement {
  const info = MEASURE_INFO[m.key]
  const b = before?.measures.find((x) => x.key === m.key)
  const change = b ? m.points - b.points : null
  const row = element('div', 'measure')
  row.dataset.measure = m.key
  const head = element('button', 'measure-head')
  head.type = 'button'
  head.setAttribute('aria-expanded', String(opened === m.key))
  const name = element('span', 'measure-name')
  name.append(element('strong', '', info?.name ?? m.name), element('span', 'muted small', ` ${Math.round(m.weight / 10)}%`))
  const pts = element('span', 'measure-points')
  pts.append(element('strong', '', String(points(m))), way(change))
  head.append(name, pts, element('span', 'measure-value muted small', measureValue(m)), pointsBar(m.points))
  head.addEventListener('click', toggle)
  row.append(head)
  if (opened !== m.key) return row

  const more = element('div', 'measure-more')
  if (info) more.append(element('p', 'small', info.what))
  more.append(element('p', 'small', `${points(m)} of 100 points, worth ${decimal(contribution(m), 0)} of the ${m.weight} this measure can add to the score.`))
  if (change !== null) {
    more.append(element('p', 'small strong', Math.round(change) === 0 ? 'No measurable change last month.'
      : `${signed(change)} points last month.`))
  }
  const all = causesOf(m, report, null)
  const causes = all.filter((c) => !isQuiet(c))
  if (!causes.length && all.length && change !== null && Math.round(change) !== 0) {
    more.append(element('p', 'small muted', 'Too small a change to tell apart from the model’s noise.'))
  }
  if (causes.length && change !== null && Math.round(change) !== 0) {
    const ul = element('ul', 'causes')
    for (const c of causes.slice(0, 3)) ul.append(element('li', '', causeLine(c.text, c.amount)))
    more.append(ul)
  }
  if (m.key === 'approval' && game.pressures?.length) {
    more.append(element('p', 'small', 'Pushing it this month:'))
    const ul = element('ul', 'causes')
    for (const p of [...game.pressures].sort((x, y) => Math.abs(y.points) - Math.abs(x.points)).slice(0, 3)) {
      ul.append(element('li', '', `${p.points > 0 ? '+' : '−'}${decimal(Math.abs(p.points))}: ${p.text}`))
    }
    more.append(ul)
  }
  if (info) {
    const dl = element('dl', 'helps')
    dl.append(element('dt', '', 'Helped by'), element('dd', '', info.helps), element('dt', '', 'Hurt by'), element('dd', '', info.hurts))
    more.append(dl)
  }
  const buttons = element('div', 'outlook-buttons')
  if (info?.view) {
    const go = element('button', 'quiet', 'Show it on the map')
    go.type = 'button'
    go.disabled = !hooks.canView(info.view)
    if (go.disabled) go.title = 'The model does not give this by zone yet.'
    const view = info.view
    go.addEventListener('click', () => hooks.view(view))
    buttons.append(go)
  } else if (m.key === 'money') {
    const go = element('button', 'quiet', 'Open the money')
    go.type = 'button'
    go.addEventListener('click', () => hooks.money())
    buttons.append(go)
  }
  if (buttons.childElementCount) more.append(buttons)
  row.append(more)
  return row
}

/** Events as a quiet list: each with what it is, until when, and a way to see its place. */
export function eventList(events: GameEvent[], month: number, show: (e: GameEvent) => void): HTMLElement {
  const ul = element('ul', 'events')
  for (const e of events) {
    const li = element('li')
    const over = e.ends < month
    li.append(element('strong', '', e.title))
    const when = over ? 'Over.' : e.started > month ? `From ${monthShort(e.started)}.`
      : e.ends > e.started ? `Until the end of ${monthShort(e.ends)}.` : 'This month.'
    li.append(element('span', 'small muted', ` ${when}`))
    li.append(element('div', 'small', e.text))
    if (e.at && !over) {
      const go = element('button', 'quiet', 'Show it')
      go.type = 'button'
      go.addEventListener('click', () => show(e))
      li.append(go)
    }
    ul.append(li)
  }
  return ul
}

/**
 * What a thing is forecast to do to the score (PRD UI-5): the total a year on with it against without, and the
 * measures it moves most. Marked as a forecast by the page it sits in.
 */
export function scoreForecast(s: ScoreAhead | undefined, pending: boolean, label = 'Score, a year on'): HTMLElement {
  const box = element('div', 'score-forecast')
  if (!s) {
    box.append(element('p', `muted small${pending ? ' working' : ''}`, pending ? 'Working out what it does to the score…'
      : 'The score could not be forecast.'))
    return box
  }
  const d = s.after.total - s.before.total
  const line = element('p', 'score-forecast-line')
  line.append(element('span', '', label))
  line.append(element('strong', d > 0 ? 'up' : d < 0 ? 'down' : '', d === 0 ? 'No measurable change' : `${d > 0 ? '+' : '−'}${Math.abs(d)}`))
  box.append(line)
  const moves = s.after.measures
    .map((m) => {
      const b = s.before.measures.find((x) => x.key === m.key)
      return { m, d: b ? contribution(m) - contribution(b) : 0 }
    })
    .filter((x) => Math.abs(x.d) >= 0.5)
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
    .slice(0, 3)
  if (moves.length) {
    box.append(element('p', 'small muted', moves.map((x) => `${MEASURE_INFO[x.m.key]?.name ?? x.m.name} ${x.d > 0 ? '+' : '−'}${decimal(Math.abs(x.d), 0)}`).join(' · ')))
  }
  return box
}

/** The score's line at the head of the report: what it was, what it is, and the measure that moved it most, with why. */
export function scoreLead(report: Report): HTMLElement | null {
  const s = report.score
  if (!s) return null
  const box = element('div', 'score-lead')
  const d = s.now.total - s.before.total
  const top = element('p', 'score-lead-total')
  top.append(element('span', '', 'Score '), element('strong', '', grouped(s.now.total)))
  top.append(element('span', `muted ${d < 0 ? 'down' : ''}`, d === 0 ? ', no change' : `, ${d > 0 ? 'up' : 'down'} ${Math.abs(d)} from ${grouped(s.before.total)}`))
  box.append(top)
  const most = movedMost(s.now, s.before)
  if (most && Math.abs(most.change) >= 0.5) {
    const m = most.measure
    const name = MEASURE_INFO[m.key]?.name ?? m.name
    const cause = causesOf(m, report, null)[0]
    // "No measurable change" is the last month's word; beside a change in the score it would contradict it.
    const why = !cause || isQuiet(cause) ? '.' : `: ${causeLine(cause.text, cause.amount)}.`
    box.append(element('p', 'small', `${name} moved it most, ${most.change > 0 ? 'up' : 'down'} ${decimal(Math.abs(most.change), 0)}${why}`))
  } else if (d === 0) box.append(element('p', 'small muted', 'No measure moved it by a point.'))
  return box
}

/** The ten years as ten small bars: each year's own score, the years not yet reached left empty. */
function yearBars(years: NonNullable<Score['years']>): HTMLElement {
  const box = element('div', 'score-years')
  box.setAttribute('role', 'img')
  box.setAttribute('aria-label', years.map((y) => `${y.year}: ${y.total}`).join(', '))
  for (let i = 0; i < 10; i++) {
    const y = years.find((x) => x.year === 2026 + i)
    const col = element('span', `score-year${y && !y.done ? ' now' : ''}`)
    const bar = element('i')
    bar.style.height = `${y ? Math.max(2, Math.round((y.total / 1000) * 36)) : 2}px`
    if (!y) bar.style.background = '#ece7df'
    col.title = y ? `${y.year}: ${y.total}${y.done ? '' : ' so far'}, counting ${Math.round(y.weight / 10)}%` : `${2026 + i}`
    col.append(bar, element('span', '', `’${String(26 + i).padStart(2, '0')}`))
    box.append(col)
  }
  return box
}
