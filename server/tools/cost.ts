// What a month costs the server, part by part, in one thread: loading the kept state, the actions, the model, ending
// the month by the rules, and keeping the state again. Also a whole game played again from its actions.
//   npx vite-node server/tools/cost.ts [months]
import { resolve } from 'node:path'
import { rules } from '../../src/rules/index'
import { firstSeason } from '../../src/seasons/first'
import { simulate } from '../../src/sim/index'
import { load, loadCity, replayMonths, save, startGame } from '../src/game'

const city = loadCity(resolve(__dirname, '../../public/data'))
const months = Number(process.argv[2] ?? 24)
const parts = { load: 0, act: 0, model: 0, end: 0, save: 0 }
let state = startGame(firstSeason, city).state
let size = 0
const t0 = performance.now()
for (let m = 0; m < months; m++) {
  let t = performance.now()
  const game = load(state)
  parts.load += performance.now() - t
  t = performance.now()
  if (m % 12 === 0 && m > 0) rules.act(game, city, { kind: 'tax', rate: 10000 + (m / 12) * 100 })
  parts.act += performance.now() - t
  t = performance.now()
  const result = simulate(rules.state(game, city))
  parts.model += performance.now() - t
  t = performance.now()
  rules.endMonth(game, city, result)
  parts.end += performance.now() - t
  t = performance.now()
  state = save(game)
  parts.save += performance.now() - t
  size = state.length
}
const all = performance.now() - t0
console.log(`${months} months, ${(all / months).toFixed(0)} ms a month:`)
for (const [k, v] of Object.entries(parts)) console.log(`  ${k.padEnd(6)} ${(v / months).toFixed(1)} ms`)
console.log(`  state kept: ${(size / 1024).toFixed(0)} KB`)
const plan = Array.from({ length: months }, (_, m) => (m % 12 === 0 && m > 0 ? [{ kind: 'tax' as const, rate: 10000 + (m / 12) * 100 }] : []))
const t1 = performance.now()
replayMonths(firstSeason, city, plan)
console.log(`played again from its actions: ${((performance.now() - t1) / months).toFixed(0)} ms a month`)
