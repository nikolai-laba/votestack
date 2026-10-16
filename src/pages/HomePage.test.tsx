import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ballotStore } from '../picks/store.ts'
import { routes } from '../routes.tsx'
import type { Ballot, Contest } from '../shared/ballot.ts'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, ...view }
}

const IL = 'ocd-division/country:us/state:il'
const base = {
  electionId: 'il-2026-11-03-general',
  authorityId: `${IL}/county:cook`,
  sources: [
    {
      name: 'Cook County Clerk',
      url: 'https://www.cookcountyclerkil.gov/',
      retrievedAt: '2026-10-04T00:00:00Z',
      official: true,
    },
  ],
  lastVerified: '2026-10-04',
}
const contests: Contest[] = [
  {
    ...base,
    kind: 'measure',
    id: 'm',
    districtId: `${IL}/county:cook`,
    title: 'Millionaire Tax Amendment',
    question: 'Shall the county…?',
    ballotOrder: 1804,
  },
  {
    ...base,
    kind: 'candidate',
    id: 'gov',
    districtId: IL,
    title: 'Governor and Lieutenant Governor',
    office: 'Governor and Lieutenant Governor',
    voteFor: 1,
    candidates: [{ name: 'Jane Doe', party: 'Democratic' }],
    ballotOrder: 150100,
  },
  {
    ...base,
    kind: 'retention',
    id: 'r',
    districtId: `${IL}/county:cook`,
    title: 'Retention: Judge, Cook County Judicial Circuit',
    office: 'Judge, Cook County Judicial Circuit',
    judge: 'John Roe',
    ballotOrder: 720001,
  },
]
const ballot: Ballot = {
  election: {
    id: 'il-2026-11-03-general',
    name: 'Illinois General Election',
    date: '2026-11-03',
    divisionId: IL,
  },
  precinct: { id: 'cook:8500022', name: 'Oak Park 22', districtIds: [] },
  contests,
  coverage: {
    status: 'possible_gaps',
    notes: ['1 contest is not matched to districts yet.'],
    officialSampleBallotUrl:
      'https://www.cookcountyclerkil.gov/elections/your-voter-information',
  },
}

