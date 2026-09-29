// Works out one month without a screen and prints what it came to.
//   npx vite-node tools/run-month.ts [runs]       the city's figures, the slowest roads, the time taken
//   npx vite-node tools/run-month.ts --digest     only the fingerprint of the result (also: bun tools/run-month.ts --digest)
//   npx vite-node tools/run-month.ts --engines    the fingerprint here and in Firefox, WebKit and Chromium, which must agree
//   npx vite-node tools/run-month.ts --levers     what each lever does: fares halved and doubled, 10% more people
//   npx vite-node tools/run-month.ts --engines --loaded   the same, with ten more metro lines and twenty bus routes
import { readFileSync } from 'node:fs'
import type { Network, Transit, Zone } from '../src/data/types'
import { digest } from '../src/sim/digest'
import { linkKmh, simulate, stages, type MonthDetail } from '../src/sim/index'
import { DEFAULT_PRICES } from '../src/sim/params'
import { MODES, PERIODS, type CityState, type Period, type RoutingNetwork } from '../src/sim/types'
import { loaded } from './measure-city'

const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../public/data/${file}`, import.meta.url), 'utf8')) as T

/** The city as it stands in January 2026, from the data files. */
export function loadCity(): CityState {
  return {
    month: 0,
    seed: 1,
    zones: read<Zone[]>('zones.json'),
    roads: read<RoutingNetwork>('routing.json'),
    transit: read<Transit>('transit.json'),
  }
}

/** Speed on the roads, by period: vehicle-km over vehicle-hours, on all roads and on primary roads and above. */
export function roadSpeeds(state: CityState, r: MonthDetail): Record<Period, { all: number; main: number }> {
  const out = {} as Record<Period, { all: number; main: number }>
  for (const p of PERIODS) {
    let km = 0, h = 0, mkm = 0, mh = 0
    for (const l of state.roads.links) {
      const f = r.flow[p][l.id]!
      const v = linkKmh(state.roads, r, p, l)
      const k = (f * l.length) / 1000
      km += k
      h += k / v
      if (l.kind === 'motorway' || l.kind === 'trunk' || l.kind === 'primary') {
        mkm += k
        mh += k / v
      }
    }
    out[p] = { all: km / h, main: mkm / mh }
  }
  return out
}

async function main() {
  const state = loadCity()
  if (process.argv.includes('--engines')) return engines(process.argv.includes('--loaded') ? loaded(state) : state)
  if (process.argv.includes('--levers')) return levers(state)
  if (process.argv.includes('--digest')) {
    const r = simulate(state)
    console.log(digest(r), `${r.took.toFixed(0)} ms`)
    return
  }
  const runs = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 3)
  let r = simulate(state)
  const times: number[] = [r.took]
  for (let k = 1; k < runs; k++) {
    r = simulate(state)
    times.push(r.took)
  }
  const net = read<Network>('network.json')
  const names = new Map(net.links.map((l) => [l.id, l.name]))

  const total = MODES.reduce((s, m) => s + r.trips[m], 0)
  console.log(`zones ${state.zones.length}, routing nodes ${state.roads.nodes.length}, links ${state.roads.links.length}`)
  const sorted = [...times].sort((a, b) => a - b)
  console.log(`took ${times.map((t) => t.toFixed(0)).join(', ')} ms; least ${sorted[0]!.toFixed(0)}, median ${sorted[sorted.length >> 1]!.toFixed(0)}`)
  console.log('  stages, per run: ' + Object.entries(stages).map(([k, v]) => `${k} ${(v / runs).toFixed(0)}`).join(', '))
  console.log(`commute ${(r.commute / 60).toFixed(1)} min door to door (of it ${(r.commuteDelay / 60).toFixed(1)} min lost to traffic), access ${(r.access / 10).toFixed(1)}% of jobs in 45 min`)
  console.log(`trips a weekday ${(total / 1e6).toFixed(2)} M (${(total / state.zones.reduce((s, z) => s + z.people, 0)).toFixed(2)} a person)`)
  for (const m of MODES) {
    const c = r.commuteByMode[m]
    const p = r.costParts[m]
    console.log(
      `  ${m.padEnd(11)} ${(r.trips[m] / 1e6).toFixed(2).padStart(6)} M ${((100 * r.trips[m]) / total).toFixed(1).padStart(5)}%` +
        `   work ${(c.trips / 1e6).toFixed(2)} M at ${(c.seconds / 60).toFixed(0)} min` +
        `   cost: ${p.time} min, ₹${p.money}, comfort ${p.comfort}, danger ${p.danger}`,
    )
  }
  const sp = roadSpeeds(state, r)
  for (const p of PERIODS) {
    let veh = 0
    let cap = 0
    for (const l of state.roads.links) {
      veh += (r.flow[p][l.id]! * l.length) / 1000
      cap += ((l.capacity * l.length) / 1000) * r.vehiclesPerPcu[p]
    }
    console.log(`${p.padEnd(8)} speed ${sp[p].all.toFixed(1)} km/h all roads, ${sp[p].main.toFixed(1)} on main roads; ${(veh / 1e6).toFixed(2)} M vehicle-km an hour, ${((100 * veh) / cap).toFixed(0)}% of capacity`)
  }
  console.log('riders:', Object.entries(r.riders).filter(([, v]) => v > 0).map(([k, v]) => `${k.slice(0, 40)} ${v}`).join('; '))

  // The slowest main links at the evening peak, by name, with the flow in car units against capacity (also in car units).
  const slow = state.roads.links
    .filter((l) => l.length > 150 && l.kind !== 'tertiary')
    .map((l) => ({ l, v: linkKmh(state.roads, r, 'evening', l), f: r.flow.evening[l.id]! }))
    .sort((a, b) => a.v - b.v || a.l.id - b.l.id)
  const seen = new Set<string>()
  console.log('slowest at the evening peak (vehicles an hour; car units an hour against capacity):')
  let n = 0
  for (const { l, v, f } of slow) {
    const name = l.drawn.map((d) => names.get(d)).find((x) => x) ?? `(unnamed ${l.kind})`
    if (seen.has(name)) continue
    seen.add(name)
    const node = state.roads.nodes[l.from]!.at
    const pcu = f / r.vehiclesPerPcu.evening
    console.log(
      `  ${name.slice(0, 40).padEnd(40)} ${l.kind.padEnd(9)} ${v.toFixed(1).padStart(4)} km/h of ${l.speed}, ` +
        `${f} veh/h, ${pcu.toFixed(0)} PCU/h against ${l.capacity} (${(pcu / l.capacity).toFixed(2)})  @${(node[1] / 1e6).toFixed(4)},${(node[0] / 1e6).toFixed(4)}`,
    )
    if (++n === 20) break
  }
  const over = (p: Period, x: number) =>
    state.roads.links.filter((l) => r.flow[p][l.id]! / r.vehiclesPerPcu[p] > x * l.capacity).reduce((s, l) => s + l.length / 1000, 0)
  for (const p of PERIODS) {
    let most = 0
    for (const l of state.roads.links) most = Math.max(most, r.flow[p][l.id]! / r.vehiclesPerPcu[p] / l.capacity)
    console.log(`${p.padEnd(8)} most flow against capacity ${most.toFixed(2)}; km of road above 1.0: ${over(p, 1).toFixed(0)}, above 1.25: ${over(p, 1.25).toFixed(0)}, above 1.45: ${over(p, 1.45).toFixed(0)}`)
  }
}

/** The month with each lever moved on its own, against the month as it is, as a table in Markdown. */
function levers(state: CityState) {
  const d = DEFAULT_PRICES
  const cases: [string, CityState][] = [
    ['As it is', state],
    ['Metro fare halved', { ...state, prices: { metroPerKm: d.metroPerKm / 2 } }],
    ['Metro fare doubled', { ...state, prices: { metroPerKm: d.metroPerKm * 2 } }],
    ['Bus fare halved', { ...state, prices: { busPerKm: d.busPerKm / 2 } }],
    ['Bus fare doubled', { ...state, prices: { busPerKm: d.busPerKm * 2 } }],
    ['10% more people', { ...state, zones: state.zones.map((z) => ({ ...z, people: Math.round(z.people * 1.1) })) }],
    ['10% more people and jobs', { ...state, zones: state.zones.map((z) => ({ ...z, people: Math.round(z.people * 1.1), jobs: Math.round(z.jobs * 1.1) })) }],
  ]
  const lines = ['purple', 'green', 'yellow']
  console.log('| Case | ' + MODES.join(' | ') + ' | ' + lines.join(' | ') + ' | Fares: bus, metro, rail | Commute | Speed morning, evening (main) | ms |')
  console.log('|' + ' --- |'.repeat(MODES.length + lines.length + 5))
  for (const [name, s] of cases) {
    const r = simulate(s)
    const sp = roadSpeeds(s, r)
    const lakh = (x: number) => (x / 1e5).toFixed(1)
    console.log(
      `| ${name} | ` +
        MODES.map((m) => (r.trips[m] / 1e6).toFixed(2)).join(' | ') + ' | ' +
        lines.map((l) => (r.riders[l]! / 1e3).toFixed(0)).join(' | ') + ' | ' +
        `${lakh(r.fares.bus)}, ${lakh(r.fares.metro)}, ${lakh(r.fares.rail)} | ${(r.commute / 60).toFixed(1)} | ` +
        `${sp.morning.all.toFixed(1)}, ${sp.evening.all.toFixed(1)} (${sp.morning.main.toFixed(1)}, ${sp.evening.main.toFixed(1)}) | ${r.took.toFixed(0)} |`,
    )
  }
  console.log('Trips in millions a weekday; riders in thousands of boardings; fares in lakh rupees a weekday.')
}

/**
 * Works out the month in three browser engines (SpiderMonkey, JavaScriptCore, V8) through Playwright, and here, and
 * prints each fingerprint, and the time of the first month and of five more. The model and the city are bundled into one
 * script with esbuild.
 */
async function engines(state: CityState) {
  const { build } = await import('esbuild')
  const pw = await import('playwright-core')
  const entry = `
    import { simulate } from './src/sim/index'
    import { digest } from './src/sim/digest'
    globalThis.run = (state) => {
      const r = simulate(state)
      const t = []
      for (let k = 0; k < 5; k++) t.push(simulate(state).took)
      t.sort((a, b) => a - b)
      return digest(r) + ' first ' + r.took.toFixed(0) + ' ms, then least ' + t[0].toFixed(0) + ', median ' + t[2].toFixed(0)
    }`
  const out = await build({
    stdin: { contents: entry, resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' },
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    define: { 'import.meta.env.BASE_URL': '"/"' },
  })
  const code = out.outputFiles[0]!.text
  const here = simulate(state)
  console.log('node (V8)'.padEnd(26), digest(here), `${here.took.toFixed(0)} ms`)
  for (const [name, type] of [['firefox (SpiderMonkey)', pw.firefox], ['webkit (JavaScriptCore)', pw.webkit], ['chromium (V8)', pw.chromium]] as const) {
    const browser = await type.launch({ headless: true })
    const page = await browser.newPage()
    await page.addScriptTag({ content: code })
    const answer = await page.evaluate((s) => (globalThis as unknown as { run: (s: unknown) => string }).run(s), state)
    console.log(name.padEnd(26), answer)
    await browser.close()
  }
}

main()
