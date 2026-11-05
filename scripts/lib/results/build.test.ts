import { describe, expect, it } from 'vitest'
import { parseResultsFile } from '../../../src/shared/raceResults.ts'
import type {
  RaceResult,
  ResultsFile,
} from '../../../src/shared/raceResults.ts'
import { resultsOffices } from '../../../src/shared/results.ts'
import { buildResults } from './build.ts'
import type { BuildInputs } from './build.ts'
import { CA_SOS_BASE } from './ca-sos.ts'
import {
  parseApCalls,
  parseApCounts,
  parseCertifications,
  parseMatchFile,
} from './inputs.ts'
import type {
  ApCall,
  ApCount,
  ApCountsFile,
  Certification,
  MatchEntry,
  MatchFile,
} from './inputs.ts'
import { OFFICIAL_URLS } from './types.ts'
import type { OfficialContest, OfficialFile, OfficialSource } from './types.ts'

// Small hand-made inputs. Names are the mockup's samples; contest IDs and
// titles are shaped like the real ones.

const NOW = '2026-11-05T01:30:00.000Z'
const EARLIER = '2026-11-04T09:00:00.000Z'
const RETRIEVED = '2026-11-05T01:00:00.000Z'
const CHICAGO_AS_OF = '2026-11-05T00:40:00.000Z'
const COOK_AS_OF = '2026-11-05T00:45:00.000Z'
const LA_AS_OF = '2026-11-05T00:20:00.000Z'
const SOS_AS_OF = '2026-11-04T16:08:00.000Z'
const SENATE_URL =
  'https://apnews.com/projects/elections-2026/illinois/us-senate/'

function official(
  source: OfficialSource,
  asOf: string,
  contests: OfficialContest[],
): OfficialFile {
  const url =
    source === 'ca-sos'
      ? `${CA_SOS_BASE}us-rep/district/23`
      : OFFICIAL_URLS[source]
  return { source, url, retrievedAt: RETRIEVED, asOf, contests }
}

const both = { 'ALEX RIVERA': 'Alex Rivera', 'KIM PARK': 'Kim Park' }
const plain = { 'Alex Rivera': 'Alex Rivera', 'Kim Park': 'Kim Park' }

/** Countywide: on the Chicago and the suburban ballot. */
const clerk: MatchEntry = {
  contestIds: ['chicago-boe:clerk-of-the-circuit-court', 'cook-clerk:120300'],
  kind: 'candidate',
  scope: 'within',
  official: [
    { source: 'chicago', title: 'Clerk of the Circuit Court' },
    { source: 'cook', title: 'Clerk of the Circuit Court' },
  ],
  names: { ...both, ...plain },
  ballotOrder: ['Kim Park', 'Alex Rivera'],
  voteFor: 1,
  certifyBy: '2026-11-24',
}

const judge: MatchEntry = {
  contestIds: ['chicago-boe:retain-pat-morgan', 'cook-clerk:150100'],
  kind: 'retention',
  scope: 'within',
  official: [
    { source: 'chicago', title: 'Pat Morgan' },
    { source: 'cook', title: 'Pat Morgan' },
  ],
  names: { Yes: 'Yes', No: 'No' },
  ballotOrder: ['Yes', 'No'],
  threshold: 0.6,
  certifyBy: '2026-11-24',
}

/** Crosses county lines: Cook's offices count only part of it. */
const senate: MatchEntry = {
  contestIds: ['chicago-boe:united-states-senator', 'cook-clerk:120100'],
  kind: 'candidate',
  scope: 'beyond',
  official: [
    { source: 'chicago', title: 'Senator, U.S.' },
    { source: 'cook', title: 'United States Senator' },
  ],
  names: { ...both, ...plain },
  ballotOrder: ['Alex Rivera', 'Kim Park'],
  voteFor: 1,
  certifyBy: '2026-12-04',
  apUrl: SENATE_URL,
}

const chicagoFile = official('chicago', CHICAGO_AS_OF, [
  {
    title: 'Clerk of the Circuit Court',
    choices: [
      { name: 'ALEX RIVERA', votes: 1000 },
      { name: 'KIM PARK', votes: 800 },
      { name: 'Write-in', votes: 5 },
    ],
  },
  {
    title: 'Pat Morgan',
    choices: [
      { name: 'Yes', votes: 610 },
      { name: 'No', votes: 390 },
    ],
  },
  {
    title: 'Senator, U.S.',
    choices: [
      { name: 'ALEX RIVERA', votes: 500 },
      { name: 'KIM PARK', votes: 900 },
    ],
  },
])

const cookFile = official('cook', COOK_AS_OF, [
  {
    title: 'Clerk of the Circuit Court',
    voteFor: 1,
    choices: [
      { name: 'Alex Rivera', votes: 300 },
      { name: 'Kim Park', votes: 700 },
      { name: 'Write-In', votes: 2 },
    ],
  },
  {
    title: 'Pat Morgan',
    voteFor: 1,
    choices: [
      { name: 'Yes', votes: 590 },
      { name: 'No', votes: 410 },
    ],
  },
  {
    title: 'United States Senator',
    voteFor: 1,
    choices: [
      { name: 'Alex Rivera', votes: 400 },
      { name: 'Kim Park', votes: 600 },
    ],
  },
])

const cookMatch = (contests: MatchEntry[]): MatchFile => ({
  version: 1,
  electionId: 'il-2026-11-03-general',
  area: 'cook',
  contests,
})

const calls = (list: ApCall[]) => ({
  version: 1 as const,
  checkedAt: '2026-11-05T01:10:00.000Z',
  calls: list,
})
const certs = (list: Certification[]) => ({
  version: 1 as const,
  certifications: list,
})
const read = (
  reader: 'a' | 'b',
  counts: ApCount[],
  checkedAt = reader === 'a'
    ? '2026-11-04T10:00:00.000Z'
    : '2026-11-04T10:20:00.000Z',
): ApCountsFile => ({ version: 1, reader, checkedAt, counts })

const senateCount: ApCount = {
  contestIds: senate.contestIds,
  url: SENATE_URL,
  asOf: '2026-11-04T03:21:00-06:00',
  counted: 0.81,
  choices: [
    { name: 'Kim Park', votes: 1500000 },
    { name: 'Alex Rivera', votes: 2000000 },
  ],
}

