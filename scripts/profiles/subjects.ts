// Lists everyone who gets a profile: each person on the ballot once,
// from the contest files of `npm run data:build`, with their office, tier and
// race. Writes data/build/profiles/subjects.json and fails when a person maps
// to two races.
// Run: node scripts/profiles/subjects.ts

import { join } from 'node:path'
import type { Contest } from '../../src/shared/ballot.ts'
import { BUILD, readJson, writeJson } from '../lib/data.ts'
import { ELECTION_ID } from '../lib/election.ts'
import { SUBJECTS } from '../lib/profiles/content.ts'
import { buildSubjects, type SubjectsFile } from '../lib/profiles/subjects.ts'

/**
 * People confirmed by hand as one person in several races, so they keep one
 * profile. Add a key only after checking a source, and say which.
 */
const SAME_PERSON = new Set([
  // Circuit judge (7th subcircuit, term ends December 7, 2026) up for
  // retention who also runs for the Appellate Court (Vacancy of Hoffman):
  // https://ballotpedia.org/Judy_Rice (checked 2026-10-06).
  'judith-c-rice',
])

// The Clerk's list first: its titles name the office more fully.
const lists: Contest[][] = []
for (const file of ['cook-clerk', 'chicago-boe']) {
  const { contests } = await readJson<{ contests: Contest[] }>(
    join(BUILD, 'contests', `${file}.json`),
  )
  lists.push(contests)
}

const { subjects, races } = buildSubjects(lists, SAME_PERSON)
const out: SubjectsFile = {
  generatedAt: new Date().toISOString(),
  electionId: ELECTION_ID,
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
