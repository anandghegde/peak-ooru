import { describe, expect, it } from 'vitest'
import { allEvents, eventsIn, seasonEvents, strikes } from '../src/rules/events'
import { rules } from '../src/rules/index'
import { EVENTS } from '../src/rules/params'
import type { Game, Season } from '../src/rules/types'
import { simulate } from '../src/sim/index'
import { smallCity, testSeason } from './rules-city'

/* Events (slice 7, PRD section 9): fixed by the season, announced, at most three at once, undone exactly. */

const city = smallCity()
const season: Season = { ...testSeason, elections: [21, 81], openings: [{ line: 'north-south', month: 20, stations: 3 }] }
const fresh = (s = season): Game => rules.start(s, city)
const month = (g: Game) => rules.endMonth(g, city, simulate(rules.state(g, city)))

describe('the season\'s events (PRD EVT-1 to EVT-7)', () => {
  const events = seasonEvents(season, city)

  it('are the same for every player of the season, and follow from its seed alone', () => {
    expect(JSON.stringify(seasonEvents({ ...season }, city))).toBe(JSON.stringify(events))
    expect(JSON.stringify(seasonEvents({ ...season, seed: 2 }, city))).not.toBe(JSON.stringify(events))
  })

  it('bring every kind the season sets: monsoon, opening, festival, cave-in, employer, fuel, election', () => {
    const kinds = new Set(events.map((p) => p.event.kind))
    for (const k of ['monsoon', 'opening', 'festival', 'cavein', 'employer', 'fuel', 'election']) expect(kinds.has(k as never)).toBe(true)
  })

  it('leave the first three months quiet, and have at most two of the season\'s in force at once', () => {
    for (const p of events) expect(p.event.started).toBeGreaterThanOrEqual(EVENTS.quiet)
    for (let m = 0; m < season.months; m++) expect(events.filter((p) => p.event.started <= m && p.event.ends >= m).length).toBeLessThanOrEqual(EVENTS.most)
  })

  it('say what happens in plain sentences, with a place where there is one', () => {
    for (const p of events) {
      expect(p.event.title).not.toMatch(/!/)
      expect(p.event.text).toMatch(/\.$/)
      if (p.event.kind === 'cavein') expect(p.event.at && p.event.links?.length).toBeTruthy()
      if (p.event.kind === 'employer') expect(p.event.at && p.event.zones?.length).toBeTruthy()
    }
  })
})

describe('what an event does, and undoing it (PRD EVT-10 to EVT-12)', () => {
  const events = seasonEvents(season, city)

  it('puts a festival\'s trips into its month only', () => {
    const festival = events.find((p) => p.event.kind === 'festival' && p.effect?.surge)!
    const g = fresh()
    g.month = festival.event.started
    expect(rules.state(g, city).surge).toBe(festival.effect!.surge)
    g.month = festival.event.ends + 1
    expect(rules.state(g, city).surge).toBeUndefined()
  })

  it('shuts a cave-in\'s road for its months, and opens it again exactly', () => {
    const cave = events.find((p) => p.event.kind === 'cavein')!
    const g = fresh()
    g.month = cave.event.started
    const during = rules.state(g, city).shut ?? {}
    for (const id of cave.effect!.shut!) expect(during[id]).toBe(1000)
    g.month = cave.event.ends + 1
    const after = rules.state(g, city).shut ?? {}
    for (const id of cave.effect!.shut!) expect(after[id] ?? 0).toBeLessThan(1000)
  })

  it('changes the price of fuel for its months only', () => {
    const fuel = events.find((p) => p.event.kind === 'fuel')!
    const g = fresh()
    const usual = rules.state(g, city).prices!.fuel!
    g.month = fuel.event.started
    expect(rules.state(g, city).prices!.fuel).toBe(Math.round((usual * fuel.effect!.fuel!) / 10) / 100)
    g.month = fuel.event.ends + 1
    expect(rules.state(g, city).prices!.fuel).toBe(usual)
  })

  it('keeps a new employer\'s jobs for good', () => {
    const job = events.find((p) => p.event.kind === 'employer')!
    const zone = job.effect!.jobs!.zone
    const g = fresh()
    g.month = job.event.started - 1
    const before = rules.state(g, city).zones.find((z) => z.id === zone)!.jobs
    g.month = job.event.started
    expect(rules.state(g, city).zones.find((z) => z.id === zone)!.jobs).toBe(before + job.effect!.jobs!.jobs)
    g.month = season.months - 1
    expect(rules.state(g, city).zones.find((z) => z.id === zone)!.jobs).toBeGreaterThanOrEqual(before + job.effect!.jobs!.jobs)
  })

  it('is told in the news when it begins and when it ends, and listed in the report and the game', () => {
    const g = fresh()
    const cave = events.find((p) => p.event.kind === 'cavein')!
    while (g.month < cave.event.ends + 1 && g.status === 'playing') month(g)
    const began = g.reports[cave.event.started - 1]!
    expect(began.news.join(' ')).toContain(cave.event.title)
    expect(began.events?.map((e) => e.id)).toContain(cave.event.id)
    expect(began.needs.join(' ')).toContain(cave.event.title)
    if (cave.event.ends > cave.event.started) expect(g.reports[cave.event.ends]!.news.join(' ')).toMatch(/open again/)
    g.month = cave.event.started
    expect(eventsIn(g, city).map((p) => p.event.id)).toContain(cave.event.id)
  })
})

