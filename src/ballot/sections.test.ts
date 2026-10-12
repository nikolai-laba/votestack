import { describe, expect, it } from 'vitest'
import type { Contest } from '../shared/ballot.ts'
import {
  groupContests,
  hasPaperOrder,
  paperSections,
  sectionFor,
  sectionsFor,
} from './sections.ts'

const IL = 'ocd-division/country:us/state:il'
const COOK = `${IL}/county:cook`

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
