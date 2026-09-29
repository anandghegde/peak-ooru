import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { Protocol } from 'pmtiles'
import { loadNetwork } from './data/network'
import { loadTransit } from './data/transit'
import { loadZoneOutlines, loadZones } from './data/zones'
import { addCityEdge, addEdgeFade } from './map/frame'
import { KannadaLabels } from './map/kannada'
import { City, type Month } from './game/city'
import { addRingRoads, NetworkLayer } from './map/network'
import { addPlaces, KNOWN_PLACES } from './map/places'
import { Playback } from './map/playback'
import { baseStyle, palette } from './map/style'
import { CongestionLayer } from './map/traffic'
import { ConditionLayer, ROAD_CREAM, SURFACE_COLOURS } from './map/condition'
import { addTransit, setTransit } from './map/transit'
import { BuildLayer, type DrawnLink } from './map/build'
import { projectLook } from './game/build'
import { ZoneLayer } from './map/zones'
import type { Network, Transit } from './data/types'
import type { Action, Entry, Game, GameEvent, Report } from './rules/types'
import type { Zone } from './data/types'
import { Bar, type Skip } from './ui/bar'
import { Build, type ZoneTools } from './ui/build'
import { introSeen, Lesson } from './ui/intro'
import { WhatNow } from './ui/first-advice'
import { arrivedAt, limitBuild, limitMoney, offered, played } from './ui/first-levers'
import { yours } from './ui/first-yours'
import { showDayEnd } from './ui/first-day'
import { showWelcome } from './ui/first-back'
import { drawLines } from './ui/lines'
import { showReview } from './ui/review'
import { drawBooks } from './ui/books'
import { announce, Controls, element, PERIOD_NAMES } from './ui/controls'
import { showEnding } from './ui/ending'
import { drawFigures } from './ui/figures'
import { drawScore, eventList, scoreLead } from './ui/score'
import { hideEventCard, showEventCard } from './ui/events'
import { EventLayer } from './map/events'
import { NEEDS_EYE, type MeasureView } from './game/score'
import { cityEdge } from './map/frame'
import type { CityPicture } from './ui/citymap'
import { RING } from './map/network'
import { monthShort } from './ui/format'
import { Levers } from './ui/levers'
import { Panel, type Tab } from './ui/panel'
import { drawReport, drawRoads, tripsLine, type ShownMend, type ShownRoad } from './ui/report'
import { GRADES, gradeOf, namedRun, roadKm, worstRoads } from './game/upkeep'
import { decimal, grouped } from './ui/format'
import type { Light, Questions, SurfaceOut } from './sim/worker'
import { SHADES, type ZoneView } from './map/zones'
import type { Period } from './sim/types'
import { JAM_SWATCHES } from './map/traffic'
import { firstSeason } from './seasons/first'
import { ApiError, Net, type BoardRow, type GameSummary, type Opened } from './net'
import { standInApi } from './net/standin'
import type { Done, Season } from './rules/types'
import { drawSeason, forgetSeasonPage, nameBox, rankWords, type SeasonHooks } from './ui/season'
import { drawTheirs } from './ui/theirs'
import { monthLong } from './ui/format'
import { installSound } from './sound'
import { signal } from './ui/signals'

/** The area the game covers, and where the view opens. */
export const CITY = {
  /** The edges of the base map's tiles. The view never goes past them. */
  bounds: [77.35, 12.75, 77.85, 13.2] as [number, number, number, number],
  /** The Greater Bengaluru Authority's area, which the first view fits. */
  area: [77.44, 12.83, 77.79, 13.14] as [number, number, number, number],
}

installSound()
// Any button pressed, anywhere on the page, is a tap: the sound and the introduction listen for it.
document.addEventListener('click', (e) => {
  if ((e.target as Element | null)?.closest?.('button')) signal('tap')
}, true)

// The library finds its worker beside itself, which bundling breaks; so it is built as a worker of its own.
maplibregl.setWorkerUrl(workerUrl)
maplibregl.addProtocol('pmtiles', new Protocol().tile)

const base = import.meta.env.BASE_URL
const map = new maplibregl.Map({
  container: 'map',
  style: baseStyle(
    new URL(`${base}tiles/bengaluru.pmtiles`, location.href).href,
    new URL(`${base}fonts/`, location.href).href,
    KNOWN_PLACES.map((p) => p.osm),
  ),
  bounds: CITY.area,
  minZoom: 9,
  maxZoom: 18,
  maxBounds: CITY.bounds,
  renderWorldCopies: false,
  attributionControl: false,
  dragRotate: false,
  pitchWithRotate: false,
  touchPitch: false,
  // Three pixels to the point, as on many phones, triples the drawing of two for little a reader can see.
  pixelRatio: Math.min(devicePixelRatio, 2),
  // Tiles kept for two zooms' worth of views rather than five: measured, this holds about 60 MB less in the page and
  // in the graphics process after panning, and costs a reload from the browser's cache when panning back.
  maxTileCacheZoomLevels: 2,
})
// The base style's road shields ask for images from a sprite it does not have. The accepted look shows the route
// numbers bare on the road, so each is given an empty image: the look stays as it is and nothing is missing.
map.setMissingStyleImageResolver(async (id) => {
  if (!map.hasImage(id)) map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) })
})
map.touchZoomRotate.disableRotation()
map.keyboard.disableRotation()

/** Loads a file, or gives null if it is not there yet, so the map still shows without it. */
async function optional<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load()
  } catch (error) {
    console.warn(String(error))
    return null
  }
}

