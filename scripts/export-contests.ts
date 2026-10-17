// Writes the public race list, content/contests/{election date}.json, from
// the official contest lists in data/build/contests/ (npm run data:build).
// Committed, so the site can build a page for every race without the
// database. Incumbent labels come from content/incumbents/ as on the ballot.
// Run after data:build or data:incumbents changes the contests.
//
// Run: npm run contests:export            (Cook County)
//      npm run contests:export -- --region=ca-la   (Los Angeles County,
//      from data/build/la/ after scripts/la/build-la.ts; written to
//      content/contests/ca-la/)

import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Contest } from '../src/shared/ballot.ts'
import { COOK } from '../src/shared/regions.ts'
import { regionFromArgs } from './lib/profiles/region.ts'
import type { RaceList } from '../src/shared/races.ts'
import { BUILD, ROOT, readJson } from './lib/data.ts'
import { withIncumbents, type Incumbents } from './lib/incumbents.ts'
import {
  PROFILES_DIR,
  readProfiles,
  writeFormattedJson,
} from './lib/profiles/content.ts'
import { buildRaces } from './lib/races.ts'

const region = regionFromArgs()
const cook = region.id === COOK.id
const election = region.election
const date = election.date
const INCUMBENTS = cook
  ? join(ROOT, 'content', 'incumbents', `${date}.json`)
  : join(ROOT, 'content', 'incumbents', region.id, `${date}.json`)
// Cook's list stays at its first address; other areas get a folder.
const OUT = cook
  ? join(ROOT, 'content', 'contests', `${date}.json`)
  : join(ROOT, 'content', 'contests', region.id, `${date}.json`)

const contestFiles = cook
  ? (await readdir(join(BUILD, 'contests')))
      .sort()
      .map((f) => join(BUILD, 'contests', f))
  : [join(BUILD, region.id === 'ca-la' ? 'la' : region.id, 'contests.json')]
const contests: Contest[] = []
for (const file of contestFiles)
  contests.push(...(await readJson<{ contests: Contest[] }>(file)).contests)
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
const profiles = cook
  ? await readProfiles(PROFILES_DIR)
  : new Map<string, never>()
const orphans = [...profiles.values()].filter(
  (p) => !p.sample && !p.contestIds.some((id) => raceOf.has(id)),
)
if (orphans.length)
  console.warn(`Profiles in no race: ${orphans.map((p) => p.key).join(', ')}`)

const list: RaceList = {
  electionId: election.id,
  electionName: election.name,
  date,
  area: region.fullName,
  areaPath: `${region.state.toLowerCase()}/${region.name.toLowerCase().replace(/\s+/g, '-')}/${date}`,
  races,
}
await writeFormattedJson(OUT, list)
console.log(
  `Wrote ${races.length} races (${races.filter((r) => r.ballots.length > 1).length} on both ballots) to ${OUT}`,
)
