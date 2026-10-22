import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usage } from '../../metrics/usage.ts'
import { ballotStore } from '../../picks/store.ts'
import { routes } from '../../routes.tsx'
import type { Ballot } from '../../shared/ballot.ts'
import { CLOSED_KEY, SIGNUP_KEY, signupStore } from '../../signup/device.ts'

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

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const banner = () =>
  screen.queryByRole('complementary', { name: 'Email sign-up' })

/** Banner events queued since `from` (the queue is shared by the app). */
const bannerEvents = (from: number) =>
  usage
    .pending()
    .filter((e) => e.e === 'banner')
    .slice(from)
const bannerCount = () => bannerEvents(0).length

afterEach(() => vi.unstubAllGlobals())

describe('the email sign-up banner', () => {
  it('shows nothing without a ballot on the device', () => {
    renderAt('/about')
    expect(banner()).toBeNull()
  })

  it('shows one line above the menu once a ballot is saved', () => {
    ballotStore.saveBallot(ballot)
    renderAt('/about')
    const aside = banner()!
    expect(aside).toHaveTextContent('Get an email before your next election.')
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute(
      'href',
      '/notify',
    )
    const skip = screen.getByRole('link', { name: 'Skip to main content' })
    const header = screen.getByRole('banner')
    expect(
      skip.compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      aside.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('stays off Saved choices and the sign-up page', async () => {
    ballotStore.saveBallot(ballot)
    renderAt('/saved-choices')
    await screen.findByRole('heading', { level: 1, name: 'Saved choices' })
    expect(banner()).toBeNull()
    cleanup()

    renderAt('/notify')
    await screen.findByRole('heading', {
      level: 1,
      name: 'Hear from VoteStack before your next election',
    })
    expect(banner()).toBeNull()
  })

  it('closing hides it for the visit, moves focus to the menu and counts the close', async () => {
    ballotStore.saveBallot(ballot)
    renderAt('/about')
    const from = bannerCount()
    await userEvent.click(
      screen.getByRole('button', { name: 'Close the email sign-up banner' }),
    )
    expect(banner()).toBeNull()
    expect(screen.getByRole('link', { name: 'VoteStack home' })).toHaveFocus()
    expect(bannerEvents(from)).toEqual([{ e: 'banner', act: 'closed' }])
    expect(sessionStorage.getItem(CLOSED_KEY)).toBe('1')
    expect(signupStore.getSnapshot().closes).toBe(1)

    // Still closed after a reload in the same tab.
    cleanup()
    act(() => signupStore.reload())
    renderAt('/about')
    expect(banner()).toBeNull()
  })

  it('counts the banner as shown once per visit', () => {
    ballotStore.saveBallot(ballot)
    const from = bannerCount()
    renderAt('/about')
    cleanup()
    renderAt('/')
    expect(bannerEvents(from)).toEqual([{ e: 'banner', act: 'shown' }])
  })

  it('stays away after three closes or after a sign-up', () => {
    ballotStore.saveBallot(ballot)
    localStorage.setItem(SIGNUP_KEY, '{"signedUp":false,"closes":3}')
    act(() => signupStore.reload())
    renderAt('/about')
    expect(banner()).toBeNull()
    cleanup()

    localStorage.setItem(SIGNUP_KEY, '{"signedUp":false,"closes":0}')
    act(() => signupStore.reload())
    renderAt('/about')
    expect(banner()).not.toBeNull()
    act(() => signupStore.markSignedUp())
    expect(banner()).toBeNull()
  })

  it('leads to the sign-up page, marked as coming from the banner', async () => {
    ballotStore.saveBallot(ballot)
    const router = renderAt('/about')
    await userEvent.click(screen.getByRole('link', { name: 'Sign up' }))
    expect(router.state.location.pathname).toBe('/notify')
    expect(router.state.location.state).toEqual({ from: 'banner' })
  })

  it('shows nothing for a sample ballot alone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/api/ballot'
          ? Response.json(ballot)
          : new Response(null, { status: 404 }),
      ),
    )
    renderAt('/getstarted')
    await userEvent.click(
      await screen.findByRole('button', { name: 'Oak Park Village Hall' }),
    )
    await screen.findByRole('heading', { level: 1, name: /Sample ballot/ })
    expect(banner()).toBeNull()
  })
})
