import type { Game } from '../rules/types'
import { ordered, points } from '../game/score'
import { lineChart } from './chart'
import { cityPicture, type CityPicture } from './citymap'
import { element } from './controls'
import { crore, grouped, monthLong, year } from './format'
import { pointsBar } from './score'
import { shareCard, type ShareInput } from '../share'

export interface EndingHooks {
  restart(): void
  /** What the button that starts again says: the ranked game's one restart, or a practice game. */
  again: string
  /** Fills the box for the rank on the season's board (and asks for a name, where there is none). */
  rank(into: HTMLElement): void
  /** Opens the board. */
  board(): void
  /** What the player did, in short lines, when the worker has said. */
  deeds: Promise<string[]>
  /** What the picture of the city is drawn from, when the map has it; null if the map's data is not to hand. */
  picture: Promise<CityPicture | null>
  /**
   * Slice 9: what the share picture needs from the page, once known: the game's id on the server (null for a game kept
   * only here, which then has no link), the player's name, the rank, and a way to send the picture to the server. Left
   * out, the picture is drawn without a link, rank or name, to be saved.
   */
  share?: Promise<Omit<ShareInput, 'game' | 'picture'>>
}

/** How the game ended, in a few words for under the score. */
function howItEnded(game: Game, last: number): string {
  if (game.status === 'default') return `The city defaulted in ${monthLong(last)}`
  if (game.status === 'replaced') return `Replaced in ${monthLong(last)}`
  return 'Term completed'
}

/**
 * The end of the game (PRD UI-18): a picture made to be looked at and shown to someone. The city and the years; the
 * final score, large; the seven measures as seven plain bars; the score by year as one line; three lines of what the
 * player did; how it ended; the city as they left it; the rank on the season's board.
 */
export function showEnding(game: Game, hooks: EndingHooks): HTMLElement {
  const veil = element('div', 'ending final-veil')
  const card = element('section', 'card ending-card final')
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-modal', 'true')
  card.setAttribute('aria-label', 'Your term is over')
  const last = game.reports.at(-1)?.to ?? Math.max(0, game.month - 1)
  const score = game.score ?? game.reports.at(-1)?.score?.now ?? null

  const head = element('header', 'final-head')
  const name = element('p', 'final-name')
  name.append('Peak Ooru ', Object.assign(element('span', '', 'ಪೀಕ್ ಊರು'), { lang: 'kn' }))
  head.append(name, element('h2', '', `Bengaluru, 2026–${year(last) + (last % 12 === 11 ? 1 : 0)}`))
  card.append(head)

  const top = element('div', 'final-top')
  const left = element('div', 'final-score')
  const total = element('p', 'final-total')
  total.append(element('strong', '', score ? grouped(score.total) : '–'), element('span', '', 'of 1,000'))
  left.append(element('p', 'final-label', 'Governance score'), total)
  left.append(element('p', `final-how ${game.status === 'finished' ? '' : 'early'}`, howItEnded(game, last)))
  if (score?.penalty) left.append(element('p', 'small muted', `Less ${grouped(score.penalty.points)}: ${score.penalty.text}`))
  const rank = element('div', 'final-rank')
  left.append(rank)
  hooks.rank(rank)
  top.append(left)
  const pic = element('figure', 'final-map')
  top.append(pic)
  void hooks.picture.then((p) => (p ? pic.replaceChildren(cityPicture(p)) : pic.remove()))
  card.append(top)

  if (score) {
    const list = element('div', 'final-measures')
    for (const m of ordered(score)) {
      const row = element('div', 'final-measure')
      row.append(element('span', 'final-measure-name', m.name), pointsBar(m.points), element('strong', '', String(points(m))))
      list.append(row)
    }
    card.append(list)
  }

  const bottom = element('div', 'final-bottom')
  // The score at the start and at the end of each year.
  const first = game.reports.find((r) => r.score)?.score?.before.total
  const years = [...(first !== undefined ? [first] : []), ...(game.scores ?? [])]
  if (game.status !== 'finished' && score && years.at(-1) !== score.total) years.push(score.total)
  const chartBox = element('div', 'final-years')
  if (years.length > 1) {
    chartBox.append(element('h3', '', 'Score by year'))
    const chart = lineChart([{ values: years, colour: '#26231f' }], ['2026', String(year(last) + (last % 12 === 11 ? 1 : 0))], (v) => grouped(v))
    chart.setAttribute('aria-label', 'The score at the end of each year')
    chartBox.append(chart)
  }
  const deeds = element('ul', 'final-deeds')
  deeds.append(element('li', 'muted', '…'))
  void hooks.deeds.then((lines) => deeds.replaceChildren(...lines.map((l) => element('li', '', l)))).catch(() => deeds.replaceChildren())
  bottom.append(chartBox, deeds)
  card.append(bottom)

  if (game.status === 'default') {
    card.append(element('p', 'small muted', 'Money was below nothing for three months running. The state took over the ' +
      'city’s finances and the score stands as it was, less a penalty.'))
  } else if (game.status === 'replaced') {
    card.append(element('p', 'small muted', 'Approval was under 30 at two yearly reviews running. The state replaced ' +
      'you as commissioner, and the score stands as it was, less a penalty.'))
  } else {
    const owed = game.loans.reduce((s, l) => s + l.owed, 0)
    card.append(element('p', 'small muted', `The city ends with ${crore(game.money)}${owed > 0 ? ` and owes ${crore(owed)}` : ' and owes nothing'}.`))
  }

  const share = element('div', 'final-share')
  card.append(share)
  // The picture waits a little for the page's part (the id, name and rank), and is drawn without them if it is slow.
  const none = { id: null, name: null, rank: null }
  const rest = Promise.race([(hooks.share ?? Promise.resolve(none)).catch(() => none), new Promise<typeof none>((r) => setTimeout(() => r(none), 8000))])
  void Promise.all([hooks.picture.catch(() => null), rest]).then(([picture, r]) => shareCard(share, { game, picture, ...r }))

  const buttons = element('div', 'final-buttons')
  const board = element('button', 'commit', 'See the board')
  board.type = 'button'
  board.addEventListener('click', () => {
    veil.remove()
    hooks.board()
  })
  const again = element('button', 'quiet', hooks.again)
  again.type = 'button'
  again.addEventListener('click', () => {
    veil.remove()
    hooks.restart()
  })
  const look = element('button', 'quiet', 'Look round the city')
  look.type = 'button'
  look.addEventListener('click', () => veil.remove())
  buttons.append(board, look, again)
  card.append(buttons)
  veil.append(card)
  document.body.append(veil)
  // In reach of the keyboard, without a focus ring in the picture a player will show.
  board.focus({ focusVisible: false } as FocusOptions)
  return veil
}