const cookInputs = (over: Partial<BuildInputs> = {}): BuildInputs => ({
  match: cookMatch([clerk, judge, senate]),
  official: [chicagoFile, cookFile],
  apCalls: calls([]),
  apCounts: [],
  certifications: certs([]),
  now: NOW,
  ...over,
})

const council: MatchEntry = {
  contestIds: ['la-4348-cc10805'],
  kind: 'candidate',
  scope: 'within',
  official: [
    { source: 'la', title: 'MEMBER OF THE CITY COUNCIL 4th District' },
  ],
  names: both,
  ballotOrder: ['Alex Rivera', 'Kim Park'],
  voteFor: 1,
  certifyBy: '2026-11-27',
}

/** LA marks it "Los Angeles County Results Only". */
const house: MatchEntry = {
  contestIds: ['la-4348-cc10822'],
  kind: 'candidate',
  scope: 'beyond',
  official: [
    { source: 'la', title: 'UNITED STATES REPRESENTATIVE 23rd District' },
    { source: 'ca-sos', title: 'us-rep/district/23' },
  ],
  names: { ...both, ...plain },
  ballotOrder: ['Kim Park', 'Alex Rivera'],
  voteFor: 1,
  certifyBy: '2026-12-11',
}

const laFile = official('la', LA_AS_OF, [
  {
    title: 'MEMBER OF THE CITY COUNCIL 4th District',
    choices: [
      { name: 'ALEX RIVERA', votes: 4200 },
      { name: 'KIM PARK', votes: 3900 },
    ],
  },
  {
    title: 'UNITED STATES REPRESENTATIVE 23rd District',
    countyOnly: true,
    choices: [
      { name: 'ALEX RIVERA', votes: 100 },
      { name: 'KIM PARK', votes: 120 },
    ],
  },
])

const sosFile = official('ca-sos', SOS_AS_OF, [
  {
    title: 'us-rep/district/23',
    choices: [
      { name: 'Alex Rivera', votes: 67169 },
      { name: 'Kim Park', votes: 63681 },
    ],
  },
])

const laInputs = (over: Partial<BuildInputs> = {}): BuildInputs => ({
  match: {
    version: 1,
    electionId: 'ca-2026-11-03-general',
    area: 'ca-la',
    contests: [council, house],
  },
  official: [laFile, sosFile],
  apCalls: calls([]),
  apCounts: [],
  certifications: certs([]),
  now: NOW,
  ...over,
})

const resultFor = (file: ResultsFile, entry: MatchEntry): RaceResult => {
  const r = file.results.find((x) => x.contestIds[0] === entry.contestIds[0])
  if (!r) throw new Error(`no result for ${entry.contestIds[0]}`)
  return r
}

const without = (entry: MatchEntry, key: keyof MatchEntry) => {
  const copy: Partial<MatchEntry> = { ...entry }
  delete copy[key]
  return copy
}

const [CHICAGO_OFFICE, COOK_OFFICE, LA_OFFICE] = resultsOffices([
  'chicago',
  'suburban-cook',
  'los-angeles-county',
])

