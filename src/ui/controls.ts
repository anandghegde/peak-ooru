import type { Zone } from '../data/types'
import { CLASS_COLOURS } from '../map/network'
import { JAM_SWATCHES } from '../map/traffic'
import { FLOOD_COLOUR, ROAD_CREAM, STREET_SHADES, SURFACE_COLOURS } from '../map/condition'
import { FEW_PEOPLE, SHADES, density, type ZoneView } from '../map/zones'
import { PERIODS, type Period } from '../sim/types'

const VIEWS: { view: ZoneView; label: string; title?: string }[] = [
  { view: 'plain', label: 'Plain' },
  { view: 'people', label: 'People' },
  { view: 'jobs', label: 'Jobs' },
  { view: 'commute', label: 'Commute' },
  { view: 'access', label: 'Job reach', title: 'Jobs within 45 minutes' },
  { view: 'deaths', label: 'Road deaths', title: 'Road deaths a year for each lakh people living there' },
  { view: 'clean', label: 'Clean travel', title: 'Trips by bus, metro, train, cycle or on foot' },
  { view: 'fairness', label: 'Fairness', title: 'The worst-served fifth of zones' },
  { view: 'roads', label: 'Road condition', title: 'Potholes and broken surfaces on the main roads and streets' },
]
const KEY_TITLES = {
  people: 'People per km²',
  jobs: 'Jobs per km²',
  commute: 'Average commute, minutes',
  access: 'Share of the city’s jobs within 45 minutes, %',
  deaths: 'Road deaths a year per lakh people',
  roads: 'Road condition',
  clean: 'Trips by bus, metro, train, cycle or on foot, %',
  fairness: 'The worst-served fifth of zones',
}
export const PERIOD_NAMES: Record<Period, string> = {
  morning: 'Morning',
  midday: 'Midday',
  evening: 'Evening',
  night: 'Night',
}

/** Numbers as people in India write them: 1,23,456. */
export function count(n: number): string {
  return Math.round(n).toLocaleString('en-IN')
}

/** A figure for the key: short, in thousands where it is large. */
function short(n: number): string {
  return n >= 1000 ? `${Number((n / 1000).toPrecision(2))}k` : String(Math.round(n))
}

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (className) el.className = className
  if (text) el.textContent = text
  return el
}

/** What the control last focused was, to find its like after its page is drawn again. */
let lastFocus: { key: string; at: number } | null = null
function focusKey(el: Element): string {
  const d = (el as HTMLElement).dataset ?? {}
  const own = d.build ?? d.tool ?? d.mend ?? d.level ?? d.group ?? d.money ?? d.view ?? d.period
  return `${el.tagName}|${own ?? el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 60) ?? ''}`
}
// Tests load this module without a page.
if (typeof document !== 'undefined') {
  document.addEventListener('focusin', (e) => {
    if (e.target instanceof HTMLElement && e.target !== document.body) lastFocus = { key: focusKey(e.target), at: performance.now() }
  })
}

/**
 * Puts the keyboard's focus back on the control it was on, after a page is drawn afresh (as the pages are on every
 * change): without this a keyboard user is thrown back to the top of the document at each press.
 */
export function keepFocus(root: HTMLElement): void {
  const now = document.activeElement
  if (!lastFocus || (now && now !== document.body) || performance.now() - lastFocus.at > 10_000) return
  const key = lastFocus.key
  for (const el of root.querySelectorAll<HTMLElement>('button, select, input, [tabindex]')) {
    if (focusKey(el) === key) {
      el.focus({ preventScroll: true })
      return
    }
  }
}

let live: HTMLElement | null = null
/**
 * Says something to a screen reader, through one live region that stays on the page: the pages are drawn afresh on
 * every change, and a live region drawn afresh with its words already in it is not read out.
 */
export function announce(text: string): void {
  if (!live) {
    live = element('div', 'sr-only')
    live.setAttribute('role', 'status')
    live.setAttribute('aria-live', 'polite')
    document.body.append(live)
  }
  // Emptied first, so that the same words said twice are read twice.
  live.textContent = ''
  const el = live
  setTimeout(() => (el.textContent = text), 50)
}

