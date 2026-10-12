import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  CandidateContest,
  Contest,
  RetentionContest,
} from '../../../src/shared/ballot.ts'
import {
  buildSubjects,
  groupByRace,
  ordinal,
  raceKeyFor,
  readableOffice,
  type SubjectsFile,
} from './subjects.ts'

const base = {
  electionId: 'il-2026-11-03-general',
  authorityId: 'ocd-division/country:us/state:il/county:cook',
  sources: [],
  lastVerified: '2026-10-01',
}

function race(
  id: string,
  districtId: string,
  office: string,
  names: [string, string?][],
  over: Partial<CandidateContest> = {},
): CandidateContest {
  return {
    ...base,
    id,
    kind: 'candidate',
    districtId,
    title: office,
    office,
    voteFor: 1,
    candidates: names.map(([name, party]) => ({ name, party })),
    ...over,
  }
}

const retention = (id: string, judge: string): RetentionContest => ({
  ...base,
  id,
  kind: 'retention',
  districtId: 'ocd-division/country:us/state:il/county:cook',
  title: 'Retention: Judge, Circuit Court',
  office: 'Judge, Cook County Judicial Circuit',
  judge,
})

const IL = 'ocd-division/country:us/state:il'

const clerk: Contest[] = [
  race(`cook-clerk:120100`, IL, 'Senator, U.S.', [
    ['Juliana Stratton', 'Democratic'],
    ['Don Tracy', 'Republican'],
  ]),
  race(`cook-clerk:190100`, `${IL}/sewer:mwrd`, 'Commissioner', [
    ['Precious Brady-Davis', 'Democratic'],
  ]),
  race(
    'cook-clerk:190200:unexpired-term',
    `${IL}/sewer:mwrd`,
    'Commissioner',
    [['Cameron "Cam" Davis', 'Democratic']],
    {
      title:
        'Commissioner, Metropolitan Water Reclamation District (Unexpired Term)',
      vacancy: 'Unexpired Term',
    },
  ),
  race(
    'cook-clerk:230100',
    `${IL}/county:cook/board_of_review_district:1`,
    'Commissioner',
    [['George A. Cardenas', 'Democratic']],
    { title: 'Commissioner, Board of Review 1st District' },
  ),
  race(`cook-clerk:210300`, `${IL}/county:cook`, 'Sheriff', [
    ['Thomas J. Dart', 'Democratic'],
  ]),
  race(
    'cook-clerk:340110:vacancy-of-balanoff',
    `${IL}/county:cook/judicial_subcircuit:1`,
    'Judge',
    [['Radiance Ward', 'Democratic']],
    { vacancy: 'Vacancy of Balanoff' },
  ),
  retention('cook-clerk:720001:lewis-nixon', 'Lewis Nixon'),
]

const boe: Contest[] = [
  race('chicago-boe:united-states-senator', IL, 'United States Senator', [
    ['Juliana Stratton', 'Democratic'],
    ['Don Tracy', 'Republican'],
  ]),
  race(
    'chicago-boe:mwrd-unexpired-2-year-term',
    `${IL}/sewer:mwrd`,
    'Metropolitan Water Reclamation District Commissioners Unexpired 2-Year Term',
    [['Cameron "Cam" Davis', 'Democratic']],
  ),
  race(
    'chicago-boe:board-of-review-1st-district',
    `${IL}/county:cook/board_of_review_district:1`,
    'Board of Review, 1st District',
    [['George A. Cardenas', 'Democratic']],
  ),
  race(
    'chicago-boe:member-5a',
    `${IL}/place:chicago/school_board_district:5a`,
    'Member of the Chicago Board of Education, Subdistrict 5A',
    [
      ['Aaron "Jitu" Brown', 'Nonpartisan'],
      ['LaPamela Williams', 'Nonpartisan'],
    ],
  ),
  race(
    'chicago-boe:judge-1st-subcircuit-vacancy-of-balanoff',
    `${IL}/county:cook/judicial_subcircuit:1`,
    'Judge, 1st Subcircuit',
    [['Radiance Ward', 'Democratic']],
    { vacancy: 'Vacancy of Balanoff' },
  ),
  retention('chicago-boe:retention:lewis-nixon', 'Lewis Nixon'),
]

