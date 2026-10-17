// Picks and Saved choices: picking from the list and from profiles, the
// saved ballot on a return visit, and what is (and isn't) stored.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ORDER_KEY, orderStore } from '../ballot/orderPreference.ts'
import { ballotStore, STORAGE_KEY } from '../picks/store.ts'
import { routes } from '../routes.tsx'
import type { Ballot, Contest } from '../shared/ballot.ts'
import type { CandidateProfile } from '../shared/profile.ts'

const IL = 'ocd-division/country:us/state:il'
const base = {
  electionId: 'il-2026-11-03-general',
  authorityId: `${IL}/county:cook`,
  sources: [],
  lastVerified: '2026-10-04',
}
const contests: Contest[] = [
  {
    ...base,
    kind: 'measure',
    id: 'm',
    districtId: `${IL}/county:cook`,
    title: 'Transit question',
    question: 'Shall the county…?',
    ballotOrder: 1,
  },
  {
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
    ballotOrder: 20,
  },
  {
    ...base,
    kind: 'candidate',
    id: 'sen',
    districtId: IL,
    title: 'United States Senator',
    office: 'United States Senator',
    voteFor: 1,
    candidates: [{ name: 'Ann Lee', party: 'Green', ballotOrder: 1 }],
    ballotOrder: 10,
  },
  {
    ...base,
    kind: 'candidate',
    id: 'mwrd',
    districtId: `${IL}/sewer:mwrd`,
    title: 'Commissioner, Water Reclamation District',
    office: 'Commissioner',
    voteFor: 3,
    candidates: [
      { name: 'Bo Diaz', party: 'Democratic', ballotOrder: 1 },
      { name: 'Cy Fox', party: 'Republican', ballotOrder: 2 },
      { name: 'Di Ng', party: 'Green', ballotOrder: 3 },
      { name: 'Ed Wu', ballotOrder: 4 },
    ],
    ballotOrder: 30,
  },
  {
    ...base,
    kind: 'retention',
    id: 'r1',
    districtId: `${IL}/county:cook`,
    title: 'Retention',
    office: 'Judge, Cook County Judicial Circuit',
    judge: 'John Roe',
    ballotOrder: 40,
  },
  {
    ...base,
    kind: 'retention',
    id: 'r2',
    districtId: `${IL}/county:cook`,
    title: 'Retention',
    office: 'Judge, Cook County Judicial Circuit',
    judge: 'Mary Moe',
    ballotOrder: 41,
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
  coverage: { status: 'complete', notes: [] },
  publishedProfiles: ['jane-doe', 'john-roe'],
}

const profile = {
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
} as CandidateProfile
const judgeProfile = {
  ...profile,
  key: 'john-roe',
  name: 'John Roe',
  party: undefined,
  office: 'Judge, Cook County Judicial Circuit',
  contestIds: ['r1'],
  kind: 'retention',
  tier: 'short',
} as CandidateProfile

function mockApi(answer: Ballot = ballot) {
  const fetch = vi.fn(async (url: string) => {
    if (url === '/api/ballot') return Response.json(answer)
    if (url === '/api/profile/jane-doe') return Response.json(profile)
    if (url === '/api/profile/john-roe') return Response.json(judgeProfile)
    return Response.json({ error: 'Not found' }, { status: 404 })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
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

async function lookUp() {
  await userEvent.type(screen.getByLabelText(/street address/i), '834 Lake St')
  await userEvent.type(screen.getByLabelText(/city or town/i), 'Oak Park')
  await userEvent.type(screen.getByLabelText(/zip/i), '60301')
  await userEvent.click(screen.getByRole('button', { name: /find my ballot/i }))
  await screen.findByRole('heading', { name: 'Illinois General Election' })
}

const box = (name: string, race: string) =>
  screen.getByRole('checkbox', { name: `Pick ${name} for ${race}` })
const GOV = 'Governor and Lieutenant Governor'
/** The race card beside a profile (at its top on phones). */
const panel = () => screen.getByRole('region', { name: 'On your ballot' })
/** A pick box in that card (the hidden list has its own). */
const panelPick = (name: string) =>
  within(panel()).getByRole('checkbox', { name: `Pick ${name} for ${GOV}` })
const MWRD = 'Commissioner, Water Reclamation District'
/** The site menu's link to Saved choices, e.g. "Saved choices (2 picked)". */
const savedLink = (name: string) =>
  within(screen.getByRole('navigation', { name: 'Site' })).getByRole('link', {
    name,
  })

/** Saves a ballot and picks as an earlier visit would have. */
function seed(picks: Record<string, string[]>, saved: Ballot = ballot) {
  const { precinct: _precinct, ...rest } = saved
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 1,
      ballot: rest,
      picks: { [saved.election.id]: picks },
    }),
  )
  ballotStore.reload()
}

afterEach(() => vi.unstubAllGlobals())

describe('picks on the ballot', () => {
  it('picks with a checkbox beside each name and swaps past the vote-for limit', async () => {
    mockApi()
    renderAt('/')
    await lookUp()

    await userEvent.click(box('Jane Doe', GOV))
    expect(box('Jane Doe', GOV)).toBeChecked()
    // A second pick in a vote-for-1 race replaces the first, and screen
    // readers hear it; nothing shows and no box is described by a message.
    await userEvent.click(box('Richard Roe', GOV))
    expect(box('Richard Roe', GOV)).toBeChecked()
    expect(box('Jane Doe', GOV)).not.toBeChecked()
    const message = 'Picked Richard Roe instead of Jane Doe.'
    const status = screen
      .getAllByRole('status')
      .find((s) => s.textContent === message)
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveClass('sr-only')
    expect(box('Richard Roe', GOV)).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByText(/Uncheck|You can pick/)).toBeNull()
    // Un-picking works and clears the announcement.
    await userEvent.click(box('Richard Roe', GOV))
    expect(box('Richard Roe', GOV)).not.toBeChecked()
    expect(screen.queryByText(message)).toBeNull()
    await userEvent.click(box('Richard Roe', GOV))
    expect(box('Richard Roe', GOV)).toBeChecked()

    // Vote for up to 3: three picks fit.
    for (const name of ['Bo Diaz', 'Cy Fox', 'Di Ng'])
      await userEvent.click(box(name, MWRD))
    for (const name of ['Bo Diaz', 'Cy Fox', 'Di Ng'])
      expect(box(name, MWRD)).toBeChecked()
    // In a full race a new pick replaces the earliest one still picked,
    // not the first in ballot order. Picked now: Cy Fox, Di Ng, Bo Diaz.
    await userEvent.click(box('Bo Diaz', MWRD))
    await userEvent.click(box('Bo Diaz', MWRD))
    await userEvent.click(box('Ed Wu', MWRD))
    expect(box('Cy Fox', MWRD)).not.toBeChecked()
    for (const name of ['Bo Diaz', 'Di Ng', 'Ed Wu'])
      expect(box(name, MWRD)).toBeChecked()
    expect(
      screen.getByText('Picked Ed Wu instead of Cy Fox.'),
    ).toBeInTheDocument()

    // The menu's link to Saved choices counts races with a pick; the ballot
    // itself has no link of its own to it.
    expect(savedLink('Saved choices (2 picked)')).toHaveAttribute(
      'href',
      '/saved-choices',
    )
    expect(
      within(screen.getByRole('main')).queryByRole('link', {
        name: /saved choices|my ballot/i,
      }),
    ).toBeNull()
  })

  it('picks yes or no for judges and referenda, and undoes it', async () => {
    mockApi()
    renderAt('/')
    await lookUp()
    await userEvent.click(screen.getByText('Judges up for retention (2)'))

    const yes = screen.getByRole('button', {
      name: 'Yes on keeping John Roe in office',
    })
    const no = screen.getByRole('button', {
      name: 'No on keeping John Roe in office',
    })
    await userEvent.click(yes)
    expect(yes).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(no)
    expect(yes).toHaveAttribute('aria-pressed', 'false')
    expect(no).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(no)
    expect(no).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(
      screen.getByRole('button', { name: 'Yes on Transit question' }),
    )
    expect(savedLink('Saved choices (1 picked)')).toBeInTheDocument()
  })

  it('keeps the list and the profile in step', async () => {
    mockApi()
    renderAt('/')
    await lookUp()
    await userEvent.click(box('Jane Doe', GOV))

    await userEvent.click(screen.getByRole('link', { name: /^Jane Doe/ }))
    await screen.findByRole('heading', { level: 1, name: 'Jane Doe' })
    // No pick panel in the profile: the race card beside it (at its top on
    // phones) has the pick boxes.
    expect(
      within(screen.getByRole('article', { name: 'Jane Doe' })).queryByRole(
        'checkbox',
      ),
    ).toBeNull()
    const pick = panelPick('Jane Doe')
    expect(pick).toBeChecked()
    await userEvent.click(pick)
    expect(pick).not.toBeChecked()

    await userEvent.click(
      within(panel()).getByRole('link', { name: 'Back to your full ballot' }),
    )
    expect(box('Jane Doe', GOV)).not.toBeChecked()
    await userEvent.click(box('Richard Roe', GOV))

    // Back on the profile, a pick swaps there too.
    await userEvent.click(screen.getByRole('link', { name: /^Jane Doe/ }))
    await screen.findByRole('heading', { level: 1, name: 'Jane Doe' })
    await userEvent.click(panelPick('Jane Doe'))
    expect(panelPick('Jane Doe')).toBeChecked()
    expect(panelPick('Richard Roe')).not.toBeChecked()
    expect(
      within(panel()).getByText('Picked Jane Doe instead of Richard Roe.'),
    ).toHaveAttribute('role', 'status')
  })

  it('picks yes or no for a judge from the profile', async () => {
    mockApi()
    renderAt('/')
    await lookUp()
    await userEvent.click(screen.getByText('Judges up for retention (2)'))
    await userEvent.click(screen.getByRole('link', { name: /^John Roe/ }))
    await screen.findByRole('heading', { level: 1, name: 'John Roe' })
    await userEvent.click(
      within(panel()).getByRole('button', {
        name: 'No on keeping John Roe in office',
      }),
    )
    expect(ballotStore.getSnapshot().picks).toEqual({
      'il-2026-11-03-general': { r1: ['no'] },
    })
  })

  it('offers no pick on a profile opened without a saved ballot', async () => {
    mockApi()
    renderAt('/candidates/jane-doe')
    await screen.findByRole('heading', { level: 1, name: 'Jane Doe' })
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('region', { name: 'On your ballot' })).toBeNull()
  })

  it('never stores the address or the precinct', async () => {
    mockApi()
    renderAt('/')
    await lookUp()
    await userEvent.click(box('Jane Doe', GOV))

    const stored = localStorage.getItem(STORAGE_KEY)!
    expect(stored).toContain('jane-doe')
    expect(stored).not.toMatch(/834|lake st|oak park|60301|precinct|cook:85/i)
    for (let i = 0; i < localStorage.length; i++)
      expect(localStorage.key(i)).toBe(STORAGE_KEY)
  })
})