/** The key of the road condition view: the grades of the main roads, concrete, and the shades of the streets. */
export function roadKey(): HTMLElement[] {
  const roads = element('div', 'key jam-key road-key')
  const swatch = (name: string, style: string) => {
    const item = element('span', 'item')
    const i = element('i', 'line')
    i.setAttribute('style', style)
    item.append(i, name)
    return item
  }
  roads.append(
    swatch('Fair', `background:${SURFACE_COLOURS.fair}`),
    swatch('Poor', `background:${SURFACE_COLOURS.poor}`),
    swatch('Broken', `background:repeating-linear-gradient(90deg, ${SURFACE_COLOURS.broken} 0 5px, ${ROAD_CREAM} 5px 8px)`),
    swatch('Concrete', `background:${SURFACE_COLOURS.concrete}`),
  )
  const ramp = element('div', 'ramp streets-ramp')
  for (const shade of STREET_SHADES) {
    const i = element('i')
    i.style.background = shade
    ramp.append(i)
  }
  const marks = element('div', 'marks')
  marks.append(element('span', '', 'Fair'), element('span', '', 'Poor'), element('span', '', 'Broken'))
  return [
    element('div', 'muted small', 'Main roads. Good roads keep their colour; the widest cost drivers the most time.'), roads,
    element('div', 'muted small', 'Each zone’s own streets'), ramp, marks,
  ]
}

/** What the controls need from the map. */
export interface ControlHooks {
  steps: Partial<Record<Exclude<ZoneView, 'plain'>, number[]>> | null
  onView(view: ZoneView): void
  onNetwork(visible: boolean): void
  onTraffic(period: Period | null): void
  onPlay(): void
  onClose(): void
  /** "Why is this bad?" for a zone (PRD SCORE-14): fills `into` with the answer. */
  onWhy?(zone: Zone, into: HTMLElement): void
}

/**
 * The map's controls: which figure shades the zones, with its key, and the road network for checking. A panel at
 * the top right on a laptop; a sheet along the bottom on a phone.
 */
export class Controls {
  readonly root = element('section', 'card controls')
  private readonly key = element('div', 'key')
  private readonly networkKey = element('div', 'key network-key')
  private readonly traffic = element('div', 'traffic')
  private readonly zoneCard = element('section', 'card zone')
  /** On a phone, the key of a shaded view over the map, since the controls live in a page that closes to show it. */
  private readonly mapKey = element('div', 'card map-key')
  private view: ZoneView = 'plain'
  period: Period | null = null
  /** Whether any zone has footpaths or a limit, and any taller building, for the key. */
  private marks = { safer: false, dense: false }

  constructor(private readonly hooks: ControlHooks) {
    this.root.setAttribute('aria-label', 'Map view')
    const views = element('div', 'segments')
    views.setAttribute('role', 'group')
    views.setAttribute('aria-label', 'Shade the zones by')
    for (const { view, label } of VIEWS) {
      const button = element('button', '', label)
      button.type = 'button'
      button.dataset.view = view
      button.disabled = view !== 'plain' && !hooks.steps?.[view]
      if (VIEWS.find((v) => v.view === view)?.title) button.title = VIEWS.find((v) => v.view === view)!.title!
      button.addEventListener('click', () => this.setView(view))
      views.appendChild(button)
    }
    const network = element('button', 'toggle network-toggle', 'Road network')
    network.type = 'button'
    network.disabled = true
    network.setAttribute('aria-pressed', 'false')
    network.addEventListener('click', () => {
      const on = network.getAttribute('aria-pressed') !== 'true'
      network.setAttribute('aria-pressed', String(on))
      this.networkKey.hidden = !on
      hooks.onNetwork(on)
    })
    this.networkKey.hidden = true
    this.networkKey.append(
      ...Object.entries(CLASS_COLOURS).map(([kind, colour]) => {
        const item = element('span', 'item')
        const swatch = element('i', 'line')
        swatch.style.background = colour
        item.append(swatch, kind[0]!.toUpperCase() + kind.slice(1))
        return item
      }),
      Object.assign(element('span', 'item'), { innerHTML: '<i class="ring"></i>Way out of the map' }),
      Object.assign(element('span', 'item'), { innerHTML: '<i class="dot"></i>Signal' }),
    )
    const trafficToggle = element('button', 'toggle traffic-toggle', 'Traffic')
    trafficToggle.type = 'button'
    trafficToggle.disabled = true
    trafficToggle.setAttribute('aria-pressed', 'false')
    trafficToggle.addEventListener('click', () => this.setPeriod(this.period ? null : 'evening'))
    const periods = element('div', 'segments periods')
    periods.setAttribute('role', 'group')
    periods.setAttribute('aria-label', 'Part of the day')
    for (const period of PERIODS) {
      const button = element('button', '', PERIOD_NAMES[period])
      button.type = 'button'
      button.dataset.period = period
      button.addEventListener('click', () => this.setPeriod(period))
      periods.appendChild(button)
    }
    const jamKey = element('div', 'key jam-key')
    jamKey.append(
      ...['Slow', 'Very slow', 'Jammed'].map((name, i) => {
        const item = element('span', 'item')
        const swatch = element('i', `line jam-${i + 1}`)
        swatch.style.background = JAM_SWATCHES[i]!
        item.append(swatch, name)
        return item
      }),
    )
    const play = element('button', 'play', 'Play the day')
    play.type = 'button'
    play.addEventListener('click', () => hooks.onPlay())
    this.traffic.append(periods, jamKey, play)
    this.traffic.hidden = true
    const toggles = element('div', 'toggles')
    toggles.append(trafficToggle, network)
    this.root.append(views, this.key, toggles, this.traffic, this.networkKey)
    this.zoneCard.hidden = true
    this.zoneCard.setAttribute('aria-live', 'polite')
    this.mapKey.hidden = true
    this.mapKey.setAttribute('aria-hidden', 'true')
    document.body.append(this.root, this.zoneCard, this.mapKey)
    this.setView('plain')
  }

