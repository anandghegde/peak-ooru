import type { Board, BoardRow, GameSummary, Scope } from '../net'
import { element } from './controls'
import { grouped } from './format'

/*
 * The leaderboard (PRD UI-16, MP-10 to MP-12): rank, name, score, the seven measures as small bars, how the game
 * ended or the year it has reached. Asked for from the server a page at a time and drawn only where it is in sight,
 * so that a board of 50,000 rows is a few dozen elements; the player's own row is always in sight, at the foot of the
 * list while it is elsewhere.
 */

/** The height of a row, in pixels: a finger's reach, since a finished city opens from its row. */
export const ROW = 44
const PAGE = 50
/** Pages kept in memory: enough to scroll back and forth without asking again, not enough to grow. */
const PAGES_KEPT = 40

const MEASURE_NAMES = ['Jobs in reach', 'Commute', 'Clean travel', 'Road safety', 'Fairness', 'Money', 'Approval']

/** Points as 0 to 100, whether the server gives them whole or in tenths. */
export function pointsOf(points: number[]): number[] {
  const tenths = points.some((p) => p > 100)
  return points.map((p) => Math.max(0, Math.min(100, tenths ? p / 10 : p)))
}

/** How a game ended, or the year it has reached, in a few words. */
export function howItStands(row: Pick<BoardRow, 'status' | 'year'>): string {
  if (row.status === 'finished') return 'Term completed'
  if (row.status === 'default') return `Defaulted in ${row.year}`
  if (row.status === 'replaced') return `Replaced in ${row.year}`
  return `Playing, in ${row.year}`
}

/** "1st", "22nd", "48th". */
export function ordinal(n: number): string {
  const t = n % 100
  const u = n % 10
  const suffix = t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th'
  return `${grouped(n)}${suffix}`
}

/** The seven measures as seven small bars. */
export function measureBars(points: number[]): HTMLElement {
  const box = element('span', 'board-bars')
  const p = pointsOf(points)
  box.setAttribute('role', 'img')
  box.setAttribute('aria-label', MEASURE_NAMES.map((n, i) => `${n} ${Math.round(p[i] ?? 0)}`).join(', '))
  for (let i = 0; i < 7; i++) {
    const bar = element('i')
    bar.style.height = `${Math.max(1, Math.round(((p[i] ?? 0) / 100) * 16))}px`
    box.append(bar)
  }
  return box
}

export interface BoardHooks {
  /** A page of the board from the server. */
  fetch(scope: Scope, from: number, count: number): Promise<Board>
  /** A finished city's row was chosen: look round it. */
  look(row: BoardRow): void
  /** The game the player is playing, to mark its row. */
  mine(): GameSummary | null
}

/** One board, of one scope, drawn into a scrolling page. */
export class BoardList {
  readonly root = element('div', 'board')
  private readonly list = element('div', 'board-list')
  private readonly pinned = element('div', 'board-pinned')
  private readonly note = element('p', 'muted small board-note')
  private readonly pages = new Map<number, BoardRow[] | Promise<void>>()
  private total = -1
  private mine: BoardRow | null = null
  private drawn = ''
  private failed = false

  constructor(private readonly scope: Scope, private readonly scroller: HTMLElement, private readonly hooks: BoardHooks) {
    this.list.setAttribute('role', 'list')
    this.root.append(this.note, this.list, this.pinned)
    this.pinned.hidden = true
    this.note.textContent = 'Loading the board…'
    scroller.addEventListener('scroll', () => this.draw(), { passive: true })
    addEventListener('resize', () => this.draw())
    void this.load(0)
  }

  /** Scrolls to the player's own row. */
  findMe(): void {
    if (!this.mine) return
    const top = this.list.offsetTop + (this.mine.rank - 1) * ROW
    this.scroller.scrollTo({ top: top - this.scroller.clientHeight / 2 + ROW / 2 })
  }

