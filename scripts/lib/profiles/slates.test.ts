import { describe, expect, it } from 'vitest'
import { confirmation } from './endorsers.ts'
import { hintFor, laHint } from './slate-parsers.ts'
import {
  matchEntry,
  matchSlate,
  mergeSlates,
  officeFits,
  slateNameMatches,
  type Slate,
} from './slates.ts'
import { fixtureProfile, fixtureSubject } from './test-fixtures.ts'

describe('slateNameMatches', () => {
  it.each([
    ['Jonathan L. Jackson', 'Jonathan Jackson'],
    ['Robert "Bob" Rita', 'Bob Rita'],
    ['Michael J. Kelly', 'Mike Kelly'],
    ['Kam Buckner', 'Kambium Buckner'],
    ["Patricia Joan 'Trish' Murphy", 'Patricia Joan ‘Trish’ Murphy'],
    ['Kimberly Neely DuBuclet', 'Kimberly Du Buclet'],
    ['Kimberly Neely DuBuclet', 'Kim DuBuclet'],
    ['La Shawn K. Ford', 'LaShawn Ford'],
    ['Marcus C. Evans, Jr.', 'Marcus Evans Jr.'],
    ['Napoleon B. Harris III', 'Napoleon Harris'],
    ['Jawaharial "Omar" Williams', 'Omar Williams'],
    ['Angie Guerrero-Cuellar', 'Angelica Guerrero-Cuellar'],
    ['Edgar Gonzalez, Jr.', 'Edgar González, Jr.'],
    ['JB Pritzker & Christian Mitchell', 'Christian Mitchell'],
    ['JB Pritzker & Christian Mitchell', 'JB Pritzker and Christian Mitchell'],
  ])('%s is %s', (ballot, listed) => {
    expect(slateNameMatches(ballot, listed)).toBe(true)
  })

  it.each([
    ['Yolonda Morris', 'Yolanda Morris'],
    ['Lisa J. Davis', 'Will Davis'],
    ['Ann M. Williams', 'Jawaharial Williams'],
    ['Christine Smith', 'Chris Smyth'],
  ])('%s is not %s', (ballot, listed) => {
    expect(slateNameMatches(ballot, listed)).toBe(false)
  })
})

describe('officeFits', () => {
  const rep4 = fixtureSubject({
    office: 'State Representative, 4th District',
    officeType: 'state_legislature',
  })
  const judge = fixtureSubject({
    office: "Circuit Court Judge, 13th Subcircuit (Vacancy of O'Malley)",
    officeType: 'judicial_candidate',
  })

  it('checks type, district and vacancy', () => {
    expect(officeFits(rep4, hintFor('state_house', { district: 4 })!)).toBe(
      true,
    )
    expect(officeFits(rep4, hintFor('state_house', { district: 40 })!)).toBe(
      false,
    )
    expect(officeFits(rep4, hintFor('state_senate', { district: 4 })!)).toBe(
      false,
    )
    expect(
      officeFits(
        judge,
        hintFor('subcircuit', { district: 13, vacancy: 'O’Malley' })!,
      ),
    ).toBe(true)
    expect(
      officeFits(
        judge,
        hintFor('subcircuit', { district: 13, vacancy: 'Kelley' })!,
      ),
    ).toBe(false)
  })

  it('tells the Water Reclamation terms apart', () => {
    const full = fixtureSubject({
      office: 'Metropolitan Water Reclamation District Commissioner',
    })
    const unexpired = fixtureSubject({
      office:
        'Metropolitan Water Reclamation District Commissioner (unexpired 2-year term)',
    })
    expect(officeFits(full, hintFor('mwrd6')!)).toBe(true)
    expect(officeFits(unexpired, hintFor('mwrd6')!)).toBe(false)
    expect(officeFits(unexpired, hintFor('mwrd2')!)).toBe(true)
  })
})

describe('matchEntry', () => {
  const subjects = [
    fixtureSubject({
      key: 'yolonda-morris',
      name: 'Yolonda Morris',
      office: 'State Representative, 9th District',
      officeType: 'state_legislature',
    }),
    fixtureSubject({
      key: 'anthony-hargrove',
      name: 'Anthony Hargrove',
      office: 'Chicago Board of Education Member, Subdistrict 5B',
      officeType: 'school_board',
    }),
    fixtureSubject({
      key: 'pat-smith',
      name: 'Pat Smith',
      office: 'State Representative, 9th District',
      officeType: 'state_legislature',
    }),
    fixtureSubject({
      key: 'patricia-smith',
      name: 'Patricia Smith',
      office: 'State Representative, 9th District',
      officeType: 'state_legislature',
    }),
  ]
  const hd9 = hintFor('state_house', { district: 9 })

  it('matches exactly one person', () => {
    const m = matchEntry(
      {
        name: 'Anthony Hargrove',
        office: '5B',
        hint: hintFor('school_board', { school: '5B' }),
      },
      subjects,
    )
    expect(m).toEqual({
      name: 'Anthony Hargrove',
      office: '5B',
      matchedKey: 'anthony-hargrove',
    })
  })

  it('reports a misspelled name instead of guessing', () => {
    const m = matchEntry(
      { name: 'Yolanda Morris', office: 'HD 9', hint: hd9 },
      subjects,
    )
    expect(m.matchedKey).toBeNull()
    expect(m.status).toBe('unmatched')
  })

  it('reports a name in another office', () => {
    const m = matchEntry(
      {
        name: 'Anthony Hargrove',
        office: '5A',
        hint: hintFor('school_board', { school: '5A' }),
      },
      subjects,
    )
    expect(m.status).toBe('unmatched')
    expect(m.note).toMatch(/not the office/)
  })

  it('reports two fits as ambiguous', () => {
    const m = matchEntry(
      { name: 'Pat Smith', office: 'HD 9', hint: hd9 },
      subjects,
    )
    expect(m.status).toBe('ambiguous')
  })

  it('marks offices no one on our ballots holds as outside', () => {
    const m = matchEntry(
      { name: 'Deb Conroy', office: 'DuPage', hint: null },
      subjects,
    )
    expect(m.status).toBe('outside')
  })

  it('lists a ticket once', () => {
    const ticket = fixtureSubject({
      key: 'jb-pritzker-christian-mitchell',
      name: 'JB Pritzker & Christian Mitchell',
      office: 'Illinois Governor and Lieutenant Governor',
      officeType: 'statewide',
    })
    const entries = matchSlate(
      [
        { name: 'JB Pritzker', office: 'Governor', hint: hintFor('governor') },
        {
          name: 'Christian Mitchell',
          office: 'Lt. Governor',
          hint: hintFor('lt_governor'),
        },
      ],
      [ticket],
    )
    expect(entries).toHaveLength(1)
    expect(entries[0].matchedKey).toBe('jb-pritzker-christian-mitchell')
  })
})