describe('buildResults: counts', () => {
  it('adds the Chicago and suburban counts of a countywide race per name', () => {
    const r = resultFor(buildResults(cookInputs()), clerk)
    expect(r.choices).toEqual([
      { name: 'Kim Park', votes: 1500 },
      { name: 'Alex Rivera', votes: 1300 },
    ])
  })

  it('drops "Write-in" and "Write-In" rows without error', () => {
    const r = resultFor(buildResults(cookInputs()), clerk)
    expect(r.choices.map((c) => c.name)).toEqual(['Kim Park', 'Alex Rivera'])
    expect(r.choices.reduce((sum, c) => sum + c.votes, 0)).toBe(2800)
  })

  it('throws on an official name that is neither matched nor a write-in', () => {
    const renamed = official('chicago', CHICAGO_AS_OF, [
      {
        title: 'Clerk of the Circuit Court',
        choices: [
          { name: 'ALEX RIVERA', votes: 1000 },
          { name: 'KIM J. PARK', votes: 800 },
        ],
      },
    ])
    expect(() =>
      buildResults(
        cookInputs({
          match: cookMatch([clerk]),
          official: [renamed, cookFile],
        }),
      ),
    ).toThrow(
      /^content\/results-inputs\/cook\/match\.json: chicago-boe:clerk-of-the-circuit-court: chicago contest "Clerk of the Circuit Court" has "KIM J\. PARK"/,
    )
  })

  it('throws when a ballot-order name is missing from one of the contests it sums', () => {
    const three: MatchEntry = {
      ...clerk,
      names: { ...clerk.names, 'SAM ORTIZ': 'Sam Ortiz' },
      ballotOrder: ['Kim Park', 'Alex Rivera', 'Sam Ortiz'],
    }
    const withSam = official('chicago', CHICAGO_AS_OF, [
      {
        ...chicagoFile.contests[0],
        choices: [
          ...chicagoFile.contests[0].choices,
          { name: 'SAM ORTIZ', votes: 0 },
        ],
      },
    ])
    expect(() =>
      buildResults(
        cookInputs({
          match: cookMatch([three]),
          official: [withSam, cookFile],
        }),
      ),
    ).toThrow(
      /^content\/results-inputs\/cook\/match\.json: chicago-boe:clerk-of-the-circuit-court: cook contest "Clerk of the Circuit Court" has no choice for "Sam Ortiz"/,
    )
  })

  it('lists choices in ballot order, with a 0 a contest reports kept', () => {
    const order: MatchEntry = {
      ...clerk,
      ballotOrder: ['Alex Rivera', 'Kim Park'],
    }
    const zero = official('cook', COOK_AS_OF, [
      {
        ...cookFile.contests[0],
        choices: [
          { name: 'Alex Rivera', votes: 0 },
          { name: 'Kim Park', votes: 0 },
        ],
      },
    ])
    const chicagoOnly = official('chicago', CHICAGO_AS_OF, [
      {
        ...chicagoFile.contests[0],
        choices: [
          { name: 'ALEX RIVERA', votes: 0 },
          { name: 'KIM PARK', votes: 800 },
        ],
      },
    ])
    const r = resultFor(
      buildResults(
        cookInputs({
          match: cookMatch([order]),
          official: [chicagoOnly, zero],
        }),
      ),
      clerk,
    )
    expect(r.choices).toEqual([
      { name: 'Alex Rivera', votes: 0 },
      { name: 'Kim Park', votes: 800 },
    ])
  })

  it('takes an LA race that crosses the county line from the Secretary of State, not LA', () => {
    const r = resultFor(buildResults(laInputs()), house)
    expect(r.choices).toEqual([
      { name: 'Kim Park', votes: 63681 },
      { name: 'Alex Rivera', votes: 67169 },
    ])
    expect(r.sources.map((s) => s.name)).toEqual([
      'California Secretary of State',
    ])
  })

  it('gives each source its office name and results page, as-of and retrieved-at times', () => {
    const cook = buildResults(cookInputs())
    expect(resultFor(cook, clerk).sources).toEqual([
      {
        name: 'Chicago Board of Election Commissioners',
        url: CHICAGO_OFFICE.url,
        retrievedAt: RETRIEVED,
        official: true,
        asOf: CHICAGO_AS_OF,
      },
      {
        name: 'Cook County Clerk',
        url: COOK_OFFICE.url,
        retrievedAt: RETRIEVED,
        official: true,
        asOf: COOK_AS_OF,
      },
    ])
    const la = buildResults(laInputs())
    expect(resultFor(la, council).sources).toEqual([
      {
        name: 'Los Angeles County Registrar-Recorder/County Clerk',
        url: LA_OFFICE.url,
        retrievedAt: RETRIEVED,
        official: true,
        asOf: LA_AS_OF,
      },
    ])
    expect(resultFor(la, house).sources).toEqual([
      {
        name: 'California Secretary of State',
        url: 'https://electionresults.sos.ca.gov/',
        retrievedAt: RETRIEVED,
        official: true,
        asOf: SOS_AS_OF,
      },
    ])
  })

  it("takes AP's count for an Illinois race beyond Cook when reads a and b agree", () => {
    const withWriteIns: ApCount = {
      ...senateCount,
      choices: [...senateCount.choices, { name: 'Write-ins', votes: 900 }],
    }
    const r = resultFor(
      buildResults(
        cookInputs({
          apCounts: [read('a', [withWriteIns]), read('b', [withWriteIns])],
        }),
      ),
      senate,
    )
    expect(r.status).toBe('counting')
    expect(r.choices).toEqual([
      { name: 'Alex Rivera', votes: 2000000 },
      { name: 'Kim Park', votes: 1500000 },
    ])
    expect(r.sources).toEqual([
      {
        name: 'AP',
        url: SENATE_URL,
        retrievedAt: '2026-11-04T10:20:00.000Z',
        official: false,
        asOf: '2026-11-04T09:21:00.000Z',
        counted: 0.81,
      },
    ])
  })

  it('shows no count when the two AP reads differ in votes, time or share counted', () => {
    const variants: ApCount[] = [
      {
        ...senateCount,
        choices: [
          { name: 'Kim Park', votes: 1500000 },
          { name: 'Alex Rivera', votes: 2000001 },
        ],
      },
      { ...senateCount, asOf: '2026-11-04T03:22:00-06:00' },
      { ...senateCount, counted: 0.82 },
      { ...senateCount, choices: senateCount.choices.slice(0, 1) },
    ]
    for (const b of variants) {
      const r = resultFor(
        buildResults(
          cookInputs({
            apCounts: [read('a', [senateCount]), read('b', [b])],
          }),
        ),
        senate,
      )
      expect(r.status).toBe('no_count')
      expect(r.choices).toEqual([])
      expect(r.sources).toEqual([])
    }
  })

  it('shows no count when only one AP read has the race, or there are no reads', () => {
    for (const apCounts of [
      [read('a', [senateCount]), read('b', [])],
      [],
    ] as BuildInputs['apCounts'][]) {
      const r = resultFor(buildResults(cookInputs({ apCounts })), senate)
      expect(r.status).toBe('no_count')
      expect(r.choices).toEqual([])
    }
  })

  it('shows no count, with empty choices, for an Illinois race beyond Cook with no AP page', () => {
    const noAp = without(senate, 'apUrl') as MatchEntry
    const r = resultFor(
      buildResults(
        cookInputs({
          match: cookMatch([noAp]),
          apCalls: calls([
            {
              contestIds: senate.contestIds,
              winners: ['Alex Rivera'],
              at: '2026-11-03T20:02:00-06:00',
              url: SENATE_URL,
              status: 'called',
            },
          ]),
        }),
      ),
      senate,
    )
    expect(r.status).toBe('no_count')
    expect(r.choices).toEqual([])
    expect(r.sources).toEqual([])
    expect(r.winners).toBeUndefined()
  })

  it('builds a candidate race nobody filed for as no_count with no choices', () => {
    const empty: MatchEntry = {
      ...clerk,
      official: [],
      names: {},
      ballotOrder: [],
      noOfficialCount: 'No candidates filed.',
    }
    const r = resultFor(
      buildResults(cookInputs({ match: cookMatch([empty]) })),
      empty,
    )
    expect(r.status).toBe('no_count')
    expect(r.choices).toEqual([])
    expect(r.winners).toBeUndefined()
  })

  it('shows no count for a race marked with no official count', () => {
    const none: MatchEntry = {
      ...clerk,
      official: [],
      noOfficialCount: 'Nobody publishes a count for this race.',
    }
    const r = resultFor(
      buildResults(
        cookInputs({
          match: cookMatch([none]),
          certifications: certs([
            {
              source: 'chicago',
              on: '2026-11-17',
              url: 'https://x/c',
              confirmedWinners: true,
            },
            {
              source: 'cook',
              on: '2026-11-24',
              url: 'https://x/k',
              confirmedWinners: true,
            },
          ]),
        }),
      ),
      clerk,
    )
    expect(r.status).toBe('no_count')
    expect(r.choices).toEqual([])
    expect(r.sources).toEqual([])
  })
})

const CHICAGO_CERT: Certification = {
  source: 'chicago',
  on: '2026-11-17',
  url: 'https://chicagoelections.gov/proclamation.pdf',
  confirmedWinners: true,
}
const COOK_CERT: Certification = {
  source: 'cook',
  on: '2026-11-24',
  url: 'https://www.cookcountyclerkil.gov/certified-summary.pdf',
  confirmedWinners: true,
}
const LA_CERT: Certification = {
  source: 'la',
  on: '2026-11-27',
  url: 'https://www.lavote.gov/statement-of-votes.pdf',
  confirmedWinners: true,
}
const SOS_CERT: Certification = {
  source: 'ca-sos',
  on: '2026-12-11',
  url: 'https://www.sos.ca.gov/statement-of-vote.pdf',
  confirmedWinners: true,
}

