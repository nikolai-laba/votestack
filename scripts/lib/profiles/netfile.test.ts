import { describe, expect, it } from 'vitest'
import { generalElectionDay } from './money-netfile-module.ts'
import {
  agencyFor,
  filerPage,
  filersNamedFor,
  latestFilings,
  matchSeatCandidates,
  sameOffice,
  type NfFiling,
  type NfSeat,
} from './netfile.ts'
import { parseBallotName } from './names.ts'

// Made-up seats, candidates and committees.
const LA = 'ocd-division/country:us/state:ca/county:los_angeles'

describe('agencyFor', () => {
  it('sends county and district races to LA County, except those filing elsewhere', () => {
    expect(
      agencyFor({ officeType: 'county_executive', districtId: LA })?.aid,
    ).toBe('LACO')
    expect(
      agencyFor({
        officeType: 'school_board',
        districtId: `${LA}/school_district:abc_unified/trustee_area:2`,
      })?.aid,
    ).toBe('LACO')
    expect(
      agencyFor({
        officeType: 'school_board',
        districtId: `${LA}/school_district:santa_monica_malibu_unified`,
      }),
    ).toEqual({ aid: 'CSM', filedWith: 'City of Santa Monica' })
    expect(
      agencyFor({
        officeType: 'special_district',
        districtId: `${LA}/special_district:wrightwood_community_services_district`,
      })?.aid,
    ).toBe('SBD')
  })

  it('sends city races to the city’s NetFile agency, and nothing else', () => {
    expect(
      agencyFor({
        officeType: 'city_council',
        districtId: 'ocd-division/country:us/state:ca/place:west_hollywood',
      }),
    ).toEqual({ aid: 'WEHO', filedWith: 'City of West Hollywood' })
    expect(
      agencyFor({
        officeType: 'city_council',
        districtId: 'ocd-division/country:us/state:ca/place:burbank',
      }),
    ).toBeNull()
    expect(
      agencyFor({ officeType: 'us_house', districtId: `${LA}/cd:30` }),
    ).toBeNull()
  })
})

const seat = (
  id: string,
  caption: string,
  candidates: [string, string | null][],
): NfSeat => ({
  id,
  caption,
  candidates: candidates.map(([fullName, committeeId], i) => ({
    id: `${id}-${i}`,
    fullName,
    committeeId,
  })),
})

const seats = [
  seat('1', 'Harbor Water District - Member, Board of Directors, Division 1', [
    ['Ridgeway, Dana', '901'],
    ['Lopez, Chris', '902'],
  ]),
  seat('2', 'Lakeview Unified School District - Governing Board Member', [
    ['Lopez, Chris', '903'],
    ['Vale, Morgan', null],
  ]),
]

describe('matchSeatCandidates', () => {
  it('matches by name, and by office when the name is on several seats', () => {
    const one = matchSeatCandidates(
      {
        ballot: parseBallotName('Dana Q. Ridgeway'),
        office: 'Harbor Water District, Member, Board of Directors, Division 1',
      },
      seats,
    )
    expect(one.map((m) => m.candidate.committeeId)).toEqual(['901'])
    const lopez = matchSeatCandidates(
      {
        ballot: parseBallotName('Chris Lopez'),
        office: 'Lakeview Unified School District, Governing Board Member',
      },
      seats,
    )
    expect(lopez.map((m) => m.candidate.committeeId)).toEqual(['903'])
    expect(
      matchSeatCandidates(
        {
          ballot: parseBallotName('Chris Lopez'),
          office: 'Lakeview Water District, Member',
        },
        seats,
      ),
    ).toHaveLength(2)
    expect(
      matchSeatCandidates(
        {
          ballot: parseBallotName('Chris Lopez'),
          office: 'Hillside Library District, Trustee',
        },
        seats,
      ),
    ).toHaveLength(0)
  })

  it('compares office titles without punctuation, notes or folded letters', () => {
    expect(
      sameOffice(
        'La Cañada Unified School District - Governing Board Member',
        'La Ca Ada Unified School District, Governing Board Member',
      ),
    ).toBe(true)
    expect(
      sameOffice('Lakeview USD - Member (Short Term)', 'Lakeview USD, Member'),
    ).toBe(true)
    expect(sameOffice('Lakeview USD - Member', 'Hillside USD, Member')).toBe(
      false,
    )
  })
})

