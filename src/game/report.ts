import type { Entry, Report } from '../rules/types'

/**
 * One report for a span of months skipped (PRD TIME-8): the figures from the start of the span to its end, the
 * books summed, the news of every month, and what stopped the skip. The causes are the last month's, since the
 * rules work them out only for the month the player stops at.
 */
export function spanReport(reports: Report[]): Report | null {
  const first = reports[0]
  const last = reports.at(-1)
  if (!first || !last) return null
  if (reports.length === 1) return last
  const books = new Map<string, Entry>()
  for (const r of reports) {
    for (const e of r.books) {
      const kept = books.get(e.key)
      books.set(e.key, kept ? { ...kept, amount: kept.amount + e.amount } : { ...e })
    }
  }
  return {
    from: first.from,
    to: last.to,
    figures: last.figures.map((f) => ({ ...f, before: first.figures.find((g) => g.key === f.key)?.before ?? f.before })),
    books: [...books.values()],
    news: [...new Set(reports.flatMap((r) => r.news))],
    needs: last.needs,
    ...(last.urgent ? { urgent: last.urgent } : {}),
  }
}
