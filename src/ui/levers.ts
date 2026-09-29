import type { Action, Entry, Game, Outcome, Upkeep } from '../rules/types'
import { scoreForecast } from './score'
import type { Mode } from '../sim/types'
import type { Forecast, Outlook } from '../sim/worker'
import { announce, element, keepFocus } from './controls'
import { crore, decimal, people, perKm } from './format'
import { signal } from './signals'

export interface LeverHooks {
  may(actions: Action[]): Promise<Outcome[]>
  forecast(action: Action): Promise<Forecast>
  act(action: Action): Promise<Outcome>
}

type FareMode = 'metro' | 'bus' | 'rail'
/** Fares are set in whole paise a km. A step of a tap: fine enough to choose, coarse enough not to tap for long. */
const FARES: { mode: FareMode; name: string; step: number }[] = [
  { mode: 'metro', name: 'Metro', step: 50 },
  { mode: 'bus', name: 'Bus', step: 20 },
  { mode: 'rail', name: 'Suburban rail', step: 10 },
]
/** Amounts offered to borrow, in lakh: ₹100, 200, 500 and 1,000 crore. The rules take any multiple of ₹100 crore. */
export const LOAN_AMOUNTS = [10_000, 20_000, 50_000, 100_000]
/** Five percent of the standard rate a tap. */
const TAX_STEP = 500
/** How long the player must rest on a value before the model is asked what it would do. */
const PAUSE_MS = 450

const MODE_WORDS: Record<FareMode, string> = { metro: 'Metro trips', bus: 'Bus trips', rail: 'Suburban rail trips' }

/** The three levels of the upkeep budget, and what each does (PRD UPK-4, UPK-13). */
const LEVELS: { level: Upkeep; name: string; does: string }[] = [
  { level: 'bare', name: 'Bare', does: 'The city’s roads fall about a grade in three years.' },
  { level: 'steady', name: 'Steady', does: 'The roads hold as they are, and the worst are patched.' },
  { level: 'generous', name: 'Generous', does: 'The roads slowly get better, and more of the worst are patched.' },
]
/** The standing order to patch a zone: the conditions it may be set at, and a tap's step. */
const ORDER = { least: 10, most: 70, step: 5, first: 40 }

/** What the upkeep of roads costs a month in some books: every line of it. */
export function upkeepCost(books: Entry[]): number {
  return -books.filter((e) => e.key.startsWith('upkeep')).reduce((sum, e) => sum + e.amount, 0)
}

function button(className: string, text: string, label?: string): HTMLButtonElement {
  const b = element('button', className, text)
  b.type = 'button'
  if (label) b.setAttribute('aria-label', label)
  return b
}

/** What a change is, in words for its button: "Set the bus fare to ₹1.40 a km". */
function describe(action: Action, game: Game): string {
  switch (action.kind) {
    case 'tax':
      return `Set the rate to ${decimal(action.rate / 100, 0)}%`
    case 'fare':
      return `Set the ${action.mode === 'rail' ? 'suburban rail' : action.mode} fare to ${perKm(action.perKm / 100)}`
    case 'borrow':
      return `Borrow ${crore(action.amount)}`
    case 'repay': {
      const loan = game.loans.find((l) => l.id === action.loan)
      return `Repay ${loan ? crore(loan.owed) : 'the loan'} now`
    }
    case 'upkeep':
      if (action.patchBelow === null) return 'Stop the standing order'
      if (action.patchBelow !== undefined) return `Patch zones that fall below ${action.patchBelow}`
      return `Set road upkeep to ${action.level}`
    case 'digOnce':
      return action.on ? 'Bring in dig once' : 'End dig once'
    default:
      return 'Go ahead'
  }
}

function key(action: Action): string {
  return JSON.stringify(action)
}

/**
 * The three levers of this slice: the property tax rate, the fares, and loans. Each change shows what it is expected
 * to do before the player commits to it, marked as a forecast (PRD UI-5): the model is asked for the month with the
 * change made, once the player rests on a value. A change that cannot be made says why, beside it (UI-6).
 */
export class Levers {
  private game: Game | null = null
  private body: HTMLElement | null = null
  /** The change being looked at, and what the model said of it; null while it is being worked out. */
  private pending: Action | null = null
  private forecast: Forecast | null = null
  private failed: string | null = null
  private timer = 0
  /** Reasons a lever cannot be used at all this month, by lever. */
  private locked: { tax: string | null; borrow: string | null } = { tax: null, borrow: null }
  private checked = ''
  /** What each level of upkeep costs a month, as the books would have it, for the month asked. */
  private levelCosts: { stamp: string; cost: Partial<Record<Upkeep, number>> } = { stamp: '', cost: {} }

  constructor(private readonly hooks: LeverHooks) {}

