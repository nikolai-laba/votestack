import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RACES_QUERY_KEY, type RaceData } from '../races/data.ts'
import { routes } from '../routes.tsx'
import type { Ballot } from '../shared/ballot.ts'
import type { CandidateProfile } from '../shared/profile.ts'
import type { RaceList } from '../shared/races.ts'

const IL = 'ocd-division/country:us/state:il'
const list: RaceList = {
  electionId: 'il-2026-11-03-general',
  electionName: 'General Election',
  date: '2026-11-03',
  area: 'Cook County, Illinois',
  areaPath: 'il/cook-county/2026-11-03',
  races: [
    {
      level: 'state',
      path: 'il/2026-11-03/state-senator-5th-district',
      kind: 'candidate',
      title: 'State Senator, 5th District',
      office: 'State Senator',
      districtId: `${IL}/sldu:5`,
      contestIds: ['cook-clerk:170502', 'chicago-boe:ss-5'],
      ballots: ['chicago', 'suburban-cook'],
      voteFor: 1,
      candidates: [
        {
          name: 'Jane Doe',
          party: 'Democratic',
          ballotOrder: 1,
          incumbent: true,
        },
        { name: 'Rick Roe', party: 'Republican', ballotOrder: 2 },
      ],
    },
    {
      level: 'retention',
      path: 'il/cook-county/2026-11-03/retention-lewis-nixon',
      kind: 'retention',
      title: 'Judge, Circuit Court',
      office: 'Judge, Circuit Court',
      districtId: `${IL}/county:cook`,
      contestIds: ['cook-clerk:r-nixon'],
      ballots: ['suburban-cook'],
      judge: 'Lewis Nixon',
    },
  ],
}
const data: RaceData = { list, published: ['jane-doe', 'lewis-nixon'] }

const SENATE = '/races/il/2026-11-03/state-senator-5th-district'

function renderAt(path: string) {
  const client = new QueryClient()
  client.setQueryData(RACES_QUERY_KEY, data)
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

function ballotWith(contestId: string): Ballot {
  return {
    election: {
      id: 'il-2026-11-03-general',
      name: 'Illinois General Election',
      date: '2026-11-03',
      divisionId: IL,
    },
    contests: [
      {
        kind: 'candidate',
        id: contestId,
        electionId: 'il-2026-11-03-general',
        districtId: `${IL}/sldu:9`,
        authorityId: `${IL}/county:cook`,
        title: 'State Senator, 9th District',
        office: 'State Senator',
        voteFor: 1,
        candidates: [{ name: 'Sam Poe' }],
        sources: [],
        lastVerified: '2026-10-04',
      },
    ],
    coverage: { status: 'complete', notes: [] },
    publishedProfiles: [],
  }
}

function mockFetch(routesByUrl: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url in routesByUrl
        ? Response.json(routesByUrl[url])
        : new Response(null, { status: 404 }),
    ),
  )
}

async function lookUp() {
  await userEvent.type(
    await screen.findByLabelText(/street address/i),
    '834 Lake St',
  )
  await userEvent.type(screen.getByLabelText(/city/i), 'Oak Park')
  await userEvent.type(screen.getByLabelText(/zip/i), '60301')
  await userEvent.click(screen.getByRole('button', { name: /find my ballot/i }))
}

afterEach(() => vi.unstubAllGlobals())

