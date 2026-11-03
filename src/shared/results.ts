// Who counts the votes, for pages that point voters to the official results
// once voting has ended. The election offices are the ones that run each
// ballot (Authority in cook.ts); a page picks them by the ballots that list
// what it shows.

import type { OcdId } from './ballot.ts'
import { CHICAGO_BOARD, COOK_CLERK, type Authority } from './cook.ts'
import * as ocd from './ocd.ts'
import type { BallotArea } from './races.ts'
import { LA_REGISTRAR, type Region } from './regions.ts'

/** An election office with its results page and where it counts. */
export interface ResultsOffice {
  name: string
  url: string
  /** The area its ballots cover, e.g. "suburban Cook County". */
  place: string
}

const office = (authority: Authority, place: string): ResultsOffice => ({
  name: authority.name,
  url: authority.resultsUrl,
  place,
})

const OFFICES: Record<BallotArea, ResultsOffice> = {
  chicago: office(CHICAGO_BOARD, 'Chicago'),
  'suburban-cook': office(COOK_CLERK, 'suburban Cook County'),
  'los-angeles-county': office(LA_REGISTRAR, 'Los Angeles County'),
}

/** The order offices are named in. */
const AREAS = Object.keys(OFFICES) as BallotArea[]

/** The offices that count the given ballots, each once, in a fixed order. */
export function resultsOffices(areas: readonly BallotArea[]): ResultsOffice[] {
  return AREAS.filter((area) => areas.includes(area)).map(
    (area) => OFFICES[area],
  )
}

/** Contest ids start with the source that lists them (see content/contests/). */
const CONTEST_ID_PREFIXES: [prefix: string, area: BallotArea][] = [
  ['chicago-boe:', 'chicago'],
  ['cook-clerk:', 'suburban-cook'],
  ['la-', 'los-angeles-county'],
]

/** The ballots that list the given contests; ids from no known source are left out. */
export function ballotAreasOfContests(
  contestIds: readonly string[],
): BallotArea[] {
  const areas = new Set<BallotArea>()
  for (const id of contestIds) {
    const found = CONTEST_ID_PREFIXES.find(([prefix]) => id.startsWith(prefix))
    if (found) areas.add(found[1])
  }
  return [...areas]
}

/** The ballot area an election authority runs, if it's one of the three. */
export function ballotAreaOfAuthority(authorityId: OcdId): BallotArea | null {
  switch (authorityId) {
    case ocd.CHICAGO:
      return 'chicago'
    case ocd.COOK_COUNTY:
      return 'suburban-cook'
    case ocd.LOS_ANGELES_COUNTY:
      return 'los-angeles-county'
    default:
      return null
  }
}

/**
 * The ballot area a voter's ballot comes from. The precinct says so when the
 * ballot has one; a ballot saved on the device doesn't keep its precinct, so
 * its contests' authority says instead, and an empty ballot falls back to the
 * region's default authority.
 */
export function areaOfBallot(
  ballot: {
    precinct?: { id: string }
    contests: readonly { authorityId: OcdId }[]
  },
  region: Region,
): BallotArea | null {
  const authority = ballot.precinct
    ? region.authorityFor(ballot.precinct.id).id
    : (ballot.contests[0]?.authorityId ?? region.authorityFor(undefined).id)
  return ballotAreaOfAuthority(authority)
}
