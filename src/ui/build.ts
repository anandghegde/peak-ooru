import type { Map as MapLibre, MapMouseEvent, PointLike } from 'maplibre-gl'
import { scoreForecast } from './score'
import type { LngLat, Network, Transit, Zone } from '../data/types'
import { BUS_COLOUR, JUNCTION_WORK, metres, nearStation, nextMetro, planName, projectLook, REPAIR_WORK, ROAD_KINDS } from '../game/build'
import { GRADES, gradeOf, linksOfRun, namedRun, patchesShort, roadKm } from '../game/upkeep'
import { SURFACE_COLOURS } from '../map/condition'
import { KNOWN_PLACES } from '../map/places'
import type { BuildLayer, DrawnLink, PlanStop } from '../map/build'
import { SAME_PLACE_M, sameName } from '../map/transit'
import type { Action, Game, Outcome, Plan, Project, Quote, Stop } from '../rules/types'
import type { DrawnLinkOut, Foreseen, JunctionOut, Light, Questions, SurfaceOut } from '../sim/worker'
import { announce, element, keepFocus } from './controls'
import { crore, decimal, monthShort, people } from './format'
import { signal } from './signals'

export type Tool =
  | 'metro' | 'busRoute' | 'busLane' | 'railService'
  | 'road' | 'flyover' | 'junction' | 'footpaths' | 'oneWay' | 'speedLimit' | 'density'
  | 'patch' | 'resurface' | 'concrete' | 'streets'
type Work = 'signal' | 'redesign' | 'overpass'
type Mend = 'patch' | 'resurface' | 'concrete'
type Group = 'transit' | 'roads' | 'upkeep'
const MENDS: Mend[] = ['patch', 'resurface', 'concrete']
const isMend = (t: Tool | null): t is Mend => t === 'patch' || t === 'resurface' || t === 'concrete'

const GROUPS: { group: Group; name: string; line: string }[] = [
  { group: 'transit', name: 'Transit', line: 'Metro lines, bus routes, bus lanes and trains.' },
  { group: 'roads', name: 'Roads and streets', line: 'Roads, flyovers, junctions, footpaths and limits.' },
  { group: 'upkeep', name: 'Upkeep', line: 'Potholes, resurfacing, concrete, and a zone’s streets.' },
]

const TOOLS: { tool: Tool; group: Group; name: string; line: string }[] = [
  { tool: 'metro', group: 'transit', name: 'Metro line', line: 'Carries the most people. Three to five years to build.' },
  { tool: 'busRoute', group: 'transit', name: 'Bus route', line: 'Cheap, and running within two months.' },
  { tool: 'busLane', group: 'transit', name: 'Bus lane', line: 'Buses run free of the jam. Cars lose a lane.' },
  { tool: 'railService', group: 'transit', name: 'More trains', line: 'On a suburban railway line that is there.' },
  { tool: 'road', group: 'roads', name: 'Road', line: 'Joins two main roads. High cost, a year or more.' },
  { tool: 'flyover', group: 'roads', name: 'Flyover', line: 'Relieves the junctions it passes over. Higher cost, a year or two.' },
  { tool: 'junction', group: 'roads', name: 'Junction', line: 'Signals, a redesign or an overpass. A month to two years.' },
  { tool: 'footpaths', group: 'roads', name: 'Footpaths', line: 'Safer walking in a zone. Low cost, a few months.' },
  { tool: 'oneWay', group: 'roads', name: 'One-way', line: 'More flow, at once and cheaply. Some trips grow longer.' },
  { tool: 'speedLimit', group: 'roads', name: 'Speed limit', line: 'Fewer deaths in a zone. Nearly free; trips a little slower.' },
  { tool: 'density', group: 'roads', name: 'Taller building', line: 'More homes near a station. Major; shows over years.' },
  { tool: 'patch', group: 'upkeep', name: 'Patch potholes', line: 'Within the month, very cheap. Lasts about a year.' },
  { tool: 'resurface', group: 'upkeep', name: 'Resurface', line: 'Good again for 4 to 6 years. A lane shut for 1 to 3 months.' },
  { tool: 'concrete', group: 'upkeep', name: 'Lay concrete', line: 'New, and lasts 20 years. Major; half the road shut for months.' },
  { tool: 'streets', group: 'upkeep', name: 'Mend a zone’s streets', line: 'The side streets of one zone, patched or resurfaced.' },
]

/** What each kind of mending does to a road, and how long it lasts, in words. */
const MEND_WORDS: Record<Mend, { does: string; lasts: string; shuts: string }> = {
  patch: { does: 'Fills the potholes. Raises the road to fair.', lasts: 'About a year', shuts: 'Nothing' },
  resurface: { does: 'A new top layer. Raises the road to good.', lasts: '4 to 6 years', shuts: 'A lane of each stretch while done' },
  concrete: { does: 'White-topping. Raises the road to new, and it wears a quarter as fast.', lasts: '20 years or more', shuts: 'Half the road while done' },
}
/** "About 11 months", "About 5 years", from the months a mend is expected to last. */
function lastsWords(months: number, work: Mend): string {
  const time = months >= 24 ? `About ${Math.round(months / 12)} years` : `About ${months} month${months === 1 ? '' : 's'}`
  return work === 'concrete' ? `${time}, wearing a quarter as fast` : time
}

/** A grade, for the player. */
const gradeName = (c: number) => GRADES[gradeOf(c)]!

/** The colour a tool is marked with on the Build page. */
const ROAD_MARK = '#c4bdb0'

/** Speed limits the player may set, km/h. */
const LIMITS = [30, 40, 50]

/** What to do next, in one line, by tool and how far the plan has got. */
function instruction(tool: Tool, stops: number, moving: boolean, phone: boolean): string {
  const tap = phone ? 'Tap' : 'Click'
  if (moving) return `${tap} the map where this stop should go.`
  switch (tool) {
    case 'metro':
      if (stops === 0) return `${tap} the map where the line should start, or use a suggested line.`
      if (stops === 1) return `${tap} where the next station goes. The line runs through each in turn.`
      return `${tap} to add a station at the end, on the line to put one between, or on a station to move it.`
    case 'busRoute':
      if (stops === 0) return `${tap} the map where the route should start, or use a suggested route.`
      if (stops === 1) return `${tap} where the next stop goes. The buses take the quickest roads between stops.`
      return `${tap} to add a stop at the end, on the route to put one between, or on a stop to move it.`
    case 'busLane':
      return `${tap} the roads marked in blue-green to give their buses a lane. ${tap} again to take it away.`
    case 'railService':
      return 'Choose a suburban line, and how many more trains a day.'
    case 'road':
    case 'flyover': {
      const what = tool === 'road' ? 'road' : 'flyover'
      if (stops === 0) return `${tap} a main road where the ${what} should start.`
      if (stops === 1) return `${tap} a main road where it should end. It runs straight between the places you ${tap.toLowerCase()}.`
      return `${tap} to add a place at the end, on the ${what} to bend it there, or on a place to move it.`
    }
    case 'junction':
      return `${tap} a ringed junction. The larger and redder the ring, the worse the evening jam. Zoom in to see more.`
    case 'footpaths':
      return `${tap} a zone. Those shaded darker have more road deaths, most of them people on foot.`
    case 'speedLimit':
      return `${tap} a zone. Those shaded darker have more road deaths.`
    case 'density':
      return `${tap} a shaded zone: those within reach of a metro or railway station.`
    case 'oneWay':
      return `${tap} a road to make it one-way. Arrows show the roads one-way now.`
    case 'patch':
    case 'resurface':
    case 'concrete':
      // Once a road is chosen the page needs the room for the proposal: a shorter line.
      if (stops > 0) return `${tap} more roads to add them, or one chosen to leave it out.`
      return `${tap} a road to mend it: brown is poor, dark and broken up is broken. ${tap} it again to leave it out.`
    case 'streets':
      return `${tap} a zone. The darker the zone, the worse its own streets.`
  }
}

/** The way a stretch of road runs, as a point of the compass: "north-east". */
export function heading(ends: number[]): string {
  const [x1, y1, x2, y2] = ends as [number, number, number, number]
  const deg = (Math.atan2((x2 - x1) * Math.cos((y1 * Math.PI) / 180), y2 - y1) * 180) / Math.PI
  const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']
  return names[((Math.round(deg / 45) % 8) + 8) % 8]!
}

/**
 * Levels 1 to 3 for the zones with the most of something: the top tenth 3, the next fifth 2, the next fifth 1.
 */
export function topZones(values: ArrayLike<number>, skip: Set<number> = new Set()): Map<number, number> {
  const order = Array.from(values, (v, id) => ({ id, v })).filter((z) => z.v > 0 && !skip.has(z.id)).sort((a, b) => b.v - a.v)
  const n = values.length
  const out = new Map<number, number>()
  order.forEach((z, i) => {
    if (i < n * 0.1) out.set(z.id, 3)
    else if (i < n * 0.3) out.set(z.id, 2)
    else if (i < n * 0.5) out.set(z.id, 1)
  })
  return out
}

/** "3 years 2 months". */
export function duration(months: number): string {
  const y = Math.floor(months / 12)
  const m = months % 12
  const parts = []
  if (y) parts.push(`${y} year${y === 1 ? '' : 's'}`)
  if (m || !y) parts.push(`${m} month${m === 1 ? '' : 's'}`)
  return parts.join(' ')
}

/** Kilometres, with one decimal under 10. */
function km(m: number): string {
  return m < 10_000 ? `${decimal(m / 1000)} km` : `${Math.round(m / 1000)} km`
}

function minutes(seconds: number): string {
  return `${decimal(seconds / 60)} min`
}

function button(className: string, text: string, label?: string): HTMLButtonElement {
  const b = element('button', className, text)
  b.type = 'button'
  if (label) b.setAttribute('aria-label', label)
  return b
}

/** Where a new stop goes: at the end, or between two others. */
export function insertAt(stops: Stop[], index: number, stop: Stop): Stop[] {
  return [...stops.slice(0, index), stop, ...stops.slice(index)]
}

/**
 * Which gap of a line a point is nearest: the index a stop put in there would take. `points` are the stops in order.
 */
export function nearestGap(points: LngLat[], at: LngLat): number {
  let best = 1
  let bestM = Infinity
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    // Distance to the segment, flat.
    const k = Math.cos(at[1] * (Math.PI / 180))
    const ax = (a[0] - at[0]) * k, ay = a[1] - at[1]
    const bx = (b[0] - at[0]) * k, by = b[1] - at[1]
    const dx = bx - ax, dy = by - ay
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)))
    const d = Math.hypot(ax + t * dx, ay + t * dy)
    if (d < bestM) {
      bestM = d
      best = i
    }
  }
  return best
}

export interface BuildHooks {
  ask<Q extends 'quote' | 'suggest' | 'foresee' | 'links' | 'snap' | 'nodes' | 'zoneRoads' | 'oneWays'>(
    type: Q, question: Questions[Q][0]): Promise<Questions[Q][1]>
  act(action: Action): Promise<Outcome>
  /** Draws the Build page again, if it is open. */
  refresh(): void
  /** Opens another page: the Levers, to borrow. */
  levers(): void
  /** Says whether the map is being placed on, so that taps go here and not to the zones. */
  placing(on: boolean): void
  /** The space the page's cards take at each side, so that a plan is framed in what shows of the map. */
  cover(): { top: number; bottom: number; left: number; right: number }
  /** The zones, for the tools that work by zone: shading, outlining, and the outline's shape. */
  zones: ZoneTools | null
  /** The month shown, for the deaths by zone. */
  month(): Light | null
  /** The state of the roads, and the drawn network for naming them, once loaded. */
  surface(): Promise<SurfaceOut | null>
  network(): Network | null
  /** Shows the road condition view while an upkeep tool is chosen, and gives the map its view back after. */
  roadView(on: boolean): void
}

export interface ZoneTools {
  list: Zone[]
  highlight(levels: Map<number, number> | null): void
  pick(id: number | null): void
  outline(id: number): number[][][] | null
}

type Suggestion = { plan: Plan; quote: Quote; foreseen: Foreseen | null }

/** Metres round a tap within which a long road chosen from its card is framed. */
const FRAME_NEAR_M = 3000

/** A hit on the map within a finger's reach: 44 px across. */
const REACH = 22
/** How long a plan must rest before the model is asked what it would do. */
const PAUSE_MS = 500
/**
 * A touch is a tap only if one finger moved less than this, in px, and was down less than this, in ms; a touch that
 * began while the map was still gliding only stops it. Anything else moved or zoomed the map, and places nothing.
 * (Chrome itself sends no moves within about 15 px of where a finger went down, and the map does not move for them:
 * such a touch is a tap by any measure, since nothing on the screen moved.)
 */
const TAP_SLOP = 10
const TAP_MS = 600
/** How long the card beside a tap stays. */
const CARD_MS = 5000
/** The tools that begin on the map, not on a list in the page: on a phone their sheet starts lowered. */
const MAP_FIRST = new Set<Tool>(['busLane', 'junction', 'footpaths', 'oneWay', 'speedLimit', 'density', 'patch', 'resurface', 'concrete', 'streets'])

/**
 * Building (PRD 7.2, UI-5, UI-7a to UI-7e): the Build page, where a tool is chosen, and placing on the map by tap.
 * Each tap is snapped by the rules' quote and drawn at once; once the plan rests the model is asked what it would do
 * once open. On a phone a new spot is chosen in a magnified view with a crosshair. Nothing needs a drag, hover or keys.
 */
