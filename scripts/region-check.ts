// Checks one region against its manifest (scripts/lib/regions/manifest.ts)
// before its ballots and profiles go live, and lists every problem: a step
// whose file is missing, empty, uncommitted or older than its inputs; an
// audit below its agreement floor; contests without a paper ballot order;
// people without a profile; profiles that failed their checks or differ
// from the published version; parts of profiles filled below the floors;
// and profile keys used in two regions. Read-only and offline.
// Run: npm run region:check -- --region=<id>

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Contest } from '../src/shared/ballot.ts'
import type { CandidateProfile } from '../src/shared/profile.ts'
import { REGIONS } from '../src/shared/regions.ts'
import { ROOT, readJson } from './lib/data.ts'
import { contentHash } from './lib/profiles/content.ts'
import { regionFromArgs } from './lib/profiles/region.ts'
import { MANIFESTS, type Artifact } from './lib/regions/manifest.ts'

const region = regionFromArgs()
const manifest = MANIFESTS[region.id]
if (!manifest) throw new Error(`No manifest for ${region.id}`)

const problems: string[] = []
const fail = (msg: string) => problems.push(msg)
const abs = (a: Artifact) => join(ROOT, a.path)

/** The artifact exists, isn't empty and, if committed, has no uncommitted changes. */
function present(a: Artifact): boolean {
  const path = abs(a)
  if (!existsSync(path)) {
    fail(`Missing ${a.path} (run ${a.by})`)
    return false
  }
  const empty = statSync(path).isDirectory()
    ? readdirSync(path).filter((f) => !f.startsWith('.')).length === 0
    : statSync(path).size === 0
  if (empty) {
    fail(`Empty ${a.path} (run ${a.by})`)
    return false
  }
  if (a.committed) {
    const status = execFileSync(
      'git',
      ['status', '--porcelain', '--', a.path],
      {
        cwd: ROOT,
        encoding: 'utf8',
      },
    )
    if (status.trim())
      fail(
        `${a.path} has uncommitted changes; commit it so the site's build sees it`,
      )
  }
  return true
}

const mtime = (a: Artifact) => statSync(abs(a)).mtimeMs
const newerThan = (a: Artifact, inputs: Artifact[]) => {
  const stale = inputs.filter((i) => existsSync(abs(i)) && mtime(i) > mtime(a))
  if (stale.length)
    fail(
      `${a.path} is older than ${stale.map((i) => i.path).join(', ')} (run ${a.by})`,
    )
}

// 1. Ballot data.
const { ballot } = manifest
const contests: Contest[] = []
for (const a of ballot.contests)
  if (present(a))
    contests.push(...(await readJson<{ contests: Contest[] }>(abs(a))).contests)
present(ballot.precincts)
present(ballot.splits)
if (ballot.paperOrder.from === 'file') present(ballot.paperOrder.artifact)
else {
  const missing = contests.filter((c) => typeof c.paperOrder !== 'number')
  if (missing.length)
    fail(
      `${missing.length} contests have no paper ballot order (e.g. ${missing[0].title})`,
    )
}
if (present(ballot.audit.artifact)) {
  newerThan(ballot.audit.artifact, ballot.contests)
  const audit = await readJson<Record<string, unknown>>(
    abs(ballot.audit.artifact),
  )
  const agreement =
    ballot.audit.kind === 'address-sample'
      ? Number(audit.agreeRate)
      : (() => {
          const results = audit.results as {
            missing: unknown[]
            extra: unknown[]
          }[]
          return (
            results.filter((r) => !r.missing.length && !r.extra.length).length /
            results.length
          )
        })()
  if (!(agreement >= ballot.audit.minAgreement))
    fail(
      `Audit agreement ${(agreement * 100).toFixed(2)}% is below ${ballot.audit.minAgreement * 100}% (${ballot.audit.artifact.path})`,
    )
}

// 2. Race list and incumbents.
if (present(manifest.raceList)) newerThan(manifest.raceList, ballot.contests)
if (present(manifest.incumbents.labels))
  newerThan(manifest.incumbents.labels, [manifest.incumbents.roster])
present(manifest.incumbents.roster)

