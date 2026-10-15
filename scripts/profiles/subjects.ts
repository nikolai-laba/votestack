// Lists everyone who gets a profile: each person on the ballot once,
// from the contest files of `npm run data:build`, with their office, tier and
// race. Writes data/build/profiles/subjects.json and fails when a person maps
// to two races.
// Run: node scripts/profiles/subjects.ts [--region=ca-la]

import { join } from 'node:path'
import type { Contest } from '../../src/shared/ballot.ts'
import { BUILD, readJson, writeJson } from '../lib/data.ts'
import { ELECTION, IS_COOK } from '../lib/profiles/region.ts'
import { SUBJECTS } from '../lib/profiles/content.ts'
import { buildSubjects, type SubjectsFile } from '../lib/profiles/subjects.ts'

/**
 * People confirmed by hand as one person in several races, so they keep one
 * profile. Add a key only after checking a source, and say which.
 */
const SAME_PERSON_LA = new Set([
  // West Basin Municipal Water District director (Division 2, which covers
  // Inglewood) and Inglewood council member, on the ballot for both seats
  // ("Water Board Director", "Councilwoman"):
  // https://www.westbasinca.gov/about-west-basin/board-of-directors/gloria-d-gray
  // and her 2022 dual candidacy, https://lasentinel.net/?p=248773 (checked
  // 2026-10-14).
  'gloria-d-gray',
])

const SAME_PERSON = new Set([
  // Circuit judge (7th subcircuit, term ends December 7, 2026) up for
  // retention who also runs for the Appellate Court (Vacancy of Hoffman):
  // https://ballotpedia.org/Judy_Rice (checked 2026-10-06).
  'judith-c-rice',
])

// Cook County: the Clerk's list first (its titles name the office more
// fully), then the Board's. Other areas: their one list (scripts/la/).
const files = IS_COOK
  ? ['cook-clerk', 'chicago-boe'].map((f) =>
      join(BUILD, 'contests', `${f}.json`),
    )
  : [join(BUILD, 'la', 'contests.json')]
const lists: Contest[][] = []
for (const file of files)
  lists.push((await readJson<{ contests: Contest[] }>(file)).contests)

const { subjects, races } = buildSubjects(
  lists,
  IS_COOK ? SAME_PERSON : SAME_PERSON_LA,
)
const out: SubjectsFile = {
  generatedAt: new Date().toISOString(),
  electionId: ELECTION.id,
  subjects,
  races,
}
await writeJson(SUBJECTS, out)

const count = (field: 'tier' | 'kind' | 'officeType') => {
  const counts = new Map<string, number>()
  for (const s of subjects)
    counts.set(s[field], (counts.get(s[field]) ?? 0) + 1)
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(', ')
}
console.log(`${subjects.length} people in ${races.length} races`)
console.log(`  tier: ${count('tier')}`)
console.log(`  kind: ${count('kind')}`)
console.log(`  office type: ${count('officeType')}`)
const unopposed = races.filter(
  (r) => r.keys.length === 1 && !r.raceKey.startsWith('retention:'),
).length
console.log(`  ${unopposed} races with one candidate`)