describe('Saved choices', () => {
  it('lists every race in ballot order with picks, counts and gaps', async () => {
    mockApi()
    renderAt('/')
    await lookUp()
    await userEvent.click(box('Jane Doe', GOV))
    await userEvent.click(box('Di Ng', MWRD))
    await userEvent.click(box('Bo Diaz', MWRD))
    await userEvent.click(
      screen.getByRole('button', { name: 'No on Transit question' }),
    )
    await userEvent.click(savedLink('Saved choices (3 picked)'))

    const heading = screen.getByRole('heading', {
      level: 1,
      name: 'Saved choices',
    })
    expect(heading).toHaveFocus()
    expect(document.title).toBe('Saved choices | VoteStack')
    // A page of its own: the ballot list isn't beside it.
    expect(
      screen.queryByRole('article', { name: 'Illinois General Election' }),
    ).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(
      screen.getByText(
        'You picked in 2 of 3 races, 0 of 2 judges up for retention and 1 of 1 referendum.',
      ),
    ).toBeInTheDocument()
    // One short note, after the list.
    const note = screen.getByText(/^Saved only on this device\./)
    expect(note).toHaveTextContent(/isn't an official ballot/)
    expect(note).toHaveTextContent(
      /against the law to show your marked ballot to anyone/,
    )

    // The ballot's sections and order, never the order of picking.
    const page = heading.closest('div.max-w-\\[65ch\\]') as HTMLElement
    expect(
      within(page)
        .getAllByRole('heading', { level: 2 })
        .map((h) => h.textContent),
    ).toEqual([
      'Federal',
      'State',
      'County and regional',
      'Judicial retention',
      'Referenda and questions',
    ])
    const race = (title: string) =>
      within(page).getByRole('heading', { level: 3, name: title })
        .parentElement as HTMLElement
    expect(race('United States Senator')).toHaveTextContent('No pick')
    expect(
      within(race('United States Senator')).queryByRole('strong'),
    ).toBeNull()
    expect(race(GOV)).toHaveTextContent(/Jane Doe,? ?Democratic/)
    // The picked names stand out: in <strong>, not the race's heading.
    expect(within(race(GOV)).getByText('Jane Doe').tagName).toBe('STRONG')
    // Bold on a lime marker highlight (pick / on-pick, AA in both themes).
    expect(within(race(GOV)).getByText('Jane Doe')).toHaveClass(
      'font-bold',
      'bg-pick',
      'text-on-pick',
    )
    expect(
      within(race('United States Senator')).getByText('No pick'),
    ).toHaveClass('text-muted')
    expect(race(GOV)).not.toHaveTextContent('Richard Roe')
    const mwrd = race(MWRD)
    expect(mwrd).toHaveTextContent('2 of 3 picked')
    expect(
      within(mwrd)
        .getAllByRole('listitem')
        .map((li) => li.firstElementChild?.textContent),
    ).toEqual(['Bo Diaz', 'Di Ng'])
    expect(within(race('Transit question')).getByText('No').tagName).toBe(
      'STRONG',
    )
    expect(within(race('Transit question')).getByText('No')).toHaveClass(
      'bg-pick',
    )
    const judges = within(page).getByRole('region', {
      name: 'Judicial retention',
    })
    expect(within(judges).getAllByText('No pick')).toHaveLength(2)

    // Nothing to print, download or share.
    expect(
      screen.queryByRole('button', { name: /print|download|share|export/i }),
    ).toBeNull()
    expect(
      screen.queryByRole('link', { name: /print|download|share|export/i }),
    ).toBeNull()
  })

  it('goes back to a race on the ballot, opening the judges list', async () => {
    mockApi()
    renderAt('/')
    await lookUp()
    await userEvent.click(savedLink('Saved choices'))
    await userEvent.click(
      screen.getByRole('link', { name: 'Show on ballot: Mary Moe' }),
    )
    const row = document.getElementById('race-r2')!
    expect(row).toHaveFocus()
    expect(row.closest('details')!.open).toBe(true)

    await userEvent.click(savedLink('Saved choices'))
    await userEvent.click(
      screen.getByRole('link', { name: `Show on ballot: ${GOV}` }),
    )
    expect(screen.getByRole('heading', { level: 3, name: GOV })).toHaveFocus()
  })

  it('clears picks only after a confirmation', async () => {
    seed({ gov: ['jane-doe'], r1: ['yes'] })
    renderAt('/saved-choices')

    await userEvent.click(
      screen.getByRole('button', { name: 'Clear my picks' }),
    )
    expect(
      screen.getByText(/Clear all your picks from this device\?/),
    ).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'Keep my picks' }))
    expect(screen.getByRole('button', { name: 'Clear my picks' })).toHaveFocus()
    expect(Object.keys(ballotStore.getSnapshot().picks)).toHaveLength(1)

    await userEvent.click(
      screen.getByRole('button', { name: 'Clear my picks' }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Yes, clear my picks' }),
    )
    expect(ballotStore.getSnapshot().picks).toEqual({})
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).picks).toEqual({})
    expect(
      await screen.findByText('Your picks were cleared from this device.'),
    ).toBeInTheDocument()
    expect(screen.getAllByText('No pick').length).toBeGreaterThan(0)
  })

  it('says when there is no saved ballot', () => {
    renderAt('/saved-choices')
    expect(screen.getByRole('heading', { name: 'Saved choices' })).toHaveFocus()
    expect(screen.getByText(/no ballot saved on this device/)).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'Find my ballot' }),
    ).toHaveAttribute('href', '/getstarted')
  })
})

