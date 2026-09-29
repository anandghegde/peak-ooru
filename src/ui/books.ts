import type { Entry, Game } from '../rules/types'
import { lineChart } from './chart'
import { element } from './controls'
import { crore, decimal, grouped, monthShort, year } from './format'

/** An amount in crore without the sign of the rupee, for a table headed "₹ crore". */
function amount(lakh: number): string {
  const c = Math.abs(lakh) / 100
  const text = c >= 100 ? grouped(c) : decimal(c)
  return lakh < 0 ? `−${text}` : text
}

function sum(entries: Entry[]): number {
  return entries.reduce((s, e) => s + e.amount, 0)
}

/**
 * The books (PRD UI-14, MONEY-6): income and costs by line for this month as things stand, last month and the year
 * so far; the loans, with what is owed and the monthly payment; and money over the next twelve months, as a forecast.
 */
export function drawBooks(
  body: HTMLElement,
  game: Game,
  now: Entry[] | null,
  ahead: { month: number; money: number }[] | null,
  onRestart: () => void,
): void {
  const last = game.reports.at(-1)
  const shownYear = last ? year(last.to) : year(game.month)
  const thisYear = game.reports.filter((r) => year(r.to) === shownYear)
  const columns: { name: string; entries: Entry[] }[] = [
    { name: 'This month', entries: now ?? [] },
    ...(last ? [{ name: 'Last month', entries: last.books }] : []),
    ...(thisYear.length > 1 ? [{ name: `In ${shownYear}`, entries: thisYear.flatMap((r) => r.books) }] : []),
  ]
  const keys = new Map<string, string>()
  for (const c of columns) for (const e of c.entries) keys.set(e.key, e.name)
  const total = (entries: Entry[], key: string) => entries.filter((e) => e.key === key).reduce((s, e) => s + e.amount, 0)

  const table = element('table', 'books')
  const head = element('tr')
  head.append(element('th', 'muted', '₹ crore'), ...columns.map((c) => element('th', '', c.name)))
  table.append(head)
  const rows = [...keys].map(([key, name]) => ({ key, name }))
  // Income first, then costs, each largest first.
  const byColumn = (key: string) => columns.map((c) => total(c.entries, key))
  const income = rows.filter((r) => byColumn(r.key).some((v) => v > 0))
  const costs = rows.filter((r) => !income.includes(r))
  const order = (a: { key: string }, b: { key: string }) =>
    Math.abs(byColumn(b.key).find((v) => v) ?? 0) - Math.abs(byColumn(a.key).find((v) => v) ?? 0)
  for (const [group, list] of [['Income', income.sort(order)], ['Costs', costs.sort(order)]] as const) {
    if (!list.length) continue
    const g = element('tr', 'group')
    g.append(Object.assign(element('th', '', group), { colSpan: columns.length + 1 }))
    table.append(g)
    for (const r of list) {
      const tr = element('tr')
      tr.append(element('td', '', r.name), ...byColumn(r.key).map((v) => element('td', 'n', amount(v))))
      table.append(tr)
    }
  }
  const foot = element('tr', 'total')
  foot.append(element('td', '', 'Balance'), ...columns.map((c) => element('td', 'n', amount(sum(c.entries)))))
  table.append(foot)
  body.append(table)
  if (!now) body.append(element('p', 'muted small', 'Working out this month…'))
  else body.append(element('p', 'muted small', 'This month: as it would end if nothing changes.'))

  body.append(element('h3', '', 'Loans'))
  const loans = game.loans.filter((l) => l.owed > 0)
  if (!loans.length) body.append(element('p', 'muted', 'The city owes nothing.'))
  else {
    const owed = loans.reduce((s, l) => s + l.owed, 0)
    const pay = loans.reduce((s, l) => s + l.payment, 0)
    const list = element('ul', 'loans')
    for (const l of loans) {
      const li = element('li')
      li.append(
        element('strong', '', `${crore(l.owed)} owed`),
        element('span', 'muted', ` of ${crore(l.amount)} borrowed in ${monthShort(l.taken)}`),
        element('div', 'small', `${crore(l.payment)} a month · ${decimal(l.rate / 100)}% a year · ${l.monthsLeft} months left`),
      )
      list.append(li)
    }
    body.append(list, element('p', 'small', `In all ${crore(owed)} owed, ${crore(pay)} a month.`))
  }

  body.append(element('h3', '', 'The next 12 months'))
  if (!ahead) body.append(element('p', 'muted small', 'Working out the forecast…'))
  else if (!ahead.length) body.append(element('p', 'muted small', 'The forecast begins once the first month has ended.'))
  else {
    const tag = element('p', 'forecast-tag', 'Forecast')
    const end = ahead.at(-1)!
    const low = ahead.reduce((a, b) => (b.money < a.money ? b : a))
    const chart = lineChart(
      [{ values: [game.money, ...ahead.map((a) => a.money)], colour: '#3f6f9a' }],
      [monthShort(game.month), monthShort(end.month)],
      (n) => crore(n, ''),
    )
    chart.setAttribute('aria-label', `Money over the next ${ahead.length} months`)
    body.append(
      tag,
      chart,
      element('p', 'small', `As things stand, money in ${monthShort(end.month)}: ${crore(end.money)}.`),
    )
    if (low.money < 0) {
      body.append(element('p', 'small red', `Money would fall below nothing by ${monthShort(low.month)}.`))
    }
    body.append(element('p', 'muted small', 'Traffic held as it is this month, and no change made.'))
  }

  const restart = element('button', 'quiet', 'Start a new game')
  restart.type = 'button'
  restart.addEventListener('click', () => {
    if (confirm('Start a new game? This one will be lost.')) onRestart()
  })
  body.append(restart)
}
