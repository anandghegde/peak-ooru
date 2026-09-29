// The share picture and link for a finished game (PRD MP-14). Slice 9, person M.
import type { Game } from '../rules/types'
import { cityHeight, drawCity, type CityPicture } from '../ui/citymap'
import { shareLine } from './line'
import './share.css'

export interface ShareInput {
  game: Game
  /** The game's id on the server, if it has one: the link opens this city. */
  id: string | null
  name: string | null
  rank: { rank: number; total: number } | null
  /** What the picture of the city is drawn from; without it the picture has no map. */
  picture?: CityPicture | null
  /**
   * Sends the landscape picture to the server for the link's preview (`PUT /api/games/:id/picture`). Given only for
   * the player's own ranked game once the server has its last month. Called at most once a game on this device.
   */
  upload?: (png: Blob) => Promise<void>
}

/** What a picture says, worked out once for both sizes. */
export interface ShareWords {
  score: number
  line: string
  rank: string | null
  name: string | null
  years: string
}

const INK = '#26231f'
const MUTED = '#6f6a62'
const PAPER = '#fffdf9'
const RULE = '#ebe5da'
const FACE = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans Kannada', 'Kannada Sangam MN', sans-serif"
const font = (weight: number, size: number) => `${weight} ${size}px ${FACE}`

/** The two sizes: 1200 × 630 for a link's preview and a chat, 1080 × 1350 for a phone's share sheet. */
export const SIZES = { wide: [1200, 630], tall: [1080, 1350] } as const
export type Size = keyof typeof SIZES

export function shareWords(input: ShareInput): ShareWords {
  const g = input.game
  const last = g.measured?.at(-1)?.month ?? g.month - 1
  const year = 2026 + Math.floor(Math.max(0, last) / 12)
  return {
    score: g.score?.total ?? 0,
    line: shareLine(g).text,
    rank: input.rank ? `#${input.rank.rank.toLocaleString('en-IN')} of ${input.rank.total.toLocaleString('en-IN')} this season` : null,
    name: input.name,
    years: `Bengaluru, 2026–${g.status === 'finished' ? 2036 : year}`,
  }
}

/** Breaks words into lines no wider than `width` in the context's font. */
function wrap(c: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = []
  let now = ''
  for (const word of text.split(' ')) {
    const next = now ? `${now} ${word}` : word
    if (now && c.measureText(next).width > width) {
      lines.push(now)
      now = word
    } else now = next
  }
  if (now) lines.push(now)
  return lines
}

/** The line at the largest size, from `most` down, at which it fits in `rows` lines of `width`. */
function fit(c: CanvasRenderingContext2D, text: string, width: number, rows: number, most: number): { size: number; lines: string[] } {
  for (let size = most; size > 24; size -= 2) {
    c.font = font(700, size)
    const lines = wrap(c, text, width)
    if (lines.length <= rows) return { size, lines }
  }
  c.font = font(700, 24)
  return { size: 24, lines: wrap(c, text, width) }
}

