// Researches only the endorsements of finished profiles again, with
// the current endorsement rules, and swaps them in: the overview, money and
// bar ratings are kept. Then run `generate --no-research` to apply the
// source rules, slates and overrides. About $0.13 a profile (Gemini only).
//
// Run: node --env-file=.env scripts/profiles/endorse.ts --only a,b [--max-cost 20] [--concurrency 6]
//      node --env-file=.env scripts/profiles/endorse.ts --skip a,b ...   (everyone else with a profile)

import { join } from 'node:path'
import { parseArgs } from 'node:util'
import type { CandidateProfile } from '../../src/shared/profile.ts'
import { ELECTION, REGION_OPTION } from '../lib/profiles/region.ts'
import {
  compactSources,
  requestFor,
  versioned,
} from '../lib/profiles/assemble.ts'
import {
  PROFILES_DIR,
  readProfiles,
  readSubjects,
  today,
  writeFormattedJson,
} from '../lib/profiles/content.ts'
import { endorsementsOnly } from '../lib/profiles/providers/staged.ts'

const WRITER = 'deepseek/deepseek-v4-pro'
const CHECKER = 'gemini-3.1-pro-preview'

const { values } = parseArgs({
  options: {
    ...REGION_OPTION,
    only: { type: 'string' },
    skip: { type: 'string' },
    'max-cost': { type: 'string', default: '20' },
    concurrency: { type: 'string', default: '6' },
  },
})
const maxCost = Number(values['max-cost'])
const only = values.only?.split(',')
const skip = new Set(values.skip?.split(',') ?? [])

const { subjects } = await readSubjects()
const profiles = await readProfiles(PROFILES_DIR)
const todo = subjects.filter(
  (s) =>
    profiles.has(s.key) && !skip.has(s.key) && (!only || only.includes(s.key)),
)
console.log(
  `${todo.length} profiles to refresh endorsements for; cap $${maxCost}`,
)

/** Swaps the AI-found endorsements, keeping bar ratings and the overview. */
function swap(
  p: CandidateProfile,
  fresh: Awaited<ReturnType<typeof endorsementsOnly>>['output'],
): CandidateProfile {
  const offset = Math.max(0, ...p.sources.map((s) => s.id))
  const bar = p.endorsements.items.filter((e) => e.kind === 'bar_evaluation')
  return compactSources({
    ...p,
    endorsements: {
      asOf: today(),
      items: [
        ...fresh.endorsements.map((e) => ({
          ...e,
          cites: e.cites.map((c) => c + offset),
        })),
        ...bar,
      ],
    },
    sources: [
      ...p.sources,
      ...fresh.sources.map((s) => ({
        ...s,
        id: s.id + offset,
        viewedAt: today(),
      })),
    ],
  })
}

let spent = 0
let done = 0
const queue = [...todo]
await Promise.all(
  Array.from({ length: Math.max(1, Number(values.concurrency)) }, async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      if (spent + 0.2 > maxCost) return
      spent += 0.2
      try {
        const { output, costUsd } = await endorsementsOnly(
          requestFor(s, ELECTION.id, today()),
          WRITER,
          CHECKER,
        )
        spent += costUsd - 0.2
        const prev = profiles.get(s.key) as CandidateProfile
        const next = versioned(swap(prev, output), prev)
        if (next)
          await writeFormattedJson(join(PROFILES_DIR, `${s.key}.json`), next)
        done++
        console.log(
          `${s.key}: ${output.endorsements.length} endorsements, $${costUsd.toFixed(3)}`,
        )
      } catch (error) {
        console.log(
          `${s.key}: failed: ${(error as Error).message.slice(0, 200)}`,
        )
      }
    }
  }),
)
console.log(`Done: ${done} refreshed, ~$${spent.toFixed(2)} spent.`)
