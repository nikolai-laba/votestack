import { describe, expect, it } from 'vitest'
import type { Contest } from '../shared/ballot.ts'
import { LOS_ANGELES } from '../shared/regions.ts'
import {
  groupContests,
  hasPaperOrder,
  paperSections,
  sectionFor,
  sectionsFor,
} from './sections.ts'

const IL = 'ocd-division/country:us/state:il'
const COOK = `${IL}/county:cook`
const CA = 'ocd-division/country:us/state:ca'
const LA = `${CA}/county:los_angeles`

function candidate(
  title: string,
  districtId: string,
  ballotOrder = 0,
): Contest {
  return {
    kind: 'candidate',
    id: title,
    electionId: 'e',
    districtId,
    authorityId: COOK,
    title,
    office: title,
    voteFor: 1,
    candidates: [],
    ballotOrder,
    sources: [],
    lastVerified: '2026-10-04',
  }
}

describe('sectionFor', () => {
  it.each([
    ['Senator, U.S.', IL, 'federal'],
    ['United States Senator', IL, 'federal'],
    ['U.S. Representative, 7th District', `${IL}/cd:7`, 'federal'],
    ['Governor & Lieutenant Governor', IL, 'state'],
    ['State Senator, 3rd District', `${IL}/sldu:3`, 'state'],
    ['Board President, Cook County', COOK, 'county'],
    [
      'Commissioner, Metropolitan Water Reclamation District',
      `${IL}/sewer:mwrd`,
      'county',
    ],
    [
      'Commissioner, 2nd County Board District',
      `${COOK}/council_district:2`,
      'county',
    ],
    [
      'Judge, Illinois Appellate Court, 1st District',
      `${IL}/court_of_appeals:1`,
      'judges',
    ],
    [
      'Judge, 5th Subcircuit (Vacancy of Smith)',
      `${COOK}/judicial_subcircuit:5`,
      'judges',
    ],
    [
      'President of the Chicago Board of Education',
      `${IL}/place:chicago`,
      'local',
    ],
    ['Trustee, Village of Oak Park', `${IL}/place:oak_park`, 'local'],
    // Los Angeles County
    ['United States Representative, 34th District', `${CA}/cd:34`, 'federal'],
    ['Governor', CA, 'state'],
    ['Member of the State Assembly, 51st District', `${CA}/sldl:51`, 'state'],
    [
      'Member, State Board of Equalization, 3rd District',
      `${CA}/boe_district:3`,
      'state',
    ],
    ['Sheriff', LA, 'county'],
    ['Supervisor, 3rd District', `${LA}/council_district:3`, 'county'],
    ['Judge of the Superior Court, Office No. 12', LA, 'judges'],
    ['Mayor, City of Pasadena', `${CA}/place:pasadena`, 'local'],
    [
      'Member, City Council, District 5',
      `${CA}/place:los_angeles/council_district:5`,
      'local',
    ],
    [
      'Member, Board of Education, Trustee Area 2',
      `${LA}/school_district:los_angeles_unified/trustee_area:2`,
      'local',
    ],
    [
      'Member, Board of Trustees',
      `${LA}/community_college_district:los_angeles`,
      'local',
    ],
    [
      'Director, Division 4',
      `${LA}/special_district:central_basin_municipal_water_district/division:4`,
      'local',
    ],
  ])('puts %s in %s', (title, districtId, section) => {
    expect(sectionFor(candidate(title, districtId))).toBe(section)
  })

  it('puts retention and referenda in their own sections', () => {
    const base = candidate('x', COOK)
    expect(
      sectionFor({ ...base, kind: 'retention', judge: 'A', office: 'Judge' }),
    ).toBe('retention')
    expect(sectionFor({ ...base, kind: 'measure', question: '?' })).toBe(
      'measures',
    )
  })
})

describe('groupContests', () => {
  it('orders sections by level and contests by ballot order', () => {
    const measure: Contest = {
      ...candidate('Millionaire Tax', COOK, 1804),
      kind: 'measure',
      question: '?',
    }
    const sections = groupContests([
      measure,
      candidate('State Senator', `${IL}/sldu:3`, 170202),
      candidate('Governor', IL, 150100),
      candidate('Senator, U.S.', IL, 120100),
    ])
    expect(sections.map((s) => s.id)).toEqual(['federal', 'state', 'measures'])
    expect(sections[1].contests.map((c) => c.title)).toEqual([
      'Governor',
      'State Senator',
    ])
  })
})

