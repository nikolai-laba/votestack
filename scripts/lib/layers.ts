// District map layers (from fetch-boundaries.ts), shared by the precinct
// overlay and the address lookup.

import { join } from 'node:path'
import type { OcdId } from '../../src/shared/ballot.ts'
import { bbox, type Area, type AreaGeometry } from '../../src/shared/geo.ts'
import { COOK_EVERYWHERE } from '../../src/shared/cook.ts'
import * as ocd from '../../src/shared/ocd.ts'
import { RAW, readJson, type FeatureCollection } from './data.ts'

export interface Layer {
  type: string
  /** Every Cook County voter is in exactly one district of a required layer. */
  required: boolean
  areas: Area<OcdId>[]
}

export const loadBoundary = (name: string) =>
  readJson<FeatureCollection>(join(RAW, 'boundaries', `${name}.geojson`))

export function toAreas<T>(
  collection: FeatureCollection,
  toValue: (p: Record<string, unknown>) => T,
): Area<T>[] {
  return collection.features
    .filter((f) => f.geometry)
    .map((f) => {
      const geometry = f.geometry as AreaGeometry
      return { value: toValue(f.properties), geometry, bbox: bbox(geometry) }
    })
}

/** Every Cook County voter is in these. */
export const EVERYWHERE = COOK_EVERYWHERE

const TAX_DISTRICT_FILES = [
  'tax-community-college',
  'tax-elementary-school',
  'tax-fire-protection',
  'tax-high-school',
  'tax-library',
  'tax-park',
  'tax-unit-school',
  'tax-sanitary',
]

/**
 * Suburban Cook school districts run by a neighbouring county's Regional
 * Office of Education, by County GIS unit school agency number. Their voters
 * elect that county's Regional Superintendent (Barrington 220: Lake; U-46:
 * Kane). Checked against every suburban ballot style for Nov 3, 2026
 * (the sample ballot audit); the Clerk's own per-precinct lists
 * replace this map where it has them (scripts/build-clerk-precincts.ts).
 */
export const ROE_UNIT_DISTRICTS: Record<number, string> = {
  44030000: 'Lake',
  44010000: 'Kane',
}

export async function loadLayers(): Promise<Layer[]> {
  const n = (p: Record<string, unknown>, key = 'DISTRICT_INT') => Number(p[key])
  const layer = async (
    type: string,
    file: string,
    required: boolean,
    toId: (p: Record<string, unknown>) => OcdId | null,
  ): Promise<Layer> => ({
    type,
    required,
    // Features without an ID (e.g. unincorporated areas in the municipality layer) are skipped.
    areas: toAreas(await loadBoundary(file), toId).filter(
      (a): a is Area<OcdId> => a.value !== null,
    ),
  })

  return Promise.all([
    layer('congressional', 'congressional', true, (p) =>
      ocd.congressionalDistrict(n(p)),
    ),
    layer('state senate', 'state-senate', true, (p) =>
      ocd.stateSenateDistrict(n(p)),
    ),
    layer('state house', 'state-house', true, (p) =>
      ocd.stateHouseDistrict(n(p)),
    ),
    layer('county board', 'county-board', true, (p) =>
      ocd.countyBoardDistrict(n(p)),
    ),
    layer('board of review', 'board-of-review', true, (p) =>
      ocd.boardOfReviewDistrict(n(p)),
    ),
    layer('judicial subcircuit', 'subcircuits', true, (p) =>
      ocd.judicialSubcircuit(n(p, 'DISTRICT')),
    ),
    layer('water reclamation', 'mwrd', false, () => ocd.MWRD),
    layer('chicago school board', 'chicago-school-board', false, (p) =>
      ocd.chicagoSchoolBoardDistrict(
        String(p.LONGNAME).replace(/^District /, ''),
      ),
    ),
    layer('municipality', 'municipalities', false, (p) =>
      p.MUNICIPALITY ? ocd.municipality(String(p.MUNICIPALITY)) : null,
    ),
    layer('township', 'townships', false, (p) =>
      ocd.cookTownship(String(p.NAME)),
    ),
    layer('regional office of education', 'tax-unit-school', false, (p) => {
      const county = ROE_UNIT_DISTRICTS[Number(p.AGENCY)]
      return county ? ocd.regionalOfficeOfEducation(county) : null
    }),
    ...TAX_DISTRICT_FILES.map((file) =>
      layer(file, file, false, (p) =>
        ocd.cookTaxDistrict(ocd.taxCode(Number(p.AGENCY))),
      ),
    ),
  ])
}
