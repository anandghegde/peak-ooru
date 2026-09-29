// The game's sounds, as notes: made in the browser with Web Audio, nothing downloaded. Kept apart from the switch and
// the listening so that a test page can render each one offline and measure it (tools/listen.html).
import type { Signal, SignalDetail } from '../ui/signals'

/**
 * One scale for every sound: D major pentatonic (D E F♯ A B), from D4 up. Notes of it only never clash, whichever
 * two sounds meet.
 */
export const SCALE: Record<string, number> = {
  D4: 293.66, E4: 329.63, 'F#4': 369.99, A4: 440, B4: 493.88,
  D5: 587.33, E5: 659.26, 'F#5': 739.99, A5: 880, B5: 987.77, D6: 1174.66,
}

/** A note: when it starts after the sound does (s), its pitch, how long it rings (s), and its peak (0 to 1). */
export interface Note {
  at: number
  note: keyof typeof SCALE & string
  length: number
  peak: number
}

/** −12 dBFS: no sound may peak above it, so that two at once cannot clip. */
export const MOST = 0.25

/** −20 dBFS, the usual peak; the press is quieter still, being heard most often. */
const SOFT = 0.1

/** The sounds, by signal. `event` is left without one: the event's card is enough, and a warning tone would alarm. */
export function notes(name: Signal, detail: SignalDetail = {}): Note[] {
  switch (name) {
    case 'tap':
      return [{ at: 0, note: 'A5', length: 0.05, peak: 0.035 }]
    case 'placed':
      return [{ at: 0, note: 'D5', length: 0.16, peak: 0.07 }]
    case 'changed':
      return [{ at: 0, note: 'F#5', length: 0.12, peak: 0.05 }]
    case 'built':
      return [
        { at: 0, note: 'D5', length: 0.22, peak: SOFT },
        { at: 0.09, note: 'A5', length: 0.4, peak: SOFT },
      ]
    case 'refused':
      // Low and short, two notes falling: a "no" said gently, not a buzzer.
      return [
        { at: 0, note: 'E4', length: 0.14, peak: 0.09 },
        { at: 0.1, note: 'D4', length: 0.22, peak: 0.09 },
      ]
    case 'month': {
      const change = detail.change ?? 0
      const run: Note['note'][] = change > 0 ? ['D5', 'F#5', 'A5'] : change < 0 ? ['A4', 'F#4', 'D4'] : ['D5', 'D5']
      return run.map((note, i) => ({ at: i * 0.08, note, length: i === run.length - 1 ? 0.45 : 0.2, peak: 0.08 }))
    }
    case 'opened':
      return [
        { at: 0, note: 'A5', length: 0.6, peak: SOFT },
        { at: 0.12, note: 'D6', length: 0.9, peak: 0.08 },
      ]
    case 'review':
      return (['D4', 'F#4', 'A4', 'D5'] as const).map((note, i) => ({ at: i * 0.12, note, length: i === 3 ? 1 : 0.4, peak: 0.06 }))
    case 'ended':
      return (['D4', 'A4', 'D5', 'F#5', 'A5'] as const).map((note, i) => ({ at: i * 0.16, note, length: i === 4 ? 1.6 : 0.6, peak: 0.06 }))
    case 'event':
      return []
  }
}

/** The length of a sound in seconds, to its last note's end. */
export function lengthOf(list: Note[]): number {
  return list.reduce((end, n) => Math.max(end, n.at + n.length), 0)
}

/**
 * Plays a sound into a context (live or offline) from `start`. Each note is a soft struck tone: a sine and a quieter
 * octave above, rising from nothing in 6 ms and dying away, then brought to nothing exactly at its end, so that no
 * sound starts or stops with a click.
 */
export function play(ctx: BaseAudioContext, list: Note[], start = ctx.currentTime, out: AudioNode = ctx.destination): void {
  for (const n of list) {
    const t = start + n.at
    const f = SCALE[n.note]!
    const gain = ctx.createGain()
    const g = gain.gain
    g.setValueAtTime(0, t)
    g.linearRampToValueAtTime(n.peak, t + 0.006)
    g.exponentialRampToValueAtTime(n.peak * 0.08, t + n.length - 0.012)
    g.linearRampToValueAtTime(0, t + n.length)
    gain.connect(out)
    // The sine and its octave together peak at 1.0 + 0.3 at most; the gain is set so that the sum stays under `peak`.
    for (const [ratio, level] of [[1, 1 / 1.3], [2, 0.3 / 1.3]] as const) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = f * ratio
      const part = ctx.createGain()
      part.gain.value = level
      osc.connect(part).connect(gain)
      osc.start(t)
      osc.stop(t + n.length + 0.005)
    }
  }
}
