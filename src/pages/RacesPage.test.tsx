import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RACES_QUERY_KEY, type RaceData } from '../races/data.ts'
import { RESULTS_QUERY_KEY, type ResultsData } from '../results/data.ts'
import { routes } from '../routes.tsx'
import type { Ballot } from '../shared/ballot.ts'
import type { CandidateProfile } from '../shared/profile.ts'
import type { RaceList } from '../shared/races.ts'
import type { RaceResult } from '../shared/raceResults.ts'
import { resultsData } from '../test/results.tsx'

// Race pages end with the sign-up block only before an election, so these
// tests keep the after-election mode off.
const mode = vi.hoisted(() => ({ on: false }))
vi.mock('../shared/afterElection.ts', async (original) => ({
  ...(await original<typeof import('../shared/afterElection.ts')>()),
  get AFTER_ELECTION() {
    return mode.on
  },
}))

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
const CA = 'ocd-division/country:us/state:ca'
const laList: RaceList = {
  electionId: 'ca-2026-11-03-general',
  electionName: 'General Election',
  date: '2026-11-03',
  area: 'Los Angeles County, California',
  areaPath: 'ca/los-angeles-county/2026-11-03',
  races: [
    {
      level: 'county',
      path: 'ca/los-angeles-county/2026-11-03/supervisor-3rd-district',
      kind: 'candidate',
      title: 'Supervisor, 3rd District',
      office: 'Supervisor',
      districtId: `${CA}/county:los_angeles/council_district:3`,
      contestIds: ['la:sup-3'],
      ballots: ['los-angeles-county'],
      voteFor: 1,
      // A namesake of a Cook County candidate with a profile.
      candidates: [
        {
          name: 'Jane Doe',
          party: 'Party Preference: Democratic',
          designation: 'Educator',
          ballotOrder: 1,
        },
      ],
    },
  ],
}
const data: RaceData = {
  lists: [list, laList],
  published: { 'il-2026-11-03-general': ['jane-doe', 'lewis-nixon'] },
}

const SENATE = '/races/il/2026-11-03/state-senator-5th-district'

function renderAt(
  path: string,
  results?: ResultsData,
  raceData: RaceData = data,
) {
  const client = new QueryClient()
  client.setQueryData(RACES_QUERY_KEY, raceData)
  if (results) client.setQueryData(RESULTS_QUERY_KEY, results)
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
    // Results loaded and empty: the page keeps its Election Day head.
    renderAt(SENATE, resultsData({}, '2026-11-04T08:00:00Z'))
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
    expect(
      screen.getByRole('link', { name: 'Los Angeles County, California' }),
    ).toHaveAttribute('href', '/races/ca/los-angeles-county/2026-11-03')
  })

  it('shows a Los Angeles County race, with no profile links yet', async () => {
    renderAt('/races/ca/los-angeles-county/2026-11-03/supervisor-3rd-district')
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Supervisor, 3rd District',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Voters in the 3rd Supervisorial District of Los Angeles County.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Los Angeles County')).toBeInTheDocument()
    // The Cook County Jane Doe's profile isn't this candidate's.
    expect(screen.queryByRole('link', { name: /Jane Doe/ })).toBeNull()
    expect(screen.getByText('No profile yet')).toBeInTheDocument()
    expect(screen.getByText('Party Preference: Democratic')).toBeInTheDocument()
    expect(screen.getByText('Educator')).toBeInTheDocument()
    expect(document.title).toBe(
      'Supervisor, 3rd District (Los Angeles County): 2026 candidates | VoteStack',
    )
  })

  it('lists every race in Los Angeles County', async () => {
    renderAt('/races/ca/los-angeles-county/2026-11-03')
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Races in Los Angeles County, California',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/on any ballot in Los Angeles County\./),
    ).toBeInTheDocument()
  })

  it('shows not found for an unknown race', async () => {
    renderAt('/races/il/2026-11-03/nope')
    expect(
      await screen.findByRole('heading', { name: 'Page not found' }),
    ).toBeInTheDocument()
  })

  it('links the home page to the area lists', () => {
    renderAt('/getstarted')
    expect(
      screen.getByRole('link', { name: 'every race in Cook County' }),
    ).toHaveAttribute('href', '/races/il/cook-county/2026-11-03')
    expect(
      screen.getByRole('link', { name: 'every race in Los Angeles County' }),
    ).toHaveAttribute('href', '/races/ca/los-angeles-county/2026-11-03')
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
    // Headline is specific to the voter's area (fairness rule in VOICE.md 3.3).
    expect(
      screen.getByRole('heading', { name: 'Your Cook County ballot' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/street address/i)).toBeInTheDocument()
    // Top strip above the article and the mid-article pivot both link to
    // the address form on /getstarted.
    expect(
      screen.getByRole('link', { name: 'Explore your full ballot' }),
    ).toHaveAttribute('href', '/getstarted')
    expect(
      screen.getByRole('link', { name: 'See every race' }),
    ).toHaveAttribute('href', '/getstarted')
  })

  it('ends a race page with the email sign-up', async () => {
    renderAt(SENATE)
    await screen.findByRole('heading', {
      level: 1,
      name: 'State Senator, 5th District',
    })
    expect(
      screen.getByRole('region', {
        name: 'Hear from VoteStack before your next election',
      }),
    ).not.toHaveTextContent(/votes (again|next)/)
  })

  it('keeps the sign-up off the list of races', async () => {
    renderAt('/races/il/cook-county/2026-11-03')
    await screen.findByRole('heading', { level: 1 })
    expect(
      screen.queryByRole('region', {
        name: 'Hear from VoteStack before your next election',
      }),
    ).toBeNull()
  })
})

