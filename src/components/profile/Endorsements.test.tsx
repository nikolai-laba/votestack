import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type {
  BarContext,
  BarTally,
  Endorsement,
  ProfileKind,
  ProfileSource,
} from '../../shared/profile.ts'
import { barSummary } from './barSummary.ts'
import {
  Endorsements,
  NO_RATING_TEXT,
  RETENTION_NOTE,
} from './Endorsements.tsx'

const ALLIANCE = 'Alliance of Bar Associations for Judicial Screening'
const TABLE =
  'https://www.voteforjudges.org/wp-content/uploads/2026/09/2026-Alliance-General-Ballot-Ratings-09252026.pdf'

const sources: ProfileSource[] = [
  {
    id: 1,
    title: 'Ratings',
    publisher: ALLIANCE,
    url: TABLE,
    viewedAt: '2026-10-06',
    kind: 'bar',
  },
]

/** The four lines mergeBarRatings gives every judge, per vote. */
function fourLines(
  context: BarContext,
  ratings: [string | undefined, string | undefined, string | undefined],
  tally: BarTally,
  contextLabel?: string,
): Endorsement[] {
  const common = {
    kind: 'bar_evaluation' as const,
    context,
    ...(contextLabel ? { contextLabel } : {}),
    cites: [1],
  }
  return [
    ...[
      'Chicago Bar Association',
      'Chicago Council of Lawyers',
      'Illinois State Bar Association',
    ].map((organization, i) => ({
      organization,
      ...common,
      ...(ratings[i] ? { rating: ratings[i] } : {}),
    })),
    { organization: ALLIANCE, ...common, tally },
  ]
}

const tally = (
  ratings: [string, number][],
  notEvaluated = 0,
  members = 11,
): BarTally => ({
  members,
  ratings: ratings.map(([rating, count]) => ({ rating, count })),
  notEvaluated,
})

function renderSection(kind: ProfileKind, items: Endorsement[]) {
  render(
    <Endorsements
      section={{ asOf: '2026-10-06', items }}
      kind={kind}
      sources={sources}
    />,
  )
  return screen.getByRole('region', {
    name: 'Endorsements and bar evaluations',
  })
}

const lines = (region: HTMLElement) =>
  within(region)
    .getAllByRole('listitem')
    .map((li) => li.textContent)

