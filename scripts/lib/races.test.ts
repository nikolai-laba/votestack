import { describe, expect, it } from 'vitest'
import type { Contest } from '../../src/shared/ballot.ts'
import { buildRaces, raceTitle } from './races.ts'

const IL = 'ocd-division/country:us/state:il'
const CHICAGO = `${IL}/place:chicago`
const COOK = `${IL}/county:cook`
const base = {
  electionId: 'il-2026-11-03-general',
  sources: [],
  lastVerified: '2026-10-12',
}
const DATE = '2026-11-03'

function race(
  id: string,
  authority: 'chicago' | 'cook',
  fields: Partial<Contest> & { title: string; districtId: string },
): Contest {
  return {
    ...base,
    id,
    kind: 'candidate',
    authorityId: authority === 'chicago' ? CHICAGO : COOK,
    office: fields.title,
    voteFor: 1,
    candidates: [],
    ...fields,
  } as Contest
}

describe('raceTitle', () => {
  it('brings the Clerk’s titles to the Board’s style', () => {
    const t = (title: string) =>
      raceTitle(race('x', 'cook', { title, districtId: IL }) as never)
    expect(t('State Senator, 3rd Senate District')).toBe(
      'State Senator, 3rd District',
    )
    expect(t('Commissioner, 5th County Board District')).toBe(
      'County Commissioner, 5th District',
    )
    expect(t('Judge, 3rd Cook County Subcircuit (Vacancy of Sherlock)')).toBe(
      'Judge, 3rd Subcircuit (Vacancy of Sherlock)',
    )
    expect(t('Attorney General, State of Illinois')).toBe('Attorney General')
    expect(t('Retention: Judge, Circuit Court')).toBe('Judge, Circuit Court')
  })
})

describe('buildRaces', () => {
  const sldl1 = `${IL}/sldl:1`
  const candidates = [
    { name: 'Jane Doe', party: 'Democratic', ballotOrder: 1 },
    { name: 'Rick Roe', party: 'Republican', ballotOrder: 2 },
  ]

  it('lists a race on both ballots once, with both contest ids', () => {
    const races = buildRaces(
      [
        race('cook-clerk:180100', 'cook', {
          title: 'State Representative, 1st Representative District',
          districtId: sldl1,
          candidates,
        }),
        race('chicago-boe:sr-1', 'chicago', {
          title: 'State Representative, 1st District',
          districtId: sldl1,
          candidates: [...candidates].reverse(),
        }),
      ],
      DATE,
    )
    expect(races).toHaveLength(1)
    expect(races[0]).toMatchObject({
      path: 'il/2026-11-03/state-representative-1st-district',
      title: 'State Representative, 1st District',
      contestIds: ['cook-clerk:180100', 'chicago-boe:sr-1'],
      ballots: ['chicago', 'suburban-cook'],
      level: 'state',
    })
    // The Clerk's ballot order.
    expect(races[0].candidates?.map((c) => c.name)).toEqual([
      'Jane Doe',
      'Rick Roe',
    ])
  })

  it('keeps statewide offices apart by their candidates', () => {
    const races = buildRaces(
      [
        race('a', 'cook', { title: 'Comptroller', districtId: IL, candidates }),
        race('b', 'cook', {
          title: 'Treasurer',
          districtId: IL,
          candidates: [{ name: 'Sam Poe' }],
        }),
      ],
      DATE,
    )
    expect(races.map((r) => r.path)).toEqual([
      'il/2026-11-03/comptroller',
      'il/2026-11-03/treasurer',
    ])
  })

  it('puts county races under the county and judges by name', () => {
    const races = buildRaces(
      [
        race('c', 'cook', {
          title: 'Commissioner, 5th County Board District',
          districtId: `${COOK}/council_district:5`,
          candidates,
        }),
        {
          ...base,
          id: 'r',
          kind: 'retention',
          authorityId: COOK,
          districtId: COOK,
          title: 'Retention: Judge, Circuit Court',
          office: 'Judge, Circuit Court',
          judge: 'Lewis Nixon',
        },
      ],
      DATE,
    )
    expect(races.map((r) => r.path)).toEqual([
      'il/cook-county/2026-11-03/county-commissioner-5th-district',
      'il/cook-county/2026-11-03/retention-lewis-nixon',
    ])
  })

  it('numbers seats that share a title, and keeps earlier addresses', () => {
    const seats = [
      race('s1', 'cook', {
        title: 'Trustee, Sanitary District',
        districtId: `${COOK}/tax_district:08-0160-000`,
        candidates: [{ name: 'Connie Livingston' }],
      }),
      race('s2', 'cook', {
        title: 'Trustee, Sanitary District',
        districtId: `${COOK}/tax_district:08-0160-000`,
      }),
    ]
    const first = buildRaces(seats, DATE)
    expect(first.map((r) => r.path.split('/').at(-1))).toEqual([
      'trustee-sanitary-district',
      'trustee-sanitary-district-seat-2',
    ])
    const kept = buildRaces(
      seats,
      DATE,
      new Map([['s2', 'il/cook-county/2026-11-03/an-older-address']]),
    )
    expect(kept[1].path).toBe('il/cook-county/2026-11-03/an-older-address')
  })

  it('leaves out referenda', () => {
    const races = buildRaces(
      [
        {
          ...base,
          id: 'm',
          kind: 'measure',
          authorityId: COOK,
          districtId: COOK,
          title: 'Question',
          question: 'Shall…?',
        },
      ],
      DATE,
    )
    expect(races).toEqual([])
  })
})
