// A test double for the app's results: hand-made results per election,
// already loaded into the provider, so tests never read the committed files.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { ResultsProvider } from '../results/context.tsx'
import { RACES_QUERY_KEY, type RaceData } from '../races/data.ts'
import { RESULTS_QUERY_KEY, type ResultsData } from '../results/data.ts'
import type { RaceResult } from '../shared/raceResults.ts'

/** Results by election ID, as the provider holds them once loaded. */
export function resultsData(
  byElection: Record<string, RaceResult[]>,
  checkedAt: string,
): ResultsData {
  const data: ResultsData = { byElection: {} }
  for (const [electionId, results] of Object.entries(byElection)) {
    const byContest = new Map<string, RaceResult>()
    for (const result of results)
      for (const id of result.contestIds) byContest.set(id, result)
    data.byElection[electionId] = { checkedAt, byContest }
  }
  return data
}

/** Renders inside the results provider (and a router), with the data loaded. */
export function renderWithResults(
  ui: ReactNode,
  data: ResultsData | undefined,
  races?: RaceData,
) {
  const client = new QueryClient()
  if (data) client.setQueryData(RESULTS_QUERY_KEY, data)
  if (races) client.setQueryData(RACES_QUERY_KEY, races)
  return render(
    <QueryClientProvider client={client}>
      <ResultsProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </ResultsProvider>
    </QueryClientProvider>,
  )
}
