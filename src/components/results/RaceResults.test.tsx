// Results on race cards: the ballot, the race page's card and the race
// panel beside a profile, for elections with a results file.
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ballotStore } from '../../picks/store.ts'
import type {
  Ballot,
  CandidateContest,
  Contest,
  MeasureContest,
  RetentionContest,
} from '../../shared/ballot.ts'
import { CHICAGO, COOK_COUNTY, LOS_ANGELES_COUNTY } from '../../shared/ocd.ts'
import { profileKey } from '../../shared/profile.ts'
import type { RaceResult, ResultSource } from '../../shared/raceResults.ts'
import {
  resultsData as makeResultsData,
  renderWithResults,
} from '../../test/results.tsx'
import { BallotView, PersonRaces, RaceCard } from '../BallotView.tsx'

// The site-wide after-election switch, on as in production unless a test
// turns it off (Review Focus 2).
const mode = vi.hoisted(() => ({ on: true }))
vi.mock('../../shared/afterElection.ts', async (original) => ({
  ...(await original<typeof import('../../shared/afterElection.ts')>()),
  get AFTER_ELECTION() {
    return mode.on
  },
}))

afterEach(() => {
  mode.on = true
})

const IL_ELECTION = 'il-2026-11-03-general'
const CA_ELECTION = 'ca-2026-11-03-general'
const IL = 'ocd-division/country:us/state:il'

const CHICAGO_BOARD: ResultSource = {
  name: 'Chicago Board of Election Commissioners',
  url: 'https://chicagoelections.gov/elections/results',
  retrievedAt: '2026-11-04T09:00:00.000Z',
  official: true,
  // 2:12 a.m. CT
  asOf: '2026-11-04T08:12:00.000Z',
}
const COOK_CLERK: ResultSource = {
  name: 'Cook County Clerk',
  url: 'https://www.cookcountyclerkil.gov/elections/results-and-election-data/election-results',
  retrievedAt: '2026-11-04T09:00:00.000Z',
  official: true,
  asOf: '2026-11-04T07:30:00.000Z',
}
const LA_REGISTRAR: ResultSource = {
  name: 'Los Angeles County Registrar-Recorder/County Clerk',
  url: 'https://results.lavote.gov/',
  retrievedAt: '2026-11-06T01:00:00.000Z',
  official: true,
  // 4 p.m. PT on Thursday
  asOf: '2026-11-06T00:00:00.000Z',
}
const AP_COUNT: ResultSource = {
  name: 'AP',
  url: 'https://apnews.com/projects/elections-2026/illinois-attorney-general-results/',
  retrievedAt: '2026-11-04T09:30:00.000Z',
  official: false,
  // 3:21 a.m. CT
  asOf: '2026-11-04T09:21:00.000Z',
  counted: 0.81,
}
/** 7:30 p.m. CT on Thursday, November 5. */
const CHECKED_AT = '2026-11-06T01:30:00.000Z'

const contestBase = {
  electionId: IL_ELECTION,
  authorityId: CHICAGO,
  districtId: COOK_COUNTY,
  sources: [],
  lastVerified: '2026-10-04',
}

const treasurer: CandidateContest = {
  ...contestBase,
  kind: 'candidate',
  id: 'chicago-boe:treasurer-sample',
  title: 'Treasurer',
  office: 'Treasurer',
  voteFor: 1,
  ballotOrder: 1,
  candidates: [
    { name: 'Sam Moore', party: 'Republican', ballotOrder: 1 },
    {
      name: 'Alex Rivera',
      party: 'Democratic',
      incumbent: true,
      ballotOrder: 2,
    },
    { name: 'Jordan Lee', party: 'Libertarian', ballotOrder: 3 },
  ],
}

const schoolBoard: CandidateContest = {
  ...contestBase,
  electionId: CA_ELECTION,
  authorityId: LOS_ANGELES_COUNTY,
  districtId: LOS_ANGELES_COUNTY,
  kind: 'candidate',
  id: 'la-board-of-education-sample',
  title: 'Board of Education',
  office: 'Board of Education',
  voteFor: 3,
  candidates: [
    { name: 'Maya Chen', designation: 'Parent/Educator', ballotOrder: 1 },
    { name: 'Tom Baker', designation: 'Retired Principal', ballotOrder: 2 },
    { name: 'Rosa Diaz', designation: 'Nurse', ballotOrder: 3 },
    { name: 'Eli Grant', designation: 'Board Member', ballotOrder: 4 },
    { name: 'Ann Wu', designation: 'Attorney', ballotOrder: 5 },
  ],
}

