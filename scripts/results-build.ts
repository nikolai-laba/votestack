// Writes the committed results files, content/results/2026-11-03.json (Cook)
// and content/results/ca-la/2026-11-03.json (LA), from the newest official
// downloads in data/raw/results/ (npm run results:fetch) and the kept inputs
// in content/results-inputs/{area}/: match.json, ap-calls.json,
// ap-counts-a.json and ap-counts-b.json (both or neither) and
// certifications.json. An area with none of its inputs yet is skipped. The
// rules are in scripts/lib/results/build.ts.
//
// Run: npm run results:build

import { existsSync, readdirSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { format } from 'prettier'
import type { Election } from '../src/shared/ballot.ts'
import { parseResultsFile } from '../src/shared/raceResults.ts'
import type { ResultsFile } from '../src/shared/raceResults.ts'
import { COOK, LOS_ANGELES } from '../src/shared/regions.ts'
import { ROOT } from './lib/data.ts'
import { buildResults } from './lib/results/build.ts'
import type { BuildInputs } from './lib/results/build.ts'
import { caSosPaths, readCaSos } from './lib/results/ca-sos.ts'
import { readChicago } from './lib/results/chicago.ts'
import { readCook } from './lib/results/cook.ts'
import {
  parseApCalls,
  parseApCounts,
  parseCertifications,
  parseMatchFile,
} from './lib/results/inputs.ts'
import type { MatchFile } from './lib/results/inputs.ts'
import { readLa } from './lib/results/la.ts'
import type { OfficialFile } from './lib/results/types.ts'

interface Area {
  id: MatchFile['area']
  election: Election
  out: string
}

const AREAS: Area[] = [
  {
    id: 'cook',
    election: COOK.election,
    out: join(ROOT, 'content', 'results', `${COOK.election.date}.json`),
  },
  {
    id: 'ca-la',
    election: LOS_ANGELES.election,
    out: join(
      ROOT,
      'content',
      'results',
      'ca-la',
      `${LOS_ANGELES.election.date}.json`,
    ),
  },
]

const INPUTS = [
  'match',
  'ap-calls',
  'ap-counts-a',
  'ap-counts-b',
  'certifications',
] as const

const DOWNLOADS = join(ROOT, 'data', 'raw', 'results')

const rel = (path: string) => relative(ROOT, path)

async function readText(path: string): Promise<string> {
  if (!existsSync(path)) throw new Error(`missing ${rel(path)}`)
  return readFile(path, 'utf8')
}

async function readJsonFile(path: string): Promise<unknown> {
  const text = await readText(path)
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`${rel(path)} is not valid JSON: ${(err as Error).message}`)
  }
}

/** Runs a reader or parser, naming the file in its error. */
function from<T>(path: string, read: () => T): T {
  try {
    return read()
  } catch (err) {
    throw new Error(`${rel(path)}: ${(err as Error).message}`)
  }
}

/** The newest download folder; names are ISO times with ':' as '-', so they sort by time. */
function newestDownload(): string {
  const folders = existsSync(DOWNLOADS)
    ? readdirSync(DOWNLOADS, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}T/.test(d.name))
        .map((d) => d.name)
        .sort()
    : []
  const newest = folders.at(-1)
  if (!newest) {
    throw new Error(
      `no downloads in ${rel(DOWNLOADS)}/; run npm run results:fetch first`,
    )
  }
  return join(DOWNLOADS, newest)
}

/** Reads the official files the match uses from one download folder. */
async function readOfficial(
  folder: string,
  match: MatchFile,
): Promise<OfficialFile[]> {
  const path = (name: string) => join(folder, name)
  const retrievedAt = (await readText(path('retrieved-at.txt'))).trim()
  if (Number.isNaN(Date.parse(retrievedAt))) {
    throw new Error(`${rel(path('retrieved-at.txt'))} is not a time`)
  }
  const sources = new Set(
    match.contests.flatMap((e) => e.official.map((o) => o.source)),
  )
  const files: OfficialFile[] = []
  if (sources.has('chicago')) {
    const text = await readText(path('chicago-summary.txt'))
    const lastModified = (
      await readText(path('chicago-summary.last-modified.txt'))
    ).trim()
    files.push(
      from(path('chicago-summary.txt'), () =>
        readChicago(text, lastModified, retrievedAt),
      ),
    )
  }
  if (sources.has('cook')) {
    const html = await readText(path('cook-results.html'))
    files.push(
      from(path('cook-results.html'), () => readCook(html, retrievedAt)),
    )
  }
  if (sources.has('la')) {
    const json = await readJsonFile(path('la-results.json'))
    files.push(from(path('la-results.json'), () => readLa(json, retrievedAt)))
  }
  for (const api of caSosPaths(match)) {
    const file = path(join('ca-sos', `${api.replaceAll('/', '__')}.json`))
    const json = await readJsonFile(file)
    files.push(from(file, () => readCaSos(json, api, retrievedAt)))
  }
  return files
}

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

  await mkdir(dirname(area.out), { recursive: true })
  await writeFile(
    area.out,
    await format(JSON.stringify(results), { parser: 'json' }),
  )
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