  private async load(page: number): Promise<void> {
    if (this.pages.has(page)) return
    const asked = this.hooks.fetch(this.scope, page * PAGE, PAGE).then((b) => {
      this.pages.set(page, b.rows)
      this.total = b.total
      this.mine = b.mine
      this.failed = false
      // The pages furthest from this one go first.
      if (this.pages.size > PAGES_KEPT) {
        const far = [...this.pages.keys()].sort((a, b) => Math.abs(b - page) - Math.abs(a - page))[0]!
        this.pages.delete(far)
      }
    }, () => {
      this.pages.delete(page)
      this.failed = true
    }).finally(() => {
      this.drawn = ''
      this.draw()
    })
    this.pages.set(page, asked)
  }

  /** Draws the rows in sight, and asks for the pages they are on. */
  draw(): void {
    if (!this.root.isConnected) return
    if (this.total < 0) {
      if (this.failed) this.note.textContent = 'The board cannot be reached just now. It will be here when the server is.'
      return
    }
    this.list.style.height = `${this.total * ROW}px`
    this.note.textContent = this.total === 0 ? this.emptyWords() : this.total < 20 ? `${grouped(this.total)} ${this.total === 1 ? 'player' : 'players'} so far.` : ''
    this.note.hidden = !this.note.textContent
    const top = this.scroller.scrollTop - this.list.offsetTop
    const first = Math.max(0, Math.floor(top / ROW) - 5)
    const last = Math.min(this.total, Math.ceil((top + this.scroller.clientHeight) / ROW) + 5)
    const key = `${first}:${last}:${this.pages.size}`
    if (key !== this.drawn) {
      this.drawn = key
      const rows: HTMLElement[] = []
      for (let r = first; r < last; r++) {
        const page = Math.floor(r / PAGE)
        const held = this.pages.get(page)
        if (!Array.isArray(held)) {
          void this.load(page)
          rows.push(this.placeholder(r))
          continue
        }
        const row = held[r - page * PAGE]
        rows.push(row ? this.row(row, r) : this.placeholder(r))
      }
      this.list.replaceChildren(...rows)
    }
    // The player's own row in sight: in the list where it is, or held at the foot.
    const mine = this.mine
    const inView = !!mine && (mine.rank - 1) * ROW >= top && mine.rank * ROW <= top + this.scroller.clientHeight - ROW
    this.pinned.hidden = !mine || inView
    if (mine && !inView && this.pinned.dataset.rank !== `${mine.rank}:${mine.score}`) {
      this.pinned.dataset.rank = `${mine.rank}:${mine.score}`
      const row = this.row(mine, -1)
      row.title = 'Go to your place on the board'
      this.pinned.replaceChildren(row)
      row.addEventListener('click', () => this.findMe())
    }
  }

  private emptyWords(): string {
    if (this.scope === 'friends') return 'None of your friends is on the board yet. Add a friend by their code, below.'
    if (this.scope === 'zone') return 'No one from your zone is on the board yet.'
    return 'No one is on the board yet this season.'
  }

  private placeholder(r: number): HTMLElement {
    const row = element('div', 'board-row waiting')
    row.style.top = `${r * ROW}px`
    row.append(element('span', 'board-rank', grouped(r + 1)), element('span', 'board-name muted', '…'))
    return row
  }

  private row(r: BoardRow, at: number): HTMLElement {
    const own = r.game === this.hooks.mine()?.id || r.player.id === this.mine?.player.id
    const open = r.open && !own
    const row = element(open ? 'button' : 'div', `board-row${own ? ' mine' : ''}${open ? ' open' : ''}`)
    if (row instanceof HTMLButtonElement) {
      row.type = 'button'
      row.title = `Look round ${r.player.name}’s city`
      row.addEventListener('click', () => this.hooks.look(r))
    }
    row.setAttribute('role', 'listitem')
    if (at >= 0) row.style.top = `${at * ROW}px`
    const who = element('span', 'board-name')
    who.append(element('span', 'board-who', own ? `${r.player.name} (you)` : r.player.name), element('span', 'board-how', howItStands(r)))
    row.append(element('span', 'board-rank', grouped(r.rank)), who, measureBars(r.points), element('strong', 'board-score', grouped(r.score)))
    return row
  }
}
