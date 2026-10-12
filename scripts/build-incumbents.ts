// Incumbent labels: which candidates hold the seat they're running
// for, from official lists only (see scripts/lib/incumbents.ts). Reads the
// profile subjects (npm run profiles:subjects), the FEC candidate summary,
// the ilga.gov member lists and the hand-checked content/incumbents/rosters.json,
// and writes content/incumbents/{election date}.json, which load-supabase.ts
// merges into the contests and profiles:generate into the profiles.
// Downloads are cached in data/raw/ for a day; --refresh fetches them again.
// ilga.gov serves an incomplete certificate chain that Node's fetch rejects,
// so its pages are fetched with curl, which completes the chain.
// Run: npm run data:incumbents [-- --refresh]

import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, stat } from 'node:fs/promises'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { chicagoDate } from '../src/shared/dates.ts'
import { RAW, ROOT, readJson } from './lib/data.ts'
import {
  buildIncumbents,
  ilgaListUrl,
  parseIlgaMembers,
  type Chamber,
  type Person,
  type RosterFile,
} from './lib/incumbents.ts'
import {
  INCUMBENTS,
  SUBJECTS,
  writeFormattedJson,
} from './lib/profiles/content.ts'
import { downloadFec, FEC_CYCLE, loadFec } from './lib/profiles/fec.ts'

const MAX_AGE_HOURS = process.argv.includes('--refresh') ? 0 : 24
const FEC_DIR = join(RAW, 'money', 'fec')
const ILGA_DIR = join(RAW, 'incumbents')
const ROSTERS = join(ROOT, 'content', 'incumbents', 'rosters.json')

/** Like cachedDownload (scripts/lib/profiles/download.ts), through curl. */
async function curlDownload(url: string, path: string, maxAgeHours: number) {
  const existing = await stat(path).catch(() => null)
  if (existing && Date.now() - existing.mtimeMs < maxAgeHours * 3_600_000)
    return
  await mkdir(ILGA_DIR, { recursive: true })
  console.log(`Downloading ${url}`)
  await promisify(execFile)('curl', [
    '--silent',
    '--show-error',
    '--fail',
    '--location',
    '--user-agent',
    'VoteStack data import (votestack.org)',
    '--output',
    `${path}.partial`,
    url,
  ])
  await rename(`${path}.partial`, path)
}

const checkedOn = async (path: string) => chicagoDate((await stat(path)).mtime)

const { subjects } = await readJson<{ subjects: Person[] }>(SUBJECTS)

await downloadFec(FEC_DIR, MAX_AGE_HOURS)
const fecFile = join(FEC_DIR, `candidate_summary_${FEC_CYCLE}.csv`)
const fec = {
  candidates: (await loadFec(FEC_DIR)).candidates,
  checked: await checkedOn(fecFile),
}

const ilga = {} as Record<
  Chamber,
  { members: ReturnType<typeof parseIlgaMembers>; checked: string }
>
for (const chamber of ['House', 'Senate'] as const) {
  const path = join(ILGA_DIR, `ilga-${chamber.toLowerCase()}.html`)
  await curlDownload(ilgaListUrl(chamber), path, MAX_AGE_HOURS)
  const members = parseIlgaMembers(await readFile(path, 'utf8'))
  const seats = chamber === 'House' ? 118 : 59
  // A page change that drops members would silently drop labels.
  if (new Set(members.map((m) => m.district)).size < seats * 0.9)
    throw new Error(
      `${ilgaListUrl(chamber)} lists ${members.length} current members; expected about ${seats}. Has the page changed?`,
    )
  ilga[chamber] = { members, checked: await checkedOn(path) }
}

const rosters = await readJson<RosterFile>(ROSTERS)
const { incumbents, unusedRoster } = buildIncumbents(subjects, {
  fec,
  ilga,
  roster: rosters.entries,
})
if (unusedRoster.length)
  throw new Error(
    `Roster entries that match no candidate (fix rosters.json):\n${unusedRoster.map((r) => `  ${r.office}: ${r.name}`).join('\n')}`,
  )

await writeFormattedJson(INCUMBENTS, incumbents)

// What was labeled, by office type, for the log.
const byType = new Map<string, { labeled: number; candidates: number }>()
for (const s of subjects) {
  if (s.kind !== 'candidate') continue
  const t = byType.get(s.officeType) ?? { labeled: 0, candidates: 0 }
  t.candidates++
  if (incumbents[s.key]) t.labeled++
  byType.set(s.officeType, t)
}
console.log(
  `${Object.keys(incumbents).length} incumbents → ${INCUMBENTS.slice(ROOT.length + 1)}`,
)
for (const [type, t] of [...byType].sort())
  console.log(`  ${type}: ${t.labeled} of ${t.candidates} candidates`)
for (const u of rosters.unconfirmed)
  console.log(
    `  unconfirmed: ${u.office}${u.names ? ` (${u.names.join(', ')})` : ''}: ${u.reason}`,
  )
