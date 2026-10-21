import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter, type Location } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { routes } from '../routes.tsx'
import type { Ballot } from '../shared/ballot.ts'
import type { CandidateProfile } from '../shared/profile.ts'

const IL = 'ocd-division/country:us/state:il'
const base = {
  electionId: 'il-2026-11-03-general',
  authorityId: `${IL}/county:cook`,
  sources: [],
  lastVerified: '2026-10-04',
}
const ballot: Ballot = {
  election: {
    id: 'il-2026-11-03-general',
    name: 'Illinois General Election',
    date: '2026-11-03',
    divisionId: IL,
  },
  contests: [
    {
      ...base,
      kind: 'candidate',
      id: 'gov',
      districtId: IL,
      title: 'Governor and Lieutenant Governor',
      office: 'Governor and Lieutenant Governor',
      voteFor: 1,
      candidates: [
        {
          name: 'Jane Doe',
          party: 'Democratic',
          ballotOrder: 1,
          incumbent: true,
        },
        { name: 'Richard Roe', party: 'Republican', ballotOrder: 2 },
        { name: 'Sam Poe', party: 'Libertarian', ballotOrder: 3 },
      ],
    },
    {
      ...base,
      kind: 'retention',
      id: 'r',
      districtId: `${IL}/county:cook`,
      title: 'Retention: Judge, Cook County Judicial Circuit',
      office: 'Judge, Cook County Judicial Circuit',
      judge: 'John Roe',
    },
  ],
  coverage: { status: 'complete', notes: [] },
  publishedProfiles: ['jane-doe', 'richard-roe', 'john-roe'],
}

const profile: CandidateProfile = {
  key: 'jane-doe',
  electionId: 'il-2026-11-03-general',
  name: 'Jane Doe',
  party: 'Democratic',
  office: 'Governor and Lieutenant Governor',
  contestIds: ['gov'],
  kind: 'candidate',
  tier: 'top',
  overview: {
    asOf: '2026-10-05',
    items: [
      { text: 'Jane Doe has been a state senator since 2019.', cites: [1] },
      { text: 'She sponsored a transit funding bill.', cites: [1, 2] },
    ],
  },
  money: {
    asOf: '2026-10-05',
    items: [
      {
        source: 'ISBE',
        committee: 'Friends of Jane Doe',
        url: 'https://elections.il.gov/committee/1',
        period: 'July 1 to September 30, 2026',
        raised: 48210,
        breakdown: [
          { kind: 'small', amount: 12000 },
          { kind: 'large', amount: 26210 },
          { kind: 'transfer', amount: 10000 },
        ],
        largeSince: {
          since: '2026-09-30',
          total: 45000,
          count: 3,
        },
      },
    ],
  },
  endorsements: { asOf: '2026-10-05', items: [] },
  sources: [
    {
      id: 1,
      title: 'Jane Doe biography',
      publisher: 'Ballotpedia',
      url: 'https://ballotpedia.org/Jane_Doe',
      viewedAt: '2026-10-05',
      kind: 'reference',
    },
    {
      id: 2,
      title: 'Transit bill passes',
      publisher: 'Chicago Sun-Times',
      url: 'https://suntimes.com/transit',
      viewedAt: '2026-10-05',
      kind: 'news',
    },
  ],
  meta: {
    model: 'test',
    promptVersion: '1',
    generatedAt: '2026-10-06T15:00:00Z',
    version: 1,
  },
}

/** A judge up for retention with no committee of their own. */
const judge: CandidateProfile = {
  ...profile,
  key: 'john-roe',
  name: 'John Roe',
  party: undefined,
  office: 'Judge, Cook County Judicial Circuit',
  contestIds: ['r'],
  kind: 'retention',
  tier: 'short',
  money: {
    asOf: '2026-10-05',
    items: [],
    sharedCommittee: {
      name: 'Committee for Retention of Judges in Cook County',
      url: 'https://elections.il.gov/committee/6505',
    },
  },
}

/** Before launch, Richard Roe's row opens Jane Doe's profile as a sample. */
const sample: CandidateProfile = {
  ...profile,
  sample: {
    forName: 'Richard Roe',
    forOffice: 'Governor and Lieutenant Governor',
  },
}

