// Sound. Slice 9, person M. Called once by main.ts as the page starts.
import { onSignal, type Signal } from '../ui/signals'
import { notes, play } from './voices'

const KEY = 'peakooru.sound'

/** The context, made at the player's first touch of the page: never before, so nothing sounds unasked. */
let ctx: AudioContext | null = null
/** When each sound last played, so that a burst of the same signal is heard once. */
const lastAt = new Map<Signal, number>()

function stored(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

/**
 * Whether the game makes sound: as the player last set it; otherwise on, unless the device asks for reduced motion.
 */
export function soundOn(): boolean {
  const s = stored()
  if (s === 'on') return true
  if (s === 'off') return false
  return !matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Sets sound on or off, remembered on this device. */
export function setSound(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    // Kept for this visit only.
  }
  if (!on) void ctx?.suspend()
  else if (ctx && !document.hidden) void ctx.resume()
}

/** Listens for the game's signals and plays their sounds, once the player has touched the page. */
export function installSound(): void {
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Context) return
  const wake = () => {
    if (!soundOn()) return
    ctx ??= new Context({ latencyHint: 'interactive' })
    if (ctx.state === 'suspended') void ctx.resume()
  }
  // A touch, a click or a key. Which of these a browser counts as letting sound start differs (Safari on a phone
  // counts the end of a touch, not its start), so all are listened to; after the first that works, `wake` does little.
  for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const) {
    addEventListener(type, wake, { capture: true, passive: true })
  }
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return
    if (document.hidden) void ctx.suspend()
    else if (soundOn()) void ctx.resume()
  })
  onSignal((name, detail) => {
    if (!ctx || ctx.state !== 'running' || !soundOn() || document.hidden) return
    const now = ctx.currentTime
    if (now - (lastAt.get(name) ?? -1) < 0.08) return
    lastAt.set(name, now)
    play(ctx, notes(name, detail), now + 0.01)
  })
}
