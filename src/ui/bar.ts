import type { Game } from '../rules/types'
import { element } from './controls'
import { crore, grouped, monthShort, signedCrore } from './format'

/** How far the last month ended moved the score, in points of 1,000; null before any month has ended. */
export function scoreMoved(game: Game): number | null {
  const s = game.reports.at(-1)?.score
  return s ? s.now.total - s.before.total : null
}

/** How far a skip goes: to the next thing that needs the player, or a number of months. */
export type Skip = 'needs' | 3 | 6 | 12

const SKIPS: { skip: Skip; label: string }[] = [
  { skip: 'needs', label: 'To the next thing that needs me' },
  { skip: 3, label: '3 months' },
  { skip: 6, label: '6 months' },
  { skip: 12, label: '12 months' },
]

export interface BarHooks {
  /** The score was tapped: open the score page. */
  onScore(): void
  onNext(): void
  onSkip(skip: Skip): void
  onStop(): void
  /** Leaves another player's city for the player's own game. */
  onBack(): void
}

function button(className: string, text: string): HTMLButtonElement {
  const b = element('button', className, text)
  b.type = 'button'
  return b
}

/** A word for approval, 0 to 100. */
export function approvalWord(approval: number): string {
  if (approval >= 70) return 'high'
  if (approval >= 55) return 'fair'
  if (approval >= 45) return 'uneasy'
  if (approval >= 30) return 'low'
  return 'very low'
}

/**
 * The top bar (PRD 13.1): the month and how many of 120, money and the last month's balance, and the score with which
 * way it went last month, always in sight. The commute and approval are two of the score's measures and live in its
 * page. The daily allowance shows where it is on (PRD TIME-7). `turn` holds "Next month" and "Skip"; on a
 * laptop it sits in the bar, on a phone in the dock along the bottom.
 */
export class Bar {
  readonly root = element('header', 'card bar')
  readonly turn = element('div', 'turn')
  private readonly date = element('span', 'bar-date')
  private readonly money = element('span', 'bar-money')
  private readonly score = element('button', 'bar-score')
  private readonly next = button('next', '')
  private readonly skip = button('skip', '')
  private readonly back = button('commit back', 'Back to my game')
  private readonly menu = element('div', 'card skip-menu')
  /** "Practice", or whose city is being looked round; the months left today; months not yet sent. */
  private readonly tag = element('span', 'bar-tag')
  private readonly allow = element('span', 'bar-allow')
  private readonly unsent = element('span', 'bar-unsent')
  private skipping = false
  private viewing = false
  /** Months that may still be played today, where the allowance is on. */
  private left: number | null = null

  constructor(hooks: BarHooks) {
    const title = element('span', 'bar-title')
    title.append(element('strong', '', 'Peak Ooru'), ' ', Object.assign(element('span', '', 'ಪೀಕ್ ಊರು'), { lang: 'kn' }))
    const figures = element('span', 'bar-figures')
    figures.append(this.date, this.tag, this.money, this.allow, this.unsent)
    this.tag.hidden = this.allow.hidden = this.unsent.hidden = true
    this.back.hidden = true
    this.back.addEventListener('click', () => hooks.onBack())
    this.score.type = 'button'
    this.score.hidden = true
    this.score.addEventListener('click', () => hooks.onScore())
    this.root.append(title, figures, this.score, this.turn)
    this.root.setAttribute('aria-label', 'The month and the money')
    this.next.innerHTML = 'Next<span class="long"> month</span>'
    this.next.addEventListener('click', () => (this.skipping ? hooks.onStop() : hooks.onNext()))
    this.skip.innerHTML = 'Skip <span aria-hidden="true">▾</span>'
    this.skip.setAttribute('aria-label', 'Skip ahead')
    this.skip.setAttribute('aria-expanded', 'false')
    this.skip.addEventListener('click', () => this.openMenu(this.menu.hidden === true))
    this.menu.hidden = true
    this.menu.setAttribute('role', 'menu')
    this.menu.append(element('div', 'muted small skip-title', 'Skip ahead'))
    for (const { skip, label } of SKIPS) {
      const b = button('', label)
      b.setAttribute('role', 'menuitem')
      b.dataset.skip = String(skip)
      b.addEventListener('click', () => {
        this.openMenu(false)
        hooks.onSkip(skip)
      })
      this.menu.append(b)
    }
    this.menu.append(element('p', 'muted small', 'A skip stops early for anything that needs you.'))
    this.turn.append(this.next, this.skip, this.back)
    document.body.append(this.root, this.menu)
    // A tap anywhere else puts the menu away.
    document.addEventListener('pointerdown', (e) => {
      if (!this.menu.hidden && !this.menu.contains(e.target as Node) && !this.skip.contains(e.target as Node)) {
        this.openMenu(false)
      }
    })
  }

  /** Puts a button beside the score: "What could I do now?". */
  beside(button: HTMLElement): void {
    this.score.after(button)
  }

  openMenu(open: boolean): void {
    this.menu.hidden = !open
    this.skip.setAttribute('aria-expanded', String(open))
    if (!open) return
    const r = this.skip.getBoundingClientRect()
    // Below the button on a laptop, above it when it sits at the bottom of the screen.
    const below = r.top < innerHeight / 2
    this.menu.style.top = below ? `${r.bottom + 6}px` : ''
    this.menu.style.bottom = below ? '' : `${innerHeight - r.top + 6}px`
    this.menu.style.right = `${Math.max(8, innerWidth - r.right)}px`
  }