describe('Endorsements for judges', () => {
  it('shows a retention judge four lines under the note on Yes', () => {
    const region = renderSection(
      'retention',
      fourLines(
        'retention',
        ['Qualified', 'Qualified', 'Yes'],
        tally([
          ['Yes', 9],
          ['No', 1],
        ]),
      ),
    )
    expect(region).toHaveTextContent(RETENTION_NOTE)
    expect(lines(region)).toEqual([
      'Chicago Bar Association: “Qualified”1',
      'Chicago Council of Lawyers: “Qualified”1',
      'Illinois State Bar Association: “Yes”1',
      `${ALLIANCE}: 9 of 10 other member groups said “Yes”, 1 said “No”.1 1 other member group published no rating. Each group’s rating (PDF)`,
    ])
    expect(
      within(region).getByRole('link', { name: 'Each group’s rating (PDF)' }),
    ).toHaveAttribute('href', TABLE)
  })

  it('shows a judge in a race the same four lines, without the note', () => {
    const region = renderSection(
      'judicial_candidate',
      fourLines(
        'election',
        ['Highly Qualified', undefined, 'Highly Recommended'],
        tally([
          ['Recommended', 9],
          ['Qualified', 2],
        ]),
      ),
    )
    expect(region).not.toHaveTextContent(RETENTION_NOTE)
    expect(lines(region)).toEqual([
      'Chicago Bar Association: “Highly Qualified”1',
      'Chicago Council of Lawyers: No rating published1',
      'Illinois State Bar Association: “Highly Recommended”1',
      `${ALLIANCE}: 9 of 11 other member groups rated this judge “Recommended”, 2 “Qualified”.1 Each group’s rating (PDF)`,
    ])
    // Our wording, styled apart from the groups' quoted ratings.
    expect(within(region).getByText(NO_RATING_TEXT)).toHaveClass('text-muted')
  })

  it('labels the two sets of a judge in a race and up for retention', () => {
    const region = renderSection('judicial_candidate', [
      ...fourLines(
        'election',
        ['Qualified', 'Qualified', 'Qualified'],
        tally([['Recommended', 11]]),
        'For the Appellate Court election',
      ),
      ...fourLines(
        'retention',
        ['Qualified', 'Qualified', 'Yes'],
        tally([['Yes', 11]]),
        'For retention as a circuit judge',
      ),
    ])
    expect(
      within(region)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual([
      'For the Appellate Court election',
      'For retention as a circuit judge',
    ])
    expect(within(region).getAllByRole('list')).toHaveLength(2)
    for (const list of within(region).getAllByRole('list'))
      expect(within(list).getAllByRole('listitem')).toHaveLength(4)
    // The note on Yes sits with the retention set only.
    const note = within(region).getByText(RETENTION_NOTE)
    expect(note.parentElement).toHaveTextContent(
      'For retention as a circuit judge',
    )
    expect(note.parentElement).not.toHaveTextContent('Appellate Court')
  })
})

describe('barSummary', () => {
  it('says "all" when every group that rated agrees', () => {
    expect(barSummary(tally([['Yes', 11]]), 'retention')).toEqual({
      text: 'All 11 other member groups that rated this judge said “Yes”.',
      notes: [],
    })
    expect(barSummary(tally([['Not Recommended', 11]]), 'election').text).toBe(
      'All 11 other member groups that rated this judge said “Not Recommended”.',
    )
  })

  it('counts only groups that published a rating, and says how many did not', () => {
    expect(
      barSummary(
        tally([
          ['Yes', 9],
          ['No', 1],
        ]),
        'retention',
      ),
    ).toEqual({
      text: '9 of 10 other member groups said “Yes”, 1 said “No”.',
      notes: ['1 other member group published no rating.'],
    })
    expect(barSummary(tally([['Yes', 8]]), 'retention')).toEqual({
      text: 'All 8 other member groups that rated this judge said “Yes”.',
      notes: ['3 other member groups published no rating.'],
    })
  })

  it('keeps "not evaluated" out of the counts', () => {
    expect(
      barSummary(
        tally(
          [
            ['Recommended', 7],
            ['Qualified', 2],
            ['Highly Recommended', 1],
          ],
          1,
        ),
        'election',
      ),
    ).toEqual({
      text: '7 of 10 other member groups rated this judge “Recommended”, 2 “Qualified”, 1 “Highly Recommended”.',
      notes: [
        '1 other member group marked this judge “Not Evaluated Through No Fault of the Candidate”.',
      ],
    })
  })

  it('has no count when no group published a rating', () => {
    expect(barSummary(tally([]), 'retention')).toEqual({
      text: null,
      notes: [],
    })
  })
})

describe('Endorsements for candidates', () => {
  const kinds: Endorsement['kind'][] = [
    'editorial_board',
    'party',
    'organization',
    'elected_official',
    'union',
  ]
  /** Endorsements named after their position, with mixed kinds. */
  const many = (n: number): Endorsement[] =>
    Array.from({ length: n }, (_, i) => ({
      organization: `Group ${'ABCDEFGHIJ'[i]}`,
      kind: kinds[i % kinds.length],
      cites: [1],
    }))

  function renderCandidate(items: Endorsement[]) {
    render(
      <Endorsements
        section={{ asOf: '2026-10-06', items }}
        kind="candidate"
        sources={sources}
      />,
    )
    return screen.getByRole('region', { name: 'Endorsements' })
  }

  const names = (region: HTMLElement) =>
    within(region)
      .getAllByRole('listitem')
      .map((li) => li.textContent?.match(/^Group [A-J]/)?.[0])

  it('shows six or fewer without a button', () => {
    const region = renderCandidate(many(6))
    expect(within(region).getAllByRole('listitem')).toHaveLength(6)
    expect(within(region).queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows six of ten, then all ten, without moving focus', () => {
    const region = renderCandidate(many(10))
    expect(within(region).getAllByRole('listitem')).toHaveLength(6)
    const button = within(region).getByRole('button', {
      name: 'Show all 10 endorsements',
    })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    const list = within(region).getByRole('list')
    expect(button).toHaveAttribute('aria-controls', list.id)

    button.focus()
    fireEvent.click(button)
    expect(within(region).getAllByRole('listitem')).toHaveLength(10)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button).toHaveAccessibleName('Show fewer')
    expect(button).toHaveFocus()

    fireEvent.click(button)
    expect(within(region).getAllByRole('listitem')).toHaveLength(6)
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('orders by kind, keeping the given order within each group', () => {
    const region = renderCandidate(many(10))
    fireEvent.click(within(region).getByRole('button'))
    // Organizations and unions (C, E, H, J), elected officials (D, I),
    // parties (B, G), editorial boards (A, F).
    expect(names(region)).toEqual([...'CEHJDIBGAF'].map((c) => `Group ${c}`))
  })

  it('labels each kind except plain organizations', () => {
    const region = renderCandidate(many(5))
    const items = within(region).getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual([
      'Group C1',
      'Group E1Union',
      'Group D1Elected official',
      'Group B1Party',
      'Group A1Editorial board',
    ])
  })

  it('names an elected official’s party when known', () => {
    const region = renderCandidate([
      {
        organization: 'U.S. Sen. Pat Example',
        kind: 'elected_official',
        party: 'Democratic',
        cites: [1],
      },
      { organization: 'Ald. Sam Roe', kind: 'elected_official', cites: [1] },
    ])
    expect(
      within(region)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'U.S. Sen. Pat Example1Democratic elected official',
      'Ald. Sam Roe1Elected official',
    ])
  })
})
