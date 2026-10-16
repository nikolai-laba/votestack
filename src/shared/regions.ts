// The areas VoteStack covers. Each region has its own address points,
// boundaries and contests in the lookup tables (tagged with its `id`), its own
// election, and its own rules for which authority runs a precinct's ballot.

import type { Election, OcdId } from './ballot.ts'
import * as cook from './cook.ts'
import * as ocd from './ocd.ts'

/**
 * What the region's ballots call yes/no questions, in the region's own
 * terms: Illinois has "referenda"; California has "measures", with
 * numbered statewide "propositions".
 */
export interface MeasureWords {
  /** "referendum" */
  one: string
  /** "referenda" */
  many: string
  /** Section heading for all of them: "Referenda and questions". */
  section: string
  /** Heading for the statewide ones, when the paper ballot sets them apart. */
  state: string
}

export interface Region {
  /** Tag on the region's rows in the lookup tables, e.g. `il-cook`. */
  id: string
  /** For voters: "Cook County". */
  name: string
  /** For voters, with the state: "Cook County, Illinois". */
  fullName: string
  /** Two-letter state code, upper case. */
  state: string
  stateName: string
  /**
   * Words that already place an office inside the region ("Chicago Board
   * of Education Member"), so a page title doesn't add the region's name.
   */
  placeWords: string[]
  /** ZIP code ranges in the region's state (first two digits), for picking a region from an address. */
  zipPrefixes: string[]
  election: Election
  measureWords: MeasureWords
  /** Districts every voter in the region is in. */
  everywhere: OcdId[]
  /** Layers every address should fall in; a miss means a boundary gap. */
  requiredLayers: string[]
  authorityFor: (precinctId: string | undefined) => cook.Authority
  /** Districts implied by the precinct ID itself. */
  precinctDistricts: (precinctId: string | undefined) => OcdId[]
  /**
   * The region's districts come only from the election authority's own
   * per-precinct lists (no boundary maps), so a precinct without one can't
   * show its local races.
   */
  officialListsOnly?: boolean
}

export const COOK: Region = {
  id: 'il-cook',
  name: 'Cook County',
  fullName: 'Cook County, Illinois',
  state: 'IL',
  stateName: 'Illinois',
  placeWords: ['Chicago'],
  zipPrefixes: ['60', '61', '62'],
  election: cook.CURRENT_ELECTION,
  measureWords: {
    one: 'referendum',
    many: 'referenda',
    section: 'Referenda and questions',
    state: 'State referenda',
  },
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

const LA_REGISTRAR: cook.Authority = {
  id: ocd.LOS_ANGELES_COUNTY,
  name: 'Los Angeles County Registrar-Recorder/County Clerk',
  sampleBallotUrl: 'https://isb.lavote.gov/',
}

export const LOS_ANGELES: Region = {
  id: 'ca-la',
  name: 'Los Angeles County',
  fullName: 'Los Angeles County, California',
  state: 'CA',
  stateName: 'California',
  placeWords: ['City of', 'Los Angeles'],
  zipPrefixes: ['90', '91', '93'],
  election: {
    id: 'ca-2026-11-03-general',
    name: 'General Election',
    date: '2026-11-03',
    divisionId: ocd.CALIFORNIA,
  },
  measureWords: {
    one: 'measure',
    many: 'measures',
    section: 'Propositions and measures',
    state: 'State propositions',
  },
  everywhere: [ocd.US, ocd.CALIFORNIA, ocd.LOS_ANGELES_COUNTY],
  // Every district comes from the Registrar's ballot style for the precinct.
  requiredLayers: [],
  authorityFor: () => LA_REGISTRAR,
  precinctDistricts: () => [],
  officialListsOnly: true,
}

export const REGIONS: Region[] = [COOK, LOS_ANGELES]

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

/** The measure wording for an election's region; Cook County's when unknown. */
export const measureWordsFor = (electionId: string, regions = REGIONS) =>
  (regionForElection(electionId, regions) ?? COOK).measureWords
