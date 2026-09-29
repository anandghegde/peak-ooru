import { arriving, unlocked, type Lever } from '../rules/unlock'
import { element } from './controls'
import './first.css'

/*
 * Levers a few at a time (slice 9): in a first game the Build and Money pages begin with the few levers that matter
 * first, and the rest arrive over the first year in the order the rules set (`src/rules/unlock.ts`), each announced in
 * one line. A returning player (one who has played a game past its first year here), or one who asks, has all at once.
 * This limits what the pages offer, never what the rules allow.
 */

const ALL = 'peakooru.levers'
const PLAYED = 'peakooru.played'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Kept for this visit only.
  }
}

let everything = read(ALL) === 'all' || Number(read(PLAYED) ?? 0) >= 12

/** Notes how far the player has played in any game here: past a first year, they are a returning player. */
export function played(month: number): void {
  if (month > Number(read(PLAYED) ?? 0)) write(PLAYED, String(month))
}

/** The levers the pages offer at `month`, or null for all of them. */
export function offered(month: number): Lever[] | null {
  if (everything) return null
  const levers = unlocked(month)
  return levers.length >= ALL_LEVERS ? null : levers
}
const ALL_LEVERS = new Set(unlocked(1000)).size

/** Offers everything from now on, on this device. */
export function offerAll(): void {
  everything = true
  write(ALL, 'all')
}

/** The line announcing the levers that arrived at `month`, in a first game; null if none did. */
export function arrivedAt(month: number): string | null {
  if (everything || month === 0) return null
  return arriving(month)?.text ?? null
}

/** The Build page's tools, by the lever each uses. */
const TOOL_LEVER: Record<string, Lever> = {
  patch: 'repair', resurface: 'repair', concrete: 'repair', streets: 'streets',
  metro: 'metro', busRoute: 'busRoute', busLane: 'busLane', railService: 'railService',
  road: 'road', flyover: 'road', junction: 'junction', footpaths: 'footpaths', oneWay: 'oneWay',
  speedLimit: 'speedLimit', density: 'density',
}

/** The Money page's parts, by their `data-lever`, and the lever each stands for: standing orders come with upkeep. */
const SECTION_LEVER: Record<string, Lever> = {
  tax: 'tax', fare: 'fare', borrow: 'borrow', upkeep: 'upkeep', digOnce: 'digOnce', orders: 'upkeep',
}

/** A button that offers everything, and the count of what is still to come. */
function showAll(hidden: number, what: string, redraw: () => void): HTMLElement {
  const box = element('p', 'muted small show-all')
  box.append(`${hidden} more ${what}${hidden === 1 ? ' arrives' : 's arrive'} over your first year. `)
  const b = element('button', 'quiet', 'Show them all now')
  b.type = 'button'
  b.addEventListener('click', () => {
    offerAll()
    redraw()
  })
  box.append(b)
  return box
}

/**
 * Hides from the Build page's home the tools not yet offered, and groups left with none; says what arrived this
 * month at its head. Leaves a tool that is chosen alone.
 */
export function limitBuild(body: HTMLElement, month: number, redraw: () => void): void {
  const levers = offered(month)
  const news = arrivedAt(month)
  if (news) body.prepend(element('p', 'arrived', news))
  if (!levers) return
  const on = new Set<string>(levers)
  for (const b of body.querySelectorAll<HTMLElement>('[data-tool]')) {
    const lever = TOOL_LEVER[b.dataset.tool ?? '']
    if (lever && !on.has(lever)) b.style.display = 'none'
  }
  // A group with nothing offered in it is not shown; its tools may not have been drawn, if it was closed.
  for (const head of body.querySelectorAll<HTMLElement>('.tool-group[data-group]')) {
    const group = head.dataset.group
    const tools = Object.entries(TOOL_LEVER).filter(([tool]) => groupOf(tool) === group)
    if (!tools.some(([, lever]) => on.has(lever))) head.style.display = 'none'
  }
  const still = Object.values(TOOL_LEVER).filter((l) => !on.has(l)).length
  if (still && !body.querySelector('.build-head')) body.querySelector('.works')?.before(showAll(still, 'tool', redraw))
}

function groupOf(tool: string): string {
  if (['metro', 'busRoute', 'busLane', 'railService'].includes(tool)) return 'transit'
  if (['patch', 'resurface', 'concrete', 'streets'].includes(tool)) return 'upkeep'
  return 'roads'
}

/**
 * Hides from the Money page's levers those not yet offered; a loan section stays while there is a loan to repay. The
 * levers draw themselves again as the player moves them, so the page is watched and the hiding done again each time.
 */
export function limitMoney(body: HTMLElement, month: number, loans: number, redraw: () => void): void {
  const levers = offered(month)
  const news = arrivedAt(month)
  if (news && /tax|loan|fare|upkeep|dig/i.test(news)) body.prepend(element('p', 'arrived', news))
  if (!levers) return watching?.disconnect()
  const on = new Set<string>(levers)
  const hide = () => {
    let hidden = 0
    for (const section of body.querySelectorAll<HTMLElement>('[data-lever]')) {
      const lever = SECTION_LEVER[section.dataset.lever ?? '']
      if (!lever || on.has(lever) || (lever === 'borrow' && loans > 0)) continue
      if (section.style.display !== 'none') section.style.display = 'none'
      hidden++
    }
    if (hidden && !body.querySelector('.show-all')) body.querySelector('.money-tabs')?.after(showAll(hidden, 'lever', redraw))
  }
  hide()
  watching?.disconnect()
  const watch = new MutationObserver(() => {
    // Another page drawn in the panel: its watch is over.
    if (!body.querySelector('.money-tabs')) return watch.disconnect()
    hide()
  })
  watch.observe(body, { childList: true, subtree: true })
  watching = watch
}
let watching: MutationObserver | null = null
