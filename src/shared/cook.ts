// Cook County rules shared by the Worker and the scripts: which election
// authority runs a precinct's ballot, and the districts implied by a precinct ID.

import type { Election, OcdId } from './ballot.ts'
import * as ocd from './ocd.ts'

/** The election the data is loaded for. */
export const CURRENT_ELECTION: Election = {
  id: 'il-2026-11-03-general',
  name: 'General Election',
  date: '2026-11-03',
  divisionId: ocd.ILLINOIS,
}

/** Districts every Cook County voter is in. */
export const COOK_EVERYWHERE: OcdId[] = [
  ocd.US,
  ocd.ILLINOIS,
  ocd.COOK_COUNTY,
  ocd.appellateDistrict(1),
]

export interface Authority {
  id: OcdId
  name: string
  /** Where voters can check their official sample ballot. */
  sampleBallotUrl: string
}

const CHICAGO_BOARD: Authority = {
  id: ocd.CHICAGO,
  name: 'Chicago Board of Election Commissioners',
  sampleBallotUrl:
    'https://www.chicagoelections.gov/voting/your-voter-information',
}

const COOK_CLERK: Authority = {
  id: ocd.COOK_COUNTY,
  name: 'Cook County Clerk',
  sampleBallotUrl:
    'https://www.cookcountyclerkil.gov/elections/your-voter-information',
}

/** Chicago precinct IDs look like `chicago:WWPPP`; suburban ones `cook:NNNNNNN`. */
const CHICAGO_PRECINCT = /^chicago:(\d{2})(\d{3})$/

/** The Board of Election Commissioners runs Chicago ballots; the County Clerk runs suburban ones. */
export function authorityFor(precinctId: string | undefined): Authority {
  return precinctId && CHICAGO_PRECINCT.test(precinctId)
    ? CHICAGO_BOARD
    : COOK_CLERK
}

/** Districts implied by the precinct itself (city, ward and precinct for Chicago). */
export function precinctDistricts(precinctId: string | undefined): OcdId[] {
  const match = precinctId?.match(CHICAGO_PRECINCT)
  if (!match) return []
  const ward = Number(match[1])
  return [
    ocd.CHICAGO,
    ocd.chicagoWard(ward),
    ocd.chicagoPrecinct(ward, Number(match[2])),
  ]
}

/** A district found for an address, tagged with its map layer. */
export interface LayerDistrict {
  ocdId: OcdId
  layer: string
  /**
   * In a split: a map district that official data corrects to this split's
   * district of the same layer. It helps pick the split for an address but
   * isn't one of its districts.
   */
  matchOnly?: boolean
  /**
   * In a split: only part of the precinct may be in this district, and no
   * official source says which addresses. Its contests are shown, and the
   * lookup is flagged as uncertain rather than hiding them.
   */
  possible?: boolean
}

/**
 * One part of a suburban precinct with the County Clerk's own district
 * assignments. The Clerk's assignments are the ground truth: public
 * boundary maps can disagree with them near district edges.
 */
export interface ClerkSplit {
  split: string
  districts: LayerDistrict[]
  /**
   * Layers the Clerk's list is complete for: the voter is in exactly these
   * districts of each layer, or none (no municipality means unincorporated).
   * Defaults to the layers in `districts`.
   */
  covers?: string[]
}

/** Map layers the Clerk's assignments replace (see scripts/build-clerk-precincts.ts). */
export const CLERK_LAYERS = [
  'congressional',
  'state senate',
  'state house',
  'county board',
  'board of review',
  'municipality',
  'township',
  'water reclamation',
  'tax-elementary-school',
  'tax-high-school',
  'tax-unit-school',
  'tax-community-college',
  'tax-park',
  'tax-library',
  'tax-fire-protection',
  'tax-sanitary',
  'regional office of education',
]

/**
 * Replaces map-derived districts with the Clerk's for the precinct split that
 * agrees best with the address's map districts. If several splits agree
 * equally, uses all of them and says so, rather than guessing and possibly
 * hiding a race. Also used for Chicago precincts, with splits built from the
 * Board of Election Commissioners' precinct lists.
 */
export function applyClerkSplits(
  mapDistricts: LayerDistrict[],
  splits: ClerkSplit[],
): { districts: LayerDistrict[]; ambiguous: boolean } {
  // A split with no districts can still settle a layer: its ballot style can
  // show the voter is in no sanitary district, for example.
  const usable = splits.filter(
    (s) => s.districts.length > 0 || (s.covers?.length ?? 0) > 0,
  )
  if (usable.length === 0) return { districts: mapDistricts, ambiguous: false }

  const onMap = new Set(mapDistricts.map((d) => d.ocdId))
  const score = (s: ClerkSplit) =>
    s.districts.filter((d) => onMap.has(d.ocdId)).length
  const best = Math.max(...usable.map(score))
  const chosen = usable.filter((s) => score(s) === best)

  const own = (s: ClerkSplit) => s.districts.filter((d) => !d.matchOnly)
  const clerk = chosen.flatMap(own)
  const replaced = new Set(
    chosen.flatMap((s) => s.covers ?? own(s).map((d) => d.layer)),
  )
  const seen = new Set<OcdId>()
  const districts = [
    ...mapDistricts.filter((d) => !replaced.has(d.layer)),
    ...clerk,
  ].filter((d) => !seen.has(d.ocdId) && seen.add(d.ocdId))
  // Ambiguous if the equally good splits differ, or if a split names two
  // districts of one layer itself (the official lists split the precinct but
  // don't say which addresses are where).
  const sets = new Set(
    chosen.map((s) =>
      own(s)
        .map((d) => d.ocdId)
        .sort()
        .join(' '),
    ),
  )
  const layers = own(chosen[0]).map((d) => d.layer)
  const twoInOneLayer = new Set(layers).size < layers.length
  // Or if a district may cover only part of the precinct.
  const possible = clerk.some((d) => d.possible)
  return { districts, ambiguous: sets.size > 1 || twoInOneLayer || possible }
}
