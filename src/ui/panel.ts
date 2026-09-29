import { element } from './controls'

/**
 * Five pages, each in a finger's reach on a phone: the score (its seven measures, their reasons and map views, and
 * the month's figures), building, the report, money (the levers that raise and spend it, and the books), and the
 * season's board with the player's games and account.
 */
export type Tab = 'score' | 'build' | 'report' | 'money' | 'board'

const TABS: { tab: Tab; label: string; title: string }[] = [
  { tab: 'score', label: 'Score', title: 'Your score' },
  { tab: 'build', label: 'Build', title: 'Build' },
  { tab: 'report', label: 'Report', title: 'Report' },
  { tab: 'money', label: 'Money', title: 'Money' },
  { tab: 'board', label: 'Board', title: 'This season' },
]

/**
 * The one panel the game's pages open in, one at a time: a card at the left on a laptop, with its tabs along its top;
 * on a phone, a sheet over the lower part of the map, with its tabs in the dock along the bottom. Closed, only the
 * tabs show.
 */
export class Panel {
  readonly root = element('section', 'card panel')
  readonly tabs = element('nav', 'tabs')
  private readonly title = element('h2', '')
  readonly body = element('div', 'panel-body')
  tab: Tab | null = null

  constructor(private readonly onOpen: (tab: Tab, body: HTMLElement) => void, private readonly onClose: () => void) {
    this.tabs.setAttribute('aria-label', 'Pages')
    for (const { tab, label } of TABS) {
      const b = element('button', '', label)
      b.type = 'button'
      b.dataset.tab = tab
      b.setAttribute('aria-pressed', 'false')
      b.addEventListener('click', () => (this.tab === tab ? this.close() : this.open(tab)))
      this.tabs.append(b)
    }
    const close = element('button', 'close', '×')
    close.type = 'button'
    close.setAttribute('aria-label', 'Close')
    close.addEventListener('click', () => this.close())
    const head = element('div', 'panel-head')
    head.append(this.title, close)
    this.root.append(this.tabs, head, this.body)
    this.root.hidden = false
    document.body.append(this.root)
    this.mark()
  }

  open(tab: Tab): void {
    this.tab = tab
    this.title.textContent = TABS.find((t) => t.tab === tab)!.title
    this.body.replaceChildren()
    this.body.scrollTop = 0
    this.mark()
    this.onOpen(tab, this.body)
  }

  close(): void {
    this.tab = null
    this.mark()
    this.onClose()
  }

  /** Draws the open page again, if it is `tab`. */
  refresh(tab: Tab): void {
    if (this.tab === tab) {
      const top = this.body.scrollTop
      this.body.replaceChildren()
      this.onOpen(tab, this.body)
      this.body.scrollTop = top
    }
  }

  private mark(): void {
    document.body.classList.toggle('panel-open', !!this.tab)
    this.root.classList.toggle('open', !!this.tab)
    this.root.dataset.tab = this.tab ?? ''
    for (const b of this.tabs.querySelectorAll<HTMLButtonElement>('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.tab === this.tab))
    }
  }
}