/** Answers the Worker's API: the ballot, and Jane Doe's and John Roe's profiles. */
function mockApi() {
  const fetch = vi.fn(async (url: string) => {
    if (url === '/api/ballot') return Response.json(ballot)
    if (url === '/api/profile/jane-doe') return Response.json(profile)
    if (url === '/api/profile/john-roe') return Response.json(judge)
    if (url === '/api/profile/richard-roe') return Response.json(sample)
    return Response.json({ error: 'Not found' }, { status: 404 })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const seen: Location[] = [router.state.location]
  router.subscribe((state) => seen.push(state.location))
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, seen }
}

async function lookUp() {
  await userEvent.type(screen.getByLabelText(/street address/i), '834 Lake St')
  await userEvent.type(screen.getByLabelText(/city/i), 'Oak Park')
  await userEvent.type(screen.getByLabelText(/zip/i), '60301')
  await userEvent.click(screen.getByRole('button', { name: /find my ballot/i }))
  await screen.findByText('Illinois General Election')
}

afterEach(() => vi.unstubAllGlobals())

/** At a profile's top below 840px: the candidate's race(s) only. */
const panel = () => screen.getByRole('region', { name: 'On your ballot' })

describe('candidate profiles', () => {
  it('opens a profile from the ballot and comes back to the same row', async () => {
    mockApi()
    const { seen } = renderAt('/')
    await lookUp()

    const row = screen.getByRole('link', { name: /jane doe/i })
    await userEvent.click(row)

    const name = await screen.findByRole('heading', {
      level: 1,
      name: 'Jane Doe',
    })
    expect(name).toHaveFocus()
    // The disclosure sits in one paragraph: body prose, then two inline
    // links and an italicized update date separated by middle dots. Keeps
    // the box short on mobile.
    expect(
      screen.getByRole('link', { name: 'How we make profiles' }),
    ).toHaveAttribute('href', '/how-profiles-are-made')
    expect(
      screen.getByRole('link', { name: 'Report an error' }),
    ).toHaveAttribute('href', '/candidates/jane-doe/report')
    expect(screen.getByText('Updated Tuesday, October 6, 2026.')).toHaveClass(
      'italic',
    )

    // Sections in a fixed order, then the sources.
    const article = screen.getByRole('article', { name: 'Jane Doe' })
    expect(
      within(article)
        .getAllByRole('heading', { level: 2 })
        .map((h) => h.textContent),
    ).toEqual(['Overview', 'Campaign money', 'Endorsements', 'Sources'])

    // An empty section says so instead of disappearing.
    const endorsements = screen.getByRole('region', { name: 'Endorsements' })
    expect(endorsements).toHaveTextContent(
      'Not found in public sources as of Monday, October 5, 2026.',
    )

    // Citations point at the numbered sources.
    expect(
      within(article).getAllByRole('link', { name: 'Source 1' })[0],
    ).toHaveAttribute('href', '#source-1')
    expect(document.getElementById('source-2')).toHaveTextContent(
      'Transit bill passes, Chicago Sun-Times. Viewed Monday, October 5, 2026.',
    )
    expect(screen.getByText('$48,210')).toBeInTheDocument()
    expect(screen.getByText('21%')).toBeInTheDocument()
    expect(screen.getAllByText('Not reported')).toHaveLength(1)

    // One link back on each screen: first in the ballot list beside the
    // profile from 840px, first in the race panel at its top below that.
    const back = screen.getAllByRole('link', {
      name: 'Back to your full ballot',
    })
    expect(back).toHaveLength(2)
    expect(
      within(panel()).getByRole('link', { name: 'Back to your full ballot' }),
    ).toBe(back[0])
    expect(back[0].closest('.lg\\:hidden')).not.toBeNull()
    expect(back[1].closest('.max-lg\\:hidden')).not.toBeNull()
    await userEvent.click(back[0])
    expect(screen.queryByRole('article', { name: 'Jane Doe' })).toBeNull()
    expect(screen.getByText('Illinois General Election')).toBeVisible()
    expect(screen.getByRole('link', { name: /jane doe/i })).toHaveFocus()

    // The address never reaches the URL or the router's state.
    expect(seen.length).toBeGreaterThan(1)
    for (const location of seen)
      expect(JSON.stringify(location)).not.toMatch(/834|lake|oak park|60301/i)
  })

  it('shows the whole ballot beside the profile, and its race on phones', async () => {
    mockApi()
    renderAt('/')
    await lookUp()
    await userEvent.click(screen.getByRole('link', { name: /^Jane Doe/ }))
    await screen.findByRole('heading', { level: 1, name: 'Jane Doe' })

    // From 840px the whole list is beside the profile, in a pane of its own,
    // with the way back first.
    const list = screen.getByRole('article', {
      name: 'Illinois General Election',
    })
    const pane = list.parentElement as HTMLElement
    expect(pane).not.toHaveAttribute('hidden')
    expect(pane).toHaveClass('max-lg:hidden', 'lg:sticky')
    expect(within(pane).getAllByRole('link')[0]).toHaveTextContent(
      'Back to your full ballot',
    )
    expect(
      within(list).getByRole('link', { name: /^Jane Doe/ }),
    ).toHaveAttribute('aria-current', 'page')
    expect(within(list).getByText(/John Roe/)).toBeInTheDocument()
    // The profile follows the list.
    expect(
      pane.compareDocumentPosition(
        screen.getByRole('article', { name: 'Jane Doe' }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    // Below 840px the panel at the profile's top has just this race.
    const top = panel().parentElement as HTMLElement
    expect(top).toHaveClass('lg:hidden')
    expect(
      within(panel())
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['Governor and Lieutenant Governor'])
    expect(panel()).not.toHaveTextContent(
      /John Roe|on your ballot\.|To make a list/,
    )
    expect(
      within(panel()).queryByRole('link', { name: /saved choices|my ballot/i }),
    ).toBeNull()
    // Same rows and pick boxes as the list. The open profile's row is marked
    // for screen readers only: it looks like every other row.
    expect(within(panel()).getAllByRole('checkbox')).toHaveLength(3)
    const current = within(panel()).getByRole('link', { name: /^Jane Doe/ })
    const other = within(panel()).getByRole('link', { name: /^Richard Roe/ })
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(current.className).not.toMatch(/highlight/)
    expect(current.className).toBe(other.className)
    expect(
      within(panel()).getByRole('link', { name: /^Richard Roe/ }),
    ).toHaveAttribute('href', '/candidates/richard-roe')
    // The panel's link to the whole ballot comes first in it.
    expect(within(panel()).getAllByRole('link')[0]).toHaveTextContent(
      'Back to your full ballot',
    )
    // No id repeats the list's.
    const ids = [...document.querySelectorAll('[id]')].map((el) => el.id)
    expect(ids.length).toBe(new Set(ids).size)

    // Back from the panel puts focus on the row in the full list.
    await userEvent.click(
      within(panel()).getByRole('link', { name: 'Back to your full ballot' }),
    )
    expect(screen.queryByRole('region', { name: 'On your ballot' })).toBeNull()
    expect(screen.getByRole('link', { name: /^Jane Doe/ })).toHaveFocus()
  })

  it('shows the election above the profile on phones, with one h1', async () => {
    mockApi()
    renderAt('/')
    await lookUp()
    await userEvent.click(screen.getByRole('link', { name: /^Jane Doe/ }))
    await screen.findByRole('heading', { level: 1, name: 'Jane Doe' })

    const election = screen
      .getAllByText('Illinois General Election')
      .find((el) => el.tagName === 'P')
    const block = election!.parentElement as HTMLElement
    expect(block).toHaveTextContent('Election day')
    expect(block).toHaveTextContent('Tuesday, November 3, 2026')
    // Above the race panel; from 840px the list beside shows the election.
    expect(block.parentElement).toHaveClass('lg:hidden')
    expect(
      block.compareDocumentPosition(panel()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    // The list's title steps down to h2: the candidate's name stays the
    // page's only h1.
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Illinois General Election',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent),
    ).toEqual(['Jane Doe'])
  })

  it('keeps the ballot list off pages that aren’t profiles', async () => {
    mockApi()
    const { router } = renderAt('/')
    await lookUp()
    for (const [path, title] of [
      ['/about', 'About VoteStack'],
      ['/how-profiles-are-made', 'How we make profiles'],
      ['/saved-choices', 'Saved choices'],
    ]) {
      await router.navigate(path)
      await screen.findByRole('heading', { level: 1, name: title })
      expect(
        screen.queryByRole('article', { name: 'Illinois General Election' }),
      ).toBeNull()
      expect(
        screen.queryByRole('region', { name: 'On your ballot' }),
      ).toBeNull()
    }
  })

  it('shows just the judge’s retention item beside a judge’s profile', async () => {
    mockApi()
    renderAt('/')
    await lookUp()
    await userEvent.click(screen.getByText(/judges up for retention/i))
    await userEvent.click(screen.getByRole('link', { name: /^John Roe/ }))
    await screen.findByRole('heading', { level: 1, name: 'John Roe' })

    expect(
      within(panel()).getByRole('link', { name: /^John Roe/ }),
    ).toBeVisible()
    expect(
      within(panel()).getByRole('button', {
        name: 'Yes on keeping John Roe in office',
      }),
    ).toBeInTheDocument()
    expect(panel()).not.toHaveTextContent(/Jane Doe|Judges up for retention \(/)

    await userEvent.click(
      within(panel()).getByRole('link', { name: 'Back to your full ballot' }),
    )
    expect(screen.getByRole('link', { name: /^John Roe/ })).toHaveFocus()
  })

  it('gives every candidate the same row', async () => {
    mockApi()
    renderAt('/')
    await lookUp()

    const race = screen
      .getByRole('heading', { name: 'Governor and Lieutenant Governor' })
      .closest('div.overflow-hidden') as HTMLElement
    const items = within(race).getAllByRole('listitem')
    const rows = items.map(
      (li) => li.querySelector(':scope > div > *') as HTMLElement,
    )
    expect(rows).toHaveLength(3)

    const shape = (el: Element) =>
      [...el.querySelectorAll('*')].map((d) => d.tagName).join(',')
    expect(new Set(rows.map(shape)).size).toBe(1)
    // Every row has the same pick box beside it, outside the link.
    const boxes = items.map((li) => li.firstElementChild as HTMLElement)
    expect(boxes.map((b) => b.tagName)).toEqual(['LABEL', 'LABEL', 'LABEL'])
    expect(
      new Set(boxes.map((b) => b.outerHTML.replace(/Pick .*? for/, ''))).size,
    ).toBe(1)

    // A published profile makes the whole row a link; otherwise it says so.
    expect(rows[0].tagName).toBe('A')
    expect(rows[0]).toHaveAttribute('href', '/candidates/jane-doe')
    expect(rows[1]).toHaveAttribute('href', '/candidates/richard-roe')
    expect(rows[2].tagName).toBe('DIV')
    expect(rows[2]).toHaveTextContent('No profile yet')
    expect(rows[0].className.includes('min-h-14')).toBe(true)

    // Retention judges get the same row.
    await userEvent.click(screen.getByText(/judges up for retention/i))
    const judge = screen.getByRole('link', { name: /john roe/i })
    expect(judge).toHaveAttribute('href', '/candidates/john-roe')
    expect(shape(judge)).toBe(shape(rows[0]))
  })

  it('works from a shared link without a ballot', async () => {
    mockApi()
    renderAt('/candidates/jane-doe')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Jane Doe' }),
    ).toBeInTheDocument()
    // Search arrivals get the top strip and the mid-article pivot in place
    // of the "Find your ballot" link that only ballot visitors see.
    expect(
      screen.getByRole('link', { name: 'Explore your full ballot' }),
    ).toHaveAttribute('href', '/getstarted')
    expect(screen.queryByRole('link', { name: 'Find your ballot' })).toBeNull()
    // No ballot in memory: no election block from the home page and no
    // "Back to your full ballot" link.
    expect(screen.queryByRole('region', { name: 'On your ballot' })).toBeNull()
    expect(
      screen.queryByRole('link', { name: 'Back to your full ballot' }),
    ).toBeNull()
  })

  it('shows large contributions reported since the period', async () => {
    mockApi()
    renderAt('/candidates/jane-doe')
    const money = await screen.findByRole('region', { name: 'Campaign money' })
    expect(money).toHaveTextContent(
      'Large contributions reported since September 30, 2026: $45,000 in 3 gifts.',
    )
    expect(
      within(money).getByRole('link', {
        name: 'See the large contribution reports',
      }),
    ).toHaveAttribute('href', 'https://elections.il.gov/committee/1')
    const breakdown = within(money).getByRole('table', {
      name: 'Where the money came from',
    })
    expect(breakdown).toHaveTextContent(
      'PACs, parties and other campaign committees$10,00021%',
    )
  })

  it('names the joint committee for judges up for retention', async () => {
    mockApi()
    renderAt('/candidates/john-roe')
    const money = await screen.findByRole('region', { name: 'Campaign money' })
    expect(money).toHaveTextContent(
      'No committee of their own. Judges up for retention campaign together through the Committee for Retention of Judges in Cook County.',
    )
    expect(money).not.toHaveTextContent('Not found in public sources')
    expect(
      within(money).getByRole('link', {
        name: 'Committee for Retention of Judges in Cook County',
      }),
    ).toHaveAttribute('href', 'https://elections.il.gov/committee/6505')
  })

  it('says when a candidate has no published profile', async () => {
    const fetch = mockApi()
    renderAt('/candidates/sam-poe')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'No profile yet' }),
    ).toHaveFocus()
    expect(fetch).toHaveBeenCalledWith('/api/profile/sam-poe')
  })

  it('names each row link after its candidate, with a pause before each part', async () => {
    mockApi()
    renderAt('/')
    await lookUp()
    // jsdom trims the hidden ", " to ","; browsers keep the space.
    expect(
      screen.getByRole('link', {
        name: /^Jane Doe, ?Democratic, incumbent, ?Profile$/,
      }),
    ).toHaveAttribute('href', '/candidates/jane-doe')
    expect(
      screen.getByRole('link', {
        name: /^Richard Roe, ?Republican, ?Profile$/,
      }),
    ).toHaveAttribute('href', '/candidates/richard-roe')
    expect(screen.getByText('Sam Poe').closest('div')).toHaveTextContent(
      'Sam Poe, Libertarian, No profile yet',
    )
  })

  it('says "incumbent" after the party in the header, never for retention judges', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/profile/jane-doe')
        return Response.json({ ...profile, incumbent: true })
      if (url === '/api/profile/john-roe')
        return Response.json({ ...judge, incumbent: true })
      return Response.json({ error: 'Not found' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetch)
    renderAt('/candidates/jane-doe')
    const header = (await screen.findByRole('heading', { level: 1 })).closest(
      'header',
    ) as HTMLElement
    expect(within(header).getByText('Democratic, incumbent')).toHaveClass(
      'text-muted',
    )
    cleanup()

    renderAt('/candidates/john-roe')
    const judgeHeader = (
      await screen.findByRole('heading', { level: 1, name: 'John Roe' })
    ).closest('header') as HTMLElement
    expect(judgeHeader).not.toHaveTextContent(/incumbent/i)
  })

  it('shows no incumbent label without a confirming source', async () => {
    mockApi()
    renderAt('/candidates/jane-doe')
    const header = (await screen.findByRole('heading', { level: 1 })).closest(
      'header',
    ) as HTMLElement
    expect(header).toHaveTextContent('Democratic')
    expect(header).not.toHaveTextContent(/incumbent/i)
  })

  it('says a sample profile is another candidate’s, above the name', async () => {
    mockApi()
    renderAt('/candidates/richard-roe')
    const notice = await screen.findByRole('region', {
      name: 'Sample profile',
    })
    expect(notice).toHaveTextContent(
      'Richard Roe’s profile isn’t ready yet. To show how profiles will look, this is the profile of Jane Doe, another candidate.',
    )
    const name = screen.getByRole('heading', { level: 1, name: 'Jane Doe' })
    expect(
      notice.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.getByText('Sample profile')).toHaveFocus()
    expect(document.title).toBe('Sample profile of Jane Doe | VoteStack')
  })

  it('shows no sample notice on a candidate’s own profile', async () => {
    mockApi()
    renderAt('/candidates/jane-doe')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Jane Doe' }),
    ).toHaveFocus()
    expect(screen.queryByRole('region', { name: 'Sample profile' })).toBeNull()
    expect(screen.queryByText(/isn’t ready yet/)).toBeNull()
    expect(document.title).toBe(
      'Jane Doe, 2026 candidate for Governor and Lieutenant Governor, Illinois | VoteStack',
    )
  })
})
