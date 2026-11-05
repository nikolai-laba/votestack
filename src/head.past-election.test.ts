// A 2026 result's head once Cook County's current election has moved on:
// the date and year come from the result's own election.
import { describe, expect, it, vi } from 'vitest'
import { profileHead, raceAreaHead, raceHead } from './head.ts'
import type { CandidateProfile } from './shared/profile.ts'
import type { RaceResult } from './shared/raceResults.ts'
import { COOK, regionForElection } from './shared/regions.ts'
import type { Race, RaceList } from './shared/races.ts'

vi.mock('./shared/cook.ts', async (original) => ({
  ...(await original<typeof import('./shared/cook.ts')>()),
  CURRENT_ELECTION: {
    id: 'il-2027-02-23-municipal',
    name: 'Consolidated Election',
    date: '2027-02-23',
    divisionId: 'ocd-division/country:us/state:il',
  },
}))

const DAY = 'Tuesday, November 3, 2026'
const empty = { asOf: '2026-10-05', items: [] }

const profile: CandidateProfile = {
  key: 'alex-rivera',
  electionId: 'il-2026-11-03-general',
  name: 'Alex Rivera',
  party: 'Democratic',
  office: 'Treasurer',
  contestIds: ['t'],
  kind: 'candidate',
  tier: 'mid',
  overview: empty,
  money: empty,
  endorsements: empty,
  sources: [],
  meta: {
    model: 'm',
    promptVersion: 'p',
    generatedAt: '2026-10-07T20:00:00Z',
    version: 1,
  },
}

const called: RaceResult = {
  contestIds: ['t'],
  kind: 'candidate',
  status: 'called',
  voteFor: 1,
  choices: [
    { name: 'Alex Rivera', votes: 660 },
    { name: 'Sam Moore', votes: 340 },
  ],
  winners: ['Alex Rivera'],
  call: { by: 'AP', at: '2026-11-04T03:41:00Z', url: 'https://apnews.com/x' },
  certifyBy: '2026-12-01',
  scope: 'within',
  sources: [],
  changedAt: '2026-11-04T08:00:00Z',
}
const retained: RaceResult = {
  ...called,
  kind: 'retention',
  voteFor: undefined,
  threshold: 0.6,
  choices: [
    { name: 'Yes', votes: 714 },
    { name: 'No', votes: 286 },
  ],
  winners: ['Yes'],
}

const race = {
  path: 'il/cook-county/2026-11-03/treasurer',
  kind: 'candidate',
  level: 'county',
  title: 'Treasurer',
  office: 'Treasurer',
  districtId: 'ocd-division/country:us/state:il/county:cook',
  contestIds: ['t'],
  ballots: [],
  candidates: [{ name: 'Alex Rivera' }, { name: 'Sam Moore' }],
} as unknown as Race

describe('a 2026 result after Cook County moves on to a later election', () => {
  it('is no longer the current election', () => {
    expect(COOK.election.date).toBe('2027-02-23')
    expect(regionForElection('il-2026-11-03-general')).toBeUndefined()
  })

  it('gives a profile the year and day of its own election', () => {
    const head = profileHead(profile, called)
    expect(head.title).toBe(
      'Alex Rivera, 2026 candidate for Treasurer, Illinois: results | VoteStack',
    )
    expect(head.description).toContain(`on ${DAY}, with 66.0% of the vote`)
    expect(head.description).not.toContain('2027')
  })

  it('gives a judge’s profile the year and day of its own election', () => {
    const judge: CandidateProfile = {
      ...profile,
      name: 'Pat Quinn',
      party: undefined,
      kind: 'retention',
      office: 'Judge of the Circuit Court of Cook County',
    }
    const head = profileHead(judge, retained)
    expect(head.title).toBe(
      'Pat Quinn, judge up for retention in 2026 (Cook County Circuit Court): results | VoteStack',
    )
    expect(head.description).toContain(
      `was retained as Judge of the Circuit Court of Cook County on ${DAY}`,
    )
  })

  it('gives a race page and an area list the day of their own election', () => {
    const head = raceHead(race, true, called)
    expect(head.title).toBe('Treasurer (Cook County): 2026 results | VoteStack')
    expect(head.description).toContain(`on the ${DAY} ballot`)
    const list = {
      area: 'Cook County',
      areaPath: 'il/cook-county/2026-11-03',
      date: '2026-11-03',
      races: [race],
    } as unknown as RaceList
    const area = raceAreaHead(list, true, true)
    expect(area.title).toBe('Races in Cook County, 2026: results | VoteStack')
    expect(area.description).toContain(`on the ${DAY} ballot`)
  })
})