const call = (entry: MatchEntry, over: Partial<ApCall> = {}): ApCall => ({
  contestIds: entry.contestIds,
  winners: [entry.ballotOrder[0]],
  at: '2026-11-03T21:41:00-06:00',
  url: 'https://apnews.com/projects/elections-2026/illinois/',
  status: 'called',
  ...over,
})

describe('buildResults: status', () => {
  it('certifies a race once every office it uses has certified, with winners from the count', () => {
    const r = resultFor(
      buildResults(
        cookInputs({ certifications: certs([CHICAGO_CERT, COOK_CERT]) }),
      ),
      clerk,
    )
    expect(r.status).toBe('certified')
    expect(r.winners).toEqual(['Kim Park'])
    expect(r.certified).toEqual({ on: COOK_CERT.on, url: COOK_CERT.url })
    expect(r.call).toBeUndefined()
  })

  it("does not certify a countywide race on one office's certification", () => {
    const r = resultFor(
      buildResults(cookInputs({ certifications: certs([CHICAGO_CERT]) })),
      clerk,
    )
    expect(r.status).toBe('counting')
    expect(r.certified).toBeUndefined()
    expect(r.winners).toBeUndefined()
  })

  it('certifies a judge or measure by its threshold', () => {
    const certified = (votes: [number, number], entry: MatchEntry) => {
      const file = official('chicago', CHICAGO_AS_OF, [
        {
          title: 'Pat Morgan',
          choices: [
            { name: 'Yes', votes: votes[0] },
            { name: 'No', votes: votes[1] },
          ],
        },
      ])
      const only = { ...entry, official: [entry.official[0]] }
      return resultFor(
        buildResults(
          cookInputs({
            match: cookMatch([only]),
            official: [file],
            certifications: certs([CHICAGO_CERT]),
          }),
        ),
        entry,
      ).winners
    }
    expect(certified([600, 400], judge)).toEqual(['Yes'])
    expect(certified([5999, 4001], judge)).toEqual(['No'])
    const measure: MatchEntry = { ...judge, kind: 'measure', threshold: 0.5 }
    expect(certified([501, 499], measure)).toEqual(['Yes'])
    expect(certified([500, 500], measure)).toEqual(['No'])
  })

  it('names every candidate tied at the last seat', () => {
    const board: MatchEntry = {
      ...clerk,
      ballotOrder: ['Kim Park', 'Alex Rivera', 'Sam Ortiz', 'Jo Lee'],
      names: {
        'Kim Park': 'Kim Park',
        'Alex Rivera': 'Alex Rivera',
        'Sam Ortiz': 'Sam Ortiz',
        'Jo Lee': 'Jo Lee',
      },
      official: [{ source: 'cook', title: 'Board' }],
      voteFor: 2,
    }
    const file = official('cook', COOK_AS_OF, [
      {
        title: 'Board',
        choices: [
          { name: 'Kim Park', votes: 300 },
          { name: 'Alex Rivera', votes: 500 },
          { name: 'Sam Ortiz', votes: 300 },
          { name: 'Jo Lee', votes: 100 },
        ],
      },
    ])
    const r = resultFor(
      buildResults(
        cookInputs({
          match: cookMatch([board]),
          official: [file],
          certifications: certs([COOK_CERT]),
        }),
      ),
      board,
    )
    expect(r.winners).toEqual(['Kim Park', 'Alex Rivera', 'Sam Ortiz'])
  })

  it('never names a candidate with 0 votes a certified winner', () => {
    const board: MatchEntry = {
      ...clerk,
      ballotOrder: ['Kim Park', 'Alex Rivera', 'Sam Ortiz', 'Jo Lee'],
      names: {
        'Kim Park': 'Kim Park',
        'Alex Rivera': 'Alex Rivera',
        'Sam Ortiz': 'Sam Ortiz',
        'Jo Lee': 'Jo Lee',
      },
      official: [{ source: 'cook', title: 'Board' }],
      voteFor: 3,
    }
    const file = official('cook', COOK_AS_OF, [
      {
        title: 'Board',
        choices: [
          { name: 'Kim Park', votes: 100 },
          { name: 'Alex Rivera', votes: 50 },
          { name: 'Sam Ortiz', votes: 0 },
          { name: 'Jo Lee', votes: 0 },
        ],
      },
    ])
    const r = resultFor(
      buildResults(
        cookInputs({
          match: cookMatch([board]),
          official: [file],
          certifications: certs([COOK_CERT]),
        }),
      ),
      board,
    )
    expect(r.status).toBe('certified')
    expect(r.winners).toEqual(['Kim Park', 'Alex Rivera'])
  })

  it("certifies an LA race across the county line only on the Secretary of State's certification", () => {
    const withLa = buildResults(laInputs({ certifications: certs([LA_CERT]) }))
    expect(resultFor(withLa, council).status).toBe('certified')
    expect(resultFor(withLa, house).status).toBe('counting')
    const withSos = buildResults(
      laInputs({ certifications: certs([LA_CERT, SOS_CERT]) }),
    )
    const r = resultFor(withSos, house)
    expect(r.status).toBe('certified')
    expect(r.certified).toEqual({ on: SOS_CERT.on, url: SOS_CERT.url })
    expect(r.winners).toEqual(['Alex Rivera'])
  })

  it('never certifies an Illinois race beyond Cook in this build, whatever is certified', () => {
    const r = resultFor(
      buildResults(
        cookInputs({
          apCounts: [read('a', [senateCount]), read('b', [senateCount])],
          apCalls: calls([call(senate)]),
          certifications: certs([
            CHICAGO_CERT,
            COOK_CERT,
            {
              source: 'il-sbe',
              on: '2026-12-04',
              url: 'https://www.elections.il.gov/canvass.pdf',
              confirmedWinners: true,
            },
            SOS_CERT,
          ]),
        }),
      ),
      senate,
    )
    expect(r.status).toBe('called')
    expect(r.certified).toBeUndefined()
  })

  it("marks a race AP called as called, with AP's winners and call", () => {
    const r = resultFor(
      buildResults(cookInputs({ apCalls: calls([call(clerk)]) })),
      clerk,
    )
    expect(r.status).toBe('called')
    expect(r.winners).toEqual(['Kim Park'])
    expect(r.call).toEqual({
      by: 'AP',
      at: '2026-11-04T03:41:00.000Z',
      url: 'https://apnews.com/projects/elections-2026/illinois/',
    })
  })

  it('marks a race AP says is too close to call as too_close', () => {
    const r = resultFor(
      buildResults(
        cookInputs({
          apCalls: calls([call(clerk, { status: 'too_close', winners: [] })]),
        }),
      ),
      clerk,
    )
    expect(r.status).toBe('too_close')
    expect(r.winners).toBeUndefined()
    expect(r.call).toBeUndefined()
  })

  it('puts a race back to counting when AP withdraws its call', () => {
    const r = resultFor(
      buildResults(
        cookInputs({
          apCalls: calls([call(clerk, { status: 'withdrawn', winners: [] })]),
        }),
      ),
      clerk,
    )
    expect(r.status).toBe('counting')
    expect(r.winners).toBeUndefined()
    expect(r.call).toBeUndefined()
  })

  it('counts a race with no call and no certification', () => {
    const r = resultFor(buildResults(cookInputs()), clerk)
    expect(r.status).toBe('counting')
    expect(r.winners).toBeUndefined()
  })

  it('prefers a certification to an AP call', () => {
    const r = resultFor(
      buildResults(
        cookInputs({
          apCalls: calls([call(clerk, { winners: ['Alex Rivera'] })]),
          certifications: certs([CHICAGO_CERT, COOK_CERT]),
        }),
      ),
      clerk,
    )
    expect(r.status).toBe('certified')
    expect(r.winners).toEqual(['Kim Park'])
  })

  it('copies kind, voteFor, threshold, certifyBy, scope and contest IDs from the match', () => {
    const file = buildResults(cookInputs())
    const c = resultFor(file, clerk)
    expect([c.kind, c.voteFor, c.threshold, c.certifyBy, c.scope]).toEqual([
      'candidate',
      1,
      undefined,
      '2026-11-24',
      'within',
    ])
    expect(c.contestIds).toEqual(clerk.contestIds)
    const j = resultFor(file, judge)
    expect([j.kind, j.voteFor, j.threshold, j.scope]).toEqual([
      'retention',
      undefined,
      0.6,
      'within',
    ])
    expect(resultFor(file, senate).certifyBy).toBe('2026-12-04')
  })
})