const stateRep: CandidateContest = {
  ...contestBase,
  kind: 'candidate',
  id: 'chicago-boe:state-rep-99-sample',
  title: 'State Representative, 99th District',
  office: 'State Representative',
  voteFor: 1,
  candidates: [
    { name: 'Dana Fox', party: 'Democratic', ballotOrder: 1 },
    { name: 'Chris Hall', party: 'Republican', ballotOrder: 2 },
  ],
}

const judge: RetentionContest = {
  ...contestBase,
  kind: 'retention',
  id: 'chicago-boe:retention:pat-quinn',
  districtId: `${COOK_COUNTY}/circuit_court:cook`,
  title: 'Retention: Judge, Circuit Court',
  office: 'Judge, Circuit Court',
  judge: 'Pat Quinn',
  ballotOrder: 720001,
}

const measureQ: MeasureContest = {
  ...contestBase,
  electionId: CA_ELECTION,
  authorityId: LOS_ANGELES_COUNTY,
  districtId: LOS_ANGELES_COUNTY,
  kind: 'measure',
  id: 'la-measure-q-sample',
  title: 'Measure Q',
  question: 'Shall the county raise the sample tax?',
  ballotOrder: 9000,
}

const calledTreasurer: RaceResult = {
  contestIds: [treasurer.id, 'cook-clerk:900100'],
  kind: 'candidate',
  status: 'called',
  voteFor: 1,
  // Not in ballot order: the card keeps the ballot's order anyway.
  choices: [
    { name: 'Alex Rivera', votes: 873455 },
    { name: 'Jordan Lee', votes: 37051 },
    { name: 'Sam Moore', votes: 412880 },
  ],
  winners: ['Alex Rivera'],
  // 9:41 p.m. CT on Election Day
  call: {
    by: 'AP',
    at: '2026-11-04T03:41:00.000Z',
    url: 'https://apnews.com/projects/elections-2026/cook-treasurer/',
  },
  certifyBy: '2026-11-24',
  scope: 'within',
  sources: [CHICAGO_BOARD, COOK_CLERK],
  changedAt: '2026-11-04T09:00:00.000Z',
}

const countingSchoolBoard: RaceResult = {
  contestIds: [schoolBoard.id],
  kind: 'candidate',
  status: 'counting',
  voteFor: 3,
  choices: [
    { name: 'Maya Chen', votes: 40112 },
    { name: 'Tom Baker', votes: 26457 },
    { name: 'Rosa Diaz', votes: 34509 },
    { name: 'Eli Grant', votes: 31058 },
    { name: 'Ann Wu', votes: 11648 },
  ],
  certifyBy: '2026-11-27',
  scope: 'within',
  sources: [LA_REGISTRAR],
  changedAt: '2026-11-06T01:00:00.000Z',
}

const certifiedJudge: RaceResult = {
  contestIds: [judge.id],
  kind: 'retention',
  status: 'certified',
  threshold: 0.6,
  choices: [
    { name: 'Yes', votes: 1021560 },
    { name: 'No', votes: 409190 },
  ],
  winners: ['Yes'],
  certified: { on: '2026-11-24', url: 'https://chicagoelections.gov/cert' },
  certifyBy: '2026-11-24',
  scope: 'within',
  sources: [CHICAGO_BOARD, COOK_CLERK],
  changedAt: '2026-11-24T20:00:00.000Z',
}

const certifiedMeasure: RaceResult = {
  contestIds: [measureQ.id],
  kind: 'measure',
  status: 'certified',
  threshold: 0.55,
  choices: [
    { name: 'Yes', votes: 61804 },
    { name: 'No', votes: 56367 },
  ],
  winners: ['No'],
  certified: { on: '2026-11-27', url: 'https://lavote.gov/cert' },
  certifyBy: '2026-11-27',
  scope: 'within',
  sources: [LA_REGISTRAR],
  changedAt: '2026-11-27T20:00:00.000Z',
}

const noCountStateRep: RaceResult = {
  contestIds: [stateRep.id],
  kind: 'candidate',
  status: 'no_count',
  voteFor: 1,
  choices: [],
  certifyBy: '2026-12-04',
  scope: 'beyond',
  sources: [],
  changedAt: '2026-11-04T09:00:00.000Z',
}

