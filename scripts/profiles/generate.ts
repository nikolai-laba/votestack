// Generates candidate profiles for everyone in subjects.json with one
// model, then adds what no model writes: campaign money from filings
// (data/build/profiles/money.json), judges' bar ratings
// (content/profiles/judges/bar-ratings.json, when present) and hand
// corrections (content/profiles/overrides/{key}.json). Writes
// content/profiles/{election date}/{key}.json, which is committed.
//
// Every run also enforces the endorsement rules, without a model: endorsements
// whose only sources can't show a 2026 general-election endorsement are
// dropped (endorsement-sources.ts), published slates are merged
// (content/profiles/slates/, slates.ts), and an endorser credited to more
// candidates in a race than it has seats is dropped unless a slate or an
// override confirms it (endorsers.ts). What each rule removed or added is
// printed and written to data/build/profiles/endorsement-changes.json.
//
// A profile is researched again only when it's missing, the person's ballot
// listing changed, or the model or prompt changed; otherwise only money,
// ratings, slates and overrides are refreshed (no cost). Files are rewritten
// only when their content changes, and meta.version goes up each time.
//
// Run:  node --env-file=.env scripts/profiles/generate.ts --model <id> [options]
//   --model id        a model from scripts/lib/profiles/models.ts
//   --only a,b        only these profile keys
//   --race key        only this race (a raceKey from subjects.json)
//   --max-cost 25     stop starting new research once spend would pass this (USD)
//   --refresh         research again even when nothing changed
//   --no-research     never call a model: refresh every existing profile
//                     (money, ratings, slates, overrides, endorsement rules)
//                     even when its model or prompt is out of date
//   --concurrency 2   profiles researched at once
//   --endorsements files  read endorsements from the separately researched
//                     files (providers/staged.ts ENDORSEMENTS) instead of
//                     asking Gemini; a person without a file isn't researched
//   --region ca-la    another area's profiles (region.ts; Cook by default)
//
// On the Gemini API (no VERTEX_PROJECT), a used-up daily quota stops new
// research at once; finished profiles are kept and a rerun continues. Set
// VERTEX_PROJECT to go on through Vertex AI instead.
//   --dry-run         no keys, no calls: a fake model writes to
//                     data/build/profiles/dry-run/ and the plan is printed

