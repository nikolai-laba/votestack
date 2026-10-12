// Prototype ballot lookup, entirely local: address → point (Cook County
// Address Points) → districts (point-in-polygon on each district map) and
// precinct → contests from data/build/contests/*.json.
// Run: node scripts/lookup.ts "121 N LaSalle St, Chicago, IL 60602" ["…"]
// Use public addresses (offices, libraries) when testing; never commit or
// share real voter addresses.

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Contest, OcdId } from '../src/shared/ballot.ts'
import { findContaining } from '../src/shared/geo.ts'
import { authorityFor, precinctDistricts } from '../src/shared/cook.ts'
import { BUILD, readJson, type FeatureCollection } from './lib/data.ts'
import { LocalGeocoder } from './lib/geocoder.ts'
import { EVERYWHERE, loadLayers, toAreas } from './lib/layers.ts'

const addresses = process.argv.slice(2)
if (addresses.length === 0) {
  console.error('Usage: node scripts/lookup.ts "<address>" ["<address>" …]')
  process.exit(1)
}

const [geocoder, layers, shapes, contestFiles] = await Promise.all([
  LocalGeocoder.load(),
  loadLayers(),
  readJson<FeatureCollection>(join(BUILD, 'precinct-shapes.geojson')),
  readdir(join(BUILD, 'contests')),
])
const precinctAreas = toAreas(shapes, (p) => String(p.id))
const contests: Contest[] = []
// Contests each source couldn't place in a district, by election authority.
const unmapped = new Map<OcdId, string[]>()
for (const file of contestFiles) {
  const data = await readJson<{ contests: Contest[]; unmapped: string[] }>(
    join(BUILD, 'contests', file),
  )
  contests.push(...data.contests)
  const authority = data.contests[0]?.authorityId
  if (authority) unmapped.set(authority, data.unmapped)
}

for (const address of addresses) {
  console.log(`\n${address}`)
  const point = await geocoder.geocode(address)
  if (!point) {
    console.log('  Not found in Cook County Address Points.')
    continue
  }
  const precinct = findContaining(precinctAreas, point)[0]
  const districts = new Set<OcdId>([
    ...EVERYWHERE,
    ...precinctDistricts(precinct),
  ])
  const authority = authorityFor(precinct).id
  for (const layer of layers) {
    for (const district of findContaining(layer.areas, point))
      districts.add(district)
  }

  const ballot = contests
    .filter((c) => c.authorityId === authority && districts.has(c.districtId))
    .sort((a, b) => (a.ballotOrder ?? 0) - (b.ballotOrder ?? 0))
  const missing = layers
    .filter((l) => l.required && !l.areas.some((a) => districts.has(a.value)))
    .map((l) => l.type)

  console.log(
    `  Point: ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)} (${point.precision})`,
  )
  console.log(`  Precinct: ${precinct ?? 'not found'}`)
  console.log(
    `  Districts: ${[...districts].map((d) => d.replace('ocd-division/country:us/state:il', 'IL')).join(', ')}`,
  )
  if (missing.length)
    console.log(`  No district found for: ${missing.join(', ')}`)
  const count = (kind: Contest['kind']) =>
    ballot.filter((c) => c.kind === kind).length
  console.log(
    `  Contests: ${count('candidate')} races, ${count('retention')} retention, ${count('measure')} referenda`,
  )
  for (const c of ballot.filter((c) => c.kind === 'candidate')) {
    console.log(
      `    - ${c.title} (${c.kind === 'candidate' ? c.candidates.length : 0} candidates)`,
    )
  }
  const gaps: string[] = []
  if (!precinct) gaps.push('No precinct found for this point')
  const notPlaced = unmapped.get(authority) ?? []
  if (notPlaced.length) {
    gaps.push(
      `${notPlaced.length} contests on this authority's list are not placed in districts yet`,
    )
  }
  for (const gap of gaps) console.log(`  Possible gap: ${gap}`)
}
