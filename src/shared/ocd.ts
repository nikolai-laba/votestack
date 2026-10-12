// Open Civic Data division IDs for the districts on Cook County ballots.
// IDs marked "minted" don't exist in opencivicdata/ocd-division-ids yet; we
// follow its naming style so they can be proposed upstream later.

import type { OcdId } from './ballot.ts'

export const US: OcdId = 'ocd-division/country:us'
export const ILLINOIS: OcdId = `${US}/state:il`
export const COOK_COUNTY: OcdId = `${ILLINOIS}/county:cook`
export const CHICAGO: OcdId = `${ILLINOIS}/place:chicago`
export const MWRD: OcdId = `${ILLINOIS}/sewer:mwrd`

export const congressionalDistrict = (n: number): OcdId => `${ILLINOIS}/cd:${n}`
export const stateSenateDistrict = (n: number): OcdId => `${ILLINOIS}/sldu:${n}`
export const stateHouseDistrict = (n: number): OcdId => `${ILLINOIS}/sldl:${n}`
export const appellateDistrict = (n: number): OcdId =>
  `${ILLINOIS}/court_of_appeals:${n}`
export const countyBoardDistrict = (n: number): OcdId =>
  `${COOK_COUNTY}/council_district:${n}`
/** Minted. */
export const boardOfReviewDistrict = (n: number): OcdId =>
  `${COOK_COUNTY}/board_of_review_district:${n}`
/** Minted. */
export const judicialSubcircuit = (n: number): OcdId =>
  `${COOK_COUNTY}/judicial_subcircuit:${n}`
export const chicagoWard = (n: number): OcdId => `${CHICAGO}/ward:${n}`
/** Minted. For precinct-level questions such as liquor local options. */
export const chicagoPrecinct = (ward: number, precinct: number): OcdId =>
  `${chicagoWard(ward)}/precinct:${precinct}`
/** Minted. */
export const chicagoSchoolBoardDistrict = (n: string): OcdId =>
  `${CHICAGO}/school_board_district:${n.toLowerCase()}`

/** Minted. "Elk Grove" → `…/county:cook/township:elk_grove` */
export const cookTownship = (name: string): OcdId =>
  `${COOK_COUNTY}/township:${slugify(name)}`

/**
 * Minted. A Cook County taxing district (school, park, library, fire…) by its
 * Clerk tax code, e.g. `04-2150-000` for High School District 214. Referenda
 * are listed by tax code, and County GIS publishes each district's boundary
 * under the same number.
 */
export const cookTaxDistrict = (code: string): OcdId =>
  `${COOK_COUNTY}/tax_district:${code}`

/**
 * Minted. The Regional Office of Education of a county ("Lake" →
 * `…/state:il/county:lake/regional_office_of_education`). Some suburban Cook
 * school districts belong to a neighbouring county's office, and their voters
 * elect that county's Regional Superintendent of Schools.
 */
export const regionalOfficeOfEducation = (county: string): OcdId =>
  `${ILLINOIS}/county:${slugify(county)}/regional_office_of_education`

/** 42150000 → "04-2150-000" */
export function taxCode(agency: number | string): string {
  const digits = String(agency).padStart(9, '0')
  return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`
}

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')

/** "Village of Oak Park" → `…/place:oak_park`. "Mc Cook" and "McCook" are the same place. */
export function municipality(name: string): OcdId {
  const bare = name
    .replace(/^(city|village|town) of /i, '')
    .replace(/\bMc\s+/i, 'Mc')
  return `${ILLINOIS}/place:${slugify(bare)}`
}
