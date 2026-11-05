import { describe, expect, it } from 'vitest'
import {
  COOK,
  LOS_ANGELES,
  coveredAreas,
  electionDate,
  regionsFor,
  resultRegion,
  type Region,
} from './regions.ts'

const la: Region = {
  ...COOK,
  id: 'ca-la',
  name: 'Los Angeles County',
  state: 'CA',
  zipPrefixes: ['90', '91', '93'],
}
const third: Region = { ...COOK, id: 'xx', name: 'Third County' }

describe('regionsFor', () => {
  it('puts the region with a matching ZIP first', () => {
    expect(regionsFor({ zip: '90012' }, [COOK, la]).map((r) => r.id)).toEqual([
      'ca-la',
      'il-cook',
    ])
  })

  it('uses the state when there is no ZIP', () => {
    expect(regionsFor({ state: 'CA' }, [COOK, la])[0].id).toBe('ca-la')
  })

  it('keeps the listed order when nothing matches', () => {
    expect(regionsFor({}, [COOK, la]).map((r) => r.id)).toEqual([
      'il-cook',
      'ca-la',
    ])
  })
})

describe('coveredAreas', () => {
  it('names one, two or more areas', () => {
    expect(coveredAreas([COOK])).toBe('Cook County')
    expect(coveredAreas([COOK, la])).toBe('Cook County or Los Angeles County')
    expect(coveredAreas([COOK, la, third])).toBe(
      'Cook County, Los Angeles County or Third County',
    )
  })
})

describe('resultRegion and electionDate', () => {
  it('answer for a current election from its region', () => {
    expect(resultRegion(COOK.election.id)).toBe(COOK)
    expect(resultRegion(LOS_ANGELES.election.id)).toBe(LOS_ANGELES)
    expect(electionDate(LOS_ANGELES.election.id)).toBe(
      LOS_ANGELES.election.date,
    )
  })

  it('answer for a past election from its ID', () => {
    expect(resultRegion('ca-2022-11-08-general')).toBe(LOS_ANGELES)
    expect(resultRegion('il-2022-11-08-general')).toBe(COOK)
    expect(electionDate('ca-2022-11-08-general')).toBe('2022-11-08')
  })
})
