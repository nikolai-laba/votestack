// Provider interfaces. Every data source is an adapter behind one of these,
// so forks can plug in their own data without touching the app.

import type { Ballot } from './ballot.ts'

export interface LatLng {
  lat: number
  lng: number
}

/** Turns a street address into a point. Implementations must not log or store the address. */
export interface Geocoder {
  geocode(address: string): Promise<LatLng | null>
}

export interface BallotQuery {
  address: string
  /** Defaults to the next upcoming election the provider knows about. */
  electionId?: string
}

/** Returns the ballot for an address, or null if the provider has no data for it. */
export interface BallotProvider {
  /** Short ID shown in source labels and logs, e.g. `official-cook`. */
  readonly id: string
  getBallot(query: BallotQuery): Promise<Ballot | null>
}
