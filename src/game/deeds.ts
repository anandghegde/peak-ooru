import type { Figure, Game } from '../rules/types'
import type { RoutingNetwork } from '../sim/types'
import { metres } from './build'
import { averageOf } from '../rules/score'

/** Km of road on some routing links: a two-way road chosen in both directions counts once. */
export function roadKmOf(roads: RoutingNetwork, ids: Iterable<number>): number {
  const set = new Set(ids)
  const pairs = new Map(roads.links.map((l) => [`${l.from}-${l.to}`, l.id]))
  let m = 0
  for (const id of set) {
    const l = roads.links[id]
    if (!l) continue
    const twin = pairs.get(`${l.to}-${l.from}`)
    m += twin !== undefined && set.has(twin) ? l.length / 2 : l.length
  }
  return m / 1000
}

function pathKm(path: number[]): number {
  let m = 0
  for (let i = 2; i + 1 < path.length; i += 2) m += metres([path[i - 2]!, path[i - 1]!], [path[i]!, path[i + 1]!])
  return m / 1000
}

const n = (x: number) => Math.round(x).toLocaleString('en-IN')
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

function figure(game: Game, key: Figure['key']): { first: number; last: number } | null {
  const first = game.reports.find((r) => r.figures.some((f) => f.key === key))?.figures.find((f) => f.key === key)
  const last = game.reports.at(-1)?.figures.find((f) => f.key === key)
  return first && last ? { first: first.before, last: last.now } : null
}

/**
 * What the player did and what came of it, in short lines for the ending (PRD UI-18), most telling first: what they
 * built, what they mended, then what changed most in the city. "Built 4 metro lines, 62 km".
 */