describe('mergeSlates', () => {
  const slate: Slate = {
    slug: 'chicago-federation-of-labor',
    endorser: 'Chicago Federation of Labor',
    kind: 'union',
    title: 'Endorsed candidates',
    publisher: 'Chicago Federation of Labor',
    url: 'https://chicagolabor.org/list.pdf',
    fetchedAt: '2026-10-07',
    entries: [
      { name: 'Jane Doe', office: 'MWRD', matchedKey: 'jane-doe' },
      { name: 'Someone', office: 'X', matchedKey: null, status: 'outside' },
    ],
  }

  it('adds the endorsement cited to the list', () => {
    const { profile, added, confirmed } = mergeSlates(fixtureProfile(), [slate])
    expect(added).toEqual(['chicago-federation-of-labor'])
    expect(confirmed).toEqual([
      confirmation('jane-doe', 'Chicago Federation of Labor'),
    ])
    const e = profile.endorsements.items.at(-1)!
    expect(e).toEqual({
      organization: 'Chicago Federation of Labor',
      kind: 'union',
      cites: [3],
    })
    expect(profile.sources.at(-1)).toMatchObject({
      id: 3,
      url: slate.url,
      viewedAt: '2026-10-07',
      kind: 'endorser',
    })
  })

  it("doesn't add an endorser the profile already lists, under any spelling", () => {
    const p = fixtureProfile({
      endorsements: {
        asOf: '2026-10-01',
        items: [{ organization: 'CFL', kind: 'union', cites: [2] }],
      },
    })
    const r = mergeSlates(p, [slate])
    expect(r.added).toEqual([])
    expect(r.confirmed).toHaveLength(1)
    expect(r.profile).toBe(p)
  })

  it('skips people the list leaves out and is idempotent', () => {
    expect(
      mergeSlates(fixtureProfile({ key: 'john-roe' }), [slate]).added,
    ).toEqual([])
    const once = mergeSlates(fixtureProfile(), [slate]).profile
    expect(mergeSlates(once, [slate]).profile).toBe(once)
  })

  it('refreshes the viewed date when the list is fetched again', () => {
    const once = mergeSlates(fixtureProfile(), [slate]).profile
    const again = mergeSlates(once, [{ ...slate, fetchedAt: '2026-11-01' }])
    expect(again.profile.sources.at(-1)?.viewedAt).toBe('2026-11-01')
  })
})

describe('officeFits for Los Angeles offices', () => {
  const council = (office: string) =>
    fixtureSubject({ office, officeType: 'city_council' })

  it('needs the place to begin the office, after "City of"', () => {
    const hint = laHint('El Monte City Council, District 2')!
    expect(
      officeFits(
        council('City of El Monte, Member of the City Council, 2nd District'),
        hint,
      ),
    ).toBe(true)
    expect(
      officeFits(
        council(
          'City of South El Monte, Member of the City Council, 2nd District',
        ),
        hint,
      ),
    ).toBe(false)
    expect(
      officeFits(
        council('City of City of Culver, Member of the City Council'),
        laHint('Culver City Council')!,
      ),
    ).toBe(true)
  })

  it('reads spelled-out districts when the office has no digits', () => {
    const office =
      'City of Alhambra, Member of the City Council, Fifth District'
    expect(
      officeFits(council(office), laHint('Alhambra City Council, CD 5')!),
    ).toBe(true)
    expect(
      officeFits(council(office), laHint('Alhambra City Council, CD 1')!),
    ).toBe(false)
  })

  it('ignores dashes and accents in places', () => {
    const school = fixtureSubject({
      office:
        'Hacienda La Puente Unified School District, Governing Board Member, Trustee Area No. 4',
      officeType: 'school_board',
    })
    expect(
      officeFits(
        school,
        laHint('Hacienda- La Puente Unified School District, Area 4')!,
      ),
    ).toBe(true)
  })

  it('matches a list nickname to the ballot name', () => {
    expect(slateNameMatches('Abby Veltman', 'Abigail Veltman')).toBe(true)
    expect(slateNameMatches('Jacky Elizalde', 'Jacqueline Elizalde')).toBe(true)
  })
})
