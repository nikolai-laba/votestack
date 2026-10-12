// Chicago district audit: checks the districts every Chicago address
// point gets against the Board of Election Commissioners' own lists of
// precincts per district (see scripts/lib/chicago.ts). Chicago has no
// per-precinct sample ballots, so these lists are the ground truth. Audits the
// map districts alone, and, if data/build/chicago-precincts.json exists, the
// districts after the official corrections as the Worker applies them.
// Run after data:fetch (and build-chicago-precincts.ts): node scripts/audit-chicago.ts

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { OcdId } from '../src/shared/ballot.ts'
import {
  applyClerkSplits,
  type ClerkSplit,
  type LayerDistrict,
} from '../src/shared/cook.ts'
import {
  chicagoPoints,
  FULLY_ELECTED,
  listedLayers,
  loadOfficialLists,
  precinctId,
} from './lib/chicago.ts'
import { BUILD, readJson, writeJson } from './lib/data.ts'

const lists = await loadOfficialLists()
const layers = await listedLayers(lists)
const points = await chicagoPoints(layers)

const splitsFile = join(BUILD, 'chicago-precincts.json')
const splits = existsSync(splitsFile)
  ? (await readJson<{ precincts: Record<string, ClerkSplit[]> }>(splitsFile))
      .precincts
  : null

type Districts = (OcdId | undefined)[]

/** Districts per layer after applying the precinct's official splits. */
function corrected(precinct: string, districts: Districts): Districts {
  const map: LayerDistrict[] = layers.flatMap((l, i) =>
    districts[i] ? [{ ocdId: districts[i], layer: l.type }] : [],
  )
  const result = applyClerkSplits(map, splits?.[precinctId(precinct)] ?? [])
  // Several equally good splits means the lookup shows all their districts.
  return layers.map((l) => {
    const found = result.districts.filter((d) => d.layer === l.type)
    return found.length === 1
      ? found[0].ocdId
      : found.length
        ? 'ambiguous'
        : undefined
  })
}

// Only districts with a listed contest can be checked:
// - error: a point is in a district with a contest that doesn't list the
//   precinct (that voter would see a contest that isn't on their ballot);
// - missed: the precinct is listed for a district but no point is in it
//   (voters there would miss a contest);
// - split: the precinct is listed for a district and some points are in it,
//   the rest in districts without a contest. Expected where the precinct
//   really is split; can't be told apart without ballot styles.
const short = (id: string) => id.replace(/^.*\//, '')

function audit(districtsOf: (p: (typeof points)[number]) => Districts) {
  // Per layer: precinct → district (or "none") → points.
  const counts = layers.map(() => new Map<string, Map<string, number>>())
  for (const point of points) {
    districtsOf(point).forEach((d, i) => {
      const byDistrict = counts[i].get(point.precinct) ?? new Map()
      byDistrict.set(d ?? 'none', (byDistrict.get(d ?? 'none') ?? 0) + 1)
      counts[i].set(point.precinct, byDistrict)
    })
  }
  return layers.map((layer, i) => {
    const districts = lists.districts.get(layer.type)!
    const errors: Record<string, unknown> = {}
    const missed: Record<string, unknown> = {}
    const splits: Record<string, unknown> = {}
    let errorPoints = 0
    let checkedPoints = 0
    for (const [precinct, byDistrict] of counts[i]) {
      const listed = [...districts]
        .filter(([, ps]) => ps.has(precinct))
        .map(([d]) => d)
      const entry = {
        official: listed.map(short),
        ours: Object.fromEntries(
          [...byDistrict].map(([d, n]) => [short(d), n]),
        ),
      }
      let wrong = 0
      for (const [d, n] of byDistrict) {
        const hasContest = districts.has(d as OcdId)
        // Every district of a fully elected layer has a race, so one the
        // lists don't name can't be right.
        const unlisted = FULLY_ELECTED.has(layer.type) && !hasContest
        if (hasContest || listed.length || unlisted) checkedPoints += n
        if (
          d === 'ambiguous' ||
          unlisted ||
          (hasContest && !districts.get(d as OcdId)!.has(precinct))
        )
          wrong += n
      }
      if (wrong) {
        errors[precinct] = entry
        errorPoints += wrong
      } else if (listed.some((d) => !byDistrict.has(d)))
        missed[precinct] = entry
      else if (
        listed.length &&
        [...byDistrict.keys()].some((d) => !districts.has(d as OcdId))
      )
        splits[precinct] = entry
    }
    return {
      type: layer.type,
      districtsWithContests: districts.size,
      checkedPoints,
      errorPoints,
      errors,
      missed,
      splits,
    }
  })
}

const reports = {
  maps: audit((p) => p.districts),
  ...(splits && {
    corrected: audit((p) => corrected(p.precinct, p.districts)),
  }),
}

await writeJson(join(BUILD, 'chicago-audit.json'), {
  generatedAt: new Date().toISOString(),
  points: points.length,
  schoolBoardSplitPrecincts: lists.schoolBoardSplit.size,
  ...Object.fromEntries(
    Object.entries(reports).map(([name, r]) => [
      name,
      Object.fromEntries(r.map((l) => [l.type, l])),
    ]),
  ),
})

console.log(`${points.length} address points in Chicago precincts`)
for (const [name, report] of Object.entries(reports)) {
  console.log(`\n${name}:`)
  for (const r of report)
    console.log(
      `  ${r.type.padEnd(22)} ${String(r.districtsWithContests).padStart(2)} districts  ` +
        `errors: ${r.errorPoints}/${r.checkedPoints} points in ${Object.keys(r.errors).length} precincts  ` +
        `missed: ${Object.keys(r.missed).length}  plausible splits: ${Object.keys(r.splits).length}`,
    )
}
console.log('\nDetails: data/build/chicago-audit.json')