describe('the old My ballot address', () => {
  it('redirects /my-ballot to /saved-choices', () => {
    seed({ gov: ['jane-doe'] })
    const router = renderAt('/my-ballot')
    expect(router.state.location.pathname).toBe('/saved-choices')
    expect(
      screen.getByRole('heading', { level: 1, name: 'Saved choices' }),
    ).toBeInTheDocument()
  })
})

describe('the saved ballot', () => {
  it('opens on a return visit without the address', async () => {
    const fetch = mockApi()
    seed({ gov: ['jane-doe'] })
    renderAt('/')

    expect(screen.queryByLabelText(/street address/i)).toBeNull()
    const saved = screen.getByRole('region', { name: 'Your saved ballot' })
    expect(saved).toHaveTextContent(/Your address isn't saved/)
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Illinois General Election',
      }),
    ).toBeInTheDocument()
    expect(box('Jane Doe', GOV)).toBeChecked()
    expect(fetch).not.toHaveBeenCalled()

    // The menu is the way to the saved choices; the notice links only to
    // the address form.
    expect(
      within(saved)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Search a new address'])
    await userEvent.click(savedLink('Saved choices (1 picked)'))
    expect(
      screen.getByRole('heading', { level: 1, name: 'Saved choices' }),
    ).toBeInTheDocument()
  })

  it('looks up a different address from the saved ballot', async () => {
    mockApi()
    seed({})
    renderAt('/')
    await userEvent.click(
      screen.getByRole('link', { name: 'Search a new address' }),
    )
    await vi.waitFor(() =>
      expect(screen.getByLabelText(/street address/i)).toHaveFocus(),
    )
    await lookUp()
    expect(screen.getByText('834 Lake St, Oak Park, IL 60301')).toBeVisible()
  })

  it('hides picks for races not on a new ballot until the voter removes them', async () => {
    const old: Contest = {
      ...base,
      kind: 'candidate',
      id: 'ward-42',
      districtId: `${IL}/place:chicago/ward:42`,
      title: 'Alderperson, 42nd Ward',
      office: 'Alderperson',
      voteFor: 1,
      candidates: [{ name: 'Old Pick' }],
    }
    mockApi()
    seed(
      { gov: ['jane-doe'], 'ward-42': ['old-pick'] },
      { ...ballot, contests: [...contests, old] },
    )
    renderAt('/')
    await userEvent.click(
      screen.getByRole('link', { name: 'Search a new address' }),
    )
    await lookUp()

    // The race still on the ballot keeps its pick; the other is hidden.
    expect(box('Jane Doe', GOV)).toBeChecked()
    expect(savedLink('Saved choices (1 picked)')).toBeInTheDocument()
    expect(
      screen.getByText(/1 pick is for a race that isn’t on this ballot/),
    ).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove that pick' }),
    )
    expect(ballotStore.getSnapshot().picks).toEqual({
      'il-2026-11-03-general': { gov: ['jane-doe'] },
    })
    expect(screen.queryByText(/isn’t on this ballot/)).toBeNull()
    // One ballot only: the new one.
    expect(
      JSON.parse(localStorage.getItem(STORAGE_KEY)!).ballot.contests,
    ).toHaveLength(contests.length)
  })

  it('works for the session when the browser can’t store anything', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')!
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError')
      },
    })
    try {
      ballotStore.reload()
      mockApi()
      renderAt('/')
      await lookUp()
      expect(
        screen.getByText(/can’t save your picks on this device/),
      ).toBeInTheDocument()
      await userEvent.click(box('Jane Doe', GOV))
      expect(box('Jane Doe', GOV)).toBeChecked()
    } finally {
      Object.defineProperty(window, 'localStorage', original)
    }
  })
})

