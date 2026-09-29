import { element } from './controls'
import { grouped, monthLong } from './format'
import './first.css'

export interface DayEnd {
  /** The first day of this game, or a later one. */
  first: boolean
  /** The months played at this sitting, first and last, and the score before and after. */
  from: number
  to: number
  scoreFrom: number
  scoreTo: number
  /** What the player did in the game, in short lines. */
  deeds: Promise<string[]>
  /** When more months may be played, where the daily allowance is on; null where it is off. */
  more: Date | null
  /** Whether months may still be played today. */
  canGoOn: boolean
  goOn(): void
  practice(): void
}

/** "in 5 hours", "in 40 minutes". */
function fromNow(at: Date): string {
  const minutes = Math.max(1, Math.round((at.getTime() - Date.now()) / 60_000))
  if (minutes < 90) return `in ${minutes} minutes`
  return `in about ${Math.round(minutes / 60)} hours`
}

/**
 * The end of a day's play (slice 9): what the player achieved today, when to come back, and a way to go on, in
 * practice where the day's months are used up.
 */
export function showDayEnd(day: DayEnd): HTMLElement {
  const veil = element('div', 'ending day-end')
  const card = element('section', 'card ending-card')
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-modal', 'true')
  card.setAttribute('aria-label', day.first ? 'Your first day' : 'Your day')
  const months = day.to - day.from + 1
  card.append(element('h2', '', day.first ? 'Your first day' : 'Your day'))
  card.append(element('p', '', `You governed Bengaluru for ${months} month${months === 1 ? '' : 's'}, ` +
    `${monthLong(day.from)} to ${monthLong(day.to)}.`))
  const d = day.scoreTo - day.scoreFrom
  const score = element('div', 'review-score')
  score.append(element('span', 'muted', 'Score'), element('strong', '', grouped(day.scoreTo)),
    element('span', `muted ${d < 0 ? 'down' : ''}`, d === 0 ? 'the same as when you began today'
      : `${d > 0 ? 'up' : 'down'} ${Math.abs(d)} since you began today (${grouped(day.scoreFrom)})`))
  card.append(score)
  const list = element('ul', 'small')
  card.append(element('h3', '', 'What you did'), list)
  list.append(element('li', 'muted', 'Gathering what you did…'))
  void day.deeds.then((lines) => {
    list.replaceChildren(...(lines.length ? lines.slice(0, 4).map((l) => element('li', '', l)) : [element('li', '', 'You let the city run itself.')]))
  }, () => list.remove())
  const when = day.more
    ? `Twelve more months arrive at midnight, India time, ${fromNow(day.more)}. Your city is kept until then.`
    : 'Your city is kept here and on the server. Come back tomorrow and carry on where you left off.'
  card.append(element('p', '', when))
  const go = element('button', 'commit', day.canGoOn ? 'Carry on playing' : 'Play a practice game')
  go.type = 'button'
  go.addEventListener('click', () => {
    veil.remove()
    if (day.canGoOn) day.goOn()
    else day.practice()
  })
  card.append(go)
  const stop = element('button', 'quiet', day.canGoOn ? 'Stop for today' : 'Look round my city')
  stop.type = 'button'
  stop.addEventListener('click', () => veil.remove())
  card.append(stop)
  veil.append(card)
  document.body.append(veil)
  go.focus()
  return veil
}
