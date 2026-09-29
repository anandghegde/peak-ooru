import type { GameEvent } from '../rules/types'
import { element } from './controls'
import { monthShort } from './format'
import { signal } from './signals'

let card: HTMLElement | null = null
const shown = new Set<number>()

/**
 * A small card when an event that needs the player begins (a strike, a burst main, an election): what it is, until
 * when, and a way to see its place. Once for each event; quiet, not over the map's middle, and not a dialog.
 */
export function showEventCard(event: GameEvent, show: ((e: GameEvent) => void) | null): void {
  if (shown.has(event.id)) return
  shown.add(event.id)
  card?.remove()
  const c = element('section', 'card event-card')
  c.setAttribute('role', 'status')
  c.dataset.event = String(event.id)
  c.append(element('p', 'muted small event-when', event.ends > event.started
    ? `${monthShort(event.started)} to ${monthShort(event.ends)}` : monthShort(event.started)))
  c.append(element('h2', '', event.title), element('p', 'small', event.text))
  const row = element('div', 'outlook-buttons')
  const done = element('button', 'commit', 'Carry on')
  done.type = 'button'
  done.addEventListener('click', () => {
    c.remove()
    if (card === c) card = null
  })
  row.append(done)
  if (event.at && show) {
    const go = element('button', 'quiet', 'Show it')
    go.type = 'button'
    go.addEventListener('click', () => {
      c.remove()
      if (card === c) card = null
      show(event)
    })
    row.append(go)
  }
  c.append(row)
  document.body.append(c)
  card = c
  signal('event')
}

/** Puts away the event card, if one is showing. */
export function hideEventCard(): void {
  card?.remove()
  card = null
}
