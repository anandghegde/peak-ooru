import type { Action, Advice, Game, Outcome } from '../rules/types'
import type { Forecast } from '../sim/worker'
import { element } from './controls'
import { crore } from './format'
import './first.css'

/** What the advice needs from the screen. */
export interface AdviceHooks {
  game(): Game | null
  /** Up to three things to do now, best first, limited to the levers offered. */
  advise(): Promise<Advice[]>
  /** What an action would do to the score a year on, for advice that came without it. */
  forecast(action: Action): Promise<Forecast>
  act(action: Action): Promise<Outcome>
  /** Shows where a piece of advice is, on the map. */
  show(advice: Advice): void
  /** Opens its plan on the Build page and the map, to look at and order there; false if it has none to open. */
  open(advice: Advice): boolean
  /** Where the card goes: under the bar. */
  top(): number
}

/** "about +4 to your score in a year (estimate)", or how it stands while it is worked out. */
function scoreWords(points: number | null, checked: boolean): string {
  if (points === null) return 'working out what it would do…'
  const n = Math.round(points)
  const how = checked ? 'forecast' : 'estimate'
  if (n === 0) return `little change to your score in a year (${how})`
  return `${checked ? '' : 'about '}${n > 0 ? '+' : '−'}${Math.abs(n)} to your score in a year (${how})`
}

/**
 * "What could I do now?" (slice 9): one press gives three things the player can afford now that are expected to raise
 * the score most, each with its cost and what it should do, and one press to do it. A player who is lost presses this.
 */
export class WhatNow {
  readonly button = element('button', 'quiet what-now')
  private readonly card = element('section', 'card advice')
  private asked = 0

  constructor(private readonly hooks: AdviceHooks) {
    this.button.type = 'button'
    this.button.textContent = 'What now?'
    this.button.title = 'What could I do now? Three things you can afford that should raise your score.'
    this.button.setAttribute('aria-label', 'What could I do now?')
    this.button.setAttribute('aria-expanded', 'false')
    this.button.addEventListener('click', () => (this.card.hidden ? void this.open() : this.close()))
    this.card.hidden = true
    this.card.setAttribute('role', 'dialog')
    this.card.setAttribute('aria-label', 'What you could do now')
    document.body.append(this.card)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.card.hidden) this.close()
    })
    // A touch anywhere else puts it away, as the skip menu is.
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as Node
      if (!this.card.hidden && !this.card.contains(t) && !this.button.contains(t)) this.close()
    })
  }

  close(): void {
    this.card.hidden = true
    this.button.setAttribute('aria-expanded', 'false')
  }

  async open(): Promise<void> {
    const game = this.hooks.game()
    if (!game) return
    const asked = ++this.asked
    this.button.setAttribute('aria-expanded', 'true')
    this.place()
    this.card.hidden = false
    const head = [element('h2', '', 'What you could do now')]
    this.card.replaceChildren(...head, element('p', 'muted small', 'Finding the best things you can afford…'))
    let ideas: Advice[]
    try {
      ideas = await this.hooks.advise()
    } catch (error) {
      this.card.replaceChildren(...head, element('p', 'small', `Nothing could be worked out just now: ${String(error)}`))
      return
    }
    if (asked !== this.asked) return
    if (game.status !== 'playing') {
      this.card.replaceChildren(...head, element('p', 'small', 'This game is over.'))
      return
    }
    if (!ideas.length) {
      this.card.replaceChildren(...head, element('p', 'small', 'Nothing you can afford now is likely to help. End the month, and ask again.'))
      return
    }
    this.card.replaceChildren(...head, element('p', 'muted small', 'Things you can afford now that should raise your score, most first.'))
    for (const idea of ideas) this.card.append(this.item(idea, asked))
    const shut = element('button', 'quiet', 'Close')
    shut.type = 'button'
    shut.addEventListener('click', () => this.close())
    this.card.append(shut)
    this.place()
  }

  private item(idea: Advice, asked: number): HTMLElement {
    const box = element('div', 'advice-item')
    box.append(element('strong', '', idea.title), element('p', '', idea.text))
    const sums = element('p', 'advice-sums')
    const cost = idea.cost ? crore(idea.cost) : 'No cost now'
    const running = idea.running > 0 ? `, then ${crore(idea.running)} a month` : ''
    const known = Number.isFinite(idea.score)
    sums.textContent = `${cost}${running} · ${scoreWords(known ? idea.score : null, idea.checked)}`
    box.append(sums)
    // Advice without its score is sent to the model, one at a time, and filled in as each comes.
    if (!known && idea.actions[0]) {
      void this.hooks.forecast(idea.actions[0]).then((f) => {
        if (asked !== this.asked) return
        const s = f.score
        sums.textContent = `${cost}${running}${s ? ` · ${scoreWords(s.after.total - s.before.total, true)}` : ''}`
      }, () => (sums.textContent = `${cost}${running}.`))
    }
    const row = element('div', 'outlook-buttons')
    const go = element('button', 'commit', 'Do it')
    go.type = 'button'
    go.addEventListener('click', async () => {
      go.disabled = true
      let out: Outcome = { ok: true }
      for (const a of idea.actions) {
        out = await this.hooks.act(a)
        if (!out.ok) break
      }
      row.replaceChildren(element('p', out.ok ? 'small' : 'small reason', out.ok
        ? 'Done. End the month to see what it does.' : out.reason))
    })
    row.append(go)
    // A plan is opened on the map to look at and order there; anything else is shown where it is.
    const plan = idea.actions.length === 1 && idea.actions[0]!.kind === 'build'
    if (plan || idea.links?.length || idea.zone !== undefined || idea.at) {
      const show = element('button', 'quiet', plan ? 'Look at it first' : 'Show me where')
      show.type = 'button'
      show.addEventListener('click', () => {
        this.close()
        if (!plan || !this.hooks.open(idea)) this.hooks.show(idea)
      })
      row.append(show)
    }
    box.append(row)
    return box
  }

  private place(): void {
    const b = this.button.getBoundingClientRect()
    const w = Math.min(380, innerWidth - 32)
    const top = this.hooks.top() + 8
    this.card.style.top = `${Math.round(top)}px`
    // Clear of the dock at the foot of a phone's screen.
    const dock = document.querySelector('.dock')?.getBoundingClientRect()
    this.card.style.maxHeight = `${Math.round((dock ? dock.top : innerHeight) - top - 8)}px`
    this.card.style.left = `${Math.round(Math.max(16, Math.min(innerWidth - w - 16, b.left + b.width / 2 - w / 2)))}px`
  }
}