describe('buildResults: the file', () => {
  it('keeps changedAt when status, winners and votes are unchanged', () => {
    const before = buildResults(cookInputs({ now: EARLIER }))
    const later = official(
      'chicago',
      '2026-11-05T01:05:00.000Z',
      chicagoFile.contests,
    )
    const after = buildResults(
      cookInputs({ previous: before, official: [later, cookFile] }),
    )
    expect(after.results.map((r) => r.changedAt)).toEqual(
      after.results.map(() => EARLIER),
    )
    expect(after.checkedAt).toBe(NOW)
  })

  it('moves changedAt to now when votes, status or winners change', () => {
    const before = buildResults(
      cookInputs({ now: EARLIER, apCalls: calls([call(clerk)]) }),
    )
    const more = official('chicago', CHICAGO_AS_OF, [
      {
        ...chicagoFile.contests[0],
        choices: [
          { name: 'ALEX RIVERA', votes: 1001 },
          { name: 'KIM PARK', votes: 800 },
        ],
      },
      ...chicagoFile.contests.slice(1),
    ])
    const changed = (over: Partial<BuildInputs>) =>
      resultFor(
        buildResults(
          cookInputs({
            previous: before,
            apCalls: calls([call(clerk)]),
            ...over,
          }),
        ),
        clerk,
      ).changedAt
    expect(changed({})).toBe(EARLIER)
    expect(changed({ official: [more, cookFile] })).toBe(NOW)
    expect(changed({ apCalls: calls([]) })).toBe(NOW)
    expect(
      changed({ apCalls: calls([call(clerk, { winners: ['Alex Rivera'] })]) }),
    ).toBe(NOW)
    expect(resultFor(buildResults(cookInputs()), clerk).changedAt).toBe(NOW)
  })

  it('sorts results by first contest ID and writes a file parseResultsFile accepts', () => {
    const file = buildResults(
      cookInputs({
        match: cookMatch([senate, judge, clerk]),
        apCounts: [read('a', [senateCount]), read('b', [senateCount])],
        apCalls: calls([call(senate)]),
        certifications: certs([CHICAGO_CERT, COOK_CERT]),
      }),
    )
    expect(file.version).toBe(1)
    expect(file.electionId).toBe('il-2026-11-03-general')
    expect(file.checkedAt).toBe(NOW)
    expect(file.results.map((r) => r.contestIds[0])).toEqual([
      'chicago-boe:clerk-of-the-circuit-court',
      'chicago-boe:retain-pat-morgan',
      'chicago-boe:united-states-senator',
    ])
    expect(file.results.map((r) => r.status)).toEqual([
      'certified',
      'certified',
      'called',
    ])
    expect(parseResultsFile(JSON.parse(JSON.stringify(file)))).toEqual(file)
    const la = buildResults(laInputs())
    expect(la.electionId).toBe('ca-2026-11-03-general')
    expect(() => parseResultsFile(JSON.parse(JSON.stringify(la)))).not.toThrow()
  })
})

