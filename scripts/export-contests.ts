// Writes the public race list, content/contests/{election date}.json, from
// the official contest lists in data/build/contests/ (npm run data:build).
// Committed, so the site can build a page for every race without the
// database. Incumbent labels come from content/incumbents/ as on the ballot.
// Run after data:build or data:incumbents changes the contests.
//
// Run: npm run contests:export

import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Contest } from '../src/shared/ballot.ts'
import { CURRENT_ELECTION } from '../src/shared/cook.ts'
import type { RaceList } from '../src/shared/races.ts'
import { BUILD, ROOT, readJson } from './lib/data.ts'
import { withIncumbents, type Incumbents } from './lib/incumbents.ts'
import {
  PROFILES_DIR,
  readProfiles,
  writeFormattedJson,
} from './lib/profiles/content.ts'
import { buildRaces } from './lib/races.ts'

const date = CURRENT_ELECTION.date
const INCUMBENTS = join(ROOT, 'content', 'incumbents', `${date}.json`)
const OUT = join(ROOT, 'content', 'contests', `${date}.json`)

const contests: Contest[] = []
for (const file of (await readdir(join(BUILD, 'contests'))).sort()) {
  const data = await readJson<{ contests: Contest[] }>(
    join(BUILD, 'contests', file),
  )
  contests.push(...data.contests)
}
const incumbents: Incumbents = existsSync(INCUMBENTS)
  ? await readJson<Incumbents>(INCUMBENTS)
  : {}

// Addresses already out in the world stay as they are.
const previous = new Map<string, string>()
if (existsSync(OUT))
  for (const race of (await readJson<RaceList>(OUT)).races)
    for (const id of race.contestIds) previous.set(id, race.path)

const races = buildRaces(withIncumbents(contests, incumbents), date, previous)

// Every profile should belong to a race on the list.
const raceOf = new Map(races.flatMap((r) => r.contestIds.map((id) => [id, r])))
const profiles = await readProfiles(PROFILES_DIR)
const orphans = [...profiles.values()].filter(
  (p) => !p.sample && !p.contestIds.some((id) => raceOf.has(id)),
)
if (orphans.length)
  console.warn(`Profiles in no race: ${orphans.map((p) => p.key).join(', ')}`)

const list: RaceList = {
  electionId: CURRENT_ELECTION.id,
  electionName: CURRENT_ELECTION.name,
  date,
  area: 'Cook County, Illinois',
  areaPath: `il/cook-county/${date}`,
  races,
}
await writeFormattedJson(OUT, list)
console.log(
  `Wrote ${races.length} races (${races.filter((r) => r.ballots.length > 1).length} on both ballots) to ${OUT}`,
)
