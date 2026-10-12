// Converts the Clerk's per-split jurisdictions (fetch-clerk-precincts.ts) into
// our district IDs for the layers in CLERK_LAYERS (including taxing districts,
// which referenda are placed by), and reports where they
// disagree with the boundary maps. Names that don't match a district
// on our maps are reported and skipped, so the map is used for that layer.
//
// Each split's sample ballot (fetch-clerk-ballots.ts) then settles what the
// jurisdiction lists leave out or get wrong: sanitary districts and judicial
// subcircuits (not listed), the districts of every candidate race (the lists
// once disagree with the ballots, and 132 precincts have none) and of every
// local referendum (a question is on exactly the ballot styles whose text
// matches it). The ballot style is the official ballot, so it wins over the
// lists and the maps.
// Run: node scripts/build-clerk-precincts.ts

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Contest, OcdId, Precinct } from '../src/shared/ballot.ts'
import {
  CLERK_LAYERS,
  type ClerkSplit,
  type LayerDistrict,
} from '../src/shared/cook.ts'
import * as ocd from '../src/shared/ocd.ts'
import type { ClerkPrecinct } from './fetch-clerk-precincts.ts'
import {
  BUILD,
  RAW,
  readJson,
  writeJson,
  type FeatureCollection,
} from './lib/data.ts'
import {
  appears,
  ballotText as indexBallot,
  MATCH,
  normalize,
  QuestionMatcher,
  UNSURE,
  type BallotText,
} from './lib/ballot-text.ts'
import { loadBoundary, loadLayers } from './lib/layers.ts'
import {
  bbox,
  bboxContains,
  containsPoint,
  gridPoints,
  type AreaGeometry,
  type BBox,
} from '../src/shared/geo.ts'

/** "36th District" → 36 */
const districtNumber = (s: string) =>
  Number(s.match(/^(\d+)(st|nd|rd|th)\b/)?.[1])

const CONVERT: Record<string, [string, (name: string) => OcdId | null]> = {
  USREP: ['congressional', (s) => ocd.congressionalDistrict(districtNumber(s))],
  ILLEG: ['state senate', (s) => ocd.stateSenateDistrict(districtNumber(s))],
  ILREP: ['state house', (s) => ocd.stateHouseDistrict(districtNumber(s))],
  COBRD: ['county board', (s) => ocd.countyBoardDistrict(districtNumber(s))],
  BDREV: [
    'board of review',
    (s) => ocd.boardOfReviewDistrict(districtNumber(s)),
  ],
  MUNIS: ['municipality', (s) => ocd.municipality(s)],
  TWNSP: ['township', (s) => ocd.cookTownship(s.replace(/ Township$/, ''))],
  MWRDG: ['water reclamation', () => ocd.MWRD],
  // Township trustees of schools; "Lake County Trustee of Schools" marks
  // school districts run by Lake County's Regional Office of Education.
  TTSTR: [
    'regional office of education',
    (s) => {
      const county = s.match(/^(\w+) County Trustees? of Schools$/)?.[1]
      return county ? ocd.regionalOfficeOfEducation(county) : null
    },
  ],
}
/** Township trustees (TTSTR entries that aren't a county) have no layer. */
const isTownshipTrustee = (j: string) =>
  /^TTSTR: /.test(j) && !/^TTSTR: \w+ County Trustees? of Schools$/.test(j)

/**
 * Taxing districts (for referenda). Their names differ between the Clerk and
 * County GIS ("Flossmoor School District 161" vs "SCHOOL DISTRICT 161"), so
 * each name is matched only against the districts of that layer that overlap
 * the precinct on the map: by district number for schools and colleges, by
 * the remaining name words for the rest.
 */
const TAX: Record<string, string> = {
  ELEMS: 'tax-elementary-school',
  HIGHS: 'tax-high-school',
  UNITS: 'tax-unit-school',
  CMCOL: 'tax-community-college',
  PARKD: 'tax-park',
  LIBRD: 'tax-library',
  FIRED: 'tax-fire-protection',
}
const SCHOOL_LAYERS = [
  'tax-elementary-school',
  'tax-high-school',
  'tax-unit-school',
]