describe('buildSubjects', () => {
  const { subjects, races } = buildSubjects([clerk, boe])
  const get = (key: string) => subjects.find((s) => s.key === key)

  it('lists each person once across both lists', () => {
    expect(subjects.map((s) => s.key).sort()).toEqual([
      'aaron-jitu-brown',
      'cameron-cam-davis',
      'don-tracy',
      'george-a-cardenas',
      'juliana-stratton',
      'lapamela-williams',
      'lewis-nixon',
      'precious-brady-davis',
      'radiance-ward',
      'thomas-j-dart',
    ])
    expect(get('juliana-stratton')?.contestIds).toEqual([
      'chicago-boe:united-states-senator',
      'cook-clerk:120100',
    ])
  })

  it('names the office as voters say it and drops nonpartisan labels', () => {
    expect(get('juliana-stratton')?.office).toBe('U.S. Senator')
    expect(get('aaron-jitu-brown')?.party).toBeUndefined()
    expect(get('lewis-nixon')?.office).toBe('Circuit Court Judge, Cook County')
    expect(get('radiance-ward')?.office).toBe(
      'Circuit Court Judge, 1st Subcircuit (Vacancy of Balanoff)',
    )
    // The Board's title gives the unexpired term's length.
    expect(get('cameron-cam-davis')?.office).toBe(
      'Metropolitan Water Reclamation District Commissioner (unexpired 2-year term)',
    )
    expect(
      races.find((r) => r.keys.includes('george-a-cardenas'))?.office,
    ).toBe('Board of Review Commissioner, 1st District')
  })

  it('sets tiers and kinds by office', () => {
    const tiers = Object.fromEntries(
      subjects.map((s) => [s.key, [s.tier, s.kind, s.officeType]]),
    )
    expect(tiers['juliana-stratton']).toEqual(['top', 'candidate', 'us_senate'])
    expect(tiers['thomas-j-dart']).toEqual([
      'top',
      'candidate',
      'county_executive',
    ])
    expect(tiers['george-a-cardenas']).toEqual([
      'mid',
      'candidate',
      'board_of_review',
    ])
    expect(tiers['precious-brady-davis']).toEqual([
      'mid',
      'candidate',
      'water_reclamation',
    ])
    expect(tiers['aaron-jitu-brown']).toEqual([
      'mid',
      'candidate',
      'school_board',
    ])
    expect(tiers['radiance-ward']).toEqual([
      'short',
      'judicial_candidate',
      'judicial_candidate',
    ])
    expect(tiers['lewis-nixon']).toEqual(['short', 'retention', 'retention'])
  })

  it('groups opponents in one race and keeps the two water district terms apart', () => {
    expect(get('juliana-stratton')?.raceKey).toBe(get('don-tracy')?.raceKey)
    expect(get('precious-brady-davis')?.raceKey).not.toBe(
      get('cameron-cam-davis')?.raceKey,
    )
    expect(get('cameron-cam-davis')?.contestIds).toHaveLength(2)
    expect(get('george-a-cardenas')?.contestIds).toHaveLength(2)
    expect(get('lewis-nixon')?.raceKey).toBe('retention:lewis-nixon')
    expect(races.find((r) => r.keys.includes('don-tracy'))?.keys).toEqual([
      'don-tracy',
      'juliana-stratton',
    ])
  })

  it('fails loudly when one key is in two races', () => {
    const clash = race('x:1', `${IL}/sldl:5`, 'State Representative', [
      ['Don Tracy', 'Republican'],
    ])
    expect(() => buildSubjects([clerk, [clash]])).toThrow(
      /don-tracy is in two races/,
    )
  })

  it('keeps one profile for a confirmed person in a contest and a retention vote', () => {
    const both = [
      ...clerk,
      retention('cook-clerk:720001:radiance-ward', 'Radiance Ward'),
    ]
    const { subjects: list } = buildSubjects([both], new Set(['radiance-ward']))
    const ward = list.find((s) => s.key === 'radiance-ward')
    expect(ward?.raceKey).toBe(
      raceKeyFor(clerk.find((c) => c.id.includes('balanoff')) as Contest),
    )
    expect(ward?.alsoIn).toEqual(['retention:radiance-ward'])
    expect(ward?.kind).toBe('judicial_candidate')
    expect(groupByRace(list).get('retention:radiance-ward')).toHaveLength(1)
  })
})

