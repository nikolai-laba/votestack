// Applies the rules decided for endorsements a researcher set aside (`held`,
// each with a `question`) in data/build/profiles[/{region}]/endorsements/:
// an entry under a rule that takes it in moves to `endorsements`, an entry
// under a rule that leaves it out is dropped, and anything else stays held.
// Every move and drop is logged to held-rules-{date}.json. Then run generate
// with `--endorsements files --refresh` to rebuild the profiles from them.
//
// Run:  node scripts/profiles/release-held.ts --region ca-la [--dry-run]

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { readJson } from '../lib/data.ts'
import {
  PIPELINE_BUILD,
  today,
  writeFormattedJson,
} from '../lib/profiles/content.ts'
import {
  ENDORSEMENTS,
  type EndorsementFile,
} from '../lib/profiles/providers/staged.ts'
import { REGION_OPTION } from '../lib/profiles/region.ts'

const { values } = parseArgs({
  options: { 'dry-run': { type: 'boolean' }, ...REGION_OPTION },
})

type Rule = 'take' | 'take-oppose' | 'drop'

/** What each question's answer is. Questions not listed stay held. */
const RULES: Record<string, Rule> = {
  // A group listed for both rivals: shown on both profiles.
  dual: 'take',
  // A group's published "vote No" on keeping a judge, shown apart from support.
  'retention-no': 'take-oppose',
  // Campaign pages carried over from 2024: left out.
  'stale-campaign-page': 'drop',
  // Endorsements seen only in an embedded social media post: left out.
  'embedded-social': 'drop',
}

const log: { key: string; question: string; name: string; rule: Rule }[] = []
const files = (await readdir(ENDORSEMENTS)).filter((f) => f.endsWith('.json'))
for (const f of files.sort()) {
  const path = join(ENDORSEMENTS, f)
  const file = await readJson<EndorsementFile>(path)
  if (!file.held?.length) continue
  const kept: NonNullable<EndorsementFile['held']> = []
  const taken: EndorsementFile['endorsements'] = []
  for (const h of file.held) {
    const rule = RULES[h.question]
    if (!rule) {
      kept.push(h)
      continue
    }
    log.push({ key: file.key, question: h.question, name: h.name, rule })
    if (rule === 'drop') continue
    const { question: _q, why: _w, ...entry } = h
    taken.push(rule === 'take-oppose' ? { ...entry, stance: 'oppose' } : entry)
  }
  if (kept.length === file.held.length) continue
  const next: EndorsementFile = {
    ...file,
    endorsements: [...file.endorsements, ...taken],
    held: kept,
  }
  if (!values['dry-run']) await writeFormattedJson(path, next)
}

const counts = Object.entries(
  log.reduce<Record<string, number>>((n, e) => {
    const k = `${e.question} → ${e.rule}`
    n[k] = (n[k] ?? 0) + 1
    return n
  }, {}),
)
for (const [k, n] of counts) console.log(`${n}\t${k}`)
if (!values['dry-run'] && log.length)
  await writeFormattedJson(
    join(PIPELINE_BUILD, `held-rules-${today()}.json`),
    log,
  )
console.log(values['dry-run'] ? '(dry run: nothing written)' : 'Done.')
