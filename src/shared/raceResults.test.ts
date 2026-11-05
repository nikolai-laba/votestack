import { describe, expect, it } from 'vitest'
import {
  type RaceResult,
  parseResultsFile,
  passes,
  personOutcome,
  resultView,
  shareText,
  thresholdText,
} from './raceResults.ts'

const SOURCE = {
  name: 'County',
  url: 'https://example.org',
  retrievedAt: '2026-11-04T08:00:00Z',
  official: true,
  asOf: '2026-11-04T07:00:00Z',
}

function race(over: Partial<RaceResult>): RaceResult {
  return {
    contestIds: ['c1'],
    kind: 'candidate',
    status: 'called',
    voteFor: 1,
    choices: [
      { name: 'Alex Rivera', votes: 873455 },
      { name: 'Sam Moore', votes: 412880 },
      { name: 'Pat Lee', votes: 37051 },
    ],
    winners: ['Alex Rivera'],
    certifyBy: '2026-11-17',
    scope: 'within',
    sources: [SOURCE],
    changedAt: '2026-11-04T08:00:00Z',
    ...over,
  }
}

const yesNo = (yes: number, no: number) => [
  { name: 'Yes', votes: yes },
  { name: 'No', votes: no },
]

describe('resultView', () => {
  it('labels a called winner Won', () => {
    const v = resultView(race({}))
    expect(v.header).toBe('Share of votes')
    expect(v.outcome).toBe('Won')
    expect(v.choices[0]).toMatchObject({
      label: 'Won',
      fill: 'win',
      shareText: '66.0%',
    })
    for (const c of v.choices.slice(1)) {
      expect(c.fill).toBe('none')
      expect(c.label).toBeUndefined()
    }
  })

  it('labels a certified winner Elected', () => {
    const v = resultView(race({ status: 'certified' }))
    expect(v.choices[0].label).toBe('Elected')
    expect(v.outcome).toBe('Elected')
    expect(v.winners).toEqual(['Alex Rivera'])
  })

  it('marks the top three leading in ballot order', () => {
    const names = ['A', 'B', 'C', 'D', 'E']
    const v = resultView(
      race({
        status: 'counting',
        voteFor: 3,
        winners: undefined,
        choices: [10, 50, 30, 20, 40].map((votes, i) => ({
          name: names[i],
          votes,
        })),
      }),
    )
    expect(v.choices.map((c) => c.name)).toEqual(names)
    expect(v.choices.map((c) => c.label)).toEqual([
      undefined,
      'Leading',
      'Leading',
      undefined,
      'Leading',
    ])
    expect(v.leaders).toEqual(['B', 'C', 'E'])
    expect(v.outcome).toBe('Leading')
  })

  it('marks a tie at the last seat Tied', () => {
    const v = resultView(
      race({
        status: 'counting',
        voteFor: 2,
        winners: undefined,
        choices: [
          { name: 'A', votes: 30 },
          { name: 'B', votes: 20 },
          { name: 'C', votes: 20 },
        ],
      }),
    )
    expect(v.choices.map((c) => c.label)).toEqual(['Leading', 'Tied', 'Tied'])
    expect(v.choices.map((c) => c.fill)).toEqual(['lead', 'lead', 'lead'])
  })

  it('marks an unopposed candidate Unopposed', () => {
    const v = resultView(
      race({
        status: 'counting',
        winners: undefined,
        choices: [{ name: 'A', votes: 5 }],
      }),
    )
    expect(v.choices[0]).toMatchObject({
      label: 'Unopposed',
      fill: 'lead',
      shareText: '100%',
    })
  })

  it('marks every candidate Unopposed when there are no more candidates than seats', () => {
    const v = resultView(
      race({
        status: 'counting',
        voteFor: 2,
        winners: undefined,
        choices: [
          { name: 'A', votes: 300 },
          { name: 'B', votes: 200 },
        ],
      }),
    )
    expect(v.choices.map((c) => [c.label, c.fill])).toEqual([
      ['Unopposed', 'lead'],
      ['Unopposed', 'lead'],
    ])
    expect(v.leaders).toEqual(['A', 'B'])
  })

  it('retains a judge above the threshold', () => {
    const v = resultView(
      race({
        kind: 'retention',
        status: 'certified',
        threshold: 0.6,
        choices: yesNo(1021560, 409190),
        winners: ['Yes'],
      }),
    )
    expect(v.choices[0]).toMatchObject({ label: 'Retained', fill: 'win' })
    expect(v.outcome).toBe('Retained')
  })

  it('does not retain a judge below the threshold', () => {
    const v = resultView(
      race({
        kind: 'retention',
        status: 'certified',
        threshold: 0.6,
        choices: yesNo(55, 45),
        winners: ['No'],
      }),
    )
    expect(v.choices[1]).toMatchObject({ label: 'Not retained', fill: 'win' })
    expect(v.choices[0].fill).toBe('none')
  })

  it('shows the side that would win now as Leading', () => {
    const v = resultView(
      race({
        kind: 'measure',
        status: 'counting',
        threshold: 0.55,
        winners: undefined,
        choices: yesNo(523, 477),
      }),
    )
    expect(v.choices[1]).toMatchObject({ label: 'Leading', fill: 'lead' })
    expect(v.choices[0].fill).toBe('none')
  })

  it('uses Passed and Failed for a called measure', () => {
    const v = resultView(
      race({
        kind: 'measure',
        threshold: 0.5,
        choices: yesNo(40, 60),
        winners: ['No'],
      }),
    )
    expect(v.choices[1].label).toBe('Failed')
    expect(v.outcome).toBe('Failed')
  })

  it('leads Yes at exactly two-thirds yes for a two-thirds measure', () => {
    const v = resultView(
      race({
        kind: 'measure',
        status: 'counting',
        threshold: 2 / 3,
        winners: undefined,
        choices: yesNo(2000, 1000),
      }),
    )
    expect(v.choices[0]).toMatchObject({
      label: 'Leading',
      fill: 'lead',
      shareText: '66.7%',
    })
    expect(v.choices[1].label).toBeUndefined()
  })

  it('shows shares but no labels when too close to call', () => {
    const v = resultView(race({ status: 'too_close', winners: undefined }))
    expect(v.header).toBe('Too close to call')
    expect(v.outcome).toBeUndefined()
    expect(v.choices.every((c) => !c.label && c.fill === 'none')).toBe(true)
    expect(v.choices[0].shareText).toBe('66.0%')
  })

  it('has no choices when nothing is counted', () => {
    const v = resultView(
      race({ status: 'no_count', choices: [], winners: undefined }),
    )
    expect(v.header).toBe('Not called yet')
    expect(v.choices).toEqual([])
  })

  it('shows 0.0% and no labels before any votes are counted', () => {
    const v = resultView(
      race({
        status: 'counting',
        winners: undefined,
        choices: [
          { name: 'A', votes: 0 },
          { name: 'B', votes: 0 },
        ],
      }),
    )
    expect(v.choices.map((c) => c.shareText)).toEqual(['0.0%', '0.0%'])
    expect(v.choices.every((c) => !c.label && c.fill === 'none')).toBe(true)
  })
})