describe('buildResults: inputs it refuses', () => {
  it('throws when a matched official contest is missing from the downloads', () => {
    const renamed = official('cook', COOK_AS_OF, cookFile.contests.slice(1))
    expect(() =>
      buildResults(cookInputs({ official: [chicagoFile, renamed] })),
    ).toThrow(
      /chicago-boe:clerk-of-the-circuit-court.*cook.*Clerk of the Circuit Court/,
    )
    expect(() => buildResults(cookInputs({ official: [chicagoFile] }))).toThrow(
      /chicago-boe:clerk-of-the-circuit-court/,
    )
  })

  it('throws when two downloaded contests share a matched title', () => {
    const twice = official('cook', COOK_AS_OF, [
      ...cookFile.contests,
      cookFile.contests[0],
    ])
    expect(() =>
      buildResults(cookInputs({ official: [chicagoFile, twice] })),
    ).toThrow(
      /^chicago-boe:clerk-of-the-circuit-court: 2 cook contests are titled "Clerk of the Circuit Court"$/,
    )
  })

  it('throws when write-ins reach the votes of the last named candidate in a winning place', () => {
    // Kim Park leads with 1,500 (800 + 700); Chicago's 5 write-ins and the
    // Clerk's add up, since one write-in candidate can be on both ballots.
    const withWriteIns = (votes: number) =>
      official('cook', COOK_AS_OF, [
        {
          ...cookFile.contests[0],
          choices: [
            { name: 'Alex Rivera', votes: 300 },
            { name: 'Kim Park', votes: 700 },
            { name: 'Write-In', votes },
          ],
        },
      ])
    const build = (votes: number) => () =>
      buildResults(
        cookInputs({
          match: cookMatch([clerk]),
          official: [chicagoFile, withWriteIns(votes)],
        }),
      )
    expect(build(1495)).toThrow(
      /^content\/results-inputs\/cook\/match\.json: chicago-boe:clerk-of-the-circuit-court: write-ins have 1500 votes, at least Kim Park's 1500 in the last winning place; a write-in may have won/,
    )
    expect(build(1494)).not.toThrow()
  })

  it('throws on any write-in votes when fewer candidates are named than there are seats', () => {
    const board: MatchEntry = {
      ...clerk,
      official: [{ source: 'cook', title: 'Board' }],
      voteFor: 3,
    }
    const file = (writeIns: number) =>
      official('cook', COOK_AS_OF, [
        {
          title: 'Board',
          choices: [
            { name: 'Kim Park', votes: 300 },
            { name: 'Alex Rivera', votes: 500 },
            { name: 'Write-in', votes: writeIns },
          ],
        },
      ])
    const build = (writeIns: number) => () =>
      buildResults(
        cookInputs({ match: cookMatch([board]), official: [file(writeIns)] }),
      )
    expect(build(1)).toThrow(
      /chicago-boe:clerk-of-the-circuit-court: write-ins have 1 vote, with 2 candidates named for 3 seats; a write-in may have won/,
    )
    expect(build(0)).not.toThrow()
  })

  it("throws when write-ins in AP's agreed count reach the leader's votes", () => {
    const leaderWriteIns: ApCount = {
      ...senateCount,
      choices: [...senateCount.choices, { name: 'Write-ins', votes: 2000000 }],
    }
    expect(() =>
      buildResults(
        cookInputs({
          apCounts: [read('a', [leaderWriteIns]), read('b', [leaderWriteIns])],
        }),
      ),
    ).toThrow(
      /chicago-boe:united-states-senator: AP count: write-ins have 2000000 votes, at least Alex Rivera's 2000000/,
    )
  })

  it('throws when an official contest lists the same name twice', () => {
    for (const name of ['KIM PARK', 'Write-in']) {
      const twice = official('chicago', CHICAGO_AS_OF, [
        {
          ...chicagoFile.contests[0],
          choices: [...chicagoFile.contests[0].choices, { name, votes: 1 }],
        },
      ])
      expect(() =>
        buildResults(
          cookInputs({
            match: cookMatch([clerk]),
            official: [twice, cookFile],
          }),
        ),
      ).toThrow(
        new RegExp(
          `^content/results-inputs/cook/match\\.json: chicago-boe:clerk-of-the-circuit-court: chicago contest "Clerk of the Circuit Court" lists "${name}" twice$`,
        ),
      )
    }
  })

  it('throws when an LA contest marked county-only feeds a race marked within', () => {
    const wrong: MatchEntry = {
      ...council,
      contestIds: ['la-4348-cc10900'],
      official: [house.official[0]],
    }
    expect(() =>
      buildResults(
        laInputs({ match: { ...laInputs().match, contests: [wrong] } }),
      ),
    ).toThrow(/la-4348-cc10900.*Results Only/)
  })

  it('throws unless the two AP reads come from readers a and b', () => {
    expect(() =>
      buildResults(
        cookInputs({
          apCounts: [read('a', [senateCount]), read('a', [senateCount])],
        }),
      ),
    ).toThrow(/reader a and one from reader b/)
  })

  it('throws on an AP call or count for a race not in the match file', () => {
    const stray = ['cook-clerk:999999']
    expect(() =>
      buildResults(
        cookInputs({ apCalls: calls([call(clerk, { contestIds: stray })]) }),
      ),
    ).toThrow(/AP calls.*cook-clerk:999999/)
    expect(() =>
      buildResults(
        cookInputs({
          apCounts: [
            read('a', [senateCount, { ...senateCount, contestIds: stray }]),
            read('b', [senateCount]),
          ],
        }),
      ),
    ).toThrow(/AP counts.*cook-clerk:999999/)
  })

  it("throws on an AP count for a race that doesn't take AP counts", () => {
    const clerkCount = { ...senateCount, contestIds: clerk.contestIds }
    expect(() =>
      buildResults(
        cookInputs({
          apCounts: [read('a', [clerkCount]), read('b', [clerkCount])],
        }),
      ),
    ).toThrow(
      /^AP counts \(reader a\): chicago-boe:clerk-of-the-circuit-court doesn't take AP's count/,
    )
  })

  it('throws on an agreed AP count with a name that is not on our ballot', () => {
    const typo: ApCount = {
      ...senateCount,
      choices: [
        { name: 'Kim Parks', votes: 1500000 },
        { name: 'Alex Rivera', votes: 2000000 },
      ],
    }
    expect(() =>
      buildResults(
        cookInputs({ apCounts: [read('a', [typo]), read('b', [typo])] }),
      ),
    ).toThrow(
      /^content\/results-inputs\/cook\/match\.json: chicago-boe:united-states-senator: AP count has "Kim Parks"/,
    )
  })

  it('throws on an agreed AP count missing a ballot-order name', () => {
    const short: ApCount = {
      ...senateCount,
      choices: [{ name: 'Alex Rivera', votes: 2000000 }],
    }
    expect(() =>
      buildResults(
        cookInputs({ apCounts: [read('a', [short]), read('b', [short])] }),
      ),
    ).toThrow(
      /^content\/results-inputs\/cook\/match\.json: chicago-boe:united-states-senator: AP count has no choice for "Kim Park"/,
    )
  })

  it("throws on AP call winners that don't fit the race", () => {
    const measure: MatchEntry = { ...judge, kind: 'measure', threshold: 0.5 }
    const two: MatchEntry = { ...clerk, voteFor: 2 }
    const cases: [MatchEntry, Partial<ApCall>, RegExp][] = [
      [judge, { winners: ['YES'] }, /\["YES"\] must be \["Yes"\] or \["No"\]/],
      [measure, { winners: ['Yes', 'No'] }, /must be \["Yes"\] or \["No"\]/],
      [clerk, { winners: [] }, /a called race needs its winners/],
      [two, { winners: ['Kim Park', 'Kim Park'] }, /names "Kim Park" twice/],
      [
        clerk,
        { winners: ['Kim Parks'] },
        /include "Kim Parks", who is not in ballotOrder/,
      ],
      [clerk, { winners: ['Kim Park', 'Alex Rivera'] }, /2 winners for 1 seat/],
      [clerk, { status: 'too_close' }, /a too_close call has no winners/],
      [clerk, { status: 'withdrawn' }, /a withdrawn call has no winners/],
    ]
    for (const [entry, over, message] of cases) {
      const go = () =>
        buildResults(
          cookInputs({
            match: cookMatch([entry]),
            apCalls: calls([call(entry, over)]),
          }),
        )
      expect(go).toThrow(/^content\/results-inputs\/cook\/ap-calls\.json: /)
      expect(go).toThrow(new RegExp(`${entry.contestIds[0]}: AP's winners`))
      expect(go).toThrow(message)
    }
    const yes = buildResults(
      cookInputs({
        match: cookMatch([judge, two]),
        apCalls: calls([
          call(judge, { winners: ['No'] }),
          call(two, { winners: ['Kim Park', 'Alex Rivera'] }),
        ]),
      }),
    )
    expect(yes.results.map((r) => r.winners)).toEqual([
      ['Kim Park', 'Alex Rivera'],
      ['No'],
    ])
  })

  it('throws when the previous results file is for another election', () => {
    const previous = {
      ...buildResults(cookInputs({ now: EARLIER })),
      electionId: 'il-2027-02-23-primary',
    }
    expect(() => buildResults(cookInputs({ previous }))).toThrow(
      /il-2027-02-23-primary/,
    )
  })
})