describe('readableOffice', () => {
  // Real titles from the Clerk's and the Board's 2026 general election lists.
  const office = (
    districtId: string,
    clerkTitle: string,
    boardTitle?: string,
    over: Partial<CandidateContest> = {},
  ) =>
    readableOffice([
      race('cook-clerk:1', districtId, clerkTitle, [], {
        title: clerkTitle,
        ...over,
      }),
      ...(boardTitle
        ? [race('chicago-boe:1', districtId, boardTitle, [], over)]
        : []),
    ])
  const COOK = `${IL}/county:cook`

  it.each([
    [IL, 'Senator, U.S.', 'United States Senator', 'U.S. Senator'],
    [
      `${IL}/cd:7`,
      'U.S. Representative, 7th Congressional District',
      'U.S. Representative, 7th District',
      'U.S. Representative, 7th District',
    ],
    [
      `${IL}/sldl:17`,
      'State Representative, 17th Representative District',
      'State Representative, 17th District',
      'State Representative, 17th District',
    ],
    [
      `${IL}/sldu:2`,
      'State Senator, 2nd Senate District',
      'State Senator, 2nd District',
      'State Senator, 2nd District',
    ],
    [
      IL,
      'Governor and Lieutenant Governor, State of Illinois',
      'Governor & Lieutenant Governor',
      'Illinois Governor and Lieutenant Governor',
    ],
    [
      IL,
      'Attorney General, State of Illinois',
      'Attorney General',
      'Illinois Attorney General',
    ],
    [IL, 'Treasurer, State of Illinois', 'Treasurer', 'Illinois Treasurer'],
    [
      COOK,
      'Board President, Cook County',
      'President of County Board',
      'Cook County Board President',
    ],
    [
      COOK,
      'Treasurer, Cook County',
      'County Treasurer',
      'Cook County Treasurer',
    ],
    [COOK, 'Assessor, Cook County', 'County Assessor', 'Cook County Assessor'],
    [
      `${COOK}/council_district:1`,
      'Commissioner, 1st County Board District',
      'County Commissioner, 1st District',
      'Cook County Commissioner, 1st District',
    ],
    [
      `${COOK}/board_of_review_district:1`,
      'Commissioner, Board of Review 1st District',
      'Board of Review, 1st District',
      'Board of Review Commissioner, 1st District',
    ],
    [
      `${IL}/sewer:mwrd`,
      'Commissioner, Metropolitan Water Reclamation District',
      'Metropolitan Water Reclamation District Commissioners Full 6-Year Term',
      'Metropolitan Water Reclamation District Commissioner',
    ],
    [
      `${IL}/place:chicago/school_board_district:10a`,
      undefined,
      'Member of the Chicago Board of Education, Subdistrict 10A',
      'Chicago Board of Education Member, Subdistrict 10A',
    ],
    [
      `${IL}/place:chicago`,
      undefined,
      'President of the Chicago Board of Education',
      'Chicago Board of Education President',
    ],
    [
      `${IL}/county:dupage/regional_office_of_education`,
      'Superintendent, DuPage County Regional Office of Education',
      undefined,
      'Regional Superintendent of Schools, DuPage County',
    ],
    [
      `${COOK}/tax_district:08-0160-000`,
      'Trustee, La Grange Highlands Sanitary District',
      undefined,
      'La Grange Highlands Sanitary District Trustee',
    ],
  ])('%s: %s', (districtId, clerkTitle, boardTitle, expected) => {
    const titles = [clerkTitle, boardTitle].filter(
      (t): t is string => t !== undefined,
    )
    expect(office(districtId, titles[0], titles[1])).toBe(expected)
  })

  it('names judges by court and keeps the vacancy word for word', () => {
    expect(
      office(
        COOK,
        'Judge, Cook County Judicial Circuit (Vacancy of Burke)',
        'Judge of the Circuit Court (Vacancy of Burke)',
        { vacancy: 'Vacancy of Burke' },
      ),
    ).toBe('Circuit Court Judge, Cook County (Vacancy of Burke)')
    expect(
      office(
        `${COOK}/judicial_subcircuit:16`,
        'Judge, 16th Cook County Subcircuit (Converted from Associate Judgeship of Baird)',
        'Judge, 16th Subcircuit (Converted from Associate Judgeship of Baird)',
        { vacancy: 'Converted from Associate Judgeship of Baird' },
      ),
    ).toBe(
      'Circuit Court Judge, 16th Subcircuit (Converted from Associate Judgeship of Baird)',
    )
    expect(
      office(
        `${IL}/court_of_appeals:1`,
        'Judge, Illinois Appellate Court, 1st District (Vacancy of Hoffman)',
        'Judge of the Appellate Court (Vacancy of Hoffman)',
        { vacancy: 'Vacancy of Hoffman' },
      ),
    ).toBe('Appellate Court Judge, 1st District (Vacancy of Hoffman)')
    expect(
      readableOffice([
        {
          ...retention('cook-clerk:720001:x', 'X'),
          districtId: `${IL}/court_of_appeals:1`,
          office: 'Judge, Illinois Appellate Court, 1st District',
        },
      ]),
    ).toBe('Appellate Court Judge, 1st District')
  })

  it('writes ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 111].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '111th',
    ])
  })

  // Every real subject, when `npm run profiles:subjects` has been run.
  const path = join(
    import.meta.dirname,
    '../../../data/build/profiles/subjects.json',
  )
  it.skipIf(!existsSync(path))(
    'gives every real subject a readable office',
    () => {
      const file = JSON.parse(readFileSync(path, 'utf8')) as SubjectsFile
      for (const { office } of file.subjects) {
        // No all-caps words (the site never shows all caps); "U.S." is the one acronym.
        const shouted = office
          .split(/[\s,()]+/)
          .filter((w) => /[A-Z].*[A-Z]/.test(w) && !/[a-z\d]/.test(w))
        expect(shouted.filter((w) => w !== 'U.S.')).toEqual([])
        // No inverted official titles ("Commissioner, Board of Review").
        expect(office).not.toMatch(
          /^(Commissioner|Judge|Senator|Trustee|Superintendent|Member|President|Treasurer|Assessor|Clerk|Sheriff),/,
        )
        expect(office).not.toMatch(/State of Illinois|Judicial Circuit/)
      }
    },
  )
})
