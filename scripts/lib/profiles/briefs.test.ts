import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { briefFor, endorsementQueries, researchQueries } from './briefs.ts'
import type { ProfileRequest } from './prompt.ts'
import type { OfficeType } from './subjects.ts'

const COOK_TYPES: OfficeType[] = [
  'us_senate',
  'us_house',
  'statewide',
  'county_executive',
  'state_legislature',
  'county_board',
  'board_of_review',
  'water_reclamation',
  'school_board',
  'judicial_candidate',
  'retention',
  'regional_superintendent',
  'sanitary_district',
  'other',
]

function request(officeType: OfficeType): ProfileRequest {
  return {
    key: 'k',
    electionId: 'e',
    name: 'Pat Example',
    office: 'Some Office',
    contestIds: [],
    kind:
      officeType === 'retention' || officeType === 'judicial_candidate'
        ? officeType
        : 'candidate',
    tier: 'mid',
    officeType,
    asOf: '2026-10-01',
  }
}

// Cook County's profiles were researched with these exact briefs; adding
// other regions must not change a byte of them.
describe('Cook County briefs (the default region)', () => {
  it('keeps every brief and search unchanged', () => {
    const all = COOK_TYPES.map((t) => {
      const req = request(t)
      return {
        t,
        focus: briefFor(req).focus,
        research: researchQueries(req),
        endorse: endorsementQueries(req),
      }
    })
    const hash = createHash('sha256').update(JSON.stringify(all)).digest('hex')
    expect(hash).toBe(
      '8ab991c03bb4a4e5d573bbf422cfff592d538343a4bdad99493ebf15d12b5ff6',
    )
  })

  it('keeps the U.S. House brief', () => {
    const req = request('us_house')
    expect(briefFor(req).focus).toBe(
      'For positions: the campaign issues page, news coverage (Chicago Tribune, Chicago Sun-Times, WBEZ, Daily Herald, local papers), questionnaires. For record: votes and bills on congress.gov for incumbents, and past offices for others.',
    )
    expect(researchQueries(req)).toEqual([
      '"Pat Example" Some Office Illinois',
      '"Pat Example" Chicago news 2026',
      '"Pat Example" Some Office positions issues',
      '"Pat Example" questionnaire 2026',
      '"Pat Example" congress.gov bills votes',
      '"Pat Example" Congress record',
      '"Pat Example" endorsements 2026',
      '"Pat Example" biography background',
    ])
    expect(endorsementQueries(req)).toEqual([
      '"Pat Example" endorsements',
      'endorses "Pat Example" 2026',
      '"Pat Example" endorsed by union',
      '"Pat Example" Some Office endorsement',
      'editorial board endorsement "Pat Example"',
    ])
  })

  it('keeps the water reclamation and retention briefs', () => {
    expect(briefFor(request('water_reclamation')).focus).toBe(
      'For positions and record: the MWRD site (mwrd.org), flooding, stormwater and water treatment work, Chicago Tribune, Chicago Sun-Times, WBEZ, questionnaires (IVI-IPO, Sierra Club Illinois).',
    )
    const req = request('retention')
    expect(briefFor(req).focus).toBe(
      'For background and record: court pages (illinoiscourts.gov, cookcountycourt.org), bar association evaluations (they describe experience and assignments), Injustice Watch, Chicago Tribune, Chicago Sun-Times, Chicago Daily Law Bulletin, and notable rulings reported in the news.',
    )
    expect(researchQueries(req).slice(2, 6)).toEqual([
      '"Pat Example" judge Cook County',
      '"Pat Example" judge ruling',
      '"Pat Example" Injustice Watch',
      '"Pat Example" retention 2026',
    ])
    expect(endorsementQueries(req)[4]).toBe('"Pat Example" judge endorsed 2026')
  })
})
