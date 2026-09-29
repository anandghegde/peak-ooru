import { describe, expect, it } from 'vitest'
import { lengthOf, MOST, notes, SCALE } from '../src/sound/voices'
import type { Signal } from '../src/ui/signals'

const ALL: Signal[] = ['tap', 'placed', 'built', 'changed', 'refused', 'month', 'opened', 'event', 'review', 'ended']

describe('the game’s sounds', () => {
  it('keep to one scale', () => {
    for (const name of ALL) for (const n of [...notes(name), ...notes(name, { change: 3 }), ...notes(name, { change: -3 })]) {
      expect(SCALE[n.note], `${name} ${n.note}`).toBeDefined()
    }
  })

  it('stay under −12 dBFS within each sound, even where its notes overlap', () => {
    for (const name of ALL) {
      const list = notes(name)
      for (const n of list) {
        const ringing = list.filter((o) => o.at <= n.at && o.at + o.length > n.at)
        expect(ringing.reduce((s, o) => s + o.peak, 0), name).toBeLessThanOrEqual(MOST)
      }
    }
  })

  it('are short: a press under a tenth of a second, the longest under three seconds', () => {
    expect(lengthOf(notes('tap'))).toBeLessThan(0.1)
    for (const name of ALL) expect(lengthOf(notes(name)), name).toBeLessThan(3)
  })

  it('rise when the score rose in a month, and fall when it fell', () => {
    const up = notes('month', { change: 4 }).map((n) => SCALE[n.note]!)
    const down = notes('month', { change: -4 }).map((n) => SCALE[n.note]!)
    expect(up.at(-1)!).toBeGreaterThan(up[0]!)
    expect(down.at(-1)!).toBeLessThan(down[0]!)
  })
})
