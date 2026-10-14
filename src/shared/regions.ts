// The areas VoteStack covers. Each region has its own address points,
// boundaries and contests in the lookup tables (tagged with its `id`), its own
// election, and its own rules for which authority runs a precinct's ballot.

import type { Election, OcdId } from './ballot.ts'
import * as cook from './cook.ts'

export interface Region {
  /** Tag on the region's rows in the lookup tables, e.g. `il-cook`. */
  id: string
  /** For voters: "Cook County". */
  name: string
  /** Two-letter state code, upper case. */
  state: string
  /** ZIP code ranges in the region's state (first two digits), for picking a region from an address. */
  zipPrefixes: string[]
  election: Election
  /** Districts every voter in the region is in. */
  everywhere: OcdId[]
  /** Layers every address should fall in; a miss means a boundary gap. */
  requiredLayers: string[]
  authorityFor: (precinctId: string | undefined) => cook.Authority
  /** Districts implied by the precinct ID itself. */
  precinctDistricts: (precinctId: string | undefined) => OcdId[]
}

export const COOK: Region = {
  id: 'il-cook',
  name: 'Cook County',
  state: 'IL',
  zipPrefixes: ['60', '61', '62'],
  election: cook.CURRENT_ELECTION,
  everywhere: cook.COOK_EVERYWHERE,
  requiredLayers: [
    'congressional',
    'state senate',
    'state house',
    'county board',
    'board of review',
    'judicial subcircuit',
  ],
  authorityFor: cook.authorityFor,
  precinctDistricts: cook.precinctDistricts,
}

export const REGIONS: Region[] = [COOK]

/** "Cook County", "Cook County or Los Angeles County". */
export const coveredAreas = (regions = REGIONS) =>
  regions.length < 3
    ? regions.map((r) => r.name).join(' or ')
    : `${regions
        .slice(0, -1)
        .map((r) => r.name)
        .join(', ')} or ${regions[regions.length - 1].name}`

/**
 * The regions to try for an address, most likely first: those whose ZIP
 * range or state matches come first. The others follow, because a ZIP can
 * be mistyped and the address points decide in the end.
 */
export function regionsFor(
  address: { zip?: string; state?: string },
  regions = REGIONS,
): Region[] {
  const likely = (r: Region) =>
    (address.zip !== undefined &&
      r.zipPrefixes.includes(address.zip.slice(0, 2))) ||
    address.state === r.state
  return [...regions.filter(likely), ...regions.filter((r) => !likely(r))]
}

export const regionForElection = (electionId: string, regions = REGIONS) =>
  regions.find((r) => r.election.id === electionId)
