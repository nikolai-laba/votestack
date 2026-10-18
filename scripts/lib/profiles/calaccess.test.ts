import { describe, expect, it } from 'vitest'
import {
  calDate,
  collectCalAccess,
  filedForm,
  lateItem,
  loanItem,
  readCovers,
  readStatements,
  receiptItem,
  sameName,
  smryLine,
  tsvRows,
  type CalAccessBase,
  type Items,
  type Row,
} from './calaccess.ts'
import type { MoneyPerson } from './money-ca.ts'
import { parseBallotName } from './names.ts'

// Small synthetic tables in the export's layout (only the columns read).
// Every name and committee here is made up.

async function rows(header: string[], data: string[][]): Promise<Row[]> {
  const lines = [header.join('\t'), ...data.map((r) => r.join('\t'))]
  const out: Row[] = []
  for await (const r of tsvRows(lines)) out.push(r)
  return out
}

const F501 = [
  'FILING_ID',
  'AMEND_ID',
  'FORM_TYPE',
  'FILER_ID',
  'COMMITTEE_ID',
  'CAND_NAML',
  'CAND_NAMF',
  'MONIKER',
  'OFFICE_CD',
  'DIST_NO',
  'DISTRICT_CD',
  'YR_OF_ELEC',
]
const CVR = [
  'FILING_ID',
  'AMEND_ID',
  'FORM_TYPE',
  'FILER_ID',
  'ENTITY_CD',
  'FILER_NAML',
  'FILER_NAMF',
  'RPT_DATE',
  'FROM_DATE',
  'THRU_DATE',
  'CAND_NAML',
  'CAND_NAMF',
  'OFFICE_CD',
  'OFFIC_DSCR',
  'DIST_NO',
]
const SMRY = ['FILING_ID', 'AMEND_ID', 'LINE_ITEM', 'FORM_TYPE', 'AMOUNT_A']
const RCPT = [
  'FILING_ID',
  'AMEND_ID',
  'FORM_TYPE',
  'ENTITY_CD',
  'CTRIB_NAML',
  'CTRIB_NAMF',
  'AMOUNT',
  'MEMO_CODE',
]
const LOAN = [
  'FILING_ID',
  'AMEND_ID',
  'FORM_TYPE',
  'ENTITY_CD',
  'LNDR_NAML',
  'LNDR_NAMF',
  'LOAN_AMT1',
  'LOAN_AMT5',
  'LOAN_AMT6',
  'MEMO_CODE',
]
const S497 = [
  'FILING_ID',
  'AMEND_ID',
  'FORM_TYPE',
  'ENTITY_CD',
  'ENTY_NAML',
  'ENTY_NAMF',
  'CTRIB_DATE',
  'AMOUNT',
  'MEMO_CODE',
]
const FILINGS = ['FILER_ID', 'FILING_ID', 'FORM_ID', 'FILING_DATE']

const d = (s: string) => `${s} 12:00:00 AM`

const person = (
  key: string,
  name: string,
  officeType: string,
  office: string,
  districtId: string,
): MoneyPerson => ({
  key,
  name,
  ballot: parseBallotName(name),
  office,
  officeType,
  districtId,
  contestIds: [],
})

const PAT = person(
  'pat-example',
  'Pat Example',
  'state_legislature',
  'State Assembly Member, 99th District',
  'ocd-division/country:us/state:ca/sldl:99',
)