const resultsData = (byElection: Record<string, RaceResult[]>) =>
  makeResultsData(byElection, CHECKED_AT)

const card = (contest: CandidateContest | RetentionContest) => (
  <RaceCard contest={contest} published={new Set()} />
)

const ballotOf = (contests: Contest[], electionId = IL_ELECTION): Ballot => ({
  election: {
    id: electionId,
    name: 'General Election',
    date: '2026-11-03',
    divisionId: IL,
  },
  contests,
  coverage: { status: 'complete', notes: [] },
})

const rowOf = (name: string) => screen.getByText(name).closest('li')!
/**
 * A row's results column, line by line: each line's role and the height it
 * keeps. Every row of a card with a column has the same lines, loaded or
 * loading, so no row changes size.
 */
const columnLines = (row: Element) =>
  [...row.querySelector('.tabular-nums')!.querySelectorAll('[data-line]')].map(
    (line) => [
      line.getAttribute('data-line'),
      line.className.match(/min-h-[\d.]+/)?.[0],
    ],
  )
const THREE_LINES = [
  ['label', 'min-h-5.5'],
  ['share', 'min-h-6.5'],
  ['votes', 'min-h-4.5'],
]
const caption = (container: HTMLElement) =>
  container.querySelector('p.italic.border-t')?.textContent

