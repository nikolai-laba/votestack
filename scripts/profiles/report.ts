// Writes the review queue: every flagged profile and why, grouped by
// race, plus people with no profile yet, to data/build/profiles/review-queue.md.
// Fix a profile with an override file (content/profiles/overrides/) or by
// regenerating it, then run profiles:check again.
// Also keeps data/build/profiles/chrome-review.json: the profiles whose
// cited pages the checker couldn't open, with their sentences and sources,
// for a review in a real browser. Entries stay (with their status and
// notes) until a reviewer marks them done.
// Run: node scripts/profiles/report.ts

import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { format } from 'prettier'
import { ROOT, readJson } from '../lib/data.ts'
import {
  CHECK,
  PIPELINE_BUILD,
  PROFILES_DIR,
  readSubjects,
} from '../lib/profiles/content.ts'
import { NONE_OPENED, type CheckFile } from '../lib/profiles/review.ts'
import type { CandidateProfile } from '../../src/shared/profile.ts'

const OUT = join(PIPELINE_BUILD, 'review-queue.md')

const check = await readJson<CheckFile>(CHECK)
const { subjects, races } = await readSubjects()
const office = new Map(races.map((r) => [r.raceKey, r.office]))
const subjectRace = new Map(subjects.map((s) => [s.key, s.raceKey]))

const flagged = Object.entries(check.profiles).filter(
  ([, p]) => p.status === 'flagged',
)
const byRace = new Map<string, string[]>()
const add = (raceKey: string, line: string) =>
  byRace.set(raceKey, [...(byRace.get(raceKey) ?? []), line])
for (const [key, p] of flagged) {
  const raceKey = subjectRace.get(key) ?? 'not on the ballot'
  add(
    raceKey,
    [`- **${p.name}** (\`${key}\`)`, ...p.reasons.map((r) => `  - ${r}`)].join(
      '\n',
    ),
  )
}
for (const m of check.missing)
  add(m.raceKey, `- **${m.name}** (\`${m.key}\`): no profile yet`)

const lines = [
  '# Profile review queue',
  '',
  `Checked ${check.checkedAt.slice(0, 16).replace('T', ' ')} UTC (as of ${check.today}${check.links ? '' : ', links not opened'}): ${Object.keys(check.profiles).length} profiles, ${flagged.length} flagged, ${check.missing.length} missing. A race publishes only when every candidate in it passes.`,
  '',
]
for (const raceKey of [...byRace.keys()].sort()) {
  lines.push(
    `## ${office.get(raceKey) ?? raceKey}`,
    '',
    `Race \`${raceKey}\``,
    '',
  )
  lines.push(...(byRace.get(raceKey) as string[]), '')
}
if (byRace.size === 0) lines.push('Nothing to review.', '')

await writeFile(OUT, await format(lines.join('\n'), { parser: 'markdown' }))
console.log(
  `${flagged.length} flagged and ${check.missing.length} missing in ${byRace.size} races. Wrote ${relative(ROOT, OUT)}`,
)

interface BrowserReview {
  key: string
  name: string
  office: string
  /** 'to do' until a reviewer opens the pages; then 'done'. */
  status: 'to do' | 'done'
  /** Still flagged in the latest check. */
  flagged: boolean
  notes?: string
  overview: string[]
  sources: { id: number; url: string; title: string }[]
}
const CHROME = join(PIPELINE_BUILD, 'chrome-review.json')
const queue = new Map<string, BrowserReview>(
  existsSync(CHROME)
    ? (await readJson<BrowserReview[]>(CHROME)).map((r) => [r.key, r])
    : [],
)
for (const r of queue.values()) r.flagged = false
for (const [key, p] of flagged) {
  if (!p.reasons.includes(NONE_OPENED)) continue
  const profile = await readJson<CandidateProfile>(
    join(PROFILES_DIR, `${key}.json`),
  )
  const earlier = queue.get(key)
  queue.set(key, {
    key,
    name: p.name,
    office: office.get(subjectRace.get(key) ?? '') ?? '',
    status: earlier?.status ?? 'to do',
    flagged: true,
    ...(earlier?.notes ? { notes: earlier.notes } : {}),
    overview: profile.overview.items.map((o) => o.text),
    sources: profile.sources.map((s) => ({
      id: s.id,
      url: s.url,
      title: s.title,
    })),
  })
}
await writeFile(CHROME, `${JSON.stringify([...queue.values()], null, 2)}\n`)
const todo = [...queue.values()].filter(
  (r) => r.flagged && r.status === 'to do',
)
console.log(
  `${todo.length} profiles to review in a browser (checker opened none of their pages). Wrote ${relative(ROOT, CHROME)}`,
)
