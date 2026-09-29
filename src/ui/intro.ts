import type { Map as MapLibre } from 'maplibre-gl'
import type { LngLat } from '../data/types'
import type { Game, Report } from '../rules/types'
import type { FirstSteps } from '../sim/worker'
import { element } from './controls'
import { grouped, monthLong } from './format'
import { onSignal } from './signals'
import './first.css'

const KEY = 'peakooru.intro'

/** Whether this browser has been through the introduction or skipped it. */
export function introSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === 'seen'
  } catch {
    return false
  }
}

function remember(): void {
  try {
    localStorage.setItem(KEY, 'seen')
  } catch {
    // A browser that keeps nothing shows it again next time, which does no harm.
  }
}

/** What the introduction needs from the screen. */
export interface LessonHooks {
  phone: boolean
  map: MapLibre
  /** The road to mend and the bus route to lay, chosen by the worker from the city as it stands. */
  steps(): Promise<FirstSteps>
  game(): Game | null
  /** The report shown on the Report page, and whether a month is being worked out. */
  reported(): Report | null
  busy(): boolean
  /** Which page is open. */
  tab(): string | null
  openReport(): void
  closePanel(): void
  /** Opens the Build page with the road chosen to patch. */
  mend(road: NonNullable<FirstSteps['road']>): void
  /** Opens the Build page with the bus route tool chosen. */
  busTool(): void
  /** The Build page's tool, the stops placed, and whether the plan as it stands can be built. */
  building(): { tool: string | null; stops: number; ok: boolean }
  /** What the page's cards cover of the map at each side, in pixels. */
  cover(): { top: number; bottom: number; left: number; right: number }
}

/** One step of the introduction. */
interface Step {
  id: string
  /** Which of the five stages it belongs to: the score, a road, a bus route, the month's end, what it did. */
  stage: number
  /** At most two short sentences: what to do. */
  words(): string
  /** The thing on the screen to point at, if any. */
  target?(): HTMLElement | null
  /** Places on the map to ring, the first the one to tap now. */
  spots?(): { at: LngLat; name: string }[]
  /** Places on the map the card must not cover. */
  avoid?: LngLat[]
  /** Sets the screen up for the step: opens a page, chooses a tool. Done again by "Show me again". */
  enter?(): void
  /** Whether the player has done it. Polled. */
  done(): boolean
  /** Whether the player has wandered away from it, so that "Show me again" is offered. */
  lost?(): boolean
  /** A press that completes the step, for a step that is only read. */
  button?: string
  /** One line said at the start of the next step: what the player's act did. */
  said?(): string | null
}

/**
 * The introduction to a first game (PRD UI-11), taught by doing: the player reads the score, patches a bad road near
 * the middle of the city, lays a bus route by tapping the map twice, ends the month, and reads what those did. Each
 * step points at the thing to press, waits for the player to press it, and says in one line what it did. Never more
 * than two short sentences at once. Skippable at every step, remembered, and asked for again from the pages.
 */
export class Lesson {
  private readonly card = element('section', 'card intro first-card')
  private readonly rings = element('div', 'first-rings')
  private steps: Step[] = []
  private at = 0
  private ringed: HTMLElement | null = null
  private scrolled: HTMLElement | null = null
  private timer = 0
  private drawn = ''
  private carried: string | null = null
  private month = 0
  private plan: FirstSteps | null = null
  /** The places last framed, and when, so that framing is tried again if something else moved the map first. */
  private framing: { points: LngLat[]; tries: number; at: number } | null = null

  constructor(private readonly hooks: LessonHooks) {
    this.card.hidden = true
    this.card.setAttribute('role', 'dialog')
    this.card.setAttribute('aria-label', 'How to play')
    this.card.setAttribute('aria-live', 'polite')
    document.body.append(this.card, this.rings)
    addEventListener('resize', () => this.place())
    hooks.map.on('move', () => this.placeRings())
    // What the player does is looked at at once, not at the next tick.
    onSignal((name) => {
      if (this.showing && (name === 'built' || name === 'placed' || name === 'month')) setTimeout(() => this.tick(), 50)
    })
  }

  get showing(): boolean {
    return !this.card.hidden
  }

  /** Begins the introduction from the game as it stands. */
  async start(): Promise<void> {
    const game = this.hooks.game()
    if (!game || game.status !== 'playing') return
    this.month = game.month
    this.plan = await this.hooks.steps().catch(() => ({ road: null, bus: null }))
    this.steps = this.build(this.plan)
    this.at = 0
    this.carried = null
    this.drawn = ''
    this.enter()
    clearInterval(this.timer)
    this.timer = window.setInterval(() => this.tick(), 300)
  }

  /** Puts the introduction away, remembered as seen. */
  hide(): void {
    clearInterval(this.timer)
    this.card.hidden = true
    this.rings.replaceChildren()
    this.ring(null)
    remember()
  }

