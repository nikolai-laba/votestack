// The result block in a profile's header, after the election.
import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RaceData } from '../../races/data.ts'
import type { CandidateProfile } from '../../shared/profile.ts'
import type { Race } from '../../shared/races.ts'
import type { RaceResult, ResultSource } from '../../shared/raceResults.ts'
import { resultsData, renderWithResults } from '../../test/results.tsx'
import { ProfileArticle } from './ProfileArticle.tsx'

// The site-wide switch is on, as in production: the results switch is the
// election's own file, so it must not matter here.
vi.mock('../../shared/afterElection.ts', async (original) => ({
  ...(await original<typeof import('../../shared/afterElection.ts')>()),
  AFTER_ELECTION: true,
}))

const IL_ELECTION = 'il-2026-11-03-general'
const LATER_ELECTION = 'il-2027-02-23-municipal'
const WRITTEN =
  "This profile was written for the Tuesday, November 3, 2026 election. It isn't updated after the election, except for the result."

const BOARD: ResultSource = {
  name: 'Chicago Board of Election Commissioners',
  url: 'https://chicagoelections.gov/elections/results',
  retrievedAt: '2026-11-04T09:00:00.000Z',
  official: true,
  asOf: '2026-11-04T08:12:00.000Z',
}
const CHECKED_AT = '2026-11-06T01:30:00.000Z'

const race = (over: Partial<Race> = {}): Race => ({
  path: 'il/cook-county/2026-11-03/treasurer',
  kind: 'candidate',
  level: 'county',
  title: 'Treasurer',
  office: 'Treasurer',
  districtId: 'ocd-division/country:us/state:il/county:cook',
  contestIds: ['chicago-boe:t1'],
  ballots: ['chicago'],
  voteFor: 1,
  candidates: [
    { name: 'Sam Moore', ballotOrder: 1 },
    { name: 'Alex Rivera', ballotOrder: 2 },
  ],
  ...over,
})
const raceData = (races: Race[], electionId = IL_ELECTION): RaceData => ({
  lists: [
    {
      electionId,
      electionName: 'General',
      date: '2026-11-03',
      area: 'Cook County, Illinois',
      areaPath: 'il/cook-county/2026-11-03',
      races,
    },
  ],
  published: {},
})

const profileOf = (
  name: string,
  over: Partial<CandidateProfile> = {},
): CandidateProfile => ({
  key: name.toLowerCase().replace(' ', '-'),
  electionId: IL_ELECTION,
  name,
  office: 'Treasurer, Cook County',
  contestIds: ['chicago-boe:t1'],
  kind: 'candidate',
  tier: 'top',
  overview: {
    asOf: '2026-10-05',
    items: [{ text: 'Overview text.', cites: [] }],
  },
  money: { asOf: '2026-10-05', items: [] },
  endorsements: { asOf: '2026-10-05', items: [] },
  sources: [],
  meta: {
    model: 'test',
    promptVersion: '1',
    generatedAt: '2026-10-06T15:00:00Z',
    version: 1,
  },
  ...over,
})

const base: RaceResult = {
  contestIds: ['chicago-boe:t1'],
  kind: 'candidate',
  status: 'called',
  voteFor: 1,
  choices: [
    { name: 'Alex Rivera', votes: 660 },
    { name: 'Sam Moore', votes: 312 },
    { name: 'Jordan Lee', votes: 28 },
  ],
  winners: ['Alex Rivera'],
  call: {
    by: 'AP',
    at: '2026-11-04T03:41:00.000Z',
    url: 'https://apnews.com/projects/elections-2026/cook-treasurer/',
  },
  certifyBy: '2026-11-24',
  scope: 'within',
  sources: [BOARD],
  changedAt: '2026-11-04T09:00:00.000Z',
}
const retention: RaceResult = {
  contestIds: ['j1'],
  kind: 'retention',
  status: 'called',
  threshold: 0.6,
  choices: [
    { name: 'Yes', votes: 714 },
    { name: 'No', votes: 286 },
  ],
  winners: ['Yes'],
  certifyBy: '2026-11-24',
  scope: 'within',
  sources: [BOARD],
  changedAt: '2026-11-04T09:00:00.000Z',
}

function show(
  profile: CandidateProfile,
  result: RaceResult | undefined,
  races: Race[] = [race()],
) {
  return renderWithResults(
    <ProfileArticle profile={profile} headingId="h" />,
    resultsData({ [profile.electionId]: result ? [result] : [] }, CHECKED_AT),
    raceData(races, profile.electionId),
  )
}
const block = () => document.querySelector('[data-result-block]') as HTMLElement