import { existsSync } from 'node:fs'
import { appendFile, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { chicagoDate } from '../../src/shared/dates.ts'
import type { Contest } from '../../src/shared/ballot.ts'
import type { CandidateProfile } from '../../src/shared/profile.ts'
import { BUILD, readJson, writeJson } from '../lib/data.ts'
import {
  ELECTION,
  IS_COOK,
  REGION,
  REGION_OPTION,
} from '../lib/profiles/region.ts'
import {
  applyOverride,
  compactSources,
  mergeBarRatings,
  mergeIncumbent,
  mergeMoney,
  planFor,
  requestFor,
  versioned,
  withSubject,
  type BarRatings,
  type MoneyInput,
  type Override,
} from '../lib/profiles/assemble.ts'
import {
  BAR_RATINGS,
  DRY_RUN_DIR,
  INCUMBENTS,
  MONEY,
  OVERRIDES_DIR,
  PIPELINE_BUILD,
  PROFILES_DIR,
  readProfiles,
  readSubjects,
  ROSTERS,
  SLATES_DIR,
  today,
  writeFormattedJson,
} from '../lib/profiles/content.ts'
import type { Incumbents } from '../lib/incumbents.ts'
import { fakeGenerator } from '../lib/profiles/fake.ts'
import {
  GeminiDailyLimitError,
  geminiRequests,
} from '../lib/profiles/providers/gemini.ts'
import { stagedOptions } from '../lib/profiles/providers/staged.ts'
import {
  apiKey,
  type EvidenceDoc,
  type ProfileGenerator,
} from '../lib/profiles/generator.ts'
import {
  DEFAULT_ESTIMATE,
  ESTIMATE,
  modelById,
  requiredKeys,
} from '../lib/profiles/models.ts'
import {
  filterEndorsementSources,
  SOURCE_RULES,
  type RemovedEndorsement,
  type SourceRule,
} from '../lib/profiles/endorsement-sources.ts'
import {
  confirmation,
  dropSharedEndorsers,
  sameEndorser,
  type SharedEndorserRemoval,
} from '../lib/profiles/endorsers.ts'
import { PLACE } from '../lib/profiles/place.ts'
import { toProfile } from '../lib/profiles/prompt.ts'
import { gatherEvidence } from '../lib/profiles/providers/perplexity.ts'
import { mergeSlates, type Slate } from '../lib/profiles/slates.ts'
import {
  fillParties,
  type RosterMember,
  type Rosters,
} from '../lib/profiles/rosters.ts'
import {
  raceKeyFor,
  raceKeysOf,
  type Subject,
} from '../lib/profiles/subjects.ts'

const { values } = parseArgs({
  options: {
    ...REGION_OPTION,
    model: { type: 'string' },
    only: { type: 'string' },
    race: { type: 'string' },
    'max-cost': { type: 'string', default: '25' },
    refresh: { type: 'boolean', default: false },
    'no-research': { type: 'boolean', default: false },
    concurrency: { type: 'string', default: '2' },
    'dry-run': { type: 'boolean', default: false },
    endorsements: { type: 'string', default: 'gemini' },
  },
})
if (!['gemini', 'files'].includes(values.endorsements as string))
  throw new Error('--endorsements is gemini or files')
stagedOptions.endorsements = values.endorsements as 'gemini' | 'files'
const dryRun = values['dry-run']
const noResearch = values['no-research']
if (noResearch && values.refresh)
  throw new Error('--refresh and --no-research contradict each other')
const maxCost = Number(values['max-cost'])
const concurrency = Math.max(1, Number(values.concurrency))
if (!Number.isFinite(maxCost) || maxCost < 0) throw new Error('Bad --max-cost')
if (!dryRun && !values.model) {
  throw new Error('Choose a model with --model (or use --dry-run)')
}

// The real model sets the plan and estimate; a dry run calls a fake one.
const planned: ProfileGenerator | undefined = values.model
  ? modelById(values.model)
  : undefined
const chosen = dryRun ? fakeGenerator() : (planned as ProfileGenerator)
// With --no-research the model is only named (for the plan); calling it is a bug.
const generator: ProfileGenerator = noResearch
  ? {
      ...chosen,
      generate: () => {
        throw new Error('--no-research: a model was called')
      },
    }
  : chosen
const modelId = planned?.id ?? generator.id
const OUT = dryRun ? DRY_RUN_DIR : PROFILES_DIR
const RUNS = join(PIPELINE_BUILD, 'runs.jsonl')
const EVIDENCE = join(PIPELINE_BUILD, 'evidence')
const TRACES = join(PIPELINE_BUILD, 'traces')
const asOf = today()

// Who to do.
const { subjects: all, races } = await readSubjects()
let subjects: Subject[] = all
if (values.only) {
  const keys = values.only.split(',')
  const unknown = keys.filter((k) => !all.some((s) => s.key === k))
  if (unknown.length) throw new Error(`Unknown keys: ${unknown.join(', ')}`)
  subjects = subjects.filter((s) => keys.includes(s.key))
}
if (values.race) {
  const race = values.race
  subjects = subjects.filter((s) => raceKeysOf(s).includes(race))
  if (subjects.length === 0) throw new Error(`No one in race ${race}`)
}

// What exists, and the inputs that don't come from a model.
const existing = await readProfiles(PROFILES_DIR)
let money: { asOf: string; byKey: Record<string, MoneyInput> }
if (existsSync(MONEY)) {
  const file = await readJson<{
    generatedAt: string
    byKey: Record<string, MoneyInput>
  }>(MONEY)
  money = { asOf: chicagoDate(file.generatedAt), byKey: file.byKey }
} else if (dryRun) {
  console.warn(
    `No money.json for ${REGION.id}; money sections stay empty in this dry run`,
  )
  money = { asOf, byKey: {} }
} else {
  // Every region collects money; an empty section must mean nothing was
  // found, never that nobody looked.
  throw new Error(
    `No money.json for ${REGION.id}; run npm run profiles:money -- --region=${REGION.id} first`,
  )
}
const barRatings = await readBarRatings()
const incumbents = await readIncumbents()
const slates = await readSlates()
// Endorsing legislators' parties, from the official rosters (profiles:rosters).
const rosters: RosterMember[] = existsSync(ROSTERS)
  ? (await readJson<Rosters>(ROSTERS)).members
  : []
let partiesFilled = 0
const seats = await readSeats()

async function readSlates(): Promise<Slate[]> {
  if (!existsSync(SLATES_DIR)) return []
  const files = (await readdir(SLATES_DIR)).filter((f) => f.endsWith('.json'))
  return Promise.all(
    files.sort().map((f) => readJson<Slate>(join(SLATES_DIR, f))),
  )
}

/** How many candidates each race elects (a contest's "vote for"), by race key. */
async function readSeats(): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  // The same contest lists as profiles:subjects (scripts/la/ for Los Angeles).
  const files = IS_COOK
    ? ['cook-clerk', 'chicago-boe'].map((f) =>
        join(BUILD, 'contests', `${f}.json`),
      )
    : [join(BUILD, 'la', 'contests.json')]
  for (const path of files) {
    if (!existsSync(path)) continue
    const { contests } = await readJson<{ contests: Contest[] }>(path)
    for (const c of contests) {
      const n = c.kind === 'candidate' ? c.voteFor : 1
      const key = raceKeyFor(c)
      out.set(key, Math.max(out.get(key) ?? 1, n))
    }
  }
  return out
}