const measure = import.meta.env.DEV || new URLSearchParams(location.search).has('measure')
const data = Promise.all([optional(loadTransit), optional(() => Promise.all([loadZones(), loadZoneOutlines()]))])
// The worker starts loading the city's data for the traffic at once, alongside the map.
// `?standin` (when measuring) draws made-up traffic instead of the model's, to judge the map apart from the model.
const city = new City(base, measure && new URLSearchParams(location.search).has('standin'))
/** Fewer vehicles on a small screen, where the processor is slower and there is less room for them. */
const phone = matchMedia('(max-width: 600px)').matches
const params = new URLSearchParams(location.search)
/** A shared link to a player's city (`/?city=<game id>`, MP-14): opened to look round once the page has begun. */
const cityLink = params.get('city')
if (cityLink) {
  params.delete('city')
  history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`)
}

/*
 * The server (docs/API.md). `?standin-server` (when measuring) has the page answer as the server would, with a made-up
 * crowd on the board (`&crowd=`) and the daily allowance on or off (`&allowance=on`).
 */
const standInServer = measure && params.has('standin-server')
const net = new Net(import.meta.env.VITE_API ?? '/api', firstSeason, {
  checked: (game, _month, summary, same) => checked(game, summary, same),
  refused: (game, month, error) => later(() => void refused(game, month, error)),
  apart: (game) => later(() => void resync(game)),
  changed: () => showNet(),
}, standInServer ? standInApi({
  storage: 'peakooru.standin-server',
  season: { ...firstSeason, allowance: params.get('allowance') === 'on' },
  rules: 0,
  crowd: Number(params.get('crowd') ?? 300),
  scoreOf: (id) => id === own.game && play.game?.score
    ? { score: play.game.score.total, points: (['access', 'commute', 'clean', 'safety', 'fairness', 'money', 'approval'] as const).map((k) => play.game!.score!.measures.find((m) => m.key === k)?.points ?? 0) }
    : null,
}) : undefined)

void city.loaded.then(() => (net.server.rules = city.rules), () => null)

/** The player's own game: its id, whether the server's figures differed, and whether sending is held while a month is undone. */
const own = { game: null as string | null, diverged: false, hold: false, endingShown: null as string | null, differed: 0 }
/** Another player's city, while it is looked round: whose, and what they did. */
let viewing: { name: string; done: Done[] } | null = null
/** What the server said while another player's city was shown, done on coming back. */
const afterView: (() => void)[] = []
const later = (run: () => void) => (viewing ? afterView.push(run) : run())
/** Resolves once no month is being worked out. */
async function idle(): Promise<void> {
  while (play.busy) await new Promise((r) => setTimeout(r, 100))
}
let zoneList: Zone[] = []
const zoneName = (id: number) => zoneList[id]?.name ?? `zone ${id}`

/** The game as the page holds it: the worker's last answer, and what the screen is doing with it. */
const play = {
  game: null as Game | null,
  times: [] as number[],
  /** The report shown on the Report page: the last month's, or the last skip's. */
  report: null as Report | null,
  notice: null as string | null,
  /** Trips by mode over the span of the report shown. */
  trips: null as string | null,
  month: null as Month | null,
  /** The traffic of the last month ended, from which the next report's trips are measured. */
  ended: null as Light | null,
  /** The traffic at the start of the span the report shown covers, and at its end. */
  spanTraffic: null as { before: Light | null; now: Light | null } | null,
  busy: false,
  stop: false,
  books: null as { stamp: string; now: Entry[]; ahead: { month: number; money: number }[] } | null,
  ending: null as HTMLElement | null,
  /** The state of the roads as last asked for, and the game it was asked for. */
  surface: null as SurfaceOut | null,
  surfaceStamp: '',
  /** The worst roads and the roads mended, for the report shown. */
  roads: { worst: [] as ShownRoad[], mended: [] as ShownMend[] },
}
const stamp = (g: Game) => `${g.month}:${g.done.length}`

const bar = new Bar({
  onScore: () => (panel.tab === 'score' ? panel.close() : panel.open('score')),
  onNext: () => void next(),
  onSkip: (s) => void skip(s),
  onStop: () => {
    play.stop = true
    bar.busy('Stopping after this month…')
  },
  onBack: () => void backToMine(),
})
bar.busy('Loading the city…')
/** "What could I do now?": three things the player can afford now that should raise the score most. */
const whatNow = new WhatNow({
  game: () => (viewing ? null : play.game),
  advise: () => city.ask('advise', { levers: play.game ? (offered(play.game.month) ?? undefined) : undefined }),
  forecast: (action) => city.ask('forecast', { action }),
  act: async (action) => {
    const out = await act(action)
    signal(out.ok ? 'built' : 'refused')
    if (panel.tab) panel.refresh(panel.tab)
    return out
  },
  show: (advice) => {
    whatNow.close()
    if (phone) panel.close()
    if (advice.links?.length) {
      void city.ask('links', { ids: advice.links }).then((links) => buildLayer?.showRepair([], links.map((l) => ({ id: l.id, drawn: l.drawn, lanes: 0 }))))
      void frameLinks(advice.links)
    } else if (advice.zone !== undefined) {
      pick?.(advice.zone)
      const z = zoneList[advice.zone]
      if (z) map.easeTo({ center: z.centre, zoom: Math.max(map.getZoom(), 12.5), duration: 600 })
    } else if (advice.at) map.easeTo({ center: advice.at, zoom: Math.max(map.getZoom(), 13), duration: 600 })
  },
  open: (advice) => {
    const a = advice.actions[0]
    if (a?.kind !== 'build') return false
    panel.open('build')
    return build.begin(a.plan)
  },
  top: () => document.querySelector('.bar')?.getBoundingClientRect().bottom ?? 60,
})
bar.beside(whatNow.button)
const levers = new Levers({
  may: (actions) => city.ask('may', { actions }),
  forecast: (action) => city.ask('forecast', { action }),
  act: (action) => act(action),
})
let controls: Controls | null = null
let transit: Transit | null = null
let buildLayer: BuildLayer | null = null
let zoneTools: ZoneTools | null = null
let networkData: Network | null = null
let conditionLayer: ConditionLayer | null = null
/** The view the map had before an upkeep tool showed the road condition, to give back after. */
let viewBefore: { view: ZoneView; period: Period | null } | null = null

/** Asks for the state of the roads, once for each state of the game, and paints it on the map. */
async function loadSurface(): Promise<SurfaceOut | null> {
  const game = play.game
  if (!game) return null
  const asked = stamp(game)
  if (play.surface && play.surfaceStamp === asked) return play.surface
  const out = await city.ask('surface', {})
  if (play.game && stamp(play.game) !== asked) return out
  play.surface = out
  play.surfaceStamp = asked
  conditionLayer?.paint(out.stretch)
  zoneLayer?.setStreets(out.streets)
  return out
}

const build = new Build(map, phone, {
  ask: (type, question) => city.ask(type, question),
  act: (action) => act(action),
  refresh: () => panel.refresh('build'),
  levers: () => {
    moneyView = 'levers'
    panel.open('money')
  },
  placing: () => markPlacing(),
  cover,
  get zones() {
    return zoneTools
  },
  month: () => play.month?.result ?? null,
  surface: () => loadSurface(),
  network: () => networkData,
  roadView: (on) => {
    const c = controls
    if (!c) return
    if (on) {
      viewBefore ??= { view: c.shading, period: c.period }
      c.setView('roads')
    } else if (viewBefore) {
      const back = viewBefore
      viewBefore = null
      c.setView(back.view === 'roads' ? 'plain' : back.view)
      if (back.period) c.setPeriod(back.period)
    }
  },
})
map.on('moveend', () => build.moved())
/** Taps on the map go to building while a tool that places is chosen and its page is open. */
const placing = () => build.placing && panel.tab === 'build'
let wasPlacing = false
function markPlacing(): void {
  document.body.classList.toggle('placing', placing())
  // The zone card closes as placing begins; the zone a tool has chosen stays outlined while its page is drawn again.
  if (placing() && !wasPlacing) pick?.(null)
  // A tool's shading of the zones goes with its page, and comes back with it.
  if (placing() !== wasPlacing) {
    if (placing()) build.shadeZones()
    else zoneTools?.highlight(null)
  }
  wasPlacing = placing()
}

/** What the page's cards cover of the map at each side, in pixels, so that a plan is framed in what shows. */
function cover(): { top: number; bottom: number; left: number; right: number } {
  const bar = document.querySelector('.bar')?.getBoundingClientRect()
  const open = panel.tab ? panel.root.getBoundingClientRect() : null
  const top = bar ? bar.bottom : 0
  if (phone) return { top, bottom: open ? innerHeight - open.top : 60, left: 0, right: 0 }
  const right = document.querySelector('.controls')?.getBoundingClientRect()
  return { top, bottom: 0, left: open ? open.right : 0, right: right ? innerWidth - right.left : 0 }
}
const panel = new Panel(drawTab, () => updateChip())
// On a phone, the pages' tabs and the turn's buttons share a dock along the bottom, and the map's controls live in
// the City page; on a laptop the tabs head the panel and the turn sits in the top bar.
// A key, not a control: too small a target for a finger, and the City page is a tap away in the dock.
const chip = element('div', 'chip')
chip.hidden = true
if (phone) {
  const dock = element('nav', 'dock')
  dock.append(panel.tabs, bar.turn)
  document.body.append(dock, chip)
} else panel.root.prepend(panel.tabs)

/** On a phone with traffic shown and no page open, a small key above the dock says which part of the day it is. */
function updateChip(): void {
  const period = controls?.period
  const roads = controls?.shading === 'roads'
  const fair = controls?.shading === 'fairness'
  chip.hidden = !phone || (!period && !roads && !fair) || !!panel.tab
  if (!chip.hidden && fair && !period) {
    const item = element('span', 'item')
    const swatch = element('i', 'box')
    swatch.style.background = SHADES[4]!
    item.append(swatch, 'Worst-served fifth of zones')
    chip.replaceChildren(item)
    return
  }
  if (!chip.hidden && roads) {
    chip.replaceChildren(
      element('span', '', 'Roads'),
      ...([['Fair', SURFACE_COLOURS.fair], ['Poor', SURFACE_COLOURS.poor], ['Broken', SURFACE_COLOURS.broken]] as const).map(([name, colour]) => {
        const item = element('span', 'item')
        const swatch = element('i')
        swatch.style.background = name === 'Broken'
          ? `repeating-linear-gradient(90deg, ${colour} 0 5px, ${ROAD_CREAM} 5px 8px)` : colour
        item.append(swatch, name)
        return item
      }),
    )
    return
  }
  if (chip.hidden || !period) return
  chip.replaceChildren(
    element('span', '', PERIOD_NAMES[period]),
    ...['Slow', 'Very slow', 'Jammed'].map((name, i) => {
      const item = element('span', 'item')
      const swatch = element('i')
      swatch.style.background = JAM_SWATCHES[i]!
      item.append(swatch, name)
      return item
    }),
  )
}

/** Which half of the Money page is open: the levers that raise and spend it, or the books. */
let moneyView: 'levers' | 'books' = 'levers'

/** What the season's page needs: the server, the zones, and ways to switch games and look round cities. */
const seasonHooks: SeasonHooks = {
  net,
  zones: () => zoneList.filter((z) => z.ward),
  playing: () => playing(),
  play: (g) => void switchTo(g),
  practice: () => void practice(),
  restart: () => void restart(),
  look: (row) => void look(row),
  redraw: () => panel.refresh('board'),
  signedIn: () => void rejoin(),
  howToPlay: () => startIntro(),
}

/** What the score page needs from the map and the pages. */
const scoreHooks = {
  view: (view: MeasureView) => {
    if (phone) panel.close()
    controls?.setView(view)
  },
  canView: (view: MeasureView) => controls?.canShow(view) ?? false,
  money: () => panel.open('money'),
  showEvent: (e: GameEvent) => showEvent(e),
}

function drawTab(tab: Tab, body: HTMLElement): void {
  if (phone) pick?.(null)
  updateChip()
  markPlacing()
  const game = play.game
  if (tab === 'board') drawSeason(body, seasonHooks)
  else if (tab === 'report' && viewing) {
    panel.root.querySelector('.panel-head h2')!.textContent = `What ${viewing.name} did`
    drawTheirs(body, viewing.name, viewing.done, zoneName)
  } else if (tab === 'build') {
    if (game) {
      build.draw(body, game)
      if (!build.tool && !viewing) limitBuild(body, game.month, () => panel.refresh('build'))
    } else body.append(element('p', 'muted', 'Loading the game…'))
  } else if (tab === 'report') {
    const head: HTMLElement[] = []
    const arrived = game && play.report ? arrivedAt(game.month) : null
    if (arrived) head.push(element('p', 'arrived', arrived))
    const own = game && play.report
      ? yours({ report: play.report, game, mended: play.roads.mended, before: play.spanTraffic?.before ?? null, now: play.spanTraffic?.now ?? null })
      : null
    if (own) head.push(own)
    drawReport(body, play.report, play.notice, play.trips, scoreLead, (events) => eventList(events, play.game?.month ?? 0, showEvent), head,
      own ? (game?.built?.lines ?? []).map((l) => l.name) : [])
    // The roads mended lead the report, with the rest of what the player did; the worst roads follow the figures.
    if (play.report) drawRoads(body, play.roads.worst, own ? [] : play.roads.mended, roadHooks)
  }
  else if (!game) body.append(element('p', 'muted', 'Loading the game…'))
  else if (tab === 'score') {
    if (viewing) {
      panel.root.querySelector('.panel-head h2')!.textContent = `${viewing.name}’s score`
      body.append(element('p', 'small their-note', `This is ${viewing.name === 'Another player' ? 'another player' : viewing.name}’s city as they left it. You can look round it, not change it.`))
    }
    drawScore(body, game, play.report, scoreHooks)
    if (game.status !== 'playing' && !viewing) {
      const again = element('button', 'quiet', 'See the ending again')
      again.type = 'button'
      again.addEventListener('click', () => {
        play.ending?.remove()
        play.ending = ending(game)
      })
      body.append(again)
    }
    // On a phone the map's views live here, beside the measures they show.
    if (phone && controls) {
      body.append(element('h3', '', 'The map'))
      body.append(controls.root)
    }
    body.append(element('h3', '', 'This month in figures'))
    if (play.month) drawFigures(body, play.month.result, play.month.view, transit, !!city.stand?.model)
    else body.append(element('p', 'muted small', 'Working out the month…'))
    const again = element('button', 'quiet', 'How to play')
    again.type = 'button'
    again.addEventListener('click', () => startIntro())
    if (!viewing) body.append(again)
  } else if (tab === 'money') {
    const seg = element('div', 'segments money-tabs')
    seg.setAttribute('role', 'group')
    seg.setAttribute('aria-label', 'Money')
    for (const [view, label] of [['levers', 'Tax, fares, loans'], ['books', 'The books']] as const) {
      const b = element('button', '', label)
      b.type = 'button'
      b.dataset.money = view
      b.setAttribute('aria-pressed', String(moneyView === view))
      b.addEventListener('click', () => {
        moneyView = view
        panel.refresh('money')
      })
      seg.append(b)
    }
    body.append(seg)
    if (moneyView === 'levers') {
      const box = element('div')
      body.append(box)
      levers.draw(box, game)
      if (!viewing) limitMoney(body, game.month, game.loans.length, () => panel.refresh('money'))
      const lines = element('div', 'your-lines-box')
      body.append(lines)
      drawLines(lines, game, play.month?.result ?? null, act, () => panel.refresh('money'))
    } else {
      const books = play.books?.stamp === stamp(game) ? play.books : null
      drawBooks(body, game, books?.now ?? null, books?.ahead ?? null, () => void restart(true))
      if (!books) {
        const asked = stamp(game)
        void city.ask('books', {}).then(({ now, ahead }) => {
          play.books = { stamp: asked, now, ahead }
          if (play.game && stamp(play.game) === asked) panel.refresh('money')
        })
      }
    }
  }
}

/** Draws the works under way and the bus lanes on the map, asking the worker for the roads they are on. */
const drawnLinks = new Map<number, DrawnLink>()
async function drawWorks(game: Game): Promise<void> {
  const layer = buildLayer
  if (!layer) return
  const projects = game.projects ?? []
  const disrupted = projects
    .filter((p) => game.month < p.started + Math.ceil((p.opens - p.started) / 2))
    .flatMap((p) => p.quote.disrupted)
  const lanes = game.built?.busLanes ?? []
  const missing = [...new Set([...disrupted, ...lanes])].filter((id) => !drawnLinks.has(id))
  if (missing.length) for (const l of await city.ask('links', { ids: missing })) drawnLinks.set(l.id, l)
  const known = (ids: number[]) => ids.map((id) => drawnLinks.get(id)).filter((l): l is DrawnLink => !!l)
  // Works drawn along their course: lines and roads dashed, and a junction's work as a point of its own.
  layer.showWorks(projects.filter((p) => p.quote.path.length >= 4)
    .map((p) => ({ path: p.quote.path, colour: projectLook(game, p.plan, p.name).colour })), known(disrupted))
  layer.showBusLanes(known(lanes))
  const built = game.built
  const worked = built?.junctions?.length
    ? (await city.ask('nodes', {})).filter((j) => j.work).map((j) => j.at)
    : []
  const tracks = [...(transit?.lines ?? []), ...(built?.lines ?? [])].filter((l) => l.kind !== 'bus').map((l) => l.path)
  layer.showBuilt((built?.roads ?? []).map((r) => ({ path: r.path, lanes: r.lanes, flyover: r.flyover, name: r.name })), worked, tracks)
  const safer = [...(built?.footpaths ?? []), ...(built?.limits ?? []).map((l) => l.zone)]
  zoneLayer?.setMarks(safer, built?.dense ?? [])
  controls?.setMarks(safer.length > 0, (built?.dense?.length ?? 0) > 0)
}
let zoneLayer: ZoneLayer | null = null

/** Takes the game as the worker now has it. */
function apply(seen: { game: Game; times: number[]; transit?: Transit }): void {
  play.game = seen.game
  play.times = seen.times
  if (!viewing) played(seen.game.month)
  bar.show(seen.game, seen.times)
  if (seen.transit) {
    transit = seen.transit
    build.setTransit(transit)
    if (map.getSource('transit-lines')) setTransit(map, transit)
  }
  build.update(seen.game)
  void drawWorks(seen.game)
  if (conditionLayer) void loadSurface()
  if (panel.tab === 'money' || panel.tab === 'build' || panel.tab === 'score') panel.refresh(panel.tab)
  void drawEvents(seen.game)
  if (seen.game.status !== 'playing' && !play.ending && !viewing && own.endingShown !== own.game) {
    own.endingShown = own.game
    play.ending = ending(seen.game)
    signal('ended', { status: seen.game.status })
  }
}

/** The ending, with what the player did and a picture of their city. */
function ending(game: Game): HTMLElement {
  hideEventCard()
  // The map behind is framed on the city, and the picture's lakes are taken from its tiles once they have loaded.
  map.fitBounds(CITY.area, { duration: 0 })
  const drawn = new Promise<CityPicture | null>((resolve) => {
    let done = false
    const draw = () => {
      if (done) return
      done = true
      void picture(game).then(resolve, () => resolve(null))
    }
    map.once('idle', draw)
    setTimeout(draw, 4000)
  })
  const s = net.summary
  return showEnding(game, {
    share: shareOf(own.game),
    restart: () => void restart(),
    again: s && s.ranked && !s.restarted && !net.isHere(s.id) ? 'Start again' : 'Play a practice game',
    rank: (into) => void fillRank(into),
    board: () => panel.open('board'),
    deeds: city.ask('deeds', {}),
    picture: drawn,
  })
}

/**
 * What the share picture needs (MP-14): for the player's own ranked game on the server, its id, the player's name, the
 * rank, and a way to send the picture once the server has the last month; for a practice game or one kept only here,
 * the name alone.
 */
async function shareOf(game: string | null): Promise<{ id: string | null; name: string | null; rank: { rank: number; total: number } | null; upload?: (png: Blob) => Promise<void> }> {
  const name = net.session.player?.name ?? null
  const s = net.summary
  const info = net.session.season
  if (!game || net.isHere(game) || !s || s.id !== game || !s.ranked || !info) return { id: null, name, rank: null }
  await sent(game)
  const board = await net.server.board(info.id, 'all', 0, 1).catch(() => null)
  const rank = board?.mine ? { rank: board.mine.rank, total: board.total } : null
  const upload = net.server.picture ? async (png: Blob) => {
    await sent(game)
    await net.server.picture!(game, png)
  } : undefined
  return { id: game, name, rank, upload }
}

/** Resolves once the server has acknowledged every month of a game. */
function sent(game: string): Promise<void> {
  return new Promise((resolve) => {
    const check = () => (net.outbox.pending(game).length ? setTimeout(check, 500) : resolve())
    check()
  })
}

/** The rank on the season's board, in the ending's box: once the server has the last months, and once there is a name. */
async function fillRank(into: HTMLElement): Promise<void> {
  const s = net.summary
  const info = net.session.season
  if (!s || !s.ranked || net.isHere(s.id) || !info) {
    into.textContent = 'A practice game: it has no rank.'
    return
  }
  into.textContent = 'Rank: waiting for the server to check your last months…'
  await sent(s.id)
  if (!net.session.player?.name) {
    into.classList.add('asking')
    into.replaceChildren(nameBox(net, 'Choose a name to take your place on the board.', () => {
      into.classList.remove('asking')
      void fillRank(into)
    }))
    return
  }
  try {
    const board = await net.server.board(info.id, 'all', 0, 1)
    into.classList.toggle('filled', !!board.mine)
    into.textContent = board.mine ? `Rank: ${rankWords(board.mine, board.total)}` : 'Rank: not on the board yet'
  } catch {
    into.textContent = 'Rank: the board cannot be reached just now'
  }
}

/** The larger lakes in the city, from the base map's tiles as loaded: outer rings, as lng, lat. */
function lakes(): [number, number][][] {
  const out: [number, number][][] = []
  const [w, s, e, n] = CITY.area
  for (const f of map.querySourceFeatures('protomaps', { sourceLayer: 'water' })) {
    const g = f.geometry
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
    for (const poly of polys) {
      const ring = poly[0] as [number, number][] | undefined
      if (!ring || ring.length < 4) continue
      const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1])
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
      // Lakes big enough to see at the picture's size, inside the city's frame.
      if (x1 - x0 < 0.004 && y1 - y0 < 0.004) continue
      if (x1 < w || x0 > e || y1 < s || y0 > n) continue
      out.push(ring)
    }
  }
  return out
}

/** What the ending's picture of the city is drawn from: the boundary, the ring roads, the metro, what was built. */
let edgeRings: [number, number][][] = []
async function picture(game: Game): Promise<CityPicture | null> {
  if (!edgeRings.length) return null
  // Roads resurfaced or laid in concrete, drawn in the concrete's grey.
  const ids = new Set<number>()
  for (const { action } of game.done) {
    if (action.kind === 'build' && action.plan.kind === 'repair' && action.plan.work !== 'patch') for (const id of action.plan.links) ids.add(id)
  }
  const links = ids.size ? await city.ask('links', { ids: [...ids] }).catch(() => []) : []
  const mended = networkData ? links.flatMap((l) => l.drawn.map((d) => networkData!.links[d]?.line ?? [])) : []
  const rings = networkData ? networkData.links.filter((l) => l.name && RING.test(l.name)).map((l) => l.line) : []
  const mine = new Set((game.built?.lines ?? []).map((l) => l.id))
  const lines = [...(transit?.lines ?? []), ...(game.built?.lines ?? []).filter((l) => !(transit?.lines ?? []).some((t) => t.id === l.id))]
    .filter((l) => l.kind !== 'rail' || mine.has(l.id))
    .map((l) => ({ path: l.path, colour: l.colour, mine: mine.has(l.id), dashed: l.status !== 'open' }))
  // The player's lines still being built, dashed in their own colours.
  for (const p of game.projects ?? []) {
    if ((p.plan.kind === 'metro' || p.plan.kind === 'busRoute') && p.quote.path.length >= 4) {
      lines.push({ path: p.quote.path, colour: projectLook(game, p.plan, p.name).colour, mine: true, dashed: true })
    }
  }
  return { edge: edgeRings, rings, lines, roads: (game.built?.roads ?? []).map((r) => r.path), water: lakes(), mended }
}

/** Events in force on the map: a pin at each place, and the roads they shut drawn shut. */
let eventLayer: EventLayer | null = null
let eventsDrawn = ''
async function drawEvents(game: Game): Promise<void> {
  const layer = eventLayer
  if (!layer) return
  const events = game.events ?? []
  const key = events.map((e) => e.id).join()
  if (key === eventsDrawn) return
  eventsDrawn = key
  const ids = events.flatMap((e) => e.links ?? [])
  const links = ids.length ? await city.ask('links', { ids }) : []
  const shut = links.flatMap((l) => (l.drawn.length && networkData ? l.drawn.map((d) => networkData!.links[d]?.line ?? []) : l.ends ? [l.ends] : []))
  layer.show(events, shut)
}

/**
 * "Why is this bad?" for a zone (PRD SCORE-14): its commute, jobs in reach and road deaths against the city's,
 * whether it is among the worst served, and the roads its commuters lose most time on, which it marks on the map.
 */
async function whyZone(zone: Zone, into: HTMLElement): Promise<void> {
  const w = await city.ask('whyZone', { zone: zone.id })
  const lines: string[] = []
  const vs = (a: number, b: number, worse: boolean) => (Math.abs(a - b) / Math.max(1e-9, b) < 0.05 ? 'about the same as' : worse ? 'worse than' : 'better than')
  lines.push(`Commute ${decimal(w.commute / 60)} min: ${vs(w.commute, w.city.commute, w.commute > w.city.commute)} the city’s ${decimal(w.city.commute / 60)}.`)
  lines.push(`Jobs within 45 minutes ${decimal(w.access)}%: ${vs(w.access, w.city.access, w.access < w.city.access)} the city’s ${decimal(w.city.access)}%.`)
  // A zone the model counts no deaths in says nothing either way, and is left out.
  if (w.deaths !== null && w.city.deaths !== null && w.deaths > 0) {
    lines.push(`Road deaths ${decimal(w.deaths)} a year per lakh people: ${vs(w.deaths, w.city.deaths, w.deaths > w.city.deaths)} the city’s ${decimal(w.city.deaths)}.`)
  }
  if (w.worst) lines.push('Among the worst-served fifth of zones, which the score’s fairness measure counts.')
  const parts: HTMLElement[] = lines.map((l) => element('p', 'small', l))
  if (w.roads.length) {
    // One line for each road, by name: a road's two directions and its stretches are one.
    const named = new Map<string, number>()
    for (const r of w.roads) {
      const name = nameOfLinks([{ drawn: r.drawn }])
      named.set(name, (named.get(name) ?? 0) + r.share)
    }
    const top = [...named].sort((a, b) => b[1] - a[1]).slice(0, 3)
    parts.push(element('p', 'small', `Its commuters lose most time in the morning on ${top.map(([n, share]) => `${n} (${Math.round(share * 100)}%)`).join(', ')}.`))
    const mark = element('button', 'quiet', 'Show these roads')
    mark.type = 'button'
    mark.addEventListener('click', () => {
      buildLayer?.showRepair([], w.roads.map((r) => ({ id: r.link, drawn: r.drawn, lanes: 0 })))
      void frameLinks(w.roads.map((r) => r.link))
    })
    parts.push(mark)
  }
  into.replaceChildren(...parts)
}

/** Frames an event's place, and its roads, in what shows of the map. */
function showEvent(e: GameEvent): void {
  if (phone) panel.close()
  if (e.links?.length) void frameLinks(e.links)
  else if (e.at) map.easeTo({ center: e.at, zoom: Math.max(map.getZoom(), 13), duration: 600 })
}

/** The card for the events that need the player, as a report brings them: the first that began, once. */
function tellEvents(report: Report | null): void {
  const began = (report?.events ?? []).filter((e) => NEEDS_EYE.has(e.kind) && e.ends >= (play.game?.month ?? 0) && e.started > report!.to - 1)
  const first = began[0]
  if (first) showEventCard(first, showEvent)
}

let showMonth: (month: Month) => void = (month) => (play.month = month)
let pick: ((id: number | null) => void) | null = null

/** Works out the month as it stands and shows it on the map. */
async function refreshMonth(): Promise<number> {
  const asked = performance.now()
  showMonth(await city.work())
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  return performance.now() - asked
}

async function next(): Promise<void> {
  if (play.busy || !play.game || play.game.status !== 'playing' || viewing || allowLeft() === 0) return
  play.busy = true
  bar.busy(`Working out ${monthShort(play.game.month)}…`)
  try {
    const asked = performance.now()
    const before = play.ended
    const out = await city.ask('end', {})
    ended(out, asked)
    bar.busy('Working out why…')
    await report(before)
    if (out.game.status === 'playing') panel.open('report')
  } catch (error) {
    console.warn(String(error))
    play.notice = `The month could not be worked out: ${String(error)}`
    panel.open('report')
  } finally {
    play.busy = false
    bar.busy(null)
    if (play.game) bar.show(play.game, play.times)
    maybeReload()
    checkDay()
  }
}

/** Shows a month just ended, and sends it to the server: the game, and its traffic on the map. */
function ended(out: Questions['end'][1], asked: number): void {
  const was = play.game
  // What the Build page said of the month's orders belongs to that month.
  build.notice = null
  apply(out)
  if (!viewing) {
    const change = (out.game.score?.total ?? 0) - (was?.score?.total ?? out.game.score?.total ?? 0)
    signal('month', { change })
    // Said for a screen reader: the month ended, and where the score went.
    const score = out.game.score?.total
    announce(`${monthLong(out.report.to)} ended.${score === undefined ? '' : ` Score ${score}${change ? `, ${change > 0 ? 'up' : 'down'} ${Math.abs(change)}` : ', no change'}.`}`)
    // Something of the player's that was under way and is no longer: it has opened.
    const now = new Set((out.game.projects ?? []).map((p) => p.id))
    if ((was?.projects ?? []).some((p) => !now.has(p.id))) signal('opened')
  }
  showMonth({ result: out.result, view: out.view, waited: performance.now() - asked })
  play.ended = out.result
  if (!viewing && own.game && !own.hold) net.outbox.add({ game: own.game, ...out.sent })
  showNet()
}

/** Going to a road the report names: shown in the road condition view, or chosen to mend. */
const roadHooks = {
  show: (road: ShownRoad) => {
    if (phone) panel.close()
    controls?.setView('roads')
    void frameLinks(road.links)
  },
  mend: (road: ShownRoad) => {
    panel.open('build')
    const name = road.name.split(',')[0]!
    if (!phone) return build.mendRoad(road.links, 'patch', name)
    // On a phone the sheet covers the lower map, and a road that runs to the map's edge cannot be panned above it: the
    // road is framed at its part nearest the middle of the city, where the map can be moved to show it.
    void city.ask('links', { ids: road.links }).then((links) => {
      let near: [number, number] | null = null
      let best = Infinity
      for (const l of links) {
        if (!l.ends) continue
        const at: [number, number] = [(l.ends[0]! + l.ends[2]!) / 2, (l.ends[1]! + l.ends[3]!) / 2]
        const d = Math.hypot(at[0] - 77.5946, at[1] - 12.9716)
        if (d < best) {
          best = d
          near = at
        }
      }
      build.mendRoad(road.links, 'patch', name, near)
    })
  },
}

/** Frames some routing links in what shows of the map. */
async function frameLinks(ids: number[]): Promise<void> {
  const links = await city.ask('links', { ids })
  const pts = links.flatMap((l) => (l.ends ? [[l.ends[0]!, l.ends[1]!], [l.ends[2]!, l.ends[3]!]] : [])) as [number, number][]
  if (!pts.length) return
  const c = cover()
  const w = Math.min(...pts.map((p) => p[0])), e = Math.max(...pts.map((p) => p[0]))
  const so = Math.min(...pts.map((p) => p[1])), n = Math.max(...pts.map((p) => p[1]))
  map.fitBounds([w, so, e, n], { padding: { top: c.top + 40, bottom: c.bottom + 40, left: c.left + 40, right: c.right + 40 }, maxZoom: 15, duration: 600 })
}

/** The name of the road some routing links stand for, from the drawn network: the name that covers most of them. */
function nameOfLinks(links: { drawn: number[] }[]): string {
  const by = new Map<string, number>()
  for (const l of links) {
    for (const d of l.drawn) {
      const s = networkData?.links[d]
      if (s?.name) by.set(s.name, (by.get(s.name) ?? 0) + s.length)
    }
  }
  return [...by].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'A road without a name'
}

/** The worst roads and the roads mended in a report, named for the player. */
async function roadsOf(r: NonNullable<Questions['report'][1]>): Promise<typeof play.roads> {
  const mended: ShownMend[] = []
  for (const m of r.mended ?? []) {
    const links = await city.ask('links', { ids: m.links })
    mended.push({ name: nameOfLinks(links), work: m.work, kmh: m.kmh, condition: m.condition })
  }
  let worst: ShownRoad[] = []
  if (r.worstRoads?.length) {
    // The rules' own list, where they give one.
    for (const w of r.worstRoads) {
      const links = await city.ask('links', { ids: w.links })
      worst.push({
        name: w.name, condition: w.condition, hours: w.hours, links: w.links,
        km: roadKm(links.map((l) => ({ drawn: l.drawn, length: l.length ?? 0 })), networkData),
      })
    }
  } else if (r.delays?.length && networkData) {
    const delays = r.delays
    worst = worstRoads(networkData, delays).map((w) => {
      const own = delays.filter((d) => w.links.includes(d.id))
      const m = own.reduce((sum, d) => sum + d.length, 0)
      return { name: w.name, km: w.km, hours: w.hours, links: w.links, condition: m ? own.reduce((sum, d) => sum + d.length * d.condition, 0) / m : 0 }
    })
  }
  return { worst, mended }
}

/** Asks for the report of the months ended since the last, with its causes, and keeps it for the Report page. */
async function report(before: Light | null): Promise<void> {
  const r = await city.ask('report', {})
  play.report = r ?? play.report
  if (r) play.roads = await roadsOf(r).catch(() => ({ worst: [], mended: [] }))
  if (r && play.game?.status === 'playing') showReview(r, play.game)
  if (r && play.game?.status === 'playing') tellEvents(r)
  play.notice = null
  play.trips = before && play.ended ? tripsLine(before, play.ended) : null
  play.spanTraffic = { before, now: play.ended }
}

/** Ends months one after another, showing each as it lands, until the skip is done, stopped, or something needs the player. */
async function skip(kind: Skip): Promise<void> {
  if (play.busy || !play.game || play.game.status !== 'playing') return
  play.busy = true
  play.stop = false
  const game = play.game
  const left = allowLeft()
  const months = Math.min(kind === 'needs' ? game.season.months - game.month : Math.min(kind, game.season.months - game.month), left ?? Infinity)
  const before = play.ended
  let ends = 0
  // The months are seen passing on the map: its traffic at the evening peak, recoloured as each month lands.
  if (phone) panel.close()
  if (controls && !controls.period) controls.setPeriod('evening')
  try {
    for (let i = 0; i < months && !play.stop && allowLeft() !== 0; i++) {
      bar.busy(kind === 'needs' ? 'Skipping ahead…' : `Skipping, ${i + 1} of ${months}…`, true)
      const asked = performance.now()
      const out = await city.ask('end', {})
      ended(out, asked)
      ends++
      if (out.game.status !== 'playing' || out.report.needs.length) break
      if (!play.stop) bar.busy(null)
    }
  } catch (error) {
    console.warn(String(error))
    play.notice = `A month could not be worked out: ${String(error)}`
  } finally {
    if (ends) {
      bar.busy('Working out why…')
      await report(before).catch((error) => console.warn(String(error)))
    }
    play.busy = false
    bar.busy(null)
    if (play.game) bar.show(play.game, play.times)
    if (play.game?.status === 'playing') panel.open('report')
    maybeReload()
    checkDay()
  }
}

async function act(action: Action) {
  const was = play.game?.score?.total
  const out = await city.ask('act', { action })
  if (out.outcome.ok) {
    apply(out)
    const now = out.game.score?.total
    if (now !== undefined && was !== undefined && now !== was) announce(`Score ${now}, ${now > was ? 'up' : 'down'} ${Math.abs(now - was)}.`)
    await refreshMonth()
  }
  return out.outcome
}

/** The season a game is played in: the server's current season, or the one built in for a game kept here. */
function seasonFor(game: string | null): Season {
  if (net.isHere(game)) return { ...firstSeason, allowance: false }
  return net.session.season?.season ?? firstSeason
}

/** The game's summary as the server last gave it, with the month and score as they stand here. */
function playing(): GameSummary | null {
  const s = net.summary
  if (!s || s.id !== own.game) return s
  const g = play.game
  return g && !viewing ? { ...s, month: g.month, status: g.status, score: g.score?.total ?? s.score } : s
}

/** This sitting: the game, and the month and score it began at, for the day's end. */
const sitting = { game: null as string | null, month: 0, score: 0, shown: false }

/**
 * The day's end (slice 9): when the daily allowance runs out, or where there is none, after twelve months at one
 * sitting, what the player achieved today and when to come back. After the yearly review, if one is showing.
 */
function checkDay(): void {
  const g = play.game
  if (!g || viewing || g.status !== 'playing' || sitting.game !== own.game || sitting.shown) return
  const left = allowLeft()
  const months = g.month - sitting.month
  if (months <= 0 || !(left === 0 || (left === null && months >= 12))) return
  sitting.shown = true
  const show = () => {
    if (document.querySelector('.ending.review')) return void setTimeout(show, 400)
    const more = net.summary?.allowance.more
    showDayEnd({
      first: sitting.month === 0,
      from: sitting.month,
      to: g.month - 1,
      scoreFrom: sitting.score,
      scoreTo: play.game?.score?.total ?? sitting.score,
      deeds: city.ask('deeds', {}),
      more: left === 0 && more ? new Date(Date.parse(more) > Date.now() ? Date.parse(more) : Date.parse(more) + 86_400_000) : null,
      canGoOn: left !== 0,
      goOn: () => null,
      practice: () => void practice(),
    })
  }
  show()
}

/** Begins one of the player's games in the worker and shows it. */
async function beginGame(o: Opened, fresh = false): Promise<Questions['begin'][1]> {
  own.game = o.game
  own.diverged = false
  net.session.game = o.game
  net.save()
  city.onProgress = (month, of) => bar.busy(`Putting your game back: ${month + 1} of ${of}`)
  const b = await city.ask('begin', {
    fresh, key: o.game, season: o.season, list: o.list, pending: net.outbox.pending(o.game).map((q) => q.month),
  })
  // A game under way opens on its last month's report, as the rules kept it.
  play.report = b.game.reports.at(-1) ?? null
  play.trips = null
  play.ended = null
  play.books = null
  play.roads = { worst: [], mended: [] }
  play.ending?.remove()
  play.ending = null
  bar.busy(null)
  showMode()
  apply(b)
  Object.assign(sitting, { game: o.game, month: b.game.month, score: b.game.score?.total ?? 0, shown: false })
  play.notice = o.notice
  // A game on the server whose copy here could not be used is played again from the server's list, not begun anew.
  if (b.older && !net.isHere(o.game) && !o.list) later(() => void resync(o.game))
  else if (b.older) play.notice = b.older
  showNet()
  return b
}

/** Starts a game from its first month and shows it. */
async function beginFresh(game: string): Promise<void> {
  hideEventCard()
  own.endingShown = null
  bar.busy('Starting a new game…')
  await beginGame({ season: seasonFor(game), game, list: null, notice: null }, true)
  if (!phone) panel.open('report')
  else panel.close()
  await refreshMonth()
}

/**
 * Starts again: the ranked game's one restart in a season, where it has not been used; otherwise a practice game.
 * `confirmed` where the player has already said yes.
 */
async function restart(confirmed = false): Promise<void> {
  if (play.busy || viewing) return
  const s = net.summary
  if (s && s.ranked && !s.restarted && !net.isHere(s.id)) {
    if (!confirmed && !confirm('Start your ranked game again from January 2026? You may do this once a season. This game will be lost.')) return
    try {
      const { game } = await net.server.restart(s.id)
      net.outbox.drop(s.id)
      net.remember(game)
      forgetSeasonPage()
      await beginFresh(game.id)
    } catch (error) {
      play.notice = `Your game could not be started again: ${error instanceof ApiError && error.code === 'offline' ? 'the server cannot be reached.' : String((error as Error).message)}`
      panel.open('report')
    }
    return
  }
  await practice()
}

/** A new practice game: on the server where it can be reached, else kept here. */
async function practice(): Promise<void> {
  if (play.busy || viewing) return
  let id: string
  try {
    const info = net.session.season
    if (!net.session.token || !info) throw new ApiError('offline', '')
    const { game } = await net.server.newGame(info.id, false)
    net.remember(game)
    id = game.id
  } catch {
    id = (await net.practiceHere(null, true)).game
  }
  forgetSeasonPage()
  await beginFresh(id)
}

/** Switches to another of the player's games. */
async function switchTo(g: GameSummary): Promise<void> {
  if (viewing) return
  await idle()
  const list = g.month > 0 ? await net.api(g.id).game(g.id).then((x) => ({ done: x.done, month: x.game.month }), () => null) : null
  own.endingShown = g.status === 'playing' ? null : g.id
  await beginGame({ season: seasonFor(g.id), game: g.id, list, notice: null })
  panel.open('board')
  await refreshMonth()
}

/** Signs in on this device's player, or finds the ranked game again after signing in: from the server's list. */
async function rejoin(): Promise<void> {
  await idle()
  try {
    const o = await net.join()
    await beginGame(o)
    await refreshMonth()
  } catch (error) {
    play.notice = `Your game could not be found on the server: ${String((error as Error).message)}`
  }
  forgetSeasonPage()
  panel.open('board')
}

/** Months that may still be played today in the player's game, or null where the allowance is off. */
function allowLeft(): number | null {
  const s = net.summary
  if (!s?.allowance.on || s.id !== own.game || viewing) return null
  let left = s.allowance.left - net.outbox.pending(s.id).length
  // The day has turned since the server last said: twelve more, up to 36, until it says again.
  if (s.allowance.more && Date.now() >= Date.parse(s.allowance.more)) left = Math.min(36, Math.max(0, left) + 12)
  return Math.max(0, left)
}

let asked = 0
/** Shows the allowance, the months waiting to be sent and the kind of game, as they stand. */
function showNet(): void {
  const s = net.summary
  const left = allowLeft()
  let more = s?.allowance.more ? new Date(s.allowance.more) : null
  if (more && Date.now() >= more.getTime()) {
    more = new Date(more.getTime() + 86_400_000)
    // Ask the server again, at most once a minute.
    if (Date.now() - asked > 60_000 && own.game && !net.isHere(own.game)) {
      asked = Date.now()
      void net.api(own.game).game(own.game).then(({ game }) => {
        net.remember(game)
        showNet()
      }, () => null)
    }
  }
  bar.allowance(left, more)
  bar.waiting(own.game ? net.outbox.pending(own.game).length : 0, net.outbox.offline)
  if (play.game && !play.busy) bar.show(play.game, play.times)
}
setInterval(showNet, 60_000)

/** Marks the game in the bar as practice, or as another player's city. */
function showMode(): void {
  const s = net.summary
  const practice = net.isHere(own.game) || (s?.id === own.game && s?.ranked === false)
  bar.mode(viewing ? 'view' : practice ? 'practice' : 'ranked', viewing?.name)
  document.body.classList.toggle('viewing', !!viewing)
}

/** The server acknowledged a month. If its figures differed, the game is played again from its list once all are in. */
function checked(game: string, summary: GameSummary, same: boolean): void {
  net.remember(summary)
  if (game !== own.game) return
  if (!same) {
    own.diverged = true
    own.differed++
  }
  if (own.diverged && !net.outbox.pending(game).length) {
    own.diverged = false
    later(() => void resync(game))
  }
  showNet()
}

/** The server refused a month: it is undone, and the months after it, and the reason is shown. */
async function refused(game: string, month: number, error: ApiError): Promise<void> {
  if (error.code === 'older-version') {
    reloadFor = -1
    maybeReload()
    return
  }
  if (game !== own.game) return
  signal('refused')
  own.hold = true
  play.stop = true
  await idle()
  net.outbox.drop(game, month)
  const back = await city.ask('undo', { month }).catch(() => null)
  if (back) {
    apply(back)
    await refreshMonth()
  } else await resync(game, true)
  own.hold = false
  if (error.code === 'allowance') {
    // None left, as the server counts them, until it says otherwise.
    const s = net.summary
    if (s?.id === game) net.remember({ ...s, allowance: { ...s.allowance, left: net.outbox.pending(game).length } })
    void net.api(game).game(game).then(({ game: summary }) => {
      net.remember(summary)
      showNet()
    }, () => null)
  }
  play.notice = error.code === 'allowance'
    ? `${error.message} ${monthLong(month)} has been undone and can be played when more months arrive.`
    : `The server did not accept ${monthLong(month)}: ${error.message} It has been undone.`
  showNet()
  panel.open('report')
  showRefusal(play.notice)
}

/** A month refused by the server, said above whatever card is open, until the player has read it. */
function showRefusal(words: string): void {
  document.querySelector('.refusal')?.remove()
  const card = element('section', 'card refusal')
  card.setAttribute('role', 'alertdialog')
  card.setAttribute('aria-label', 'A month was not accepted')
  const ok = element('button', 'commit', 'Understood')
  ok.type = 'button'
  ok.addEventListener('click', () => card.remove())
  card.append(element('h2', '', 'A month was not accepted'), element('p', '', words), ok)
  document.body.append(card)
  ok.focus({ focusVisible: false } as FocusOptions)
}

/**
 * Plays the player's game again from the server's list, which is the truth: after a month whose figures differed, or
 * when the server's game has moved apart from this browser's (another device). The player is told only if what they
 * see changes.
 */
async function resync(game: string, quiet = false): Promise<void> {
  if (game !== own.game) return
  await idle()
  play.busy = true
  const before = play.game && { score: play.game.score?.total, money: play.game.money, month: play.game.month }
  try {
    bar.busy('Checking your game with the server…')
    const { game: summary, done } = await net.api(game).game(game)
    net.remember(summary)
    city.onProgress = (month, of) => bar.busy(`Checking your game with the server: ${month + 1} of ${of}`)
    const b = await city.ask('begin', {
      fresh: false, replay: true, key: game, season: seasonFor(game), list: { done, month: summary.month }, pending: [],
    })
    net.outbox.drop(game)
    apply(b)
    const now = b.game
    if (!quiet && before && (before.score !== now.score?.total || before.money !== now.money || before.month !== now.month)) {
      play.notice = before.month !== now.month
        ? `Your game was further on elsewhere, so it has been brought up to ${monthLong(now.month)} as the server has it.`
        : 'The server’s figures for your game differed from this browser’s, so your game now follows the server’s.'
      panel.open('report')
    }
  } catch (error) {
    console.warn('The game could not be checked with the server:', String(error))
  } finally {
    play.busy = false
    bar.busy(null)
    showNet()
  }
  await refreshMonth()
}

/** Looks round another player's finished city: played again from their list, kept nowhere, changed by nothing. */
async function look(row: BoardRow): Promise<void> {
  if (viewing) return
  await idle()
  let got: Awaited<ReturnType<typeof net.server.city>>
  try {
    got = await net.server.city(row.game)
  } catch (error) {
    play.notice = `That city cannot be opened: ${String((error as Error).message)}`
    return
  }
  const name = got.player.name ?? row.player.name
  viewing = { name, done: got.done }
  hideEventCard()
  play.ending?.remove()
  play.ending = null
  panel.close()
  showMode()
  play.busy = true
  city.onProgress = (month, of) => bar.busy(`Putting ${name}’s city together: ${month + 1} of ${of}`)
  bar.busy(`Putting ${name}’s city together…`)
  try {
    const b = await city.ask('begin', {
      fresh: true, view: true, season: net.session.season?.season ?? firstSeason, list: { done: got.done, month: got.game.month },
      state: got.state ?? undefined,
    })
    play.report = null
    play.notice = null
    play.books = null
    apply(b)
  } catch (error) {
    play.busy = false
    bar.busy(null)
    viewing = null
    await backToMine()
    play.notice = `That city could not be put together: ${String((error as Error).message)}`
    return
  } finally {
    play.busy = false
    bar.busy(null)
  }
  await refreshMonth()
  panel.open('score')
  // The page opens at its head, however far down the board was scrolled.
  requestAnimationFrame(() => (panel.body.scrollTop = 0))
}

/** Leaves another player's city for the player's own game, kept in this browser. */
async function backToMine(): Promise<void> {
  if (play.busy) return
  viewing = null
  showMode()
  if (!own.game) return
  bar.busy('Back to your game…')
  await beginGame({ season: seasonFor(own.game), game: own.game, list: null, notice: null })
  await refreshMonth()
  panel.open('board')
  for (const run of afterView.splice(0)) run()
  // A new player who came by a link to someone's city begins their own with the introduction.
  if (firstVisit()) startIntro()
}

/** The version of the rules the server plays by, when it is not this screen's: the page reloads when that loses nothing. */
let reloadFor: number | null = null
function checkRules(rules: number): void {
  if (!rules || !city.rules || rules === city.rules) return
  reloadFor = rules
  maybeReload()
}
function maybeReload(): void {
  if (reloadFor === null || play.busy || build.placing || viewing) return
  // Every month in the server's hands first, unless the server refuses them for the screen's age.
  if (reloadFor !== -1 && net.outbox.queue.length) return
  try {
    if (sessionStorage.getItem('peakooru.reloaded') === String(reloadFor)) {
      play.notice = 'A newer version of the game is out. Reload the page to play it.'
      reloadFor = null
      return
    }
    sessionStorage.setItem('peakooru.reloaded', String(reloadFor))
  } catch {
    return
  }
  location.reload()
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') maybeReload()
  else net.outbox.poke()
})
addEventListener('online', () => net.outbox.poke())

/** A sign-in link opened on this device: its player is joined to the account, and the account's game played here. */
async function signInLink(): Promise<string | null> {
  const code = params.get('signin')
  if (!code) return null
  params.delete('signin')
  history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`)
  try {
    if (!net.session.token) {
      const { player, token } = await net.server.newPlayer()
      net.session.token = net.server.token = token
      net.session.player = player
      net.save()
    }
    const { player, token } = await net.server.confirmEmail(code)
    net.signedIn(player, token)
    return 'You are signed in. Your game is on this device as well now.'
  } catch (error) {
    return `Signing in did not work: ${String((error as Error).message)}`
  }
}

