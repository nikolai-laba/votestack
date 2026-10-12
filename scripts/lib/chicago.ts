// The Chicago Board of Election Commissioners' own lists of precincts per
// district, and the walk over Chicago address points that the
// audit and the precinct builder share. Sources (see data/README.md):
// - per-precinct results of the March 17, 2026 primary (same precinct map as
//   November), which list the precincts voting in each Congress, state
//   legislature, county board, Board of Review and subcircuit contest, saved
//   to data/raw/chicago/primary-2026-dem-districts.json;
// - the Board's school board district schedule (February 9, 2026), which marks
//   split precincts "(pt)". Needs `pdftotext`.
// Only districts with a contest appear in the primary lists (e.g. the
// subcircuits with a 2026 vacancy).

import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { OcdId } from '../../src/shared/ballot.ts'
import { bboxContains, findContaining } from '../../src/shared/geo.ts'
import * as ocd from '../../src/shared/ocd.ts'
import type { LatLng } from '../../src/shared/provider.ts'
import { RAW, readJson } from './data.ts'
import { loadBoundary, loadLayers, toAreas, type Layer } from './layers.ts'

const DIR = join(RAW, 'chicago')
const ordinal = (s: string) => Number(s.match(/(\d+)(st|nd|rd|th)/)?.[1])

/**
 * Layers where every district elects in 2026, so the lists name every
 * district any Chicago voter is in: a map district they don't list is a map
 * error, not a district without a race. (The Board's November candidate list
 * and both parties' primary results list the same districts.)
 */
export const FULLY_ELECTED = new Set([
  'congressional',
  'state house',
  'county board',
  'chicago school board',
])

export interface OfficialLists {
  /** Layer type (as in layers.ts) → district with a contest → "ward-precinct" keys. */
  districts: Map<string, Map<OcdId, Set<string>>>
  /** Precincts the school board schedule marks as split. */
  schoolBoardSplit: Set<string>
}

/** "ward-precinct", the key used in the official lists. */
export const precinctKey = (ward: number | string, precinct: number | string) =>
  `${Number(ward)}-${Number(precinct)}`

/** Our precinct ID (`chicago:WWPPP`) for an official key. */
export const precinctId = (key: string) => {
  const [ward, precinct] = key.split('-')
  return `chicago:${ward.padStart(2, '0')}${precinct.padStart(3, '0')}`
}

const PRIMARY_CONTESTS: [RegExp, string, (n: number) => OcdId][] = [
  [/^U\.S\. Representative/, 'congressional', ocd.congressionalDistrict],
  [/^State Senator/, 'state senate', ocd.stateSenateDistrict],
  [/^State Representative/, 'state house', ocd.stateHouseDistrict],
  [/^Commissioner, County Board/, 'county board', ocd.countyBoardDistrict],
  [/^Board of Review/, 'board of review', ocd.boardOfReviewDistrict],
  [/Subcircuit/, 'judicial subcircuit', ocd.judicialSubcircuit],
]

export async function loadOfficialLists(): Promise<OfficialLists> {
  const districts = new Map<string, Map<OcdId, Set<string>>>()
  const schoolBoardSplit = new Set<string>()
  const add = (layer: string, district: OcdId, key: string) => {
    if (!districts.has(layer)) districts.set(layer, new Map())
    const byDistrict = districts.get(layer)!
    if (!byDistrict.has(district)) byDistrict.set(district, new Set())
    byDistrict.get(district)!.add(key)
  }

  // Primary results: { contest name: "ward:p,p,...;ward:p,..." }
  const primary = await readJson<Record<string, string>>(
    join(DIR, 'primary-2026-dem-districts.json'),
  )
  for (const [contest, list] of Object.entries(primary)) {
    const match = PRIMARY_CONTESTS.find(([re]) => re.test(contest))
    if (!match) continue
    const district = match[2](ordinal(contest))
    for (const part of list.split(';')) {
      const [ward, precincts] = part.split(':')
      for (const p of precincts.split(','))
        add(match[1], district, precinctKey(ward, p))
    }
  }

  // School board schedule: "SCHOOL BOARD DISTRICT 1A" then
  // "Ward 29-Precincts: 1(pt), 2, …", continued on indented lines.
  const schedule = execFileSync(
    'pdftotext',
    [
      '-layout',
      join(DIR, 'District Schedule Chicago Elected School Board 2026.pdf'),
      '-',
    ],
    { encoding: 'utf8' },
  )
  let schoolDistrict: OcdId | null = null
  let ward = ''
  for (const line of schedule.split('\n')) {
    const heading = line.match(/SCHOOL BOARD DISTRICT (\d+[AB])/)
    if (heading) {
      schoolDistrict = ocd.chicagoSchoolBoardDistrict(heading[1])
      ward = ''
      continue
    }
    const wardLine = line.match(/Ward (\d+)-Precincts:(.*)/)
    if (wardLine) ward = wardLine[1]
    else if (!ward || !/^\s+\d/.test(line)) {
      if (!/^\s*$/.test(line)) ward = ''
      continue
    }
    for (const item of (wardLine ? wardLine[2] : line).split(',')) {
      const m = item.trim().match(/^(\d+)(\(pt\))?$/)
      if (!m || !schoolDistrict) continue
      add('chicago school board', schoolDistrict, precinctKey(ward, m[1]))
      if (m[2]) schoolBoardSplit.add(precinctKey(ward, m[1]))
    }
  }
  return { districts, schoolBoardSplit }
}

/** The map layers the official lists cover. */
export async function listedLayers(lists: OfficialLists): Promise<Layer[]> {
  return (await loadLayers()).filter((l) => lists.districts.has(l.type))
}

export interface ChicagoPoint {
  /** Official key, "ward-precinct". */
  precinct: string
  point: LatLng
  /** Map district per layer (undefined: outside every district of the layer). */
  districts: (OcdId | undefined)[]
}

/**
 * Every address point inside a Chicago precinct, with the precinct and its map
 * districts, as the live lookup finds them. Chosen by location, not by postal
 * city: some Chicago addresses have a suburban one (ELMWOOD PARK 60707), and
 * the source spells CHICAGO in mixed case too. Takes a few minutes.
 */
export async function chicagoPoints(layers: Layer[]): Promise<ChicagoPoint[]> {
  const precinctAreas = toAreas(await loadBoundary('chicago-precincts'), (p) =>
    precinctKey(String(p.ward), String(p.precinct)),
  )
  const chicago = precinctAreas
    .map((a) => a.bbox)
    .reduce((a, b) => [
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.max(a[2], b[2]),
      Math.max(a[3], b[3]),
    ])
  const tsv = await readFile(join(RAW, 'address-points.tsv'), 'utf8')
  const points: ChicagoPoint[] = []
  for (const row of tsv.split('\n').slice(1)) {
    const [, , , lat, lng] = row.split('\t')
    const point: LatLng = { lat: Number(lat), lng: Number(lng) }
    if (!bboxContains(chicago, point)) continue
    const [precinct] = findContaining(precinctAreas, point)
    if (!precinct) continue
    points.push({
      precinct,
      point,
      districts: layers.map((l) => findContaining(l.areas, point)[0]),
    })
  }
  return points
}