async function readBarRatings(): Promise<Record<string, BarRatings>> {
  if (!existsSync(BAR_RATINGS)) {
    console.log('No bar-ratings.json yet; judges get no merged bar ratings')
    return {}
  }
  return readJson<Record<string, BarRatings>>(BAR_RATINGS)
}

/** Incumbent labels from official lists (npm run data:incumbents). */
async function readIncumbents(): Promise<Incumbents> {
  if (!existsSync(INCUMBENTS)) {
    console.log('No incumbents file yet; no profile is labeled incumbent')
    return {}
  }
  return readJson<Incumbents>(INCUMBENTS)
}

async function readOverride(key: string): Promise<Override | undefined> {
  const path = join(OVERRIDES_DIR, `${key}.json`)
  return existsSync(path) ? readJson<Override>(path) : undefined
}

// The plan.
interface Job {
  subject: Subject
  prev?: CandidateProfile
  override?: Override
  research: boolean
}
const jobs: Job[] = []
for (const subject of subjects) {
  const prev = existing.get(subject.key)
  const override = await readOverride(subject.key)
  const plan = planFor(prev, subject, modelId, {
    refresh: values.refresh,
    noResearch,
    locked: override?.lock,
  })
  if (plan === 'skip') {
    console.log(
      `${subject.key}: no profile yet; skipped (${noResearch ? '--no-research' : 'locked by an override'})`,
    )
    continue
  }
  const research = plan === 'research'
  jobs.push({ subject, prev, override, research })
}
const toResearch = jobs.filter((j) => j.research)
const estimateEach =
  (ESTIMATE[modelId] ?? DEFAULT_ESTIMATE) +
  (planned && !planned.searches ? ESTIMATE.evidence : 0)
console.log(
  `${jobs.length} profiles: ${toResearch.length} to research with ${modelId} (~$${(toResearch.length * estimateEach).toFixed(2)}), ${jobs.length - toResearch.length} to refresh without a model. Cap $${maxCost}.`,
)
const withdrawn = [...existing.keys()].filter(
  (k) => !all.some((s) => s.key === k),
)
if (withdrawn.length)
  console.log(
    `No longer on the ballot (publish marks them withdrawn): ${withdrawn.join(', ')}`,
  )

if (!dryRun && toResearch.length > 0) {
  // Fail before any call (and any spend) when a key is missing.
  for (const key of requiredKeys([generator])) apiKey(key)
}

// The run.
let spent = 0
let stopped = false
/** The Gemini API's daily quota ran out during this run. */
let dailyLimit: string | undefined
const counts = { researched: 0, written: 0, unchanged: 0, failed: 0 }
const stale: string[] = []
/** Profiles assembled this run, before the race-wide endorsement check. */
const assembled = new Map<string, CandidateProfile>()
const filtered: RemovedEndorsement[] = []
const slateAdds: { key: string; slug: string }[] = []

async function evidenceFor(subject: Subject): Promise<EvidenceDoc[]> {
  if (generator.searches) return []
  const path = join(EVIDENCE, `${subject.key}.json`)
  if (existsSync(path)) return readJson<EvidenceDoc[]>(path)
  const { docs, costUsd } = await gatherEvidence(
    requestFor(subject, ELECTION.id, asOf),
  )
  spent += costUsd
  await writeJson(path, docs)
  return docs
}

async function log(entry: object) {
  if (dryRun) return
  await mkdir(PIPELINE_BUILD, { recursive: true })
  await appendFile(RUNS, `${JSON.stringify(entry)}\n`)
}

