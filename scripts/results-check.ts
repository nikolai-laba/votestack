// Checks the committed results files before they ship: each against its match
// file, both AP count reads, the previous committed version (git HEAD) and the
// newest official downloads. Prints each failure and warning; exits 1 on any
// failure. The rules are in scripts/lib/results/check.ts.
//
// Run: npm run results:check

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { parseResultsFile } from '../src/shared/raceResults.ts'
import type { ResultsFile } from '../src/shared/raceResults.ts'
import { ROOT } from './lib/data.ts'
import { checkResults } from './lib/results/check.ts'
import {
  AREAS,
  from,
  inputPath,
  newestDownload,
  readJsonFile,
  readOfficial,
  rel,
} from './lib/results/files.ts'
import type { Area } from './lib/results/files.ts'
import { parseApCounts, parseMatchFile } from './lib/results/inputs.ts'
import type { ApCountsFile } from './lib/results/inputs.ts'

/** The file as committed at HEAD, or undefined when it isn't there yet. */
function committed(path: string): ResultsFile | undefined {
  let text: string
  try {
    text = execFileSync('git', ['show', `HEAD:${rel(path)}`], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return undefined
  }
  return from(`HEAD:${rel(path)}`, () => parseResultsFile(JSON.parse(text)))
}

/** Checks one area; returns its failure count, or null when it has no match file yet. */
async function checkArea(area: Area, now: string): Promise<number | null> {
  const matchFile = inputPath(area, 'match')
  if (!existsSync(matchFile)) {
    console.log(`${area.id}: no match file yet, nothing to check`)
    return null
  }
  const match = from(matchFile, () =>
    parseMatchFile(JSON.parse(readFileSync(matchFile, 'utf8'))),
  )

  const failures: string[] = []
  const warnings: string[] = []

  let file: ResultsFile | undefined
  if (existsSync(area.out)) {
    const raw = await readJsonFile(area.out)
    file = from(area.out, () => parseResultsFile(raw))
  } else {
    failures.push(`${rel(area.out)} is missing; run npm run results:build`)
  }

  const apCounts: ApCountsFile[] = []
  for (const reader of ['a', 'b'] as const) {
    const path = inputPath(area, `ap-counts-${reader}`)
    if (!existsSync(path)) continue
    const raw = await readJsonFile(path)
    apCounts.push(from(path, () => parseApCounts(raw)))
  }

  if (file) {
    const result = checkResults(file, {
      match,
      previous: committed(area.out),
      apCounts,
      official: await readOfficial(newestDownload(), match),
      now,
    })
    failures.push(...result.failures)
    warnings.push(...result.warnings)
  }

  for (const w of warnings) console.warn(`${area.id}: warning: ${w}`)
  for (const f of failures) console.error(`${area.id}: FAIL: ${f}`)
  console.log(
    `${area.id}: ${failures.length} failure${failures.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`,
  )
  return failures.length
}

const now = new Date().toISOString()
let failed = false
for (const area of AREAS) {
  try {
    if (((await checkArea(area, now)) ?? 0) > 0) failed = true
  } catch (err) {
    failed = true
    console.error(`${area.id}: ${(err as Error).message}`)
  }
}
if (failed) process.exitCode = 1
