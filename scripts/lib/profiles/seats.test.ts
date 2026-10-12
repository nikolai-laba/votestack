import { describe, expect, it } from 'vitest'
import type { CandidateContest } from '../../../src/shared/ballot.ts'
import { breakdownOf, formatPeriod, seatFor } from './seats.ts'

const contest = (
  districtId: string,
  office: string,
  title = office,
): CandidateContest => ({
  id: 'x',
  electionId: 'e',
  districtId,
  authorityId: 'a',
  title,
  sources: [],
  lastVerified: '2026-10-06',
  kind: 'candidate',
  office,
  voteFor: 1,
  candidates: [],
})

const IL = 'ocd-division/country:us/state:il'
const COOK = `${IL}/county:cook`

describe('seatFor', () => {
  it('maps federal, state and county seats', () => {
    expect(seatFor(contest(`${IL}/cd:7`, 'U.S. Representative'))).toEqual({
      level: 'federal',
      office: 'H',
      district: 7,
    })
    expect(seatFor(contest(IL, 'Senator', 'Senator, U.S.'))).toEqual({
      level: 'federal',
      office: 'S',
    })
    expect(seatFor(contest(`${IL}/sldu:8`, 'State Senator'))).toEqual({
      level: 'state',
      office: 'senator',
      district: 8,
    })
    expect(seatFor(contest(IL, 'Governor & Lieutenant Governor'))).toEqual({
      level: 'state',
      office: 'governor',
    })
    expect(seatFor(contest(COOK, 'President of County Board'))).toEqual({
      level: 'county',
      office: 'board president',
    })
    expect(seatFor(contest(COOK, 'County Treasurer'))).toEqual({
      level: 'county',
      office: 'treasurer',
    })
    expect(seatFor(contest(`${IL}/sewer:mwrd`, 'Commissioner'))).toEqual({
      level: 'mwrd',
    })
    expect(
      seatFor(
        contest(`${COOK}/judicial_subcircuit:8`, 'Judge, 8th Subcircuit'),
      ),
    ).toEqual({ level: 'judge', retention: false })
  })
})

describe('formatPeriod', () => {
  it('names the year once when both dates share it', () => {
    expect(formatPeriod('2026-07-01', '2026-09-30')).toBe(
      'July 1 to September 30, 2026',
    )
    expect(formatPeriod('2025-01-01', '2026-06-30')).toBe(
      'January 1, 2025 to June 30, 2026',
    )
  })
})

describe('breakdownOf', () => {
  it('keeps the fixed order, rounds to cents and leaves out $0 kinds', () => {
    expect(
      breakdownOf(1000, { other: 100, small: 299.996, pac: 0, large: 600 }),
    ).toEqual([
      { kind: 'small', amount: 300 },
      { kind: 'large', amount: 600 },
      { kind: 'other', amount: 100 },
    ])
  })

  it('allows rounding within a dollar', () => {
    expect(breakdownOf(1000.5, { small: 1000 })).toEqual([
      { kind: 'small', amount: 1000 },
    ])
  })

  it("refuses parts that don't add up or are negative", () => {
    expect(breakdownOf(1000, { small: 500 })).toBeUndefined()
    expect(breakdownOf(1000, { small: 1100, other: -100 })).toBeUndefined()
  })

  it('is empty when nothing was raised', () => {
    expect(breakdownOf(0, { small: 0, large: 0 })).toEqual([])
  })
})
