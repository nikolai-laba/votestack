// Election results (content/results/, one file per election, see
// src/shared/raceResults.ts). Committed files bundled into a chunk of their
// own, loaded on demand, so they work offline in the apps. Inputs for the
// build (content/results-inputs/) are never bundled.

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { COOK, regionForElection } from '../shared/regions.ts'
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

// A results file's path says which election it is for: content/results/
// {date}.json for Cook County, content/results/{region id}/{date}.json for
// the other areas. Reading the paths (not the files) answers at the first
// paint and keeps the results data in its own chunk.
const RESULT_PATHS = new Set(
  Object.keys(RESULT_FILES).map((key) =>
    key.slice('../../content/results/'.length, -'.json'.length),
  ),
)

/** Whether an election has a results file; synchronous, loads nothing. */
export function hasResultsFile(electionId: string): boolean {
  const region = regionForElection(electionId)
  if (!region) return false
  const dir = region === COOK ? '' : `${region.id}/`
  return RESULT_PATHS.has(`${dir}${region.election.date}`)
}

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
