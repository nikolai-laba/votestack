// Removes overview sentences and endorsements whose only sources are dead
// (404, 410 or a login page, from the last `profiles:check` link results)
// from the committed profiles, and lists what was removed in
// data/build/profiles/pruned.json for review. Profiles that lose more than
// a third of their sentences are listed as "research again".
//
// Run after `npm run profiles:check`: node scripts/profiles/prune-dead-links.ts [--dry-run]

import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { readJson, writeJson } from '../lib/data.ts'
import {
  PIPELINE_BUILD,
  PROFILES_DIR,
  readProfiles,
  writeFormattedJson,
} from '../lib/profiles/content.ts'
import { versioned } from '../lib/profiles/assemble.ts'
import { pruneDeadSources } from '../lib/profiles/prune.ts'
import { isDeadLink, type LinkResult } from '../lib/profiles/race-checks.ts'

const { values } = parseArgs({
  options: { 'dry-run': { type: 'boolean', default: false } },
})
const links = await readJson<Record<string, LinkResult>>(
  join(PIPELINE_BUILD, 'link-cache.json'),
)
const dead = (url: string) => {
  const r = links[url]
  return !!r && (isDeadLink(r.status) || r.gate === 'login')
}

const sentences = (p: { overview: { items: { sentences?: unknown[] }[] } }) =>
  p.overview.items.reduce((n, o) => n + (o.sentences?.length ?? 1), 0)

const report: Record<string, { removed: string[]; researchAgain: boolean }> = {}
for (const [key, p] of await readProfiles(PROFILES_DIR)) {
  const { profile, removed } = pruneDeadSources(p, dead)
  if (!removed.length) continue
  const before = sentences(p)
  const lost = before - sentences(profile)
  report[key] = { removed, researchAgain: lost * 3 > before }
  const next = versioned(profile, p)
  if (next && !values['dry-run'])
    await writeFormattedJson(join(PROFILES_DIR, `${key}.json`), next)
}
await writeJson(join(PIPELINE_BUILD, 'pruned.json'), report)
const keys = Object.keys(report)
console.log(
  `${keys.length} profiles had dead sources; ${Object.values(report).reduce((n, r) => n + r.removed.length, 0)} items removed${values['dry-run'] ? ' (dry run)' : ''}.`,
)
const again = keys.filter((k) => report[k].researchAgain)
console.log(`Research again (lost over a third): ${again.join(', ') || 'none'}`)
