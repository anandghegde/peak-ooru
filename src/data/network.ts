import type { Network } from './types'

/** Loads the main-road network that tools/build-network.ts builds into public/data/network.json. */
export async function loadNetwork(): Promise<Network> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/network.json`)
  if (!response.ok) throw new Error(`The road network could not be loaded (${response.status}).`)
  return (await response.json()) as Network
}