  private build(plan: FirstSteps): Step[] {
    const h = this.hooks
    const tap = h.phone ? 'Tap' : 'Click'
    const game = () => h.game()
    const doneThisMonth = (kind: string) => !!game()?.done.some((d) => d.month === this.month && d.action.kind === 'build' && d.action.plan.kind === kind)
    const inPanel = (selector: string) => {
      const b = document.querySelector<HTMLElement>(`.panel.open ${selector}`)
      return b && b.getClientRects().length ? b : null
    }
    const magnifier = () => document.querySelector<HTMLElement>('.magnifier:not([hidden]) [data-build="magnify-ok"]')
      ?? document.querySelector<HTMLElement>('.magnifier:not([hidden]) .commit')
    /** The Build page's button that orders the plan. */
    const order = () => inPanel('[data-build="commit"]') ?? inPanel('.commit')
    const monthOver = () => (game()?.month ?? 0) > this.month
    const steps: Step[] = []
    const score = game()?.score?.total
    steps.push({
      id: 'score',
      stage: 1,
      words: () => `This is your score: ${score === undefined ? 'out of 1,000' : `${grouped(score)} of 1,000`}. ` +
        'Govern Bengaluru well and it rises.',
      target: () => document.querySelector<HTMLElement>('.bar-score'),
      enter: () => h.closePanel(),
      button: 'Show me how',
      done: () => false,
    })
    const road = plan.road
    if (road) {
      steps.push({
        id: 'mend',
      stage: 2,
        enter: () => h.mend(road),
        words: () => `Potholes on ${road.name} cost drivers ${grouped(road.hours)} hours a day. Patch them.`,
        target: () => order(),
        lost: () => h.tab() !== 'build' || !['patch', 'resurface', 'concrete'].includes(h.building().tool ?? ''),
        done: () => doneThisMonth('repair'),
        said: () => `Patched: ${road.name.split(',')[0]} will be quicker from next month.`,
      })
    }
    const bus = plan.bus
    if (bus) {
      const ends = [bus.from, bus.to]
      const onBus = () => h.tab() === 'build' && h.building().tool === 'busRoute'
      steps.push({
        id: 'bus-start',
      avoid: ends.map((e) => e.at),
      stage: 3,
        enter: () => {
          h.busTool()
          this.frame(ends.map((e) => e.at))
        },
        words: () => magnifier() ? 'Move the map to put the cross on the ring, then press the button.'
          : `Now lay a bus route: ${tap.toLowerCase()} the ring at ${bus.from.name} for its first stop.`,
        target: () => magnifier(),
        spots: () => [bus.from, bus.to],
        lost: () => !onBus(),
        done: () => onBus() && h.building().stops >= 1,
      })
      steps.push({
        id: 'bus-end',
      avoid: ends.map((e) => e.at),
      stage: 3,
        enter: () => {
          if (!onBus()) h.busTool()
          this.frame(ends.map((e) => e.at))
        },
        words: () => magnifier() ? 'Put the cross on the ring, then press the button.'
          : `${tap} the ring at ${bus.to.name} to end the route there.`,
        target: () => magnifier(),
        spots: () => [bus.to],
        lost: () => !onBus() || h.building().stops < 1,
        done: () => onBus() && h.building().stops >= 2 && h.building().ok,
      })
      steps.push({
        id: 'bus-build',
      avoid: ends.map((e) => e.at),
      stage: 3,
        words: () => 'The buses take the quickest roads between your stops. Build the route.',
        target: () => order(),
        lost: () => !onBus() || h.building().stops < 2,
        enter: () => {
          if (!onBus()) h.busTool()
        },
        done: () => doneThisMonth('busRoute'),
        said: () => {
          const p = (game()?.projects ?? []).filter((x) => x.plan.kind === 'busRoute').at(-1)
          return p ? `Ordered: its buses start in ${monthLong(p.opens)}.` : 'Ordered.'
        },
      })
    }
    steps.push({
      id: 'end',
      stage: 4,
      words: () => 'That is enough for one month: end it and see what happens.',
      target: () => document.querySelector<HTMLElement>('.next'),
      enter: () => {
        if (h.phone) h.closePanel()
      },
      done: () => monthOver() && !h.busy() && (h.reported()?.to ?? -1) >= this.month,
    })
    steps.push({
      id: 'read',
      stage: 5,
      enter: () => h.openReport(),
      words: () => {
        const s = h.reported()?.score
        const d = s ? s.now.total - s.before.total : 0
        const moved = !s ? '' : d === 0 ? 'Your score did not move this month.' : `Your score went ${d > 0 ? 'up' : 'down'} ${Math.abs(d)}.`
        return `This is what your work did. ${moved}`.trim()
      },
      target: () => inPanel('.report-yours') ?? inPanel('.report-when'),
      button: 'Carry on',
      done: () => false,
    })
    steps.push({
      id: 'help',
      stage: 5,
      words: () => 'Not sure what to do next? This always has three ideas you can afford.',
      target: () => document.querySelector<HTMLElement>('.what-now'),
      button: 'Start playing',
      done: () => false,
    })
    return steps
  }

