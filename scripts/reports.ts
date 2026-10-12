// Lists the error reports readers sent about candidate profiles,
// newest first, from Supabase public.profile_reports. Reports hold only what
// the reader wrote; see content/profiles/README.md ("Error reports") for how
// a report becomes a correction.
// Needs SUPABASE_URL and SUPABASE_SECRET_KEY in .env (the secret key
// bypasses row-level security; it's never logged).
//
// Run: node --env-file=.env scripts/reports.ts [options]
//   --since YYYY-MM-DD   only reports sent on or after this day (UTC)
//   --json               print the reports as JSON instead of text
//   --delete <id>        delete one report and print what was deleted

import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    since: { type: 'string' },
    json: { type: 'boolean', default: false },
    delete: { type: 'string' },
  },
})

if (values.since !== undefined && !isDay(values.since)) {
  console.error('--since takes a date as YYYY-MM-DD, for example 2026-10-01')
  process.exit(1)
}
if (values.delete !== undefined && !/^[1-9]\d{0,18}$/.test(values.delete)) {
  console.error('--delete takes a report id (a whole number)')
  process.exit(1)
}

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
if (!url || !key || key.startsWith('your_')) {
  console.error(
    'Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env, then run with node --env-file=.env',
  )
  process.exit(1)
}
// The secret key goes in `apikey` only, as in publish.ts and the Worker.
const headers = { apikey: key, 'Content-Type': 'application/json' }

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

/** A row of public.profile_reports (supabase/migrations/*_profile_reports.sql). */
interface ReportRow {
  id: number
  election_id: string
  profile_key: string
  section: string
  message: string
  /** Null in reports sent before the link was required. */
  source_url: string | null
  profile_version: number | null
  status: string
  created_at: string
}

interface Report extends ReportRow {
  /** The candidate's name from the profile, when there still is one. */
  name: string | null
}

const COLUMNS =
  'id,election_id,profile_key,section,message,source_url,profile_version,status,created_at'
const PAGE = 1000

function isDay(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const date = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text)
}

async function readReports(since?: string): Promise<ReportRow[]> {
  const rows: ReportRow[] = []
  for (let offset = 0; ; offset += PAGE) {
    const params = new URLSearchParams({
      select: COLUMNS,
      order: 'created_at.desc,id.desc',
      limit: String(PAGE),
      offset: String(offset),
    })
    if (since) params.set('created_at', `gte.${since}T00:00:00Z`)
    const page = (await (
      await rest(`profile_reports?${params}`)
    ).json()) as ReportRow[]
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

/** Names by "election_id/key", read from the profiles the reports are about. */
async function readNames(rows: ReportRow[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  const keys = [...new Set(rows.map((r) => r.profile_key))]
  // Keys are [a-z0-9-] (checked by the table), so they are safe in in.(...).
  for (let i = 0; i < keys.length; i += 100) {
    const params = new URLSearchParams({
      select: 'election_id,key,name:data->>name',
      key: `in.(${keys.slice(i, i + 100).join(',')})`,
    })
    const found = (await (await rest(`profiles?${params}`)).json()) as {
      election_id: string
      key: string
      name: string | null
    }[]
    for (const p of found)
      if (p.name) names.set(`${p.election_id}/${p.key}`, p.name)
  }
  return names
}

function printReport(r: Report) {
  const who = r.name ? `${r.name} (${r.profile_key})` : r.profile_key
  console.log(`#${r.id}  ${r.created_at.slice(0, 10)}  ${who}`)
  console.log(
    `  Election: ${r.election_id}, profile version ${r.profile_version ?? 'unknown'}, status ${r.status}`,
  )
  console.log(`  Section: ${r.section}`)
  console.log(`  Source: ${r.source_url ?? '(none given)'}`)
  console.log(`  Message:`)
  for (const line of r.message.split('\n')) console.log(`    ${line}`)
  console.log('')
}

if (values.delete !== undefined) {
  const params = new URLSearchParams({ id: `eq.${values.delete}` })
  const deleted = (await (
    await rest(`profile_reports?${params}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    })
  ).json()) as ReportRow[]
  if (deleted.length === 0) {
    console.error(`No report with id ${values.delete}; nothing was deleted.`)
    process.exit(1)
  }
  console.log(`Deleted ${deleted.length} report:`)
  console.log(JSON.stringify(deleted, null, 2))
} else {
  const rows = await readReports(values.since)
  const names = rows.length > 0 ? await readNames(rows) : new Map()
  const reports: Report[] = rows.map((r) => ({
    ...r,
    name: names.get(`${r.election_id}/${r.profile_key}`) ?? null,
  }))
  if (values.json) {
    console.log(JSON.stringify(reports, null, 2))
  } else if (reports.length === 0) {
    console.log(
      values.since ? `No reports since ${values.since}.` : 'No reports.',
    )
  } else {
    for (const r of reports) printReport(r)
    console.log(
      `${reports.length} report${reports.length === 1 ? '' : 's'}${values.since ? ` since ${values.since}` : ''}, newest first.`,
    )
  }
}
