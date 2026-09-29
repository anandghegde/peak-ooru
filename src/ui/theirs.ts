import type { Action, Done } from '../rules/types'
import { element } from './controls'
import { crore, monthLong } from './format'

/** What an action was, in a few words, for the list of what another player did (PRD MP-13, UI-17). */
export function actionWords(action: Action, zone: (id: number) => string): string {
  const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`
  switch (action.kind) {
    case 'build': {
      const p = action.plan
      switch (p.kind) {
        case 'metro': return `Ordered a metro line of ${n(p.stops.length, 'station')}`
        case 'busRoute': return `Started a bus route of ${n(p.stops.length, 'stop')} with ${n(p.buses, 'bus', 'buses')}`
        case 'busLane': return `Laid bus lanes on ${n(p.links.length, 'stretch', 'stretches')} of road`
        case 'railService': return `Ran ${n(p.trains, 'more train', 'more trains')} on a suburban line`
        case 'road': return `Ordered a new ${p.flyover ? 'flyover' : 'road'} of ${n(p.lanes, 'lane')}`
        case 'junction': return p.work === 'signal' ? 'Put signals at a junction' : p.work === 'redesign' ? 'Redesigned a junction' : 'Lifted a main road over a junction'
        case 'footpaths': return `Laid footpaths and crossings in ${zone(p.zone)}`
        case 'oneWay': return p.on ? 'Made a road one-way' : 'Made a road two-way again'
        case 'speedLimit': return p.limit === null ? `Lifted the speed limit in ${zone(p.zone)}` : `Set a speed limit of ${p.limit} km/h in ${zone(p.zone)}`
        case 'density': return p.on ? `Allowed taller building in ${zone(p.zone)}` : `Stopped taller building in ${zone(p.zone)}`
        case 'repair': return `${p.work === 'patch' ? 'Patched' : p.work === 'resurface' ? 'Resurfaced' : 'Laid concrete on'} ${n(p.links.length, 'stretch', 'stretches')} of main road`
        case 'streets': return `${p.work === 'patch' ? 'Patched' : 'Resurfaced'} the streets of ${zone(p.zone)}`
      }
      return 'Built something'
    }
    case 'cancel': return 'Stopped a work under way'
    case 'vehicles': return action.change >= 0 ? `Added ${n(action.change, 'vehicle')} to a line` : `Took ${n(-action.change, 'vehicle')} off a line`
    case 'close': return 'Closed a line'
    case 'upkeep': return action.patchBelow !== undefined && action.patchBelow !== null
      ? `Set road upkeep to ${action.level}, patching streets below ${action.patchBelow}`
      : `Set road upkeep to ${action.level}`
    case 'digOnce': return action.on ? 'Let utilities dig roads only in set months' : 'Let utilities dig roads at any time'
    case 'tax': return `Set property tax to ${Math.round(action.rate / 100)}% of the standard rate`
    case 'fare': return `Set the ${action.mode === 'rail' ? 'suburban rail' : action.mode} fare to ₹${(action.perKm / 100).toFixed(2)} a km`
    case 'borrow': return `Borrowed ${crore(action.amount)}`
    case 'repay': return 'Repaid a loan'
  }
}

/** What another player did and when, month by month. */
export function drawTheirs(body: HTMLElement, name: string, done: Done[], zone: (id: number) => string): void {
  if (!done.length) {
    body.append(element('p', 'small muted', `${name} ended every month without changing anything.`))
    return
  }
  body.append(element('p', 'small muted', `${name} did ${done.length} ${done.length === 1 ? 'thing' : 'things'} in all.`))
  const list = element('ol', 'their-deeds')
  let month = -1
  let items: HTMLElement | null = null
  for (const d of done) {
    if (d.month !== month) {
      month = d.month
      const li = element('li')
      items = element('ul')
      li.append(element('strong', '', monthLong(month)), items)
      list.append(li)
    }
    items!.append(element('li', '', actionWords(d.action, zone)))
  }
  body.append(list)
}
