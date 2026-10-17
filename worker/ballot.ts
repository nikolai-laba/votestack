// BallotProvider backed by our own data in Supabase (official sources only):
// address → point (the county's address points, in the first region that
// has the address) → precinct and districts (PostGIS) → contests on the
// voter's election authority's ballot.
// The address is sent to our database only, in request bodies, and is never
// logged or stored.

import {
  alternateStreetKeys,
  matchOnStreet,
  parseAddress,
  streetKey,
  type AddressPoint,
  type GeocodeResult,
  type StreetAddress,
} from '../src/shared/address.ts'
import type { Ballot, Contest, OcdId } from '../src/shared/ballot.ts'
import { applyClerkSplits, type ClerkSplit } from '../src/shared/cook.ts'
import type { BallotProvider, BallotQuery } from '../src/shared/provider.ts'
import { REGIONS, regionsFor, type Region } from '../src/shared/regions.ts'
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

export class SupabaseBallotProvider implements BallotProvider {
  readonly id = 'official'
  private readonly config: SupabaseConfig
  private readonly regions: Region[]

  constructor(config: SupabaseConfig, regions = REGIONS) {
    this.config = config
    this.regions = regions
  }

  private rpc<T>(fn: string, args: object): Promise<T> {
    return rpc<T>(this.config, fn, args)
  }

  /** The address on one street (one `streetKey`) in one region, or null. */
  private async locate(address: StreetAddress, key: string, region: Region) {
    const rows = await this.rpc<StreetPoint[]>('street_points', {
      p_street_key: key,
      p_number: address.number,
      p_region: region.id,
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

  /** The address in one region: its own street first, then similar street names. */
  private async find(address: StreetAddress, region: Region) {
    const point = await this.locate(address, streetKey(address), region)
    if (point) return point
    const others = await Promise.all(
      alternateStreetKeys(address).map((key) =>
        this.locate(address, key, region),
      ),
    )
    const found = others.filter((p) => p !== null)
    return found.length === 1 ? found[0] : null
  }

  async getBallot({
    address,
    electionId,
  }: BallotQuery): Promise<Ballot | null> {
    const parsed = parseAddress(address)
    if (!parsed) return null
    const candidates = regionsFor(parsed, this.regions).filter(
      (r) => electionId === undefined || r.election.id === electionId,
    )
    for (const region of candidates) {
      const point = await this.find(parsed, region)
      if (point) return this.ballotAt(point, region)
    }
    return null
  }

  private async ballotAt(
    point: GeocodeResult,
    region: Region,
  ): Promise<Ballot> {
    const election = region.election
    const located = await this.rpc<DistrictsAt>('districts_at', {
      p_lat: point.lat,
      p_lng: point.lng,
    })
    // Official assignments win over the maps where we have them: the Clerk's
    // in the suburbs, the Board's precinct lists in Chicago.
    const clerk = applyClerkSplits(located.districts, located.clerkSplits ?? [])
    const precinctId = located.precinct?.id
    const authority = region.authorityFor(precinctId)
    const districtIds = [
      ...new Set([
        ...region.everywhere,
        ...region.precinctDistricts(precinctId),
        ...clerk.districts.map((d) => d.ocdId),
      ]),
    ]
    const { contests, unplaced } = await this.rpc<ContestsFor>('contests_for', {
      p_election_id: election.id,
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
    else if (region.officialListsOnly && !located.clerkSplits?.length)
      notes.push(
        `We could not match your precinct to a ballot from the ${authority.name}, so local races and measures may be missing.`,
      )
    if (clerk.ambiguous) {
      notes.push(
        'Your precinct is split between districts and we could not tell which part you are in, so this list may include races that are not on your ballot.',
      )
    }
    const foundLayers = new Set(clerk.districts.map((d) => d.layer))
    const missingLayers = region.requiredLayers.filter(
      (l) => !foundLayers.has(l),
    )
    if (missingLayers.length)
      notes.push(`We could not find your ${missingLayers.join(', ')} district.`)
    if (unplaced.length) {
      notes.push(
        `${unplaced.length} ${unplaced.length === 1 ? 'race or question' : 'races or questions'} on the list from the ${authority.name} ${unplaced.length === 1 ? 'is' : 'are'} not matched to an area yet and may be on your ballot.`,
      )
    }

    return {
      election,
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