describe('race pages', () => {
  it('shows a race with everyone in it, in ballot order, without pick boxes', async () => {
    renderAt(SENATE)
    const h1 = await screen.findByRole('heading', {
      level: 1,
      name: 'State Senator, 5th District',
    })
    expect(h1).toHaveFocus()
    expect(document.title).toBe(
      'State Senator, 5th District (Illinois): 2026 candidates | VoteStack',
    )
    expect(
      screen.getByText('Voters in the 5th State Senate District.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Chicago and suburban Cook County'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /^Jane Doe,Democratic, incumbent/ }),
    ).toHaveAttribute('href', '/candidates/jane-doe')
    expect(
      screen.getByText('Rick Roe').parentElement?.parentElement,
    ).toHaveTextContent('No profile yet')
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(
      screen.getByRole('link', { name: 'All races in Cook County, Illinois' }),
    ).toHaveAttribute('href', '/races/il/cook-county/2026-11-03')
  })

  it('opens the ballot at the race after a lookup from its page', async () => {
    mockFetch({ '/api/ballot': ballotWith('chicago-boe:ss-5') })
    const router = renderAt(SENATE)
    await lookUp()
    // The ballot's own card for the race takes focus.
    expect(
      await screen.findByRole('heading', {
        level: 3,
        name: 'State Senator, 9th District',
      }),
    ).toHaveFocus()
    expect(router.state.location.pathname).toBe('/')
    expect(JSON.stringify(router.state.location.state)).not.toMatch(/lake/i)
  })

  it('says so when the race isn’t on the ballot', async () => {
    mockFetch({ '/api/ballot': ballotWith('other') })
    renderAt(SENATE)
    await lookUp()
    expect(
      await screen.findByText(
        /^State Senator, 5th District isn.t on the ballot for this address\.$/,
      ),
    ).toHaveFocus()
  })

  it('says whether the race is on a ballot already looked up', async () => {
    mockFetch({ '/api/ballot': ballotWith('cook-clerk:170502') })
    const router = renderAt('/getstarted')
    await lookUp()
    await screen.findByRole('heading', {
      level: 1,
      name: 'Illinois General Election',
    })
    await router.navigate(SENATE)
    expect(
      await screen.findByText(/^Yes, it.s on the ballot you looked up\.$/),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText(/street address/i)).toBeNull()
    await userEvent.click(
      screen.getByRole('link', { name: 'Show it on your ballot' }),
    )
    expect(
      await screen.findByRole('heading', {
        level: 3,
        name: 'State Senator, 9th District',
      }),
    ).toHaveFocus()
  })

  it('names a judge’s retention page after the judge', async () => {
    renderAt('/races/il/cook-county/2026-11-03/retention-lewis-nixon')
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Retention of Lewis Nixon, Judge, Circuit Court',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('Suburban Cook County only')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /yes/i })).toBeNull()
  })

  it('lists every race in the area by level, each linked', async () => {
    renderAt('/races/il/cook-county/2026-11-03')
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Races in Cook County, Illinois',
      }),
    ).toHaveFocus()
    const state = screen.getByRole('region', { name: 'State' })
    expect(
      within(state).getByRole('link', { name: /State Senator, 5th District/ }),
    ).toHaveAttribute('href', SENATE)
    const retention = screen.getByRole('region', { name: 'Judicial retention' })
    expect(
      within(retention).getByRole('link', { name: /Lewis Nixon/ }),
    ).toHaveAttribute(
      'href',
      '/races/il/cook-county/2026-11-03/retention-lewis-nixon',
    )
  })

  it('lists the areas VoteStack covers at /races', async () => {
    renderAt('/races')
    expect(
      await screen.findByRole('link', { name: 'Cook County, Illinois' }),
    ).toHaveAttribute('href', '/races/il/cook-county/2026-11-03')
  })

  it('shows not found for an unknown race', async () => {
    renderAt('/races/il/2026-11-03/nope')
    expect(
      await screen.findByRole('heading', { name: 'Page not found' }),
    ).toBeInTheDocument()
  })

  it('links the home page to the area list', () => {
    renderAt('/getstarted')
    expect(
      screen.getByRole('link', { name: 'browse every race in Cook County' }),
    ).toHaveAttribute('href', '/races/il/cook-county/2026-11-03')
  })
})

describe('a profile opened without a ballot', () => {
  const profile: CandidateProfile = {
    key: 'jane-doe',
    electionId: 'il-2026-11-03-general',
    name: 'Jane Doe',
    party: 'Democratic',
    office: 'State Senator, 5th District',
    contestIds: ['cook-clerk:170502', 'chicago-boe:ss-5'],
    kind: 'candidate',
    tier: 'mid',
    overview: { asOf: '2026-10-05', items: [] },
    money: { asOf: '2026-10-05', items: [] },
    endorsements: { asOf: '2026-10-05', items: [] },
    sources: [],
    meta: {
      model: 'm',
      promptVersion: 'p',
      generatedAt: '2026-10-07T20:00:00Z',
      version: 1,
    },
  }

  it('shows the race, everyone in it and the address form', async () => {
    mockFetch({ '/api/profile/jane-doe': profile })
    renderAt('/candidates/jane-doe')
    const race = await screen.findByRole('region', {
      name: 'On the ballot: State Senator, 5th District',
    })
    expect(
      within(race).getByRole('link', { name: 'State Senator, 5th District' }),
    ).toHaveAttribute('href', SENATE)
    expect(within(race).getByText('Rick Roe')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Is this race on your ballot?' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/street address/i)).toBeInTheDocument()
  })
})
