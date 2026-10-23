// Builds a private usage report: one HTML file, opened locally, with the
// anonymous usage counts (Supabase usage_hourly, see src/shared/metrics.ts),
// plus totals of error reports and email sign-ups. Filters, charts and
// tables run in the page itself, from the data written into it.
//
// The report holds counts only: never an email address, a report's text or
// anything else a person typed. It still goes in gitignored data/build/,
// since usage numbers aren't published.
//
// Needs SUPABASE_URL and SUPABASE_SECRET_KEY in .env (the secret key bypasses
// row-level security; it's never logged or written into the page). With
// CF_ACCOUNT_ID and CF_ANALYTICS_TOKEN (Account Analytics: Read) in .env as
// well, it also reads the hours the daily rollup hasn't copied yet straight
// from Analytics Engine.
//
// Run: npm run usage:report [-- --open] [-- --out <file>]

import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { profileKey } from '../src/shared/profile.ts'
import { excludeScraper, type Row } from './lib/usage-exclusions.ts'

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: 'data/build/usage/report.html' },
    open: { type: 'boolean', default: false },
  },
})

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
if (!url || !key || key.startsWith('your_')) {
  console.error(
    'Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env, then run npm run usage:report',
  )
  process.exit(1)
}
// The secret key goes in `apikey` only, as in publish.ts and the Worker.
const headers = { apikey: key }
const PAGE = 1000

/** Every row of a table or view, a page at a time. */
async function readAll<T>(table: string, query: string): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(
      `${url}/rest/v1/${table}?${query}&limit=${PAGE}&offset=${offset}`,
      { headers },
    )
    if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`)
    const page = (await res.json()) as T[]
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

interface HourRow {
  hour: string
  event: string
  a: string
  b: string
  c: string
  n: number
  d1: number
  d2: number
  d3: number
  d4: number
  d5: number
  d6: number
  d7: number
  d8: number
}

const hourRows = await readAll<HourRow>(
  'usage_hourly',
  'select=hour,event,a,b,c,n,d1,d2,d3,d4,d5,d6,d7,d8&order=hour,event,a,b,c',
)
const rows: Row[] = hourRows.map((r) => [
  Date.parse(r.hour) / 1000,
  r.event,
  r.a,
  r.b,
  r.c,
  r.n,
  r.d1,
  r.d2,
  r.d3,
  r.d4,
  r.d5,
  r.d6,
  r.d7,
  r.d8,
  0,
])
const rolledUpTo = rows.length ? Math.max(...rows.map((r) => r[0])) : 0

// Hours after the last rollup, read from Analytics Engine when the keys are
// set. The rollup copies whole hours once a day, so without this the report
// can trail by up to a day.
let liveNote = 'not read (CF_ACCOUNT_ID and CF_ANALYTICS_TOKEN not set)'
const cfAccount = process.env.CF_ACCOUNT_ID
const cfToken = process.env.CF_ANALYTICS_TOKEN
if (cfAccount && cfToken) {
  const sums = Array.from(
    { length: 8 },
    (_, i) => `SUM(_sample_interval * double${i + 1}) AS d${i + 1}`,
  ).join(', ')
  const since = Math.max(rolledUpTo + 3600, Date.now() / 1000 - 3 * 86_400)
  const sql = `
SELECT toUnixTimestamp(toStartOfHour(timestamp)) AS hour,
  blob1 AS event, blob2 AS a, blob3 AS b, blob4 AS c,
  SUM(_sample_interval) AS n, ${sums}