  /** Draws the levers into `body` for `game`. A new month or a change made forgets the change being looked at. */
  draw(body: HTMLElement, game: Game): void {
    const moved = !this.game || this.game.month !== game.month || this.game.done.length !== game.done.length
    this.game = game
    this.body = body
    if (moved) {
      this.pending = null
      this.forecast = null
    }
    const stamp = `${game.month}:${game.done.length}`
    if (this.checked !== stamp) {
      this.checked = stamp
      void this.check(game)
      void this.costLevels(game, stamp)
    }
    this.render()
  }

  /** Asks whether the tax rate and borrowing can be used at all this month, to say why not up front. */
  private async check(game: Game): Promise<void> {
    const [up, down, borrow] = await this.hooks.may([
      { kind: 'tax', rate: game.taxRate + TAX_STEP },
      { kind: 'tax', rate: game.taxRate - TAX_STEP },
      { kind: 'borrow', amount: LOAN_AMOUNTS[0]! },
    ])
    const both = up && down && !up.ok && !down.ok && up.reason === down.reason
    this.locked = { tax: both ? (up as { reason: string }).reason : null, borrow: borrow && !borrow.ok ? borrow.reason : null }
    if (this.game === game) this.render()
  }

  /** Asks what each level of upkeep would cost this month: the books with it set, from a forecast of each. */
  private async costLevels(game: Game, stamp: string): Promise<void> {
    const cost: Partial<Record<Upkeep, number>> = {}
    for (const { level } of LEVELS) {
      const f = await this.hooks.forecast({ kind: 'upkeep', level })
      const books = level === (game.upkeep ?? 'steady') || !f.after ? f.before.books : f.after.books
      cost[level] = upkeepCost(books)
      if (this.checked !== stamp) return
    }
    this.levelCosts = { stamp, cost }
    if (this.game === game) this.render()
  }

  private look(action: Action | null): void {
    this.pending = action
    this.forecast = null
    this.failed = null
    clearTimeout(this.timer)
    this.render()
    if (!action) return
    this.timer = window.setTimeout(async () => {
      try {
        const forecast = await this.hooks.forecast(action)
        if (this.pending && key(this.pending) === key(action)) {
          this.forecast = forecast
          this.render()
        }
      } catch (error) {
        this.failed = String(error)
        this.render()
      }
    }, PAUSE_MS)
  }

  private async commit(action: Action): Promise<void> {
    const outcome = await this.hooks.act(action)
    signal(outcome.ok ? 'changed' : 'refused')
    announce(outcome.ok ? `Done: ${describe(action, this.game ?? ({} as Game)).replace(/^./, (c) => c.toLowerCase())}.` : outcome.reason)
    if (!outcome.ok) {
      this.failed = outcome.reason
      this.render()
    }
  }

  private render(): void {
    const { body, game } = this
    if (!body || !game) return
    const top = body.scrollTop
    body.replaceChildren()
    const over = game.status !== 'playing'

    // Property tax.
    const tax = element('section', 'lever')
    tax.dataset.lever = 'tax'
    const rate = this.pending?.kind === 'tax' ? this.pending.rate : game.taxRate
    tax.append(element('h3', '', 'Property tax'))
    tax.append(element('p', 'muted small', 'The city’s main income. It can change once a year. A higher rate slows the city’s growth.'))
    tax.append(this.stepper(`${decimal(rate / 100, 0)}% of the standard rate`, 'the tax rate', !!this.locked.tax || over,
      (sign) => {
        const next = rate + sign * TAX_STEP
        this.look(next === game.taxRate ? null : { kind: 'tax', rate: next })
      }))
    if (this.locked.tax) tax.append(element('p', 'reason', this.locked.tax))
    if (this.pending?.kind === 'tax') tax.append(this.outlook(this.pending, game))
    body.append(tax)

    // Fares.
    const fares = element('section', 'lever')
    fares.dataset.lever = 'fare'
    fares.append(element('h3', '', 'Fares'))
    fares.append(element('p', 'muted small', 'Rupees a kilometre. Cheaper fares draw riders from the roads, and earn less a rider.'))
    for (const { mode, name, step } of FARES) {
      // The game keeps fares in rupees, as the model takes them; the actions carry whole paise.
      const current = Math.round(game.prices[`${mode}PerKm`] * 100)
      const shown = this.pending?.kind === 'fare' && this.pending.mode === mode ? this.pending.perKm : current
      const row = element('div', 'fare')
      row.append(element('span', 'fare-name', name))
      row.append(this.stepper(perKm(shown / 100), `the ${name.toLowerCase()} fare`, over, (sign) => {
        const next = Math.round((shown + sign * step) / step) * step
        this.look(next === current ? null : { kind: 'fare', mode, perKm: next })
      }))
      fares.append(row)
      if (this.pending?.kind === 'fare' && this.pending.mode === mode) fares.append(this.outlook(this.pending, game))
    }
    body.append(fares)

    // Loans.
    const loans = element('section', 'lever')
    loans.dataset.lever = 'borrow'
    loans.append(element('h3', '', 'Loans'))
    loans.append(element('p', 'muted small', 'Repaid monthly with interest. The rate rises with what the city owes.'))
    const amounts = element('div', 'amounts')
    for (const amount of LOAN_AMOUNTS) {
      const b = button('', crore(amount))
      b.setAttribute('aria-pressed', String(this.pending?.kind === 'borrow' && this.pending.amount === amount))
      b.disabled = over || !!this.locked.borrow
      b.addEventListener('click', () =>
        this.look(this.pending?.kind === 'borrow' && this.pending.amount === amount ? null : { kind: 'borrow', amount }))
      amounts.append(b)
    }
    loans.append(element('div', 'small', 'Borrow'), amounts)
    if (this.locked.borrow) loans.append(element('p', 'reason', this.locked.borrow))
    if (this.pending?.kind === 'borrow') loans.append(this.outlook(this.pending, game))
    for (const loan of game.loans.filter((l) => l.owed > 0)) {
      const row = element('div', 'loan')
      row.append(element('span', '', `${crore(loan.owed)} owed, ${crore(loan.payment)} a month`))
      const repay = button('', 'Repay')
      repay.disabled = over
      repay.setAttribute('aria-pressed', String(this.pending?.kind === 'repay' && this.pending.loan === loan.id))
      repay.addEventListener('click', () =>
        this.look(this.pending?.kind === 'repay' && this.pending.loan === loan.id ? null : { kind: 'repay', loan: loan.id }))
      row.append(repay)
      loans.append(row)
      if (this.pending?.kind === 'repay' && this.pending.loan === loan.id) loans.append(this.outlook(this.pending, game))
    }
    body.append(loans)
    body.append(this.roads(game, over))
    body.scrollTop = top
    keepFocus(body)
  }

