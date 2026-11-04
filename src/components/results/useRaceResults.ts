// What a race card shows for its race's result: the result itself, its
// reserved space while results load, or nothing (an election without
// results, or a contest its election's results leave out).

import {
  useContestResult,
  useElectionHasResults,
  useElectionResultsPending,
} from '../../results/context.tsx'
import {
  resultView,
  thresholdText,
  type ChoiceView,
  type RaceResult,
  type ResultView,
} from '../../shared/raceResults.ts'
import {
  COOK,
  REGIONS,
  regionForElection,
  type Region,
} from '../../shared/regions.ts'
import { ballotAreasOfContests, resultsOffices } from '../../shared/results.ts'

export interface RaceResults {
  /**
   * The card shows results in place of pick controls: the result, or its
   * reserved space while the results load.
   */
  shown: boolean
  /** The election has results that haven't loaded yet. */
  pending: boolean
  result?: RaceResult
  view?: ResultView
}

const NONE: RaceResults = { shown: false, pending: false }
const PENDING: RaceResults = { shown: true, pending: true }

/**
 * The switch is the election's own results file: never the site-wide
 * after-election switch. A contest the loaded results leave out (or results
 * that failed to load) renders as it did before results existed.
 */
export function useRaceResults(contest: {
  electionId: string
  id: string
}): RaceResults {
  const has = useElectionHasResults(contest.electionId)
  const pending = useElectionResultsPending(contest.electionId)
  const result = useContestResult(contest.electionId, contest.id)
  if (!has) return NONE
  if (result)
    return { shown: true, pending: false, result, view: resultView(result) }
  return pending ? PENDING : NONE
}

/**
 * Whether rows carry a results column: while the results load (to keep its
 * space) and for every race with a count. A race with no count has none.
 */
export const hasColumn = (results: RaceResults): boolean =>
  results.shown && results.view?.status !== 'no_count'

/** A row's fill attribute: nothing for a row that neither won nor leads. */
export const fillOf = (choice?: ChoiceView): 'win' | 'lead' | undefined =>
  choice && choice.fill !== 'none' ? choice.fill : undefined

/** The band's column header, or null while the results load. */
export const columnHeaderOf = (
  results: RaceResults,
): ResultView['header'] | null | undefined =>
  results.shown ? (results.view?.header ?? null) : undefined

/** The band's threshold line ("Needs 60% yes to stay."), or null while the results load. */
export function thresholdNoteOf(
  results: RaceResults,
  kind: 'retention' | 'measure',
): string | null | undefined {
  if (!results.shown) return undefined
  if (results.pending) return null
  const threshold = results.result?.threshold
  return threshold === undefined ? undefined : thresholdText(kind, threshold)
}

/** A saved Yes or No pick, as its row's word. */
export const pickedSide = (choice?: string): 'Yes' | 'No' | undefined =>
  choice === 'yes' ? 'Yes' : choice === 'no' ? 'No' : undefined

/**
 * The region whose clock a result's times are given in. A past election is
 * no longer its region's current one, so its ID's state decides then.
 */
export function resultRegion(electionId: string): Region {
  return (
    regionForElection(electionId) ??
    REGIONS.find((r) => electionId.startsWith(`${r.state.toLowerCase()}-`)) ??
    COOK
  )
}

/**
 * The results page of the office that runs the ballot listing this contest,
 * for a race with no count of its own.
 */
export function officialResultsUrl(
  contestId: string,
  result: RaceResult,
): string | undefined {
  const office =
    resultsOffices(ballotAreasOfContests([contestId]))[0] ??
    resultsOffices(ballotAreasOfContests(result.contestIds))[0]
  return office?.url
}
