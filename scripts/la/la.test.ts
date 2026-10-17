// @vitest-environment node
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { csvRows } from './csv.ts'
import {
  measureDistrict,
  officeDistrict,
  splitJurisdiction,
} from './districts.ts'
import { statePlaneZone5ToLatLng } from './state-plane.ts'

const CA = 'ocd-division/country:us/state:ca'
const LA = `${CA}/county:los_angeles`

describe('officeDistrict', () => {
  it('reads state and federal offices', () => {
    expect(officeDistrict('Governor')).toBe(CA)
    expect(officeDistrict('United States Representative 28th District')).toBe(
      `${CA}/cd:28`,
    )
    expect(officeDistrict('State Senator 22nd District')).toBe(`${CA}/sldu:22`)
    expect(officeDistrict('Member of the State Assembly 48th District')).toBe(
      `${CA}/sldl:48`,
    )
    expect(
      officeDistrict('Member, State Board of Equalization 3rd District'),
    ).toBe(`${CA}/boe_district:3`)
    expect(
      officeDistrict(
        'For Presiding Justice, Court of Appeal, Second District, Division Five',
      ),
    ).toBe(`${CA}/court_of_appeals:2`)
  })

  it('reads county offices', () => {
    expect(officeDistrict('Sheriff')).toBe(LA)
    expect(officeDistrict('Judge of the Superior Court Office No. 64')).toBe(LA)
  })

  it('reads school, college, water and city offices with their areas', () => {
    expect(
      officeDistrict(
        'ABC UNIFIED SCHOOL DISTRICT Governing Board Member, Trustee Area No. 2',
      ),
    ).toBe(`${LA}/school_district:abc_unified/trustee_area:2`)
    expect(
      officeDistrict(
        'LOS ANGELES COMMUNITY COLLEGE DISTRICT Member of the Board of Trustees, Seat 2',
      ),
    ).toBe(`${LA}/community_college_district:los_angeles`)
    expect(
      officeDistrict(
        'WEST BASIN MUNICIPAL WATER DISTRICT Member, Board of Directors, Division 4',
      ),
    ).toBe(
      `${LA}/special_district:west_basin_municipal_water_district/division:4`,
    )
    expect(
      officeDistrict(
        'ANTELOPE VALLEY HEALTH CARE DISTRICT Member, Board of Directors, District 2',
      ),
    ).toBe(
      `${LA}/special_district:antelope_valley_health_care_district/division:2`,
    )
    expect(
      officeDistrict('CITY OF PASADENA Member of the City Council, District 3'),
    ).toBe(`${CA}/place:pasadena/council_district:3`)
  })

  it('splits the jurisdiction from the office', () => {
    expect(
      splitJurisdiction(
        'MT. SAN ANTONIO COMMUNITY COLLEGE DISTRICT Governing Board Member',
      ),
    ).toEqual([
      'MT. SAN ANTONIO COMMUNITY COLLEGE DISTRICT',
      'Governing Board Member',
    ])
  })
})

describe('measureDistrict', () => {
  it('reads the jurisdiction before the measure letter', () => {
    expect(
      measureDistrict(
        'LOS ANGELES CITY GENERAL MUNICIPAL ELECTION - MEASURE EE',
      ),
    ).toBe(`${CA}/place:los_angeles`)
  })
})

describe('statePlaneZone5ToLatLng', () => {
  it('matches the County’s own coordinates to about a meter', () => {
    // A County address point and the County's WGS84 coordinates for it.
    const { lat, lng } = statePlaneZone5ToLatLng(
      6562913.83960263,
      1796082.35332198,
    )
    expect(lat).toBeCloseTo(33.927737, 4)
    expect(lng).toBeCloseTo(-117.995901, 4)
  })
})

describe('csvRows', () => {
  it('reads quoted fields with commas, quotes and line breaks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'csv-'))
    const file = join(dir, 'a.csv')
    await writeFile(file, '﻿a,b\r\n1,"x, ""y""\nz"\n2,\n')
    const rows = []
    for await (const row of csvRows(file)) rows.push(row)
    expect(rows).toEqual([
      { a: '1', b: 'x, "y"\nz' },
      { a: '2', b: '' },
    ])
  })
})
