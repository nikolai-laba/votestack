import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ballotStore, STORAGE_KEY } from '../picks/store.ts'
import { routes } from '../routes.tsx'
import type { Ballot, Contest } from '../shared/ballot.ts'

const IL = 'ocd-division/country:us/state:il'
const base = {
  electionId: 'il-2026-11-03-general',
  authorityId: `${IL}/county:cook`,
  sources: [],
  lastVerified: '2026-10-04',
}
const election = {
  id: 'il-2026-11-03-general',
  name: 'Illinois General Election',
  date: '2026-11-03',
  divisionId: IL,
}
const governor: Contest = {
  ...base,
  kind: 'candidate',
  id: 'gov',
  districtId: IL,
  title: 'Governor and Lieutenant Governor',
  office: 'Governor and Lieutenant Governor',
  voteFor: 1,
  candidates: [
    { name: 'Jane Doe', party: 'Democratic', ballotOrder: 1 },
    { name: 'Richard Roe', party: 'Republican', ballotOrder: 2 },
  ],
}
const retention: Contest = {
  ...base,
  kind: 'retention',
  id: 'r',
  districtId: `${IL}/county:cook`,
  title: 'Retention: Judge, Cook County Judicial Circuit',
  office: 'Judge, Cook County Judicial Circuit',
  judge: 'John Roe',
}
const referendum: Contest = {
  ...base,
  kind: 'measure',
  id: 'm',
  districtId: `${IL}/county:cook`,
  title: 'Transit Question',
  question: 'Shall the county…?',
}

/** The voter's own ballot (Oak Park). */
const own: Ballot = {
  election,
  precinct: { id: 'cook:8500022', name: 'Oak Park 22', districtIds: [] },
  contests: [
    governor,
    {
      ...base,
      kind: 'candidate',
      id: 'op-trustee',
      districtId: `${IL}/place:oak_park`,
      title: 'Trustee, Village of Oak Park',
      office: 'Trustee',
      voteFor: 1,
      candidates: [{ name: 'Pat Moe' }],
    },
  ],
  coverage: { status: 'complete', notes: [] },
}

/** The ballot for the area around Wrigley Field. */
const wrigley: Ballot = {
  election,
  precinct: {
    id: 'chicago:44-13',
    name: 'Ward 44 Precinct 13',
    districtIds: [],
  },
  contests: [
    governor,
    {
      ...base,
      kind: 'candidate',
      id: 'ward-44',
      districtId: `${IL}/place:chicago/ward:44`,
      title: 'Committeeperson, Ward 44',
      office: 'Committeeperson',
      voteFor: 1,
      candidates: [{ name: 'Lee Foe' }],
    },
    retention,
    referendum,
  ],
  coverage: { status: 'complete', notes: [] },
  publishedProfiles: ['jane-doe'],
}

function mockApi() {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url !== '/api/ballot')
      return Response.json({ error: 'Not found' }, { status: 404 })
    const { address } = JSON.parse(String(init?.body)) as { address: string }
    return Response.json(address.includes('1060 W Addison') ? wrigley : own)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

function renderAt(path = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, ...view }
}

/** A saved ballot with one pick, as a return visit finds it. */
function saveOwnBallot() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 1,
      ballot: {
        election: own.election,
        contests: own.contests,
        coverage: own.coverage,
      },
      picks: { [election.id]: { gov: ['jane-doe'] } },
    }),
  )
  ballotStore.reload()
  return localStorage.getItem(STORAGE_KEY)
}

const samples = () => screen.getByRole('group', { name: /sample ballot/i })

async function openWrigley() {
  await userEvent.click(
    within(samples()).getByRole('button', { name: 'Wrigleyville' }),
  )
  await screen.findByText('Committeeperson, Ward 44')
}

afterEach(() => vi.unstubAllGlobals())