describe('paper ballot order', () => {
  // On paper the Water Reclamation race comes before the governor here, unlike
  // the order by level; referenda come before the judges, as on the Clerk's cards.
  const PAPER: Record<string, number> = {
    sen: 1,
    mwrd: 2,
    gov: 3,
    m: 4,
    r1: 5,
    r2: 6,
  }
  const onPaper = (authorityId = base.authorityId): Ballot => ({
    ...ballot,
    contests: contests.map((c) => ({
      ...c,
      authorityId,
      paperOrder: PAPER[c.id],
    })),
  })
  const LEVELS = [
    'Federal',
    'State',
    'County and regional',
    'Judicial retention',
    'Referenda and questions',
  ]
  const PARTS = ['Races', 'Referenda and questions', 'Judicial retention']
  const radio = (name: string, scope: HTMLElement = savedPage()) =>
    within(scope).getByRole('radio', { name })
  const h2s = (scope: HTMLElement) =>
    within(scope)
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent)
  const savedPage = () =>
    screen
      .getByRole('heading', { level: 1, name: 'Saved choices' })
      .closest('div.max-w-\\[65ch\\]') as HTMLElement

  it('switches Saved choices to paper order and remembers it on the device', async () => {
    seed({ gov: ['jane-doe'] }, onPaper())
    renderAt('/saved-choices')

    const group = within(savedPage()).getByRole('group', {
      name: 'Order of races',
    })
    expect(within(group).getAllByRole('radio')).toHaveLength(2)
    expect(radio('By level of government')).toBeChecked()
    expect(h2s(savedPage())).toEqual(LEVELS)

    await userEvent.click(radio('Paper ballot order'))
    expect(radio('Paper ballot order')).toBeChecked()
    expect(h2s(savedPage())).toEqual(PARTS)
    expect(
      within(savedPage())
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['United States Senator', MWRD, GOV, 'Transit question'])
    expect(
      within(savedPage()).getByText(
        "This follows the Cook County Clerk's sample ballot for your ballot style.",
      ),
    ).toBeVisible()
    // Picks stay with their race.
    expect(
      within(savedPage()).getByRole('heading', { level: 3, name: GOV })
        .parentElement,
    ).toHaveTextContent('Jane Doe')
    expect(localStorage.getItem(ORDER_KEY)).toBe('paper')

    // A later visit opens in paper order.
    cleanup()
    orderStore.reload()
    renderAt('/saved-choices')
    expect(radio('Paper ballot order')).toBeChecked()
    expect(h2s(savedPage())).toEqual(PARTS)

    // Arrow keys move between the two options, as in any radio group.
    radio('Paper ballot order').focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(radio('By level of government')).toBeChecked()
    expect(h2s(savedPage())).toEqual(LEVELS)
    expect(localStorage.getItem(ORDER_KEY)).toBe('level')
  })

  it('uses the same choice on the ballot', async () => {
    seed({}, onPaper())
    orderStore.set('paper')
    renderAt('/')
    const list = screen.getByRole('article', {
      name: 'Illinois General Election',
    })
    expect(radio('Paper ballot order', list)).toBeChecked()
    expect(h2s(list)).toEqual(PARTS)
    expect(
      within(screen.getByRole('navigation', { name: 'Ballot sections' }))
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(PARTS)
    await userEvent.click(radio('By level of government', list))
    expect(h2s(list)).toEqual(LEVELS)
  })

  it('says a Chicago order has not been checked against a printed ballot', async () => {
    seed({}, onPaper(`${IL}/place:chicago`))
    renderAt('/saved-choices')
    await userEvent.click(radio('Paper ballot order'))
    expect(
      within(savedPage()).getByText(
        /official list and the order of offices in Illinois law\. It hasn't been checked against a printed Chicago ballot yet\./,
      ),
    ).toBeVisible()
  })

  it('leaves out the Illinois ballot-photo law on a California ballot', () => {
    seed(
      {},
      {
        ...ballot,
        election: { ...ballot.election, id: 'ca-2026-11-03-general' },
      },
    )
    renderAt('/saved-choices')
    const note = screen.getByText(/^Saved only on this device\./)
    expect(note).toHaveTextContent(
      "Saved only on this device. This isn't an official ballot.",
    )
    expect(note).not.toHaveTextContent(/Illinois/)
  })

  it('says a Los Angeles County order comes from the Registrar', async () => {
    seed({}, onPaper('ocd-division/country:us/state:ca/county:los_angeles'))
    renderAt('/saved-choices')
    await userEvent.click(radio('Paper ballot order'))
    expect(
      within(savedPage()).getByText(
        "This follows the Los Angeles County Registrar's sample ballot for your ballot style. Los Angeles County's ballot lists city and local races first and state races last, an order California law allows only in this county.",
      ),
    ).toBeVisible()
  })

  it('offers no switch when the paper order is not known', () => {
    seed({})
    orderStore.set('paper')
    renderAt('/saved-choices')
    expect(screen.queryByRole('radio')).toBeNull()
    expect(h2s(savedPage())).toEqual(LEVELS)
  })
})

