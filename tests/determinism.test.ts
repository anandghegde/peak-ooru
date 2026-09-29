import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { describe, expect, it } from 'vitest'
import type { Transit, Zone } from '../src/data/types'
import { digest } from '../src/sim/digest'
import { simulate } from '../src/sim/index'
import { MODES, PERIODS, type CityState, type MonthResult, type RoutingNetwork } from '../src/sim/types'
import { fixtureCity } from './sim-fixture'

const read = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../public/data/${file}`, import.meta.url), 'utf8')) as T
const bengaluru = (): CityState => ({
  month: 0,
  seed: 1,
  zones: read<Zone[]>('zones.json'),
  roads: read<RoutingNetwork>('routing.json'),
  transit: read<Transit>('transit.json'),
})

/** Every number of two results, compared one by one. */
function expectSame(a: MonthResult, b: MonthResult) {
  for (const p of PERIODS) {
    expect(Array.from(a.flow[p])).toEqual(Array.from(b.flow[p]))
    expect(Array.from(a.speed[p])).toEqual(Array.from(b.speed[p]))
  }
  expect(a.commute).toBe(b.commute)
  expect(Array.from(a.commuteByZone)).toEqual(Array.from(b.commuteByZone))
  expect(a.access).toBe(b.access)
  expect(Array.from(a.accessByZone)).toEqual(Array.from(b.accessByZone))
  for (const m of MODES) expect(a.trips[m]).toBe(b.trips[m])
  expect(a.riders).toEqual(b.riders)
  expect(digest(a)).toBe(digest(b))
}

describe('the same month worked out twice', () => {
  it('comes to the same numbers in the small city', () => {
    expectSame(simulate(fixtureCity()), simulate(fixtureCity()))
  })

  it('comes to the same numbers in Bengaluru, from fresh copies of the data', () => {
    expectSame(simulate(bengaluru()), simulate(bengaluru()))
  })

  it('does not depend on what was worked out before it', () => {
    const first = simulate(bengaluru())
    simulate({ ...bengaluru(), condition: new Array<number>(5086).fill(0.5) })
    simulate({ ...bengaluru(), surface: new Array<number>(5086).fill(30), streets: new Array<number>(411).fill(20), shut: { 100: 500, 200: 1000 } })
    simulate(fixtureCity())
    expectSame(first, simulate(bengaluru()))
  })
})

describe('the model code', () => {
  const dir = new URL('../src/sim/', import.meta.url)
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'worker.ts')

  it('uses no arithmetic that may differ between JavaScript engines, nor the clock or chance', () => {
    // Addition, multiplication, division, square root, rounding and comparison are exact by the standard; the
    // functions below are not, or are not repeatable.
    const banned = /Math\.(exp|expm1|log|log1p|log2|log10|pow|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|hypot|cbrt|random)\b|\*\*|Date\.now|new Date/
    for (const f of files) {
      const text = readFileSync(new URL(f, dir), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
      expect(text.match(banned)?.[0], f).toBeUndefined()
    }
  })

  it('reads the clock only to report the time taken', () => {
    for (const f of files) {
      const text = readFileSync(new URL(f, dir), 'utf8')
      const uses = text.match(/performance\.now\(\)/g)?.length ?? 0
      expect(uses, f).toBe(f === 'index.ts' ? 1 : 0)
    }
  })
})

// JavaScriptCore, where Bun is installed: the same fingerprint as V8 here.
const bun = [process.env.BUN_INSTALL && `${process.env.BUN_INSTALL}/bin/bun`, `${homedir()}/.bun/bin/bun`, '/opt/homebrew/bin/bun'].find(
  (p) => p && existsSync(p),
)
describe.skipIf(!bun)('the same month in another JavaScript engine', () => {
  it('has the same fingerprint under JavaScriptCore (Bun) as under V8 (Node)', () => {
    const here = digest(simulate(bengaluru()))
    const there = execFileSync(bun!, ['tools/run-month.ts', '--digest'], {
      cwd: new URL('..', import.meta.url).pathname,
      encoding: 'utf8',
    })
    expect(there.split(' ')[0]).toBe(here)
  }, 60_000)
})