async function base(): Promise<CalAccessBase> {
  const statements = await rows(F501, [
    // Pat's 2026 Assembly statement names committee 900001.
    [
      '5001',
      '0',
      'F501',
      '800001',
      '900001',
      'EXAMPLE',
      'PAT',
      '',
      '30013',
      '',
      '17099',
      '2026',
    ],
    // Robin's statement names a committee still reporting for another office.
    [
      '5002',
      '0',
      'F501',
      '800002',
      '900020',
      'SAMPLE',
      'ROBIN',
      '',
      '30014',
      '',
      '',
      '2026',
    ],
    // Lee filed a statement and nothing else.
    [
      '5003',
      '0',
      'F501',
      '800003',
      '',
      'NOBODY',
      'LEE',
      '',
      '30013',
      '',
      '17098',
      '2026',
    ],
    // Kim has a committee that filed only on paper.
    [
      '5004',
      '0',
      'F501',
      '800004',
      '900040',
      'PAPER',
      'KIM',
      '',
      '30012',
      '',
      '17097',
      '2026',
    ],
  ])
  const covers = await rows(CVR, [
    // Pat's report, filed and then amended: the amendment counts.
    [
      '7001',
      '0',
      'F460',
      '900001',
      'CTL',
      'Example for Assembly 2026',
      '',
      d('9/24/2026'),
      d('7/1/2026'),
      d('9/19/2026'),
      'Example',
      'Pat',
      'ASM',
      '',
      '99',
    ],
    [
      '7001',
      '1',
      'F460',
      '900001',
      'CTL',
      'Example for Assembly 2026',
      '',
      d('9/30/2026'),
      d('7/1/2026'),
      d('9/19/2026'),
      'Example',
      'Pat',
      'ASM',
      '',
      '99',
    ],
    // An earlier period.
    [
      '7000',
      '0',
      'F460',
      '900001',
      'CTL',
      'Example for Assembly 2026',
      '',
      d('7/30/2026'),
      d('1/1/2026'),
      d('6/30/2026'),
      'Example',
      'Pat',
      'ASM',
      '',
      '99',
    ],
    // Late reports after the period.
    [
      '7002',
      '0',
      'F497',
      '900001',
      'CTL',
      'Example for Assembly 2026',
      '',
      d('10/2/2026'),
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ],
    // An independent expenditure committee that names Pat.
    [
      '7003',
      '0',
      'F460',
      '900009',
      'RCP',
      'Neighbors Supporting Example for Assembly 2026',
      '',
      d('9/24/2026'),
      d('7/1/2026'),
      d('9/19/2026'),
      'Example',
      'Pat',
      'ASM',
      '',
      '99',
    ],
    // Robin: the committee on the statement reports for the Board of Equalization...
    [
      '7020',
      '0',
      'F460',
      '900020',
      'CTL',
      'Sample for Board of Equalization 2026',
      '',
      d('1/20/2026'),
      d('7/1/2025'),
      d('12/31/2025'),
      'Sample',
      'Robin',
      'BOE',
      '',
      '3',
    ],
    // ...and the Insurance Commissioner committee is another one.
    [
      '7021',
      '0',
      'F460',
      '900021',
      'CTL',
      'Sample for Insurance Commissioner 2026',
      '',
      d('9/24/2026'),
      d('7/1/2026'),
      d('9/19/2026'),
      'Sample',
      'Robin',
      'INS',
      '',
      '',
    ],
    // Two live committees for the same seat.
    [
      '7030',
      '0',
      'F460',
      '900030',
      'CTL',
      'Twin for Senate 2026',
      '',
      d('9/24/2026'),
      d('7/1/2026'),
      d('9/19/2026'),
      'Twin',
      'Alex',
      'SEN',
      '',
      '96',
    ],
    [
      '7031',
      '0',
      'F460',
      '900031',
      'CTL',
      'Alex Twin for Senate 2026',
      '',
      d('9/24/2026'),
      d('7/1/2026'),
      d('9/19/2026'),
      'Twin',
      'Alex',
      'SEN',
      '',
      '96',
    ],
  ])
  return {
    statements: readStatements(
      statements,
      new Map([
        ['17099', '99'],
        ['17098', '98'],
        ['17097', '97'],
      ]),
      2026,
    ),
    covers: readCovers(covers, '2025-01-01'),
  }
}

