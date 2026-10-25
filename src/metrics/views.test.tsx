import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ballotStore } from '../picks/store.ts'
import { routes } from '../routes.tsx'
import type { Ballot } from '../shared/ballot.ts'
import type { CandidateProfile } from '../shared/profile.ts'
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

/**
 * Opens `path` with a fresh copy of the app and its counter, so the visit
 * starts here (the counter keeps the visit in memory as well as in the
 * tab's storage), and returns the counter.
 */
async function freshApp(path: string) {
  vi.resetModules()
  const { routes } = await import('../routes.tsx')
  const { usage } = await import('./usage.ts')
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  await screen.findAllByRole('heading')
  return usage
}

const visitSteps = (counter: typeof usage) =>
  counter
    .pending()
    .flatMap((e) => (e.e === 'visit' ? [`${e.entry}/${e.step}`] : []))

/** Answers the Worker's API with Jane Doe's profile. */
function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === '/api/profile/jane-doe'
        ? Response.json(profile)
        : Response.json({ error: 'Not found' }, { status: 404 }),
    ),
  )
}

/** An IntersectionObserver that reports everything it watches in view. */
class InView {
  callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
  }
  observe(el: Element) {
    this.callback(
      [{ isIntersecting: true, target: el } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }
  unobserve() {}
  disconnect() {}
}

afterEach(() => vi.unstubAllGlobals())

describe('visits', () => {
  it('a visit landing on a profile starts on the reader path', async () => {
    mockApi()
    const counter = await freshApp('/candidates/jane-doe')
    await screen.findByRole('heading', { level: 1, name: 'Jane Doe' })
    expect(visitSteps(counter)[0]).toBe('profile/arrived')
  })

  it('a visit to / without a ballot shows the form', async () => {
    vi.stubGlobal('IntersectionObserver', InView)
    const counter = await freshApp('/')
    await screen.findByRole('button', { name: /find my ballot/i })
    expect(visitSteps(counter)).toEqual(['start/arrived', 'start/form'])
  })

  it('a valid address sent from the form counts as asked', async () => {
    mockApi()
    const counter = await freshApp('/getstarted')
    await userEvent.type(
      screen.getByLabelText(/street address/i),
      '834 Lake St',
    )
    await userEvent.type(screen.getByLabelText(/city/i), 'Oak Park')
    await userEvent.type(screen.getByLabelText(/zip/i), '60301')
    await userEvent.click(
      screen.getByRole('button', { name: /find my ballot/i }),
    )
    expect(visitSteps(counter)).toContain('start/asked')
    // Not under a race: no link is credited.
    expect(counter.pending().some((e) => e.e === 'cta')).toBe(false)
  })

  it('clicking the top strip counts the link', async () => {
    mockApi()
    const counter = await freshApp('/candidates/jane-doe')
    await userEvent.click(
      await screen.findByRole('link', { name: 'Explore your full ballot' }),
    )
    expect(counter.pending()).toContainEqual({
      e: 'cta',
      link: 'top',
      page: 'profile',
    })
  })
})

const profile: CandidateProfile = {
  key: 'jane-doe',
  electionId: 'il-2026-11-03-general',
  name: 'Jane Doe',
  party: 'Democratic',
  office: 'Governor and Lieutenant Governor',
  contestIds: ['gov'],
  kind: 'candidate',
  tier: 'top',
  overview: { asOf: '2026-10-05', items: [] },
  money: { asOf: '2026-10-05', items: [] },
  endorsements: { asOf: '2026-10-05', items: [] },
  sources: [],
  meta: {
    model: 'test',
    promptVersion: '1',
    generatedAt: '2026-10-06T15:00:00Z',
    version: 1,
  },
}