export class Build {
  tool: Tool | null = null
  stops: Stop[] = []
  buses = 30
  lanes: number[] = []
  railLine: string | null = null
  trains = 4
  quote: Quote | null = null
  foreseen: Foreseen | null = null
  private working = false
  suggestions: Suggestion[] | null = null
  private lookedAt: number | null = null
  chosen: number | null = null
  moving: number | null = null
  notice: string | null = null
  /** Why the last tap could not go ahead, shown beside it. */
  private note: { text: string; at: LngLat } | null = null
  private noteTimer = 0
  private asked = 0
  private timer = 0
  private game: Game | null = null
  private transit: Transit | null = null
  private layer: BuildLayer | null = null
  private candidates: DrawnLink[] | null = null
  private byStretch = new Map<number, number[]>()
  private magnifying: { at: LngLat; place: (at: LngLat) => void; back: { center: LngLat; zoom: number } } | null = null
  /** In the magnified view, where the stop under the cross would go, said as the map comes to rest. */
  private readonly snapHint = element('p', 'snap-hint')
  private snapAsked = 0
  private details = false
  private confirmCancel: number | null = null
  private readonly pop = element('div', 'card stop-pop')
  private readonly noteEl = element('div', 'card tap-note')
  private readonly magnifier = element('div', 'magnifier')
  /** Which group of tools is open on the Build page. */
  private group: Group | null = null
  roadLanes: 1 | 2 | 3 = 2
  /** The junction tool: every junction that can be worked on, the one chosen, and each work's quote and forecast. */
  private junctionList: JunctionOut[] | null = null
  node: number | null = null
  junctionWork: Work = 'signal'
  private works_: Partial<Record<Work, { quote: Quote; foreseen: Foreseen | null }>> = {}
  /** The tools by zone: the zone chosen, and for a speed limit its main roads and the limit chosen. */
  zone: number | null = null
  private zoneRoads: Questions['zoneRoads'][1] | null = null
  limit: number | null | undefined = undefined
  /** The one-way tool: roads that run both ways, those one-way now, the stretch chosen and which way it is to run. */
  private twoWay: DrawnLinkOut[] | null = null
  private oneWays: Questions['oneWays'][1] = []
  private stretch: DrawnLinkOut | null = null
  link: number | null = null
  private oneWayOn = true
  /** The upkeep tools: every routing link, by the stretches it stands for; the links chosen; and a named road offered. */
  private allLinks: DrawnLinkOut[] | null = null
  private linksByStretch = new Map<number, DrawnLinkOut[]>()
  private surfaceNow: SurfaceOut | null = null
  mendLinks: number[] = []
  /** The name of the stretch last tapped to mend, which names the road chosen. */
  private tappedName: string | null = null
  run: { name: string; links: DrawnLinkOut[]; km: number; worse: 'poor' | 'fair' } | null = null
  /** What each kind of mending would cost and take for the links chosen, to choose between. */
  private mendQuotes: Partial<Record<Mend, Quote>> = {}
  streetWork: 'patch' | 'resurface' = 'patch'
  /** For works that dig up roads: whether to pay to make them good afterwards, rather than leave them poor. */
  makeGood = false
  /** What making good would add, asked for alongside the quote, since the rules price it only when it is chosen. */
  private goodPrice: number | null = null
  private streetQuotes: Partial<Record<'patch' | 'resurface', Quote>> = {}
  /** Milliseconds from a tap to its stop drawn, and from a plan resting to its forecast, for measuring. */
  readonly times = { tapToStop: [] as number[], restToForecast: [] as number[] }
  /** The plan as it was before each change made on the map, newest last, for Undo. */
  private undos: { stops: Stop[]; lanes: number[]; mendLinks: number[] }[] = []
  /** On a phone, whether the sheet is lowered to its head so that the map shows. */
  low = false
  /** The last touch on the map: where it began, how far it moved, how many fingers, and whether the map was moving. */
  private touch = { x: 0, y: 0, began: 0, ended: 0, moved: 0, fingers: 0, gliding: false }
  /** Taps on the map that were not taken as taps, for measuring: moved, pinched, held or stopping a glide. */
  readonly ignored: string[] = []
  private readonly card = element('div', 'card tap-card')
  private cardAt: LngLat | null = null
  private cardTimer = 0

  constructor(private readonly map: MapLibre, private readonly phone: boolean, private readonly hooks: BuildHooks) {
    this.pop.hidden = true
    this.noteEl.hidden = true
    this.noteEl.setAttribute('role', 'status')
    this.card.hidden = true
    this.card.setAttribute('role', 'status')
    this.magnifier.hidden = true
    document.body.append(this.pop, this.noteEl, this.card, this.magnifier)
    map.on('move', () => {
      this.placePop()
      if (this.cardAt && !this.card.hidden) this.beside(this.card, this.cardAt)
    })
    map.on('moveend', () => this.previewSnap())
    this.watchTouch(map.getCanvasContainer())
  }

  /**
   * Follows each touch on the map, before the map's own handlers see it, so that a tap can be told from a drag, a
   * pinch, a long press or a touch that stops the map gliding: only a true tap places anything.
   */
  private watchTouch(box: HTMLElement): void {
    const opts = { capture: true, passive: true }
    box.addEventListener('touchstart', (e) => {
      const t = e.touches[0]!
      if (e.touches.length === 1) {
        this.touch = { x: t.clientX, y: t.clientY, began: performance.now(), ended: 0, moved: 0, fingers: 1, gliding: this.map.isMoving() }
      } else this.touch.fingers = Math.max(this.touch.fingers, e.touches.length)
    }, opts)
    box.addEventListener('touchmove', (e) => {
      const t = e.touches[0]!
      this.touch.fingers = Math.max(this.touch.fingers, e.touches.length)
      this.touch.moved = Math.max(this.touch.moved, Math.hypot(t.clientX - this.touch.x, t.clientY - this.touch.y))
    }, opts)
    box.addEventListener('touchend', (e) => {
      if (!e.touches.length) this.touch.ended = performance.now()
    }, opts)
  }

  /** Why the click that has just come was not a tap, or null if it was one (or came from a mouse). */
  private notTap(): string | null {
    const t = this.touch
    // A click with no touch just before it came from a mouse or a pen, which the map already holds to a few px.
    if (!t.ended || performance.now() - t.ended > 800) return null
    if (t.fingers > 1) return 'pinch'
    if (t.moved > TAP_SLOP) return 'drag'
    if (t.ended - t.began > TAP_MS) return 'held'
    if (t.gliding) return 'glide'
    return null
  }

  setLayer(layer: BuildLayer): void {
    this.layer = layer
    this.drawMap()
  }

  setTransit(transit: Transit | null): void {
    this.transit = transit
  }

  /** Whether the map is being placed on. */
  get placing(): boolean {
    return !!this.tool && this.tool !== 'railService'
  }

  /** Whether the tool places stops in turn: a line, a route, a road or a flyover. */
  private get stopping(): boolean {
    return this.tool === 'metro' || this.tool === 'busRoute' || this.tool === 'road' || this.tool === 'flyover'
  }

  /** Whether the tool works on a zone the player taps. */
  private get byZone(): boolean {
    return this.tool === 'footpaths' || this.tool === 'speedLimit' || this.tool === 'density' || this.tool === 'streets'
  }

  /** Whether the tool is one of upkeep's, which show the road condition view. */
  private get upkeep(): boolean {
    return isMend(this.tool) || this.tool === 'streets'
  }

  /** The plan as it stands, or null if there is not enough of it to ask about. */
  plan(): Plan | null {
    switch (this.tool) {
      case 'metro':
        return { kind: 'metro', stops: this.stops, ...(this.makeGood ? { makeGood: true } : {}) }
      case 'busRoute':
        return { kind: 'busRoute', stops: this.stops, buses: this.buses }
      case 'busLane':
        return { kind: 'busLane', links: this.lanes }
      case 'railService':
        return this.railLine ? { kind: 'railService', line: this.railLine, trains: this.trains } : null
      case 'road':
      case 'flyover':
        return {
          kind: 'road', stops: this.stops, lanes: this.roadLanes, flyover: this.tool === 'flyover', ...(this.makeGood ? { makeGood: true } : {}),
        }
      case 'junction':
        return this.node === null ? null
          : { kind: 'junction', node: this.node, work: this.junctionWork, ...(this.makeGood ? { makeGood: true } : {}) }
      case 'footpaths':
        return this.zone === null ? null : { kind: 'footpaths', zone: this.zone }
      case 'speedLimit':
        return this.zone === null || this.limit === undefined ? null : { kind: 'speedLimit', zone: this.zone, limit: this.limit }
      case 'density':
        return this.zone === null ? null
          : { kind: 'density', zone: this.zone, on: !(this.game?.built?.dense ?? []).includes(this.zone) }
      case 'oneWay':
        return this.link === null ? null : { kind: 'oneWay', link: this.link, on: this.oneWayOn }
      case 'patch':
      case 'resurface':
      case 'concrete':
        return this.mendLinks.length ? { kind: 'repair', links: this.mendLinks, work: this.tool } : null
      case 'streets':
        return this.zone === null ? null : { kind: 'streets', zone: this.zone, work: this.streetWork }
      default:
        return null
    }
  }

  private colour(): string {
    if (this.tool === 'metro' && this.game) return nextMetro(this.game).colour
    if (this.tool === 'railService') return '#6f6a62'
    // A road being planned in the dark edge colour of the map's roads, so that it reads as a road, not as a line.
    if (this.tool === 'road' || this.tool === 'flyover') return '#6f6656'
    return BUS_COLOUR
  }

  /** Chooses a tool, or leaves building with null. */
  choose(tool: Tool | null, keepLinks = false): void {
    const wasUpkeep = this.upkeep
    const links = keepLinks ? this.mendLinks : []
    const run = keepLinks ? this.run : null
    this.tool = tool
    if (tool) this.group = TOOLS.find((t) => t.tool === tool)!.group
    this.stops = []
    this.lanes = []
    this.railLine = null
    this.node = null
    this.works_ = {}
    this.zone = null
    this.zoneRoads = null
    this.limit = undefined
    this.stretch = null
    this.link = null
    this.oneWayOn = true
    this.mendLinks = links
    this.run = run
    this.mendQuotes = {}
    this.streetQuotes = {}
    this.streetWork = 'patch'
    this.makeGood = false
    this.hooks.zones?.pick(null)
    this.quote = null
    this.foreseen = null
    this.suggestions = null
    this.lookedAt = null
    this.chosen = null
    this.moving = null
    this.details = false
    this.notice = null
    this.undos = []
    this.low = this.phone && !!tool && MAP_FIRST.has(tool)
    this.hideNote()
    this.hideCard()
    this.hooks.placing(this.placing)
    if (tool === 'metro' || tool === 'busRoute') void this.loadSuggestions(tool)
    if (tool === 'road' || tool === 'flyover') void this.loadSuggestions('road')
    if (tool === 'busLane') void this.loadCandidates()
    if (tool === 'junction') void this.loadJunctions()
    if (tool === 'oneWay') void this.loadOneWay()
    if (this.upkeep) void this.loadRoads()
    if (this.upkeep !== wasUpkeep) this.hooks.roadView(this.upkeep)
    if (keepLinks && links.length) void this.requote()
    this.shadeZones()
    this.drawMap()
    this.hooks.refresh()
  }

  /** The roads for the upkeep tools: every link by its stretches, and the condition of each. */
  private async loadRoads(): Promise<void> {
    if (!this.allLinks) {
      const all = await this.hooks.ask('links', { all: true })
      this.allLinks = all
      this.linksByStretch.clear()
      for (const l of all) for (const d of l.drawn) this.linksByStretch.set(d, [...(this.linksByStretch.get(d) ?? []), l])
    }
    this.surfaceNow = await this.hooks.surface()
    if (!this.upkeep) return
    this.drawMap()
    this.hooks.refresh()
  }

  /** Chooses a stretch of road to mend, both ways, or leaves it out if chosen; and offers the rest of its named road. */
  chooseStretch_(stretch: number): void {
    const links = this.linksByStretch.get(stretch) ?? []
    if (!links.length) return
    this.remember()
    const ids = links.map((l) => l.id)
    const on = ids.every((id) => this.mendLinks.includes(id))
    this.mendLinks = on ? this.mendLinks.filter((id) => !ids.includes(id)) : [...new Set([...this.mendLinks, ...ids])].sort((a, b) => a - b)
    signal('placed')
    if (!on) {
      this.tappedName = this.hooks.network()?.links[stretch]?.name ?? this.tappedName
      this.offerRun(stretch)
    }
    else if (!this.mendLinks.length) this.run = null
    this.afterMendChange()
  }

  /** Offers the whole of the named road the stretch is on, where it is poor or broken (or, if none is, fair or worse). */
  private offerRun(stretch: number): void {
    const network = this.hooks.network()
    const cond = this.surfaceNow?.byLink
    if (!network || !cond || !this.allLinks) return
    const stretches = namedRun(network, stretch)
    const name = network.links[stretch]?.name
    if (!name || stretches.length < 2) return
    let worse: 'poor' | 'fair' = 'poor'
    let links = linksOfRun(stretches, this.allLinks, cond, 50)
    if (!links.some((l) => !this.mendLinks.includes(l.id))) {
      worse = 'fair'
      links = linksOfRun(stretches, this.allLinks, cond, 75)
    }
    const fresh = links.filter((l) => !this.mendLinks.includes(l.id))
    this.run = fresh.length ? { name, links, km: roadKm(links.map((l) => ({ drawn: l.drawn, length: l.length ?? 0 })), network), worse } : null
  }

  /** Takes the whole of the named road offered. */
  takeRun(): void {
    if (!this.run) return
    this.remember()
    this.mendLinks = [...new Set([...this.mendLinks, ...this.run.links.map((l) => l.id)])].sort((a, b) => a - b)
    const b = this.boundsOf(this.run.links)
    this.tappedName = this.run.name
    this.run = null
    this.afterMendChange()
    if (b) this.frame(b)
  }

  /** Chooses links to mend from outside the page (the report's worst roads), and shows them. */
  mendRoad(links: number[], work: Mend = 'patch', name: string | null = null, near: LngLat | null = null): void {
    this.choose(work)
    this.mendLinks = [...links].sort((a, b) => a - b)
    this.tappedName = name
    void this.loadRoads().then(() => {
      const all = this.boundsOf(this.mendLinks.map((id) => this.allLinks?.find((l) => l.id === id)).filter((l): l is DrawnLinkOut => !!l))
      // A long road is framed where the player tapped it: the whole of one that runs to the edge of the map cannot be
      // shown above a phone's sheet, since the map does not pan past its data.
      const close = near ? all?.filter((p) => metres(p, near) <= FRAME_NEAR_M) : null
      const b = close && close.length ? [...close, near!] : all
      if (b) this.frame(b)
    })
    this.afterMendChange()
  }

  private boundsOf(links: DrawnLinkOut[]): LngLat[] | null {
    const points = links.flatMap((l) => (l.ends ? [[l.ends[0]!, l.ends[1]!], [l.ends[2]!, l.ends[3]!]] as LngLat[] : []))
    return points.length ? points : null
  }

  private afterMendChange(): void {
    this.foreseen = null
    this.mendQuotes = {}
    this.drawMap()
    void this.requote()
    void this.loadMendQuotes()
    this.hooks.refresh()
  }

  /** What each kind of mending would cost and take for the links chosen, for the choices on the page. */
  private async loadMendQuotes(): Promise<void> {
    const links = this.mendLinks
    if (!links.length) return
    const quotes = await Promise.all(MENDS.map((work) => this.hooks.ask('quote', { plan: { kind: 'repair', links, work } })))
    if (this.mendLinks !== links) return
    MENDS.forEach((w, i) => (this.mendQuotes[w] = quotes[i]))
    this.hooks.refresh()
  }