FROM votestack_usage
WHERE timestamp >= toDateTime(${Math.floor(since)})
GROUP BY hour, event, a, b, c
FORMAT JSON`
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/analytics_engine/sql`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfToken}` },
        body: sql,
      },
    )
    if (!res.ok) throw new Error(`status ${res.status}`)
    const data = (await res.json()) as { data?: Record<string, unknown>[] }
    const live = data.data ?? []
    const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
    for (const r of live) {
      rows.push([
        num(r.hour),
        String(r.event ?? ''),
        String(r.a ?? ''),
        String(r.b ?? ''),
        String(r.c ?? ''),
        num(r.n),
        ...Array.from({ length: 8 }, (_, i) => num(r[`d${i + 1}`])),
        1,
      ])
    }
    liveNote = `${live.length} rows read from Analytics Engine`
  } catch (err) {
    liveNote = `failed (${(err as Error).message}); showing rolled-up hours only`
    console.warn(`Analytics Engine read ${liveNote}`)
  }
}

// Totals only: the report's text and the sign-up's email are never read.
const reports = await readAll<{
  created_at: string
  status: string
  section: string
  election_id: string
}>('profile_reports', 'select=created_at,status,section,election_id')
const signups = await readAll<{
  created_at: string
  zip: string
  scope: string
  source: string | null
  updates_consented_at: string | null
}>(
  'expansion_signups',
  'select=created_at,zip,scope,source,updates_consented_at',
)

// Names for candidate and race pages, from the committed race lists.
interface ContestFile {
  electionId: string
  area: string
  areaPath: string
  races: {
    level: string
    path: string
    title: string
    candidates?: { name: string }[]
  }[]
}
const contestFiles: ContestFile[] = []
async function findContests(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await findContests(path)
    else if (entry.name.endsWith('.json'))
      contestFiles.push(JSON.parse(await readFile(path, 'utf8')))
  }
}
await findContests('content/contests')

const areaOf = (areaPath: string) =>
  areaPath.startsWith('il/')
    ? 'il-cook'
    : areaPath.startsWith('ca/')
      ? 'ca-la'
      : 'none'
const candidates: Record<string, [name: string, race: string, area: string]> =
  {}
const races: Record<string, [title: string, level: string, area: string]> = {}
for (const file of contestFiles) {
  const area = areaOf(file.areaPath)
  races[file.areaPath] = [`All races, ${file.area}`, '', area]
  for (const race of file.races) {
    races[race.path] = [race.title, race.level, area]
    for (const c of race.candidates ?? []) {
      candidates[profileKey(c.name)] ??= [c.name, race.title, area]
    }
  }
}

// The scraper's counts from before the app stopped counting it.
const excluded = excludeScraper(rows)
const excludedNote = excluded.dropped.views
  ? `${excluded.dropped.views} scraper visits to report pages and an estimated ${excluded.dropped.active} of their time counts left out (Oct 18–22, 2026)`
  : ''

const data = {
  generatedAt: new Date().toISOString(),
  rolledUpTo,
  liveNote,
  excludedNote,
  rows: excluded.rows,
  reports: reports.map((r) => [
    r.created_at,
    r.status,
    r.section,
    r.election_id,
  ]),
  // Email list sign-ups are dated by when they joined the list. Their ZIP
  // codes are for the emails only, so only the area-only sign-ups (whose
  // sign-up said ZIP codes are counted) are counted by ZIP.
  signups: signups.map((s) =>
    s.scope === 'updates'
      ? [s.updates_consented_at ?? s.created_at, null, s.scope, s.source]
      : [s.created_at, s.zip, s.scope, s.source],
  ),
  candidates,
  races,
}

const template = await readFile(
  new URL('./lib/usage-report.html', import.meta.url),
  'utf8',
)
// `<` is escaped so no value can close the script tag.
const json = JSON.stringify(data).replace(/</g, '\\u003c')
// Either quote style, since formatters may change it.
const placeholder = /(["'])__USAGE_DATA__\1/
if (!placeholder.test(template)) {
  throw new Error('The data placeholder is missing from usage-report.html')
}
const html = template.replace(placeholder, () => json)

const out = resolve(values.out)
await mkdir(dirname(out), { recursive: true })
await writeFile(out, html)
console.log(
  `Wrote ${out}\n  ${hourRows.length} rolled-up rows, live hours: ${liveNote}\n  ${reports.length} error reports, ${signups.length} sign-ups`,
)
if (values.open) execFile('open', [out])