const roundTrip = <T>(v: T): unknown => JSON.parse(JSON.stringify(v))

describe('parseMatchFile', () => {
  const good = cookMatch([clerk, judge, senate])
  const bad = (contest: object) => () =>
    parseMatchFile({ ...good, contests: [clerk, contest] })

  it('returns a good file as it is', () => {
    expect(parseMatchFile(roundTrip(good))).toEqual(good)
    expect(parseMatchFile(roundTrip(laInputs().match))).toEqual(
      laInputs().match,
    )
  })

  it('names the file and field of a bad shape', () => {
    expect(() => parseMatchFile({ ...good, version: 2 })).toThrow(
      /^Match file: version/,
    )
    expect(() => parseMatchFile({ ...good, area: 'nyc' })).toThrow(
      /^Match file: area/,
    )
    expect(bad({ ...judge, kind: 'judge' })).toThrow(
      /^Match file: contests\[1\]\.kind/,
    )
    expect(bad({ ...judge, scope: 'county' })).toThrow(/contests\[1\]\.scope/)
    expect(bad({ ...judge, contestIds: [] })).toThrow(
      /contests\[1\]\.contestIds/,
    )
    expect(bad({ ...judge, certifyBy: 'November 24' })).toThrow(
      /contests\[1\]\.certifyBy/,
    )
    for (const impossible of ['2026-13-24', '2026-02-30']) {
      expect(bad({ ...judge, certifyBy: impossible })).toThrow(
        /^Match file: contests\[1\]\.certifyBy must be a date like 2026-11-24$/,
      )
    }
    expect(
      bad({ ...judge, official: [{ source: 'ca-sos', title: 'x' }] }),
    ).toThrow(/contests\[1\]\.official\[0\]\.source/)
    expect(
      bad({ ...judge, official: [judge.official[0], judge.official[0]] }),
    ).toThrow(/contests\[1\]\.official\[1\]/)
  })

  it('rejects a name mapped to a choice that is not in ballot order', () => {
    expect(bad({ ...senate, names: { 'KIM PARK': 'Kim Parks' } })).toThrow(
      /contests\[1\]\.names\["KIM PARK"\]/,
    )
  })

  it('needs voteFor on candidates, a threshold and Yes, No on judges and measures', () => {
    expect(bad(without(senate, 'voteFor'))).toThrow(/contests\[1\]\.voteFor/)
    expect(bad({ ...senate, voteFor: 0 })).toThrow(/contests\[1\]\.voteFor/)
    expect(bad(without(judge, 'threshold'))).toThrow(/contests\[1\]\.threshold/)
    expect(bad({ ...judge, threshold: 60 })).toThrow(/contests\[1\]\.threshold/)
    expect(bad({ ...judge, ballotOrder: ['No', 'Yes'] })).toThrow(
      /contests\[1\]\.ballotOrder/,
    )
    expect(bad({ ...senate, ballotOrder: ['Kim Park', 'Kim Park'] })).toThrow(
      /contests\[1\]\.ballotOrder/,
    )
  })

  it('rejects a contest ID matched in two entries', () => {
    expect(bad({ ...judge, contestIds: ['cook-clerk:120300'] })).toThrow(
      /contests\[1\]\.contestIds.*cook-clerk:120300/,
    )
  })

  it('needs an official count, or a reason there is none, for a race the offices count whole', () => {
    expect(bad({ ...judge, official: [] })).toThrow(/contests\[1\]\.official/)
    expect(
      bad({ ...judge, official: [], noOfficialCount: 'Not counted.' }),
    ).not.toThrow()
    expect(bad({ ...senate, official: [] })).not.toThrow()
  })

  it('allows an empty ballotOrder only for a candidate race with noOfficialCount', () => {
    const none = {
      ...clerk,
      contestIds: ['cook-clerk:999999'],
      official: [],
      names: {},
      ballotOrder: [],
      noOfficialCount: 'No candidates filed.',
    }
    expect(bad(none)).not.toThrow()
    expect(bad({ ...none, noOfficialCount: undefined })).toThrow(/ballotOrder/)
    expect(
      bad({
        ...judge,
        official: [],
        names: {},
        ballotOrder: [],
        noOfficialCount: 'x',
      }),
    ).toThrow(/ballotOrder/)
  })

  it("accepts AP's page only on apnews.com", () => {
    expect(
      bad({ ...senate, apUrl: 'https://apnews.com.example.org/senate' }),
    ).toThrow(
      /^Match file: contests\[1\]\.apUrl must link to AP or an election office/,
    )
  })

  it("needs the Secretary of State's count for an LA race that crosses the county line", () => {
    const laClerk = { ...council, contestIds: ['la-4348-cc10001'] }
    const go = (contest: Record<string, unknown>) => () =>
      parseMatchFile({
        ...laInputs().match,
        contests: [laClerk, contest],
      })
    expect(go({ ...house, official: [house.official[0]] })).toThrow(
      /contests\[1\]\.official.*ca-sos/,
    )
    expect(
      go({ ...house, official: [house.official[0]], noOfficialCount: 'x' }),
    ).not.toThrow()
  })
})

