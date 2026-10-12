// Checks every generated profile before publishing: the text checks
// in scripts/lib/profiles/checks.ts, dates, equal coverage within each race
// and every cited link (opened politely, results cached). Writes
// data/build/profiles/check.json with passed or flagged per profile and the
// reasons. A flagged profile holds back its whole race at publish.
//
// Run: node scripts/profiles/check.ts [options]
//   --dir path        profiles folder (default content/profiles/{election date})
//   --subjects path   subjects file (default data/build/profiles/subjects.json)
//   --out path        result file (default data/build/profiles/check.json)
//   --no-links        don't open links (offline; flags nothing for links)
//   --refresh-links   open every link again, ignoring the cache
//   --support         also ask a second model whether each source supports
//                     its sentence (not wired to a model yet; skipped)
//   --today YYYY-MM-DD  date the checks run as (default today in Chicago)

import { relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { ROOT, readJson, writeJson } from '../lib/data.ts'
import {
  CHECK,
  PROFILES_DIR,
  SUBJECTS,
  readProfiles,
  today,
} from '../lib/profiles/content.ts'
import { checkUrls } from '../lib/profiles/links.ts'
import type { SupportChecker } from '../lib/profiles/race-checks.ts'
import { reviewProfiles, type CheckFile } from '../lib/profiles/review.ts'
import type { SubjectsFile } from '../lib/profiles/subjects.ts'

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    subjects: { type: 'string' },
    out: { type: 'string' },
    'no-links': { type: 'boolean', default: false },
    'refresh-links': { type: 'boolean', default: false },
    support: { type: 'boolean', default: false },
    today: { type: 'string' },
  },
})
const dir = values.dir ? resolve(values.dir) : PROFILES_DIR
const out = values.out ? resolve(values.out) : CHECK
const day = values.today ?? today()

/** Second-model support checkers; none is chosen yet (see SupportChecker). */
const SUPPORT_CHECKERS: SupportChecker[] = []

const { subjects } = await readJson<SubjectsFile>(
  values.subjects ? resolve(values.subjects) : SUBJECTS,
)
const profiles = await readProfiles(dir)
console.log(`${profiles.size} profiles in ${relative(ROOT, dir)}`)

const links = values['no-links']
  ? undefined
  : await checkUrls(
      [...profiles.values()].flatMap((p) => p.sources.map((s) => s.url)),
      { refresh: values['refresh-links'] },
    )

if (values.support) {
  const checker = SUPPORT_CHECKERS.find((c) => process.env[c.keyName])
  console.log(
    checker
      ? `Support check with ${checker.id} isn't implemented yet; skipped`
      : 'No support checker configured (or no key set); skipped',
  )
}

const result = reviewProfiles(profiles, subjects, { today: day, links })
const file: CheckFile = {
  checkedAt: new Date().toISOString(),
  today: day,
  dir: relative(ROOT, dir),
  links: !!links,
  ...result,
}
await writeJson(out, file)

const all = Object.values(result.profiles)
const flagged = all.filter((p) => p.status === 'flagged')
console.log(
  `${all.length - flagged.length} passed, ${flagged.length} flagged, ${result.missing.length} people without a profile. Wrote ${relative(ROOT, out)}`,
)
const rules = new Map<string, number>()
for (const p of flagged)
  for (const r of p.reasons) {
    const rule = r.split(/[ :]/)[0]
    rules.set(rule, (rules.get(rule) ?? 0) + 1)
  }
if (rules.size)
  console.log(
    `  reasons: ${[...rules].map(([r, n]) => `${r} ${n}`).join(', ')}`,
  )
