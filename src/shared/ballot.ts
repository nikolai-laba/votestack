// Internal ballot schema, shared by the app (src/), the Worker (worker/) and
// the import scripts (scripts/). Every data source converts to these types.
//
// The precinct is the unit of the ballot: every voter in a precinct gets the
// same ballot. Contests attach to districts (identified by OCD-IDs), and each
// precinct lists the districts it lies in.

/** Open Civic Data division ID, e.g. `ocd-division/country:us/state:il/cd:7`. */
export type OcdId = string

/** Calendar date as `YYYY-MM-DD`. */
export type IsoDate = string

/** Where a piece of data came from. Shown in the UI next to each race. */
export interface SourceRef {
  name: string
  url: string
  /** When we fetched it, as an ISO 8601 timestamp. */
  retrievedAt: string
  /** Published by an election authority (not a third party). */
  official: boolean
}

export interface Election {
  id: string
  name: string
  date: IsoDate
  /** The area the election covers, e.g. the state. */
  divisionId: OcdId
}

export type DistrictType =
  | 'country'
  | 'state'
  | 'county'
  | 'congressional'
  | 'state_senate'
  | 'state_house'
  | 'county_board'
  | 'board_of_review'
  | 'water_reclamation'
  | 'judicial_appellate'
  | 'judicial_circuit'
  | 'judicial_subcircuit'
  | 'city'
  | 'ward'
  | 'school_board'
  | 'school_district'
  | 'township'
  | 'municipality'
  | 'special_district'
  | 'precinct'

export interface District {
  id: OcdId
  name: string
  type: DistrictType
}

export interface Precinct {
  /** Stable ID within its jurisdiction, e.g. `chicago:21-010` or `cook:1234567`. */
  id: string
  name: string
  /** Every district this precinct lies in, including the precinct itself where it has an OCD-ID. */
  districtIds: OcdId[]
}

export interface Candidate {
  name: string
  /** Party as printed on the ballot, if any. */
  party?: string
  /**
   * Ballot designation as printed under the name, where the ballot has one
   * (California: the candidate's occupation, e.g. "Educator").
   */
  designation?: string
  /** Position on the ballot within the contest. */
  ballotOrder?: number
  /**
   * Holds this seat now, as an official list confirms
   * (content/incumbents/, scripts/build-incumbents.ts). Missing when no
   * official list confirms it; never guessed.
   */
  incumbent?: boolean
}

interface ContestBase {
  id: string
  electionId: string
  /** The district whose voters see this contest. */
  districtId: OcdId
  /**
   * The election authority whose ballot lists this contest, e.g. the City of
   * Chicago (Board of Election Commissioners) or Cook County (County Clerk,
   * suburban ballots). Countywide races appear in both authorities' lists;
   * voters only see the list from their own authority.
   */
  authorityId: OcdId
  /** Heading as shown to voters, e.g. "Representative in Congress, 7th District". */
  title: string
  /** Position on the ballot, when the source gives one. */
  ballotOrder?: number
  /**
   * Position on the printed paper ballot among the contests of the same
   * election authority (scripts/build-paper-order.ts). Missing when
   * it isn't known; the app then offers only the order by level.
   */
  paperOrder?: number
  sources: SourceRef[]
  /** Last time a person or script confirmed this against an official source. */
  lastVerified: IsoDate
}

/** A race between candidates for one office. */
export interface CandidateContest extends ContestBase {
  kind: 'candidate'
  office: string
  /** How many candidates a voter may choose. */
  voteFor: number
  /** Names the seat when several are elected separately, e.g. "Vacancy of Smith". */
  vacancy?: string
  candidates: Candidate[]
}

/** A yes/no vote on keeping a judge in office. */
export interface RetentionContest extends ContestBase {
  kind: 'retention'
  office: string
  judge: string
}

/** A referendum or other yes/no question. */
export interface MeasureContest extends ContestBase {
  kind: 'measure'
  question: string
  /**
   * The official guide with the measure's full text and the arguments for
   * and against, e.g. California's Official Voter Information Guide.
   */
  guide?: { name: string; url: string }
}

export type Contest = CandidateContest | RetentionContest | MeasureContest

/** How sure we are that a ballot lists every contest. */
export interface Coverage {
  status: 'complete' | 'possible_gaps' | 'unknown'
  /** Human-readable notes about known or possible gaps. */
  notes: string[]
  /** The election authority's own sample ballot or lookup, for the voter to check. */
  officialSampleBallotUrl?: string
}

/** Everything one voter will see on their ballot. */
export interface Ballot {
  election: Election
  precinct?: Precinct
  contests: Contest[]
  coverage: Coverage
  /**
   * Keys (profileKey(name)) of the candidates with a published profile in
   * this election. Missing when profiles couldn't be checked.
   */
  publishedProfiles?: string[]
}