describe('the profile result block', () => {
  it('fills the block for a winner', () => {
    show(profileOf('Alex Rivera'), base)
    expect(block()).toHaveAttribute('data-fill', 'win')
    expect(block()).toHaveTextContent('Won, with 66.0% of the vote')
    expect(block()).toHaveTextContent(/AP called this race on/)
    expect(block()).toHaveTextContent(/Certified by Tuesday, November 24, 2026/)
  })

  it('says Elected once certified', () => {
    show(profileOf('Alex Rivera'), {
      ...base,
      status: 'certified',
      certified: { on: '2026-11-24', url: 'https://example.org/c' },
    })
    expect(block()).toHaveAttribute('data-fill', 'win')
    expect(block()).toHaveTextContent('Elected, with 66.0% of the vote')
  })

  it('outlines the block for everyone else, naming the winner', () => {
    show(profileOf('Sam Moore'), base)
    expect(block()).not.toHaveAttribute('data-fill')
    expect(block()).toHaveClass('border-line', 'bg-surface')
    expect(block()).toHaveTextContent('Not elected, with 31.2% of the vote')
    expect(block()).toHaveTextContent(
      'Alex Rivera won (AP call, Tuesday, November 3, 2026).',
    )
  })

  it("names the winner on everyone else's profile once certified", () => {
    const certified: RaceResult = {
      ...base,
      status: 'certified',
      certified: { on: '2026-11-24', url: 'https://example.org/c' },
    }
    const { unmount } = show(profileOf('Sam Moore'), certified)
    expect(block()).toHaveTextContent(
      'Alex Rivera was elected (certified Tuesday, November 24, 2026).',
    )
    unmount()
    show(profileOf('Jordan Lee'), {
      ...certified,
      voteFor: 2,
      winners: ['Alex Rivera', 'Sam Moore'],
    })
    expect(block()).toHaveTextContent(
      'Alex Rivera and Sam Moore were elected (certified Tuesday, November 24, 2026).',
    )
  })

  it('never writes a won line without a name', () => {
    show(profileOf('Sam Moore'), { ...base, winners: [] })
    expect(block()).not.toHaveTextContent(/\bwon\b/)
    expect(block()).toHaveTextContent(/AP called this race on/)
  })

  it('shows a leader and a trailing candidate while counting', () => {
    const counting: RaceResult = {
      ...base,
      status: 'counting',
      winners: undefined,
      call: undefined,
      choices: [
        { name: 'Alex Rivera', votes: 514 },
        { name: 'Sam Moore', votes: 486 },
      ],
    }
    const { unmount } = show(profileOf('Alex Rivera'), counting)
    expect(block()).toHaveTextContent(
      'Leading, with 51.4% of the unofficial count',
    )
    expect(block()).not.toHaveAttribute('data-fill')
    unmount()
    show(profileOf('Sam Moore'), counting)
    expect(block()).toHaveTextContent('48.6% of the unofficial count so far')
  })

  it('says Tied, not Leading, for a candidate tied at the last seat', () => {
    const tied: RaceResult = {
      ...base,
      status: 'counting',
      voteFor: 1,
      winners: undefined,
      call: undefined,
      choices: [
        { name: 'Alex Rivera', votes: 450 },
        { name: 'Sam Moore', votes: 450 },
        { name: 'Jordan Lee', votes: 100 },
      ],
    }
    show(profileOf('Sam Moore'), tied)
    expect(block()).toHaveTextContent(
      'Tied, with 45.0% of the unofficial count',
    )
    expect(block()).not.toHaveTextContent(/Leading/)
    expect(block()).not.toHaveAttribute('data-fill')
  })

  it('says a race is not called when it has no count', () => {
    show(profileOf('Alex Rivera'), {
      ...base,
      status: 'no_count',
      choices: [],
      winners: undefined,
      call: undefined,
    })
    expect(block()).toHaveTextContent('Not called yet')
  })

  it('shows a judge by the Yes share and the share needed', () => {
    const judge = profileOf('Pat Quinn', {
      kind: 'retention',
      contestIds: ['j1'],
    })
    const jr = race({
      kind: 'retention',
      contestIds: ['j1'],
      judge: 'Pat Quinn',
      candidates: undefined,
    })
    const { unmount } = show(judge, retention, [jr])
    expect(block()).toHaveAttribute('data-fill', 'win')
    expect(block()).toHaveTextContent('Retained, with 71.4% yes')
    unmount()
    show(
      judge,
      {
        ...retention,
        choices: [
          { name: 'Yes', votes: 550 },
          { name: 'No', votes: 450 },
        ],
        winners: ['No'],
      },
      [jr],
    )
    expect(block()).toHaveTextContent(
      'Not retained, with 55.0% yes (60% needed)',
    )
  })

  it('says a California justice needed a majority', () => {
    show(
      profileOf('Pat Quinn', { kind: 'retention', contestIds: ['j1'] }),
      {
        ...retention,
        threshold: 0.5,
        choices: [
          { name: 'Yes', votes: 480 },
          { name: 'No', votes: 520 },
        ],
        winners: ['No'],
      },
      [race({ kind: 'retention', contestIds: ['j1'], candidates: undefined })],
    )
    expect(block()).toHaveTextContent(
      'Not retained, with 48.0% yes (majority needed)',
    )
  })

  it('links to the race and says what the profile still is', () => {
    show(profileOf('Alex Rivera'), base)
    expect(
      within(block()).getByRole('link', { name: 'See the race' }),
    ).toHaveAttribute('href', '/races/il/cook-county/2026-11-03/treasurer')
    expect(block()).toHaveTextContent(WRITTEN)
  })

  it('has one block per race, in the race list order', () => {
    const second = race({
      path: 'il/cook-county/2026-11-03/other',
      title: 'Other',
      contestIds: ['chicago-boe:t2'],
    })
    renderWithResults(
      <ProfileArticle
        profile={profileOf('Alex Rivera', {
          contestIds: ['chicago-boe:t1', 'chicago-boe:t2'],
        })}
        headingId="h"
      />,
      resultsData(
        { [IL_ELECTION]: [base, { ...base, contestIds: ['chicago-boe:t2'] }] },
        CHECKED_AT,
      ),
      raceData([race(), second]),
    )
    const links = screen.getAllByRole('link', { name: 'See the race' })
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/races/il/cook-county/2026-11-03/treasurer',
      '/races/il/cook-county/2026-11-03/other',
    ])
  })

  it('keeps the disclosure right after the header, with the sections as they were', () => {
    const { container } = show(profileOf('Alex Rivera'), base)
    const header = container.querySelector('header') as HTMLElement
    expect(header).toContainElement(block())
    expect(header.nextElementSibling).toHaveTextContent('How we make profiles')
    expect(screen.getByText('Overview text.')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Overview' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Campaign money' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Endorsements' }),
    ).toBeInTheDocument()
  })

  it('reserves the block while the results load', () => {
    renderWithResults(
      <ProfileArticle profile={profileOf('Alex Rivera')} headingId="h" />,
      undefined,
      raceData([race()]),
    )
    expect(block()).toHaveAttribute('data-results-placeholder')
    expect(block()).toHaveTextContent('')
  })

  it('shows no block, and keeps Also running, for an election without results', () => {
    renderWithResults(
      <ProfileArticle
        profile={profileOf('Alex Rivera', { electionId: LATER_ELECTION })}
        headingId="h"
        opponents={[{ name: 'Sam Moore', key: 'sam-moore', published: false }]}
      />,
      resultsData({}, CHECKED_AT),
      raceData([race()], LATER_ELECTION),
    )
    expect(block()).toBeNull()
    expect(screen.getByText(/Also running:/)).toBeInTheDocument()
  })

  it('says Also in this race when a result shows', () => {
    renderWithResults(
      <ProfileArticle
        profile={profileOf('Alex Rivera')}
        headingId="h"
        opponents={[{ name: 'Sam Moore', key: 'sam-moore', published: false }]}
      />,
      resultsData({ [IL_ELECTION]: [base] }, CHECKED_AT),
      raceData([race()]),
    )
    expect(screen.getByText(/Also in this race:/)).toBeInTheDocument()
    expect(screen.queryByText(/Also running:/)).toBeNull()
  })

  it('drops the voting-ended line when a result shows', () => {
    show(profileOf('Alex Rivera'), base)
    expect(screen.queryByText(/Voting ended/)).toBeNull()
  })

  it('keeps the voting-ended line for a race with no result entry', () => {
    show(profileOf('Alex Rivera'), undefined)
    expect(block()).toBeNull()
    expect(screen.getByText(/Voting ended/)).toBeInTheDocument()
  })
})
