import type { RoutingNetwork } from '../sim/types'

/** Loads the simplified road network that tools/build-routing.ts builds into public/data/routing.json. */
export async function loadRouting(): Promise<RoutingNetwork> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/routing.json`)
  if (!response.ok) throw new Error(`The roads for traffic could not be loaded (${response.status}).`)
  return (await response.json()) as RoutingNetwork
}
