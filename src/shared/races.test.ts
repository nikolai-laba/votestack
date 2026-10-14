import { describe, expect, it } from 'vitest'
import {
  buildRacePath,
  localitySlug,
  placeName,
  raceName,
  whoVotes,
} from './races.ts'

const IL = 'ocd-division/country:us/state:il'

describe('race addresses', () => {
  it('puts a race under the government that holds the office', () => {
    expect(
      buildRacePath(
        `${IL}/cd:7`,
        '2026-11-03',
        'U.S. Representative, 7th District',
      ),
    ).toBe('il/2026-11-03/us-representative-7th-district')
    expect(
      buildRacePath(
        `${IL}/county:cook/board_of_review_district:2`,
        '2026-11-03',
        'Board of Review, 2nd District',
      ),
    ).toBe('il/cook-county/2026-11-03/board-of-review-2nd-district')
    expect(
      buildRacePath(
        `${IL}/place:chicago/ward:12`,
        '2027-02-23',
        'Alderperson, 12th Ward',
      ),
    ).toBe('il/chicago/2027-02-23/alderperson-12th-ward')
    expect(
      buildRacePath(
        'ocd-division/country:us/state:tx/sldl:1',
        '2028-11-07',
        'State Representative, 1st District',
      ),
    ).toBe('tx/2028-11-07/state-representative-1st-district')
  })

  it('files districts by where they belong', () => {
    expect(localitySlug(`${IL}/sldu:3`)).toBeUndefined()
    expect(localitySlug(`${IL}/court_of_appeals:1`)).toBeUndefined()
    expect(localitySlug(`${IL}/sewer:mwrd`)).toBe('cook-county')
    expect(
      localitySlug(`${IL}/county:dupage/regional_office_of_education`),
    ).toBe('dupage-county')
    expect(placeName(`${IL}/county:dupage/regional_office_of_education`)).toBe(
      'DuPage County',
    )
    expect(placeName(IL)).toBe('Illinois')
  })

  it('says who votes in a race', () => {
    expect(whoVotes(`${IL}/sldl:21`)).toBe(
      'Voters in the 21st State Representative District.',
    )
    expect(whoVotes(`${IL}/county:cook/judicial_subcircuit:13`)).toBe(
      'Voters in the 13th Judicial Subcircuit of Cook County.',
    )
    expect(whoVotes(`${IL}/place:chicago/school_board_district:5a`)).toBe(
      'Chicago voters in Board of Education Subdistrict 5A.',
    )
  })

  it('names a judge’s retention after the judge', () => {
    expect(
      raceName({
        kind: 'retention',
        title: 'Judge, Circuit Court',
        judge: 'Lewis Nixon',
      }),
    ).toBe('Retention of Lewis Nixon, Judge, Circuit Court')
  })
})
