import type { Game, Report, Score } from '../rules/types'
import { ordered, points } from '../game/score'
import { approvalWord } from './bar'
import { element } from './controls'
import { grouped } from './format'
import { figureLine } from './report'
import { pointsBar, signed } from './score'
import { signal } from './signals'

/** The score as it stood at the end of the December before `year`, or at the start for the first year. */
function scoreAYearBefore(game: Game, year: number): Score | null {
  const december = (year - 2026) * 12 - 1
  if (december < 0) return game.reports.find((r) => r.score)?.score?.before ?? null
  return game.reports.find((r) => r.to === december && r.score)?.score?.now ?? null
}

/**
 * The yearly review (PRD UI-13, APP-4) as a card over the map, when a report takes in a December and the rules
 * reviewed the year: the year's score against the last, the seven measures, approval and what it means, a warning if
 * one was given, and the year's figures.
 */
export function showReview(report: Report, game: Game): HTMLElement | null {
  const review = report.review
  if (!review) return null
  const veil = element('div', 'ending review')
  const card = element('section', 'card ending-card')
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-modal', 'true')
  card.append(element('h2', '', `${review.year} in review`))
  const now = game.score ?? report.score?.now ?? null
  const was = scoreAYearBefore(game, review.year)
  if (now) {
    const total = element('div', 'review-score')
    total.append(element('span', 'muted', 'Score'), element('strong', '', grouped(now.total)))
    if (was) {
      const d = now.total - was.total
      total.append(element('span', `muted ${d < 0 ? 'down' : ''}`, d === 0 ? 'the same as a year ago'
        : `${d > 0 ? 'up' : 'down'} ${Math.abs(d)} on a year ago (${grouped(was.total)})`))
    }
    card.append(total)
    const list = element('div', 'review-measures')
    for (const m of ordered(now)) {
      const b = was?.measures.find((x) => x.key === m.key)
      const row = element('div', 'review-measure')
      row.append(element('span', '', m.name), pointsBar(m.points), element('strong', '', String(points(m))),
        element('span', 'muted small', b ? signed(m.points - b.points, 0) : ''))
      list.append(row)
    }
    card.append(list)
  }
  card.append(element('p', 'review-approval', `Approval ${Math.round(review.approval)} of 100: ${approvalWord(review.approval)}.`))
  if (review.warning) {
    card.append(element('p', 'needs', review.warnings > 1
      ? 'A second warning running. The state has lost patience.'
      : 'A warning from the state: approval is under 30. A second warning next December would end your term.'))
  }
  const figures = element('ul', 'report-figures small')
  for (const f of report.figures) figures.append(element('li', '', figureLine(f)))
  card.append(element('h3', '', report.from === report.to ? 'The month' : 'Since the last report'), figures)
  const go = element('button', 'commit', 'Carry on')
  go.type = 'button'
  go.addEventListener('click', () => veil.remove())
  card.append(go)
  veil.append(card)
  document.body.append(veil)
  go.focus()
  signal('review')
  return veil
}
