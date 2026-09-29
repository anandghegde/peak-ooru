// Slice 9, job 1: "What could I do now?" measured.
//   npx vite-node tools/measure-advice.ts calibrate [months=0,12,36]   each thing looked at, its estimate against what
//        twelve months with it and without give (the score as the year in hand scores it)
//   npx vite-node tools/measure-advice.ts time        how long advice takes, at several months of a game
//   npx vite-node tools/measure-advice.ts player [n] [--check]  a scripted player who each month does the first n (1)
//        suggestions and nothing else, for ten years; its score against doing nothing (423 on the slice 8 figures)
import { readFileSync } from 'node:fs'
import type { Transit, Zone } from '../src/data/types'
import { candidates } from '../src/rules/advise'
import { forecast, rules } from '../src/rules/index'
import { MEASURES, averageOf, pointsFor, marksOf } from '../src/rules/score'
import { SCORE } from '../src/rules/params'
import type { Action, CityData, Game } from '../src/rules/types'
import { firstSeason } from '../src/seasons/first'
import { simulate } from '../src/sim/index'
import type { RoutingNetwork } from '../src/sim/types'

const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../public/data/${file}`, import.meta.url), 'utf8')) as T
const city: CityData = { zones: read<Zone[]>('zones.json'), roads: read<RoutingNetwork>('routing.json'), transit: read<Transit>('transit.json') }

/** The score as the year in hand would score the last twelve months (approval thirty-six), as a real number. */
function yearNow(g: Game): number {
  const marks = marksOf(g)
  let sum = 0
  for (const key of MEASURES) sum += pointsFor(averageOf(g.measured ?? [], key), marks[key]) * SCORE.weights[key]
  return sum / 1000
}

function month(g: Game, acts: Action[] = []) {
  for (const a of acts) rules.act(g, city, a)
  rules.endMonth(g, city, simulate(rules.state(g, city)))
}

function gameAt(m: number): Game {
  const g = rules.start(firstSeason, city)
  while (g.month < m) month(g)
  return g
}

function calibrate(months: number[]) {
  for (const m of months) {
    const g0 = gameAt(m)
    const t = performance.now()
    const { list } = candidates(g0, city, { simulate }, { ...rules, forecast })
    console.log(`\nmonth ${m}: ${list.length} things looked at (${(performance.now() - t).toFixed(0)} ms)`)
    const base = structuredClone(g0)
    for (let k = 0; k < 12; k++) month(base)
    const without = yearNow(base)
    for (const c of list) {
      const g = structuredClone(g0)
      for (const a of c.actions) {
        const o = rules.act(g, city, a)
        if (!o.ok) console.log(`   refused: ${o.reason}`)
      }
      for (let k = 0; k < 12; k++) month(g)
      const got = yearNow(g) - without
      console.log(`  ${c.lever.padEnd(10)} est ${c.score.toFixed(1).padStart(6)} (traffic ${c.traffic.toFixed(1)}${c.basis !== undefined ? `, basis ${c.basis.toExponential(2)}` : ''})  actual ${got.toFixed(1).padStart(6)}   ${c.title}; ₹${(c.cost / 100).toFixed(1)} cr`)
    }
  }
}

function time() {
  for (const m of [0, 6, 24, 60]) {
    const g = gameAt(m)
    const times: number[] = []
    for (let k = 0; k < 5; k++) {
      const t = performance.now()
      rules.advise!(g, city)
      times.push(performance.now() - t)
    }
    const t = performance.now()
    const checked = rules.advise!(g, city, { simulate })
    const withModel = performance.now() - t
    console.log(`month ${m}: estimates only ${Math.min(...times).toFixed(0)} ms least, ${times.sort((a, b) => a - b)[2]!.toFixed(0)} median; with the check ${withModel.toFixed(0)} ms`)
    for (const a of checked) console.log(`   ${a.score >= 0 ? '+' : ''}${a.score}${a.checked ? ' (checked)' : ''}  ${a.title}  ₹${(a.cost / 100).toFixed(1)} cr`)
  }
}

/** A player who does only what is suggested: each month, the first `n` suggestions. */
export function advised(g: Game, n: number): Action[] {
  const list = rules.advise!(g, city, { count: Math.max(3, n) })
  return list.slice(0, n).flatMap((a) => a.actions)
}

function player(n: number, check: boolean) {
  const g = rules.start(firstSeason, city)
  const t0 = performance.now()
  let ms = 0
  const did: string[] = []
  while (g.status === 'playing') {
    const t = performance.now()
    const list = rules.advise!(g, city, { count: Math.max(3, n) })
    ms = Math.max(ms, performance.now() - t)
    for (const a of list.slice(0, n)) {
      let ok = true
      for (const act of a.actions) ok = rules.act(g, city, act).ok && ok
      if (ok) did.push(`${g.month}: ${a.title} (est ${a.score})`)
    }
    rules.endMonth(g, city, simulate(rules.state(g, city)))
    if (g.month % 12 === 0 || g.status !== 'playing') console.log(`  ${2025 + g.month / 12}: score ${g.score!.total}, year ${g.score!.years!.at(-1)!.total}, money ₹${Math.round(g.money / 100)} cr, approval ${(g.approval ?? 550) / 10}  [${g.score!.measures.map((m) => Math.round(m.points / 10)).join(' ')}]`)
  }
  for (const d of did) console.log(`  ${d}`)
  console.log(`advised (${n} a month): ${g.status}, score ${g.score!.total}; ${((performance.now() - t0) / 1000).toFixed(0)} s, slowest advice ${ms.toFixed(0)} ms`)
  if (check) {
    const again = rules.replay(firstSeason, city, g.done, simulate)
    console.log(`  replay: ${JSON.stringify(again) === JSON.stringify(g) ? 'the same game' : 'DIFFERENT'}`)
  }
}

/** The advised player's game at a month, and every thing looked at then, with its estimate. */
function at(m: number, n: number) {
  const g = rules.start(firstSeason, city)
  while (g.month < m) {
    for (const a of rules.advise!(g, city, { count: Math.max(3, n) }).slice(0, n)) for (const act of a.actions) rules.act(g, city, act)
    month(g)
  }
  const { list } = candidates(g, city, {}, { ...rules, forecast })
  console.log(`month ${m}: money ₹${Math.round(g.money / 100)} cr, lowest within a year ₹${Math.round(Math.min(g.money, ...forecast(g, city, 12).map((f) => f.money)) / 100)} cr`)
  for (const c of list.sort((a, b) => b.score - a.score)) console.log(`  ${c.lever.padEnd(10)} ${c.score.toFixed(1).padStart(6)} (traffic ${c.traffic.toFixed(1)}, standing ${c.standing.toFixed(1)}, spend ${c.spend}, running ${c.running})  ${c.title}`)
}

const args = process.argv.slice(2)
if (args[0] === 'at') at(Number(args[1] ?? 12), Number(args[2] ?? 1))
if (args[0] === 'calibrate') calibrate((args[1] ?? '0,12,36').split(',').map(Number))
else if (args[0] === 'time') time()
else if (args[0] === 'player') player(Number(args[1] ?? 1), args.includes('--check'))
