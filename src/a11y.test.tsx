// Page-wide accessibility behaviour: the skip link, page titles and
// where focus lands when a page opens on its own.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RaceCard } from './components/BallotView.tsx'
import { routes } from './routes.tsx'
import { NOTICE_WORDS_PATH } from './shared/afterElection.ts'
import type { CandidateContest, RetentionContest } from './shared/ballot.ts'
import { CHICAGO, COOK_COUNTY } from './shared/ocd.ts'
import type { RaceResult, ResultSource } from './shared/raceResults.ts'
import { renderWithResults, resultsData } from './test/results.tsx'

// Switches the site to its after-election mode for the tests that say so.
const mode = vi.hoisted(() => ({ on: false }))
vi.mock('./shared/afterElection.ts', async (original) => ({
  ...(await original<typeof import('./shared/afterElection.ts')>()),
  get AFTER_ELECTION() {
    return mode.on
  },
}))

function renderAt(path: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider
        router={createMemoryRouter(routes, { initialEntries: [path] })}
      />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  mode.on = false
  vi.unstubAllGlobals()
})

describe('page accessibility', () => {
  it('starts with a skip link to the main content', async () => {
    renderAt('/')
    await userEvent.tab()
    const skip = screen.getByRole('link', { name: 'Skip to main content' })
    expect(skip).toHaveFocus()
    expect(skip).toHaveAttribute('href', '#main')
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main')
  })

  it('starts the methods page at its title', () => {
    renderAt('/how-profiles-are-made')
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
  })

  it('starts the sign-up page at its title', async () => {
    renderAt('/notify')
    expect(await screen.findByRole('heading', { level: 1 })).toHaveFocus()
  })

  it('names the not-found page in the title', () => {
    renderAt('/nope')
    expect(document.title).toBe('Page not found | VoteStack')
  })

  it('keeps the page’s own start with the thank-you notice open', async () => {
    mode.on = true
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === NOTICE_WORDS_PATH
          ? Response.json({
              version: 1,
              heading: 'Thank you for using VoteStack',
              intro: 'Voting has ended.',
              signup: { heading: 'Hear from us', body: 'Sign up below.' },
              support: {
                heading: 'Help fund voter education',
                body: 'VoteStack is free to use.',
                payLabel: 'Pay what you want',
                payUrl: 'https://buy.stripe.com/test_notice',
                fine: 'Payments aren’t tax-deductible.',
                linkLabel: 'How payments are used',
              },
              line: {
                text: 'Voting has ended.',
                open: 'Sign up or support',
                openSignedUp: 'Support VoteStack',
              },
            })
          : new Response(null, { status: 404 }),
      ),
    )
    renderAt('/how-profiles-are-made')
    // A named landmark between the header and the page, whose heading sits
    // under the page's one h1 and can take focus.
    const notice = await screen.findByRole('complementary', {
      name: 'Thank you notice',
    })
    const heading = screen.getByRole('heading', {
      level: 2,
      name: 'Thank you for using VoteStack',
    })
    expect(notice).toContainElement(heading)
    expect(heading).toHaveAttribute('tabindex', '-1')
    expect(
      screen.getByRole('banner').compareDocumentPosition(notice) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.getByRole('main')).not.toContainElement(notice)
    // Arriving doesn't pull focus into the notice: the page starts at its
    // title, and the skip link still goes past the notice to the page.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
    expect(
      screen.getByRole('link', { name: 'Skip to main content' }),
    ).toHaveAttribute('href', '#main')
    expect(
      screen.getByRole('button', { name: 'Close the thank-you notice' }),
    ).toBeVisible()
  })
})