function spaced(c: CanvasRenderingContext2D, px: number): void {
  if ('letterSpacing' in c) (c as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${px}px`
}

/** The name of the game, in English and Kannada, small and muted as the ending heads itself. */
function brand(c: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  c.fillStyle = MUTED
  c.font = font(500, size)
  spaced(c, size * 0.12)
  c.fillText('PEAK OORU', x, y)
  const w = c.measureText('PEAK OORU ').width
  spaced(c, 0)
  c.font = font(500, size * 1.05)
  c.fillText('ಪೀಕ್ ಊರು', x + w + size * 0.3, y)
}

/** The rank as a pill, as the ending shows it; gives the x after it. */
function pill(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number): number {
  c.font = font(600, size)
  const w = c.measureText(text).width + size * 1.4
  const h = size * 1.9
  c.fillStyle = '#f3efe8'
  c.beginPath()
  c.roundRect(x, y - h * 0.68, w, h, size * 0.6)
  c.fill()
  c.fillStyle = INK
  c.fillText(text, x + size * 0.7, y)
  return x + w
}

/**
 * Draws the share picture: in the ending's look (white paper, the city as the ending draws it, the score large, plain
 * numbers), with the one line first, since it is what a person reads in a chat before they tap.
 */
export function drawShare(canvas: HTMLCanvasElement, words: ShareWords, picture: CityPicture | null, size: Size): void {
  const [W, H] = SIZES[size]
  canvas.width = W
  canvas.height = H
  const c = canvas.getContext('2d')!
  c.fillStyle = PAPER
  c.fillRect(0, 0, W, H)
  c.textBaseline = 'alphabetic'
  if (size === 'wide') {
    const left = 64
    const col = 560
    brand(c, left, 84, 22)
    c.fillStyle = INK
    c.font = font(700, 34)
    c.fillText(words.years, left, 128)
    c.fillStyle = RULE
    c.fillRect(left, 150, col, 2)
    const { size: s, lines } = fit(c, words.line, col, 3, 46)
    c.fillStyle = INK
    lines.forEach((l, i) => c.fillText(l, left, 150 + 30 + s + i * s * 1.18))
    score(c, words, left, 520, 150)
    // How a game ended early is said by its line, so is not said again here.
    let x = left
    const y = 578
    if (words.rank) x = pill(c, words.rank, x, y, 20) + 18
    if (words.name) {
      c.fillStyle = MUTED
      c.font = font(500, 22)
      c.fillText(words.name, x, y)
    }
    if (picture) {
      const width = 520
      drawCity(c, picture, 1200 - 40 - width, (H - cityHeight(width)) / 2, width)
    }
  } else {
    const left = 80
    const col = W - 2 * left
    brand(c, left, 110, 30)
    c.fillStyle = INK
    c.font = font(700, 46)
    c.fillText(words.years, left, 172)
    c.fillStyle = RULE
    c.fillRect(left, 204, col, 2)
    const { size: s, lines } = fit(c, words.line, col, 3, 66)
    c.fillStyle = INK
    lines.forEach((l, i) => c.fillText(l, left, 204 + 36 + s + i * s * 1.18))
    const top = 204 + 36 + lines.length * s * 1.18 + 30
    if (picture) {
      // Down to above the score, as wide as the page allows.
      const width = Math.min(col, Math.floor(((1060 - top) * 300) / cityHeight(300)))
      drawCity(c, picture, (W - width) / 2, top, width)
    }
    score(c, words, left, 1230, 180)
    let x = left
    const y = 1292
    if (words.rank) x = pill(c, words.rank, x, y, 26) + 22
    if (words.name) {
      c.fillStyle = MUTED
      c.font = font(500, 28)
      c.fillText(words.name, x, y)
    }
  }
}

/** The score, large, with "of 1,000" beside it, on a baseline at `y`. */
function score(c: CanvasRenderingContext2D, words: ShareWords, x: number, y: number, size: number): void {
  c.fillStyle = INK
  c.font = font(700, size)
  spaced(c, -size * 0.04)
  const text = words.score.toLocaleString('en-IN')
  c.fillText(text, x, y)
  const w = c.measureText(text).width
  spaced(c, 0)
  c.fillStyle = MUTED
  c.font = font(500, size * 0.17)
  c.fillText('of 1,000', x + w + size * 0.1, y)
}

/** Waits for the faces the picture is drawn in, so that it is not drawn in a fallback. */
export async function fontsReady(): Promise<void> {
  if (!document.fonts) return
  await Promise.all([
    document.fonts.load(font(700, 40), 'Bengaluru 0123456789'),
    document.fonts.load(font(500, 20), 'PEAK OORU'),
    document.fonts.load(font(500, 20), 'ಪೀಕ್ ಊರು'),
  ]).catch(() => null)
  await document.fonts.ready
}

const png = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be made.'))), 'image/png'))

/** The address a shared link goes to: the server's small page with the preview, which sends a person on to the city. */
export function shareLink(id: string): string {
  return new URL(`${import.meta.env.BASE_URL}share/${encodeURIComponent(id)}`, location.href).href
}

/** The words that go with the picture into a chat. */
export function shareText(words: ShareWords): string {
  return `${words.line} My score: ${words.score.toLocaleString('en-IN')} of 1,000. Beat that.`
}

function button(text: string, cls: string, run: (b: HTMLButtonElement) => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = cls
  b.textContent = text
  b.addEventListener('click', () => run(b))
  return b
}

function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Puts the share picture, its one line, and the buttons to share or save it into `into`. */
export function shareCard(into: HTMLElement, input: ShareInput): void {
  const words = shareWords(input)
  const box = document.createElement('div')
  box.className = 'share'
  const wide = document.createElement('canvas')
  const tall = document.createElement('canvas')
  wide.className = 'share-picture'
  wide.setAttribute('role', 'img')
  wide.setAttribute('aria-label', `The picture to share: ${words.line} Score ${words.score} of 1,000.`)
  const said = document.createElement('div')
  said.className = 'share-said'
  const line = document.createElement('p')
  line.className = 'share-line'
  line.textContent = words.line
  const buttons = document.createElement('div')
  buttons.className = 'share-buttons'
  const status = document.createElement('p')
  status.className = 'share-status small muted'
  status.setAttribute('aria-live', 'polite')
  said.append(line, buttons, status)
  box.append(wide, said)
  into.append(box)

  const link = input.id ? shareLink(input.id) : null
  const name = `peak-ooru-${words.score}.png`
  const drawn = fontsReady().then(() => {
    drawShare(wide, words, input.picture ?? null, 'wide')
    drawShare(tall, words, input.picture ?? null, 'tall')
  })
  const files = drawn.then(async () => ({ wide: await png(wide), tall: await png(tall) }))

  // The picture goes to the server once, for the link's preview in a chat.
  if (input.id && input.upload) {
    const key = `peakooru.picture.${input.id}`
    let sent = false
    try {
      sent = localStorage.getItem(key) === '1'
    } catch {
      // Sent again at worst, and the server refuses a second.
    }
    if (!sent) {
      void files.then((f) => input.upload!(f.wide)).then(() => {
        try {
          localStorage.setItem(key, '1')
        } catch {
          // As above.
        }
      }, (e: unknown) => console.warn('The share picture was not sent:', String(e)))
    }
  }

  const copy = async (b: HTMLButtonElement) => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(`${shareText(words)} ${link}`)
      b.textContent = 'Link copied'
      status.textContent = 'The link and your line are copied. Paste them into a chat.'
    } catch {
      status.textContent = `Copy this link: ${link}`
    }
  }

  // The phone's own share sheet, with the picture as a file, where the browser offers one; else save and copy.
  const probe = new File([new Uint8Array(1)], name, { type: 'image/png' })
  const sheet = typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] })
  if (sheet) {
    buttons.append(button('Share', 'commit', () => {
      void files.then(async (f) => {
        const text = link ? `${shareText(words)} ${link}` : shareText(words)
        try {
          await navigator.share({ files: [new File([f.tall], name, { type: 'image/png' })], text })
        } catch (e) {
          if ((e as Error).name !== 'AbortError') status.textContent = 'It could not be shared. Save the picture instead.'
        }
      })
    }))
  }
  buttons.append(button('Save the picture', sheet ? 'quiet' : 'commit', () => void files.then((f) => save(f.wide, name))))
  // A game with no link (a practice game, or one the server does not yet have whole) offers the picture alone.
  if (link) buttons.append(button('Copy the link', 'quiet', (b) => void copy(b)))
}