  /** The upkeep budget, dig once, and the standing order to patch a zone (PRD UPK-4, POL-4, TIME-10). */
  private roads(game: Game, over: boolean): HTMLElement {
    const box = element('section', 'lever roads-lever')
    box.dataset.lever = 'upkeep'
    box.append(element('h3', '', 'Road upkeep'))
    box.append(element('p', 'muted small', 'A monthly sum that slows wear on every road and patches the worst.'))
    const now = game.upkeep ?? 'steady'
    const pending = this.pending?.kind === 'upkeep' && this.pending.patchBelow === undefined ? this.pending.level : null
    const shown = pending ?? now
    const levels = element('div', 'amounts levels')
    const costs = this.levelCosts.cost
    for (const { level, name } of LEVELS) {
      const b = button('', '')
      b.dataset.level = level
      b.setAttribute('aria-pressed', String(shown === level))
      b.disabled = over
      const cost = costs[level]
      b.append(element('strong', '', name), element('span', 'small muted', cost === undefined ? '…' : `${crore(cost)} a month`))
      b.addEventListener('click', () => this.look(level === now ? null : { kind: 'upkeep', level }))
      levels.append(b)
    }
    box.append(levels)
    box.append(element('p', 'small', `${LEVELS.find((l) => l.level === shown)!.does}${shown === now ? ' This is the level now.' : ''}`))
    if (pending) box.append(this.outlook(this.pending!, game))

    // Dig once.
    const dig = element('div', 'dig-once')
    dig.dataset.lever = 'digOnce'
    const on = !!game.digOnce
    dig.append(element('h3', '', 'Dig once'))
    dig.append(element('p', 'muted small', 'Utilities may dig up a road only in two set months of the year, and must ' +
      'restore it after. Roads last longer; the utilities object, and new connections come a little slower.'))
    const toggle = button('toggle dig-toggle', on ? 'Dig once is in force' : 'Utilities dig when they like')
    toggle.setAttribute('aria-pressed', String(on))
    toggle.disabled = over
    toggle.addEventListener('click', () => this.look(this.pending?.kind === 'digOnce' ? null : { kind: 'digOnce', on: !on }))
    dig.append(toggle)
    if (this.pending?.kind === 'digOnce') dig.append(this.outlook(this.pending, game))
    box.append(dig)

    // Standing orders.
    const orders = element('div', 'orders')
    orders.dataset.lever = 'orders'
    orders.append(element('h3', '', 'Standing orders'))
    const set = game.patchBelow
    const asked = this.pending?.kind === 'upkeep' && this.pending.patchBelow !== undefined ? this.pending.patchBelow : undefined
    const value = asked === undefined ? (set ?? ORDER.first) : (asked ?? set ?? ORDER.first)
    orders.append(element('p', 'small', set === undefined
      ? 'None set. An order is carried out every month until you stop it.'
      : `Patch the potholes of any zone whose roads fall below ${set} of 100. In force.`))
    const row = element('div', 'fare')
    row.append(element('span', 'fare-name', 'Patch a zone below'))
    row.append(this.stepper(`${value} of 100`, 'the condition', over, (sign) => {
      const next = Math.max(ORDER.least, Math.min(ORDER.most, value + sign * ORDER.step))
      this.look(next === set ? null : { kind: 'upkeep', level: now, patchBelow: next })
    }))
    orders.append(row)
    if (set === undefined && asked === undefined) {
      const start = button('quiet', `Set it at ${value}`)
      start.disabled = over
      start.addEventListener('click', () => this.look({ kind: 'upkeep', level: now, patchBelow: value }))
      orders.append(start)
    } else if (set !== undefined && asked === undefined) {
      const stop = button('quiet', 'Stop the order')
      stop.disabled = over
      stop.addEventListener('click', () => this.look({ kind: 'upkeep', level: now, patchBelow: null }))
      orders.append(stop)
    }
    orders.append(element('p', 'muted small', 'Fair is 50 and above; poor 25 to 49; broken under 25.'))
    if (asked !== undefined) orders.append(this.outlook(this.pending!, game))
    box.append(orders)
    return box
  }