describe('a called race', () => {
  it('fills the winner, keeps ballot order and shows no pick boxes', () => {
    renderWithResults(
      card(treasurer),
      resultsData({ [IL_ELECTION]: [calledTreasurer] }),
    )
    const rows = screen.getAllByRole('listitem')
    expect(
      rows.map((li) => li.querySelector('.text-label')?.textContent),
    ).toEqual(['Sam Moore', 'Alex Rivera', 'Jordan Lee'])

    const winner = rowOf('Alex Rivera')
    expect(winner).toHaveAttribute('data-fill', 'win')
    expect(within(winner).getByText('Won')).toBeInTheDocument()
    // A decided label carries a check icon as well as the word.
    expect(within(winner).getByText('Won').querySelector('svg')).toBeTruthy()
    expect(within(winner).getByText('66.0%')).toBeInTheDocument()
    expect(within(winner).getByText('873,455')).toBeInTheDocument()

    for (const name of ['Sam Moore', 'Jordan Lee'])
      expect(rowOf(name)).not.toHaveAttribute('data-fill')
    expect(within(rowOf('Sam Moore')).getByText('31.2%')).toBeInTheDocument()
    expect(within(rowOf('Jordan Lee')).getByText('2.8%')).toBeInTheDocument()

    expect(screen.getByText('Share of votes')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('keeps a row without a label the same height as a labeled row', () => {
    renderWithResults(
      card(treasurer),
      resultsData({ [IL_ELECTION]: [calledTreasurer] }),
    )
    for (const name of ['Alex Rivera', 'Sam Moore', 'Jordan Lee'])
      expect(columnLines(rowOf(name))).toEqual(THREE_LINES)
    // The unlabeled row's label line is empty space, hidden from screen
    // readers.
    const empty = rowOf('Sam Moore').querySelector('[data-line="label"]')!
    expect(empty).toBeEmptyDOMElement()
    expect(empty).toHaveAttribute('aria-hidden', 'true')
    expect(
      rowOf('Alex Rivera').querySelector('[data-line="label"]'),
    ).not.toHaveAttribute('aria-hidden')
  })

  it('ends with the call, the count and the certification date, in italics', () => {
    const { container } = renderWithResults(
      card(treasurer),
      resultsData({ [IL_ELECTION]: [calledTreasurer] }),
    )
    expect(caption(container)).toBe(
      'AP called this race on Tuesday, November 3, 2026, at 9:41 p.m. CT. Unofficial count as of Wednesday, November 4, 2026, 2:12 a.m. CT, from the Chicago Board of Election Commissioners and the Cook County Clerk. Certified by Tuesday, November 24, 2026.',
    )
    expect(container.querySelector('p.italic')).toHaveClass(
      'text-caption',
      'text-muted',
    )
    expect(
      screen.getByRole('link', {
        name: 'Chicago Board of Election Commissioners',
      }),
    ).toHaveAttribute('href', CHICAGO_BOARD.url)
    expect(
      screen.getByRole('link', { name: 'Cook County Clerk' }),
    ).toHaveAttribute('href', COOK_CLERK.url)
  })

  it('says "Elected" once certified, with the certification line', () => {
    const certified: RaceResult = {
      ...calledTreasurer,
      status: 'certified',
      certified: { on: '2026-11-24', url: 'https://chicagoelections.gov/c' },
    }
    const { container } = renderWithResults(
      card(treasurer),
      resultsData({ [IL_ELECTION]: [certified] }),
    )
    expect(within(rowOf('Alex Rivera')).getByText('Elected')).toBeTruthy()
    expect(caption(container)).toBe(
      'Official results, certified Tuesday, November 24, 2026, by the Chicago Board of Election Commissioners and the Cook County Clerk.',
    )
  })
})

describe('a race still being counted', () => {
  it('tints the three leaders of a vote-for-3 race', () => {
    const { container } = renderWithResults(
      card(schoolBoard),
      resultsData({ [CA_ELECTION]: [countingSchoolBoard] }),
    )
    const leading = [...container.querySelectorAll('li[data-fill="lead"]')]
    expect(leading.map((li) => li.querySelector('.text-label')?.textContent))
      // Ballot order, not vote order.
      .toEqual(['Maya Chen', 'Rosa Diaz', 'Eli Grant'])
    for (const li of leading) {
      expect(within(li as HTMLElement).getByText('Leading')).toBeTruthy()
      // Leading isn't a decision: no check icon.
      expect(
        within(li as HTMLElement)
          .getByText('Leading')
          .querySelector('svg'),
      ).toBeNull()
    }
    expect(container.querySelectorAll('li[data-fill="win"]')).toHaveLength(0)
    expect(caption(container)).toBe(
      'Not called yet. Unofficial count as of Thursday, November 5, 2026, 4 p.m. PT, from the Los Angeles County Registrar-Recorder/County Clerk.',
    )
  })

  it('tints both rows tied for the last seat, labeled "Tied"', () => {
    const tied: RaceResult = {
      ...calledTreasurer,
      status: 'counting',
      winners: undefined,
      call: undefined,
      choices: [
        { name: 'Sam Moore', votes: 5000 },
        { name: 'Alex Rivera', votes: 5000 },
        { name: 'Jordan Lee', votes: 120 },
      ],
    }
    const { container } = renderWithResults(
      card(treasurer),
      resultsData({ [IL_ELECTION]: [tied] }),
    )
    for (const name of ['Sam Moore', 'Alex Rivera']) {
      expect(rowOf(name)).toHaveAttribute('data-fill', 'lead')
      expect(within(rowOf(name)).getByText('Tied')).toBeInTheDocument()
    }
    expect(rowOf('Jordan Lee')).not.toHaveAttribute('data-fill')
    expect(container.querySelectorAll('li[data-fill]')).toHaveLength(2)
  })

  it('tints an unopposed candidate, with 100%', () => {
    const solo: CandidateContest = {
      ...treasurer,
      candidates: [treasurer.candidates[1]],
    }
    renderWithResults(
      card(solo),
      resultsData({
        [IL_ELECTION]: [
          {
            ...calledTreasurer,
            status: 'counting',
            winners: undefined,
            call: undefined,
            choices: [{ name: 'Alex Rivera', votes: 88310 }],
          },
        ],
      }),
    )
    const row = rowOf('Alex Rivera')
    expect(row).toHaveAttribute('data-fill', 'lead')
    expect(within(row).getByText('Unopposed')).toBeInTheDocument()
    expect(within(row).getByText('100%')).toBeInTheDocument()
  })

  it('says when a race is too close to call, with shares and no fill', () => {
    const tooClose: RaceResult = {
      ...calledTreasurer,
      status: 'too_close',
      winners: undefined,
      call: undefined,
    }
    const { container } = renderWithResults(
      card(treasurer),
      resultsData({ [IL_ELECTION]: [tooClose] }),
    )
    expect(screen.getByText('Too close to call')).toHaveClass(
      'text-small',
      'font-bold',
    )
    expect(screen.queryByText('Share of votes')).toBeNull()
    expect(container.querySelectorAll('li[data-fill]')).toHaveLength(0)
    expect(within(rowOf('Alex Rivera')).getByText('66.0%')).toBeTruthy()
    expect(caption(container)).toBe(
      'Too close to call. Unofficial count as of Wednesday, November 4, 2026, 2:12 a.m. CT, from the Chicago Board of Election Commissioners and the Cook County Clerk.',
    )
  })
})

describe("AP's count for an Illinois race that crosses county lines", () => {
  const apCalled: RaceResult = {
    ...calledTreasurer,
    // 8:02 p.m. CT
    call: { ...calledTreasurer.call!, at: '2026-11-04T02:02:00.000Z' },
    certifyBy: '2026-12-04',
    scope: 'beyond',
    sources: [AP_COUNT],
  }

  it('names AP and its estimate of the votes counted', () => {
    const { container } = renderWithResults(
      card(treasurer),
      resultsData({ [IL_ELECTION]: [apCalled] }),
    )
    expect(caption(container)).toBe(
      'AP called this race on Tuesday, November 3, 2026, at 8:02 p.m. CT. Count from AP as of Wednesday, November 4, 2026, 3:21 a.m. CT; AP estimates 81% of votes counted. Official results by Friday, December 4, 2026.',
    )
  })

  it('says it is not called yet before AP calls it', () => {
    const { container } = renderWithResults(
      card(treasurer),
      resultsData({
        [IL_ELECTION]: [
          {
            ...apCalled,
            status: 'counting',
            winners: undefined,
            call: undefined,
          },
        ],
      }),
    )
    expect(caption(container)).toBe(
      'Not called yet. Count from AP as of Wednesday, November 4, 2026, 3:21 a.m. CT; AP estimates 81% of votes counted.',
    )
    expect(rowOf('Alex Rivera')).toHaveAttribute('data-fill', 'lead')
  })
})

describe('a race with no count', () => {
  it('says the district reaches past the county, with no shares', () => {
    const { container } = renderWithResults(
      card(stateRep),
      resultsData({ [IL_ELECTION]: [noCountStateRep] }),
    )
    expect(screen.getByText('Not called yet')).toHaveClass(
      'text-small',
      'font-bold',
    )
    expect(container.textContent).not.toMatch(/%/)
    // No results column: the rows read as before.
    expect(container.querySelector('li .tabular-nums')).toBeNull()
    expect(container.querySelectorAll('li[data-fill]')).toHaveLength(0)
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(caption(container)).toBe(
      'As of Thursday, November 5, 2026, 7:30 p.m. CT. This district reaches past Cook County, so we show no partial count. See official results',
    )
    const link = screen.getByRole('link', { name: 'See official results' })
    expect(link).toHaveAttribute('href', CHICAGO_BOARD.url)
    // The caption ends with the link.
    expect(container.querySelector('p.italic')?.lastElementChild).toBe(link)
  })

  it('names Los Angeles County for an LA district', () => {
    const laRace = { ...schoolBoard, id: 'la-assembly-sample' }
    const { container } = renderWithResults(
      card(laRace),
      resultsData({
        [CA_ELECTION]: [{ ...noCountStateRep, contestIds: [laRace.id] }],
      }),
    )
    expect(caption(container)).toBe(
      'As of Thursday, November 5, 2026, 5:30 p.m. PT. This district reaches past Los Angeles County, so we show no partial count. See official results',
    )
  })

  it('says only "Not called yet" for a race missing from the official files', () => {
    const { container } = renderWithResults(
      card(stateRep),
      resultsData({
        [IL_ELECTION]: [{ ...noCountStateRep, scope: 'within' }],
      }),
    )
    expect(caption(container)).toBe('Not called yet. See official results')
  })

  it('keeps "No candidates filed" with no results column or caption', () => {
    const empty = { ...stateRep, candidates: [] }
    const { container } = renderWithResults(
      card(empty),
      resultsData({ [IL_ELECTION]: [noCountStateRep] }),
    )
    expect(
      screen.getByText('No candidates filed for this race.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Not called yet')).toBeNull()
    expect(caption(container)).toBeUndefined()
  })
})

describe('a judge up for retention', () => {
  it('shows a Yes row and a No row, with the threshold in the band', () => {
    const { container } = renderWithResults(
      <PersonRaces
        ballot={ballotOf([judge])}
        personKey={profileKey('Pat Quinn')}
      />,
      resultsData({ [IL_ELECTION]: [certifiedJudge] }),
    )
    expect(screen.getByText('Needs 60% yes to stay.')).toBeInTheDocument()
    const yes = screen.getByText('Yes').closest('li')!
    expect(yes).toHaveAttribute('data-fill', 'win')
    expect(within(yes).getByText('Retained')).toBeInTheDocument()
    expect(within(yes).getByText('71.4%')).toBeInTheDocument()
    const no = screen.getByText('No').closest('li')!
    expect(no).not.toHaveAttribute('data-fill')
    expect(within(no).getByText('28.6%')).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(caption(container)).toBe(
      'Official results, certified Tuesday, November 24, 2026, by the Chicago Board of Election Commissioners and the Cook County Clerk.',
    )
  })

  it('fills the No row of a judge not retained', () => {
    renderWithResults(
      card(judge),
      resultsData({
        [IL_ELECTION]: [
          {
            ...certifiedJudge,
            choices: [
              { name: 'Yes', votes: 5500 },
              { name: 'No', votes: 4500 },
            ],
            winners: ['No'],
          },
        ],
      }),
    )
    const no = screen.getByText('No').closest('li')!
    expect(no).toHaveAttribute('data-fill', 'win')
    expect(
      within(no).getByText('Not retained').querySelector('svg'),
    ).toBeTruthy()
    const yes = screen.getByText('Yes').closest('li')!
    expect(yes).not.toHaveAttribute('data-fill')
    expect(within(yes).getByText('55.0%')).toBeInTheDocument()
  })

  it('leaves out the office list when no office is named', () => {
    const { container } = renderWithResults(
      card(judge),
      resultsData({ [IL_ELECTION]: [{ ...certifiedJudge, sources: [] }] }),
    )
    expect(caption(container)).toBe(
      'Official results, certified Tuesday, November 24, 2026.',
    )
  })

  it('leaves out the voting instruction once results show', () => {
    renderWithResults(
      card(judge),
      resultsData({ [IL_ELECTION]: [certifiedJudge] }),
    )
    expect(
      screen.queryByText('Vote yes or no on keeping this judge in office.'),
    ).toBeNull()
  })

  it('keeps the voting instruction for an election without results', () => {
    const later = { ...judge, electionId: 'il-2027-02-23-municipal' }
    renderWithResults(
      card(later),
      resultsData({ [IL_ELECTION]: [certifiedJudge] }),
    )
    expect(
      screen.getByText('Vote yes or no on keeping this judge in office.'),
    ).toBeInTheDocument()
  })

  it('shows the result on the race page card too', () => {
    renderWithResults(
      card(judge),
      resultsData({ [IL_ELECTION]: [certifiedJudge] }),
    )
    expect(screen.getByText('Needs 60% yes to stay.')).toBeInTheDocument()
    expect(screen.getByText('Yes').closest('li')).toHaveAttribute(
      'data-fill',
      'win',
    )
  })

  it('shows each judge’s result in the ballot’s retention list', () => {
    const { container } = renderWithResults(
      <BallotView ballot={ballotOf([judge])} />,
      resultsData({ [IL_ELECTION]: [certifiedJudge] }),
    )
    expect(screen.getByText('Needs 60% yes to stay.')).toBeInTheDocument()
    expect(screen.getByText('Yes').closest('li')).toHaveAttribute(
      'data-fill',
      'win',
    )
    expect(screen.queryByRole('button', { name: /^Yes on/ })).toBeNull()
    expect(caption(container)).toMatch(/^Official results, certified/)
    expect(
      screen.queryByText('Vote yes or no on keeping each judge in office.'),
    ).toBeNull()
    // The list's first judge sits right under the panel's top line: one
    // border, not two.
    const list = container.querySelector('details ul')!
    expect(list).not.toHaveClass('border-t')
  })

  it('keeps the list’s voting instruction for an election without results', () => {
    const LATER = 'il-2027-02-23-municipal'
    renderWithResults(
      <BallotView
        ballot={ballotOf([{ ...judge, electionId: LATER }], LATER)}
      />,
      resultsData({ [IL_ELECTION]: [certifiedJudge] }),
    )
    expect(
      screen.getByText('Vote yes or no on keeping each judge in office.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Yes on/ })).toBeInTheDocument()
  })
})

describe('a measure', () => {
  it('fills the Yes row of a measure that passed', () => {
    renderWithResults(
      <BallotView ballot={ballotOf([measureQ], CA_ELECTION)} />,
      resultsData({
        [CA_ELECTION]: [
          {
            ...certifiedMeasure,
            choices: [
              { name: 'Yes', votes: 70000 },
              { name: 'No', votes: 30000 },
            ],
            winners: ['Yes'],
          },
        ],
      }),
    )
    const yes = screen.getByText('Yes').closest('li')!
    expect(yes).toHaveAttribute('data-fill', 'win')
    expect(within(yes).getByText('Passed').querySelector('svg')).toBeTruthy()
    expect(screen.getByText('No').closest('li')).not.toHaveAttribute(
      'data-fill',
    )
  })

  it('replaces the Yes and No buttons with result rows', () => {
    const { container } = renderWithResults(
      <BallotView ballot={ballotOf([measureQ], CA_ELECTION)} />,
      resultsData({ [CA_ELECTION]: [certifiedMeasure] }),
    )
    expect(screen.queryByRole('button', { name: /^Yes on/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^No on/ })).toBeNull()
    expect(screen.getByText('Needs 55% yes to pass.')).toBeInTheDocument()
    const no = screen.getByText('No').closest('li')!
    expect(no).toHaveAttribute('data-fill', 'win')
    expect(within(no).getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('Yes').closest('li')).not.toHaveAttribute(
      'data-fill',
    )
    // The official text stays.
    expect(
      screen.getByText('Shall the county raise the sample tax?'),
    ).toBeInTheDocument()
    expect(caption(container)).toBe(
      'Official results, certified Friday, November 27, 2026, by the Los Angeles County Registrar-Recorder/County Clerk.',
    )
  })
})

describe('picks', () => {
  it('marks the voter’s own pick with a tag in place of the check box', () => {
    ballotStore.toggle(treasurer, profileKey('Sam Moore'))
    renderWithResults(
      <BallotView ballot={ballotOf([treasurer])} />,
      resultsData({ [IL_ELECTION]: [calledTreasurer] }),
    )
    expect(screen.queryByRole('checkbox')).toBeNull()
    const tag = within(rowOf('Sam Moore')).getByText('Your pick')
    expect(tag).toHaveClass('bg-highlight', 'text-on-highlight')
    // An en space before it (not a margin), so a wrapped tag starts flush.
    expect(tag.previousSibling?.textContent).toBe('\u2002')
    expect(screen.getAllByText('Your pick')).toHaveLength(1)
  })

  it('marks a No pick on the judge’s No row', () => {
    ballotStore.toggle(judge, 'no')
    renderWithResults(
      <PersonRaces
        ballot={ballotOf([judge])}
        personKey={profileKey('Pat Quinn')}
      />,
      resultsData({ [IL_ELECTION]: [certifiedJudge] }),
    )
    const no = screen.getByText('No').closest('li')!
    expect(within(no).getByText('Your pick')).toBeInTheDocument()
    expect(screen.getAllByText('Your pick')).toHaveLength(1)
  })

  it('shows no tag on a race page card, where picks never show', () => {
    ballotStore.toggle(treasurer, profileKey('Sam Moore'))
    renderWithResults(
      card(treasurer),
      resultsData({ [IL_ELECTION]: [calledTreasurer] }),
    )
    expect(screen.queryByText('Your pick')).toBeNull()
  })

  it('leaves out the picking line for an election with results', () => {
    renderWithResults(
      <BallotView ballot={ballotOf([treasurer])} />,
      resultsData({ [IL_ELECTION]: [calledTreasurer] }),
    )
    expect(screen.queryByText(/To make a list to take with you/)).toBeNull()
  })

  // Review Focus 2: a 2026 ballot saved on the device, after the site-wide
  // switch is turned off, still shows its results.
  it('shows results and no check boxes with the after-election switch off', () => {
    mode.on = false
    ballotStore.saveBallot(ballotOf([treasurer]))
    renderWithResults(
      <BallotView ballot={ballotOf([treasurer])} />,
      resultsData({ [IL_ELECTION]: [calledTreasurer] }),
    )
    expect(rowOf('Alex Rivera')).toHaveAttribute('data-fill', 'win')
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByText(/To make a list to take with you/)).toBeNull()
  })
})

describe('the ballot header', () => {
  it('says when the results are from, in place of "Voting ended"', () => {
    renderWithResults(
      <BallotView ballot={ballotOf([treasurer])} />,
      resultsData({ [IL_ELECTION]: [calledTreasurer] }),
    )
    expect(
      screen.getByText(
        'Results as of Thursday, November 5, 2026, 7:30 p.m. CT. Counts are unofficial until certified.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Voting ended/)).toBeNull()
  })

  it('keeps the line’s space, with no text, while the results load', () => {
    render(
      <MemoryRouter>
        <BallotView ballot={ballotOf([treasurer])} />
      </MemoryRouter>,
    )
    expect(screen.queryByText(/Results as of|Voting ended/)).toBeNull()
  })
})

describe('without a result', () => {
  it('renders an election without results exactly as before', () => {
    // A later election reusing a 2026 contest ID.
    const later = { ...treasurer, electionId: 'il-2027-02-23-municipal' }
    const data = resultsData({ [IL_ELECTION]: [calledTreasurer] })
    const withResults = renderWithResults(card(later), data).container.innerHTML
    const plain = render(<MemoryRouter>{card(later)}</MemoryRouter>).container
      .innerHTML
    expect(withResults).toBe(plain)
    expect(withResults).not.toMatch(/data-fill|Share of votes|66\.0%/)
  })

  it('renders a ballot of an election without results exactly as before', () => {
    const later = ballotOf(
      [{ ...treasurer, electionId: 'il-2027-02-23-municipal' }],
      'il-2027-02-23-municipal',
    )
    const data = resultsData({ [IL_ELECTION]: [calledTreasurer] })
    const withResults = renderWithResults(<BallotView ballot={later} />, data)
      .container.innerHTML
    const plain = render(
      <MemoryRouter>
        <BallotView ballot={later} />
      </MemoryRouter>,
    ).container.innerHTML
    expect(withResults).toBe(plain)
    expect(withResults).toMatch(/To make a list to take with you/)
    expect(withResults).toMatch(/type="checkbox"/)
  })

  it('renders a contest missing from its election’s results as today', () => {
    const { container } = renderWithResults(
      <BallotView ballot={ballotOf([treasurer])} />,
      // The election has results, but none for this contest.
      resultsData({ [IL_ELECTION]: [countingSchoolBoard] }),
    )
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
    expect(container.querySelectorAll('[data-fill]')).toHaveLength(0)
    expect(screen.queryByText('Share of votes')).toBeNull()
    expect(caption(container)).toBeUndefined()
  })

  it('reserves the results’ space, with no pick boxes, while they load', () => {
    // No provider: the election has a results file whose data hasn't loaded.
    const { container } = render(
      <MemoryRouter>
        <BallotView ballot={ballotOf([treasurer])} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(container.querySelectorAll('[data-fill]')).toHaveLength(0)
    expect(container.textContent).not.toMatch(/%|Share of votes/)
    // One reserved results column per row, hidden from screen readers.
    const rows = within(container.querySelector('ul.divide-y')!).getAllByRole(
      'listitem',
    )
    for (const li of rows) {
      const column = li.querySelector('[data-results-placeholder]')!
      expect(column).toHaveAttribute('aria-hidden', 'true')
      // Label, share and votes: the same lines as every loaded row, so no
      // row changes size when the results arrive.
      expect(columnLines(li)).toEqual(THREE_LINES)
    }
    // The caption's space: four caption lines, as a called race's caption
    // takes at 375 px.
    const captionSpace = container.querySelector(
      'div.border-t[data-results-placeholder]',
    )!
    expect(captionSpace).toHaveAttribute('aria-hidden', 'true')
    expect(
      [...captionSpace.children].map(
        (line) => line.className.match(/h-[\d.]+/)?.[0],
      ),
    ).toEqual(['h-4.5', 'h-4.5', 'h-4.5', 'h-4.5'])
  })

  it('reserves a judge’s threshold line and both rows while results load', () => {
    const { container } = render(
      <MemoryRouter>
        <PersonRaces
          ballot={ballotOf([judge])}
          personKey={profileKey('Pat Quinn')}
        />
      </MemoryRouter>,
    )
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(
      container.querySelectorAll('span[data-results-placeholder]'),
    ).toHaveLength(2)
    expect(
      container.querySelectorAll('div[data-results-placeholder]'),
    ).toHaveLength(1)
    // The band keeps the threshold's line.
    expect(
      container.querySelectorAll('p[data-results-placeholder]'),
    ).toHaveLength(1)
    expect(
      screen.queryByText('Vote yes or no on keeping this judge in office.'),
    ).toBeNull()
  })
})
