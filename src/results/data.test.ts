import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseResultsFile } from '../shared/raceResults.ts'
import { regionForElection } from '../shared/regions.ts'
import type { RaceList } from '../shared/races.ts'
import { hasResults, hasResultsFile, loadResults, resultFor } from './data.ts'

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

const resultPaths = jsonFiles('content/results')
const resultFiles = resultPaths.map((p) => parseResultsFile(read(p)))
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

  // A race card finds each row's result by name: a name that differs from
  // the race list's would leave that row without its share, silently.
  it('names each race’s choices as its race list does, in ballot order', () => {
    let checked = 0
    for (const file of resultFiles)
      for (const result of file.results) {
        if (result.status === 'no_count') continue
        for (const list of raceLists.filter(
          (l) => l.electionId === file.electionId,
        ))
          for (const race of list.races) {
            if (!race.contestIds.some((id) => result.contestIds.includes(id)))
              continue
            const expected =
              race.kind === 'retention'
                ? ['Yes', 'No']
                : [...(race.candidates ?? [])]
                    .sort((a, b) => (a.ballotOrder ?? 0) - (b.ballotOrder ?? 0))
                    .map((c) => c.name)
            expect(
              result.choices.map((c) => c.name),
              `${file.electionId} ${race.path}`,
            ).toEqual(expected)
            checked++
          }
      }
    expect(checked).toBeGreaterThan(0)
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

describe('hasResultsFile', () => {
  it('answers synchronously from the committed files', () => {
    expect(hasResultsFile('il-2026-11-03-general')).toBe(true)
    expect(hasResultsFile('ca-2026-11-03-general')).toBe(true)
    expect(hasResultsFile('il-2027-02-23-municipal')).toBe(false)
  })

  it('matches every committed file', () => {
    for (const f of resultFiles) expect(hasResultsFile(f.electionId)).toBe(true)
  })
})

describe('results file names', () => {
  it('are the election ID of the file, flat in content/results/', () => {
    for (const path of resultPaths) {
      const file = parseResultsFile(read(path))
      expect(path, file.electionId).toBe(
        join('content', 'results', `${file.electionId}.json`),
      )
    }
  })

  it('finds a 2026 file without asking which election is current', () => {
    // il-2026-11-03-general is no region's current election (Cook's is a
    // later one once it changes); the file is found by its name alone.
    expect(hasResultsFile('il-2026-11-03-general')).toBe(true)
    expect(regionForElection('il-2027-02-23-municipal')).toBeUndefined()
    expect(hasResultsFile('il-2027-02-23-municipal')).toBe(false)
  })
})
