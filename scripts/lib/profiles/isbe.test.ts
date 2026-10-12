import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  a1sAfter,
  committeesByName,
  committeesFor,
  isbeOfficeFits,
  isbeSummary,
  isCandidateGiver,
  isJudgesRetentionCommittee,
  largeSince,
  latestQuarterly,
  loadReceipts,
  matchIsbeCandidates,
  otherCommitteesFor,
  readTsv,
  type IsbeCandidate,
  type IsbeCommittee,
  type IsbeReport,
} from './isbe.ts'
import { parseBallotName } from './names.ts'

const candidate = (
  id: string,
  lastName: string,
  firstName: string,
  office: string,
  districtType: string,
  district: string,
  years: number[] = [2026],
): IsbeCandidate => ({
  id,
  lastName,
  firstName,
  office,
  districtType,
  district,
  residenceCounty: 'Cook',
  years: new Set(years),
})

const committee = (
  id: string,
  name: string,
  type = 'Candidate',
): IsbeCommittee => ({ id, name, type, active: true, shared: false })

const CANDIDATES = [
  candidate(
    '1',
    'Williams',
    'Ann M',
    'State Representative',
    'Representative',
    '11',
  ),
  candidate(
    '2',
    'Williams',
    'Ann',
    'State Representative',
    'Representative',
    '12',
  ),
  candidate('3', 'Morita', 'Josina', 'Commissioner', 'County Board', 'Cook 13'),
  candidate(
    '4',
    'Morita',
    'Josina',
    'Commissioner',
    'Water Reclamation',
    'Chicago',
    [2018],
  ),
  candidate(
    '5',
    'Lampkin',
    'Bertina E',
    'Judge',
    'Appellate Court',
    '1',
    [2016],
  ),
]

describe('isbeOfficeFits', () => {
  it('requires the district number for legislative seats', () => {
    const seat = {
      level: 'state',
      office: 'representative',
      district: 11,
    } as const
    expect(isbeOfficeFits(seat, CANDIDATES[0])).toBe(true)
    expect(isbeOfficeFits(seat, CANDIDATES[1])).toBe(false)
  })

  it('accepts the other ways records name county board and school seats', () => {
    expect(
      isbeOfficeFits(
        { level: 'county', office: 'commissioner' },
        candidate('9', 'Mason', 'Ted', 'Member', 'County Board', '15'),
      ),
    ).toBe(true)
    expect(
      isbeOfficeFits(
        { level: 'county', office: 'commissioner' },
        {
          ...candidate('9', 'Mason', 'Ted', 'Member', 'County Board', '15'),
          residenceCounty: 'Lake',
        },
      ),
    ).toBe(false)
    expect(
      isbeOfficeFits(
        { level: 'school board' },
        candidate('10', 'Bannon', 'Ed', 'Member', 'School', '1A'),
      ),
    ).toBe(true)
    expect(
      isbeOfficeFits(
        { level: 'school board' },
        candidate('11', 'Noland', 'Veronica', 'Member', 'School', '46'),
      ),
    ).toBe(false)
  })

  it('tells county board from water reclamation commissioners', () => {
    expect(
      isbeOfficeFits(
        { level: 'county', office: 'commissioner' },
        CANDIDATES[2],
      ),
    ).toBe(true)
    expect(isbeOfficeFits({ level: 'mwrd' }, CANDIDATES[2])).toBe(false)
    expect(isbeOfficeFits({ level: 'mwrd' }, CANDIDATES[3])).toBe(true)
  })
})

describe('matchIsbeCandidates', () => {
  it('needs a candidacy this year, except for judges up for retention', () => {
    const morita = parseBallotName('Josina Morita')
    expect(
      matchIsbeCandidates(morita, { level: 'mwrd' }, CANDIDATES, 2026),
    ).toEqual([])
    const lampkin = parseBallotName('Bertina E. Lampkin')
    expect(
      matchIsbeCandidates(
        lampkin,
        { level: 'judge', retention: true },
        CANDIDATES,
        2026,
      ).map((c) => c.id),
    ).toEqual(['5'])
    expect(
      matchIsbeCandidates(
        lampkin,
        { level: 'judge', retention: false },
        CANDIDATES,
        2026,
      ),
    ).toEqual([])
  })
})

describe('committeesByName', () => {
  it('needs a Cook County record and the person named in the committee name', () => {
    const index = {
      candidates: [
        candidate(
          '7',
          'Villivalam',
          'Ram',
          'Committee Person',
          'Ward',
          'Chicago 39',
          [2024],
        ),
        {
          ...candidate('8', 'Villivalam', 'Ram', 'Mayor', 'City', 'Peoria'),
          residenceCounty: 'Peoria',
        },
      ],
      links: new Map([
        ['7', ['20', '21', '23', '24']],
        ['8', ['22']],
      ]),
      committees: new Map(
        [
          committee('20', 'Friends of Ram'),
          committee('21', 'Ward 39 Democrats'),
          committee('22', 'Villivalam for Peoria'),
          committee('23', 'Ram for 39th Ward Democratic Committeeperson'),
          { ...committee('24', 'Committee for Ram and Others'), shared: true },
        ].map((c) => [c.id, c]),
      ),
    }
    expect(
      committeesByName(parseBallotName('Ram Villivalam'), index).map(
        (c) => c.id,
      ),
    ).toEqual(['20'])
  })
})

