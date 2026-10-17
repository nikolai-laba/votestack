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

import { existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { IS_COOK, REGION_OPTION } from '../lib/profiles/region.ts'
import { ROOT, readJson, writeJson } from '../lib/data.ts'
import {
  CHECK,
  PIPELINE_BUILD,
  PROFILES_DIR,
  SUBJECTS,
  readProfiles,
  today,
} from '../lib/profiles/content.ts'
import { checkUrls, lastName, pagesMention } from '../lib/profiles/links.ts'
import type { SupportChecker } from '../lib/profiles/race-checks.ts'
import {
  NONE_OPENED,
  reviewProfiles,
  type CheckFile,
} from '../lib/profiles/review.ts'
import type { SubjectsFile } from '../lib/profiles/subjects.ts'

const { values } = parseArgs({
  options: {
    ...REGION_OPTION,
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

// Outside Cook County: every overview sentence's cited page must name the
// candidate. A page that can't be read is left to the link checks; one that
// reads but never mentions them is a reason to review the profile.
if (!IS_COOK && links) {
  const wanted = [...profiles.values()].flatMap((p) =>
    p.overview.items.flatMap((para) =>
      (para.sentences ?? []).flatMap((s) =>
        s.cites.flatMap((id) => {
          const url = p.sources.find((x) => x.id === id)?.url
          return url ? [{ key: p.key, url, name: lastName(p.name) }] : []
        }),
      ),
    ),
  )
  // The checker's own notes: sentences it kept on the captured excerpt
  // because the page wouldn't open, and checks that opened no page at all.
  const browserPath = join(PIPELINE_BUILD, 'chrome-review.json')
  const browserReviewed = new Set(
    existsSync(browserPath)
      ? (
          await readJson<{ key: string; status: string }[]>(browserPath)
        ).flatMap((r) => (r.status === 'done' ? [r.key] : []))
      : [],
  )
  for (const p of profiles.values()) {
    const path = join(PIPELINE_BUILD, 'traces', `${p.key}.json`)
    const entry = result.profiles[p.key]
    if (!entry || !existsSync(path)) continue
    const trace = await readJson<{
      review?: { note?: string }[]
      stages?: { stage: string; pages?: { opened: number } }[]
    }>(path)
    const excerptOnly = (trace.review ?? []).filter((r) =>
      /^excerpt only/i.test(r.note ?? ''),
    ).length
    // A warning, not a reason: paywalled news is common, and the excerpt
    // was captured from the page itself.
    if (excerptOnly)
      entry.warnings.push(
        `source: ${excerptOnly} sentence(s) kept on the captured excerpt; the page wouldn't open`,
      )
    const checks = (trace.stages ?? []).filter((s) => s.stage === 'check')
    if (checks.length && checks.every((s) => s.pages?.opened === 0)) {
      // A browser review (report.ts's chrome-review.json) stands in for it.
      if (browserReviewed.has(p.key))
        entry.warnings.push(
          'source: the checker opened none of the cited pages; checked in a browser instead',
        )
      else entry.reasons.push(NONE_OPENED)
    }
    if (entry.reasons.length) entry.status = 'flagged'
  }
  const mentions = await pagesMention(wanted)
  for (const w of wanted) {
    if (mentions.get(`${w.url} ${w.name}`) !== false) continue
    const entry = result.profiles[w.key]
    const reason = `source: cited page doesn't name the candidate: ${w.url}`
    if (!entry || entry.reasons.includes(reason)) continue
    // A person read this profile's pages in a browser (chrome-review.json).
    if (browserReviewed.has(w.key)) {
      entry.warnings.push(`${reason}; checked in a browser instead`)
      continue
    }
    entry.reasons.push(reason)
    entry.status = 'flagged'
  }
}
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
