// Downloads the LA County Registrar's precinct map with district names
// (33,000+ sub-precincts, each with its congressional, legislative, county,
// city, school and special districts) into data/raw/la/precincts.geojson.
// Run: node scripts/la/fetch-la-precincts.ts

import { join } from 'node:path'
import { arcgisLayer, RAW, writeJson } from '../lib/data.ts'

export const PRECINCTS_URL =
  'https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/Registrar_Recorder_Precincts_with_District_Names/FeatureServer/2'

const layer = await arcgisLayer(PRECINCTS_URL)
await writeJson(join(RAW, 'la', 'precincts.geojson'), layer)
console.log(`${layer.features.length} precincts`)
