// The one line a finished game is shared with (PRD MP-14). No page, no DOM: the server says the same line on the share
// page from its own copy of the game.
import { averageOf, marksOf, pointsFor, scoreOf } from '../rules/score'
import type { Game, MeasureKey } from '../rules/types'

export interface Line {
  text: string
  /** The measure the line is about, or what ended the game, or 'none' for a game that moved nothing sayable. */
  about: MeasureKey | 'default' | 'replaced' | 'none'
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const say = (n: number) => (n <= 10 ? WORDS[n]! : String(n))

/** Whole crore in Indian grouping: "2,400". */
const crore = (lakh: number) => Math.floor(lakh / 100).toLocaleString('en-IN')

/**
 * What a measure's change says, when it is large enough to say and to be true, rounded down so that the line never
 * claims more than the figures show. Figures as `Measured` keeps them.
 */
function claim(key: MeasureKey, was: number, now: number): string | null {
  switch (key) {
    case 'commute': {
      const minutes = Math.floor((was - now) / 60)
      if (minutes < 1) return null
      return `I cut Bengaluru’s commute by ${minutes === 1 ? 'a minute' : `${minutes} minutes`}.`
    }
    case 'access': {
      if (was <= 0 || now - was < 10) return null
      const times = now / was
      if (times >= 3) return 'I tripled the jobs within 45 minutes of the average Bengalurean.'
      if (times >= 2) return 'I doubled the jobs within 45 minutes of the average Bengalurean.'
      const more = Math.floor((times - 1) * 100)
      return more >= 5 ? `I put ${more}% more jobs within 45 minutes of the average Bengalurean.` : null
    }
    case 'clean': {
      const trips = Math.floor((now - was) / 10)
      if (trips < 2) return null
      return `I moved ${say(trips)} in every 100 trips onto buses, trains, cycles and feet.`
    }
    case 'safety': {
      if (was <= 0) return null
      const fell = 1 - now / was
      if (fell >= 0.5) return 'Road deaths fell by half on my watch.'
      if (fell >= 1 / 3) return 'Road deaths fell by a third on my watch.'
      if (fell >= 0.25) return 'Road deaths fell by a quarter on my watch.'
      const pct = Math.floor(fell * 100)
      return pct >= 10 ? `Road deaths fell by ${pct}% on my watch.` : null
    }
    case 'fairness': {
      if (now - was < 30) return null
      return 'I brought the worst-served fifth of Bengaluru closer to the rest.'
    }
    case 'money': {
      if (now - was < 50_000) return null
      return `I left Bengaluru ₹${crore(Math.floor((now - was) / 10_000) * 10_000)} crore better off than I found it.`
    }
    case 'approval': {
      const a = Math.floor(was / 10)
      const b = Math.floor(now / 10)
      if (b - a < 5) return null
      return `I took Bengaluru’s approval from ${a} to ${b}.`
    }
  }
}

/** How much a boast about each measure is worth beside the others: money and fairness are weaker lines to share. */
const APPEAL: Record<MeasureKey, number> = { access: 1, commute: 1.1, clean: 1, safety: 1, fairness: 0.6, money: 0.5, approval: 0.8 }

/**
 * The line for a finished game: what changed most for the better over the ten years, against where the city began
 * (the season's opening figures against the average the score takes of the last year), measured in points of the
 * score, among the changes large enough to say. A game that ended early says how. A game that moved nothing sayable,
 * or that left the city scoring below where it began, says so with good humour: some figures move with no one
 * doing anything (road deaths fall a little in a city left alone), and a player who made the city worse on the whole
 * is not given one of those to boast of.
 */
export function shareLine(game: Game): Line {
  const last = game.measured?.at(-1)?.month ?? game.month - 1
  if (game.status === 'default') return { text: 'I ran Bengaluru out of money. The state had to step in.', about: 'default' }
  if (game.status === 'replaced') {
    return { text: `Bengaluru replaced me in ${2026 + Math.floor(Math.max(0, last) / 12)}. Fair enough.`, about: 'replaced' }
  }
  const opening = game.season.opening
  const measured = game.measured ?? []
  const poor: Line = { text: 'Bengaluru survived me. Just.', about: 'none' }
  if (!opening || !measured.length) return poor
  const began = scoreOf({ ...game, measured: [], status: 'playing' }).total
  if ((game.score?.total ?? scoreOf(game).total) < began) return poor
  const marks = marksOf(game)
  let best: { line: Line; worth: number } | null = null
  for (const key of Object.keys(APPEAL) as MeasureKey[]) {
    const was = opening[key]
    const now = averageOf(measured, key)
    const text = claim(key, was, now)
    if (!text) continue
    const worth = (pointsFor(now, marks[key]) - pointsFor(was, marks[key])) * APPEAL[key]
    if (worth <= 0) continue
    if (!best || worth > best.worth) best = { line: { text, about: key }, worth }
  }
  return best?.line ?? poor
}