describe('sample ballots', () => {
  it('offers three sample ballots under the privacy note', () => {
    renderAt()
    const note = screen.getByText(/we use your address once/i)
    const group = samples()
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([
      'Oak Park Village Hall',
      'Wrigleyville',
      'Art Institute of Chicago',
    ])
    expect(group).toHaveTextContent('Or see a sample ballot:')
    expect(
      note.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('shows a labeled sample with no pick controls, through the same lookup', async () => {
    const fetch = mockApi()
    const { router } = renderAt()
    await openWrigley()

    const heading = screen.getByRole('heading', {
      level: 1,
      name: 'Sample ballot for the area around Wrigley Field',
    })
    expect(heading).toHaveFocus()
    expect(
      screen.getByRole('link', { name: 'Search a new address' }),
    ).toHaveAttribute('href', '/getstarted')
    expect(screen.getByText(/this ballot has 2 races/i)).toBeInTheDocument()

    // No picking anywhere on a sample.
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /^yes on/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^no on/i })).toBeNull()
    expect(screen.queryByText(/to make a list/i)).toBeNull()

    // The address goes in the request body; the URL stays clean.
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/ballot')
    expect(JSON.parse(String(init.body))).toEqual({
      address: '1060 W Addison St, Chicago, IL 60613',
    })
    expect(router.state.location.pathname).toBe('/')
    expect(router.state.location.search).toBe('')
  })

  it('writes nothing to the device', async () => {
    mockApi()
    renderAt()
    await openWrigley()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(ballotStore.getSnapshot().ballot).toBeNull()
  })

  it('leaves the voter’s saved ballot and picks alone', async () => {
    mockApi()
    const before = saveOwnBallot()
    renderAt()
    expect(
      screen.getByRole('link', { name: 'Saved Choices (1 picked)' }),
    ).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('link', { name: 'Search a new address' }),
    )
    await openWrigley()

    expect(localStorage.getItem(STORAGE_KEY)).toBe(before)
    expect(
      screen.getByRole('link', { name: 'Saved Choices (1 picked)' }),
    ).toBeInTheDocument()

    // Saved choices shows the voter's own ballot, never the sample.
    await userEvent.click(
      screen.getByRole('link', { name: 'Saved Choices (1 picked)' }),
    )
    await screen.findByRole('heading', { level: 1, name: 'Saved choices' })
    expect(screen.getByText('Trustee, Village of Oak Park')).toBeInTheDocument()
    // (The hidden list keeps the sample mounted; roles skip hidden content.)
    expect(
      screen.queryByRole('heading', { name: 'Committeeperson, Ward 44' }),
    ).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before)

    // "Show on ballot" goes to the voter's own ballot, leaving the sample.
    await userEvent.click(
      screen.getByRole('link', {
        name: 'Show on ballot: Governor and Lieutenant Governor',
      }),
    )
    await vi.waitFor(() =>
      expect(
        screen.getByRole('heading', {
          level: 3,
          name: 'Governor and Lieutenant Governor',
        }),
      ).toHaveFocus(),
    )
    expect(screen.queryByText(/sample ballot for the area/i)).toBeNull()
    expect(
      screen.getByRole('checkbox', {
        name: 'Pick Jane Doe for Governor and Lieutenant Governor',
      }),
    ).toBeChecked()
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before)
  })

  it('goes back to the address form, and the own lookup is saved as usual', async () => {
    mockApi()
    const { router } = renderAt()
    await openWrigley()
    await userEvent.click(
      screen.getByRole('link', { name: 'Search a new address' }),
    )

    expect(router.state.location.pathname).toBe('/getstarted')
    expect(screen.queryByText(/sample ballot for the area/i)).toBeNull()
    const street = screen.getByLabelText(/street address/i)
    await vi.waitFor(() => expect(street).toHaveFocus())

    await userEvent.type(street, '834 Lake St')
    await userEvent.type(screen.getByLabelText(/city/i), 'Oak Park')
    await userEvent.type(screen.getByLabelText(/zip/i), '60301')
    await userEvent.click(
      screen.getByRole('button', { name: /find my ballot/i }),
    )
    await screen.findByText('Trustee, Village of Oak Park')

    expect(router.state.location.pathname).toBe('/')
    expect(
      screen.getByText(/you have 2 races on your ballot/i),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0)
    expect(
      JSON.parse(localStorage.getItem(STORAGE_KEY)!).ballot.contests,
    ).toHaveLength(2)
  })

  it('opens profiles from a sample with no pick boxes, and comes back to it', async () => {
    mockApi()
    renderAt()
    await openWrigley()
    await userEvent.click(screen.getByRole('link', { name: /jane doe/i }))

    const panel = await screen.findByRole('region', {
      name: 'On this sample ballot',
    })
    expect(within(panel).queryAllByRole('checkbox')).toHaveLength(0)
    expect(
      screen.getByText('Sample ballot for the area around Wrigley Field', {
        selector: 'p',
      }),
    ).toBeInTheDocument()

    await userEvent.click(
      within(panel).getByRole('link', { name: 'Back to your full ballot' }),
    )
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Sample ballot for the area around Wrigley Field',
      }),
    ).toBeInTheDocument()
  })

  it('is gone after a reload', async () => {
    mockApi()
    const { unmount } = renderAt()
    await openWrigley()
    unmount()

    const { router } = renderAt()
    expect(router.state.location.pathname).toBe('/getstarted')
    expect(screen.queryByText(/sample ballot for the area/i)).toBeNull()
    expect(
      screen.getByRole('heading', { name: /on your ballot/i }),
    ).toBeInTheDocument()
  })

  it('opens from /getstarted at / and gives way to the saved ballot after a reload', async () => {
    mockApi()
    saveOwnBallot()
    const first = renderAt('/getstarted')
    await openWrigley()
    expect(first.router.state.location.pathname).toBe('/')
    expect(first.router.state.location.search).toBe('')
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Sample ballot for the area around Wrigley Field',
      }),
    ).toHaveFocus()
    first.unmount()

    const { router } = renderAt()
    expect(router.state.location.pathname).toBe('/')
    expect(screen.queryByText(/sample ballot for the area/i)).toBeNull()
    expect(screen.getByText('Trustee, Village of Oak Park')).toBeInTheDocument()
  })
})
