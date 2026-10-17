import { describe, expect, it } from 'vitest'
import {
  areaBallotsText,
  ballotsText,
  buildRacePath,
  localitySlug,
  placeName,
  raceName,
  whoVotes,
} from './races.ts'

const IL = 'ocd-division/country:us/state:il'
const CA = 'ocd-division/country:us/state:ca'
const LA = `${CA}/county:los_angeles`

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

  it('says who votes in a Los Angeles County race', () => {
    expect(whoVotes(CA)).toBe('Every voter in California.')
    expect(whoVotes(LA)).toBe('Every voter in Los Angeles County.')
    expect(whoVotes(`${CA}/sldl:51`)).toBe(
      'Voters in the 51st State Assembly District.',
    )
    expect(whoVotes(`${CA}/sldu:24`)).toBe(
      'Voters in the 24th State Senate District.',
    )
    expect(whoVotes(`${CA}/boe_district:3`)).toBe(
      'Voters in the 3rd Board of Equalization District.',
    )
    expect(whoVotes(`${CA}/court_of_appeals:2`)).toBe(
      'Voters in the 2nd Appellate District of the California Court of Appeal.',
    )
    expect(whoVotes(`${LA}/council_district:3`)).toBe(
      'Voters in the 3rd Supervisorial District of Los Angeles County.',
    )
    expect(whoVotes(`${CA}/place:los_angeles/council_district:5`)).toBe(
      'Voters in Los Angeles City Council District 5.',
    )
    expect(whoVotes(`${LA}/school_district:pasadena_unified`)).toBe(
      'Voters in the Pasadena Unified School District.',
    )
    expect(
      whoVotes(`${LA}/school_district:los_angeles_unified/trustee_area:2`),
    ).toBe(
      'Voters in Trustee Area 2 of the Los Angeles Unified School District.',
    )
    expect(
      whoVotes(`${LA}/community_college_district:los_angeles/trustee_area:1`),
    ).toBe(
      'Voters in Trustee Area 1 of the Los Angeles Community College District.',
    )
    expect(
      whoVotes(
        `${LA}/special_district:central_basin_municipal_water_district/division:4`,
      ),
    ).toBe(
      'Voters in Division 4 of the Central Basin Municipal Water District.',
    )
    expect(placeName(CA)).toBe('California')
    expect(placeName(LA)).toBe('Los Angeles County')
    expect(placeName(`${LA}/school_district:pasadena_unified`)).toBe(
      'Los Angeles County',
    )
    expect(placeName(`${CA}/place:los_angeles/council_district:5`)).toBe(
      'Los Angeles',
    )
  })

  it('names the ballots that list a race', () => {
    expect(ballotsText(['chicago', 'suburban-cook'])).toBe(
      'Chicago and suburban Cook County',
    )
    expect(ballotsText(['chicago'])).toBe('Chicago only')
    expect(ballotsText(['suburban-cook'])).toBe('Suburban Cook County only')
    expect(ballotsText(['los-angeles-county'])).toBe('Los Angeles County')
    expect(
      areaBallotsText({
        races: [{ ballots: ['chicago'] }, { ballots: ['suburban-cook'] }],
      } as never),
    ).toBe('Chicago and suburban Cook County')
    expect(
      areaBallotsText({
        races: [{ ballots: ['los-angeles-county'] }],
      } as never),
    ).toBe('Los Angeles County')
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
