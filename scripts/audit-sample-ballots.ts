// Completeness audit: compares our predicted contests for suburban
// Cook precincts with the County Clerk's official sample ballots, one per
// ballot style. A contest counts as "on the official ballot" if one of its
// candidates or its retention judge appears in the ballot's text, or, for a
// referendum, most of the word pairs only its question has (see
// lib/ballot-text.ts; ballots are printed in columns that pdftotext
// interleaves). Needs `pdftotext`. Chicago doesn't publish
// per-precinct sample ballots, so only suburban precincts are audited.
// Run after data:build: node scripts/audit-sample-ballots.ts [precincts per group, default 25]
// or with specific precincts: node scripts/audit-sample-ballots.ts cook:7000004,cook:9700023

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Contest, OcdId, Precinct } from '../src/shared/ballot.ts'
import { applyClerkSplits, type ClerkSplit } from '../src/shared/cook.ts'
import { COOK_COUNTY } from '../src/shared/ocd.ts'
import { BUILD, getJson, RAW, readJson, writeJson } from './lib/data.ts'
import { ELECTION_CODE } from './lib/election.ts'
import {
  appears,
  ballotText,
  type BallotText,
  MATCH,
  normalize,
  QuestionMatcher,
  UNSURE,
} from './lib/ballot-text.ts'
import { loadLayers } from './lib/layers.ts'

const ONLY = process.argv[2]?.startsWith('cook:')
  ? process.argv[2].split(',')
  : null
const PER_GROUP = ONLY ? 0 : Number(process.argv[2] ?? 25)
const PDF_DIR = join(RAW, 'sample-ballots')
const LIST_DIR = join(PDF_DIR, 'lists')

interface SampleBallot {
  PrecinctNum: string
  SplitNum: string
  Style: string
  LanguageCode: string
  BallotName: string
}

const { precincts } = await readJson<{ precincts: Precinct[] }>(
  join(BUILD, 'precincts.json'),
)
const audit = await readJson<{
  splits: { precinct: string; shares: Record<OcdId, number> }[]
}>(join(BUILD, 'precinct-audit.json'))
const { contests } = await readJson<{ contests: Contest[] }>(
  join(BUILD, 'contests', 'cook-clerk.json'),
)
const suburban = contests.filter((c) => c.authorityId === COOK_COUNTY)
const clerkFile = join(BUILD, 'clerk-precincts.json')
const clerk = existsSync(clerkFile)
  ? (await readJson<{ precincts: Record<string, ClerkSplit[]> }>(clerkFile))
      .precincts
  : {}
const layerOf = new Map<OcdId, string>()
for (const layer of await loadLayers())
  for (const area of layer.areas) layerOf.set(area.value, layer.type)

/** Names that identify each candidate contest or retention on a ballot. */
function names(c: Contest): string[] {
  if (c.kind === 'candidate') return c.candidates.map((x) => normalize(x.name))
  if (c.kind === 'retention') return [normalize(c.judge)]
  return []
}
const questions = new QuestionMatcher(
  suburban.flatMap((c) => (c.kind === 'measure' ? [c.question] : [])),
)
/** How sure we are that a contest is on a ballot style. */
function onBallot(c: Contest, ballot: BallotText): 'yes' | 'no' | 'unsure' {
  if (c.kind === 'measure') {
    const score = questions.score(c.question, ballot)
    return score >= MATCH ? 'yes' : score > UNSURE ? 'unsure' : 'no'
  }
  // Judges' names can be split by "retention in office" text blocks.
  const gap = c.kind === 'retention' ? 40 : 6
  return names(c).some((n) => appears(ballot.words, n, gap)) ? 'yes' : 'no'
}

// Districts each precinct could be in: its main districts plus any minority
// shares from the overlay (a split precinct has several ballot styles).
const possible = new Map<string, Set<OcdId>>()
for (const p of precincts) possible.set(p.id, new Set(p.districtIds))
for (const split of audit.splits) {
  for (const district of Object.keys(split.shares))
    possible.get(split.precinct)?.add(district)
}
const splitPrecincts = new Set(audit.splits.map((s) => s.precinct))

// Deterministic sample: hash-sort the IDs so reruns pick the same precincts.
const hash = (s: string) => createHash('sha1').update(s).digest('hex')
const pick = (ids: string[]) =>
  ids.sort((a, b) => hash(a).localeCompare(hash(b))).slice(0, PER_GROUP)
const suburbanIds = precincts
  .map((p) => p.id)
  .filter((id) => id.startsWith('cook:'))
const sample = ONLY
  ? ONLY.map((id) => ({ id, split: splitPrecincts.has(id) }))
  : [
      ...pick(suburbanIds.filter((id) => !splitPrecincts.has(id))).map(
        (id) => ({
          id,
          split: false,
        }),
      ),
      ...pick(suburbanIds.filter((id) => splitPrecincts.has(id))).map((id) => ({
        id,
        split: true,
      })),
    ]

