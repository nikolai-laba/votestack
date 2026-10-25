import { describe, expect, it } from 'vitest'
import type { Race, RaceList } from '../shared/races.ts'
import { raceKeysFor } from './data.ts'

const ELECTION = 'il-2026-11-03-general'

const race = (r: Partial<Race>): Race => ({
  path: 'x',
  kind: 'candidate',
  level: 'local',
  title: 'T',
  office: 'O',
  districtId: 'ocd-division/country:us/state:il',
  contestIds: [],
  ballots: [],
  ...r,
})

const list: RaceList = {
  electionId: ELECTION,
  electionName: 'General',
  date: '2026-11-03',
  area: 'Cook County, Illinois',
  areaPath: 'il/cook-county/2026-11-03',
  races: [
    race({
      contestIds: ['mayor'],
      candidates: [
        { name: 'Jane Doe', ballotOrder: 1 },
        { name: 'Richard Roe', ballotOrder: 2 },
      ],
    }),
    race({ kind: 'retention', contestIds: ['ret'], judge: 'John Roe' }),
  ],
}
const data = { lists: [list] }

const profile = (key: string, contestIds: string[]) => ({
  key,
  electionId: ELECTION,
  contestIds,
})

describe('raceKeysFor', () => {
  it("lists every candidate's key in a candidate race", () => {
    expect(raceKeysFor(data, profile('jane-doe', ['mayor']))).toEqual([
      ['jane-doe', 'richard-roe'],
    ])
  })

  it('gives a retention judge a race of one', () => {
    expect(raceKeysFor(data, profile('john-roe', ['ret']))).toEqual([
      ['john-roe'],
    ])
  })

  it('knows no races for a profile the race list does not have', () => {
    expect(raceKeysFor(data, profile('sam-poe', ['other']))).toBeUndefined()
  })
})