describe('shareText', () => {
  it('keeps two decimals just under a threshold', () => {
    expect(shareText(0.59964, 0.6)).toBe('59.96%')
  })
  it('rounds to one decimal without a threshold', () => {
    expect(shareText(0.5996)).toBe('60.0%')
  })
  it('handles the extremes', () => {
    expect(shareText(0.0004)).toBe('Under 0.1%')
    expect(shareText(0)).toBe('0.0%')
    expect(shareText(1)).toBe('100%')
    expect(shareText(0.99962)).toBe('Over 99.9%')
  })
})

describe('passes', () => {
  it('needs more than half for a majority', () => {
    expect(passes(0.5, 0.5)).toBe(false)
    expect(passes(0.5001, 0.5)).toBe(true)
  })
  it('meets other thresholds exactly', () => {
    expect(passes(0.6, 0.6)).toBe(true)
    expect(passes(2 / 3, 2 / 3)).toBe(true)
    expect(passes(2000 / 3000, 2 / 3)).toBe(true)
    expect(passes(1999 / 3000, 2 / 3)).toBe(false)
  })
})

describe('thresholdText', () => {
  it('words each threshold', () => {
    expect(thresholdText('retention', 0.6)).toBe('Needs 60% yes to stay.')
    expect(thresholdText('retention', 0.5)).toBe(
      'Needs a majority yes to stay.',
    )
    expect(thresholdText('measure', 0.55)).toBe('Needs 55% yes to pass.')
    expect(thresholdText('measure', 2 / 3)).toBe(
      'Needs two-thirds yes to pass.',
    )
    expect(thresholdText('measure', 0.5)).toBe('Needs a majority yes to pass.')
  })
})