  private stepper(value: string, what: string, disabled: boolean, onStep: (sign: 1 | -1) => void): HTMLElement {
    const box = element('div', 'stepper')
    const less = button('', '−', `Lower ${what}`)
    const more = button('', '+', `Raise ${what}`)
    less.disabled = more.disabled = disabled
    less.addEventListener('click', () => onStep(-1))
    more.addEventListener('click', () => onStep(1))
    box.append(less, element('span', 'value', value), more)
    return box
  }

  /** The forecast for a change, or word that it is being worked out, and the button to make it. */
  private outlook(action: Action, game: Game): HTMLElement {
    const box = element('div', 'outlook')
    box.setAttribute('aria-live', 'polite')
    const f = this.forecast
    if (this.failed) {
      box.append(element('p', 'reason', this.failed))
      return box
    }
    if (!f) {
      box.append(element('p', 'muted small working', 'Working out the forecast…'))
      return box
    }
    if (!f.outcome.ok || !f.after) {
      box.append(element('p', 'reason', f.outcome.ok ? 'This cannot be done now.' : f.outcome.reason))
      return box
    }
    box.append(element('p', 'forecast-tag', 'Forecast for this month'))
    box.append(scoreForecast(f.score, false))
    const rows = compare(action, f.before, f.after)
    const table = element('dl')
    for (const [name, from, to] of rows) {
      table.append(element('dt', '', name), element('dd', '', `${from} → ${to}`))
    }
    box.append(table)
    const go = button('commit', describe(action, game))
    go.addEventListener('click', () => void this.commit(action))
    const cancel = button('quiet', 'Leave it')
    cancel.addEventListener('click', () => this.look(null))
    const buttons = element('div', 'outlook-buttons')
    buttons.append(go, cancel)
    box.append(buttons, element('p', 'muted small', 'The model’s estimate, against making no change.'))
    return box
  }
}

/** The figures a change moves: the commute, riders, the lines of the books that differ, and the money. */
export function compare(action: Action, before: Outlook, after: Outlook): [string, string, string][] {
  const rows: [string, string, string][] = []
  const minutes = (s: number) => `${decimal(s / 60)} min`
  if (action.kind === 'tax' || action.kind === 'fare' || before.commute !== after.commute) {
    rows.push(['Average commute', minutes(before.commute), minutes(after.commute)])
  }
  if (action.kind === 'fare') {
    const m = action.mode as Mode
    rows.push([`${MODE_WORDS[action.mode]} a day`, people(before.trips[m]), people(after.trips[m])])
    const drive = (o: Outlook) => o.trips.car + o.trips.twoWheeler
    rows.push(['Car and two-wheeler trips', people(drive(before)), people(drive(after))])
  }
  const amounts = (entries: Entry[]) => new Map(entries.map((e) => [e.key, e]))
  const b = amounts(before.books)
  const a = amounts(after.books)
  // Only the lines of the books that move by ₹50 lakh or more, the three that move most.
  const moved = [...new Set([...b.keys(), ...a.keys()])]
    .map((k) => ({ k, from: b.get(k)?.amount ?? 0, to: a.get(k)?.amount ?? 0 }))
    .filter((m) => Math.abs(m.to - m.from) >= 50)
    .sort((x, y) => Math.abs(y.to - y.from) - Math.abs(x.to - x.from))
    .slice(0, 3)
  for (const m of moved) rows.push([(a.get(m.k) ?? b.get(m.k))!.name, crore(m.from), crore(m.to)])
  rows.push(['Money at the month’s end', crore(before.money), crore(after.money)])
  return rows
}
