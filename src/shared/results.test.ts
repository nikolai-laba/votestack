import { describe, expect, it } from 'vitest'
import { COOK, LOS_ANGELES } from './regions.ts'
import {
  areaOfBallot,
  ballotAreaOfAuthority,
  ballotAreasOfContests,
  resultsOffices,
} from './results.ts'
import { CHICAGO, COOK_COUNTY, ILLINOIS, LOS_ANGELES_COUNTY } from './ocd.ts'

describe('resultsOffices', () => {
  it('names the Chicago Board for a Chicago ballot', () => {
    expect(resultsOffices(['chicago'])).toEqual([
      {
        name: 'Chicago Board of Election Commissioners',
        url: 'https://chicagoelections.gov/elections/results',
        place: 'Chicago',
      },
    ])
  })

  it('lists each office once, Chicago first', () => {
    expect(
      resultsOffices(['suburban-cook', 'chicago', 'chicago']).map(
        (o) => o.name,
      ),
    ).toEqual(['Chicago Board of Election Commissioners', 'Cook County Clerk'])
  })

  it('names the Registrar for Los Angeles County', () => {
    expect(resultsOffices(['los-angeles-county'])[0]).toMatchObject({
      name: 'Los Angeles County Registrar-Recorder/County Clerk',
      url: 'https://results.lavote.gov/',
      place: 'Los Angeles County',
    })
  })

  it('knows the Clerk by its place and results page', () => {
    expect(resultsOffices(['suburban-cook'])).toEqual([
      {
        name: 'Cook County Clerk',
        url: 'https://www.cookcountyclerkil.gov/elections/results-and-election-data/election-results',
        place: 'suburban Cook County',
      },
    ])
  })

  it('names no one for no ballots', () => {
    expect(resultsOffices([])).toEqual([])
  })
})

describe('ballotAreasOfContests', () => {
  it('reads the area from the contest id prefix, in the order given', () => {
    expect(
      ballotAreasOfContests([
        'chicago-boe:united-states-senator',
        'cook-clerk:120100',
      ]),
    ).toEqual(['chicago', 'suburban-cook'])
    expect(ballotAreasOfContests(['la-4348-cc10805'])).toEqual([
      'los-angeles-county',
    ])
  })

  it('ignores ids with no known prefix', () => {
    expect(ballotAreasOfContests(['gov'])).toEqual([])
  })
})

describe('ballotAreaOfAuthority', () => {
  it('maps each election authority to its ballot area', () => {
    expect(ballotAreaOfAuthority(CHICAGO)).toBe('chicago')
    expect(ballotAreaOfAuthority(COOK_COUNTY)).toBe('suburban-cook')
    expect(ballotAreaOfAuthority(LOS_ANGELES_COUNTY)).toBe('los-angeles-county')
    expect(ballotAreaOfAuthority(ILLINOIS)).toBeNull()
  })
})

describe('areaOfBallot', () => {
  it('follows the precinct when the ballot has one', () => {
    expect(
      areaOfBallot({ precinct: { id: 'chicago:01001' }, contests: [] }, COOK),
    ).toBe('chicago')
    expect(
      areaOfBallot({ precinct: { id: 'cook:8500022' }, contests: [] }, COOK),
    ).toBe('suburban-cook')
  })

  it('follows the contests’ authority when a saved ballot has no precinct', () => {
    expect(areaOfBallot({ contests: [{ authorityId: CHICAGO }] }, COOK)).toBe(
      'chicago',
    )
    expect(
      areaOfBallot({ contests: [{ authorityId: COOK_COUNTY }] }, COOK),
    ).toBe('suburban-cook')
  })

  it('falls back to the region’s own election authority', () => {
    expect(areaOfBallot({ contests: [] }, COOK)).toBe('suburban-cook')
    expect(areaOfBallot({ contests: [] }, LOS_ANGELES)).toBe(
      'los-angeles-county',
    )
  })
})
