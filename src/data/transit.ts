import type { Transit } from './types'

/** Loads the metro and suburban railway that tools/build-transit.ts builds into public/data/transit.json. */
export async function loadTransit(): Promise<Transit> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/transit.json`)
  if (!response.ok) throw new Error(`The transit lines could not be loaded (${response.status}).`)
  return (await response.json()) as Transit
}
