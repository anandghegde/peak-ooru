// Moments in the game that other parts may want to hear of (sound, the introduction). Fixed in slice 9.
// The screen says when something happened; whoever listens decides what to do. Nothing here knows of either.
export type Signal =
  | 'tap' // a button or tab was pressed
  | 'placed' // a stop, station or stretch was put on the map while planning
  | 'built' // a plan was confirmed and paid for
  | 'changed' // a lever was moved: a tax, a fare, upkeep, a loan
  | 'refused' // the rules or the server refused something
  | 'month' // a month ended; detail.change is the change in score
  | 'opened' // something the player built, or a line under way, opened
  | 'event' // the city met an event: a flood, a strike
  | 'review' // the yearly review came up
  | 'ended' // the game ended; detail.status says how

export interface SignalDetail {
  change?: number
  status?: string
}

export function signal(name: Signal, detail: SignalDetail = {}): void {
  window.dispatchEvent(new CustomEvent('peakooru', { detail: { name, ...detail } }))
}

export function onSignal(hear: (name: Signal, detail: SignalDetail) => void): void {
  window.addEventListener('peakooru', (e) => {
    const { name, ...detail } = (e as CustomEvent).detail as { name: Signal } & SignalDetail
    hear(name, detail)
  })
}