async function runJob(job: Job) {
  const { subject, prev, override } = job
  let base: CandidateProfile
  if (job.research) {
    const estimate = dryRun ? 0 : estimateEach
    if (stopped || spent + estimate > maxCost) {
      if (!stopped && !dailyLimit)
        console.log(
          `Stopping new research: $${spent.toFixed(2)} spent, the next profile (~$${estimate}) would pass $${maxCost}`,
        )
      stopped = true
      return
    }
    // Reserve the estimate while the call runs, so parallel jobs respect the cap.
    spent += estimate
    const at = new Date().toISOString()
    const req = requestFor(subject, ELECTION.id, asOf)
    try {
      const result = await generator.generate(req, await evidenceFor(subject))
      spent += result.costUsd - estimate
      base = toProfile(req, result.output, generator.id, at)
      counts.researched++
      // Staged runs keep the draft, the checker's verdicts and each step's
      // cost, for review.
      if (!dryRun && generator.provider === 'staged')
        await writeJson(join(TRACES, `${subject.key}.json`), {
          at,
          ...JSON.parse(result.rawText),
        })
      await log({
        at,
        model: generator.id,
        servedBy: result.servedBy,
        key: subject.key,
        ok: true,
        costUsd: result.costUsd,
        ms: result.ms,
      })
      if (!dryRun)
        console.log(
          `${subject.key}: researched, $${result.costUsd.toFixed(3)}, ${(result.ms / 1000).toFixed(0)}s`,
        )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof GeminiDailyLimitError) {
        // Not a failure of this profile: it's researched on the next run.
        spent -= estimate
        if (!dailyLimit) console.log(`${subject.key}: ${message}`)
        dailyLimit ??= message
        stopped = true
        return
      }
      // A failed call may still be billed; keep the estimate counted.
      counts.failed++
      await log({
        at,
        model: generator.id,
        key: subject.key,
        ok: false,
        costUsd: estimate,
        error: message,
      })
      console.log(`${subject.key}: failed: ${message}`)
      return
    }
  } else {
    base = withSubject(prev as CandidateProfile, subject)
  }

  // Endorsements a hand correction replaces or adds (by either name) are
  // the reviewer's call: the filter leaves them for the override to apply,
  // so a replacement survives the next run too.
  const handled = (override?.endorsements ?? []).flatMap((e) =>
    e.action === 'replace'
      ? [e.organization, e.endorsement.organization]
      : e.action === 'add'
        ? [e.endorsement.organization]
        : [],
  )
  const checked = filterEndorsementSources(
    base,
    handled,
    slates.map((s) => s.url),
  )
  filtered.push(...checked.removed)
  let profile = mergeMoney(
    checked.profile,
    money.byKey[subject.key],
    money.asOf,
  )
  profile = mergeBarRatings(profile, barRatings[subject.key])
  profile = mergeIncumbent(profile, incumbents[subject.key])
  const merged = mergeSlates(dropRatifiedParties(profile), slates)
  for (const slug of merged.added) slateAdds.push({ key: subject.key, slug })
  const applied = applyOverride(dropRatifiedParties(merged.profile), override)
  for (const s of applied.stale) stale.push(`${subject.key}: ${s}`)
  const parties = fillParties(applied.profile, rosters)
  partiesFilled += parties.filled.length
  assembled.set(subject.key, compactSources(parties.profile))
}

/**
 * A county party next to the state party whose pick it ratified is one
 * endorsement: the county party is dropped, before and after the official
 * lists are merged (place.ts partyPairs; none for Cook County).
 */
function dropRatifiedParties(p: CandidateProfile): CandidateProfile {
  const items = p.endorsements.items
  const drop = PLACE.partyPairs
    .filter(([, state]) =>
      items.some((e) => sameEndorser(e.organization, state)),
    )
    .map(([county]) => county)
  if (!drop.length) return p
  const kept = items.filter(
    (e) => !drop.some((county) => sameEndorser(e.organization, county)),
  )
  return kept.length === items.length
    ? p
    : { ...p, endorsements: { ...p.endorsements, items: kept } }
}

async function write(key: string, profile: CandidateProfile) {
  const prev = existing.get(key)
  // A dry run compares with the committed profile but writes elsewhere.
  const final = versioned(profile, prev)
  if (!final) {
    counts.unchanged++
    if (!dryRun) return
  }
  await writeFormattedJson(join(OUT, `${key}.json`), final ?? profile)
  counts.written++
}

const queue = [...jobs]
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) await runJob(job)
  }),
)