// No automated checker (axe) is installed, so these check by hand what one
// would flag on a race card with results.
describe('race cards with results', () => {
  const election = 'il-2026-11-03-general'
  const source: ResultSource = {
    name: 'Chicago Board of Election Commissioners',
    url: 'https://chicagoelections.gov/elections/results',
    retrievedAt: '2026-11-04T09:00:00.000Z',
    official: true,
    asOf: '2026-11-04T08:12:00.000Z',
  }
  const race: CandidateContest = {
    kind: 'candidate',
    id: 'chicago-boe:a11y-race',
    electionId: election,
    authorityId: CHICAGO,
    districtId: COOK_COUNTY,
    title: 'Board of Review',
    office: 'Board of Review',
    voteFor: 1,
    sources: [],
    lastVerified: '2026-10-04',
    candidates: [
      { name: 'Kim Park', party: 'Democratic', ballotOrder: 1 },
      { name: 'Lee Ortiz', party: 'Republican', ballotOrder: 2 },
    ],
  }
  const judge: RetentionContest = {
    kind: 'retention',
    id: 'chicago-boe:retention:a11y-judge',
    electionId: election,
    authorityId: CHICAGO,
    districtId: COOK_COUNTY,
    title: 'Retention',
    office: 'Judge, Circuit Court',
    judge: 'Pat Quinn',
    sources: [],
    lastVerified: '2026-10-04',
  }
  const counting: RaceResult = {
    contestIds: [race.id],
    kind: 'candidate',
    status: 'counting',
    voteFor: 1,
    choices: [
      { name: 'Kim Park', votes: 5140 },
      { name: 'Lee Ortiz', votes: 4860 },
    ],
    certifyBy: '2026-11-24',
    scope: 'within',
    sources: [source],
    changedAt: '2026-11-04T09:00:00.000Z',
  }
  const called: RaceResult = {
    ...counting,
    status: 'called',
    winners: ['Kim Park'],
    call: {
      by: 'AP',
      at: '2026-11-04T03:41:00.000Z',
      url: 'https://apnews.com/a11y',
    },
  }
  const retained: RaceResult = {
    contestIds: [judge.id],
    kind: 'retention',
    status: 'certified',
    threshold: 0.6,
    choices: [
      { name: 'Yes', votes: 7140 },
      { name: 'No', votes: 2860 },
    ],
    winners: ['Yes'],
    certified: { on: '2026-11-24', url: 'https://chicagoelections.gov/c' },
    certifyBy: '2026-11-24',
    scope: 'within',
    sources: [source],
    changedAt: '2026-11-24T20:00:00.000Z',
  }

  /** What an automated accessibility checker would flag in a card. */
  function problems(root: HTMLElement): string[] {
    const found: string[] = []
    const ids = [...root.querySelectorAll('[id]')].map((el) => el.id)
    ids
      .filter((id, i) => ids.indexOf(id) !== i)
      .forEach((id) => found.push(`id "${id}" is used twice`))
    if (!root.querySelector('h1, h2, h3, h4')) found.push('no heading')
    for (const link of root.querySelectorAll('a')) {
      if (!link.getAttribute('href')) found.push('a link has no address')
      if (!link.textContent?.trim()) found.push('a link has no name')
      if (link.querySelector('a, button, input'))
        found.push('a control sits inside a link')
    }
    for (const svg of root.querySelectorAll('svg'))
      if (svg.getAttribute('aria-hidden') !== 'true')
        found.push('an icon is not hidden from screen readers')
    for (const hidden of root.querySelectorAll('[aria-hidden="true"]'))
      if (hidden.querySelector('a, button, input, [tabindex="0"]'))
        found.push('a hidden part can take focus')
    for (const list of root.querySelectorAll('ul, ol'))
      for (const child of list.children)
        if (child.tagName !== 'LI') found.push('a list holds a non-item')
    for (const item of root.querySelectorAll('li'))
      if (!item.parentElement?.matches('ul, ol'))
        found.push('a list item is outside a list')
    // Never colour alone: a filled row says what the fill means.
    for (const row of root.querySelectorAll('[data-fill]'))
      if (
        !/Won|Elected|Leading|Tied|Unopposed|Retained|Not retained|Passed|Failed/.test(
          row.textContent ?? '',
        )
      )
        found.push('a filled row has no label')
    return found
  }

  it.each([
    ['a called race', race, called],
    ['a race still being counted', race, counting],
    ['a judge up for retention', judge, retained],
  ] as const)('has no problems on %s', (_, contest, result) => {
    const { container } = renderWithResults(
      <RaceCard contest={contest} published={new Set(['kim-park'])} />,
      resultsData({ [election]: [result] }, '2026-11-06T01:30:00.000Z'),
    )
    expect(container.querySelector('[data-fill]')).not.toBeNull()
    expect(problems(container)).toEqual([])
    for (const link of screen.getAllByRole('link'))
      expect(link).toHaveAccessibleName()
  })
})