describe('committeesFor', () => {
  it("keeps the candidate's own active committees", () => {
    const index = {
      links: new Map([['3', ['10', '11', '12', '13']]]),
      committees: new Map(
        [
          committee('10', 'PAC', 'Political Action'),
          { ...committee('11', 'Old'), active: false },
          committee('12', 'Friends'),
          {
            ...committee('13', 'Committee for Retention of Judges'),
            shared: true,
          },
        ].map((c) => [c.id, c]),
      ),
    }
    expect(committeesFor([CANDIDATES[2]], index).map((c) => c.id)).toEqual([
      '12',
    ])
    expect(otherCommitteesFor([CANDIDATES[2]], index).map((c) => c.id)).toEqual(
      ['10', '13'],
    )
  })
})

const report = (
  id: string,
  kind: IsbeReport['kind'],
  start: string,
  end: string,
  filed: string,
): IsbeReport => ({ id, committeeId: '12', kind, start, end, filed })

describe('latestQuarterly and a1sAfter', () => {
  const reports = [
    report('q1', 'Quarterly', '2026-01-01', '2026-03-31', '2026-04-15'),
    report('q2', 'Quarterly', '2026-04-01', '2026-06-30', '2026-07-14'),
    report('a1', 'A-1', '2026-04-01', '2026-06-30', '2026-05-02'),
    report('a2', 'A-1', '2026-07-01', '2026-09-30', '2026-08-02'),
    report('a3', 'A-1', '2026-10-01', '2026-12-31', '2026-10-03'),
  ]

  it('picks the latest quarter that has ended', () => {
    expect(latestQuarterly(reports, '12', '2026-10-06')?.id).toBe('q2')
    expect(latestQuarterly(reports, '99', '2026-10-06')).toBeUndefined()
  })

  it('finds A-1s for later quarters', () => {
    expect(a1sAfter(reports, '12', '2026-06-30').map((r) => r.id)).toEqual([
      'a2',
      'a3',
    ])
  })
})

describe('largeSince', () => {
  const a1s = [
    report('a2', 'A-1', '2026-07-01', '2026-09-30', '2026-08-02'),
    report('a3', 'A-1', '2026-10-01', '2026-12-31', '2026-10-03'),
  ]

  it('sums every gift without naming anyone', () => {
    expect(
      largeSince('2026-06-30', a1s, {
        totals: new Map([
          ['a2', { amount: 30000, count: 2 }],
          ['a3', { amount: 15000, count: 1 }],
        ]),
      }),
    ).toEqual({
      since: '2026-06-30',
      total: 45000,
      count: 3,
    })
  })

  it('leaves out reports with no contributions', () => {
    const none = { totals: new Map() }
    expect(largeSince('2026-06-30', a1s, none)).toBeUndefined()
  })

  it("counts the candidate's own gifts, in kind too, but not loans", () => {
    expect(
      largeSince('2026-06-30', a1s, {
        totals: new Map([['a2', { amount: 65750000, count: 3 }]]),
        fromCandidate: new Map([
          ['a2', { gifts: 65000000, inKind: 500, loans: 0 }],
          ['a3', { gifts: 0, inKind: 0, loans: 100000 }],
        ]),
      })?.fromCandidate,
    ).toBe(65000500)
  })
})

describe('isCandidateGiver', () => {
  const pritzker = parseBallotName('JB Pritzker & Christian Mitchell')
  const ayala = parseBallotName('Jesus Ayala, Jr.')

  it('matches the candidate however the name was entered', () => {
    expect(isCandidateGiver(pritzker, 'Pritzker', 'JB')).toBe(true)
    expect(isCandidateGiver(pritzker, 'JB Pritzker', '')).toBe(true)
    expect(isCandidateGiver(pritzker, 'Pritzker, JB', '')).toBe(true)
    expect(isCandidateGiver(ayala, 'Ayala Jr.', 'Jesus')).toBe(true)
    expect(isCandidateGiver(ayala, 'Jesus Ayala Jr', '')).toBe(true)
  })

  it('never matches relatives, running mates or organizations', () => {
    expect(isCandidateGiver(pritzker, 'Pritzker', 'MK')).toBe(false)
    expect(isCandidateGiver(pritzker, 'Mitchell', 'Christian')).toBe(false)
    expect(
      isCandidateGiver(parseBallotName('Chris Welch'), 'Welch', 'Christine'),
    ).toBe(false)
    expect(isCandidateGiver(pritzker, 'JB Pritzker Revocable Trust', '')).toBe(
      false,
    )
    expect(isCandidateGiver(pritzker, 'Friends of JB Pritzker', '')).toBe(false)
    expect(isCandidateGiver(pritzker, 'Pritzker', '')).toBe(false)
  })
})