describe('results on the race lists', () => {
  const CHECKED_AT = '2026-11-06T01:30:00.000Z'
  const base: Pick<
    RaceResult,
    'scope' | 'certifyBy' | 'sources' | 'changedAt'
  > = {
    scope: 'within',
    certifyBy: '2026-11-24',
    sources: [],
    changedAt: CHECKED_AT,
  }
  const senate: RaceResult = {
    ...base,
    contestIds: ['cook-clerk:170502'],
    kind: 'candidate',
    status: 'called',
    voteFor: 1,
    choices: [
      { name: 'Jane Doe', votes: 660 },
      { name: 'Rick Roe', votes: 340 },
    ],
    winners: ['Jane Doe'],
  }
  const nixon: RaceResult = {
    ...base,
    contestIds: ['cook-clerk:r-nixon'],
    kind: 'retention',
    status: 'called',
    threshold: 0.6,
    choices: [
      { name: 'Yes', votes: 714 },
      { name: 'No', votes: 286 },
    ],
    winners: ['Yes'],
  }
  const loaded = (...results: RaceResult[]) =>
    resultsData({ 'il-2026-11-03-general': results }, CHECKED_AT)
  const AREA = '/races/il/cook-county/2026-11-03'
  const row = (name: string) =>
    screen.getByRole('link', { name: new RegExp(`^${name}`) })

  it('puts the results time in place of "Voting ended" and a result under each race', async () => {
    renderAt(AREA, loaded(senate, nixon))
    await screen.findByRole('heading', { level: 1 })
    expect(
      screen.getByText(
        'Results as of Thursday, November 5, 2026, 7:30 p.m. CT. Counts are unofficial until certified.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Voting ended/)).toBeNull()
    expect(row('State Senator, 5th District')).toHaveTextContent(
      'Won Jane Doe, 66.0%',
    )
    expect(row('Lewis Nixon')).toHaveTextContent('Retained 71.4% yes')
    expect(row('Lewis Nixon').querySelector('[data-fill="win"]')).toBeTruthy()
  })

  it('puts the results in the head of a race page and an area list', async () => {
    renderAt(SENATE, loaded(senate, nixon))
    await screen.findByRole('heading', { level: 1 })
    expect(document.title).toBe(
      'State Senator, 5th District (Illinois): 2026 results | VoteStack',
    )
    cleanup()
    renderAt(AREA, loaded(senate, nixon))
    await screen.findByRole('heading', { level: 1 })
    expect(document.title).toBe(
      'Races in Cook County, Illinois, 2026: results | VoteStack',
    )
  })

  it('colors the result text with tokens, not the race link’s color', async () => {
    const leading: RaceResult = {
      ...senate,
      status: 'counting',
      winners: undefined,
    }
    renderAt(AREA, loaded(leading, nixon))
    await screen.findByRole('heading', { level: 1 })
    const lead = row('State Senator, 5th District')
    const tag = lead.querySelector('[data-fill="lead"]')!
    expect(tag).toHaveClass('text-text')
    expect(tag.parentElement).toHaveClass('text-text')
    expect(tag.parentElement).not.toHaveClass('text-link')
    // A decided tag takes its colors from the fill, not from the link.
    const won = row('Lewis Nixon').querySelector('[data-fill="win"]')!
    expect(won).not.toHaveClass('text-text')
    expect(won.parentElement).toHaveClass('text-text')
  })

  it('keeps "No candidates filed" for a race with no candidates', async () => {
    const empty: RaceList = {
      ...list,
      races: [{ ...list.races[0], candidates: [] }],
    }
    renderAt(AREA, loaded(senate), { ...data, lists: [empty] })
    await screen.findByRole('heading', { level: 1 })
    expect(row('State Senator, 5th District')).toHaveTextContent(
      'No candidates filed',
    )
    expect(
      row('State Senator, 5th District').querySelector('[data-fill]'),
    ).toBeNull()
  })

  it('reads a vote-for-more-than-one race as a list of names with no shares', async () => {
    const council: RaceList = {
      ...list,
      races: [
        {
          level: 'local',
          path: 'il/cook-county/2026-11-03/board',
          kind: 'candidate',
          title: 'Board of Review',
          office: 'Board of Review',
          districtId: `${IL}/county:cook`,
          contestIds: ['cook-clerk:board'],
          ballots: ['suburban-cook'],
          voteFor: 3,
          candidates: ['A', 'B', 'C', 'D'].map((n, i) => ({
            name: `Person ${n}`,
            ballotOrder: i + 1,
          })),
        },
      ],
    }
    const board: RaceResult = {
      ...base,
      contestIds: ['cook-clerk:board'],
      kind: 'candidate',
      status: 'counting',
      voteFor: 3,
      choices: [
        { name: 'Person A', votes: 400 },
        { name: 'Person B', votes: 300 },
        { name: 'Person C', votes: 200 },
        { name: 'Person D', votes: 100 },
      ],
    }
    renderAt(AREA, loaded(board), { ...data, lists: [council] })
    await screen.findByRole('heading', { level: 1 })
    expect(row('Board of Review')).toHaveTextContent(
      'Leading Person A, Person B and Person C',
    )
    expect(row('Board of Review')).not.toHaveTextContent('%')
  })

  it('says a race is not called yet without a tag', async () => {
    renderAt(
      AREA,
      loaded({
        ...senate,
        status: 'counting',
        winners: undefined,
        choices: [
          { name: 'Jane Doe', votes: 0 },
          { name: 'Rick Roe', votes: 0 },
        ],
      }),
    )
    await screen.findByRole('heading', { level: 1 })
    const line = row('State Senator, 5th District')
    expect(line).toHaveTextContent('Not called yet')
    expect(line.querySelector('[data-fill]')).toBeNull()
  })

  it('keeps today’s detail for a race the results leave out', async () => {
    renderAt(AREA, loaded(senate))
    await screen.findByRole('heading', { level: 1 })
    expect(row('Lewis Nixon')).toHaveTextContent('Judge, Circuit Court')
  })

  it('keeps the line’s space, with no text, while the results load', async () => {
    renderAt(AREA)
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByText(/Results as of/)).toBeNull()
    expect(screen.queryByText(/Voting ended/)).toBeNull()
    expect(
      document.querySelectorAll('[data-results-placeholder]').length,
    ).toBeGreaterThanOrEqual(3)
    expect(row('State Senator, 5th District')).not.toHaveTextContent(
      /candidates|Jane Doe/,
    )
  })

  it('leaves the race page’s card to say who counted, and keeps "Voting ended" for a race with no result', async () => {
    mode.on = true
    try {
      renderAt(SENATE, loaded(senate))
      await screen.findByRole('heading', { level: 1 })
      expect(screen.queryByText(/Voting ended/)).toBeNull()
      cleanup()

      renderAt(
        '/races/il/cook-county/2026-11-03/retention-lewis-nixon',
        loaded(senate),
      )
      await screen.findByRole('heading', { level: 1 })
      expect(screen.getByText(/^Voting ended on/)).toBeInTheDocument()
    } finally {
      mode.on = false
    }
  })
})
