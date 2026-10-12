// BallotProvider backed by our own data in Supabase (official sources only):
// address → point (Cook County address points) → precinct and districts
// (PostGIS) → contests on the voter's election authority's ballot.
// The address is sent to our database only, in request bodies, and is never
// logged or stored.

import {
  alternateStreetKeys,
  matchOnStreet,
  parseAddress,
  streetKey,
  type AddressPoint,
  type StreetAddress,
} from '../src/shared/address.ts'
import type { Ballot, Contest, OcdId } from '../src/shared/ballot.ts'
import {
  applyClerkSplits,
  authorityFor,
  type ClerkSplit,
  COOK_EVERYWHERE,
  CURRENT_ELECTION,
  precinctDistricts,
} from '../src/shared/cook.ts'
import type { BallotProvider, BallotQuery } from '../src/shared/provider.ts'
import { rpc, type SupabaseConfig } from './supabase.ts'

interface StreetPoint {
  number: number
  street_type: string | null
  city: string | null
  zip: string | null
  lat: number
  lng: number
}

interface DistrictsAt {
  precinct: { id: string; name: string } | null
  districts: { ocdId: OcdId; layer: string }[]
  /** Missing before the clerk_precinct_splits migration is applied. */
  clerkSplits?: ClerkSplit[]
}

interface ContestsFor {
  contests: Contest[]
  unplaced: string[]
}

/** Layers every Cook County address should fall in; a miss means a boundary gap. */
const REQUIRED_LAYERS = [
  'congressional',
  'state senate',
  'state house',
  'county board',
  'board of review',
  'judicial subcircuit',
]

export class SupabaseBallotProvider implements BallotProvider {
  readonly id = 'official-cook'
  private readonly config: SupabaseConfig

  constructor(config: SupabaseConfig) {
    this.config = config
  }

  private rpc<T>(fn: string, args: object): Promise<T> {
    return rpc<T>(this.config, fn, args)
  }

  /** The address on one street (one `streetKey`), or null. */
  private async locate(address: StreetAddress, key: string) {
    const rows = await this.rpc<StreetPoint[]>('street_points', {
      p_street_key: key,
      p_number: address.number,
    })
    const points: AddressPoint[] = rows.map((r) => ({
      number: r.number,
      type: r.street_type ?? undefined,
      city: r.city ?? undefined,
      zip: r.zip ?? undefined,
      lat: r.lat,
      lng: r.lng,
    }))
    return matchOnStreet(address, points)
  }

  async getBallot({
    address,
    electionId = CURRENT_ELECTION.id,
  }: BallotQuery): Promise<Ballot | null> {
    if (electionId !== CURRENT_ELECTION.id) return null
    const parsed = parseAddress(address)
    if (!parsed) return null

    let point = await this.locate(parsed, streetKey(parsed))
    if (!point) {
      const others = await Promise.all(
        alternateStreetKeys(parsed).map((key) => this.locate(parsed, key)),
      )
      const found = others.filter((p) => p !== null)
      if (found.length === 1) point = found[0]
    }
    if (!point) return null

    const located = await this.rpc<DistrictsAt>('districts_at', {
      p_lat: point.lat,
      p_lng: point.lng,
    })
    // Official assignments win over the maps where we have them: the Clerk's
    // in the suburbs, the Board's precinct lists in Chicago.
    const clerk = applyClerkSplits(located.districts, located.clerkSplits ?? [])
    const precinctId = located.precinct?.id
    const authority = authorityFor(precinctId)
    const districtIds = [
      ...new Set([
        ...COOK_EVERYWHERE,
        ...precinctDistricts(precinctId),
        ...clerk.districts.map((d) => d.ocdId),
      ]),
    ]
    const { contests, unplaced } = await this.rpc<ContestsFor>('contests_for', {
      p_election_id: electionId,
      p_authority_id: authority.id,
      p_district_ids: districtIds,
    })

    const notes: string[] = []
    if (point.precision === 'interpolated') {
      notes.push(
        "Your exact address isn't in the county's records, so we placed it between its neighbors. Races near a district line may differ.",
      )
    }
    if (!located.precinct) notes.push('We could not find your precinct.')
    if (clerk.ambiguous) {
      notes.push(
        'Your precinct is split between districts and we could not tell which part you are in, so this list may include races that are not on your ballot.',
      )
    }
    const foundLayers = new Set(clerk.districts.map((d) => d.layer))
    const missingLayers = REQUIRED_LAYERS.filter((l) => !foundLayers.has(l))
    if (missingLayers.length)
      notes.push(`We could not find your ${missingLayers.join(', ')} district.`)
    if (unplaced.length) {
      notes.push(
        `${unplaced.length} ${unplaced.length === 1 ? 'race or question' : 'races or questions'} on the list from the ${authority.name} ${unplaced.length === 1 ? 'is' : 'are'} not matched to an area yet and may be on your ballot.`,
      )
    }

    return {
      election: CURRENT_ELECTION,
      precinct: located.precinct
        ? { ...located.precinct, districtIds }
        : undefined,
      contests: contests.sort(
        (a, b) => (a.ballotOrder ?? 0) - (b.ballotOrder ?? 0),
      ),
      coverage: {
        status: notes.length ? 'possible_gaps' : 'complete',
        notes,
        officialSampleBallotUrl: authority.sampleBallotUrl,
      },
    }
  }
}
