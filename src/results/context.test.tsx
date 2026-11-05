import { describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  ResultsProvider,
  useElectionHasResults,
  useElectionResultsPending,
} from './context.tsx'
import { RESULTS_QUERY_KEY, loadResults } from './data.ts'

function Probe({ id }: { id: string }) {
  return (
    <p>
      {String(useElectionHasResults(id))}{' '}
      {String(useElectionResultsPending(id))}
    </p>
  )
}
const setup = (id: string) => {
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <ResultsProvider>
        <Probe id={id} />
      </ResultsProvider>
    </QueryClientProvider>,
  )
  return client
}

describe('results context', () => {
  it('has results and is pending before the data loads, then not pending', async () => {
    const client = setup('il-2026-11-03-general')
    expect(screen.getByText('true true')).toBeTruthy()
    await act(async () => {
      client.setQueryData(RESULTS_QUERY_KEY, await loadResults())
    })
    expect(await screen.findByText('true false')).toBeTruthy()
  })

  it('is not pending for an election without a results file', () => {
    setup('il-2027-02-23-municipal')
    expect(screen.getByText('false false')).toBeTruthy()
  })

  it('starts loading at mount', async () => {
    const client = setup('il-2026-11-03-general')
    await act(async () => {
      await client.getQueryCache().find({ queryKey: RESULTS_QUERY_KEY })!
        .promise
    })
    expect(await screen.findByText('true false')).toBeTruthy()
  })
})