async function items(): Promise<Items> {
  return {
    smry: (
      await rows(SMRY, [
        // The original filing's figures, replaced by the amendment.
        ['7001', '0', '5', 'F460', '1'],
        ['7001', '1', '1', 'F460', '10450'],
        ['7001', '1', '2', 'F460', '4000'],
        ['7001', '1', '4', 'F460', '500'],
        ['7001', '1', '5', 'F460', '14950'],
        ['7001', '1', '16', 'F460', '20000'],
        ['7001', '1', '2', 'A', '250'],
        ['7001', '1', '2', 'C', '0'],
      ])
    ).map(smryLine),
    receipts: (
      await rows(RCPT, [
        ['7001', '1', 'A', 'IND', 'Donor', 'Casey', '3000', ''],
        ['7001', '1', 'A', 'IND', 'Example', 'Pat', '1000', ''],
        ['7001', '1', 'A', 'COM', 'Made Up PAC', '', '5000', ''],
        ['7001', '1', 'A', 'SCC', 'Small Givers SCC', '', '1200', ''],
        // A memo entry doesn't count.
        ['7001', '1', 'A', 'IND', 'Donor', 'Casey', '999', 'X'],
        ['7001', '1', 'C', 'PTY', 'Some Party', '', '500', ''],
        // Schedule I (other cash) isn't a contribution.
        ['7001', '1', 'I', 'OTH', 'Bank', '', '75', ''],
        // The original filing's items don't count.
        ['7001', '0', 'A', 'IND', 'Donor', 'Casey', '50000', ''],
      ])
    ).map(receiptItem),
    loans: (
      await rows(LOAN, [
        ['7001', '1', 'B1', 'IND', 'Example', 'Pat', '5000', '1000', '0', ''],
      ])
    ).map(loanItem),
    late: (
      await rows(S497, [
        [
          '7002',
          '0',
          'F497P1',
          'IND',
          'Donor',
          'Casey',
          d('9/28/2026'),
          '2000',
          '',
        ],
        [
          '7002',
          '0',
          'F497P1',
          'IND',
          'Example',
          'Pat',
          d('9/29/2026'),
          '1500',
          '',
        ],
        [
          '7002',
          '0',
          'F497P1',
          'RCP',
          'Made Up PAC',
          '',
          d('9/30/2026'),
          '1000',
          '',
        ],
        // Made, not received.
        [
          '7002',
          '0',
          'F497P2',
          'COM',
          'Other Cmte',
          '',
          d('9/30/2026'),
          '700',
          '',
        ],
      ])
    ).map(lateItem),
    filed: (
      await rows(FILINGS, [['900040', '7040', 'F460', d('9/24/2026')]])
    ).map(filedForm),
  }
}

const run = async (people: MoneyPerson[]) => {
  let asked: Set<string> = new Set()
  const result = await collectCalAccess(
    people,
    await base(),
    async (filings) => {
      asked = filings
      return items()
    },
    { year: 2026 },
  )
  return { result, asked }
}

describe('calDate', () => {
  it('reads the export dates', () => {
    expect(calDate('9/4/2026 12:00:00 AM')).toBe('2026-09-04')
    expect(calDate('')).toBe('')
  })
})

describe('sameName', () => {
  const b = parseBallotName
  it('matches as filed and runs a spaced last name together', () => {
    expect(sameName(b('Pat Example'), 'EXAMPLE', 'PAT')).toBe(true)
    expect(sameName(b('David Dejoe'), 'DE JOE', 'DAVID A.')).toBe(true)
  })
  it('matches a middle name the person goes by, or a whole name in the last-name field', () => {
    expect(sameName(b('Marisol Sample'), 'Sample', 'Erin Marisol')).toBe(true)
    expect(sameName(b('Pat Q. Example'), 'Pat Example', '')).toBe(true)
  })
  it("doesn't match someone else", () => {
    expect(sameName(b('Pat Example'), 'Example', 'Robin')).toBe(false)
    expect(sameName(b('Pat Example'), 'Example', '')).toBe(false)
  })
})