const filing = (over: Partial<NfFiling>): NfFiling => ({
  id: '1',
  formName: 'FPPC 460',
  filerName: 'Ridgeway for Harbor Water Board 2026',
  filingDate: '2026-09-24T10:00:00+00:00',
  periodStart: '2026-07-01T00:00:00+00:00',
  periodEnd: '2026-09-19T00:00:00+00:00',
  ...over,
})

describe('filersNamedFor', () => {
  const person = {
    ballot: parseBallotName('Dana Q. Ridgeway'),
    office: 'Harbor Water District, Member, Board of Directors, Division 1',
  }
  it('finds committees with the name and year, and the candidate’s own filer', () => {
    const found = filersNamedFor(person, 2026, [
      filing({ filerName: 'Dana Ridgeway for Water Board 2026' }),
      filing({ filerName: 'Ridgeway for Harbor Water District 2026' }),
      filing({ filerName: 'Ridgeway, Dana' }),
      // Not the year, not the office, not the person.
      filing({ filerName: 'Dana Ridgeway for Water Board 2022' }),
      filing({ filerName: 'Ridgeway for City Council 2026' }),
      filing({ filerName: 'Dana Ridgeway for Supervisor 2026' }),
      filing({ filerName: 'Sam Ridgeway for Harbor Water Board 2026' }),
      filing({ filerName: 'Ridgeway, Danielle' }),
    ])
    expect(found).toEqual({
      committees: [
        'Dana Ridgeway for Water Board 2026',
        'Ridgeway for Harbor Water District 2026',
      ],
      self: ['Ridgeway, Dana'],
    })
  })
})

describe('latestFilings', () => {
  it('takes the latest period’s latest 460 and the original 497s filed after it', () => {
    const { f460, f497, f470 } = latestFilings([
      filing({
        id: 'q2',
        periodStart: '2026-01-01T00:00:00+00:00',
        periodEnd: '2026-06-30T00:00:00+00:00',
        filingDate: '2026-07-30T00:00:00+00:00',
      }),
      filing({ id: 'q3' }),
      filing({
        id: 'q3a',
        formName: 'FPPC 460 (Amendment)',
        filingDate: '2026-10-01T00:00:00+00:00',
      }),
      filing({
        id: 'late-before',
        formName: 'FPPC Form 497',
        filingDate: '2026-09-10T00:00:00+00:00',
      }),
      filing({
        id: 'late',
        formName: 'FPPC Form 497',
        filingDate: '2026-10-05T00:00:00+00:00',
      }),
      filing({
        id: 'late-amended',
        formName: 'FPPC Form 497 (Amendment)',
        filingDate: '2026-10-06T00:00:00+00:00',
      }),
      filing({ id: 's', formName: 'FPPC 470', periodEnd: null }),
    ])
    expect(f460?.id).toBe('q3a')
    expect(f497.map((f) => f.id)).toEqual(['late'])
    expect(f470.map((f) => f.id)).toEqual(['s'])
  })
})

describe('links and dates', () => {
  it('links to the committee’s page on the portal', () => {
    expect(filerPage('LACO', '901', 'Ridgeway for Water, 2026')).toBe(
      'https://netfile.com/public/LACO/campaign/filingsByFiler/901-Ridgeway%20for%20Water%2C%202026',
    )
  })

  it('finds the general election day', () => {
    expect(generalElectionDay(2026)).toBe('2026-11-03')
    expect(generalElectionDay(2028)).toBe('2028-11-07')
    expect(generalElectionDay(2022)).toBe('2022-11-08')
  })
})