export function deeds(game: Game, roads: RoutingNetwork): string[] {
  const out: string[] = []
  const built = game.built
  const lines = built?.lines ?? []
  const metro = lines.filter((l) => l.kind === 'metro')
  if (metro.length) out.push(`Built ${plural(metro.length, 'metro line')}, ${n(metro.reduce((s, l) => s + pathKm(l.path), 0))} km`)
  // Lines still being built count for nothing in the score (PRD SCORE-12), but were begun.
  const begun = (game.projects ?? []).filter((p) => p.plan.kind === 'metro')
  if (begun.length) out.push(`Began ${plural(begun.length, 'metro line')} not yet open, ${n(begun.reduce((s, p) => s + p.quote.length, 0) / 1000)} km`)
  const bus = lines.filter((l) => l.kind === 'bus')
  if (bus.length) {
    const buses = bus.reduce((s, l) => s + (built?.vehicles[l.id] ?? 0), 0)
    out.push(`Ran ${plural(bus.length, 'new bus route')}${buses ? ` with ${n(buses)} buses` : ''}`)
  }
  const mended: Record<'patch' | 'resurface' | 'concrete', Set<number>> = { patch: new Set(), resurface: new Set(), concrete: new Set() }
  let lanes = 0, trains = 0, footpaths = 0, junctions = 0
  for (const { action } of game.done) {
    if (action.kind !== 'build') continue
    const p = action.plan
    if (p.kind === 'repair') for (const id of p.links) mended[p.work].add(id)
    else if (p.kind === 'busLane') lanes += roadKmOf(roads, p.links)
    else if (p.kind === 'railService') trains += p.trains
    else if (p.kind === 'footpaths') footpaths++
    else if (p.kind === 'junction') junctions++
  }
  if (trains) out.push(`Added ${plural(trains, 'train')} a day on the suburban railway`)
  const roadsBuilt = built?.roads ?? []
  if (roadsBuilt.length) {
    const fly = roadsBuilt.filter((r) => r.flyover).length
    out.push(`Built ${n(roadsBuilt.reduce((s, r) => s + pathKm(r.path), 0))} km of new road${fly ? `, ${plural(fly, 'flyover')} among it` : ''}`)
  }
  const concrete = roadKmOf(roads, mended.concrete)
  const resurfaced = roadKmOf(roads, [...mended.resurface].filter((id) => !mended.concrete.has(id)))
  const patched = roadKmOf(roads, [...mended.patch].filter((id) => !mended.concrete.has(id) && !mended.resurface.has(id)))
  if (concrete >= 0.5) out.push(`Laid ${n(concrete)} km of road in concrete`)
  if (resurfaced >= 0.5) out.push(`Resurfaced ${n(resurfaced)} km of road`)
  if (patched >= 0.5) out.push(`Patched ${n(patched)} km of road`)
  if (lanes >= 0.5) out.push(`Gave buses ${n(lanes)} km of their own lanes`)
  if (footpaths) out.push(`Laid footpaths in ${plural(footpaths, 'zone')}`)
  if (junctions) out.push(`Worked on ${plural(junctions, 'junction')}`)

  // What came of it: each change as a share of where it started, largest first.
  const results: { size: number; text: string }[] = []
  const opening = game.season?.opening
  const measured = game.measured ?? []
  if (opening && measured.length) {
    // As the share line compares them (src/share/line.ts): the city as the season opened against the average the
    // score takes of the last year, rounded down as the share line rounds, so that one card says one number.
    const now = (key: 'commute' | 'safety' | 'access' | 'clean') => averageOf(measured, key)
    const commuteD = (opening.commute - now('commute')) / 60
    if (Math.abs(commuteD) >= 0.3) {
      const said = Math.abs(commuteD) >= 1 ? `${Math.floor(Math.abs(commuteD))} minute${Math.floor(Math.abs(commuteD)) === 1 ? '' : 's'}`
        : `${Math.abs(commuteD).toFixed(1)} minutes`
      results.push({ size: Math.abs(commuteD * 60) / opening.commute, text: `Commute ${commuteD > 0 ? 'down' : 'up'} ${said}` })
    }
    if (opening.safety > 0) {
      const d = (now('safety') - opening.safety) / opening.safety
      if (Math.abs(d) >= 0.02) results.push({ size: Math.abs(d), text: `Road deaths ${d < 0 ? 'down' : 'up'} ${Math.floor(Math.abs(d) * 100)}%` })
    }
    const a0 = opening.access / 10, a1 = now('access') / 10
    if (Math.abs(a1 - a0) >= 0.3) {
      results.push({ size: Math.abs(a1 - a0) / Math.max(1, a0), text: `Jobs in reach ${a1 > a0 ? 'up' : 'down'} from ${a0.toFixed(1)}% to ${a1.toFixed(1)}%` })
    }
    const c0 = opening.clean / 10, c1 = now('clean') / 10
    if (Math.abs(c1 - c0) >= 0.5) {
      results.push({ size: Math.abs(c1 - c0) / Math.max(1, c0), text: `Clean trips ${c1 > c0 ? 'up' : 'down'} from ${c0.toFixed(0)}% to ${c1.toFixed(0)}%` })
    }
  } else {
  const commute = figure(game, 'commute')
  if (commute && Math.abs(commute.last - commute.first) >= 0.3) {
    const d = commute.last - commute.first
    results.push({ size: Math.abs(d) / commute.first, text: `Commute ${d < 0 ? 'down' : 'up'} ${Math.abs(d).toFixed(1)} minutes` })
  }
  const deaths = figure(game, 'safety')
  if (deaths && deaths.first > 0 && Math.abs(deaths.last - deaths.first) / deaths.first >= 0.02) {
    const d = (deaths.last - deaths.first) / deaths.first
    results.push({ size: Math.abs(d), text: `Road deaths ${d < 0 ? 'down' : 'up'} ${Math.round(Math.abs(d) * 100)}%` })
  }
  const access = figure(game, 'access')
  if (access && access.first > 0 && Math.abs(access.last - access.first) >= 0.3) {
    const d = access.last - access.first
    results.push({ size: Math.abs(d) / access.first, text: `Jobs in reach ${d > 0 ? 'up' : 'down'} from ${access.first.toFixed(1)}% to ${access.last.toFixed(1)}%` })
  }
  const clean = figure(game, 'clean')
  if (clean && Math.abs(clean.last - clean.first) >= 0.5) {
    const d = clean.last - clean.first
    results.push({ size: Math.abs(d) / Math.max(1, clean.first), text: `Clean trips ${d > 0 ? 'up' : 'down'} from ${clean.first.toFixed(0)}% to ${clean.last.toFixed(0)}%` })
  }
  }
  results.sort((a, b) => b.size - a.size)
  // Two lines of doing and one of what came of it, where there is both; else whatever there is.
  const done = out.slice(0, results.length ? 2 : 3)
  const shown = [...done, ...results.map((r) => r.text)].slice(0, 3)
  if (!out.length) shown.unshift('Built nothing')
  return shown.slice(0, 3)
}