describe('measures from more than one level', () => {
  const CA = 'ocd-division/country:us/state:ca'
  const measure = (
    id: string,
    title: string,
    districtId: string,
    ballotOrder: number,
  ): Contest => ({
    ...base,
    electionId: 'ca-2026-11-03-general',
    kind: 'measure',
    id,
    districtId,
    title,
    question: '?',
    ballotOrder,
  })
  const california: Ballot = {
    ...ballot,
    election: {
      ...ballot.election,
      id: 'ca-2026-11-03-general',
      name: 'California General Election',
    },
    contests: [
      ...contests.filter((c) => c.kind === 'candidate'),
      measure(
        'te',
        'Los Angeles City General Municipal Election - Measure TE',
        `${CA}/place:los_angeles`,
        325,
      ),
      measure('p2', 'Proposition 2: Rainy Day Fund', CA, 377),
      measure('p1', 'Proposition 1: Housing Bonds', CA, 376),
    ],
  }
  const headings = (container: HTMLElement, level: number) =>
    within(container)
      .queryAllByRole('heading', { level })
      .map((h) => h.textContent)

  it('puts each level under its own heading on the ballot', () => {
    seed({}, california)
    orderStore.set('level')
    renderAt('/')
    const section = screen.getByRole('region', {
      name: 'Propositions and measures',
    })
    expect(headings(section, 3)).toEqual([
      'State propositions',
      'City and local measures',
    ])
    expect(headings(section, 4)).toEqual([
      'Proposition 1: Housing Bonds',
      'Proposition 2: Rainy Day Fund',
      'Los Angeles City General Municipal Election - Measure TE',
    ])
    // Races elsewhere keep h3 titles.
    expect(
      screen.getByRole('heading', { level: 3, name: GOV }),
    ).toBeInTheDocument()
  })

  it('shows the same headings on Saved choices', () => {
    seed({}, california)
    orderStore.set('level')
    renderAt('/saved-choices')
    const section = screen.getByRole('region', {
      name: 'Propositions and measures',
    })
    expect(headings(section, 3)).toEqual([
      'State propositions',
      'City and local measures',
    ])
    expect(headings(section, 4)).toEqual([
      'Proposition 1: Housing Bonds',
      'Proposition 2: Rainy Day Fund',
      'Los Angeles City General Municipal Election - Measure TE',
    ])
  })
})