describe('paper order', () => {
  const measure = (title: string, paperOrder?: number): Contest => ({
    ...candidate(title, COOK, 1804),
    kind: 'measure',
    question: '?',
    paperOrder,
  })
  const judge = (name: string, paperOrder?: number): Contest => ({
    ...candidate(name, COOK, 720001),
    kind: 'retention',
    judge: name,
    office: 'Judge',
    paperOrder,
  })
  const race = (title: string, districtId: string, paperOrder?: number) => ({
    ...candidate(title, districtId),
    paperOrder,
  })
  const contests = [
    judge('Ann Lee', 30),
    measure('Millionaire Tax', 20),
    race(
      'Judge, 18th Subcircuit (Andreou)',
      `${COOK}/judicial_subcircuit:18`,
      4,
    ),
    race('State Senator', `${IL}/sldu:3`, 3),
    race('Senator, U.S.', IL, 1),
    race('Commissioner, MWRD', `${IL}/sewer:mwrd`, 2),
    judge('Bo Diaz', 31),
  ]

  it('keeps the paper parts in paper order, with their contests in paper order', () => {
    const sections = paperSections(contests)
    expect(sections.map((s) => s.title)).toEqual([
      'Races',
      'Referenda and questions',
      'Judicial retention',
    ])
    expect(sections[0].contests.map((c) => c.title)).toEqual([
      'Senator, U.S.',
      'Commissioner, MWRD',
      'State Senator',
      'Judge, 18th Subcircuit (Andreou)',
    ])
    expect(sections[2].contests.map((c) => c.id)).toEqual([
      'Ann Lee',
      'Bo Diaz',
    ])
  })

  it('falls back to sections by level when a contest has no paper position', () => {
    expect(hasPaperOrder(contests)).toBe(true)
    expect(sectionsFor(contests, 'paper')[0].id).toBe('races')
    expect(sectionsFor(contests, 'level')[0].id).toBe('federal')
    const old = [...contests, race('Governor', IL)]
    expect(hasPaperOrder(old)).toBe(false)
    expect(sectionsFor(old, 'paper')[0].id).toBe('federal')
    expect(hasPaperOrder([])).toBe(false)
  })
})

describe('paperSections on an interleaved ballot (Los Angeles County)', () => {
  const words = LOS_ANGELES.measureWords
  const at = (contest: Contest, paperOrder: number): Contest => ({
    ...contest,
    paperOrder,
  })
  const measure = (title: string, districtId: string, paperOrder: number) =>
    at(
      {
        kind: 'measure',
        id: title,
        electionId: 'e',
        districtId,
        authorityId: LA,
        title,
        question: '?',
        sources: [],
        lastVerified: '2026-10-16',
      },
      paperOrder,
    )
  const contests: Contest[] = [
    measure('Proposition 1', CA, 40),
    at(candidate('Governor', CA), 30),
    measure('County Measure A', LA, 20),
    at(candidate('Sheriff', LA), 10),
    at(candidate('Judge of the Superior Court', LA), 11),
    measure('Measure TE', `${CA}/place:los_angeles`, 2),
    measure('Measure SC', `${CA}/place:los_angeles/contest_area:x`, 3),
    at(candidate('Member of the City Council', `${CA}/place:los_angeles`), 1),
    measure('Proposition 2', CA, 41),
    {
      kind: 'retention',
      id: 'Ann Lee',
      electionId: 'e',
      districtId: CA,
      authorityId: LA,
      title: 'Ann Lee',
      judge: 'Ann Lee',
      office: 'Associate Justice',
      paperOrder: 50,
      sources: [],
      lastVerified: '2026-10-16',
    },
  ]

  it('makes a section of each run, titled by its level, with unique ids', () => {
    const sections = paperSections(contests, words)
    expect(sections.map((s) => [s.id, s.title])).toEqual([
      ['races', 'City and local'],
      ['measures', 'City and local measures'],
      ['races-2', 'Races'],
      ['measures-2', 'County measures'],
      ['races-3', 'State'],
      ['measures-3', 'State propositions'],
      ['retention', 'Judicial retention'],
    ])
    expect(sections[1].contests.map((c) => c.id)).toEqual([
      'Measure TE',
      'Measure SC',
    ])
    expect(sections[5].contests.map((c) => c.id)).toEqual([
      'Proposition 1',
      'Proposition 2',
    ])
  })

  it('uses the region’s words for its measures', () => {
    expect(
      groupContests(contests, LOS_ANGELES).find((s) => s.id === 'measures')
        ?.title,
    ).toBe('Propositions and measures')
    const one = contests.filter(
      (c) => c.kind !== 'measure' || c.id === 'Proposition 1',
    )
    expect(paperSections(one, words).map((s) => s.title)).toContain(
      'Propositions and measures',
    )
  })
})

