// Writes the review queue: every flagged profile and why, grouped by
// race, plus people with no profile yet, to data/build/profiles/review-queue.md.
// Fix a profile with an override file (content/profiles/overrides/) or by
// regenerating it, then run profiles:check again.
// Run: node scripts/profiles/report.ts

import { writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { format } from 'prettier'
import { ROOT, readJson } from '../lib/data.ts'
import { CHECK, PIPELINE_BUILD, readSubjects } from '../lib/profiles/content.ts'
import type { CheckFile } from '../lib/profiles/review.ts'

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
