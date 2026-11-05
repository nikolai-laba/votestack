// Results for every page under the layout. Whether an election has results
// is known at the first paint (hasResultsFile); the numbers fill in when the
// data loads. If it fails to load, pages fall back to no result per contest.

import { createContext, useContext, type ReactNode } from 'react'
import type { RaceResult } from '../shared/raceResults.ts'
import {
  hasResultsFile,
  resultFor,
  useResults,
  type ResultsData,
} from './data.ts'

interface ResultsState {
  data: ResultsData | undefined
  failed: boolean
}
const ResultsContext = createContext<ResultsState>({
  data: undefined,
  failed: false,
})

export function ResultsProvider({ children }: { children: ReactNode }) {
  // Starts loading when the app mounts, on every page.
  const { data, isError } = useResults()
  return (
    <ResultsContext value={{ data, failed: isError }}>
      {children}
    </ResultsContext>
  )
}

export function useContestResult(
  electionId: string,
  contestId: string,
): RaceResult | undefined {
  return resultFor(useContext(ResultsContext).data, electionId, contestId)
}

/**
 * For each group of contest IDs (one race, listed on one or more ballots),
 * the first result the election has for any of them.
 */
export function useGroupResults(
  electionId: string,
  groups: string[][],
): (RaceResult | undefined)[] {
  const { data } = useContext(ResultsContext)
  return groups.map((ids) => {
    for (const id of ids) {
      const result = resultFor(data, electionId, id)
      if (result) return result
    }
    return undefined
  })
}

/** Synchronous: true from the first paint for an election with a results file. */
export function useElectionHasResults(electionId: string): boolean {
  return hasResultsFile(electionId)
}

/** True while the election has a results file but its data hasn't loaded. */
export function useElectionResultsPending(electionId: string): boolean {
  const { data, failed } = useContext(ResultsContext)
  return hasResultsFile(electionId) && !data && !failed
}

export function useElectionCheckedAt(electionId: string): string | undefined {
  return useContext(ResultsContext).data?.byElection[electionId]?.checkedAt
}

/** True once every result of the election is certified; false while its data loads. */
export function useElectionAllCertified(electionId: string): boolean {
  const results = useContext(ResultsContext).data?.byElection[electionId]
  if (!results || results.byContest.size === 0) return false
  for (const result of results.byContest.values())
    if (result.status !== 'certified') return false
  return true
}
