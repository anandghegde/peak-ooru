// Slice 8 (B): what playing a whole game again costs, as the server does to check a game (`rules.replay`): the time in
// the model and in the rules, with the reports written and without.
//   npx vite-node tools/measure-replay.ts [file.json]   a game's list of actions (`Done[]`), or doing nothing
import { readFileSync } from 'node:fs'
import type { Transit, Zone } from '../src/data/types'
import { gameDigest } from '../src/rules/digest'
import { rules } from '../src/rules/index'
import type { CityData, Done } from '../src/rules/types'
import { firstSeason } from '../src/seasons/first'
import { simulate } from '../src/sim/index'
import type { CityState, RoutingNetwork } from '../src/sim/types'

const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../public/data/${file}`, import.meta.url), 'utf8')) as T
const city: CityData = { zones: read<Zone[]>('zones.json'), roads: read<RoutingNetwork>('routing.json'), transit: read<Transit>('transit.json') }
const file = process.argv.slice(2).find((a) => !a.startsWith('--'))
const done: Done[] = file ? (JSON.parse(readFileSync(file, 'utf8')) as Done[]) : []

let model = 0
let runs = 0
const timed = (s: CityState) => {
  const t = performance.now()
  const r = simulate(s)
  model += performance.now() - t
  runs++
  return r
}
for (const reports of [true, false, true, false]) {
  model = 0
  runs = 0
  const t = performance.now()
  const g = rules.replay(firstSeason, city, done, timed, undefined, reports)
  const all = performance.now() - t
  console.log(
    `${reports ? 'with reports   ' : 'without reports'}: ${(all / 1000).toFixed(1)} s for ${g.month} months (${runs} model runs), ` +
      `${(model / runs).toFixed(0)} ms a month in the model, ${((all - model) / runs).toFixed(1)} ms in the rules; ${g.status}, score ${g.score?.total}, ${gameDigest(g)}`,
  )
}