  /** Lets the road network be shown, once it has loaded. */
  enableNetwork(): void {
    this.root.querySelector<HTMLButtonElement>('.network-toggle')!.disabled = false
  }

  /** Lets traffic and the monthly views be shown, once a month has been worked out. */
  enableTraffic(): void {
    this.root.querySelector<HTMLButtonElement>('.traffic-toggle')!.disabled = false
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.segments button[data-view]')) {
      const view = button.dataset.view as Exclude<ZoneView, 'plain'> | 'plain'
      button.disabled = view !== 'plain' && !this.hooks.steps?.[view]
    }
    if (this.view !== 'plain') this.setView(this.view)
  }

  /** Says whether there are zones marked in the views, so that the key can say what the dashes are. */
  setMarks(safer: boolean, dense: boolean): void {
    if (this.marks.safer === safer && this.marks.dense === dense) return
    this.marks = { safer, dense }
    this.setView(this.view)
  }

  /** Shows traffic for `period`, or hides it. */
  setPeriod(period: Period | null): void {
    // Traffic and road condition colour the same roads: one at a time.
    if (period && this.view === 'roads') this.setView('plain')
    this.period = period
    this.root.querySelector('.traffic-toggle')!.setAttribute('aria-pressed', String(!!period))
    this.traffic.hidden = !period
    for (const button of this.traffic.querySelectorAll<HTMLButtonElement>('.periods button')) {
      button.setAttribute('aria-pressed', String(button.dataset.period === period))
    }
    this.hooks.onTraffic(period)
  }

  /** Marks the part of the day being played, without asking the map to change (the playback does that). */
  markPeriod(period: Period): void {
    for (const button of this.traffic.querySelectorAll<HTMLButtonElement>('.periods button')) {
      button.setAttribute('aria-pressed', String(button.dataset.period === period))
    }
  }

  /** Names the play button for playing or not. */
  playing(on: boolean): void {
    this.traffic.querySelector('.play')!.textContent = on ? 'Stop' : 'Play the day'
  }

  /** Shades the zones by `view` and shows its key. */
  setView(view: ZoneView): void {
    if (view === 'roads' && this.period) this.setPeriod(null)
    this.view = view
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.segments button[data-view]')) {
      button.setAttribute('aria-pressed', String(button.dataset.view === view))
    }
    const steps = view === 'plain' ? undefined : this.hooks.steps?.[view]
    this.key.hidden = !steps
    if (view === 'roads' && steps) this.key.replaceChildren(...roadKey())
    else if (view === 'fairness' && steps) {
      const item = element('div', 'key-note small')
      const swatch = element('i', 'swatch-box')
      swatch.style.background = SHADES[4]!
      item.append(swatch, 'The worst-served fifth of zones: fewest jobs in reach and longest commutes, against the city.')
      this.key.replaceChildren(item)
    }
    else if (view !== 'plain' && steps) {
      const ramp = element('div', 'ramp')
      for (const shade of SHADES) {
        const swatch = element('i')
        swatch.style.background = shade
        ramp.appendChild(swatch)
      }
      const marks = element('div', 'marks')
      // A step that repeats the one before (most zones sharing a figure) has no shade of its own, and no mark.
      marks.append(...['0', ...steps.map(short)].map((m, i, all) => element('span', '', i && m === all[i - 1] ? '' : m)))
      this.key.replaceChildren(element('div', 'muted small', KEY_TITLES[view]), ramp, marks)
      this.mapKey.replaceChildren(element('div', 'muted', KEY_TITLES[view]), ramp.cloneNode(true), marks.cloneNode(true))
      const note = view === 'deaths' && this.marks.safer ? 'Dashed: zones with footpaths or a speed limit'
        : view === 'people' && this.marks.dense ? 'Dashed: zones allowed taller building' : null
      if (note) this.key.append(Object.assign(element('div', 'muted small key-note'), { innerHTML: `<i class="dash"></i>${note}` }))
      if (view === 'deaths') this.key.append(element('div', 'muted small key-note', `Clear: fewer than ${count(FEW_PEOPLE)} people live there`))
    }
    this.mapKey.hidden = !steps || view === 'roads' || view === 'fairness'
    this.hooks.onView(view)
  }

  /** Whether a view has what it needs to be shown: the monthly views, once a month is worked out. */
  canShow(view: ZoneView): boolean {
    return view === 'plain' || !!this.hooks.steps?.[view]
  }

  /** Which view shades the zones now. */
  get shading(): ZoneView {
    return this.view
  }

  /** Says in the traffic key that blue is a flooded road, in a month when roads flooded. */
  setFlooded(on: boolean): void {
    this.traffic.querySelector('.flood-item')?.remove()
    if (!on) return
    const item = element('span', 'item flood-item')
    const swatch = element('i', 'line')
    swatch.style.background = FLOOD_COLOUR
    item.append(swatch, 'Flooded')
    this.traffic.querySelector('.jam-key')?.append(item)
  }

  /**
   * Shows a road tapped in the road condition view, in the card zones use: its name, how it stands, what its surface
   * costs, and a button to mend it.
   */
  showRoad(road: { name: string; lines: string[]; action: { text: string; run: () => void } | null } | null): void {
    this.zoneCard.hidden = !road
    document.body.classList.toggle('zone-open', !!road)
    if (!road) return
    const close = element('button', 'close', '×')
    close.type = 'button'
    close.setAttribute('aria-label', 'Close')
    close.addEventListener('click', () => this.hooks.onClose())
    const parts: HTMLElement[] = [close, element('h2', '', road.name), ...road.lines.map((l) => element('p', 'small', l))]
    if (road.action) {
      const go = element('button', 'commit road-mend', road.action.text)
      go.type = 'button'
      go.addEventListener('click', road.action.run)
      parts.push(go)
    }
    parts.push(element('p', 'muted small', 'Figures are the model’s estimates.'))
    this.zoneCard.replaceChildren(...parts)
  }

  /** Shows what is known of `zone`, or closes the card. */
  showZone(zone: Zone | null): void {
    this.zoneCard.hidden = !zone
    document.body.classList.toggle('zone-open', !!zone)
    if (!zone) return
    const close = element('button', 'close', '×')
    close.type = 'button'
    close.setAttribute('aria-label', 'Close')
    close.addEventListener('click', () => this.hooks.onClose())
    const title = element('h2', '', zone.name)
    if (zone.nameKn) title.append(' ', Object.assign(element('span', 'kn', zone.nameKn), { lang: 'kn' }))
    const rows: [string, string][] = [
      ['People', count(zone.people)],
      ['Jobs', count(zone.jobs)],
      ['Area', `${zone.area.toFixed(1)} km²`],
      ['People per km²', count(density(zone, 'people'))],
      ['Jobs per km²', count(density(zone, 'jobs'))],
      ['Income', `${zone.income} of 5`],
    ]
    const table = element('dl')
    for (const [name, value] of rows) table.append(element('dt', '', name), element('dd', '', value))
    const parts: HTMLElement[] = [close, title, table]
    if (this.hooks.onWhy) {
      const answer = element('div', 'why')
      const why = element('button', 'quiet why-ask', 'Why is this bad?')
      why.type = 'button'
      why.addEventListener('click', () => {
        why.remove()
        answer.replaceChildren(element('p', 'muted small working', 'Working it out…'))
        this.hooks.onWhy!(zone, answer)
      })
      parts.push(why, answer)
    }
    parts.push(element('p', 'muted small', 'Figures are estimates.'))
    this.zoneCard.replaceChildren(...parts)
  }
}
