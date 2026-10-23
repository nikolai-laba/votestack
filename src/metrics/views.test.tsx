import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { ballotStore } from '../picks/store.ts'
import { routes } from '../routes.tsx'
import type { Ballot } from '../shared/ballot.ts'
import { usage } from './usage.ts'

/** Page views counted from opening `path`, then while `run` goes. */
async function views(path: string, run?: (go: (to: string) => void) => void) {
  const before = usage.pending().length
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  await screen.findAllByRole('heading')
  if (run) {
    await act(async () => run((to) => void router.navigate(to)))
    await screen.findAllByRole('heading')
  }
  return {
    path: router.state.location.pathname,
    views: usage
      .pending()
      .slice(before)
      .filter((e) => e.e === 'view'),
  }
}

describe('page views', () => {
  it('counts a first visit to / without a ballot once, as Get Started opened first', async () => {
    expect(await views('/')).toEqual({
      path: '/getstarted',
      views: [{ e: 'view', page: 'start', from: 'landing' }],
    })
  })

  it('counts a link to / without a ballot once, as Get Started', async () => {
    expect(await views('/about', (go) => go('/'))).toEqual({
      path: '/getstarted',
      views: [
        { e: 'view', page: 'about', from: 'landing' },
        { e: 'view', page: 'start', from: 'app' },
      ],
    })
  })

  it('still counts / with a ballot on the device as the ballot', async () => {
    ballotStore.saveBallot(ballot)
    expect(await views('/')).toEqual({
      path: '/',
      views: [{ e: 'view', page: 'ballot', from: 'landing' }],
    })
  })
})

const IL = 'ocd-division/country:us/state:il'
const ballot: Ballot = {
  election: {
    id: 'il-2026-11-03-general',
    name: 'Illinois General Election',
    date: '2026-11-03',
    divisionId: IL,
  },
  contests: [
    {
      kind: 'candidate',
      id: 'gov',
      electionId: 'il-2026-11-03-general',
      authorityId: `${IL}/county:cook`,
      districtId: IL,
      title: 'Governor and Lieutenant Governor',
      office: 'Governor and Lieutenant Governor',
      voteFor: 1,
      candidates: [{ name: 'Jane Doe', party: 'Democratic' }],
      sources: [],
      lastVerified: '2026-10-04',
    },
  ],
  coverage: { status: 'complete', notes: [] },
}