describe('loadReceipts', () => {
  it("sums the candidate's own gifts, in-kind gifts and loans per report", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'isbe-'))
    const header =
      'FiledDocID\tLastOnlyName\tFirstName\tAmount\tD2Part\tArchived'
    const rows = [
      'q\tHenderson\tVictor\t470000\t3A\tFalse',
      'q\tHenderson\tVictor\t1000\t1A\tFalse',
      'q\tHenderson\tVictor\t250\t5A\tFalse',
      'q\tHenderson\tAngela\t1000\t1A\tFalse',
      'q\tHenderson\tVictor\t9999\t1A\tTrue',
      'q\tFriends of Victor Henderson\t\t2000\t2A\tFalse',
      'other\tHenderson\tVictor\t5000\t1A\tFalse',
    ]
    await writeFile(
      join(dir, 'Receipts.txt'),
      [header, ...rows].join('\n') + '\n',
    )
    const sums = await loadReceipts(
      dir,
      new Set(['q', 'other']),
      new Map([['q', parseBallotName('Victor P. Henderson')]]),
    )
    expect(sums.fromCandidate?.get('q')).toEqual({
      gifts: 1000,
      inKind: 250,
      loans: 470000,
    })
    expect(sums.fromCandidate?.has('other')).toBe(false)
    // Loans stay out of the contribution totals; in-kind gifts stay out of `raised`.
    expect(sums.totals.get('q')).toEqual({ amount: 4250, count: 4 })
  })
})

describe('isJudgesRetentionCommittee', () => {
  it('knows the joint retention committee', () => {
    const joint = committee(
      '6505',
      'Committee for Retention of Judges in Cook County',
    )
    expect(isJudgesRetentionCommittee({ ...joint, shared: true })).toBe(true)
    expect(isJudgesRetentionCommittee(joint)).toBe(false)
    expect(
      isJudgesRetentionCommittee({
        ...committee('1', 'Lisle Forward'),
        shared: true,
      }),
    ).toBe(false)
  })
})

describe('isbeSummary', () => {
  const quarter = report(
    'q2',
    'Quarterly',
    '2026-04-01',
    '2026-06-30',
    '2026-07-14',
  )
  const totals = {
    receipts: 50000,
    endFunds: 120000.5,
    individualItemized: 30000,
    individualUnitemized: 10000,
    transfers: 7500,
    loans: 2500,
    other: 0,
  }

  it('reports the quarter and breaks it down by D-2 part', () => {
    expect(
      isbeSummary(committee('12', 'Friends of Josina Morita'), quarter, totals),
    ).toEqual({
      source: 'ISBE',
      committee: 'Friends of Josina Morita',
      url: 'https://www.elections.il.gov/CampaignDisclosure/CommitteeDetail.aspx?ID=12',
      period: 'April 1 to June 30, 2026',
      raised: 50000,
      cashOnHand: 120000.5,
      breakdown: [
        { kind: 'small', amount: 10000 },
        { kind: 'large', amount: 30000 },
        { kind: 'transfer', amount: 7500 },
        { kind: 'loan', amount: 2500 },
      ],
    })
  })

  it("moves the candidate's own gifts and loans to their own row, once", () => {
    const summary = isbeSummary(committee('12', 'Friends'), quarter, totals, {
      gifts: 5000,
      inKind: 999,
      loans: 2000,
    })
    expect(summary.fromCandidate).toBe(7000)
    expect(summary.breakdown).toEqual([
      { kind: 'small', amount: 10000 },
      { kind: 'large', amount: 25000 },
      { kind: 'transfer', amount: 7500 },
      { kind: 'candidate', amount: 7000 },
      { kind: 'loan', amount: 500 },
    ])
  })

  it('has no candidate row or amount without their money', () => {
    const summary = isbeSummary(committee('12', 'Friends'), quarter, totals)
    expect(summary).not.toHaveProperty('fromCandidate')
    expect(summary.breakdown?.map((r) => r.kind)).not.toContain('candidate')
  })

  it("leaves the breakdown out when the parts don't fit the report", () => {
    // More loans from the candidate than the report has loans.
    const odd = isbeSummary(committee('12', 'Friends'), quarter, totals, {
      gifts: 0,
      inKind: 0,
      loans: 3000,
    })
    expect(odd).not.toHaveProperty('breakdown')
    expect(odd.fromCandidate).toBe(3000)
    const mismatched = isbeSummary(committee('12', 'Friends'), quarter, {
      ...totals,
      receipts: 60000,
    })
    expect(mismatched).not.toHaveProperty('breakdown')
  })
})

describe('readTsv', () => {
  it('reads rows by header and skips rows with the wrong number of fields', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'isbe-'))
    const path = join(dir, 'x.txt')
    await writeFile(path, 'ID\tName\r\n1\tA \r\n2\tB\tstray\r\n3\tC\r\n')
    const rows: Record<string, string>[] = []
    expect(await readTsv(path, (r) => rows.push(r))).toEqual({
      rows: 2,
      skipped: 1,
    })
    expect(rows).toEqual([
      { ID: '1', Name: 'A' },
      { ID: '3', Name: 'C' },
    ])
  })
})
