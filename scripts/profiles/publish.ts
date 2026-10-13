// Publishes checked profiles to Supabase public.profiles, where the
// Worker serves them. A race goes live only when every candidate in it
// passed `profiles:check`; otherwise its rows are stored as 'flagged' (not
// served). People no longer on the ballot become 'withdrawn'. Rows are
// upserted, never truncated, and unchanged rows aren't sent. Afterwards it
// writes the published list (content/profiles/published/) from what the
// table serves; commit it, since the site's build reads it.
// Needs SUPABASE_URL and SUPABASE_SECRET_KEY in .env (the secret key
// bypasses row-level security; it's never logged).
//
// Run: node --env-file=.env scripts/profiles/publish.ts [--dry-run]
//   --dry-run    read the table (if .env is set) and print what would change
//   --dir path   plan from another profiles folder (only with --dry-run)
//   --list       only rewrite the published list from the table

import { existsSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { readJson } from '../lib/data.ts'
import { ELECTION_ID } from '../lib/election.ts'
import {
  CHECK,
  PROFILES_DIR,
  readProfiles,
  readSubjects,
  writeFormattedJson,
} from '../lib/profiles/content.ts'
import {
  planPublish,
  type ExistingRow,
  type ProfileRow,
} from '../lib/profiles/publish.ts'
import type { CheckFile } from '../lib/profiles/review.ts'
import { PUBLISHED_LIST, type PublishedList } from '../lib/prerender.ts'

const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    dir: { type: 'string' },
    list: { type: 'boolean', default: false },
  },
})
const dryRun = values['dry-run']
if (values.dir && !dryRun) throw new Error('--dir works only with --dry-run')

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
const configured = !!url && !!key && !key.startsWith('your_')
if (!configured && !dryRun) {
  console.error(
    'Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env, then run with node --env-file=.env',
  )
  process.exit(1)
}
// The secret key goes in `apikey` only, as in load-supabase.ts and the Worker.
const headers = { apikey: key ?? '', 'Content-Type': 'application/json' }

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, ...init.headers },
  })
  if (!res.ok) {
    throw new Error(`${path.split('?')[0]}: ${res.status} ${await res.text()}`)
  }
  return res
}

async function readExisting(): Promise<ExistingRow[]> {
  const params = new URLSearchParams({
    select: 'key,status,content_hash,version,published_at',
    election_id: `eq.${ELECTION_ID}`,
  })
  const res = await rest(`profiles?${params}`)
  return (await res.json()) as ExistingRow[]
}

/** Rewrites the published list from what the table serves now. */
async function writePublishedList(): Promise<void> {
  const params = new URLSearchParams({
    select: 'key,content_hash',
    election_id: `eq.${ELECTION_ID}`,
    status: 'eq.published',
    order: 'key',
  })
  const res = await rest(`profiles?${params}`)
  const rows = (await res.json()) as { key: string; content_hash: string }[]
  const list: PublishedList = {
    electionId: ELECTION_ID,
    profiles: Object.fromEntries(rows.map((r) => [r.key, r.content_hash])),
  }
  await writeFormattedJson(PUBLISHED_LIST, list)
  console.log(
    `Published list: ${rows.length} profiles → ${relative(process.cwd(), PUBLISHED_LIST)} (commit it)`,
  )
}

if (values.list) {
  if (dryRun) throw new Error('--list writes the list; drop --dry-run')
  await writePublishedList()
  process.exit(0)
}

const { subjects } = await readSubjects()
const profiles = await readProfiles(
  values.dir ? resolve(values.dir) : PROFILES_DIR,
)
if (!existsSync(CHECK))
  throw new Error('No check.json; run profiles:check first')
const check = await readJson<CheckFile>(CHECK)
if (!check.links) {
  console.warn(
    'check.json was made with --no-links; treating every profile as unchecked',
  )
}

let existing: ExistingRow[] = []
if (configured) existing = await readExisting()
else console.log('No Supabase settings; planning against an empty table')

const plan = planPublish({
  electionId: ELECTION_ID,
  subjects,
  profiles,
  checks: check.links ? check.profiles : {},
  existing,
  now: new Date().toISOString(),
})

const byStatus = (s: ProfileRow['status']) =>
  plan.upserts.filter((r) => r.status === s)
console.log(
  `${profiles.size} profiles, ${existing.length} rows in Supabase. To send: ${byStatus('published').length} published, ${byStatus('flagged').length} flagged, ${byStatus('withdrawn').length} withdrawn; ${plan.withdraw.length} rows to mark withdrawn; ${plan.unchanged} unchanged.`,
)
console.log(`${plan.blocked.length} races held back`)
for (const b of plan.blocked.slice(0, 20))
  console.log(`  ${b.raceKey}: ${b.reason}`)
if (plan.blocked.length > 20)
  console.log(`  …and ${plan.blocked.length - 20} more (see profiles:report)`)

if (dryRun) {
  for (const r of plan.upserts)
    console.log(`  would upsert ${r.key} as ${r.status} (v${r.version})`)
  for (const k of plan.withdraw) console.log(`  would mark ${k} withdrawn`)
  process.exit(0)
}

const BATCH = 50
for (let i = 0; i < plan.upserts.length; i += BATCH) {
  await rest('profiles?on_conflict=election_id,key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(plan.upserts.slice(i, i + BATCH)),
  })
}
for (const k of plan.withdraw) {
  const params = new URLSearchParams({
    election_id: `eq.${ELECTION_ID}`,
    key: `eq.${k}`,
  })
  await rest(`profiles?${params}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'withdrawn' }),
  })
}
console.log(
  `Sent ${plan.upserts.length} rows and ${plan.withdraw.length} withdrawals`,
)
await writePublishedList()
