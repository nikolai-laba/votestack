// Overlays the district maps on the election precincts. Lookups take districts
// from the address point itself (precincts can cross district lines), so this
// is the audit: it lists each precinct's main districts and flags precincts
// that look split across districts, for extra checking against official
// sample ballots. Writes data/build/precincts.json, precinct-shapes.geojson
// (outlines for finding a voter's precinct) and precinct-audit.json.
// Run after fetch-boundaries.ts: node scripts/build-precincts.ts

import { join } from 'node:path'
import type { OcdId, Precinct } from '../src/shared/ballot.ts'
import {
  findContaining,
  gridPoints,
  type AreaGeometry,
} from '../src/shared/geo.ts'
import * as ocd from '../src/shared/ocd.ts'
import { BUILD, writeJson, type FeatureCollection } from './lib/data.ts'
import { EVERYWHERE, loadBoundary, loadLayers } from './lib/layers.ts'

const layers = await loadLayers()

const precincts: Precinct[] = []
const shapes: FeatureCollection = { type: 'FeatureCollection', features: [] }
const problems: string[] = []

// Each precinct gets the district covering most of it, judged by a grid of
// points inside the precinct. The boundary files come from different
// publishers and don't line up exactly, so a few points near an edge often
// fall in the neighbouring district; only a large minority share suggests a
// real split.
const SPLIT_THRESHOLD = 0.2

interface SplitReport {
  precinct: string
  layer: string
  shares: Record<OcdId, number>
}
const splits: SplitReport[] = []

function addPrecinct(
  id: string,
  name: string,
  geometry: AreaGeometry,
  extra: OcdId[],
) {
  const points = gridPoints(geometry)
  const districtIds = [...EVERYWHERE, ...extra]
  for (const layer of layers) {
    const votes = new Map<OcdId, number>()
    for (const point of points) {
      for (const district of findContaining(layer.areas, point))
        votes.set(district, (votes.get(district) ?? 0) + 1)
    }
    const ranked = [...votes].sort((a, b) => b[1] - a[1])
    if (ranked.length === 0) {
      if (layer.required) problems.push(`${id}: no ${layer.type} district`)
      continue
    }
    const [top, topVotes] = ranked[0]
    if (!layer.required && topVotes < points.length / 2) continue // mostly outside, e.g. MWRD's edge
    districtIds.push(top)
    if (ranked.length > 1 && ranked[1][1] / points.length >= SPLIT_THRESHOLD) {
      splits.push({
        precinct: id,
        layer: layer.type,
        shares: Object.fromEntries(
          ranked.map(([d, v]) => [
            d,
            Math.round((v / points.length) * 100) / 100,
          ]),
        ),
      })
    }
  }
  precincts.push({ id, name, districtIds: [...new Set(districtIds)] })
  shapes.features.push({ type: 'Feature', properties: { id }, geometry })
}

for (const f of (await loadBoundary('chicago-precincts')).features) {
  const ward = Number(f.properties.ward)
  const precinct = Number(f.properties.precinct)
  addPrecinct(
    `chicago:${f.properties.ward_precinct}`,
    `Chicago Ward ${ward} Precinct ${precinct}`,
    f.geometry as AreaGeometry,
    [ocd.CHICAGO, ocd.chicagoWard(ward), ocd.chicagoPrecinct(ward, precinct)],
  )
}

for (const f of (await loadBoundary('suburban-precincts')).features) {
  const name = String(f.properties.name)
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
  addPrecinct(
    `cook:${f.properties.precinctid}`,
    name,
    f.geometry as AreaGeometry,
    [],
  )
}

await writeJson(join(BUILD, 'precincts.json'), {
  generatedAt: new Date().toISOString(),
  precincts,
})
await writeJson(join(BUILD, 'precinct-shapes.geojson'), shapes)
await writeJson(join(BUILD, 'precinct-audit.json'), { problems, splits })

console.log(`${precincts.length} precincts`)
console.log(`${problems.length} problems${problems.length ? ':' : ''}`)
for (const problem of problems.slice(0, 30)) console.log(`  ${problem}`)
console.log(
  `${splits.length} possible splits (see data/build/precinct-audit.json)`,
)