// The same endorser for opponents, race by race, over every profile: this
// run's, and the committed ones of everyone else in those races.
// Outside Cook County, a published list doesn't keep a shared endorser in a
// one-seat race: an endorser backing both rivals is dropped from both. Hand
// corrections still count.
const confirmed = new Set<string>()
const slateConfirmed = new Set<string>()
for (const slate of slates)
  for (const e of slate.entries)
    if (e.matchedKey)
      slateConfirmed.add(confirmation(e.matchedKey, slate.endorser))
for (const subject of all) {
  const override = await readOverride(subject.key)
  for (const edit of override?.endorsements ?? [])
    if (edit.action !== 'remove')
      confirmed.add(confirmation(subject.key, edit.endorsement.organization))
}
const current = (key: string) => assembled.get(key) ?? existing.get(key)
const touched = new Set(assembled.keys())
const shared: SharedEndorserRemoval[] = []
const others = new Map<string, CandidateProfile>()
for (const race of races) {
  if (!race.keys.some((k) => touched.has(k))) continue
  const profiles = race.keys
    .map((k) => others.get(k) ?? current(k))
    .filter((p): p is CandidateProfile => !!p)
  const raceSeats = seats.get(race.raceKey) ?? 1
  const result = dropSharedEndorsers(
    race.raceKey,
    profiles,
    raceSeats,
    IS_COOK || raceSeats > 1
      ? new Set([...confirmed, ...slateConfirmed])
      : confirmed,
  )
  shared.push(...result.removed)
  for (const p of result.changed) {
    const compact = compactSources(p)
    if (assembled.has(p.key)) assembled.set(p.key, compact)
    else others.set(p.key, compact)
  }
}

for (const [key, profile] of [...assembled, ...others])
  await write(key, profile)

// What the endorsement rules did.
const lostAll = [...assembled, ...others]
  .filter(([key, p]) => {
    const before = existing.get(key)?.endorsements.items.length ?? 0
    return before > 0 && p.endorsements.items.length === 0
  })
  .map(([key]) => key)
const byRule = new Map<SourceRule, RemovedEndorsement[]>()
for (const r of filtered) byRule.set(r.rule, [...(byRule.get(r.rule) ?? []), r])
console.log(`Endorsements dropped by source rules: ${filtered.length}`)
for (const [rule, list] of byRule) {
  console.log(`  ${rule} (${list.length}): ${SOURCE_RULES[rule]}`)
  for (const r of list.slice(0, 5))
    console.log(`    ${r.key}: ${r.organization} (${r.url})`)
}
console.log(
  `Endorsers credited to opponents, dropped where no slate confirms them: ${shared.length}`,
)
for (const r of shared)
  console.log(
    `  ${r.key}: ${r.organization} (also ${r.sharedWith.filter((k) => k !== r.key).join(', ')})`,
  )
const addsBySlate = new Map<string, number>()
for (const a of slateAdds)
  addsBySlate.set(a.slug, (addsBySlate.get(a.slug) ?? 0) + 1)
console.log(
  `Slate endorsements added: ${[...addsBySlate].map(([s, n]) => `${s} ${n}`).join(', ') || 'none'}`,
)
if (rosters.length)
  console.log(
    `Endorser parties set from the official rosters: ${partiesFilled}`,
  )
if (lostAll.length)
  console.log(`Profiles left with no endorsements: ${lostAll.join(', ')}`)
if (!dryRun)
  await writeJson(join(PIPELINE_BUILD, 'endorsement-changes.json'), {
    at: new Date().toISOString(),
    filtered,
    shared,
    slateAdds,
    lostAll,
  })

console.log(
  `Done: ${counts.researched} researched, ${counts.written} written to ${OUT.replace(`${process.cwd()}/`, '')}, ${counts.unchanged} unchanged, ${counts.failed} failed. Spent ~$${spent.toFixed(2)}.`,
)
if (stale.length) {
  console.log('Overrides that matched nothing (check them):')
  for (const s of stale) console.log(`  ${s}`)
}
const requests = geminiRequests.geminiApi + geminiRequests.vertex
if (requests)
  console.log(
    `Gemini requests: ${geminiRequests.geminiApi} through the Gemini API, ${geminiRequests.vertex} through Vertex AI.`,
  )
if (dailyLimit) {
  console.log(
    `Stopped: the Gemini API's daily limit was reached after ${geminiRequests.geminiApi} requests in this run. Finished profiles are saved; the quota resets at midnight Pacific time. To continue now, run again with VERTEX_PROJECT set (Vertex AI).`,
  )
  process.exitCode = 3
} else if (stopped) process.exitCode = 2
