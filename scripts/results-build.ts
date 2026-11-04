// Writes the committed results files, content/results/2026-11-03.json (Cook)
// and content/results/ca-la/2026-11-03.json (LA), from the newest official
// downloads in data/raw/results/ (npm run results:fetch) and the kept inputs
// in content/results-inputs/{area}/: match.json, ap-calls.json,
// ap-counts-a.json and ap-counts-b.json (both or neither) and
// certifications.json. An area with none of its inputs yet is skipped. The
// rules are in scripts/lib/results/build.ts.
//
// Run: npm run results:build

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseResultsFile } from '../src/shared/raceResults.ts'
import type { ResultsFile } from '../src/shared/raceResults.ts'
import { ROOT } from './lib/data.ts'
import { writeFormattedJson } from './lib/profiles/content.ts'
import { buildResults } from './lib/results/build.ts'
import type { BuildInputs } from './lib/results/build.ts'
import {
  AREAS,
  INPUTS,
  from,
  newestDownload,
  readJsonFile,
  readOfficial,
  rel,
} from './lib/results/files.ts'
import type { Area } from './lib/results/files.ts'
import {
  parseApCalls,
  parseApCounts,
  parseCertifications,
  parseMatchFile,
} from './lib/results/inputs.ts'

let downloads: string | undefined

/** Builds and writes one area's file, or skips an area whose inputs don't exist yet. */
async function buildArea(area: Area, now: string): Promise<void> {
  const dir = join(ROOT, 'content', 'results-inputs', area.id)
  const file = (name: (typeof INPUTS)[number]) => join(dir, `${name}.json`)
  const present = INPUTS.filter((name) => existsSync(file(name)))
  if (present.length === 0) {
    console.log(
      `${area.id}: skipped, no inputs in ${rel(dir)}/ yet (the contest match writes them)`,
    )
    return
  }
  const withCounts = present.some((n) => n.startsWith('ap-counts-'))
  const missing = INPUTS.filter(
    (n) => !present.includes(n) && (withCounts || !n.startsWith('ap-counts-')),
  )
  if (missing.length > 0) {
    throw new Error(
      `missing ${missing.map((n) => rel(file(n))).join(', ')} (ap-counts-a and ap-counts-b go together)`,
    )
  }

  const input = async <T>(
    name: (typeof INPUTS)[number],
    parse: (raw: unknown) => T,
  ): Promise<T> => {
    const raw = await readJsonFile(file(name))
    return from(file(name), () => parse(raw))
  }
  const match = await input('match', parseMatchFile)
  if (match.area !== area.id || match.electionId !== area.election.id) {
    throw new Error(
      `${rel(file('match'))} is for ${match.area}, ${match.electionId}, not ${area.id}, ${area.election.id}`,
    )
  }
  const read = async (reader: 'a' | 'b') => {
    const counts = await input(`ap-counts-${reader}`, parseApCounts)
    if (counts.reader !== reader) {
      throw new Error(
        `${rel(file(`ap-counts-${reader}`))} says it is reader ${counts.reader}`,
      )
    }
    return counts
  }
  const apCounts: BuildInputs['apCounts'] = withCounts
    ? [await read('a'), await read('b')]
    : []
  const apCalls = await input('ap-calls', parseApCalls)
  const certifications = await input('certifications', parseCertifications)

  let previous: ResultsFile | undefined
  if (existsSync(area.out)) {
    const raw = await readJsonFile(area.out)
    previous = from(area.out, () => parseResultsFile(raw))
  }

  downloads ??= newestDownload()
  const results = buildResults({
    match,
    official: await readOfficial(downloads, match),
    apCalls,
    apCounts,
    certifications,
    previous,
    now,
  })
  // What is about to be written must read back as a results file.
  parseResultsFile(JSON.parse(JSON.stringify(results)))

  await writeFormattedJson(area.out, results)
  const tally = new Map<string, number>()
  for (const r of results.results) {
    tally.set(r.status, (tally.get(r.status) ?? 0) + 1)
  }
  console.log(
    `${area.id}: wrote ${results.results.length} results to ${rel(area.out)} from ${rel(downloads)}/ (${[...tally].map(([s, n]) => `${n} ${s}`).join(', ')})`,
  )
}

const now = new Date().toISOString()
let failed = false
for (const area of AREAS) {
  try {
    await buildArea(area, now)
  } catch (err) {
    failed = true
    console.error(`${area.id}: ${(err as Error).message}`)
  }
}
if (failed) process.exitCode = 1