describe('groupContests for Los Angeles County', () => {
  const measure = (title: string, districtId: string, ballotOrder: number) =>
    ({
      ...candidate(title, districtId, ballotOrder),
      kind: 'measure',
      question: '?',
    }) as Contest

  it('orders offices by California law within a level, not local-first ballot order', () => {
    const sections = groupContests(
      [
        candidate(
          'Member of the State Assembly, 34th District',
          `${CA}/sldl:34`,
          188,
        ),
        candidate(
          'United States Representative, 23rd District',
          `${CA}/cd:23`,
          199,
        ),
        candidate('State Senator, 20th District', `${CA}/sldu:20`, 256),
        candidate('Superintendent of Public Instruction', CA, 375),
        candidate('Lieutenant Governor', CA, 368),
        candidate('Governor', CA, 367),
        candidate(
          'Member State Board of Equalization, 3rd District',
          `${CA}/boe_district:3`,
          374,
        ),
        candidate('Sheriff', LA, 100),
        candidate('Assessor', LA, 90),
      ],
      LOS_ANGELES,
    )
    const titles = (id: string) =>
      sections.find((s) => s.id === id)?.contests.map((c) => c.title)
    expect(titles('state')).toEqual([
      'Governor',
      'Lieutenant Governor',
      'Member State Board of Equalization, 3rd District',
      'State Senator, 20th District',
      'Member of the State Assembly, 34th District',
      'Superintendent of Public Instruction',
    ])
    // Offices outside the list keep ballot order.
    expect(titles('county')).toEqual(['Assessor', 'Sheriff'])
  })

  it('groups measures by level, state first, by number or letter', () => {
    const [section] = groupContests(
      [
        measure(
          'Los Angeles City General Municipal Election - Measure TE',
          `${CA}/place:los_angeles`,
          325,
        ),
        measure(
          'City of Burbank General Municipal Election - Measure C',
          `${CA}/place:burbank`,
          338,
        ),
        measure(
          'Los Angeles City General Municipal Election - Measure FD',
          `${CA}/place:los_angeles`,
          348,
        ),
        measure('County Measure E', LA, 366),
        measure('County Measure A', LA, 365),
        measure('Proposition 45: Modifies Environmental Review', CA, 389),
        measure("Proposition 2: Increases State's Rainy Day Fund", CA, 377),
        measure('Proposition 10: Example', CA, 360),
        measure('Proposition 1: Authorizes Bonds', CA, 376),
      ],
      LOS_ANGELES,
    )
    expect(section.title).toBe('Propositions and measures')
    expect(section.groups?.map((g) => [g.id, g.title])).toEqual([
      ['state', 'State propositions'],
      ['county', 'County measures'],
      ['local', 'City and local measures'],
    ])
    expect(section.groups?.map((g) => g.contests.map((c) => c.id))).toEqual([
      [
        'Proposition 1: Authorizes Bonds',
        "Proposition 2: Increases State's Rainy Day Fund",
        'Proposition 10: Example',
        'Proposition 45: Modifies Environmental Review',
      ],
      ['County Measure A', 'County Measure E'],
      [
        'City of Burbank General Municipal Election - Measure C',
        'Los Angeles City General Municipal Election - Measure FD',
        'Los Angeles City General Municipal Election - Measure TE',
      ],
    ])
    expect(section.contests).toEqual(section.groups?.flatMap((g) => g.contests))
  })
})

describe('groupContests for Cook County referenda', () => {
  const referendum = (title: string, districtId: string, ballotOrder: number) =>
    ({
      ...candidate(title, districtId, ballotOrder),
      kind: 'measure',
      question: '?',
    }) as Contest

  it('groups county and city referenda, each in official order', () => {
    const [section] = groupContests([
      referendum('Village of Niles, Term Limits', `${IL}/place:niles`, 1984),
      referendum(
        'Village of Niles, Indoor-Outdoor Theater',
        `${IL}/place:niles`,
        1974,
      ),
      referendum('Cook County, Millionaire Tax Amendment', COOK, 1804),
    ])
    expect(section.title).toBe('Referenda and questions')
    expect(
      section.groups?.map((g) => [g.title, g.contests.map((c) => c.title)]),
    ).toEqual([
      ['County referenda', ['Cook County, Millionaire Tax Amendment']],
      [
        'City and local referenda',
        [
          'Village of Niles, Indoor-Outdoor Theater',
          'Village of Niles, Term Limits',
        ],
      ],
    ])
  })

  it('keeps a one-level section without groups', () => {
    const [section] = groupContests([
      referendum('Village of Niles, Term Limits', `${IL}/place:niles`, 1984),
      referendum('Village of Alsip, Term Limits', `${IL}/place:alsip`, 1814),
    ])
    expect(section.groups).toBeUndefined()
    expect(section.contests.map((c) => c.title)).toEqual([
      'Village of Alsip, Term Limits',
      'Village of Niles, Term Limits',
    ])
  })
})
