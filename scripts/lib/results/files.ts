// Where the results scripts keep and find their files: the two areas, the
// kept inputs, and the official downloads in data/raw/results/ (written by
// npm run results:fetch).

import { existsSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { Election } from '../../../src/shared/ballot.ts'
import { COOK, LOS_ANGELES } from '../../../src/shared/regions.ts'
import { ROOT } from '../data.ts'
import { caSosPaths, readCaSos } from './ca-sos.ts'
import { readChicago } from './chicago.ts'
import { readCook } from './cook.ts'
import type { MatchFile } from './inputs.ts'
import { readLa } from './la.ts'
import type { OfficialFile } from './types.ts'

export interface Area {
  id: MatchFile['area']
  election: Election
  out: string
}

export const AREAS: Area[] = [
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

export const INPUTS = [
  'match',
  'ap-calls',
  'ap-counts-a',
  'ap-counts-b',
  'certifications',
] as const

export const DOWNLOADS = join(ROOT, 'data', 'raw', 'results')

export const rel = (path: string) => relative(ROOT, path)

export async function readText(path: string): Promise<string> {
  if (!existsSync(path)) throw new Error(`missing ${rel(path)}`)
  return readFile(path, 'utf8')
}

export async function readBytes(path: string): Promise<Uint8Array> {
  if (!existsSync(path)) throw new Error(`missing ${rel(path)}`)
  return readFile(path)
}

export async function readJsonFile(path: string): Promise<unknown> {
  const text = await readText(path)
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`${rel(path)} is not valid JSON: ${(err as Error).message}`)
  }
}

/** Runs a reader or parser, naming the file in its error. */
export function from<T>(path: string, read: () => T): T {
  try {
    return read()
  } catch (err) {
    throw new Error(`${rel(path)}: ${(err as Error).message}`)
  }
}

/** The newest download folder; names are ISO times with ':' as '-', so they sort by time. */
export function newestDownload(): string {
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
export async function readOfficial(
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
    const bytes = await readBytes(path('chicago-summary.txt'))
    const lastModified = (
      await readText(path('chicago-summary.last-modified.txt'))
    ).trim()
    files.push(
      from(path('chicago-summary.txt'), () =>
        readChicago(bytes, lastModified, retrievedAt),
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

/** An area's kept input file, content/results-inputs/{area}/{name}.json. */
export const inputPath = (area: Area, name: (typeof INPUTS)[number]) =>
  join(ROOT, 'content', 'results-inputs', area.id, `${name}.json`)
