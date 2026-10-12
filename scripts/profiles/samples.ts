// Publishes pre-launch sample profiles to Supabase: every person on
// the ballot without a published profile of their own gets a finished
// profile of someone similar (scripts/lib/profiles/samples.ts), marked as a
// sample so the page says so. For design feedback only; clear before launch.
//
// Samples come from content/profiles (and, when present, earlier test runs
// in data/build/profiles-preview/deepseek-gemini).
//
// Run: node --env-file=.env scripts/profiles/samples.ts [--dry-run | --clear]
//   --dry-run   print who gets which sample
//   --clear     delete every sample row (rows whose data has "sample")

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import type { CandidateProfile } from '../../src/shared/profile.ts'
import { BUILD, readJson } from '../lib/data.ts'
import { ELECTION_ID } from '../lib/election.ts'
import {
  contentHash,
  PROFILES_DIR,
  readProfiles,
  readSubjects,
} from '../lib/profiles/content.ts'
import type { ProfileRow } from '../lib/profiles/publish.ts'
import {
  SAMPLE_KEYS,
  sampleFor,
  sampleProfile,
} from '../lib/profiles/samples.ts'

const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    clear: { type: 'boolean', default: false },
  },
})

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
if (!values['dry-run'] && (!url || !key || key.startsWith('your_'))) {
  console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env')
  process.exit(1)
}
// The secret key goes in `apikey` only, as in publish.ts; it's never logged.
async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key ?? '',
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  if (!res.ok)
    throw new Error(`${path.split('?')[0]}: ${res.status} ${await res.text()}`)
  return res
}

if (values.clear) {
  const params = new URLSearchParams({
    election_id: `eq.${ELECTION_ID}`,
    'data->sample': 'not.is.null',
  })
  const res = await rest(`profiles?${params}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' },
  })
  console.log(`Deleted ${((await res.json()) as unknown[]).length} sample rows`)
  process.exit(0)
}

// Finished profiles: committed ones first, then the test run's.
const finished = await readProfiles(PROFILES_DIR)
const PREVIEW = join(BUILD, 'profiles-preview', 'deepseek-gemini')
for (const k of Object.values(SAMPLE_KEYS)) {
  const path = join(PREVIEW, `${k}.json`)
  if (!finished.has(k) && existsSync(path))
    finished.set(k, await readJson<CandidateProfile>(path))
}
const missing = Object.values(SAMPLE_KEYS).filter((k) => !finished.has(k))
if (missing.length)
  console.log(`Not written yet, using stand-ins: ${missing.join(', ')}`)

// Rows already published for real are left alone.
const params = new URLSearchParams({
  select: 'key,status,data->sample',
  election_id: `eq.${ELECTION_ID}`,
})
const existing = values['dry-run']
  ? []
  : ((await (await rest(`profiles?${params}`)).json()) as {
      key: string
      status: string
      sample: unknown
    }[])
const realKeys = new Set(
  existing
    .filter((r) => r.status === 'published' && !r.sample)
    .map((r) => r.key),
)

const { subjects } = await readSubjects()
const available = new Set(finished.keys())
const now = new Date().toISOString()
const rows: ProfileRow[] = []
const tally = new Map<string, number>()
for (const s of subjects) {
  if (realKeys.has(s.key)) continue
  const from = sampleFor(s, available)
  tally.set(from, (tally.get(from) ?? 0) + 1)
  const data = sampleProfile(s, finished.get(from)!)
  rows.push({
    election_id: ELECTION_ID,
    key: s.key,
    status: 'published',
    data,
    version: data.meta.version,
    content_hash: contentHash(data),
    generated_at: data.meta.generatedAt,
    published_at: now,
  })
}
console.log(
  `${rows.length} sample rows (${realKeys.size} real profiles left alone):`,
)
for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1]))
  console.log(`  ${k}: ${n}`)
if (values['dry-run']) process.exit(0)

for (let i = 0; i < rows.length; i += 50) {
  await rest('profiles?on_conflict=election_id,key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows.slice(i, i + 50)),
  })
}
console.log(`Sent ${rows.length} rows`)
