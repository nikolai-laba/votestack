// Downloads the district and precinct boundary files into data/raw/boundaries/.
// Sources and terms: data/README.md. Run: node scripts/fetch-boundaries.ts

import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  arcgisLayer,
  RAW,
  socrataGeoJson,
  writeJson,
  type FeatureCollection,
} from './lib/data.ts'
import { readShapefile } from './lib/shapefile.ts'

/** Downloads a zipped shapefile (in longitude/latitude) and reads one layer from it. */
async function zippedShapefile(url: string, layer: string) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`${res.status} for ${url}`)
  const dir = mkdtempSync(join(tmpdir(), 'votestack-'))
  writeFileSync(join(dir, 'data.zip'), Buffer.from(await res.arrayBuffer()))
  execFileSync('unzip', ['-q', '-o', 'data.zip'], { cwd: dir })
  return readShapefile(join(dir, layer))
}

const COOK_GIS =
  'https://gis.cookcountyil.gov/traditional/rest/services/politicalBoundary/MapServer'

const sources: Record<string, () => Promise<FeatureCollection>> = {
  // Election precincts: Chicago (Board of Election Commissioners via the City
  // data portal) and suburban Cook (County Clerk).
  'chicago-precincts': () =>
    socrataGeoJson('data.cityofchicago.org', 'i8fv-xe4b'),
  'suburban-precincts': () =>
    socrataGeoJson('datacatalog.cookcountyil.gov', 'k7sw-w3b8'),
  // Chicago's 77 community areas: the organizers describe the proposed
  // Expanded Mental Health Services Program areas by them
  // (scripts/chicago-referendum-areas.ts).
  'chicago-community-areas': () =>
    socrataGeoJson('data.cityofchicago.org', 'igwz-8jzy'),
  // Current district maps published by Cook County GIS.
  congressional: () => arcgisLayer(`${COOK_GIS}/13`),
  'state-senate': () => arcgisLayer(`${COOK_GIS}/12`),
  'state-house': () => arcgisLayer(`${COOK_GIS}/11`),
  'county-board': () => arcgisLayer(`${COOK_GIS}/9`),
  'board-of-review': () => arcgisLayer(`${COOK_GIS}/10`),
  mwrd: () => arcgisLayer(`${COOK_GIS}/21`),
  municipalities: () => arcgisLayer(`${COOK_GIS}/2`),
  townships: () => arcgisLayer(`${COOK_GIS}/3`),
  // Taxing districts, for local referenda (listed by the Clerk by tax code).
  'tax-community-college': () => arcgisLayer(`${COOK_GIS}/15`),
  'tax-elementary-school': () => arcgisLayer(`${COOK_GIS}/16`),
  'tax-fire-protection': () => arcgisLayer(`${COOK_GIS}/17`),
  'tax-high-school': () => arcgisLayer(`${COOK_GIS}/18`),
  'tax-library': () => arcgisLayer(`${COOK_GIS}/20`),
  'tax-park': () => arcgisLayer(`${COOK_GIS}/23`),
  'tax-unit-school': () => arcgisLayer(`${COOK_GIS}/25`),
  // Sanitary districts elect trustees in November; politicalBoundary has no
  // sanitary layer, so use the Clerk's tax district service (tax year 2025).
  'tax-sanitary': () =>
    arcgisLayer(
      'https://gis.cookcountyil.gov/traditional/rest/services/Sanitary_Tax_District_Boundaries/MapServer/2025',
    ),
  // Judicial subcircuits (2022 map, PA 102-0693). Cook County GIS still
  // publishes the old 15-subcircuit map, so use the Illinois Senate's file.
  subcircuits: () =>
    zippedShapefile(
      'https://ilsenateredistricting.com/images/Data/Enacted_Judicial_Sub_Circiuts.zip',
      'Cook County Sub Circuits',
    ),
  // Chicago Board of Education subdistricts 1a–10b (SB 15, Floor Amendment 1).
  // Not yet confirmed as the enacted version: check precinct nesting in the audit.
  'chicago-school-board': () =>
    zippedShapefile(
      'https://ilsenateredistricting.com/images/shape-files/ERSB_20_Sub_District_Map_FA1_SB_15.zip',
      'ERSB_20_Sub_District_Map_FA1_SB_15',
    ),
}

const only = process.argv.slice(2)
for (const [name, load] of Object.entries(sources)) {
  if (only.length && !only.includes(name)) continue
  const collection = await load()
  await writeJson(join(RAW, 'boundaries', `${name}.geojson`), collection)
  console.log(`${name}: ${collection.features.length} features`)
}