  private get step(): Step | undefined {
    return this.steps[this.at]
  }

  private enter(): void {
    this.framing = null
    this.drawn = ''
    this.scrolled = null
    this.step?.enter?.()
    this.render()
  }

  private next(): void {
    const said = this.step?.said?.() ?? null
    this.at++
    if (!this.step) return this.hide()
    this.carried = said
    this.enter()
  }

  private tick(): void {
    const step = this.step
    if (!step || this.card.hidden) return
    // A month ended before its step: the player went their own way, and the lesson goes on to what the month did.
    const end = this.steps.findIndex((s) => s.id === 'end')
    if (this.at < end && (this.hooks.game()?.month ?? 0) > this.month) {
      this.at = end
      this.carried = null
      this.enter()
      return
    }
    if (step.done()) return this.next()
    this.reframe()
    this.render()
  }

  private render(): void {
    const step = this.step
    if (!step) return
    const lost = step.lost?.() ?? false
    // A step that asks for a tap on the map says so only once its ring is in sight, clear of the card.
    const waiting = !lost && !!step.spots?.().length && !document.body.classList.contains('magnifying') && !this.ringInSight()
    const words = waiting ? 'Moving the map to the place…' : step.words()
    const key = `${this.at}|${words}|${lost}|${this.carried}`
    if (key !== this.drawn) {
      this.drawn = key
      const row = element('div', 'outlook-buttons')
      if (step.button) {
        const go = element('button', 'commit', step.button)
        go.type = 'button'
        go.addEventListener('click', () => this.next())
        row.append(go)
      }
      if (lost) {
        const again = element('button', 'commit', 'Show me again')
        again.type = 'button'
        again.addEventListener('click', () => this.enter())
        row.append(again)
      }
      const skip = element('button', 'quiet', step.id === 'help' ? 'Close' : 'Skip the introduction')
      skip.type = 'button'
      skip.addEventListener('click', () => this.hide())
      if (step.id !== 'help') row.append(skip)
      const text = element('p', 'first-words')
      // The line saying what the last act did, then what to do now: two sentences at most.
      if (this.carried && !lost) text.append(element('span', 'first-said', `${this.carried} `))
      text.append(words)
      const stages = new Set(this.steps.map((s) => s.stage)).size
      const stage = [...new Set(this.steps.slice(0, this.at + 1).map((s) => s.stage))].length
      this.card.replaceChildren(element('p', 'muted small intro-count', `${stage} of ${stages}`), text, row)
      this.card.hidden = false
      // A step that is only read is answered from the keyboard at once; one that points elsewhere leaves focus alone.
      if (step.button && matchMedia('(pointer: fine)').matches) row.querySelector<HTMLButtonElement>('.commit')?.focus({ preventScroll: true })
    }
    this.place()
  }

  private ring(target: HTMLElement | null): void {
    if (this.ringed === target) return
    this.ringed?.classList.remove('intro-target')
    this.ringed = target
    target?.classList.add('intro-target')
  }

  /** Frames places on the map in what shows of it. */
  private frame(points: LngLat[], again = false): void {
    if (!points.length) return
    if (!again) this.framing = { points, tries: 0, at: Date.now() }
    // The page may still be opening or lowering: framed once it has.
    setTimeout(() => {
      const c = this.hooks.cover()
      const xs = points.map((p) => p[0]), ys = points.map((p) => p[1])
      const pad = this.hooks.phone ? 50 : 110
      // The padding must leave some map to fit into, or the map does not move at all.
      const fit = (a: number, b: number, room: number) => {
        const k = a + b > room - 120 ? (room - 120) / (a + b) : 1
        return [Math.max(0, a * k), Math.max(0, b * k)]
      }
      // On a phone the card sits at the top of the map: the places are framed below it.
      const [top, bottom] = fit(c.top + pad + (this.hooks.phone ? this.card.offsetHeight : 0), c.bottom + pad, innerHeight)
      const [left, right] = fit(c.left + pad, c.right + pad, innerWidth)
      this.hooks.map.fitBounds([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], {
        padding: { top: top!, bottom: bottom!, left: left!, right: right! },
        maxZoom: 14.5, duration: 600,
      })
    }, 400)
  }