/** The precinct's ballot styles, cached so reruns don't hit the Clerk's API again. */
async function ballotList(precinctNum: string): Promise<SampleBallot[]> {
  const file = join(LIST_DIR, `${precinctNum}.json`)
  if (existsSync(file)) return readJson<SampleBallot[]>(file)
  const url = `https://www.cookcountyclerkil.gov/api/candidate/GetSampleBallotList?electionCode=${ELECTION_CODE}&precinctId=${precinctNum}&groupId=0`
  const list =
    (await getJson<{ SampleBallots: SampleBallot[] | null }>(url))
      .SampleBallots ?? []
  await writeJson(file, list)
  await new Promise((r) => setTimeout(r, 250)) // be gentle with the Clerk's server
  return list
}

async function readBallot(ballot: SampleBallot): Promise<BallotText> {
  const file = join(PDF_DIR, ballot.BallotName.split('/').pop()!)
  if (!existsSync(file)) {
    const res = await fetch(`https:${ballot.BallotName}`)
    if (!res.ok) throw new Error(`${res.status} for ${ballot.BallotName}`)
    await writeFile(file, Buffer.from(await res.arrayBuffer()))
    await new Promise((r) => setTimeout(r, 250)) // be gentle with the Clerk's server
  }
  // Two readings: the default and -layout modes break columns differently.
  return ballotText([
    execFileSync('pdftotext', [file, '-'], { encoding: 'utf8' }),
    execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' }),
  ])
}

interface Result {
  precinct: string
  split: boolean
  styles: string[]
  /** On an official ballot style but not predicted (a gap we'd show the voter). */
  missing: string[]
  /** Predicted but on no official ballot style (we'd show a contest the voter doesn't have). */
  extra: string[]
  /** Referenda whose question only partly matched a ballot: check the PDF. */
  unsure: string[]
  error?: string
}
const results: Result[] = []
await mkdir(LIST_DIR, { recursive: true })

for (const { id, split } of sample) {
  const precinctNum = id.slice('cook:'.length)
  const list = await ballotList(precinctNum)
  // One English/Spanish ballot per style (other languages repeat the same contests).
  const styles = [
    ...new Map(
      list.filter((b) => b.LanguageCode === 'SP').map((b) => [b.Style, b]),
    ).values(),
  ]
  if (styles.length === 0) {
    results.push({
      precinct: id,
      split,
      styles: [],
      missing: [],
      extra: [],
      unsure: [],
      error: 'no sample ballot (precinct map out of date?)',
    })
    continue
  }
  // With the Clerk's district assignments, the prediction is the
  // precinct's main districts with the Clerk's replacing the map's, and every
  // difference counts. Without them, a split precinct is predicted with every
  // district it touches and only missing contests count.
  const mainIds = precincts.find((p) => p.id === id)!.districtIds
  const clerkSplits = clerk[id] ?? []
  const useClerk =
    clerkSplits.some((s) => s.districts.length) && styles.length === 1
  const predictedIds = useClerk
    ? new Set(
        applyClerkSplits(
          mainIds.map((ocdId) => ({ ocdId, layer: layerOf.get(ocdId) ?? '' })),
          clerkSplits,
        ).districts.map((d) => d.ocdId),
      )
    : split
      ? possible.get(id)!
      : new Set(mainIds)
  const predicted = suburban.filter((c) => predictedIds.has(c.districtId))
  const lenient = split && !useClerk

  const official = new Set<Contest>()
  const unsure = new Set<Contest>()
  for (const style of styles) {
    const ballot = await readBallot(style)
    for (const contest of suburban) {
      const found = onBallot(contest, ballot)
      if (found === 'yes') official.add(contest)
      else if (found === 'unsure') unsure.add(contest)
    }
  }
  for (const c of official) unsure.delete(c)
  // An unsure contest is neither missing nor extra; it's listed for a manual check.
  results.push({
    precinct: id,
    split,
    styles: styles.map((s) => s.Style),
    missing: [...official]
      .filter((c) => !predicted.includes(c))
      .map((c) => c.title),
    // Split precincts are predicted with every district they touch, so
    // contests from the other parts are expected and not counted as extra.
    extra: lenient
      ? []
      : predicted
          .filter((c) => !official.has(c) && !unsure.has(c))
          .map((c) => c.title),
    unsure: [...unsure].map((c) => c.title),
  })
  process.stdout.write('.')
}

await writeJson(join(BUILD, 'sample-ballot-audit.json'), {
  generatedAt: new Date().toISOString(),
  results,
})

console.log()
for (const group of [false, true]) {
  const rows = results.filter((r) => r.split === group && !r.error)
  const differs = (r: Result) =>
    r.missing.length || r.extra.length || r.unsure.length
  const perfect = rows.filter((r) => !differs(r)).length
  console.log(
    `${group ? 'Split' : 'Whole'} precincts: ${perfect}/${rows.length} match exactly`,
  )
  for (const r of rows.filter(differs)) {
    console.log(`  ${r.precinct} (styles ${r.styles.join(', ')})`)
    for (const t of r.missing) console.log(`    missing: ${t}`)
    for (const t of r.extra) console.log(`    extra:   ${t}`)
    for (const t of r.unsure) console.log(`    unsure:  ${t} (check the PDF)`)
  }
}
const errors = results.filter((r) => r.error)
console.log(
  `${errors.length} precincts without a sample ballot${errors.length ? ': ' + errors.map((e) => e.precinct).join(', ') : ''}`,
)