/** After the game has opened: a friend's link, and how things stand on the server. */
async function afterOpen(): Promise<void> {
  const friend = params.get('friend')
  if (friend && net.session.token) {
    params.delete('friend')
    history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`)
    await net.server.addFriend(friend).then(() => (play.notice = 'Your friend has been added. They are on your Friends board.'),
      (error) => (play.notice = `Your friend could not be added: ${String((error as Error).message)}`))
  }
  const r = await net.refresh()
  if (!r) return showNet()
  checkRules(r.season.rules)
  const game = r.game
  if (!game || !r.done || game.id !== own.game) return showNet()
  if (game.season !== r.season.id) {
    // A new season has begun since the last visit: its ranked game.
    await idle()
    const o = await net.join().catch(() => null)
    if (o) {
      await beginGame({ ...o, notice: `A new season has begun: ${r.season.name}. Your game from the last season stays on its board.` })
      await refreshMonth()
      panel.open('report')
    }
    return
  }
  const here = play.game?.month ?? 0
  const pending = net.outbox.pending(game.id).map((q) => q.month)
  let covered = true
  for (let m = game.month; m < here; m++) if (!pending.includes(m)) covered = false
  if (game.month > here || !covered) await resync(game.id)
  showNet()
}

city.onProgress = (month, of) => bar.busy(`Putting your game back: ${month + 1} of ${of}`)
const begun = (async () => {
  const signedIn = await signInLink()
  const opened = await net.open()
  const b = await beginGame(signedIn ? { ...opened, notice: signedIn } : opened)
  if (!phone || play.notice) panel.open('report')
  void afterOpen().catch((error) => console.warn(String(error)))
  return b
})().catch((error) => {
  bar.busy(`The game could not be loaded: ${String(error)}`)
  throw error
})

map.on('load', async () => {
  const [transitData, zoneData] = await data
  transit = transitData
  // Zone shading goes under parks and water; the other data layers under the base map's names, over its roads.
  const firstLabel = map.getStyle().layers.find((l) => l.type === 'symbol')?.id
  const zones = zoneData ? new ZoneLayer(map, zoneData[0], zoneData[1], 'landcover') : null
  zoneLayer = zones
  if (zones) {
    zoneTools = {
      list: zones.zones,
      highlight: (levels) => zones.highlight(levels),
      pick: (id) => zones.pick(id),
      outline: (id) => zones.outline(id),
    }
  }
  zoneList = zoneData?.[0] ?? []
  const wards = new Set(zoneData?.[0].filter((z) => z.ward).map((z) => z.id))
  edgeRings = zoneData ? cityEdge(zoneData[1], wards) : []
  addCityEdge(map, edgeRings, CITY.bounds, 'roads_tunnels_other_casing')
  eventLayer = new EventLayer(map, firstLabel)
  if (play.game) void drawEvents(play.game)
  addEdgeFade(map, CITY.bounds, palette.land, firstLabel)
  const kannada = transit ? addTransit(map, transit) : []
  if (transit) {
    buildLayer = new BuildLayer(map, null, firstLabel)
    build.setLayer(buildLayer)
    build.setTransit(transit)
    if (play.game) void drawWorks(play.game)
  }
  const places = addPlaces(map, palette.label, palette.halo)
  // Station names are placed before place names, so that Majestic is named with the whole city in view.
  if (transit) map.moveLayer('transit-names')
  const labels = new KannadaLabels(map, [...kannada, ...places])

  let roads: NetworkLayer | null = null
  let congestion: CongestionLayer | null = null
  let playback: Playback | null = null
  const c = (controls = new Controls({
    steps: zones?.steps ?? null,
    onView: (view) => {
      zones?.show(view)
      conditionLayer?.show(view === 'roads')
      if (view === 'roads') void loadSurface()
      updateChip()
    },
    onNetwork: (visible) => roads?.show(visible),
    onTraffic: (period) => {
      playback?.stop()
      congestion?.show(!!period)
      if (period && play.month) congestion?.paint(play.month.view.level[period])
      buildLayer?.showRoadTraffic(play.month?.view.extra ?? [], period)
      showFloods()
      updateChip()
    },
    onPlay: () => {
      if (!playback || !play.month) return
      if (playback.playing) playback.stop()
      else {
        c.playing(true)
        playback.play(play.month.view)
      }
    },
    onClose: () => pick?.(null),
    onWhy: (zone, into) => void whyZone(zone, into),
  }))
  if (phone) c.root.remove()
  pick = (id: number | null) => {
    // A road shown by its card is no longer marked once a zone is picked or the card closed.
    if (!placing()) buildLayer?.showRepair([], [])
    zones?.pick(id)
    c.showZone(id === null ? null : (zoneData?.[0][id] ?? null))
  }
  map.on('click', (event) => {
    if (placing()) return build.tap(event)
    if (c.shading === 'roads' && showRoadAt(event.point, [event.lngLat.lng, event.lngLat.lat])) return
    if (c.period && showRoadAt(event.point, [event.lngLat.lng, event.lngLat.lat], true)) return
    const [hit] = zones ? map.queryRenderedFeatures(event.point, { layers: ['zones-fill'] }) : []
    if (hit && phone) panel.close()
    pick?.(hit ? Number(hit.id) : null)
  })

  /** In the road condition view, a tap on a road shows what it costs and offers to mend it. */
  function showRoadAt(point: { x: number; y: number }, at: [number, number], traffic = false): boolean {
    const r = 12
    // In the road condition view, roads in less than good repair; in the traffic view, roads slow or worse.
    const hits = map.queryRenderedFeatures([[point.x - r, point.y - r], [point.x + r, point.y + r]], {
      layers: (traffic ? ['congestion'] : ['condition', 'condition-broken']).filter((id) => map.getLayer(id)),
    }).filter((f) => f.id !== undefined && (Number((traffic ? f.state?.level : f.state?.grade) ?? 0) > 0))
    // The stretch nearest the tap, of those within a finger's reach.
    let stretch = -1
    let best = Infinity
    for (const h of hits) {
      const lines = h.geometry.type === 'LineString' ? [h.geometry.coordinates] : h.geometry.type === 'MultiLineString' ? h.geometry.coordinates : []
      for (const line of lines) {
        for (let i = 1; i < line.length; i++) {
          const a = map.project(line[i - 1] as [number, number])
          const b = map.project(line[i] as [number, number])
          const dx = b.x - a.x, dy = b.y - a.y
          const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
          const d = Math.hypot(a.x + t * dx - point.x, a.y + t * dy - point.y)
          if (d < best) {
            best = d
            stretch = Number(h.id)
          }
        }
      }
    }
    if (stretch < 0 || !networkData) return false
    const name = networkData.links[stretch]?.name ?? null
    const run = name ? namedRun(networkData, stretch) : [stretch]
    zones?.pick(null)
    if (phone) panel.close()
    void Promise.all([city.ask('road', { stretches: run }), loadSurface()]).then(async ([all]) => {
      const why = await city.ask('whyRoad', { links: all.map((l) => l.id) }).catch(() => null)
      // The road itself: its own stretches, not all of each link that touches it, for marking and for its km.
      const own = new Set(run)
      const links = all.map((l) => ({ ...l, drawn: l.drawn.filter((d) => own.has(d)) }))
      buildLayer?.showRepair([], links.map((l) => ({ id: l.id, drawn: l.drawn, lanes: 0 })))
      const metres = links.reduce((sum, l) => sum + l.length, 0) || 1
      const cond = links.reduce((sum, l) => sum + l.length * l.condition, 0) / metres
      const worse = links.filter((l) => l.condition < 50)
      const km = roadKm(links.map((l) => ({ drawn: l.drawn, length: l.length })), networkData)
      const minutes = links.some((l) => l.minutes !== null) ? links.reduce((sum, l) => sum + (l.minutes ?? 0), 0) : null
      const lines = [`${decimal(km)} km, ${GRADES[gradeOf(cond)]} (${Math.round(cond)} of 100)` +
        (worse.length ? `; ${decimal(roadKm(worse.map((l) => ({ drawn: l.drawn, length: l.length })), networkData))} km of it poor or broken.` : '.')]
      if (why && why.capacity > 0) {
        // Why it is slow: its busiest stretch at the evening peak, against what it holds and its speed when clear.
        const full = why.vehicles / why.capacity
        lines.push(`At the evening peak its busiest stretch carries ${grouped(why.vehicles)} vehicles an hour against the ` +
          `${grouped(why.capacity)} it holds${full >= 1 ? ', more than it can take' : full >= 0.85 ? ', near full' : ''}, ` +
          `at ${Math.round(why.kmh)} km/h against ${why.free} when clear` +
          (why.signals ? `, through ${why.signals} signal${why.signals > 1 ? 's' : ''}.` : '.'))
      }
      if (minutes !== null) {
        lines.push(minutes >= 60 ? `Its potholes cost those who use it about ${grouped(minutes / 60)} hours a weekday.`
          : 'Its potholes cost little time: few use it, or it is in fair repair.')
      }
      const mend = worse.length ? worse : links.filter((l) => l.condition < 75)
      c.showRoad({
        name: name ?? 'A main road without a name',
        lines,
        action: mend.length ? {
          text: 'Mend it',
          run: () => {
            c.showRoad(null)
            buildLayer?.showRepair([], [])
            panel.open('build')
            build.mendRoad(mend.map((l) => l.id), 'patch', name, at)
          },
        } : null,
      })
    })
    return true
  }

  const shown = {
    map, roads: null as NetworkLayer | null, zones, labels, controls: c, city, bar, panel, play,
    month: null as Month | null, playback: null as Playback | null, shownMs: null as number | null, ready: true,
    /** Works out the month again and shows it, resolving with the milliseconds from asking to the map showing it. */
    work: async () => (shown.shownMs = await refreshMonth()),
    next, skip, act, restart, build, intro, loadSurface, net, own, look, backToMine, practice, resync,
    get viewing() {
      return viewing
    },
    /** Shows the ending as the game stands, for looking at it before a game is over. */
    ending: () => {
      play.ending?.remove()
      play.ending = play.game ? ending(play.game) : null
    },
    get condition() {
      return conditionLayer
    },
  }
  if (measure) Object.assign(window, { peakooru: shown })

  /** Shows a month on the map: zones, figures, and congestion if it is on. */
  showMonth = (month: Month) => {
    play.month = shown.month = month
    zones?.setMonth(month.result.commuteByZone, month.result.accessByZone, month.result.deathsByZone, play.game?.zonePeople,
      month.result.cleanByZone)
    // The worst-served fifth as the rules count it for the score.
    void city.ask('worst', {}).then((ids) => {
      zones?.setWorst(new Set(ids))
      c.enableTraffic()
    }).catch(() => null)
    c.enableTraffic()
    if (playback?.playing) playback.stop()
    if (c.period) congestion?.paint(month.view.level[c.period])
    buildLayer?.showRoadTraffic(month.view.extra ?? [], c.period)
    showFloods()
    build.monthShown()
    panel.refresh('score')
  }
  if (play.month) showMonth(play.month)

  /** Roads flooded in the month shown, in the traffic view: in water's blue, named with the days they were shut. */
  function showFloods(): void {
    const floods = play.month?.view.flooded ?? []
    const on = !!c.period
    const stretches = new Map<number, number>()
    for (const f of floods) for (const d of f.drawn) stretches.set(d, Math.max(stretches.get(d) ?? 0, f.days))
    conditionLayer?.flood(stretches, on)
    // One name for each road, not each direction: the longest shut of the two.
    const named = new Map<string, { at: [number, number]; days: number }>()
    for (const f of floods) {
      const key = f.drawn.length ? [...f.drawn].sort((a, b) => a - b).join() : f.ends.join()
      const at: [number, number] = [(f.ends[0]! + f.ends[2]!) / 2, (f.ends[1]! + f.ends[3]!) / 2]
      named.set(key, { at, days: Math.max(named.get(key)?.days ?? 0, f.days) })
    }
    buildLayer?.showFloods([...named.values()], on)
    c.setFlooded(on && floods.length > 0)
  }

  // The road network is the largest file and is not needed for the first sight of the city, so it comes after.
  map.once('idle', async () => {
    const network = await optional(loadNetwork)
    if (!network) return
    addRingRoads(map, network, palette.roadLead, palette.casingLead, 'roads_rail')
    roads = shown.roads = new NetworkLayer(map, network, firstLabel)
    networkData = network
    buildLayer?.setNetwork(network)
    conditionLayer = new ConditionLayer(map, firstLabel)
    if (play.game) void loadSurface()
    if (play.game) void drawWorks(play.game)
    eventsDrawn = ''
    if (play.game) void drawEvents(play.game)
    congestion = new CongestionLayer(map, firstLabel)
    // Water lies over the traffic: a flooded road is shut, whatever its jam.
    if (firstLabel) map.moveLayer('flooded', firstLabel)
    eventLayer?.raise(firstLabel)
    playback = shown.playback = new Playback(
      map, network, congestion, phone ? 20_000 : 60_000, map.getLayer('transit-rail') ? 'transit-rail' : firstLabel,
      (period) => c.markPeriod(period),
      () => c.playing(false),
    )
    c.enableNetwork()
    await begun.catch(() => null)
    await refreshMonth().catch((error) => console.warn('The month could not be worked out:', String(error)))
    // A shared city is seen whole, as the game opens on a first visit.
    if (cityLink && cityLink !== own.game) {
      void look({ game: cityLink, player: { id: '', name: 'Another player' } } as BoardRow).then(() => {
        if (viewing) {
          // The whole city, in what shows of the map: on a phone the page is put away so that the city is seen.
          if (phone) panel.close()
          const c = cover()
          return map.fitBounds(CITY.area, { duration: 0, padding: { top: c.top + 8, bottom: c.bottom + 8, left: c.left + 8, right: c.right + 8 } })
        }
        // The city could not be opened: the player is told why, and a new player begins their own game.
        panel.open('report')
        if (firstVisit()) startIntro()
      })
    }
    else if (firstVisit()) startIntro()
    else welcomeBack()
  })
})

/** The introduction to a first game, taught by doing (PRD UI-11). */
const intro = new Lesson({
  phone,
  map,
  steps: () => city.ask('first', {}),
  game: () => (viewing ? null : play.game),
  reported: () => play.report,
  busy: () => play.busy,
  tab: () => panel.tab,
  openReport: () => panel.open('report'),
  closePanel: () => panel.close(),
  mend: (road) => {
    panel.open('build')
    build.mendRoad(road.links, 'patch', road.name, road.at)
  },
  busTool: () => {
    panel.open('build')
    build.choose('busRoute')
    // On a phone the page is lowered to its head, so that the map where the stops go shows.
    if (phone) {
      build.low = true
      panel.refresh('build')
    }
  },
  building: () => ({ tool: build.tool, stops: build.stops.length, ok: !!build.quote?.ok }),
  cover,
})
function startIntro(): void {
  hideEventCard()
  void intro.start()
}
/** A player coming back to a game under way: where they left it and the top of the board, once a visit. */
function welcomeBack(): void {
  const g = play.game
  if (!g || g.month === 0 || g.status !== 'playing' || viewing || play.ending) return
  try {
    if (sessionStorage.getItem('peakooru.welcomed') === own.game) return
    sessionStorage.setItem('peakooru.welcomed', own.game ?? '')
  } catch {
    // Shown each time the page opens.
  }
  const info = net.session.season
  showWelcome({
    season: info,
    game: g,
    practice: net.isHere(own.game) || net.summary?.ranked === false,
    left: allowLeft(),
    board: info && net.session.token ? net.server.board(info.id, 'all', 0, 3).catch(() => null) : Promise.resolve(null),
    carryOn: () => null,
    openBoard: () => panel.open('board'),
  })
}

/** A first game, never begun: the introduction starts by itself, once. */
function firstVisit(): boolean {
  const g = play.game
  return !introSeen() && !!g && g.month === 0 && !g.done.length && g.status === 'playing' && !play.ending && !viewing
}

if (measure) Object.assign(window, { peakooru: { map } })