function mockApi(status: number, body: unknown) {
  const fetch = vi.fn(async () => Response.json(body, { status }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

async function lookUp(street: string, city = 'Oak Park', zip = '60301') {
  await userEvent.type(screen.getByLabelText(/street address/i), street)
  await userEvent.type(screen.getByLabelText(/city/i), city)
  await userEvent.type(screen.getByLabelText(/zip/i), zip)
  await userEvent.click(screen.getByRole('button', { name: /find my ballot/i }))
}

afterEach(() => vi.unstubAllGlobals())

describe('HomePage', () => {
  it('shows the address form and disclaimers', () => {
    renderAt('/')
    expect(
      screen.getByRole('heading', { name: /on your ballot/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: /registered voting address/i }),
    ).toBeInTheDocument()
    expect(
      screen.getAllByText(/independent, nonpartisan, open source/i),
    ).toHaveLength(2)
    expect(screen.getByText(/www\.cityofchicago\.org/)).toBeInTheDocument()
  })

  it('sends the address in the body only, never the URL', async () => {
    const fetch = mockApi(200, ballot)
    renderAt('/')
    await lookUp('834 Lake St')
    await screen.findByText('Oak Park 22', { exact: false })

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/ballot')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      address: '834 Lake St, Oak Park, IL 60301',
    })
  })

  it('sends a Los Angeles County address with California’s state code', async () => {
    const fetch = mockApi(200, ballot)
    renderAt('/')
    await lookUp('200 N Spring St', 'Los Angeles', '90012')
    await screen.findByText('Oak Park 22', { exact: false })
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      address: '200 N Spring St, Los Angeles, CA 90012',
    })
  })

  it('shows the ballot in sections with possible gaps', async () => {
    mockApi(200, ballot)
    renderAt('/')
    await lookUp('834 Lake St')

    const results = await screen.findByRole('article')
    const headings = within(results)
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent)
    // Referenda come last even though the Clerk numbers them first.
    expect(headings).toEqual([
      'Some races may be missing from this list',
      'State',
      'Judicial retention',
      'Referenda and questions',
    ])
    expect(
      screen.getByText(
        /^You have 1 race, 1 judge up for retention and 1 referendum/,
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText(/not matched to districts/i)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /official sample ballot/i }),
    ).toHaveAttribute('href', ballot.coverage.officialSampleBallotUrl)
    expect(screen.getByText('Judges up for retention (1)')).toBeVisible()
    expect(screen.getByText('Official ballot text')).toBeInTheDocument()
    // Sources, checked dates and the ballot order explainer live on the
    // About page now, linked from the site footer.
    expect(
      within(results).queryByRole('link', { name: 'Cook County Clerk' }),
    ).toBeNull()
    expect(within(results).queryByText(/checked/)).toBeNull()
    expect(within(results).queryByText(/public lotteries/)).toBeNull()
  })

  it('uses California’s words for measures and links the state voter guide', async () => {
    const CA = 'ocd-division/country:us/state:ca'
    const prop: Contest = {
      ...base,
      electionId: 'ca-2026-11-03-general',
      authorityId: `${CA}/county:los_angeles`,
      kind: 'measure',
      id: 'p1',
      districtId: CA,
      title:
        'Proposition 1: Authorizes Bonds for Housing Affordability Programs',
      question: 'Authorizes bonds.\nFiscal Impact: Costs.',
      guide: {
        name: 'California voter guide',
        url: 'https://voterguide.sos.ca.gov/propositions/1/',
      },
    }
    mockApi(200, {
      ...ballot,
      election: {
        id: 'ca-2026-11-03-general',
        name: 'General Election',
        date: '2026-11-03',
        divisionId: CA,
      },
      contests: [prop, { ...prop, id: 'p2', guide: undefined }],
    })
    renderAt('/')
    await lookUp('200 N Spring St', 'Los Angeles', '90012')

    const results = await screen.findByRole('article')
    expect(
      within(results).getByRole('heading', {
        level: 2,
        name: 'Propositions and measures',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText(/^You have 0 races and 2 measures/)).toBeVisible()
    const links = within(results).getAllByRole('link', {
      name: 'California voter guide',
    })
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute(
      'href',
      'https://voterguide.sos.ca.gov/propositions/1/',
    )
    expect(links[0].parentElement).toHaveTextContent(
      'Full text and arguments: California voter guide',
    )
  })

  it('shows no notice when the ballot matched every official list', async () => {
    mockApi(200, {
      ...ballot,
      coverage: {
        status: 'complete',
        notes: [],
        officialSampleBallotUrl: ballot.coverage.officialSampleBallotUrl,
      },
    })
    renderAt('/')
    await lookUp('834 Lake St')

    const results = await screen.findByRole('article')
    expect(
      within(results)
        .getAllByRole('heading', { level: 2 })
        .map((h) => h.textContent),
    ).toEqual(['State', 'Judicial retention', 'Referenda and questions'])
    expect(screen.queryByText(/match the official lists/i)).toBeNull()
    expect(
      screen.queryByRole('link', { name: /official sample ballot/i }),
    ).toBeNull()
  })

  it('links the footer to the ballot order explainer', () => {
    renderAt('/')
    const footer = screen.getByRole('contentinfo')
    expect(
      within(footer).getByRole('link', {
        name: 'Candidates listed in official ballot order',
      }),
    ).toHaveAttribute('href', '/about#ballot-order')
    expect(
      within(footer).getByRole('link', { name: 'About VoteStack' }),
    ).toHaveAttribute('href', '/about')
  })

  it('opens and closes the retention list', async () => {
    mockApi(200, ballot)
    renderAt('/')
    await lookUp('834 Lake St')

    const summary = await screen.findByText('Judges up for retention (1)')
    const details = summary.closest('details')!
    expect(details.open).toBe(false)
    await userEvent.click(summary)
    expect(details.open).toBe(true)
    await userEvent.click(summary)
    expect(details.open).toBe(false)
  })

  it('moves focus to the ballot when it arrives', async () => {
    mockApi(200, ballot)
    renderAt('/')
    await lookUp('834 Lake St')
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Illinois General Election',
      }),
    ).toHaveFocus()
  })

  it('offers people outside Cook County an email sign-up', async () => {
    mockApi(404, { error: 'not found' })
    renderAt('/')
    // Also offered before any lookup, under the intro.
    expect(
      screen.getByRole('link', {
        name: 'Get an email when VoteStack covers your area',
      }),
    ).toHaveAttribute('href', '/notify')
    await lookUp('1 Main St', 'Madison', '53703')
    const notice = (
      await screen.findByText(/couldn’t find that address/i)
    ).closest('[role=status]') as HTMLElement
    expect(
      within(notice).getByRole('link', {
        name: 'Get an email when VoteStack covers your area',
      }),
    ).toHaveAttribute('href', '/notify')
  })

  it('moves focus back to the street field when the lookup fails', async () => {
    mockApi(404, { error: 'not found' })
    renderAt('/')
    await lookUp('1 Nowhere St')
    await screen.findByText(/couldn’t find that address/i)
    expect(screen.getByLabelText(/street address/i)).toHaveFocus()
  })

  it('submits fields filled without input events', async () => {
    // Some autofill and assistive tools set the value directly, which React's
    // onChange never sees.
    const fetch = mockApi(200, ballot)
    renderAt('/')
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!
    setValue.call(screen.getByLabelText(/street address/i), '834 Lake St')
    setValue.call(screen.getByLabelText(/city/i), 'Oak Park')
    setValue.call(screen.getByLabelText(/zip/i), '60301')
    await userEvent.click(
      screen.getByRole('button', { name: /find my ballot/i }),
    )
    await screen.findByText('Oak Park 22', { exact: false })
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      address: '834 Lake St, Oak Park, IL 60301',
    })
  })

  it('goes to /getstarted to search a new address, with one h1 and no ballot', async () => {
    mockApi(200, ballot)
    const { router } = renderAt('/')
    await lookUp('834 Lake St')
    await screen.findByRole('heading', { name: 'Illinois General Election' })
    const search = screen.getByRole('link', { name: 'Search a new address' })
    expect(search).toHaveAttribute('href', '/getstarted')
    await userEvent.click(search)

    expect(router.state.location.pathname).toBe('/getstarted')
    expect(
      screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent),
    ).toEqual(["What's on your ballot?"])
    expect(screen.queryByRole('article')).toBeNull()
    expect(screen.getByText('Each profile shows:')).toBeInTheDocument()
    expect(screen.getByText('Sources for each claim')).toBeInTheDocument()
    await vi.waitFor(() =>
      expect(screen.getByLabelText(/street address/i)).toHaveFocus(),
    )
  })

  it('checks the fields before looking up', async () => {
    const fetch = mockApi(200, ballot)
    renderAt('/')
    await userEvent.click(
      screen.getByRole('button', { name: /find my ballot/i }),
    )

    expect(fetch).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/street address/i)).toHaveFocus()
    expect(
      screen.getByLabelText(/street address/i),
    ).toHaveAccessibleDescription(/starting with the house number/i)
    expect(screen.getByText(/5-digit zip code/i)).toBeInTheDocument()
    // The error clears as soon as the voter edits.
    await userEvent.type(screen.getByLabelText(/zip/i), '6')
    expect(screen.queryByText(/5-digit zip code/i)).toBeNull()
  })

  it('keeps the address when searching a new one', async () => {
    mockApi(200, ballot)
    renderAt('/')
    await lookUp('834 Lake St')
    await screen.findByRole('heading', { name: 'Illinois General Election' })
    expect(screen.queryByLabelText(/street address/i)).toBeNull()
    expect(screen.getByText('834 Lake St, Oak Park, IL 60301')).toBeVisible()

    await userEvent.click(
      screen.getByRole('link', { name: 'Search a new address' }),
    )
    expect(screen.getByLabelText(/street address/i)).toHaveValue('834 Lake St')
    expect(screen.getByLabelText(/zip/i)).toHaveValue('60301')
  })

  it('explains when the address is not found', async () => {
    mockApi(404, { error: 'not found' })
    renderAt('/')
    await lookUp('1 Nowhere St')
    expect(await screen.findByRole('status')).toHaveTextContent(
      /couldn’t find that address/i,
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'only available in Cook County, Illinois, and Los Angeles County, California',
    )
    // Right under the button, with no links to the official sites.
    const status = screen.getByRole('status')
    expect(
      screen.getByRole('button', { name: /find my ballot/i })
        .nextElementSibling,
    ).toBe(status)
    expect(
      screen.queryByRole('link', { name: /suburban cook county voters/i }),
    ).toBeNull()
  })

  it('says when lookup is unavailable', async () => {
    mockApi(503, { error: 'not configured' })
    renderAt('/')
    await lookUp('834 Lake St')
    expect(await screen.findByRole('status')).toHaveTextContent(
      /couldn’t load your ballot/i,
    )
  })

  it('asks the visitor to wait when there were too many lookups', async () => {
    mockApi(429, { error: 'Too many lookups' })
    renderAt('/')
    await lookUp('834 Lake St')
    expect(await screen.findByRole('status')).toHaveTextContent(
      /too many lookups from your connection\. Wait a minute/i,
    )
  })

  it('sends a new visitor to /getstarted, replacing /', async () => {
    const { router } = renderAt('/')
    expect(router.state.location.pathname).toBe('/getstarted')
    // Replaced, so Back doesn't land on / and bounce again.
    expect(router.state.historyAction).toBe('REPLACE')
    expect(
      screen.getByRole('heading', { level: 1, name: /on your ballot/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/every race on your ballot/i)).toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: /registered voting address/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/we use your address once/i)).toBeInTheDocument()
    expect(
      within(screen.getByRole('group', { name: /sample ballot/i }))
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([
      'Oak Park Village Hall',
      'Wrigleyville',
      'Art Institute of Chicago',
    ])
  })

  it('opens the new ballot at / after a lookup, with the address kept out of the URL and storage', async () => {
    mockApi(200, ballot)
    const { router } = renderAt('/getstarted')
    await lookUp('834 Lake St')

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Illinois General Election',
      }),
    ).toHaveFocus()
    expect(router.state.location.pathname).toBe('/')
    expect(screen.queryByLabelText(/street address/i)).toBeNull()

    const url = router.state.location
    for (const part of [url.pathname, url.search, url.hash])
      expect(part).not.toMatch(/lake|60301|oak park/i)
    expect(JSON.stringify(url.state)).not.toMatch(/lake|60301/i)
    const stored = Array.from({ length: localStorage.length }, (_, i) =>
      localStorage.getItem(localStorage.key(i)!),
    ).join(' ')
    expect(stored).not.toMatch(/lake st|60301/i)
    expect(stored).toMatch(/Illinois General Election/)
  })

  it('keeps the ballot when going between / and /getstarted', async () => {
    mockApi(200, ballot)
    const { router } = renderAt('/')
    await lookUp('834 Lake St')
    await screen.findByRole('heading', { name: 'Illinois General Election' })
    await userEvent.click(
      screen.getByRole('link', { name: 'Search a new address' }),
    )
    expect(router.state.location.pathname).toBe('/getstarted')

    await userEvent.click(screen.getByRole('link', { name: 'My ballot' }))
    expect(router.state.location.pathname).toBe('/')
    expect(screen.getByText('834 Lake St, Oak Park, IL 60301')).toBeVisible()
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Illinois General Election',
      }),
    ).toBeInTheDocument()
  })

  it('shows a ballot saved on the device at /, without a redirect', () => {
    ballotStore.saveBallot(ballot)
    const { router } = renderAt('/')
    expect(router.state.location.pathname).toBe('/')
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Illinois General Election',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'Your saved ballot' }),
    ).toBeInTheDocument()
  })

  it('shows no ballot on /getstarted, even when one is saved', () => {
    ballotStore.saveBallot(ballot)
    renderAt('/getstarted')
    expect(
      screen.getByRole('heading', { level: 1, name: /on your ballot/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: /registered voting address/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: /sample ballot/i }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('article')).toBeNull()
    expect(screen.queryByText('Illinois General Election')).toBeNull()
    expect(screen.queryByText('Jane Doe')).toBeNull()
  })

  it('stays on /getstarted when the lookup fails', async () => {
    mockApi(404, { error: 'not found' })
    const { router } = renderAt('/getstarted')
    await lookUp('1 Nowhere St')
    await screen.findByText(/couldn’t find that address/i)
    expect(router.state.location.pathname).toBe('/getstarted')
  })

  it('shows a not-found page for unknown routes', () => {
    renderAt('/nope')
    expect(
      screen.getByRole('heading', { name: /page not found/i }),
    ).toBeInTheDocument()
  })
})