  /** Changes the kind of mending, keeping the roads chosen. */
  private chooseMend(work: Mend): void {
    if (this.tool === work) return
    const quotes = this.mendQuotes
    this.choose(work, true)
    this.mendQuotes = quotes
  }

  private chooseStreetWork(work: 'patch' | 'resurface'): void {
    this.streetWork = work
    this.foreseen = null
    void this.requote()
    this.hooks.refresh()
  }

  /** Shades the zones where the chosen tool would do most, or gives the map its view back. */
  shadeZones(): void {
    const zones = this.hooks.zones
    if (!zones) return
    // The streets tool shades the zones by their streets, as the road condition view it shows does.
    if (!this.byZone || this.tool === 'streets') return zones.highlight(null)
    if (this.tool === 'density') {
      const dense = new Set(this.game?.built?.dense ?? [])
      const levels = new Map<number, number>()
      for (const z of zones.list) {
        if (dense.has(z.id)) levels.set(z.id, 3)
        else if (this.transit && nearStation(z, this.transit, null)) levels.set(z.id, 1)
      }
      return zones.highlight(levels)
    }
    const deaths = this.hooks.month()?.deathsByZone
    if (!deaths) return zones.highlight(new Map())
    const skip = new Set(this.tool === 'footpaths' ? (this.game?.built?.footpaths ?? []) : [])
    zones.highlight(topZones(deaths, skip))
  }

  /** A new month or a change made: the plan stays, but what it would cost and do is asked again. */
  update(game: Game): void {
    const moved = !this.game || this.game.month !== game.month || this.game.done.length !== game.done.length
    this.game = game
    if (moved && this.plan()) void this.requote()
    if (moved && this.tool === 'junction') void this.loadJunctions()
    if (moved && this.tool === 'oneWay') void this.loadOneWay()
    if (moved && this.upkeep) void this.loadRoads()
    if (moved) this.shadeZones()
    this.drawMap()
  }

  /** A new month shown: the zones' shading follows its deaths. */
  monthShown(): void {
    if (this.byZone) this.shadeZones()
  }

  // -------------------------------------------------------------------------------------------------------------
  // Taps on the map.

