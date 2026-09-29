import type { Board, SeasonInfo } from '../net'
import type { Game } from '../rules/types'
import { element } from './controls'
import { grouped, monthLong } from './format'
import { daysLeft, rankWords } from './season'
import { openedLines } from './report'
import './first.css'

export interface Welcome {
  season: SeasonInfo | null
  game: Game
  practice: boolean
  /** Months that may be played today, where the daily allowance is on. */
  left: number | null
  /** The top of the season's board and the player's place on it, when the server answers. */
  board: Promise<Board | null>
  carryOn(): void
  openBoard(): void
}

/**
 * The start screen for a player coming back (PRD UI-10): the season and the days left, their game and where they
 * left it, what needs them or is coming, and the top of the board. One press to carry on.
 */
export function showWelcome(w: Welcome): HTMLElement {
  const veil = element('div', 'ending welcome')
  const card = element('section', 'card ending-card')
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-modal', 'true')
  card.setAttribute('aria-label', 'Welcome back')
  card.append(element('h2', '', 'Welcome back'))
  if (w.season) card.append(element('p', 'small muted', `${w.season.name} · ${daysLeft(w.season)}`))
  const g = w.game
  const score = g.score?.total
  card.append(element('p', '', `${w.practice ? 'Your practice game' : 'Your game'} is at ${monthLong(g.month)}` +
    `${score === undefined ? '' : `, with a score of ${grouped(score)}`}.` +
    (w.left !== null ? ` You have ${w.left} ${w.left === 1 ? 'month' : 'months'} to play today.` : '')))

  // What needs the player, and what is coming: from the last report and the works under way.
  const last = g.reports.at(-1)
  // The year's end is said by the review, and a line opening by the needs: neither twice.
  const lines: string[] = last ? [...(last.urgent ?? []), ...openedLines(last)] : []
  for (const e of g.events ?? []) {
    if (e.ends >= g.month && e.kind !== 'opening') lines.push(`${e.title}${e.ends > g.month ? `, until ${monthLong(e.ends)}` : ''}.`)
  }
  const soon = (g.projects ?? []).filter((p) => p.opens - g.month <= 2).sort((a, b) => a.opens - b.opens)
  for (const p of soon.slice(0, 2)) lines.push(`${p.name} opens in ${monthLong(p.opens)}.`)
  if (!lines.length && last?.news.length) lines.push(...last.news.slice(0, 2))
  if (lines.length) {
    const list = element('ul', 'small')
    for (const l of lines.slice(0, 4)) list.append(element('li', '', l))
    card.append(element('h3', '', 'Where you left it'), list)
  }

  const board = element('div', 'small welcome-board')
  card.append(board)
  void w.board.then((b) => {
    if (!b || !b.rows.length) return board.remove()
    const list = element('ol', 'small')
    for (const r of b.rows.slice(0, 3)) list.append(element('li', '', `${r.player.name || 'A player'}: ${grouped(r.score)}`))
    board.append(element('h3', '', 'Top of the board'), list)
    if (b.mine) board.append(element('p', 'small', `You are ${rankWords(b.mine, b.total)}.`))
  }, () => board.remove())

  const go = element('button', 'commit', 'Carry on')
  go.type = 'button'
  go.addEventListener('click', () => {
    veil.remove()
    w.carryOn()
  })
  const see = element('button', 'quiet', 'See the board')
  see.type = 'button'
  see.addEventListener('click', () => {
    veil.remove()
    w.openBoard()
  })
  card.append(go, see)
  veil.append(card)
  document.body.append(veil)
  go.focus()
  return veil
}
