// Chicago ballots from the Board of Election Commissioners' own precinct
// lists, the Chicago counterpart of build-clerk-precincts.ts.
// The precinct and district maps come from different publishers and don't
// line up exactly, so address points near a precinct's edge can land in the
// neighbouring district. For each Chicago precinct this corrects every
// address point's map districts against the official lists, then writes the
// distinct results as the precinct's splits; the Worker picks the split that
// best matches an address's map districts (applyClerkSplits).
//
// Per layer, a point's map district is, in order:
// - replaced as chicago-overrides.ts says, for the few precincts that need a
//   decision;
// - kept if the official lists put the precinct in it, or if it has no
//   contest in 2026 (the lists can't say anything about it). In layers where
//   every district elects in 2026 (FULLY_ELECTED), a district the lists don't
//   name at all is a map error and is replaced like any other;
// - replaced by the precinct's district if the lists name exactly one;
// - replaced by the nearest of the precinct's districts if they name several;
// - replaced by the precinct's most common map district without a contest if
//   the lists don't name the precinct in this layer at all.
// Districts the lists name for a precinct that no address gets are reported:
// they need an override.
// Run after data:fetch: node scripts/build-chicago-precincts.ts

import { join } from 'node:path'
import type { OcdId } from '../src/shared/ballot.ts'
import type { ClerkSplit, LayerDistrict } from '../src/shared/cook.ts'
import type { Area } from '../src/shared/geo.ts'
import type { LatLng } from '../src/shared/provider.ts'
import { CHICAGO_NO_VOTERS, CHICAGO_OVERRIDES } from './chicago-overrides.ts'
import { withReferendumAreas } from './chicago-referendum-areas.ts'
import {
  chicagoPoints,
  FULLY_ELECTED,
  listedLayers,
  loadOfficialLists,
  precinctId,
  type ChicagoPoint,
} from './lib/chicago.ts'
import { BUILD, writeJson } from './lib/data.ts'

const lists = await loadOfficialLists()
const layers = await listedLayers(lists)
const points = await chicagoPoints(layers)

const byPrecinct = new Map<string, ChicagoPoint[]>()
for (const p of points) {
  const list = byPrecinct.get(p.precinct) ?? []
  list.push(p)
  byPrecinct.set(p.precinct, list)
}

/** Approximate distance in metres from a point to the edge of an area. */
function distance(point: LatLng, area: Area<OcdId>): number {
  const kx = Math.cos((point.lat * Math.PI) / 180) * 111_320
  const ky = 110_540
  const polygons =
    area.geometry.type === 'Polygon'
      ? [area.geometry.coordinates]
      : area.geometry.coordinates
  let best = Infinity
  for (const polygon of polygons)
    for (const ring of polygon)
      for (let i = 1; i < ring.length; i++) {
        const [ax, ay] = [
          (ring[i - 1][0] - point.lng) * kx,
          (ring[i - 1][1] - point.lat) * ky,
        ]
        const [bx, by] = [
          (ring[i][0] - point.lng) * kx,
          (ring[i][1] - point.lat) * ky,
        ]
        const [dx, dy] = [bx - ax, by - ay]
        const t = Math.max(
          0,
          Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)),
        )
        best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy))
      }
  return best
}

type Result = OcdId | OcdId[] | undefined

const short = (id: string | undefined) => id?.replace(/^.*\//, '') ?? 'none'
const missed: string[] = []
let corrected = 0
const precincts: Record<string, ClerkSplit[]> = {}

for (const [key, rows] of [...byPrecinct].sort()) {
  const results: Result[][] = rows.map((row) => [...row.districts])
  layers.forEach((layer, i) => {
    const contested = lists.districts.get(layer.type)!
    const listed = [...contested]
      .filter(([, ps]) => ps.has(key))
      .map(([d]) => d)
    const counts = new Map<OcdId | undefined, number>()
    for (const row of rows)
      counts.set(row.districts[i], (counts.get(row.districts[i]) ?? 0) + 1)
    const uncontested = [...counts]
      .filter(([d]) => d && !contested.has(d))
      .sort((a, b) => b[1] - a[1])[0]?.[0]
    const overrides = CHICAGO_OVERRIDES[key]?.[layer.type] ?? {}
    const listedAreas = layer.areas.filter((a) => listed.includes(a.value))

    const fix = (map: OcdId | undefined, point: LatLng): Result => {
      const override = overrides[map ?? 'none']
      if (override) return override
      if (map && listed.includes(map)) return map
      if (map && !contested.has(map) && !FULLY_ELECTED.has(layer.type))
        return map
      if (listed.length === 1) return listed[0]
      if (listed.length > 1)
        return listedAreas.reduce((a, b) =>
          distance(point, a) <= distance(point, b) ? a : b,
        ).value
      return uncontested
    }
    rows.forEach((row, n) => {
      const fixed = fix(row.districts[i], row.point)
      if (fixed !== row.districts[i]) corrected++
      results[n][i] = fixed
    })
    const noVoters = CHICAGO_NO_VOTERS[key]?.[layer.type] ?? []
    for (const d of listed)
      if (
        !noVoters.includes(d) &&
        !results.some((r) => [r[i]].flat().includes(d))
      )
        missed.push(
          `${key} ${layer.type}: listed ${short(d)}, map ${[...counts].map(([d, n]) => `${short(d)} ${n}`).join(', ')}`,
        )
  })

  // One split per distinct result. Map districts corrected into a split are
  // kept as match-only districts, so the Worker picks this split for those
  // addresses rather than finding several equally good ones.
  const splits = new Map<string, LayerDistrict[]>()
  results.forEach((result, n) => {
    const districts: LayerDistrict[] = layers.flatMap((layer, i) =>
      [result[i]]
        .flat()
        .filter((d) => d !== undefined)
        .map((ocdId) => ({ ocdId, layer: layer.type })),
    )
    const id = districts.map((d) => d.ocdId).join(' ')
    const split = splits.get(id) ?? districts
    layers.forEach((layer, i) => {
      const map = rows[n].districts[i]
      if (
        map &&
        ![result[i]].flat().includes(map) &&
        !split.some((d) => d.ocdId === map)
      )
        split.push({ ocdId: map, layer: layer.type, matchOnly: true })
    })
    splits.set(id, split)
  })
  // Program areas the Board publishes no precinct list for, by community
  // area (chicago-referendum-areas.ts); edge precincts are only "possible".
  precincts[precinctId(key)] = withReferendumAreas(
    key,
    [...splits.values()].map((districts, n) => ({
      split: String(n + 1),
      districts,
      covers: layers.map((l) => l.type),
    })),
  )
}

await writeJson(join(BUILD, 'chicago-precincts.json'), {
  generatedAt: new Date().toISOString(),
  precincts,
  missed,
})

const splitCount = Object.values(precincts).filter((s) => s.length > 1).length
console.log(
  `${Object.keys(precincts).length} Chicago precincts (${splitCount} with several splits); ` +
    `${corrected} address point districts corrected`,
)
console.log(
  `${missed.length} listed districts no address gets (need an override in scripts/chicago-overrides.ts)`,
)
for (const line of missed) console.log('  ' + line)