describe('collectCalAccess', () => {
  it("summarizes the latest amendment of the candidate's latest Form 460", async () => {
    const { result, asked } = await run([PAT])
    expect(asked).toEqual(new Set(['7001', '7002']))
    const entry = result.byKey['pat-example']
    expect(entry.matchedCommittee).toBe('900001')
    expect(entry.summaries).toEqual([
      {
        source: 'CA',
        filedWith: 'California Secretary of State',
        committee: 'Example for Assembly 2026',
        url: 'https://cal-access.sos.ca.gov/Campaign/Committees/Detail.aspx?id=900001',
        period: 'July 1 to September 19, 2026',
        raised: 14950,
        cashOnHand: 20000,
        // 250 small + 3000 people + 6200 committees + 500 party + 1000 own
        // gift + 4000 net own loan = 14,950.
        breakdown: [
          { kind: 'small', amount: 250 },
          { kind: 'large', amount: 3000 },
          { kind: 'pac', amount: 6200 },
          { kind: 'party', amount: 500 },
          { kind: 'candidate', amount: 5000 },
        ],
        fromCandidate: 5000,
        largeSince: {
          since: '2026-09-19',
          total: 4500,
          count: 3,
          fromCandidate: 1500,
        },
      },
    ])
  })

  it('skips a committee on the statement that reports for another office, and an independent committee', async () => {
    const robin = person(
      'robin-sample',
      'Robin Sample',
      'statewide',
      'California Insurance Commissioner',
      'ocd-division/country:us/state:ca',
    )
    const { result } = await run([robin])
    expect(result.byKey['robin-sample'].matchedCommittee).toBe('900021')
  })

  it('reports two possible committees as unmatched, never picking one', async () => {
    const alex = person(
      'alex-twin',
      'Alex Twin',
      'state_legislature',
      'State Senator, 96th District',
      'ocd-division/country:us/state:ca/sldu:96',
    )
    const { result } = await run([alex])
    expect(result.byKey['alex-twin']).toBeUndefined()
    expect(result.unmatched[0].reason).toContain('900030, 900031')
  })

  it('explains statements with no committee, paper filings and empty retention records', async () => {
    const lee = person(
      'lee-nobody',
      'Lee Nobody',
      'state_legislature',
      'State Assembly Member, 98th District',
      'ocd-division/country:us/state:ca/sldl:98',
    )
    const kim = person(
      'kim-paper',
      'Kim Paper',
      'state_legislature',
      'State Senator, 97th District',
      'ocd-division/country:us/state:ca/sldu:97',
    )
    const justice = person(
      'jo-justice',
      'Jo Justice',
      'retention',
      'Associate Justice, Court of Appeal, Second District, Division Nine',
      'ocd-division/country:us/state:ca/court_of_appeals:2',
    )
    const ghost = person(
      'gus-ghost',
      'Gus Ghost',
      'state_legislature',
      'State Assembly Member, 95th District',
      'ocd-division/country:us/state:ca/sldl:95',
    )
    const { result } = await run([lee, kim, justice, ghost])
    expect(result.byKey['lee-nobody']).toMatchObject({
      summaries: [],
      noCommittee: { filedWith: 'California Secretary of State' },
      filingsAt: {
        url: 'https://cal-access.sos.ca.gov/Campaign/Candidates/Detail.aspx?id=800003',
      },
    })
    expect(result.byKey['kim-paper'].note).toContain('filed September 24, 2026')
    expect(result.byKey['jo-justice']).toEqual({
      summaries: [],
      noCommittee: { filedWith: 'California Secretary of State' },
      note: 'No campaign committee on file with the Secretary of State.',
    })
    expect(result.unmatched.map((u) => u.key)).toEqual(['gus-ghost'])
  })
})