  /** A tap on the map while placing. */
  tap(event: MapMouseEvent): void {
    if (this.magnifying) return
    const not = this.notTap()
    if (not) {
      this.ignored.push(not)
      return
    }
    const { x, y } = event.point
    const box: [PointLike, PointLike] = [[x - REACH, y - REACH], [x + REACH, y + REACH]]
    const at: LngLat = [event.lngLat.lng, event.lngLat.lat]
    const nearest = <T extends { geometry: GeoJSON.Geometry }>(hits: T[]): T | undefined => {
      let best: T | undefined
      let bestD = Infinity
      for (const h of hits) {
        if (h.geometry.type !== 'Point') {
          best ??= h
          continue
        }
        const p = this.map.project(h.geometry.coordinates as [number, number])
        const d = Math.hypot(p.x - x, p.y - y)
        if (d < bestD) {
          bestD = d
          best = h
        }
      }
      return best
    }
    this.hideNote()
    if (this.tool === 'junction') {
      const hit = nearest(this.map.queryRenderedFeatures(box, { layers: ['junction-marks'] }))
      if (!hit) return this.say('Tap one of the ringed junctions. Zoom in to see more of them.', at)
      this.chooseNode(Number(hit.properties!.id))
      return
    }
    if (isMend(this.tool)) {
      if (!this.allLinks) return this.say('Still loading the roads. Tap again in a moment.', at)
      const layers = ['condition', 'condition-broken', 'congestion'].filter((id) => this.map.getLayer(id))
      const hits = this.map.queryRenderedFeatures(box, { layers }).filter((f) => f.id !== undefined && this.linksByStretch.has(Number(f.id)))
      // The stretch nearest the tap, of those within a finger's reach.
      let best: number | null = null
      let bestD = Infinity
      for (const h of hits) {
        const lines = h.geometry.type === 'LineString' ? [h.geometry.coordinates] : h.geometry.type === 'MultiLineString' ? h.geometry.coordinates : []
        for (const line of lines) {
          for (let i = 1; i < line.length; i++) {
            const a = this.map.project(line[i - 1] as [number, number])
            const b = this.map.project(line[i] as [number, number])
            const dx = b.x - a.x, dy = b.y - a.y
            const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)))
            const d = Math.hypot(a.x + t * dx - x, a.y + t * dy - y)
            if (d < bestD) {
              bestD = d
              best = Number(h.id)
            }
          }
        }
      }
      if (best === null) return this.say('Tap a main road. Zoom in to reach the smaller ones.', at)
      const ids = (this.linksByStretch.get(best) ?? []).map((l) => l.id)
      const on = !ids.every((id) => this.mendLinks.includes(id))
      this.chooseStretch_(best)
      const name = this.hooks.network()?.links[best]?.name ?? 'A main road'
      this.tell(on ? `${name}: chosen to mend.` : `${name}: left out.`, at)
      return
    }
    if (this.byZone) {
      const hit = this.map.queryRenderedFeatures(event.point, { layers: ['zones-fill'] })[0]
      if (!hit) return this.say('Tap inside a zone.', at)
      this.chooseZone(Number(hit.id))
      return
    }
    if (this.tool === 'oneWay') {
      // The roads that may be made one-way come from the worker: until they have, a tap has nothing to find.
      if (!this.twoWay) return this.say('Still finding the roads that run both ways. Tap again in a moment.', at)
      const hit = this.map.queryRenderedFeatures(box, { layers: ['oneway-chosen', 'oneway-candidates'] })[0]
      if (!hit) return this.say('Tap a main road that runs both ways.', at)
      this.chooseStretch(Number(hit.properties!.id))
      return
    }
    if (this.tool === 'busLane') {
      const hit = this.map.queryRenderedFeatures(box, { layers: ['lane-chosen', 'lane-candidates'] })[0]
      if (!hit) return this.say('Only the roads marked in blue-green can take a bus lane.', at)
      const id = Number(hit.properties!.id)
      const on = !this.lanes.includes(id)
      this.toggleLane(id)
      const name = this.layer?.nameOf(id, this.candidates ?? []) ?? 'This road'
      this.tell(on ? `${name}: a bus lane added.` : `${name}: the bus lane left out.`, at)
      return
    }
    const stop = nearest(this.map.queryRenderedFeatures(box, { layers: ['plan-stops'] })
      .filter((f) => Number(f.properties!.index) >= 0))
    if (stop && this.moving === null) {
      this.chosen = Number(stop.properties!.index)
      this.drawMap()
      this.hooks.refresh()
      return
    }
    // A road's places are on the roads, not at stations.
    const onStations = this.tool === 'metro' || this.tool === 'busRoute'
    const station = onStations ? nearest(this.map.queryRenderedFeatures(box, { layers: ['transit-stations'] })) : undefined
    if (station && station.properties!.station !== undefined) {
      const id = Number(station.properties!.station)
      if (this.stops.some((s) => 'station' in s && s.station === id) && this.moving === null) {
        return this.say('The line already stops here.', at)
      }
      this.place({ station: id }, at)
      return
    }
    if (this.moving !== null) {
      this.pick(at, (spot) => this.place({ at: spot }, spot))
      return
    }
    const onLine = this.stops.length >= 2 && this.map.queryRenderedFeatures(box, { layers: ['plan-path'] }).length > 0
    if (onLine) {
      this.pick(at, (spot) => {
        const gap = nearestGap(this.points(), spot)
        this.edit(insertAt(this.stops, gap, { at: spot }), spot)
      })
      return
    }
    this.pick(at, (spot) => this.place({ at: spot }, spot))
  }

  /** On a phone, the spot is chosen in a magnified view; on a laptop the click is taken as it is. */
  private pick(at: LngLat, place: (at: LngLat) => void): void {
    if (!this.phone) return place(at)
    const c = this.map.getCenter()
    this.magnifying = { at, place, back: { center: [c.lng, c.lat], zoom: this.map.getZoom() } }
    this.map.easeTo({ center: at, zoom: Math.max(this.map.getZoom() + 2, 15.5), duration: 350 })
    document.body.classList.add('magnifying')
    this.hideCard()
    const what = this.tool === 'metro' ? 'station' : this.tool === 'road' || this.tool === 'flyover' ? 'place' : 'stop'
    const text = element('p', '', `Drag the map to put the cross where the ${what} goes.`)
    const cancel = button('quiet', 'Cancel')
    const ok = button('commit', `Put the ${what} here`)
    cancel.dataset.build = 'magnify-cancel'
    ok.dataset.build = 'magnify-ok'
    cancel.addEventListener('click', () => this.unmagnify(false))
    ok.addEventListener('click', () => this.unmagnify(true))
    const bar = element('div', 'card magnifier-bar')
    const row = element('div', 'outlook-buttons')
    row.append(ok, cancel)
    this.snapHint.textContent = ''
    this.snapHint.setAttribute('aria-live', 'polite')
    bar.append(text, this.snapHint, row)
    this.magnifier.replaceChildren(element('div', 'crosshair'), bar)
    this.magnifier.hidden = false
    this.previewSnap()
  }

  /** In the magnified view, asks where a stop at the cross would go, and says it above the buttons. */
  private previewSnap(): void {
    if (!this.magnifying || this.map.isMoving()) return
    const c = this.map.getCenter()
    const id = ++this.snapAsked
    const kind = this.tool === 'metro' ? 'metro' : 'busRoute'
    void this.hooks.ask('snap', { kind, stop: { at: [c.lng, c.lat] } }).then((st) => {
      if (id !== this.snapAsked || !this.magnifying) return
      if ('reason' in st) {
        this.snapHint.textContent = st.reason
        this.snapHint.className = 'snap-hint reason'
        this.layer?.showTap(null)
        return
      }
      const road = this.tool === 'road' || this.tool === 'flyover'
      const there = st.existing !== undefined && !road
      this.snapHint.textContent = road ? `On ${st.name || 'a main road'}.`
        : there ? `At ${st.name}, joining the line there.` : `A new ${this.tool === 'metro' ? 'station' : 'stop'}: ${st.name}.`
      this.snapHint.className = 'snap-hint'
      // Where it would snap, marked on the map beside the cross.
      this.layer?.showTap(st.at)
    }).catch(() => null)
  }

  private unmagnify(confirm: boolean): void {
    const m = this.magnifying
    if (!m) return
    this.magnifying = null
    this.snapAsked++
    this.magnifier.hidden = true
    this.layer?.showTap(null)
    document.body.classList.remove('magnifying')
    const c = this.map.getCenter()
    this.map.easeTo({ center: m.back.center, zoom: m.back.zoom, duration: 350 })
    // Once the player is placing by hand, the map is what they need: the sheet stays lowered, and comes up by its handle.
    if (confirm) this.low = true
    if (confirm) m.place([c.lng, c.lat])
    else this.hooks.refresh()
  }

  /** Puts a stop: where the stop being moved was, or at the end. */
  private place(stop: Stop, at: LngLat): void {
    if (this.moving !== null) {
      const stops = [...this.stops]
      stops[this.moving] = stop
      this.moving = null
      this.chosen = null
      this.edit(stops, at)
    } else this.edit([...this.stops, stop], at)
  }

  /** Changes the stops, draws the tap at once, and asks where it snaps; a stop that cannot go is taken back. */
  private edit(stops: Stop[], at: LngLat | null, undoing = false): void {
    const before = this.stops
    const beforeOk = !!this.quote?.ok || before.length < 2
    const tapped = performance.now()
    if (!undoing) this.remember()
    const undos = this.undos.length
    this.stops = stops
    this.lookedAt = null
    this.foreseen = null
    this.layer?.showTap(at)
    void this.requote().then((q) => {
      if (!q) return
      if (!q.ok && beforeOk && at && (stops.length >= 2 || q.reason)) {
        // The stop is taken back, and the player told why beside it (PRD UI-6).
        this.stops = before
        if (this.undos.length === undos) this.undos.pop()
        this.say(q.reason ?? 'That cannot go there.', at)
        signal('refused')
        void this.requote()
        return
      }
      if (at) {
        signal('placed')
        // The stop, named where the rules put it, beside it with Undo: on a phone the finger hid the tap.
        if (stops.length > before.length) {
          const k = this.handles()[stops.findIndex((s, i) => s !== before[i])]
          const st = k === undefined ? null : q.stations[k]
          const what = this.tool === 'metro' ? 'station' : this.tool === 'road' || this.tool === 'flyover' ? 'place' : 'stop'
          this.tell(st?.name ? `${st.name}: ${what} added.` : `A ${what} added.`, st?.at ?? at)
        }
      }
      // On a phone a road's second place, often tapped with its first off the screen, frames the road whole.
      if (this.phone && q.ok && stops.length === 2 && before.length === 1 && (this.tool === 'road' || this.tool === 'flyover')) {
        this.frame(q.stations.map((x) => x.at))
      }
      // Measured to the frame after the next, by when the snapped stop is on the screen.
      requestAnimationFrame(() => requestAnimationFrame(() => this.times.tapToStop.push(performance.now() - tapped)))
    })
    this.hooks.refresh()
  }

  /** Where each stop the player chose is drawn: its snapped station, by the index of the quote's stations. */
  private points(): LngLat[] {
    const q = this.quote
    const h = this.handles()
    return this.stops.map((s, i) => (h[i] !== undefined ? q!.stations[h[i]!]!.at
      : 'at' in s ? s.at : this.stationAt(s.station) ?? [0, 0]))
  }

  /**
   * For each stop the player chose, which of the quote's stations it became. The rules may put stations in between,
   * so each stop is matched, in order, to the nearest station not before the last matched.
   */
  private handles(): (number | undefined)[] {
    const q = this.quote
    if (!q || !q.stations.length) return this.stops.map(() => undefined)
    if (q.stations.length === this.stops.length) return this.stops.map((_, i) => i)
    let from = 0
    return this.stops.map((s) => {
      if ('station' in s) {
        const k = q.stations.findIndex((st, j) => j >= from && st.existing === s.station)
        if (k >= 0) return (from = k)
      }
      const at = 'at' in s ? s.at : this.stationAt(s.station)
      if (!at) return undefined
      let best = -1
      let bestM = Infinity
      for (let j = from; j < q.stations.length; j++) {
        const m = metres(at, q.stations[j]!.at)
        if (m < bestM) {
          bestM = m
          best = j
        }
      }
      if (best < 0) return undefined
      from = best
      return best
    })
  }

  private stationAt(id: number): LngLat | null {
    const s = this.transit?.stations.find((x) => x.id === id) ?? this.game?.built?.stations.find((x) => x.id === id)
    return s?.at ?? null
  }

  private toggleLane(id: number): void {
    this.remember()
    // A road is chosen both ways at once where it has a lane to give each way.
    const link = this.candidates?.find((l) => l.id === id)
    const twins = new Set<number>([id])
    for (const d of link?.drawn ?? []) for (const other of this.byStretch.get(d) ?? []) twins.add(other)
    const on = this.lanes.includes(id)
    this.lanes = on ? this.lanes.filter((l) => !twins.has(l)) : [...new Set([...this.lanes, ...twins])]
    signal('placed')
    this.foreseen = null
    this.drawMap()
    void this.requote()
    this.hooks.refresh()
  }

  /** Chooses a junction, and asks what each kind of work there would cost and do. */
  private chooseNode(id: number): void {
    this.node = id
    signal('placed')
    this.works_ = {}
    this.foreseen = null
    this.quote = null
    this.drawMap()
    this.hooks.refresh()
    void this.loadWorks(id)
  }

  private async loadWorks(node: number): Promise<void> {
    const all: Work[] = ['signal', 'redesign', 'overpass']
    const quotes = await Promise.all(all.map((work) => this.hooks.ask('quote', { plan: { kind: 'junction', node, work } })))
    if (this.node !== node) return
    all.forEach((w, i) => (this.works_[w] = { quote: quotes[i]!, foreseen: null }))
    // The first that can be done is chosen to begin with.
    const first = all.find((w) => this.works_[w]!.quote.ok)
    if (first && !this.works_[this.junctionWork]?.quote.ok) this.junctionWork = first
    void this.requote()
    for (const w of all) {
      const entry = this.works_[w]!
      if (!entry.quote.ok) continue
      const f = await this.hooks.ask('foresee', { plan: { kind: 'junction', node, work: w } })
      if (this.node !== node) return
      entry.foreseen = f
      if (w === this.junctionWork && !this.foreseen) this.foreseen = f
      this.hooks.refresh()
    }
  }

  private chooseWork(w: Work): void {
    this.junctionWork = w
    this.foreseen = this.works_[w]?.foreseen ?? null
    void this.requote()
    this.hooks.refresh()
  }

  /** Chooses a zone; for a speed limit, asks what main roads it has. */
  private chooseZone(id: number): void {
    this.zone = id
    signal('placed')
    this.zoneRoads = null
    this.limit = undefined
    this.foreseen = null
    this.quote = null
    this.hooks.zones?.pick(id)
    if (this.tool === 'speedLimit') {
      const rings = this.hooks.zones?.outline(id)
      if (rings) {
        void this.hooks.ask('zoneRoads', { zone: id, rings }).then((r) => {
          if (this.zone !== id) return
          this.zoneRoads = r
          this.hooks.refresh()
        })
      }
    } else void this.requote()
    if (this.tool === 'streets') void this.loadStreetQuotes(id)
    this.hooks.refresh()
  }

  private async loadStreetQuotes(zone: number): Promise<void> {
    const works = ['patch', 'resurface'] as const
    const quotes = await Promise.all(works.map((work) => this.hooks.ask('quote', { plan: { kind: 'streets', zone, work } })))
    if (this.zone !== zone) return
    works.forEach((w, i) => (this.streetQuotes[w] = quotes[i]))
    this.hooks.refresh()
  }

  private chooseLimit(limit: number | null): void {
    this.limit = limit
    this.foreseen = null
    void this.requote()
    this.hooks.refresh()
  }

  /** Chooses a stretch of road to make one-way: first the way it was tapped, which the player may turn. */
  private chooseStretch(id: number): void {
    const link = this.twoWay?.find((l) => l.id === id)
    if (!link) return
    this.stretch = link
    this.link = id
    signal('placed')
    this.oneWayOn = true
    this.foreseen = null
    this.drawMap()
    void this.requote()
    this.hooks.refresh()
  }

  /** The opposite of the chosen stretch, among the roads that run both ways. */
  private twin(link: DrawnLinkOut): DrawnLinkOut | null {
    const e = link.ends
    if (!e) return null
    return this.twoWay?.find((l) => l.ends && l.ends[0] === e[2] && l.ends[1] === e[3] && l.ends[2] === e[0] && l.ends[3] === e[1]) ?? null
  }

  private async loadJunctions(): Promise<void> {
    const list = await this.hooks.ask('nodes', {})
    if (this.tool !== 'junction') return
    this.junctionList = list
    this.drawMap()
  }

  private async loadOneWay(): Promise<void> {
    const [twoWay, oneWays] = await Promise.all([this.hooks.ask('links', { twoWay: true }), this.hooks.ask('oneWays', {})])
    if (this.tool !== 'oneWay') return
    this.twoWay = twoWay
    this.oneWays = oneWays
    this.drawMap()
    this.hooks.refresh()
  }

  /** The junctions to mark in view: all of them close in, the jammed ones only with much of the city in view. */
  private junctionsInView(): JunctionOut[] {
    const b = this.map.getBounds()
    const zoom = this.map.getZoom()
    // Every junction close in; further out only the jammed, so that the marks do not bury the map.
    const least = zoom >= 14.5 ? 0 : zoom >= 13.5 ? 1 : zoom >= 12.5 ? 2 : 3
    return (this.junctionList ?? []).filter((j) =>
      (j.jam >= least || j.id === this.node) && b.contains(j.at))
  }

  private say(text: string, at: LngLat): void {
    this.note = { text, at }
    this.noteEl.textContent = text
    this.noteEl.hidden = false
    this.hideCard()
    announce(text)
    this.beside(this.noteEl, at)
    clearTimeout(this.noteTimer)
    this.noteTimer = window.setTimeout(() => this.hideNote(), 4000)
  }

  /**
   * Puts a card beside a place on the map: on a phone above it, where the finger that tapped it does not cover it;
   * with a mouse, below the pointer.
   */
  private beside(el: HTMLElement, at: LngLat): void {
    const p = this.map.project(at)
    const w = Math.min(280, innerWidth - 32)
    el.style.width = `${w}px`
    el.style.left = `${Math.round(Math.max(16, Math.min(innerWidth - w - 16, p.x - w / 2)))}px`
    const top = document.querySelector('.bar')?.getBoundingClientRect().bottom ?? 0
    const above = p.y - 28 - el.offsetHeight
    el.style.top = `${Math.round(this.phone && above > top + 4 ? above : Math.max(top + 4, p.y + 24))}px`
  }

  /** What a tap chose, said beside it, with Undo while there is something to undo. */
  private tell(text: string, at: LngLat): void {
    announce(text)
    if (!this.phone) return
    this.hideNote()
    const undo = button('quiet', 'Undo')
    undo.dataset.build = 'card-undo'
    undo.addEventListener('click', () => this.undo())
    this.card.replaceChildren(element('span', '', text), ...(this.undos.length ? [undo] : []))
    this.card.hidden = false
    this.cardAt = at
    this.beside(this.card, at)
    clearTimeout(this.cardTimer)
    this.cardTimer = window.setTimeout(() => this.hideCard(), CARD_MS)
  }

  private hideCard(): void {
    this.card.hidden = true
  }

  /** Keeps the plan as it is, to come back to with Undo. */
  private remember(): void {
    this.undos.push({ stops: this.stops, lanes: this.lanes, mendLinks: this.mendLinks })
    if (this.undos.length > 50) this.undos.shift()
  }

  /** Takes back the last change made on the map. */
  undo(): void {
    const last = this.undos.pop()
    this.hideCard()
    this.hideNote()
    if (!last) return
    this.chosen = null
    this.moving = null
    if (last.stops !== this.stops) return this.edit(last.stops, null, true)
    if (last.lanes !== this.lanes) {
      this.lanes = last.lanes
      this.foreseen = null
      this.drawMap()
      void this.requote()
      this.hooks.refresh()
      return
    }
    if (last.mendLinks !== this.mendLinks) {
      this.mendLinks = last.mendLinks
      if (!this.mendLinks.length) this.run = null
      this.afterMendChange()
    }
  }

  private hideNote(): void {
    this.note = null
    this.noteEl.hidden = true
  }

  // -------------------------------------------------------------------------------------------------------------
  // Asking the worker.

  /** Asks where the plan goes and what it costs; for a single stop, where that stop would snap. */
  private async requote(): Promise<Quote | null> {
    const plan = this.plan()
    const id = ++this.asked
    clearTimeout(this.timer)
    if (!plan) return null
    let q: Quote
    const stopped = plan.kind === 'metro' || plan.kind === 'busRoute' || plan.kind === 'road'
    if (stopped && plan.stops.length === 1) {
      q = await this.snapOne(plan)
    } else if (stopped && plan.stops.length === 0) {
      q = { ok: false, cost: 0, months: 0, running: 0, length: 0, stations: [], path: [], disrupted: [], major: false }
    } else if (plan.kind === 'busLane' && !plan.links.length) {
      q = { ok: false, cost: 0, months: 0, running: 0, length: 0, stations: [], path: [], disrupted: [], major: false }
    } else q = await this.hooks.ask('quote', { plan })
    if (id !== this.asked) return null
    this.quote = q
    this.goodPrice = q.makeGood ?? null
    if (q.ok && q.disrupted.length && !this.makeGood && (plan.kind === 'metro' || plan.kind === 'road' || plan.kind === 'junction')) {
      void this.hooks.ask('quote', { plan: { ...plan, makeGood: true } }).then((good) => {
        if (id !== this.asked || !good.makeGood) return
        this.goodPrice = good.makeGood
        this.hooks.refresh()
      })
    }
    this.drawMap()
    this.hooks.refresh()
    const enough = stopped ? plan.stops.length >= 2 : true
    if (plan.kind === 'junction') {
      // Each work's forecast is asked for once, as the choices are drawn.
      const known = this.works_[plan.work]?.foreseen
      this.foreseen = known ?? null
      this.working = !known
    } else if (q.ok && enough) {
      this.working = true
      this.timer = window.setTimeout(() => void this.foresee(plan, id), PAUSE_MS)
    }
    return q
  }

  /** Where a lone first stop would snap, before there is a line to quote: the rules' own snap. */
  private async snapOne(plan: Plan & { stops: Stop[] }): Promise<Quote> {
    const none: Quote = { ok: false, cost: 0, months: 0, running: 0, length: 0, stations: [], path: [], disrupted: [], major: false }
    // A road's places snap to the main roads, as a bus route's stops do.
    const kind = plan.kind === 'metro' ? 'metro' : 'busRoute'
    const st = await this.hooks.ask('snap', { kind, stop: plan.stops[0]! })
    if ('reason' in st) return { ...none, reason: st.reason }
    return { ...none, stations: [{ ...st, stop: 0 }] }
  }

  private async foresee(plan: Plan, id: number): Promise<void> {
    const rested = performance.now()
    try {
      const f = await this.hooks.ask('foresee', { plan })
      if (id !== this.asked) return
      this.foreseen = f
      this.times.restToForecast.push(performance.now() - rested)
    } catch (error) {
      console.warn(String(error))
    } finally {
      if (id === this.asked) {
        this.working = false
        this.hooks.refresh()
      }
    }
  }

  private async loadSuggestions(kind: 'metro' | 'busRoute' | 'road'): Promise<void> {
    const tool = this.tool
    const list = await this.hooks.ask('suggest', { kind })
    if (this.tool !== tool) return
    this.suggestions = list
      .filter((s) => s.quote.ok && (s.plan.kind !== 'road' || s.plan.flyover === (tool === 'flyover')))
      .map((s) => ({ ...s, foreseen: null }))
    this.drawMap()
    this.hooks.refresh()
    // What each would do, one after another, while the player reads.
    for (const s of this.suggestions) {
      if (this.tool !== tool || this.stops.length) return
      s.foreseen = await this.hooks.ask('foresee', { plan: s.plan })
      this.hooks.refresh()
    }
  }

  private async loadCandidates(): Promise<void> {
    if (!this.candidates) {
      this.candidates = await this.hooks.ask('links', {})
      this.byStretch.clear()
      for (const l of this.candidates) {
        for (const d of l.drawn) this.byStretch.set(d, [...(this.byStretch.get(d) ?? []), l.id])
      }
    }
    this.drawMap()
  }

  /** Takes a suggestion as the plan, which the player may then change. */
  use(i: number): void {
    const s = this.suggestions?.[i]
    if (!s || (s.plan.kind !== 'metro' && s.plan.kind !== 'busRoute' && s.plan.kind !== 'road')) return
    this.remember()
    this.stops = [...s.plan.stops]
    if (s.plan.kind === 'busRoute') this.buses = s.plan.buses
    if (s.plan.kind === 'road') this.roadLanes = s.plan.lanes
    this.quote = s.quote
    this.foreseen = s.foreseen
    this.lookedAt = null
    this.drawMap()
    this.frame(s.quote.stations.map((x) => x.at))
    if (!s.foreseen) void this.requote()
    this.hooks.refresh()
  }

  /**
   * Opens a plan made elsewhere ("What now?") on the page and the map, for the player to look at, change and order
   * as their own. False for a plan the page cannot lay out this way.
   */
  begin(plan: Plan): boolean {
    switch (plan.kind) {
      case 'metro':
      case 'busRoute':
      case 'road': {
        this.choose(plan.kind === 'road' ? (plan.flyover ? 'flyover' : 'road') : plan.kind)
        this.stops = [...plan.stops]
        if (plan.kind === 'busRoute') this.buses = plan.buses
        if (plan.kind === 'road') this.roadLanes = plan.lanes
        void this.requote().then((q) => {
          if (q?.ok) this.frame(q.stations.map((x) => x.at))
          this.drawMap()
        })
        break
      }
      case 'busLane':
        this.choose('busLane')
        this.lanes = [...plan.links]
        void this.requote()
        break
      case 'railService':
        this.choose('railService')
        this.railLine = plan.line
        this.trains = plan.trains
        void this.requote()
        break
      case 'repair':
        this.mendRoad(plan.links, plan.work)
        return true
      case 'streets':
        this.choose('streets')
        this.chooseZone(plan.zone)
        this.chooseStreetWork(plan.work)
        break
      case 'footpaths':
      case 'density':
        this.choose(plan.kind)
        this.chooseZone(plan.zone)
        break
      case 'speedLimit':
        this.choose('speedLimit')
        this.chooseZone(plan.zone)
        this.chooseLimit(plan.limit)
        break
      case 'junction':
        this.choose('junction')
        this.junctionWork = plan.work
        this.chooseNode(plan.node)
        break
      default:
        return false
    }
    this.drawMap()
    this.hooks.refresh()
    return true
  }

  private look(i: number): void {
    this.lookedAt = this.lookedAt === i ? null : i
    const s = this.suggestions?.[i]
    this.drawMap()
    if (s && this.lookedAt === i) this.frame(s.quote.stations.map((x) => x.at))
    this.hooks.refresh()
  }

  private frame(points: LngLat[]): void {
    const c = this.hooks.cover()
    this.layer?.frame(points, { top: c.top + 40, bottom: c.bottom + 40, left: c.left + 40, right: c.right + 60 })
  }

  // -------------------------------------------------------------------------------------------------------------
  // The map.

  /** Draws the plan, the suggestions, the lanes and the works as they stand. */
  drawMap(): void {
    const layer = this.layer
    if (!layer) return
    const game = this.game
    const colour = this.colour()
    const q = this.quote
    if (this.stopping) {
      const handles = this.handles()
      const tapped: PlanStop[] = this.stops.map((s, index) => {
        const snapped = handles[index] === undefined ? undefined : q?.stations[handles[index]!]
        const at = snapped?.at ?? ('at' in s ? s.at : this.stationAt(s.station) ?? [0, 0])
        return { at, name: snapped?.name ?? '', nameKn: snapped?.nameKn ?? null, index, existing: 'station' in s }
      })
      // Stations the rules put in between the stops the player chose: drawn, but not handles to move.
      const taken = new Set(handles.filter((h) => h !== undefined))
      if (q?.ok) {
        // A road's junctions with the roads it crosses are marked, but not named: they are not places the player chose.
        const road = this.tool === 'road' || this.tool === 'flyover'
        q.stations.forEach((st, k) => {
          if (!taken.has(k)) tapped.push({ at: st.at, name: road ? '' : st.name, nameKn: st.nameKn, index: -1 - k, existing: st.existing !== undefined })
        })
      }
      // A new station named as a station close by that is there already ("Nagavara" by "Nagawara") is left unnamed
      // on the map, since the one there is named, and the two names would sit on one another.
      for (const t of tapped) {
        if (t.existing || !t.name) continue
        const twin = this.transit?.stations.some((s) => sameName(s.name, t.name) && metres(s.at, t.at) < SAME_PLACE_M)
        if (twin) t.name = ''
      }
      layer.showPlan(colour, q?.ok ? q.path : [], tapped, this.moving ?? this.chosen, null)
      const shown = this.stops.length ? [] : (this.suggestions ?? [])
      layer.showSuggestions(shown.map((s) => ({ path: s.quote.path, colour })), this.lookedAt)
    } else if (this.tool === 'railService' && q?.ok) {
      layer.showPlan(colour, q.path, [], null, null)
      layer.showSuggestions([], null)
    } else {
      layer.clearPlan()
      layer.showSuggestions([], null)
    }
    const cand = this.candidates ?? []
    layer.showLanes(this.tool === 'busLane' ? cand : null, cand.filter((l) => this.lanes.includes(l.id)))
    layer.showJunctions(this.tool === 'junction' ? this.junctionsInView() : null, this.node)
    if (this.tool === 'oneWay') {
      const chosen = this.stretch ? [this.stretch, ...(this.twin(this.stretch) ? [this.twin(this.stretch)!] : [])] : []
      // The way the chosen road would run, drawn with arrows as the roads one-way now are.
      const running = this.link === null ? null : this.twoWay?.find((l) => l.id === this.link)
      const arrows = [...this.oneWays, ...(running && this.oneWayOn ? [{ drawn: running.drawn, forward: [] as boolean[], line: running.ends }] : [])]
      // A stretch's own direction is known only from its drawn stretches' `forward`; the chosen one is drawn by its ends.
      layer.showOneWay(this.twoWay ?? [], chosen, arrows.map((a) => (a.forward.length ? a : { drawn: [], forward: [], line: a.line })))
    } else layer.showOneWay(null, [], [])
    if (isMend(this.tool)) {
      const chosen = new Set(this.mendLinks)
      const byId = new Map((this.allLinks ?? []).map((l) => [l.id, l]))
      const links = [...chosen].map((id) => byId.get(id)).filter((l): l is DrawnLinkOut => !!l)
      layer.showRepair(links, (this.run?.links ?? []).filter((l) => !chosen.has(l.id)))
    } else layer.showRepair([], [])
    this.placePop()
  }

  /** The map moved: junction marks follow what is in view. */
  moved(): void {
    if (this.tool === 'junction') this.layer?.showJunctions(this.junctionsInView(), this.node)
  }

  /** The card beside a chosen stop: move it or take it out. */
  private placePop(): void {
    const i = this.moving ?? this.chosen
    if (i === null || !this.placing || !this.stops[i]) {
      this.pop.hidden = true
      return
    }
    const at = this.points()[i]
    if (!at) return
    const p = this.map.project(at)
    const w = this.pop.offsetWidth || 220
    this.pop.style.left = `${Math.round(Math.max(8, Math.min(innerWidth - w - 8, p.x - w / 2)))}px`
    this.pop.style.top = `${Math.round(Math.max(8, p.y + 20))}px`
  }

  private drawPop(): void {
    const i = this.moving ?? this.chosen
    if (i === null || !this.placing || !this.stops[i]) {
      this.pop.hidden = true
      return
    }
    const q = this.quote
    const h = this.handles()[i]
    const name = h === undefined ? null : q?.stations[h]?.name
    const what = this.tool === 'metro' ? 'station' : 'stop'
    if (this.moving !== null) {
      // While a stop is moved the card stands aside, since it would cover the map where the stop may go.
      this.pop.hidden = true
      return
    } else {
      const move = button('', 'Move')
      const out = button('', 'Take out')
      const done = button('', 'Done')
      move.addEventListener('click', () => {
        this.moving = i
        this.drawMap()
        this.hooks.refresh()
      })
      out.addEventListener('click', () => {
        this.chosen = null
        this.edit(this.stops.filter((_, k) => k !== i), null)
      })
      done.addEventListener('click', () => {
        this.chosen = null
        this.drawMap()
        this.hooks.refresh()
      })
      const row = element('div', 'pop-buttons')
      row.append(move, out, done)
      this.pop.replaceChildren(element('strong', 'small', name || `${what[0]!.toUpperCase()}${what.slice(1)} ${i + 1}`), row)
    }
    this.pop.hidden = false
    this.placePop()
  }

  // -------------------------------------------------------------------------------------------------------------
  // The page.

  /** Draws the Build page into `body`. */
  draw(body: HTMLElement, game: Game): void {
    this.drawPage(body, game)
    keepFocus(body)
  }

  private drawPage(body: HTMLElement, game: Game): void {
    this.game = game
    body.classList.toggle('build-placing', !!this.tool)
    document.body.classList.toggle('sheet-low', this.phone && this.low && this.placing)
    this.drawPop()
    if (!this.tool) return this.drawHome(body, game)
    const head = element('div', 'build-head')
    const back = button('quiet back', '‹ Build', 'Back to the tools')
    back.dataset.build = 'back'
    back.addEventListener('click', () => this.choose(null))
    head.append(back, element('h3', '', TOOLS.find((t) => t.tool === this.tool)!.name))
    if (this.undos.length) {
      const undo = button('undo', 'Undo', 'Undo the last change')
      undo.dataset.build = 'undo'
      undo.addEventListener('click', () => this.undo())
      head.append(undo)
    }
    if (this.phone && this.placing) {
      // The sheet's handle: lowered, the map shows nearly whole; raised, the plan and its forecast.
      const handle = button('sheet-handle', this.low ? 'More' : 'Map', this.low ? 'Show the whole plan' : 'Lower the page to see the map')
      handle.dataset.build = 'sheet'
      handle.setAttribute('aria-expanded', String(!this.low))
      handle.addEventListener('click', () => {
        this.low = !this.low
        this.hooks.refresh()
      })
      head.append(handle)
    }
    body.append(head)
    const placed = isMend(this.tool) ? this.mendLinks.length : this.stops.length
    const said = element('p', 'instruction', instruction(this.tool, placed, this.moving !== null, this.phone))
    said.dataset.build = 'instruction'
    body.append(said)
    const list = this.listPicker()
    if (list) body.append(list)
    if (this.moving !== null) {
      const keep = button('quiet', 'Keep it where it was')
      keep.addEventListener('click', () => {
        this.moving = null
        this.chosen = null
        this.drawMap()
        this.hooks.refresh()
      })
      body.append(keep)
    }
    if (this.tool === 'railService') this.drawRail(body)
    if (this.tool === 'busRoute' && this.stops.length >= 2) body.append(this.busStepper())
    if ((this.tool === 'road' || this.tool === 'flyover') && this.stops.length >= 1) body.append(this.laneStepper())
    if (this.tool === 'junction' && this.node !== null) body.append(this.workChoices())
    if (this.byZone && this.zone !== null) body.append(this.zoneHead(this.zone))
    if (this.tool === 'speedLimit' && this.zone !== null) body.append(this.limitChoices())
    if (this.tool === 'oneWay' && !this.twoWay) body.append(element('p', 'muted small working', 'Finding the roads that run both ways…'))
    if (isMend(this.tool)) this.drawMend(body)
    if (this.tool === 'streets' && this.zone !== null) body.append(this.streetChoices(this.zone))
    if (this.tool === 'oneWay') body.append(this.oneWayChoices(game))
    if (this.byZone && this.zone === null && this.tool !== 'density' && this.tool !== 'streets' && !this.hooks.month()?.deathsByZone) {
      body.append(element('p', 'muted small', 'Road deaths by zone are not in the model yet, so no zone is shaded.'))
    }
    const enough = this.stopping ? this.stops.length >= 2
      : this.tool === 'busLane' ? this.lanes.length > 0 : this.tool === 'railService' ? !!this.railLine : !!this.plan()
    if (enough && this.upkeep) body.append(this.mendProposal(game))
    else if (enough) body.append(this.proposal(game))
    else if (this.stopping && !this.stops.length) body.append(this.drawSuggestions(game))
    if (this.stops.length || this.lanes.length || this.node !== null || this.zone !== null || this.link !== null || this.mendLinks.length) {
      const again = button('quiet', 'Start again')
      again.dataset.build = 'again'
      again.addEventListener('click', () => this.choose(this.tool))
      body.append(again)
    }
  }

  /**
   * The map's acts without the map (PRD UI-7): a list of stations and places, zones or roads to choose from, for a
   * keyboard, a screen reader, or anyone who would rather choose by name.
   */
  private listPicker(): HTMLElement | null {
    const options: { label: string; run: () => void }[] = []
    let prompt = ''
    const byName = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label)
    if (this.stopping) {
      const road = this.tool === 'road' || this.tool === 'flyover'
      prompt = this.tool === 'metro' ? 'Add a station by name' : road ? 'Add a place by name' : 'Add a stop by name'
      const seen = new Set<string>()
      if (!road) {
        for (const st of this.transit?.stations ?? []) {
          if (st.kind === 'bus' || seen.has(st.name)) continue
          seen.add(st.name)
          options.push({ label: `${st.name} station`, run: () => this.placeListed({ station: st.id }, st.at) })
        }
      }
      for (const p of KNOWN_PLACES) options.push({ label: p.en, run: () => this.placeListed({ at: p.at }, p.at) })
      options.sort(byName)
    } else if (this.byZone) {
      prompt = 'Choose a zone by name'
      for (const z of this.hooks.zones?.list ?? []) {
        if (!z.ward) continue
        options.push({ label: z.name, run: () => this.listedZone(z.id, z.centre) })
      }
      options.sort(byName)
    } else if (this.tool === 'busLane' && this.candidates) {
      prompt = 'Choose a road by name'
      const named = new Map<string, number[]>()
      for (const l of this.candidates) {
        const name = this.layer?.nameOf(l.id, this.candidates)
        if (name) named.set(name, [...(named.get(name) ?? []), l.id])
      }
      for (const [name, ids] of named) options.push({ label: name, run: () => this.listedLanes(ids) })
      options.sort(byName)
    } else if (isMend(this.tool) && this.allLinks && this.surfaceNow) {
      // The roads with most km poor or broken, worst first.
      prompt = 'Choose one of the worst roads'
      const network = this.hooks.network()
      const named = new Map<string, { links: DrawnLinkOut[]; m: number }>()
      for (const l of this.allLinks) {
        if ((this.surfaceNow.byLink[l.id] ?? 100) >= 50) continue
        const name = l.drawn.map((d) => network?.links[d]?.name).find((n) => !!n)
        if (!name) continue
        const entry = named.get(name) ?? { links: [], m: 0 }
        entry.links.push(l)
        entry.m += l.length ?? 0
        named.set(name, entry)
      }
      const worst = [...named].sort((a, b) => b[1].m - a[1].m).slice(0, 25)
      for (const [name, { links }] of worst) {
        const k = roadKm(links.map((l) => ({ drawn: l.drawn, length: l.length ?? 0 })), network)
        options.push({ label: `${name}, ${km(k * 1000)} poor or broken`, run: () => this.listedMend(name, links) })
      }
    }
    if (!options.length) return null
    const select = element('select', 'pick-list')
    select.dataset.build = 'list'
    select.setAttribute('aria-label', prompt)
    select.append(new Option(`${prompt}…`, ''))
    options.forEach((o, i) => select.append(new Option(o.label, String(i))))
    select.addEventListener('change', () => {
      const o = options[Number(select.value)]
      if (select.value !== '' && o) o.run()
    })
    return select
  }

  /** A stop chosen from the list: put at the end, and the map moved to show it. */
  private placeListed(stop: Stop, at: LngLat): void {
    if ('station' in stop && this.stops.some((s) => 'station' in s && s.station === stop.station)) {
      return this.say('The line already stops here.', at)
    }
    this.place(stop, at)
    this.frame([...this.points(), at])
  }

  private listedZone(id: number, centre: LngLat): void {
    this.chooseZone(id)
    const rings = this.hooks.zones?.outline(id)
    this.frame(rings ? rings.flat().map((p) => [p[0]!, p[1]!] as LngLat) : [centre])
  }

  /** A named road's bus lanes, both ways, chosen from the list; chosen again, left out. */
  private listedLanes(ids: number[]): void {
    this.remember()
    const on = ids.every((id) => this.lanes.includes(id))
    this.lanes = on ? this.lanes.filter((l) => !ids.includes(l)) : [...new Set([...this.lanes, ...ids])]
    signal('placed')
    this.foreseen = null
    this.drawMap()
    void this.requote()
    this.hooks.refresh()
    const b = this.boundsOf((this.candidates ?? []).filter((l) => ids.includes(l.id)))
    if (b) this.frame(b)
  }

  /** The poor and broken stretches of a named road, chosen from the list to mend. */
  private listedMend(name: string, links: DrawnLinkOut[]): void {
    this.remember()
    this.mendLinks = [...new Set([...this.mendLinks, ...links.map((l) => l.id)])].sort((a, b) => a - b)
    this.tappedName = name
    this.run = null
    signal('placed')
    this.afterMendChange()
    const b = this.boundsOf(links)
    if (b) this.frame(b)
  }

  private drawHome(body: HTMLElement, game: Game): void {
    if (this.notice) body.append(element('p', 'notice', this.notice))
    const over = game.status !== 'playing'
    for (const g of GROUPS) {
      const head = button('tool-group', '')
      head.dataset.group = g.group
      head.setAttribute('aria-expanded', String(this.group === g.group))
      head.append(element('strong', '', g.name), element('span', 'muted small', g.line))
      head.addEventListener('click', () => {
        this.group = this.group === g.group ? null : g.group
        this.hooks.refresh()
      })
      body.append(head)
      if (this.group !== g.group) continue
      const grid = element('div', 'tools')
      for (const t of TOOLS.filter((x) => x.group === g.group)) {
        const b = button('tool', '')
        b.dataset.tool = t.tool
        b.disabled = over
        const swatch = element('i', 'tool-mark')
        swatch.style.background = t.tool === 'metro' ? nextMetro(game).colour : t.tool === 'railService' ? '#9d968b'
          : g.group === 'roads' ? ROAD_MARK : g.group === 'upkeep' ? SURFACE_COLOURS.poor : BUS_COLOUR
        b.append(swatch, element('strong', '', t.name), element('span', 'muted small', t.line))
        b.addEventListener('click', () => this.choose(t.tool))
        grid.append(b)
      }
      body.append(grid)
    }
    if (game.majors !== undefined) {
      const left = Math.max(0, 3 - game.majors)
      body.append(element('p', 'muted small', `Major works may be started three a month. ${left} left this month.`))
    }
    body.append(this.works(game))
  }

  /** Work under way (PRD UI-15): each with the months left, what it has cost so far, and the roads it takes lanes from. */
  private works(game: Game): HTMLElement {
    const box = element('section', 'works')
    const projects = game.projects ?? []
    box.append(element('h3', '', projects.length ? 'Work under way' : 'Nothing is being built'))
    if (!projects.length) {
      box.append(element('p', 'muted small', 'Choose a tool above. You see the cost, the time and what it should do before anything is ordered.'))
      return box
    }
    for (const p of projects) box.append(this.work(p, game))
    return box
  }

  private work(p: Project, game: Game): HTMLElement {
    const row = element('div', 'work')
    const look = projectLook(game, p.plan, p.name)
    const title = element('div', 'work-title')
    const swatch = element('i', 'line-swatch')
    swatch.style.background = look.colour
    title.append(swatch, element('strong', '', p.name))
    const total = Math.max(1, p.opens - p.started)
    const done = Math.max(0, Math.min(total, game.month - p.started))
    const left = p.opens - game.month
    const bar = element('div', 'progress')
    const fill = element('i')
    fill.style.width = `${Math.round((done / total) * 100)}%`
    fill.style.background = look.colour
    bar.append(fill)
    row.append(title, bar)
    row.append(element('p', 'small', `Opens in ${monthShort(p.opens)}, ${left} month${left === 1 ? '' : 's'} from now. ` +
      (done ? `About ${crore(Math.round((p.cost * done) / total))} of ${crore(p.cost)} spent.` : `It costs ${crore(p.cost)}, paid as the work goes.`)))
    const half = p.started + Math.ceil(total / 2)
    if (p.quote.disrupted.length && game.month < half) {
      row.append(element('p', 'small muted', `${p.quote.disrupted.length} stretches of road beneath lose a lane until ${monthShort(half)}.`))
    }
    if (this.confirmCancel === p.id) {
      const yes = button('commit', 'Cancel the work')
      const no = button('quiet', 'Keep building')
      yes.addEventListener('click', async () => {
        const out = await this.hooks.act({ kind: 'cancel', project: p.id })
        this.confirmCancel = null
        this.notice = out.ok ? `${p.name} is cancelled.` : out.reason
        this.hooks.refresh()
      })
      no.addEventListener('click', () => {
        this.confirmCancel = null
        this.hooks.refresh()
      })
      const buttons = element('div', 'outlook-buttons')
      buttons.append(yes, no)
      row.append(element('p', 'reason', 'What has been spent is lost.'), buttons)
    } else {
      const cancel = button('quiet', 'Cancel')
      cancel.disabled = game.status !== 'playing'
      cancel.addEventListener('click', () => {
        this.confirmCancel = p.id
        this.hooks.refresh()
      })
      row.append(cancel)
    }
    return row
  }

  private drawSuggestions(game: Game): HTMLElement {
    const box = element('section', 'suggestions')
    const what = this.tool === 'metro' ? 'lines' : this.tool === 'road' ? 'roads' : this.tool === 'flyover' ? 'flyovers' : 'routes'
    box.append(element('h3', '', `Suggested ${what}`))
    if (!this.suggestions) {
      box.append(element('p', 'muted small working', 'Finding the busiest corridors…'))
      return box
    }
    if (!this.suggestions.length) {
      box.append(element('p', 'muted small', `No ${what} to suggest. Tap the map to place your own.`))
      return box
    }
    box.append(element('p', 'muted small', this.tool === 'road' || this.tool === 'flyover'
      ? 'Where traffic is worst and a way round is missing. Drawn faintly on the map.'
      : 'Along the corridors where most people travel and no line runs. Drawn faintly on the map.'))
    this.suggestions.forEach((s, i) => {
      const card = element('div', 'suggestion')
      card.classList.toggle('looked', this.lookedAt === i)
      const q = s.quote
      const name = q.stations.length >= 2 ? `${q.stations[0]!.name} to ${q.stations.at(-1)!.name}` : `Suggestion ${i + 1}`
      const head = button('suggestion-head', '')
      head.append(element('strong', '', name), element('span', 'small muted',
        `${this.stopping && this.tool !== 'metro' && this.tool !== 'busRoute' ? `${this.roadLanesOf(s.plan)} lanes each way`
          : `${q.stations.length} ${this.tool === 'metro' ? 'stations' : 'stops'}`} · ${km(q.length)} · ${crore(q.cost)} · ${duration(q.months)}`))
      head.addEventListener('click', () => this.look(i))
      card.append(head)
      const f = s.foreseen
      if (!f) card.append(element('p', 'small muted working', 'Working out what it would do…'))
      else card.append(element('p', 'small', this.effectLine(f)))
      const use = button('commit', `Use this ${this.tool === 'metro' ? 'line' : this.tool === 'busRoute' ? 'route' : this.tool === 'road' ? 'road' : 'flyover'}`)
      use.disabled = game.status !== 'playing'
      use.dataset.build = 'use'
      use.dataset.index = String(i)
      use.addEventListener('click', () => this.use(i))
      card.append(use)
      box.append(card)
    })
    return box
  }

  /** "Forecast: 1.2 lakh riders a day; the commute near it 2.1 min shorter." */
  private effectLine(f: Foreseen): string {
    if (f.through !== undefined || f.servedDeaths !== undefined || f.unforeseen) return this.roadEffect(f)
    const parts: string[] = []
    if (f.riders) parts.push(`${people(f.riders[1])} riders a day`)
    if (f.served) {
      const d = (f.served.before - f.served.after) / 60
      parts.push(Math.abs(d) < 0.05 ? 'little change to the commute near it'
        : `the commute near it ${decimal(Math.abs(d))} min ${d > 0 ? 'shorter' : 'longer'}`)
    }
    if (f.score) parts.push(scoreWords(f.score))
    return parts.length ? `Forecast: ${parts.join('; ')}.` : ''
  }

  /** "Forecast: the commute near it 0.4 min shorter; 2 fewer road deaths a year." */
  private roadEffect(f: Foreseen): string {
    if (f.unforeseen) return f.unforeseen
    const parts: string[] = []
    if (f.served) {
      const d = (f.served.before - f.served.after) / 60
      parts.push(Math.abs(d) < 0.05 ? 'little change to the commute near it'
        : `the commute near it ${decimal(Math.abs(d))} min ${d > 0 ? 'shorter' : 'longer'}`)
    }
    if (f.through && f.through[0] > 0) {
      const [b, a] = f.through
      if (Math.abs(a - b) >= 1) parts.push(`traffic through it ${Math.round(b)} → ${Math.round(a)} km/h at the evening peak`)
    }
    const deaths = f.servedDeaths ?? (f.before?.deaths !== undefined && f.after?.deaths !== undefined ? [f.before.deaths, f.after.deaths] : null)
    if (deaths) {
      const d = deaths[0] - deaths[1]
      if (Math.round(d) !== 0) parts.push(`${Math.abs(Math.round(d))} ${d > 0 ? 'fewer' : 'more'} road deaths a year`)
    }
    if (f.score) parts.push(scoreWords(f.score))
    return parts.length ? `Forecast: ${parts.join('; ')}.` : 'Forecast: little change.'
  }

  private roadLanesOf(plan: Plan): number {
    return plan.kind === 'road' ? plan.lanes : this.roadLanes
  }

  private laneStepper(): HTMLElement {
    const box = element('div', 'fare')
    box.append(element('span', 'fare-name', 'Lanes'))
    const stepper = element('div', 'stepper')
    const less = button('', '−', 'Fewer lanes')
    const more = button('', '+', 'More lanes')
    less.disabled = this.roadLanes <= 1
    more.disabled = this.roadLanes >= 3
    const set = (n: 1 | 2 | 3) => {
      this.roadLanes = n
      this.foreseen = null
      void this.requote()
      this.hooks.refresh()
    }
    less.addEventListener('click', () => set(Math.max(1, this.roadLanes - 1) as 1 | 2 | 3))
    more.addEventListener('click', () => set(Math.min(3, this.roadLanes + 1) as 1 | 2 | 3))
    stepper.append(less, element('span', 'value', `${this.roadLanes} each way`), more)
    box.append(stepper)
    return box
  }

  /** The three kinds of junction work, each with its cost, time and forecast, to choose between. */
  private workChoices(): HTMLElement {
    const box = element('div', 'choices')
    const what: Record<Work, string> = {
      signal: 'Traffic lights and crossings. Small gains in flow and safety.',
      redesign: 'Kerbs, turning lanes and crossings rebuilt. More room, fewer deaths.',
      overpass: 'The main road lifted over the junction. Much more room along it.',
    }
    for (const w of ['signal', 'redesign', 'overpass'] as Work[]) {
      const entry = this.works_[w]
      const b = button('choice', '')
      b.setAttribute('aria-pressed', String(this.junctionWork === w && !!entry?.quote.ok))
      b.append(element('strong', '', JUNCTION_WORK[w]), element('span', 'small muted', what[w]))
      if (!entry) b.append(element('span', 'small muted working', 'Working out the cost…'))
      else if (!entry.quote.ok) {
        b.disabled = true
        b.append(element('span', 'small reason', entry.quote.reason ?? 'Cannot be done here.'))
      } else {
        b.append(element('span', 'small', `${crore(entry.quote.cost)} · ${duration(entry.quote.months)}`))
        b.append(entry.foreseen ? element('span', 'small', this.roadEffect(entry.foreseen))
          : element('span', 'small muted working', 'Working out what it would do…'))
      }
      b.addEventListener('click', () => this.chooseWork(w))
      box.append(b)
    }
    return box
  }

  private zoneHead(id: number): HTMLElement {
    const z = this.hooks.zones?.list.find((x) => x.id === id)
    const head = element('p', 'strong', z?.name ?? `Zone ${id}`)
    if (z?.nameKn) head.append(' ', Object.assign(element('span', 'kn muted', z.nameKn), { lang: 'kn' }))
    const deaths = this.hooks.month()?.deathsByZone?.[id]
    const box = element('div')
    box.append(head)
    if (deaths !== undefined) box.append(element('p', 'small muted', `${deaths} road death${deaths === 1 ? '' : 's'} a year here, at this month’s rate.`))
    return box
  }

  /** The limits that would change something in the zone chosen, each with the km of main road it would slow. */
  private limitChoices(): HTMLElement {
    const box = element('div', 'choices')
    const r = this.zoneRoads
    if (!r) {
      box.append(element('p', 'muted small working', 'Finding the main roads in this zone…'))
      return box
    }
    if (r.km < 0.1) {
      box.append(element('p', 'muted small', 'This zone has no main roads for a limit to act on.'))
      return box
    }
    const fastest = r.bySpeed.at(-1)?.[0] ?? 0
    const offered = LIMITS.filter((l) => l < fastest && l !== r.limit)
    box.append(element('p', 'small muted', `${decimal(r.km)} km of main road here, free at ${r.bySpeed[0]![0]}` +
      `${fastest !== r.bySpeed[0]![0] ? ` to ${fastest}` : ''} km/h${r.limit ? `, with a limit of ${r.limit} km/h now` : ''}.`))
    for (const l of offered) {
      const slowed = r.bySpeed.filter(([speed]) => speed > l).reduce((sum, [, k]) => sum + k, 0)
      const b = button('choice', '')
      b.setAttribute('aria-pressed', String(this.limit === l))
      b.append(element('strong', '', `${l} km/h`), element('span', 'small muted', `Slows ${decimal(slowed)} of the ${decimal(r.km)} km.`))
      b.addEventListener('click', () => this.chooseLimit(l))
      box.append(b)
    }
    if (r.limit !== null) {
      const b = button('choice', '')
      b.setAttribute('aria-pressed', String(this.limit === null))
      b.append(element('strong', '', 'No limit'), element('span', 'small muted', 'Takes the limit away.'))
      b.addEventListener('click', () => this.chooseLimit(null))
      box.append(b)
    }
    if (!offered.length && r.limit === null) box.append(element('p', 'muted small', 'No limit would slow anything here.'))
    return box
  }

  /** Which way the chosen road is to run, and the player's one-way streets, each of which can be two-way again. */
  private oneWayChoices(game: Game): HTMLElement {
    const box = element('div')
    const s = this.stretch
    if (s?.ends) {
      const twin = this.twin(s)
      box.append(element('p', 'strong', this.layer?.nameOf(s.id, this.twoWay ?? []) ?? 'A main road'))
      const choices = element('div', 'choices')
      for (const way of [s, ...(twin ? [twin] : [])]) {
        const b = button('choice', '')
        b.setAttribute('aria-pressed', String(this.link === way.id && this.oneWayOn))
        b.append(element('strong', '', `One-way, heading ${heading(way.ends!)}`),
          element('span', 'small muted', `Traffic the other way goes round.`))
        b.addEventListener('click', () => {
          this.link = way.id
          this.oneWayOn = true
          this.foreseen = null
          this.drawMap()
          void this.requote()
          this.hooks.refresh()
        })
        choices.append(b)
      }
      box.append(choices)
    }
    const mine = game.built?.oneWay ?? []
    if (mine.length) {
      box.append(element('h3', '', 'Your one-way streets'))
      for (const id of mine) {
        const row = element('div', 'loan')
        row.append(element('span', 'small', this.layer?.nameOf(id, this.oneWays) ?? 'A road'))
        const again = button('quiet', 'Make it two-way')
        again.addEventListener('click', () => {
          this.stretch = null
          this.link = id
          this.oneWayOn = false
          this.foreseen = null
          void this.requote()
          this.hooks.refresh()
        })
        row.append(again)
        box.append(row)
      }
    }
    return box
  }

  /** The roads chosen to mend: the name of the road, how much of it, and how bad. */
  private chosenRoad(): { name: string | null; km: number; condition: number } {
    const byId = new Map((this.allLinks ?? []).map((l) => [l.id, l]))
    const links = this.mendLinks.map((id) => byId.get(id)).filter((l): l is DrawnLinkOut => !!l)
    const network = this.hooks.network()
    const byName = new Map<string, number>()
    let metres = 0
    let sum = 0
    for (const l of links) {
      const c = this.surfaceNow?.byLink[l.id] ?? 100
      metres += l.length ?? 0
      sum += (l.length ?? 0) * c
      for (const d of l.drawn) {
        const n = network?.links[d]?.name
        if (n) byName.set(n, (byName.get(n) ?? 0) + (network!.links[d]!.length ?? 0))
      }
    }
    // A routing link takes in short stretches of the roads it meets: a name is the road's if it covers most of it.
    // The road the player tapped leads, whatever else its links take in.
    const names = [...byName].sort((a, b) => (b[0] === this.tappedName ? Infinity : b[1]) - (a[0] === this.tappedName ? Infinity : a[1]))
    const named = names.reduce((sum, n) => sum + n[1], 0)
    const others = names.filter((n) => n[1] >= named * 0.25).length - 1
    const name = names.length ? (others > 0 ? `${names[0]![0]} and ${others === 1 ? 'one other road' : `${others} other roads`}` : names[0]![0]) : null
    return { name, km: roadKm(links.map((l) => ({ drawn: l.drawn, length: l.length ?? 0 })), network), condition: metres ? sum / metres : 100 }
  }

  /** "Patching potholes, Hosur Road", "Resurfacing the streets of Jayanagar". */
  private nameOf(plan: Plan, q: Quote, game: Game): string {
    if (plan.kind === 'repair') {
      const road = this.chosenRoad().name
      return `${REPAIR_WORK[plan.work]}${road ? `, ${road}` : ''}`
    }
    return planName(plan, q, game, this.transit, this.hooks.zones?.list)
  }

  /** For mending roads: what is chosen, the whole named road offered, and the three kinds of mending. */
  private drawMend(body: HTMLElement): void {
    if (!this.allLinks || !this.surfaceNow) {
      body.append(element('p', 'muted small working', 'Loading the roads…'))
      return
    }
    // On a phone the proposal below names the road and its km: the lines are not said twice there.
    if (this.mendLinks.length && !this.phone) {
      const r = this.chosenRoad()
      body.append(element('p', 'strong', r.name ?? 'A main road without a name'),
        element('p', 'small muted', `${km(r.km * 1000)} chosen, ${gradeName(r.condition)} (${Math.round(r.condition)} of 100).`))
    }
    if (this.run) {
      const offer = button('choice offer', '')
      const what = this.run.worse === 'poor' ? 'poor or broken' : 'fair or worse'
      offer.append(element('strong', '', `All ${km(this.run.km * 1000)} of ${this.run.name} that is ${what}`),
        element('span', 'small muted', 'Instead of choosing it stretch by stretch. Shown faintly on the map.'))
      offer.addEventListener('click', () => this.takeRun())
      body.append(offer)
    }
    if (!this.mendLinks.length) return
    // On a phone the three are a row of buttons with their costs, so that the proposal and its button stay in view.
    if (this.phone) {
      const row = element('div', 'amounts levels mends')
      for (const w of MENDS) {
        const q = this.mendQuotes[w]
        const b = button('', '')
        b.dataset.mend = w
        b.setAttribute('aria-pressed', String(this.tool === w))
        b.disabled = !!q && !q.ok
        b.append(element('strong', '', w === 'patch' ? 'Patch' : w === 'resurface' ? 'Resurface' : 'Concrete'),
          element('span', 'small muted', !q ? '…' : q.ok ? crore(q.cost) : 'Not here'))
        b.addEventListener('click', () => this.chooseMend(w))
        row.append(b)
      }
      body.append(row)
      return
    }
    const box = element('div', 'choices')
    for (const w of MENDS) {
      const q = this.mendQuotes[w]
      const b = button('choice', '')
      b.dataset.mend = w
      b.setAttribute('aria-pressed', String(this.tool === w))
      b.append(element('strong', '', TOOLS.find((t) => t.tool === w)!.name), element('span', 'small muted', MEND_WORDS[w].does))
      if (!q) b.append(element('span', 'small muted working', 'Working out the cost…'))
      else if (!q.ok) {
        b.disabled = true
        b.append(element('span', 'small reason', q.reason ?? 'Cannot be done here.'))
      } else b.append(element('span', 'small', `${crore(q.cost)} · ${q.months ? duration(q.months) : 'within the month'}`))
      b.addEventListener('click', () => this.chooseMend(w))
      box.append(b)
    }
    body.append(box)
  }

  /** For a zone's streets: the zone, how its streets stand, and patching or resurfacing them. */
  private streetChoices(zone: number): HTMLElement {
    const box = element('div')
    const c = this.surfaceNow?.streets?.[zone]
    if (c !== undefined) box.append(element('p', 'small muted', `Its streets are ${gradeName(c)} (${Math.round(c)} of 100).`))
    const choices = element('div', 'choices')
    for (const w of ['patch', 'resurface'] as const) {
      const q = this.streetQuotes[w]
      const b = button('choice', '')
      b.setAttribute('aria-pressed', String(this.streetWork === w))
      b.append(element('strong', '', w === 'patch' ? 'Patch the potholes' : 'Resurface'),
        element('span', 'small muted', w === 'patch' ? 'Raises the streets to fair, for about a year.' : 'Raises them to good, for 4 to 6 years.'))
      if (!q) b.append(element('span', 'small muted working', 'Working out the cost…'))
      else if (!q.ok) {
        b.disabled = true
        b.append(element('span', 'small reason', q.reason ?? 'Cannot be done here.'))
      } else b.append(element('span', 'small', `${crore(q.cost)} · ${q.months ? duration(q.months) : 'within the month'}`))
      b.addEventListener('click', () => this.chooseStreetWork(w))
      choices.append(b)
    }
    box.append(choices)
    return box
  }

  /**
   * The proposal for mending (PRD UI-5): what it costs, how long it takes and lasts, what it shuts while done, and what
   * it should do for the road and the city; with the warning about patching in the monsoon where it applies.
   */
  private mendProposal(game: Game): HTMLElement {
    const box = element('div', 'outlook proposal')
    box.setAttribute('aria-live', 'polite')
    const q = this.quote
    const plan = this.plan()
    if (!q || !plan || (plan.kind !== 'repair' && plan.kind !== 'streets')) {
      box.append(element('p', 'muted small working', 'Working out what it would cost…'))
      return box
    }
    if (!q.ok) {
      box.append(element('p', 'reason', q.reason ?? 'This cannot be done as it is.'))
      return box
    }
    box.append(element('strong', 'proposal-name', this.nameOf(plan, q, game)))
    const work: Mend = plan.work
    const short = patchesShort(game.month) && work === 'patch'
    // The rules' own figure for how long it lasts, where they give one.
    const lasts = q.lasts !== undefined ? lastsWords(q.lasts, work)
      : short ? 'About six months: patching from May to September lasts half as long' : MEND_WORDS[work].lasts
    const when = q.months ? `${duration(q.months)}, done in ${monthShort(game.month + q.months)}` : 'Within the month'
    const f = this.foreseen
    const outcome = f?.outcome
    const shortOf = q.cost - game.money
    const go = button('commit', this.goText(plan, q))
    go.disabled = game.status !== 'playing' || shortOf > 0 || (!!outcome && !outcome.ok)
    go.dataset.build = 'commit'
    go.addEventListener('click', () => void this.order(plan, q))
    const buttons = element('div', 'outlook-buttons')
    buttons.append(go)
    if (this.phone) {
      const more = button('quiet', this.details ? 'Fewer details' : 'Details')
      more.dataset.build = 'details'
      more.addEventListener('click', () => {
        this.details = !this.details
        this.low = false
        this.hooks.refresh()
      })
      buttons.append(more)
    }
    const brief = this.phone && !this.details
    if (brief) {
      const r = plan.kind === 'repair' ? this.chosenRoad() : null
      const size = r ? `${km(r.km * 1000)} ${gradeName(r.condition)} · ` : ''
      box.append(element('p', 'small brief', `${size}${crore(q.cost)} · ${q.months ? duration(q.months) : 'within the month'} · lasts ${lasts.split(':')[0]!.toLowerCase()}`))
      // On a phone the button comes first, where the sheet shows it; the forecast and the note follow.
      if (shortOf > 0) box.append(element('p', 'reason', `The city has ${crore(game.money)}, and this costs ${crore(q.cost)}.`))
      else if (outcome && !outcome.ok) box.append(element('p', 'reason', outcome.reason))
      box.append(buttons)
    } else {
      const facts: [string, string][] = []
      if (plan.kind === 'repair') {
        const r = this.chosenRoad()
        facts.push(['Length', km(r.km * 1000)], ['Surface', `${gradeName(r.condition)}, ${Math.round(r.condition)} of 100`])
      } else {
        const c = this.surfaceNow?.streets?.[plan.zone]
        if (c !== undefined) facts.push(['Streets', `${gradeName(c)}, ${Math.round(c)} of 100`])
      }
      facts.push(['Cost', crore(q.cost)], ['Time', when], ['Lasts', lasts])
      facts.push(['Shuts', plan.kind === 'streets' ? (work === 'patch' ? 'Nothing' : 'Each street for a few days in turn') : MEND_WORDS[work].shuts])
      facts.push(['Kind', q.major ? 'A major work: three a month' : 'A minor work'])
      const dl = element('dl')
      for (const [k, v] of facts) dl.append(element('dt', '', k), element('dd', '', v))
      box.append(dl)
    }
    if (q.note) box.append(element('p', 'small note', q.note))
    else if (short) {
      box.append(element('p', 'small note', 'Patches laid just before or in the monsoon wash out sooner. Resurfacing lasts through it.'))
    }
    const forecast = element('div', 'forecast')
    forecast.append(element('p', 'forecast-tag', q.months ? 'Forecast, once done' : 'Forecast'))
    if (f && !f.unforeseen && f.after) forecast.append(scoreForecast(f.score, false))
    if (!f) forecast.append(element('p', 'muted small working', this.working ? 'Working out what it would do…' : 'Waiting for the plan to settle…'))
    else if (f.unforeseen) forecast.append(element('p', 'muted small', f.unforeseen))
    else if (!f.after || !f.before) forecast.append(element('p', 'muted small', 'The model could not say what it would do.'))
    else {
      const rows: [string, string][] = []
      if (f.road) {
        const [b, a] = f.road.condition
        rows.push(['Surface', `${gradeName(b)} → ${gradeName(a)}`])
        const c = f.carried
        if (c && c.vehicles[0] > 0 && c.vehicles[1] > c.vehicles[0] * 1.03) {
          // A mended road that draws traffic: more vehicles carried, and the time each takes, not one speed.
          const more = Math.round((c.vehicles[1] / c.vehicles[0] - 1) * 100)
          const dm = c.minutes[0] - c.minutes[1]
          const each = Math.abs(dm) < 0.05 ? 'each about as quick over its length'
            : `each ${decimal(Math.abs(dm))} min ${dm > 0 ? 'quicker' : 'slower'} over its length`
          rows.push(['Along it, evening peak', `Carries ${more}% more vehicles, ${each}`])
        } else if (f.road.kmh[0] > 0) rows.push(['Along it, evening peak', `${Math.round(f.road.kmh[0])} → ${Math.round(f.road.kmh[1])} km/h`])
      }
      if (f.during && f.during.kmh[0] > 0) {
        // The months of disruption before the gain, so that the player is not surprised by them.
        rows.push([`While it is done (${duration(f.during.months)})`, `${Math.round(f.during.kmh[0])} → ${Math.round(f.during.kmh[1])} km/h along it`])
      }
      if (f.served) {
        const near = plan.kind === 'streets' ? 'in this zone' : 'near it'
        rows.push([`Commute ${near} (${people(f.served.people)} people)`, `${minutes(f.served.before)} → ${minutes(f.served.after)}`])
      }
      // Changes in the city's commute under a third of a minute are the model's noise, not the mending's doing.
      const city = Math.abs(f.after.commute - f.before.commute) < 18 ? `No measurable change (${minutes(f.before.commute)})`
        : `${minutes(f.before.commute)} → ${minutes(f.after.commute)}`
      rows.push(['City’s average commute', city])
      if (f.before.deaths !== undefined && f.after.deaths !== undefined) rows.push(['Road deaths a year in the city', `${f.before.deaths} → ${f.after.deaths}`])
      const phone = this.phone && !this.details
      const table = element('dl')
      const brief = f.during ? [rows[1], rows.find((r) => r[0].startsWith('While'))].filter((r): r is [string, string] => !!r) : rows.slice(0, 2)
      for (const [k, v] of phone ? brief : rows) table.append(element('dt', '', k), element('dd', '', v))
      forecast.append(table)
      if (!phone) forecast.append(element('p', 'muted small', 'The model’s estimate for next month’s city with it done, against without.'))
    }
    box.append(forecast)
    if (!brief) {
      if (shortOf > 0) box.append(element('p', 'reason', `The city has ${crore(game.money)}, and this costs ${crore(q.cost)}.`))
      else if (outcome && !outcome.ok) box.append(element('p', 'reason', outcome.reason))
      box.append(buttons)
    }
    return box
  }

  private busStepper(): HTMLElement {
    const box = element('div', 'fare')
    box.append(element('span', 'fare-name', 'Buses'))
    const stepper = element('div', 'stepper')
    const less = button('', '−', 'Fewer buses')
    const more = button('', '+', 'More buses')
    less.disabled = this.buses <= 5
    less.addEventListener('click', () => {
      this.buses = Math.max(5, this.buses - 5)
      void this.requote()
      this.hooks.refresh()
    })
    more.addEventListener('click', () => {
      this.buses = Math.min(200, this.buses + 5)
      void this.requote()
      this.hooks.refresh()
    })
    stepper.append(less, element('span', 'value', `${this.buses} buses`), more)
    box.append(stepper)
    return box
  }

  private drawRail(body: HTMLElement): void {
    const lines = (this.transit?.lines ?? []).filter((l) => l.kind === 'rail' && l.status === 'open')
    const list = element('div', 'rail-lines')
    for (const l of lines) {
      const b = button('', l.name.replace(/\s*\(Bengaluru\)/, '').replace('Krantivira Sangolli Rayanna', 'Majestic'))
      b.setAttribute('aria-pressed', String(this.railLine === l.id))
      b.addEventListener('click', () => {
        this.railLine = l.id
        this.foreseen = null
        void this.requote().then(() => this.quote?.ok && this.frame(pairsOf(this.quote.path)))
        this.hooks.refresh()
      })
      list.append(b)
    }
    body.append(list)
    if (!this.railLine) return
    const box = element('div', 'fare')
    box.append(element('span', 'fare-name', 'More trains a day'))
    const stepper = element('div', 'stepper')
    const less = button('', '−', 'Fewer trains')
    const more = button('', '+', 'More trains')
    less.disabled = this.trains <= 2
    less.addEventListener('click', () => {
      this.trains = Math.max(2, this.trains - 2)
      void this.requote()
      this.hooks.refresh()
    })
    more.addEventListener('click', () => {
      this.trains = Math.min(20, this.trains + 2)
      void this.requote()
      this.hooks.refresh()
    })
    stepper.append(less, element('span', 'value', `${this.trains} trains`), more)
    box.append(stepper)
    body.append(box)
  }

  /** The proposal (PRD UI-5): where it goes, what it costs and takes, what it should do, and whether it can be paid for. */
  private proposal(game: Game): HTMLElement {
    const box = element('div', 'outlook proposal')
    box.setAttribute('aria-live', 'polite')
    const q = this.quote
    const plan = this.plan()
    if (!q || !plan) {
      box.append(element('p', 'muted small working', 'Working out where it would go…'))
      return box
    }
    if (!q.ok) {
      box.append(element('p', 'reason', q.reason ?? 'This cannot be built as it is.'))
      return box
    }
    box.append(element('strong', 'proposal-name', planName(plan, q, game, this.transit, this.hooks.zones?.list)))
    const opens = game.month + q.months
    // On a phone, while placing, the proposal is a summary, so that the sheet leaves the map in view.
    if (this.phone && !this.details) return this.summary(box, game, plan, q)
    const facts: [string, string][] = []
    if (plan.kind === 'metro' || plan.kind === 'busRoute') {
      facts.push([plan.kind === 'metro' ? 'Stations' : 'Stops', `${q.stations.length}`])
    }
    if (q.length && plan.kind !== 'railService') facts.push(['Length', km(q.length)])
    if (plan.kind === 'road') facts.push(['Lanes', `${plan.lanes} each way${plan.flyover ? ', raised' : ''}`])
    facts.push(['Cost', q.cost ? crore(q.cost) : 'Nothing'])
    facts.push(['Time', q.months ? `${duration(q.months)}, ${plan.kind === 'road' || plan.kind === 'junction' ? 'open' : 'done'} in ${monthShort(opens)}` : 'At once'])
    if (q.running) facts.push([ROAD_KINDS.has(plan.kind) ? 'Upkeep' : 'Running', `${crore(q.running)} a month`])
    if (q.disrupted.length) {
      const half = game.month + Math.ceil(q.months / 2)
      facts.push(['Roads', `${q.disrupted.length} stretches lose a lane until ${monthShort(half)}`])
    }
    facts.push(['Kind', q.major ? 'A major work: three a month' : 'A minor work'])
    const dl = element('dl')
    for (const [k, v] of facts) dl.append(element('dt', '', k), element('dd', '', v))
    box.append(dl)
    const good = this.makeGoodChoice(q)
    if (good) box.append(good)

    if (plan.kind === 'metro' || plan.kind === 'busRoute' || plan.kind === 'road') {
      const list = element('ol', 'plan-stations')
      // A road lists the places the player chose; where it meets other roads on the way is not a place of its own.
      for (const s of plan.kind === 'road' ? q.stations.filter((x) => x.stop !== undefined) : q.stations) {
        const li = element('li', '', s.name)
        if (s.nameKn) li.append(' ', Object.assign(element('span', 'kn', s.nameKn), { lang: 'kn' }))
        if (s.existing !== undefined) li.append(element('span', 'muted small', ' · joins a line there'))
        list.append(li)
      }
      box.append(list)
    }
    if (this.phone) {
      const fewer = button('quiet', 'Fewer details')
      fewer.addEventListener('click', () => {
        this.details = false
        this.hooks.refresh()
      })
      box.append(fewer)
    }

    // The forecast, once open.
    const f = this.foreseen
    const forecast = element('div', 'forecast')
    forecast.append(element('p', 'forecast-tag', q.months ? 'Forecast, once open' : 'Forecast'))
    if (f && !f.unforeseen && f.after) forecast.append(scoreForecast(f.score, false, q.months ? 'Score, a year after it opens' : 'Score, a year on'))
    if (ROAD_KINDS.has(plan.kind)) forecast.append(this.roadForecast(f))
    else if (!f) forecast.append(element('p', 'muted small working', this.working ? 'Working out what it would do…' : 'Waiting for the plan to settle…'))
    else if (!f.after || !f.before) forecast.append(element('p', 'muted small', 'The model could not say what it would do.'))
    else {
      const rows: [string, string][] = []
      if (f.riders) {
        rows.push(['Riders a day', plan.kind === 'railService'
          ? `${people(f.riders[0])} → ${people(f.riders[1])}` : people(f.riders[1])])
      }
      if (f.served) {
        rows.push([`Commute within 1 km of it (${people(f.served.people)} people)`, `${minutes(f.served.before)} → ${minutes(f.served.after)}`])
      }
      rows.push(['City’s average commute', `${minutes(f.before.commute)} → ${minutes(f.after.commute)}`])
      const net = (o: { books: { amount: number }[] }) => o.books.reduce((sum, e) => sum + e.amount, 0)
      const d = net(f.after) - net(f.before)
      rows.push(['Fares less running, a month', `${d >= 0 ? '+' : ''}${crore(d)}`])
      const table = element('dl')
      for (const [k, v] of rows) table.append(element('dt', '', k), element('dd', '', v))
      forecast.append(table)
      forecast.append(element('p', 'muted small', 'The model’s estimate for this month’s city with it open, against without.'))
    }
    box.append(forecast)

    // Paying for it.
    const short = q.cost - game.money
    const outcome = f?.outcome
    if (short > 0) {
      const borrow = Math.ceil(short / 10_000) * 10_000
      box.append(element('p', 'reason', `The city has ${crore(game.money)}, and this costs ${crore(q.cost)}. ` +
        `Borrowing ${crore(borrow)} would make it up.`))
      const levers = button('quiet', 'Borrow under Levers')
      levers.addEventListener('click', () => this.hooks.levers())
      box.append(levers)
    } else if (outcome && !outcome.ok) box.append(element('p', 'reason', outcome.reason))
    const go = button('commit', this.goText(plan, q))
    go.disabled = game.status !== 'playing' || short > 0 || (!!outcome && !outcome.ok)
    go.dataset.build = 'commit'
    go.addEventListener('click', () => void this.order(plan, q))
    const buttons = element('div', 'outlook-buttons')
    buttons.append(go)
    box.append(buttons)
    return box
  }

  /** What a road, a junction or a policy is forecast to do: near it and in the city, commute, speed and deaths. */
  private roadForecast(f: Foreseen | null): HTMLElement {
    const box = element('div')
    if (!f) {
      box.append(element('p', 'muted small working', this.working ? 'Working out what it would do…' : 'Waiting for the plan to settle…'))
      return box
    }
    if (f.unforeseen) {
      box.append(element('p', 'muted small', f.unforeseen))
      return box
    }
    if (!f.after || !f.before) {
      box.append(element('p', 'muted small', 'The model could not say what it would do.'))
      return box
    }
    const rows: [string, string][] = []
    const plan = this.plan()
    const near = plan && 'zone' in plan ? 'this zone' : 'near it'
    if (f.served) {
      rows.push([`Commute ${near} (${people(f.served.people)} people)`, `${minutes(f.served.before)} → ${minutes(f.served.after)}`])
    }
    if (f.through && f.through[0] > 0) {
      rows.push(['Through its junctions, evening peak', `${Math.round(f.through[0])} → ${Math.round(f.through[1])} km/h`])
    }
    if (f.servedDeaths) rows.push([`Road deaths a year ${near}`, `${f.servedDeaths[0]} → ${f.servedDeaths[1]}`])
    rows.push(['City’s average commute', `${minutes(f.before.commute)} → ${minutes(f.after.commute)}`])
    if (f.before.deaths !== undefined && f.after.deaths !== undefined) {
      rows.push(['Road deaths a year in the city', `${f.before.deaths} → ${f.after.deaths}`])
    }
    const table = element('dl')
    for (const [k, v] of rows) table.append(element('dt', '', k), element('dd', '', v))
    box.append(table)
    if (plan?.kind === 'road') {
      box.append(element('p', 'muted small', 'A new road draws more driving over the years, and some of this gain is lost.'))
    }
    box.append(element('p', 'muted small', 'The model’s estimate for next month’s city with it in place, against without.'))
    return box
  }

  /**
   * For a work that digs up roads (a metro line, a road, junction work): the choice to make them good afterwards, at
   * its price; without it the roads dug up come back poor (PRD UPK-12).
   */
  private makeGoodChoice(q: Quote): HTMLElement | null {
    const price = q.makeGood ?? this.goodPrice
    if (!price) return null
    const b = button('toggle make-good', `Make the roads good afterwards, ${crore(price)} ${this.makeGood ? 'included' : 'more'}`)
    b.setAttribute('aria-pressed', String(this.makeGood))
    b.addEventListener('click', () => {
      this.makeGood = !this.makeGood
      this.foreseen = null
      void this.requote()
      this.hooks.refresh()
    })
    const box = element('div', 'make-good-box')
    box.append(b, element('p', 'muted small', this.makeGood ? 'The roads dug up are resurfaced when the work is done.'
      : 'Without it, the roads dug up for the work come back poor.'))
    return box
  }

  /** The proposal in brief: size, cost and time, what it should do, whether it can be paid for, and Build it. */
  private summary(box: HTMLElement, game: Game, plan: Plan, q: Quote): HTMLElement {
    const parts: string[] = []
    if (plan.kind === 'metro' || plan.kind === 'busRoute') parts.push(`${q.stations.length} ${plan.kind === 'metro' ? 'stations' : 'stops'}`)
    if (q.length && plan.kind !== 'railService' && plan.kind !== 'oneWay') parts.push(km(q.length))
    parts.push(q.cost ? crore(q.cost) : 'no cost', q.months ? duration(q.months) : 'at once')
    box.append(element('p', 'small brief', parts.join(' · ')))
    const good = this.makeGoodChoice(q)
    if (good) box.append(good)
    const f = this.foreseen
    if (!f) box.append(element('p', 'muted small working', 'Working out what it would do…'))
    else if (f.unforeseen || (ROAD_KINDS.has(plan.kind) && f.after)) box.append(element('p', 'small brief', this.roadEffect(f)))
    else if (f.after && f.before) {
      const line = this.effectLine(f) || `Forecast: the city’s commute ${minutes(f.before.commute)} → ${minutes(f.after.commute)}.`
      box.append(element('p', 'small brief', line))
    }
    const short = q.cost - game.money
    const outcome = f?.outcome
    if (short > 0) {
      box.append(element('p', 'reason', `The city has ${crore(game.money)}. Borrowing ${crore(Math.ceil(short / 10_000) * 10_000)} would make it up.`))
    } else if (outcome && !outcome.ok) box.append(element('p', 'reason', outcome.reason))
    const go = button('commit', this.goText(plan, q))
    go.disabled = game.status !== 'playing' || short > 0 || (!!outcome && !outcome.ok)
    go.dataset.build = 'commit'
    go.addEventListener('click', () => void this.order(plan, q))
    const more = button('quiet', 'Details')
    more.dataset.build = 'details'
    more.addEventListener('click', () => {
      this.details = true
      this.low = false
      this.hooks.refresh()
    })
    const buttons = element('div', 'outlook-buttons')
    if (short > 0) {
      const levers = button('quiet', 'Borrow under Levers')
      levers.addEventListener('click', () => this.hooks.levers())
      buttons.append(levers, more)
    } else buttons.append(go, more)
    box.append(buttons)
    return box
  }

  /** "Build it for ₹120 crore", or for a policy, what it does: "Set the limit". */
  private goText(plan: Plan, q: Quote): string {
    const paid = q.cost ? ` for ${crore(q.cost)}` : ''
    switch (plan.kind) {
      case 'speedLimit':
        return plan.limit === null ? 'Take the limit away' : `Set the limit${paid}`
      case 'oneWay':
        return plan.on ? `Make it one-way${paid}` : 'Make it two-way'
      case 'density':
        return plan.on ? 'Allow taller building' : 'Stop taller building'
      case 'footpaths':
        return `Lay them${paid}`
      case 'junction':
        return `Do it${paid}`
      case 'repair':
        return plan.work === 'patch' ? `Patch it${paid}` : plan.work === 'resurface' ? `Resurface it${paid}` : `Lay concrete${paid}`
      case 'streets':
        return `${plan.work === 'patch' ? 'Patch' : 'Resurface'} the streets${paid}`
      default:
        return `Build it${paid}`
    }
  }

  private async order(plan: Plan, q: Quote): Promise<void> {
    const game = this.game
    if (!game) return
    const name = this.nameOf(plan, q, game)
    const out = await this.hooks.act({ kind: 'build', plan })
    signal(out.ok ? 'built' : 'refused')
    if (!out.ok) {
      announce(out.reason)
      this.foreseen = this.foreseen && { ...this.foreseen, outcome: out }
      this.hooks.refresh()
      return
    }
    const mended = plan.kind === 'repair' || plan.kind === 'streets'
    this.low = false
    this.choose(null)
    this.notice = mended && q.months === 0 ? `${name}: done this month. End the month to see what it does for the traffic.`
      : q.months === 0 ? `${name}: in force from this month.` : q.months <= 1
      ? `${name}: ordered. It opens next month.`
      : `${name}: work has begun. It opens in ${monthShort(game.month + q.months)}.`
    announce(this.notice)
    this.hooks.refresh()
  }
}

function pairsOf(flat: number[]): LngLat[] {
  return Array.from({ length: flat.length / 2 }, (_, i) => [flat[i * 2]!, flat[i * 2 + 1]!])
}

/** "score +12 a year on", for a line of forecast. */
function scoreWords(s: NonNullable<Foreseen['score']>): string {
  const d = s.after.total - s.before.total
  return d === 0 ? 'no measurable change to the score' : `score ${d > 0 ? '+' : '−'}${Math.abs(d)} a year on`
}
