// Downloads the Cook County Clerk's own district assignments for every part
// ("split") of every suburban precinct. The Clerk's voter tool lists
// a precinct's ballot styles and, per split, the jurisdictions whose officials
// represent it; those jurisdictions are the Clerk's ground truth for which
// districts the precinct is in. Public boundary maps can disagree near
// district edges.
//
// Only jurisdiction names are kept, not officials' details. Responses are
// cached per precinct in data/raw/clerk-precincts/, so a rerun only fetches
// what's missing. Requests are spaced out to be gentle with the Clerk's server.
// Run after data:build: node scripts/fetch-clerk-precincts.ts

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Precinct } from '../src/shared/ballot.ts'
import { BUILD, getJson, RAW, readJson, writeJson } from './lib/data.ts'
import { ELECTION_CODE } from './lib/election.ts'

const API = 'https://www.cookcountyclerkil.gov/api'
const DIR = join(RAW, 'clerk-precincts')
const DELAY_MS = 500

export interface ClerkSplit {
  split: string
  styles: string[]
  /** `JurisdictionTypeId: Jurisdiction`, e.g. "ILREP: 36th District". Empty if the Clerk has none. */
  jurisdictions: string[]
}

export interface ClerkPrecinct {
  precinct: string
  splits: ClerkSplit[]
}

const pause = () => new Promise((r) => setTimeout(r, DELAY_MS))

const { precincts } = await readJson<{ precincts: Precinct[] }>(
  join(BUILD, 'precincts.json'),
)
const ids = precincts
  .map((p) => p.id)
  .filter((id) => id.startsWith('cook:'))
  .map((id) => id.slice('cook:'.length))

let fetched = 0
for (const [i, id] of ids.entries()) {
  const file = join(DIR, `${id}.json`)
  if (existsSync(file)) continue

  const list =
    (
      await getJson<{
        SampleBallots: { SplitNum: string; Style: string }[] | null
      }>(
        `${API}/candidate/GetSampleBallotList?electionCode=${ELECTION_CODE}&precinctId=${id}&groupId=0`,
      )
    ).SampleBallots ?? []
  await pause()

  const styles = new Map<string, Set<string>>()
  for (const b of list) {
    if (!styles.has(b.SplitNum)) styles.set(b.SplitNum, new Set())
    styles.get(b.SplitNum)!.add(b.Style)
  }
  // Precincts without a ballot list still get split 0, so districts are known.
  if (styles.size === 0) styles.set('0', new Set())

  const splits: ClerkSplit[] = []
  for (const [split, splitStyles] of [...styles].sort()) {
    const { data } = await getJson<{
      data: { JurisdictionTypeId: string; Jurisdiction: string }[] | null
    }>(
      `${API}/ElectedOfficial/GetByPrecinctSplit?precinctNumber=${id}&split=${split}`,
    )
    await pause()
    splits.push({
      split,
      styles: [...splitStyles].sort(),
      jurisdictions: [
        ...new Set(
          (data ?? []).map((o) => `${o.JurisdictionTypeId}: ${o.Jurisdiction}`),
        ),
      ].sort(),
    })
  }
  await writeJson(file, {
    precinct: `cook:${id}`,
    splits,
  } satisfies ClerkPrecinct)
  fetched++
  process.stdout.write(
    `\r${i + 1}/${ids.length} precincts (${fetched} fetched)`,
  )
}
process.stdout.write('\n')
