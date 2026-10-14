// Checks Los Angeles County's lookup against the Registrar's own address
// list. For a random sample of County address points, the ballot style a
// lookup gives (the style of the map precinct containing the point, from
// build-la.ts) should be the style the Interactive Sample Ballot's street
// segments give that exact address. Also counts sampled addresses outside
// every precinct or in a precinct without a ballot style.
// Writes data/build/la/audit.json.
// Run after build-la.ts: node scripts/la/audit-la.ts [sample size, default 50000]

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ClerkSplit } from '../../src/shared/cook.ts'
import type { AreaGeometry } from '../../src/shared/geo.ts'
import {
  BUILD,
  RAW,
  readJson,
  writeJson,
  type FeatureCollection,
} from '../lib/data.ts'
import { AreaGrid, loadSegments, segmentStyle } from './segments.ts'

const SAMPLE = Number(process.argv[2] ?? 50_000)
const segments = await loadSegments(
  join(RAW, 'la', 'isb', '4348', 'street-segments'),
)
const shapes = await readJson<FeatureCollection>(
  join(BUILD, 'la', 'precinct-shapes.geojson'),
)
const grid = new AreaGrid(
  shapes.features.map((f) => ({
    value: String(f.properties.id),
    geometry: f.geometry as AreaGeometry,
  })),
)
const { precincts: splits } = await readJson<{
  precincts: Record<string, ClerkSplit[]>
}>(join(BUILD, 'la', 'precinct-splits.json'))

const lines = (await readFile(join(BUILD, 'la', 'address-points.tsv'), 'utf8'))
  .split('\n')
  .slice(1)
  .filter(Boolean)
// A fixed-seed sample so reruns check the same addresses.
let seed = 20261103
const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
const sample = Array.from(
  { length: Math.min(SAMPLE, lines.length) },
  () => lines[Math.floor(random() * lines.length)],
)

let outside = 0
let noStyle = 0
let notInSegments = 0
let segmentsDisagree = 0
let agree = 0
const disagree: string[] = []
for (const line of sample) {
  const [address, , zip, lat, lng] = line.split('\t')
  const precincts = grid.find({ lat: Number(lat), lng: Number(lng) })
  if (!precincts.length) {
    outside++
    continue
  }
  const styles = new Set(
    precincts.flatMap((p) => (splits[p] ?? []).map((s) => s.split)),
  )
  if (!styles.size) {
    noStyle++
    continue
  }
  const official = segmentStyle(segments, address, zip)
  if (official === undefined) {
    notInSegments++
    continue
  }
  if (official === null) {
    segmentsDisagree++
    continue
  }
  if (styles.has(official)) agree++
  else
    disagree.push(
      `${address} ${zip}: ${precincts.join('/')} has ${[...styles].join('/')}, street list says ${official}`,
    )
}

const checked = agree + disagree.length
const report = {
  sampled: sample.length,
  outsideEveryPrecinct: outside,
  inPrecinctWithoutBallotStyle: noStyle,
  notInStreetSegments: notInSegments,
  streetSegmentsDisagree: segmentsDisagree,
  checked,
  agree,
  disagree: disagree.length,
  agreeRate: checked ? +(agree / checked).toFixed(4) : null,
  disagreeExamples: disagree.slice(0, 50),
}
await writeJson(join(BUILD, 'la', 'audit.json'), report)
console.log(
  JSON.stringify(
    { ...report, disagreeExamples: report.disagreeExamples.slice(0, 10) },
    null,
    2,
  ),
)