describe('parseApCalls', () => {
  const good = calls([
    call(clerk),
    call(senate, { status: 'too_close', winners: [] }),
  ])

  it('returns a good file as it is', () => {
    expect(parseApCalls(roundTrip(good))).toEqual(good)
  })

  it('names the file and field of a bad shape', () => {
    const bad = (c: object) => () =>
      parseApCalls({ ...good, calls: [call(judge), c] })
    expect(() => parseApCalls({ ...good, checkedAt: 'today' })).toThrow(
      /^AP calls file: checkedAt/,
    )
    expect(bad({ ...call(clerk), status: 'projected' })).toThrow(
      /^AP calls file: calls\[1\]\.status/,
    )
    expect(bad({ ...call(clerk), winners: [] })).toThrow(/calls\[1\]\.winners/)
    expect(bad({ ...call(clerk), status: 'too_close' })).toThrow(
      /^AP calls file: calls\[1\]\.winners must be empty for a too_close call/,
    )
    expect(bad({ ...call(clerk), status: 'withdrawn' })).toThrow(
      /^AP calls file: calls\[1\]\.winners must be empty for a withdrawn call/,
    )
    expect(bad({ ...call(clerk), winners: ['Kim Park', 'Kim Park'] })).toThrow(
      /^AP calls file: calls\[1\]\.winners repeats "Kim Park"/,
    )
    expect(bad({ ...call(clerk), at: '2026-11-03T21:41:00' })).toThrow(
      /calls\[1\]\.at/,
    )
    expect(bad({ ...call(clerk), url: '' })).toThrow(/calls\[1\]\.url/)
    expect(bad(call(judge))).toThrow(/calls\[1\]\.contestIds/)
  })

  it('accepts call links only on known hosts', () => {
    const at = (url: string) => () =>
      parseApCalls({ ...good, calls: [call(clerk, { url })] })
    for (const url of [
      'https://example.org/call',
      'https://www.apnews.com/x',
      'https://notapnews.com/x',
      'javascript:alert(1)',
      'not a link',
    ]) {
      expect(at(url)).toThrow(
        /^AP calls file: calls\[0\]\.url must link to AP or an election office/,
      )
    }
    expect(at('https://apnews.com/projects/elections-2026/')).not.toThrow()
  })
})

describe('parseApCounts', () => {
  const good = read('b', [senateCount])

  it('returns a good file as it is', () => {
    expect(parseApCounts(roundTrip(good))).toEqual(good)
  })

  it('names the file and field of a bad shape', () => {
    const bad = (c: object) => () => parseApCounts({ ...good, counts: [c] })
    expect(() => parseApCounts({ ...good, reader: 'c' })).toThrow(
      /^AP counts file: reader/,
    )
    expect(bad({ ...senateCount, counted: 81 })).toThrow(
      /^AP counts file: counts\[0\]\.counted/,
    )
    expect(bad({ ...senateCount, asOf: 'Nov 4' })).toThrow(/counts\[0\]\.asOf/)
    expect(
      bad({ ...senateCount, choices: [{ name: 'Kim Park', votes: 1.5 }] }),
    ).toThrow(/counts\[0\]\.choices\[0\]\.votes/)
    expect(
      bad({
        ...senateCount,
        choices: [
          { name: 'Kim Park', votes: 1 },
          { name: 'Kim Park', votes: 2 },
        ],
      }),
    ).toThrow(/counts\[0\]\.choices\[1\]\.name/)
    expect(() =>
      parseApCounts({ ...good, counts: [senateCount, senateCount] }),
    ).toThrow(/counts\[1\]\.contestIds/)
  })
})

describe('parseCertifications', () => {
  const good = certs([CHICAGO_CERT, COOK_CERT])

  it('returns a good file as it is', () => {
    expect(parseCertifications(roundTrip(good))).toEqual(good)
  })

  it('names the file and field of a bad shape', () => {
    const bad = (c: object) => () =>
      parseCertifications({ ...good, certifications: [CHICAGO_CERT, c] })
    expect(bad({ ...COOK_CERT, confirmedWinners: false })).toThrow(
      /^Certifications file: certifications\[1\]\.confirmedWinners/,
    )
    expect(bad({ ...COOK_CERT, source: 'suburban-cook' })).toThrow(
      /certifications\[1\]\.source/,
    )
    expect(bad({ ...COOK_CERT, on: '11/24/2026' })).toThrow(
      /certifications\[1\]\.on/,
    )
    expect(bad({ ...COOK_CERT, on: '2026-13-24' })).toThrow(
      /^Certifications file: certifications\[1\]\.on must be a date/,
    )
    expect(bad(CHICAGO_CERT)).toThrow(/certifications\[1\]\.source.*chicago/)
  })

  it("accepts certification links only on the offices' own sites", () => {
    const at = (url: string) => () =>
      parseCertifications(certs([{ ...COOK_CERT, url }]))
    for (const url of [
      'https://cookcountyclerkil.gov.example.org/certified.pdf',
      'https://evil-lavote.gov/sov.pdf',
      'https://elections.il.gov.example.org/canvass.pdf',
    ]) {
      expect(at(url)).toThrow(
        /^Certifications file: certifications\[0\]\.url must link to AP or an election office/,
      )
    }
    for (const url of [
      'https://chicagoelections.gov/proclamation.pdf',
      'https://app.chicagoelections.gov/proclamation.pdf',
      'https://www.cookcountyclerkil.gov/certified-summary.pdf',
      'https://www.lavote.gov/sov.pdf',
      'https://www.sos.ca.gov/sov.pdf',
      'https://elections.il.gov/canvass.pdf',
    ]) {
      expect(at(url)).not.toThrow()
    }
  })
})