// 3. Profiles.
const p = manifest.profiles
for (const a of [p.barRatings, p.rosters, p.slatesDir]) if (a) present(a)
const subjects = present(p.subjects)
  ? (
      await readJson<{
        subjects: { key: string; kind: string; officeType: string }[]
      }>(abs(p.subjects))
    ).subjects
  : []
const profiles = new Map<string, CandidateProfile>()
if (present(p.dir))
  for (const f of readdirSync(abs(p.dir)).filter((f) => f.endsWith('.json')))
    profiles.set(
      f.slice(0, -5),
      await readJson<CandidateProfile>(join(abs(p.dir), f)),
    )
const withoutProfile = subjects.filter((s) => !profiles.has(s.key))
if (withoutProfile.length)
  fail(
    `${withoutProfile.length} people have no profile (e.g. ${withoutProfile[0].key})`,
  )

if (present(p.money)) newerThan(p.money, [p.subjects])
if (present(p.check)) {
  const check = await readJson<{
    profiles: Record<string, { status: string; contentHash: string }>
  }>(abs(p.check))
  const unchecked = [...profiles].filter(
    ([k, pr]) => check.profiles[k]?.contentHash !== contentHash(pr),
  )
  if (unchecked.length)
    fail(
      `${unchecked.length} profiles changed since ${p.check.path} (e.g. ${unchecked[0][0]}; run ${p.check.by})`,
    )
  const flagged = Object.entries(check.profiles).filter(
    ([, c]) => c.status !== 'passed',
  )
  if (flagged.length)
    fail(`${flagged.length} profiles didn't pass ${p.check.path}`)
}
if (present(p.published)) {
  const list = await readJson<{ profiles: Record<string, string> }>(
    abs(p.published),
  )
  const differ = Object.entries(list.profiles).filter(
    ([k, hash]) => profiles.has(k) && contentHash(profiles.get(k)!) !== hash,
  )
  if (differ.length)
    fail(
      `${differ.length} profiles differ from the published version (run ${p.published.by})`,
    )
  const unpublished = [...profiles.keys()].filter((k) => !(k in list.profiles))
  if (unpublished.length)
    fail(
      `${unpublished.length} profiles aren't published (e.g. ${unpublished[0]})`,
    )
}

// 4. Fill floors, over candidates (retention judges have no race to run).
const candidates = subjects.filter(
  (s) => s.kind !== 'retention' && profiles.has(s.key),
)
const share = (test: (pr: CandidateProfile) => boolean) =>
  candidates.length
    ? candidates.filter((s) => test(profiles.get(s.key)!)).length /
      candidates.length
    : 0
const fills = {
  overview: share((pr) => pr.overview.items.length > 0),
  endorsements: share((pr) => pr.endorsements.items.length > 0),
  money: share(
    (pr) =>
      pr.money.items.length > 0 ||
      !!pr.money.sharedCommittee ||
      !!pr.money.filingsAt,
  ),
  moneySummaries: share((pr) => pr.money.items.length > 0),
  incumbentLabels: share((pr) => !!pr.incumbent),
}
for (const [part, floor] of Object.entries(manifest.floors) as [
  keyof typeof fills,
  number,
][])
  if (fills[part] < floor)
    fail(
      `${part}: ${(fills[part] * 100).toFixed(1)}% of candidates, below the ${floor * 100}% floor`,
    )

// 5. A profile key in two regions would serve one region's profile for both.
for (const other of REGIONS.filter((r) => r.id !== region.id)) {
  const dir = MANIFESTS[other.id] && abs(MANIFESTS[other.id].profiles.dir)
  if (!dir || !existsSync(dir)) continue
  const shared = readdirSync(dir).filter(
    (f) => f.endsWith('.json') && profiles.has(f.slice(0, -5)),
  )
  if (shared.length)
    fail(
      `${shared.length} profile keys are also in ${other.id} (e.g. ${shared[0]})`,
    )
}

console.log(
  `${region.id}: ${contests.length} contests, ${subjects.length} people, ${profiles.size} profiles`,
)
console.log(
  `  fill: ${Object.entries(fills)
    .map(([k, v]) => `${k} ${(v * 100).toFixed(1)}%`)
    .join(', ')}`,
)
if (problems.length) {
  console.log(`\n${problems.length} problems:`)
  for (const problem of problems) console.log(`  - ${problem}`)
  process.exit(1)
}
console.log('\nAll checks passed.')