describe('strikes (PRD EVT-8)', () => {
  it('follow a fare raised by a fifth or more in a month, the next month, and not a smaller rise', () => {
    const g = fresh()
    expect(rules.act(g, city, { kind: 'fare', mode: 'bus', perKm: 180 })).toEqual({ ok: true })
    expect(strikes(g)).toEqual([])
    expect(rules.act(g, city, { kind: 'fare', mode: 'bus', perKm: 200 })).toEqual({ ok: true })
    const [s] = strikes(g)
    expect(s!.event).toMatchObject({ kind: 'strike', started: 1, ends: 1 })
    expect(s!.effect!.busService).toBeLessThan(1000)
    month(g)
    expect(rules.state(g, city).busService).toBe(s!.effect!.busService)
    expect(g.reports[0]!.news.join(' ')).toMatch(/buses are on strike/)
    month(g)
    expect(rules.state(g, city).busService).toBeUndefined()
  })

  it('keep the events in force to three at most', () => {
    const g = fresh()
    for (let m = 0; m < 30; m++) {
      if (m % 3 === 0) rules.act(g, city, { kind: 'fare', mode: 'bus', perKm: m % 6 === 0 ? 300 : 160 })
      month(g)
    }
    for (let m = 0; m < 31; m++) expect(allEvents(g, city).filter((p) => p.event.kind !== 'opening' && p.event.started <= m && p.event.ends >= m).length).toBeLessThanOrEqual(3)
  })
})

describe('elections (PRD EVT-7)', () => {
  it('cut the state\'s grant when approval is low, and keep it when it is middling', () => {
    const low = fresh()
    while (low.month <= 21) {
      if (low.month === 21) low.approval = 350
      month(low)
    }
    expect(low.reports[21]!.news.join(' ')).toMatch(/corporation elections are over/)
    expect(low.grantShare).toBeDefined()
    const g = fresh()
    const grant = g.season.grant
    g.grantShare = 8000
    expect(rules.books(g, city).find((e) => e.key === 'grant')!.amount).toBe(Math.round((grant * 8000) / 10_000))
  })
})

describe('every sentence an event can write (PRD UI-8)', async () => {
  const { readFileSync } = await import('node:fs')
  const { endWords } = await import('../src/rules/index')
  const { electionResult } = await import('../src/rules/events')
  const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../public/data/${file}`, import.meta.url), 'utf8')) as T
  const real = { zones: read('zones.json'), roads: read('routing.json'), transit: read('transit.json') } as typeof city
  const { firstSeason } = await import('../src/seasons/first')
  const texts: string[] = []
  for (let seed = 1; seed <= 20; seed++) {
    for (const p of seasonEvents({ ...firstSeason, seed }, real)) {
      texts.push(`${p.event.title}. ${p.event.text}`)
      if (p.event.ends > p.event.started) texts.push(endWords(p.event))
    }
  }
  const g = rules.start(firstSeason, real)
  rules.act(g, real, { kind: 'fare', mode: 'bus', perKm: 250 })
  rules.act(g, real, { kind: 'fare', mode: 'metro', perKm: 700 })
  for (const p of strikes(g)) texts.push(`${p.event.title}. ${p.event.text}`)
  for (const a of [300, 500, 700]) texts.push(electionResult(a).news)

  it('are plain sentences: a length where there is one, no place named twice, no exclamation marks', () => {
    expect(texts.length).toBeGreaterThan(400)
    for (const t of texts) {
      expect(t, t).toMatch(/^[A-Z].*\.$/)
      expect(t, t).not.toMatch(/!|\s\s|\.\./)
      expect(t, t).not.toMatch(/\b0 km\b|\b0\.0 km\b/)
      expect(t, t).not.toMatch(/near ([A-Z][\w .]*?) near \1/)
      expect(t, t).not.toMatch(/\b(\w+) \1\b/)
      expect(t, t).not.toMatch(/undefined|NaN|null/)
    }
  })
})

describe('a short season', () => {
  it('places its events within its months, and plays to its end', () => {
    const short: Season = { ...season, months: 12, elections: [] }
    for (const p of seasonEvents(short, city)) {
      expect(p.event.started).toBeGreaterThanOrEqual(0)
      expect(p.event.ends).toBeLessThan(12)
    }
    const g = rules.start(short, city)
    while (g.status === 'playing') month(g)
    expect(g.status).toBe('finished')
    expect(g.scores).toHaveLength(1)
  })
})
