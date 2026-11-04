// Election results (content/results/, one file per election, see
// src/shared/raceResults.ts). Committed files bundled into a chunk of their
// own, loaded on demand, so they work offline in the apps. Inputs for the
// build (content/results-inputs/) are never bundled.

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { parseResultsFile, type RaceResult } from '../shared/raceResults.ts'

export interface ResultsData {
  /** By election ID. An election with no entry has no results. */
  byElection: Record<
    string,
    { checkedAt: string; byContest: Map<string, RaceResult> }
  >
}

export const RESULTS_QUERY_KEY = ['results'] as const

const RESULT_FILES = import.meta.glob<unknown>(
  '../../content/results/**/*.json',
  {
    import: 'default',
  },
)

export async function loadResults(): Promise<ResultsData> {
  const files = await Promise.all(
    Object.values(RESULT_FILES).map(async (load) =>
      parseResultsFile(await load()),
    ),
  )
  const byElection: ResultsData['byElection'] = {}
  for (const file of files) {
    const byContest = new Map<string, RaceResult>()
    for (const result of file.results)
      for (const id of result.contestIds) byContest.set(id, result)
    byElection[file.electionId] = { checkedAt: file.checkedAt, byContest }
  }
  return { byElection }
}

export function useResults(): UseQueryResult<ResultsData> {
  return useQuery({
    queryKey: RESULTS_QUERY_KEY,
    queryFn: loadResults,
    staleTime: Infinity,
  })
}

/** The per-election switch: a page shows results only when its election has a file. */
export function hasResults(
  data: ResultsData | undefined,
  electionId: string,
): boolean {
  return !!data && Object.hasOwn(data.byElection, electionId)
}

/** A contest's result, looked up by election and contest together. */
export function resultFor(
  data: ResultsData | undefined,
  electionId: string,
  contestId: string,
): RaceResult | undefined {
  if (!hasResults(data, electionId)) return undefined
  return data!.byElection[electionId].byContest.get(contestId)
}