// Leaving these out means the precinct isn't in one (no municipality means
// unincorporated). Other layers are only replaced when the Clerk names a
// district: every voter is in one district of most layers, and the Clerk's
// park, library and fire district lists are incomplete (Worth 47 is in the
// Hometown Fire Protection District but the Clerk doesn't list it).
// The Clerk lists a county Regional Office of Education only for school
// districts run by another county's office (checked against every ballot
// style for Nov 3, 2026), so no entry means none.
const OPTIONAL = new Set([
  'municipality',
  'water reclamation',
  'regional office of education',
])

const numbers = (s: string) =>
  new Set(s.toUpperCase().match(/\b\d+[A-Z]?\b/g) ?? [])
const STOP = new Set(
  'PARK DISTRICT DIST PUBLIC LIBRARY FIRE PROTECTION PROT THE OF AND COMMUNITY COMM TOWNSHIP TWP VILLAGE CITY'.split(
    ' ',
  ),
)
const words = (s: string) =>
  new Set(
    s
      .toUpperCase()
      .replace(/&/g, ' AND ')
      .replace(/[^A-Z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !STOP.has(w)),
  )

interface TaxArea {
  ocdId: OcdId
  name: string
  geometry: AreaGeometry
  box: BBox
}

/** The candidate whose name matches the Clerk's, if exactly one does best. */
function matchTax(
  layer: string,
  clerkName: string,
  candidates: TaxArea[],
): OcdId | null {
  if (
    layer === 'tax-park' ||
    layer === 'tax-library' ||
    layer === 'tax-fire-protection'
  ) {
    const want = words(clerkName)
    const score = (a: TaxArea) => {
      const have = words(a.name)
      const shared = [...want].filter((w) => have.has(w)).length
      return shared / Math.max(want.size, have.size, 1)
    }
    const ranked = candidates
      .map((a) => ({ a, score: score(a) }))
      .sort((x, y) => y.score - x.score)
    const [best, next] = ranked
    if (!best || best.score < 0.5 || (next && next.score === best.score))
      return null
    return best.a.ocdId
  }
  const want = numbers(clerkName)
  const hits = candidates.filter((a) =>
    [...numbers(a.name)].some((n) => want.has(n)),
  )
  return hits.length === 1 ? hits[0].ocdId : null
}

const layers = await loadLayers()
const known = new Map(
  layers.map((l) => [l.type, new Set(l.areas.map((a) => a.value))]),
)

const taxAreas = new Map<string, TaxArea[]>()
for (const layer of Object.values(TAX)) {
  const collection = await loadBoundary(layer)
  taxAreas.set(
    layer,
    collection.features
      .filter((f) => f.geometry)
      .map((f) => {
        const p = f.properties
        const geometry = f.geometry as AreaGeometry
        return {
          ocdId: ocd.cookTaxDistrict(ocd.taxCode(Number(p.AGENCY))),
          name: String(
            p.AGENCY_DESCRIPTION ?? p.MAX_AGENCY_DESC ?? p.AGENCY_DESC ?? '',
          ),
          geometry,
          box: bbox(geometry),
        }
      }),
  )
}
const shapes = new Map(
  (
    await readJson<FeatureCollection>(join(BUILD, 'precinct-shapes.geojson'))
  ).features.map((f) => [String(f.properties.id), f.geometry as AreaGeometry]),
)
/** Tax districts of a layer that overlap the precinct on the map. */
function overlapping(precinctId: string, layer: string): TaxArea[] {
  const shape = shapes.get(precinctId)
  if (!shape) return []
  const points = gridPoints(shape, 80)
  return (taxAreas.get(layer) ?? []).filter((a) =>
    points.some(
      (pt) => bboxContains(a.box, pt) && containsPoint(a.geometry, pt),
    ),
  )
}

// Sample ballot text per ballot style, in pdftotext's default and -layout
// readings (fetch-clerk-ballots.ts).
const ballotDir = join(RAW, 'clerk-ballots')
const ballots = new Map<string, BallotText>()
if (existsSync(ballotDir)) {
  for (const file of await readdir(ballotDir)) {
    const style = file.match(/^(.+)\.txt$/)?.[1]
    if (!style || style.endsWith('.layout')) continue
    const readings = [await readFile(join(ballotDir, file), 'utf8')]
    const layout = join(ballotDir, `${style}.layout.txt`)
    if (existsSync(layout)) readings.push(await readFile(layout, 'utf8'))
    ballots.set(style, indexBallot(readings))
  }
} else {
  console.log(
    'No ballot text (run fetch-clerk-ballots.ts): sanitary districts, subcircuits and referenda use the lists and maps',
  )
}
const ballotWords = new Map(
  [...ballots].map(([style, b]) => [style, ` ${b.words.join(' ')} `]),
)
const sanitary = (await loadBoundary('tax-sanitary')).features.map((f) => ({
  ocdId: ocd.cookTaxDistrict(ocd.taxCode(Number(f.properties.AGENCY))),
  name: ` ${normalize(String(f.properties.MAX_AGENCY_DESC))} `,
}))

const layerOfDistrict = new Map<OcdId, string>()
for (const l of layers)
  for (const a of l.areas) layerOfDistrict.set(a.value, l.type)
const { contests } = await readJson<{ contests: Contest[] }>(
  join(BUILD, 'contests', 'cook-clerk.json'),
)
// Local referenda placed by a map layer (countywide questions are on every ballot).
const referenda = contests.filter(
  (c): c is Extract<Contest, { kind: 'measure' }> =>
    c.kind === 'measure' && layerOfDistrict.has(c.districtId),
)
// Built from every suburban question, as in the audit that set the thresholds.
const matcher = new QuestionMatcher(
  contests.flatMap((c) => (c.kind === 'measure' ? [c.question] : [])),
)
// Layers whose districts the ballot shows by their candidate races. The
// Clerk's lists leave out subcircuits and occasionally disagree with the
// Clerk's own ballots (Calumet 12's list says State House 34th, its ballot
// has the 33rd), and 132 precincts have no lists at all.
const RACE_LAYERS = [
  'congressional',
  'state senate',
  'state house',
  'county board',
  'board of review',
  'judicial subcircuit',
  'water reclamation',
]
/** Layers where every voter is in one district (none printed: a district without a 2026 race). */
const EVERY_VOTER = new Set(
  RACE_LAYERS.filter((l) => l !== 'water reclamation'),
)
/** Candidate names per district with a 2026 race, by layer. */
const raceNames = new Map<string, Map<OcdId, string[]>>(
  RACE_LAYERS.map((l) => [l, new Map()]),
)
for (const c of contests) {
  const byDistrict = raceNames.get(layerOfDistrict.get(c.districtId) ?? '')
  if (c.kind !== 'candidate' || !byDistrict) continue
  const names = byDistrict.get(c.districtId) ?? []
  names.push(
    ...c.candidates
      .map((x) => normalize(x.name))
      .filter((n) => n && n !== 'no candidate'),
  )
  byDistrict.set(c.districtId, names)
}
/** A layer's districts in the precinct on the map, largest share first. */
function mapShares(precinctId: string, layer: string): OcdId[] {
  const shape = shapes.get(precinctId)
  const areas = layers.find((l) => l.type === layer)?.areas ?? []
  if (!shape) return []
  const counts = new Map<OcdId, number>()
  for (const pt of gridPoints(shape, 80)) {
    for (const a of areas) {
      if (bboxContains(a.bbox, pt) && containsPoint(a.geometry, pt))
        counts.set(a.value, (counts.get(a.value) ?? 0) + 1)
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}

const overlayMain = new Map(
  (
    await readJson<{ precincts: Precinct[] }>(join(BUILD, 'precincts.json'))
  ).precincts.map((p) => [p.id, p.districtIds]),
)

/** Things the ballot text couldn't settle, for the report. */
const unsure: string[] = []
const fromBallotCounts = { referendaAdded: 0, referendaRemoved: 0 }

/**
 * Settles layers from the split's ballot style: sanitary districts (named in
 * their trustee race's heading), each race layer (the district whose
 * candidates are printed; none printed means one without a 2026 race) and
 * every layer with a local referendum (the question's district is in the
 * split exactly when the question is on its ballot). Layers it can't settle
 * are left as they are.
 */
function fromBallot(
  precinctId: string,
  style: string,
  districts: LayerDistrict[],
  covers: string[],
) {
  const ballot = ballots.get(style)!
  const words = ballotWords.get(style)!
  const settle = (layer: string, ids: OcdId[]) => {
    for (let i = districts.length - 1; i >= 0; i--)
      if (districts[i].layer === layer) districts.splice(i, 1)
    for (const ocdId of ids) districts.push({ ocdId, layer })
    if (!covers.includes(layer)) covers.push(layer)
  }

  settle(
    'tax-sanitary',
    sanitary.filter((a) => words.includes(a.name)).map((a) => a.ocdId),
  )

  // Race layers: a district is on the ballot when more than half of its
  // candidates are printed.
  for (const [layer, byDistrict] of raceNames) {
    const printed: OcdId[] = []
    let doubtful = false
    for (const [id, names] of byDistrict) {
      if (!names.length) continue
      const found = names.filter((n) => appears(ballot.words, n)).length
      if (found > names.length / 2) printed.push(id)
      else if (found > 0) {
        doubtful = true
        unsure.push(
          `${precinctId}: ${found}/${names.length} candidates of ${id.split('/').pop()}`,
        )
      }
    }
    if (doubtful) continue
    if (printed.length || !EVERY_VOTER.has(layer)) {
      settle(layer, printed)
      continue
    }
    // None printed: a district without a 2026 race. Keep the split's or the
    // map's if it has none; else the one without races the map overlaps most.
    const current = [
      ...districts.filter((d) => d.layer === layer).map((d) => d.ocdId),
      ...(overlayMain.get(precinctId) ?? []).filter(
        (id) => layerOfDistrict.get(id) === layer,
      ),
      ...mapShares(precinctId, layer),
    ]
    const quiet = current.find((id) => !byDistrict.has(id))
    if (quiet) settle(layer, [quiet])
    else
      unsure.push(
        `${precinctId}: no ${layer} race printed, and the lists and map show only districts with one`,
      )
  }

  // Referenda, layer by layer: keep the split's districts of the layer, then
  // add or remove each referendum's district by whether it's on the ballot.
  const byLayer = new Map<string, typeof referenda>()
  for (const r of referenda) {
    const layer = layerOfDistrict.get(r.districtId)!
    byLayer.set(layer, [...(byLayer.get(layer) ?? []), r])
  }
  for (const [layer, list] of byLayer) {
    const scores = list.map((r) => matcher.score(r.question, ballot))
    const doubtful = list.filter(
      (_, i) => scores[i] > UNSURE && scores[i] < MATCH,
    )
    if (doubtful.length) {
      for (const r of doubtful)
        unsure.push(
          `${precinctId}: "${r.title}" scores between ${UNSURE} and ${MATCH}`,
        )
      continue
    }
    const on = new Set(
      list.filter((_, i) => scores[i] >= MATCH).map((r) => r.districtId),
    )
    const off = new Set(
      list.map((r) => r.districtId).filter((id) => !on.has(id)),
    )
    const kept = districts
      .filter((d) => d.layer === layer && !off.has(d.ocdId))
      .map((d) => d.ocdId)
    fromBallotCounts.referendaRemoved += districts.filter(
      (d) => d.layer === layer && off.has(d.ocdId),
    ).length
    const added = [...on].filter((id) => !kept.includes(id))
    fromBallotCounts.referendaAdded += added.length
    settle(layer, [...kept, ...added])
  }
}

const unmatched = new Map<string, number>()
const precincts: Record<string, ClerkSplit[]> = {}
const dir = join(RAW, 'clerk-precincts')
for (const file of (await readdir(dir)).sort()) {
  const raw = await readJson<ClerkPrecinct>(join(dir, file))
  precincts[raw.precinct] = raw.splits.map((s) => {
    const districts: LayerDistrict[] = []
    // A layer whose names didn't all match stays map-based.
    const failed = new Set<string>()
    for (const j of s.jurisdictions) {
      if (isTownshipTrustee(j)) continue
      const [type, ...rest] = j.split(': ')
      const name = rest.join(': ').trim()
      const taxLayer = TAX[type]
      const convert = CONVERT[type]
      if (!convert && !taxLayer) continue
      const layer = taxLayer ?? convert[0]
      const ocdId = taxLayer
        ? matchTax(taxLayer, name, overlapping(raw.precinct, taxLayer))
        : convert[1](name)
      if (!ocdId || !known.get(layer)?.has(ocdId)) {
        unmatched.set(j, (unmatched.get(j) ?? 0) + 1)
        failed.add(layer)
      } else if (!districts.some((d) => d.ocdId === ocdId)) {
        districts.push({ ocdId, layer })
      }
    }
    // With no districts at all, the Clerk has nothing for the split: use the maps.
    // School layers go together: a unit district replaces elementary and high.
    const has = (l: string) => districts.some((d) => d.layer === l)
    const schools =
      SCHOOL_LAYERS.some(has) && !SCHOOL_LAYERS.some((l) => failed.has(l))
    const covers = districts.length
      ? CLERK_LAYERS.filter(
          (l) =>
            !failed.has(l) &&
            (OPTIONAL.has(l) ||
              has(l) ||
              (schools && SCHOOL_LAYERS.includes(l))),
        )
      : []
    // The ballot style settles more, when there's exactly one with text.
    if (s.styles.length === 1 && ballots.has(s.styles[0]))
      fromBallot(raw.precinct, s.styles[0], districts, covers)
    return { split: s.split, districts, covers }
  })
}
await writeJson(join(BUILD, 'clerk-precincts.json'), { precincts })

// Compare with the map overlay's main districts per precinct.
const { precincts: overlay } = await readJson<{ precincts: Precinct[] }>(
  join(BUILD, 'precincts.json'),
)
const layerOf = new Map<OcdId, string>()
for (const l of layers) for (const a of l.areas) layerOf.set(a.value, l.type)
const disagree = new Map<string, string[]>()
let withData = 0
for (const p of overlay) {
  const splits = precincts[p.id]?.filter((s) => s.districts.length)
  if (!splits?.length) continue
  withData++
  const onMap = new Set(p.districtIds)
  for (const d of splits[0].districts) {
    if (onMap.has(d.ocdId)) continue
    const mapId = p.districtIds.find((id) => layerOf.get(id) === d.layer)
    const list = disagree.get(d.layer) ?? []
    list.push(
      `${p.id} ${p.name}: map ${mapId?.split('/').pop() ?? 'none'}, Clerk ${d.ocdId.split('/').pop()}`,
    )
    disagree.set(d.layer, list)
  }
}

const suburban = overlay.filter((p) => p.id.startsWith('cook:')).length
console.log(`${withData}/${suburban} suburban precincts have Clerk districts`)
console.log(
  `${Object.values(precincts).filter((s) => s.length > 1).length} precincts have more than one split`,
)
console.log('\nPrecincts where the Clerk disagrees with the map, by layer:')
for (const [layer, list] of disagree) {
  console.log(`  ${layer}: ${list.length}`)
  for (const line of list.slice(0, 5)) console.log(`    ${line}`)
}
console.log(
  '\nClerk names not matched to a district on our maps (map used instead):',
)
for (const [name, n] of [...unmatched].sort((a, b) => b[1] - a[1]))
  console.log(`  ${n}× ${name}`)
console.log(
  `\nFrom the ballot styles: ${fromBallotCounts.referendaAdded} referendum districts added and ${fromBallotCounts.referendaRemoved} removed compared with the Clerk's lists`,
)
console.log(
  `Not settled by the ballot text (lists and maps used): ${unsure.length}`,
)
for (const line of unsure) console.log(`  ${line}`)