describe('personOutcome', () => {
  it('reports a called winner and loser', () => {
    const r = race({})
    const won = personOutcome(r, 'Alex Rivera')
    expect(won.outcome).toBe('won')
    expect(won.share).toBeCloseTo(0.66, 2)
    expect(won.winners).toEqual(['Alex Rivera'])
    expect(personOutcome(r, 'Sam Moore').outcome).toBe('not_elected')
  })
  it('reports a certified winner as elected', () => {
    expect(
      personOutcome(race({ status: 'certified' }), 'Alex Rivera').outcome,
    ).toBe('elected')
  })
  it('reports leading and trailing while counting', () => {
    const r = race({ status: 'counting', winners: undefined })
    expect(personOutcome(r, 'Alex Rivera').outcome).toBe('leading')
    expect(personOutcome(r, 'Sam Moore').outcome).toBe('trailing')
  })
  it('reports a retained judge', () => {
    const r = race({
      kind: 'retention',
      threshold: 0.6,
      choices: yesNo(70, 30),
      winners: ['Yes'],
    })
    expect(personOutcome(r, 'Judge Jo').outcome).toBe('retained')
    const no = race({
      kind: 'retention',
      threshold: 0.6,
      choices: yesNo(30, 70),
      winners: ['No'],
    })
    expect(personOutcome(no, 'Judge Jo').outcome).toBe('not_retained')
  })
  it('is uncalled when too close or not counted', () => {
    expect(
      personOutcome(
        race({ status: 'too_close', winners: undefined }),
        'Alex Rivera',
      ).outcome,
    ).toBe('uncalled')
    expect(
      personOutcome(
        race({ status: 'no_count', choices: [], winners: undefined }),
        'Alex Rivera',
      ).outcome,
    ).toBe('uncalled')
  })
})

describe('parseResultsFile', () => {
  const file = () => ({
    version: 1,
    electionId: 'e',
    checkedAt: '2026-11-04T08:00:00Z',
    results: [race({})],
  })
  it('accepts a valid file', () => {
    expect(parseResultsFile(file()).results).toHaveLength(1)
  })
  it('rejects a wrong version', () => {
    expect(() => parseResultsFile({ ...file(), version: 2 })).toThrow(/version/)
  })
  it('rejects a missing status', () => {
    const f = file()
    delete (f.results[0] as Partial<RaceResult>).status
    expect(() => parseResultsFile(f)).toThrow(/results\[0\]\.status/)
  })
  it('rejects negative votes', () => {
    const f = file()
    f.results[0].choices[0].votes = -1
    expect(() => parseResultsFile(f)).toThrow(/votes/)
  })
  it('requires winners on a called race', () => {
    const f = file()
    delete f.results[0].winners
    expect(() => parseResultsFile(f)).toThrow(/winners/)
  })
})