  /**
   * Frames the places again if they are not in what shows of the map: the page opening or lowering, or a frame of its
   * own, may have moved the map after the first. Tried a few times, and never while the map is moving.
   */
  private reframe(): void {
    const f = this.framing
    if (!f || f.tries >= 5 || Date.now() - f.at < 1200 || this.hooks.map.isMoving()) return
    const c = this.hooks.cover()
    const out = !this.ringInSight() || f.points.some((at) => {
      const p = this.hooks.map.project(at)
      return p.y < c.top + 20 || p.y > innerHeight - c.bottom - 20 || p.x < c.left + 20 || p.x > innerWidth - c.right - 20
    })
    if (!out) return
    f.tries++
    f.at = Date.now()
    this.frame(f.points, true)
  }

  /** Whether the ring to tap now is in what shows of the map, still, and not under the card. */
  private ringInSight(): boolean {
    const at = this.step?.spots?.()[0]?.at
    if (!at) return true
    if (this.hooks.map.isMoving()) return false
    const p = this.hooks.map.project(at)
    const c = this.hooks.cover()
    if (p.y < c.top + 24 || p.y > innerHeight - c.bottom - 24 || p.x < c.left + 24 || p.x > innerWidth - c.right - 24) return false
    if (this.card.hidden) return true
    const r = this.card.getBoundingClientRect()
    return !(p.x > r.left - 24 && p.x < r.right + 24 && p.y > r.top - 24 && p.y < r.bottom + 24)
  }

  /** The rings on the map, where the player is to tap. */
  private placeRings(): void {
    const spots = this.card.hidden ? [] : (this.step?.spots?.() ?? [])
    const magnifying = document.body.classList.contains('magnifying')
    while (this.rings.children.length > spots.length) this.rings.lastElementChild!.remove()
    while (this.rings.children.length < spots.length) {
      const r = element('div', 'first-ring')
      r.append(element('i'), element('span', 'first-ring-name'))
      this.rings.append(r)
    }
    const c = this.hooks.cover()
    spots.forEach((s, i) => {
      const r = this.rings.children[i] as HTMLElement
      const p = this.hooks.map.project(s.at)
      r.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`
      r.classList.toggle('later', i > 0)
      // A ring under the bar or the page is not drawn over them.
      const under = p.y < c.top || p.y > innerHeight - c.bottom || p.x < c.left || p.x > innerWidth - c.right
      r.hidden = (magnifying && i > 0) || under
      r.querySelector('.first-ring-name')!.textContent = s.name
    })
  }

  /** Puts the card beside what it points at, inside the window, and rings the target. */
  private place(): void {
    if (this.card.hidden) return
    this.placeRings()
    const step = this.step
    const found = step?.target?.() ?? null
    const target = found && found.getClientRects().length ? found : null
    this.ring(target)
    if (target && this.scrolled !== target) {
      this.scrolled = target
      target.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
    const gap = 14
    const w = Math.min(320, innerWidth - 32)
    this.card.style.width = `${w}px`
    const h = this.card.offsetHeight
    const c = this.hooks.cover()
    let left: number
    let top: number
    const spots = step?.spots?.() ?? []
    if (!target) {
      // Over the map that shows, where it covers none of the places the player is to tap or has tapped.
      const places = [...spots.map((x) => x.at), ...(step?.avoid ?? [])].map((p) => this.hooks.map.project(p))
      const x0 = c.left + 12, x1 = innerWidth - c.right - w - 12
      const y0 = c.top + 12, y1 = innerHeight - c.bottom - h - 12
      const tries: [number, number][] = [[(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1], [x0, y0], [x1, y0], [x0, y1], [x1, y1]]
      const clear = (among: typeof places) => ([x, y]: [number, number]) =>
        !among.some((p) => p.x > x - 40 && p.x < x + w + 40 && p.y > y - 40 && p.y < y + h + 50)
      // Clear of every place if it can be; else clear of the one to tap now.
      ;[left, top] = tries.find(clear(places)) ?? tries.find(clear(places.slice(0, 1))) ?? tries[0]!
    } else {
      const r = target.getBoundingClientRect()
      left = r.left + r.width / 2 - w / 2
      const panel = target.closest('.panel')?.getBoundingClientRect()
      if (panel && this.hooks.phone) {
        // On a phone, a thing in the page's sheet: the words go at the top, over the map, clear of the sheet.
        top = c.top + 12
      } else if (panel && !this.hooks.phone && panel.right + gap + w < innerWidth) {
        // A thing inside the page at the left: the words go to the right of the page, level with it.
        left = panel.right + gap
        top = r.top + r.height / 2 - h / 2
      } else if (r.bottom + gap + h < innerHeight - 8) top = r.bottom + gap
      else top = r.top - gap - h
    }
    left = Math.max(16, Math.min(innerWidth - w - 16, left))
    top = Math.max(8, Math.min(innerHeight - h - 8, top))
    this.card.style.left = `${Math.round(left)}px`
    this.card.style.top = `${Math.round(top)}px`
  }
}
