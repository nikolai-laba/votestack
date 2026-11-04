// Results for every page under the layout. While they load (or fail to),
// this behaves as "no results", so pages render as they do without them.

import { createContext, useContext, type ReactNode } from 'react'
import type { RaceResult } from '../shared/raceResults.ts'
import { hasResults, resultFor, useResults, type ResultsData } from './data.ts'

const ResultsContext = createContext<ResultsData | undefined>(undefined)

export function ResultsProvider({ children }: { children: ReactNode }) {
  const { data } = useResults()
  return <ResultsContext value={data}>{children}</ResultsContext>
}

export function useContestResult(
  electionId: string,
  contestId: string,
): RaceResult | undefined {
  return resultFor(useContext(ResultsContext), electionId, contestId)
}

export function useElectionHasResults(electionId: string): boolean {
  return hasResults(useContext(ResultsContext), electionId)
}

export function useElectionCheckedAt(electionId: string): string | undefined {
  return useContext(ResultsContext)?.byElection[electionId]?.checkedAt
}
