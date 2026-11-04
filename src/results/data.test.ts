import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseResultsFile } from '../shared/raceResults.ts'
import type { RaceList } from '../shared/races.ts'
import { hasResults, loadResults, resultFor } from './data.ts'

const jsonFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory()
      ? jsonFiles(path)
      : name.endsWith('.json')
        ? [path]
        : []
  })
const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))

const resultFiles = jsonFiles('content/results').map((p) =>
  parseResultsFile(read(p)),
)
const raceLists = jsonFiles('content/contests').map((p) => read(p) as RaceList)

describe('committed results files', () => {
  it('has at least one file, and every file parses', () => {
    expect(resultFiles.length).toBeGreaterThan(0)
  })

  it('has unique contest IDs within an election', () => {
    for (const file of resultFiles) {
      const ids = file.results.flatMap((r) => r.contestIds)
      expect(new Set(ids).size, file.electionId).toBe(ids.length)
    }
  })

  it('has a result for every race of an election with a results file', () => {
    for (const list of raceLists) {
      const file = resultFiles.find((f) => f.electionId === list.electionId)
      if (!file) continue
      const ids = new Set(file.results.flatMap((r) => r.contestIds))
      for (const race of list.races)
        expect(
          race.contestIds.some((id) => ids.has(id)),
          `${list.electionId} ${race.path}`,
        ).toBe(true)
    }
  })
})

describe('loadResults', () => {
  it('loads each election by its ID', async () => {
    const data = await loadResults()
    expect(hasResults(data, 'il-2026-11-03-general')).toBe(true)
    expect(hasResults(data, 'ca-2026-11-03-general')).toBe(true)
  })

  it('never shows one election result in another (same contest ID)', async () => {
    const data = await loadResults()
    const id = 'cook-clerk:130040'
    expect(resultFor(data, 'il-2026-11-03-general', id)).toBeDefined()
    expect(resultFor(data, 'il-2027-02-23-municipal', id)).toBeUndefined()
    expect(hasResults(data, 'il-2027-02-23-municipal')).toBe(false)
  })

  it('behaves as no results while undefined', () => {
    expect(hasResults(undefined, 'il-2026-11-03-general')).toBe(false)
    expect(resultFor(undefined, 'il-2026-11-03-general', 'x')).toBeUndefined()
  })
})
