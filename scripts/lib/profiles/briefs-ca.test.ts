import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CA_BRIEFS,
  caEndorsementQueries,
  caResearchQueries,
  placeOf,
} from './briefs-ca.ts'
import type { ProfileRequest } from './prompt.ts'
import type { OfficeType } from './subjects.ts'

function request(
  officeType: OfficeType,
  office: string,
  name = 'Pat Example',
): ProfileRequest {
  return {
    key: 'k',
    electionId: 'ca-2026-11-03-general',
    name,
    office,
    contestIds: [],
    kind:
      officeType === 'retention' || officeType === 'judicial_candidate'
        ? officeType
        : 'candidate',
    tier: 'mid',
    officeType,
    asOf: '2026-10-14',
  }
}

const research = (req: ProfileRequest) =>
  caResearchQueries(req, CA_BRIEFS[req.officeType ?? 'other'])

describe('placeOf', () => {
  it('finds the city or district at the start of a local office', () => {
    expect(placeOf('City of Burbank, City Clerk')).toBe('Burbank')
    expect(
      placeOf('City of Los Angeles, Member of the City Council, 3rd District'),
    ).toBe('Los Angeles')
    expect(
      placeOf(
        'Walnut Valley Water District, Member, Board of Directors, Division 2',
      ),
    ).toBe('Walnut Valley Water District')
    expect(
      placeOf('Santa Clarita Valley Water Agency, Member, Board of Directors'),
    ).toBe('Santa Clarita Valley Water Agency')
  })

  it('uses Los Angeles for county, state, federal and court offices', () => {
    expect(placeOf('Los Angeles County SHERIFF')).toBe('Los Angeles')
    expect(placeOf('U.S. Representative, 30th District')).toBe('Los Angeles')
    expect(placeOf('California GOVERNOR')).toBe('Los Angeles')
    expect(
      placeOf('Superior Court Judge, Los Angeles County (Office No. 64)'),
    ).toBe('Los Angeles')
    expect(
      placeOf(
        'Associate Justice, Court of Appeal, Second District, Division Two',
      ),
    ).toBe('Los Angeles')
  })
})

describe('California briefs', () => {
  it('names no Illinois source or place', () => {
    for (const [type, brief] of Object.entries(CA_BRIEFS)) {
      const req = request(type as OfficeType, 'City of Carson, City Clerk')
      const text = [brief.focus, ...research(req)].join(' ')
      expect(text, type).not.toMatch(
        /Illinois|Chicago|Cook County|ilga|WBEZ|Injustice Watch/,
      )
    }
  })

  it('runs the same number of searches as Cook, with the name in each', () => {
    for (const type of Object.keys(CA_BRIEFS) as OfficeType[]) {
      const queries = research(request(type, 'City of Carson, City Clerk'))
      expect(queries, type).toHaveLength(8)
      expect(queries.every((q) => q.includes('"Pat Example"'))).toBe(true)
    }
  })

  it('searches a city office by its city', () => {
    expect(
      research(
        request(
          'city_council',
          'City of Palmdale, Member of the City Council, 3rd District',
        ),
      ),
    ).toEqual([
      '"Pat Example" City of Palmdale, Member of the City Council, 3rd District California',
      '"Pat Example" Palmdale news 2026',
      '"Pat Example" Palmdale City Council',
      '"Pat Example" Palmdale council vote',
      '"Pat Example" Palmdale candidate forum',
      '"Pat Example" questionnaire 2026',
      '"Pat Example" endorsements 2026',
      '"Pat Example" biography background',
    ])
  })

  it('does not repeat California in a statewide office', () => {
    const queries = research(request('statewide', 'California GOVERNOR'))
    expect(queries[0]).toBe('"Pat Example" California GOVERNOR')
    expect(queries).toContain('"Pat Example" CalMatters')
  })

  it('points judges at the county bar ratings and the State Bar', () => {
    const brief = CA_BRIEFS.judicial_candidate
    expect(brief.focus).toContain('lacba.org')
    expect(brief.focus).toContain('calbar.ca.gov')
    expect(CA_BRIEFS.retention.focus).toContain(
      'Commission on Judicial Appointments',
    )
  })

  it('gives local offices the official voter guide statement', () => {
    for (const type of [
      'city_executive',
      'city_council',
      'school_board',
      'community_college',
      'special_district',
    ] as const)
      expect(CA_BRIEFS[type].focus, type).toContain('lavote.gov')
  })

  it('uses five endorsement searches, and judge wording for judges', () => {
    const judge = request(
      'judicial_candidate',
      'Superior Court Judge, Los Angeles County (Office No. 64)',
    )
    expect(caEndorsementQueries(judge)).toHaveLength(5)
    expect(caEndorsementQueries(judge)[4]).toBe(
      '"Pat Example" judge endorsed 2026',
    )
    expect(
      caEndorsementQueries(request('us_house', 'U.S. Representative'))[4],
    ).toBe('editorial board endorsement "Pat Example"')
  })
})

describe('briefs.ts with --region=ca-la', () => {
  const argv = process.argv
  afterEach(() => {
    process.argv = argv
    vi.resetModules()
  })

  it('uses the California briefs and searches', async () => {
    process.argv = [...argv, '--region=ca-la']
    vi.resetModules()
    const briefs = await import('./briefs.ts')
    const req = request(
      'special_district',
      'Palos Verdes Library District, Member, Board of Trustees',
    )
    expect(briefs.briefFor(req).focus).toBe(CA_BRIEFS.special_district.focus)
    expect(briefs.researchQueries(req)).toEqual(research(req))
    expect(briefs.endorsementQueries(req)).toEqual(caEndorsementQueries(req))
    const judge = { ...req, kind: 'retention' as const, officeType: undefined }
    expect(briefs.briefFor(judge).focus).toBe(CA_BRIEFS.retention.focus)
  })
})