  /** Shows the game as it stands. */
  show(game: Game, _times: number[]): void {
    // When the game is over, the last month played.
    const shown = game.status === 'playing' ? game.month : Math.max(0, game.month - 1)
    // Each figure has a long form and, for a phone's one line, a short one; the style shows one of them.
    const both = (className: string, long: string, short: string) => {
      const span = element('span', className)
      span.append(element('span', 'long', long), element('span', 'short', short))
      return span
    }
    this.date.replaceChildren(
      element('strong', '', monthShort(shown)),
      both('muted', ` · month ${shown + 1} of ${game.season.months}`, ` · ${shown + 1} of ${game.season.months}`),
    )
    const last = game.reports.at(-1)
    const balance = last ? last.books.reduce((sum, e) => sum + e.amount, 0) : null
    this.money.replaceChildren(
      both(game.money < 0 ? 'red strong' : 'strong', crore(game.money), crore(game.money, ' cr')),
    )
    if (balance !== null) {
      this.money.append(
        both(`muted ${balance < 0 ? 'red' : ''}`, ` ${signedCrore(balance)} last month`, ` ${signedCrore(balance, ' cr')}`),
      )
    }
    // The score, and which way the last month moved it.
    this.score.hidden = !game.score
    if (game.score) {
      const moved = scoreMoved(game)
      const way = moved === null ? '' : moved > 0 ? `↑${moved}` : moved < 0 ? `↓${-moved}` : '→'
      const words = moved === null ? '' : moved > 0 ? `, up ${moved} last month` : moved < 0 ? `, down ${-moved} last month` : ', no change last month'
      this.score.setAttribute('aria-label', `Score ${game.score.total} of 1,000${words}. Open the score.`)
      this.score.title = 'Your score, out of 1,000. What it is made of, and why it moved.'
      this.score.replaceChildren(element('span', 'bar-score-name', 'Score'), element('strong', 'bar-score-total', grouped(game.score.total)))
      if (way) this.score.append(element('span', `bar-score-way ${moved! < 0 ? 'down' : ''}`, way))
    }
    const over = game.status !== 'playing'
    this.next.disabled = over || this.left === 0
    this.skip.disabled = over || this.left === 0
    for (const b of this.menu.querySelectorAll<HTMLButtonElement>('button[data-skip]')) {
      const n = Number(b.dataset.skip)
      b.disabled = over || (n > 0 && game.month + n > game.season.months) || (n > 0 && this.left !== null && n > this.left)
    }
  }

  /**
   * What kind of game is shown: the player's ranked game (nothing said), a practice game (said plainly), or another
   * player's city, which has no turn to take, only a way back.
   */
  mode(kind: 'ranked' | 'practice' | 'view', whose = ''): void {
    this.viewing = kind === 'view'
    this.tag.hidden = kind === 'ranked'
    this.tag.className = `bar-tag ${kind}`
    this.tag.textContent = kind === 'practice' ? 'Practice' : kind === 'view' ? `${whose}’s city` : ''
    this.next.hidden = this.skip.hidden = this.viewing
    this.back.hidden = !this.viewing
    this.root.classList.toggle('viewing', this.viewing)
    if (this.viewing) this.allow.hidden = this.unsent.hidden = true
  }

  /** The daily allowance (PRD TIME-7): months left today and when more come, or null where it is off. */
  allowance(left: number | null, more: Date | null): void {
    this.left = left
    this.allow.hidden = left === null || this.viewing
    if (left === null) return
    const at = more ? more.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : ''
    const span = (className: string, text: string) => element('span', className, text)
    this.allow.classList.toggle('red', left === 0)
    this.allow.title = more ? `Twelve months a day, up to 36 held. More at ${at}.` : ''
    this.allow.replaceChildren(left > 0
      ? span('long', `${left} ${left === 1 ? 'month' : 'months'} left today`)
      : span('long', `No months left today · more at ${at}`),
    span('short', left > 0 ? `${left} left` : `0 left · ${at}`))
  }

  /** Months ended here and not yet acknowledged by the server, when it cannot be reached. */
  waiting(count: number, offline: boolean): void {
    this.unsent.hidden = !count || !offline || this.viewing
    const words = `${count} ${count === 1 ? 'month' : 'months'} not yet sent`
    this.unsent.title = 'The server cannot be reached. Your months are kept here and sent when it can.'
    this.unsent.replaceChildren(element('span', 'long', `Offline · ${words}`), element('span', 'short', `Offline · ${count}`))
  }

  /** While months are worked out: what is happening, and whether it can be stopped. Null when done. */
  busy(text: string | null, stoppable = false): void {
    this.skipping = !!text && stoppable
    this.root.classList.toggle('busy', !!text)
    this.root.dataset.busy = text ?? ''
    this.next.innerHTML = this.skipping ? 'Stop' : 'Next<span class="long"> month</span>'
    this.next.classList.toggle('stop', this.skipping)
    this.next.disabled = (!!text && !stoppable) || (!text && this.left === 0)
    this.skip.disabled = !!text || this.left === 0
    if (text) {
      let note = this.root.querySelector('.bar-busy')
      if (!note) {
        note = element('span', 'bar-busy')
        this.root.querySelector('.bar-figures')!.append(note)
      }
      note.textContent = text
    } else this.root.querySelector('.bar-busy')?.remove()
  }
}
