// Runs the staged pipeline's check step (Gemini opens every cited page and
// keeps, corrects, re-sources or removes each sentence) for whole races,
// ahead of profiles:generate, which then reuses the checks without new
// requests. With --pack 2 or 3, candidates in the same race share one
// request (at most 20 cited pages in all), to use fewer requests against the
// Gemini API's daily limit. --out writes elsewhere than the check cache, to
// compare packed and single checks before relying on packing.
//
// Run: node --env-file=.env scripts/profiles/check-races.ts --region=ca-la
//        --only a,b | --race k1,k2  [--pack 1] [--out checks] [--concurrency 4]
// Drafts come from the draft cache (profiles:drafts); a missing one is
// searched and drafted first.

import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { requestFor } from '../lib/profiles/assemble.ts'
import { PIPELINE_BUILD, readSubjects, today } from '../lib/profiles/content.ts'
import { apiKey } from '../lib/profiles/generator.ts'
import {
  GeminiDailyLimitError,
  geminiRequests,
} from '../lib/profiles/providers/gemini.ts'
import { CHECKS, checkPacked } from '../lib/profiles/providers/staged.ts'
import { ELECTION, REGION_OPTION } from '../lib/profiles/region.ts'
import { groupByRace } from '../lib/profiles/subjects.ts'

const WRITER = 'deepseek/deepseek-v4-pro'
const CHECKER = 'gemini-3.1-pro-preview'

const { values } = parseArgs({
  options: {
    ...REGION_OPTION,
    only: { type: 'string' },
    race: { type: 'string' },
    pack: { type: 'string', default: '1' },
    out: { type: 'string', default: 'checks' },
    concurrency: { type: 'string', default: '4' },
  },
})
const pack = Number(values.pack)
if (![1, 2, 3].includes(pack)) throw new Error('--pack is 1, 2 or 3')
if (!values.only && !values.race) throw new Error('Choose --only or --race')
if (!process.env.VERTEX_PROJECT) apiKey('GEMINI_API_KEY')

const outDir =
  values.out === 'checks' ? CHECKS : join(PIPELINE_BUILD, values.out)
const only = values.only?.split(',')
const raceKeys = values.race?.split(',')
const { subjects } = await readSubjects()
const chosen = subjects.filter(
  (s) =>
    (only?.includes(s.key) ?? false) ||
    (raceKeys?.includes(s.raceKey) ?? false),
)
const asOf = today()
const races = [...groupByRace(chosen).values()].map((group) =>
  group.map((s) => requestFor(s, ELECTION.id, asOf)),
)
console.log(
  `${chosen.length} people in ${races.length} races, up to ${pack} per request → ${outDir}`,
)

try {
  // Races in parallel lanes; within a race, requests go one at a time.
  const lanes = Math.max(1, Number(values.concurrency))
  const queue = [...races]
  const results = await Promise.all(
    Array.from({ length: lanes }, async () => {
      const total = { requests: 0, checked: 0, failed: [] as string[] }
      for (let race = queue.shift(); race; race = queue.shift()) {
        const r = await checkPacked([race], WRITER, CHECKER, outDir, pack)
        total.requests += r.requests
        total.checked += r.checked
        total.failed.push(...r.failed)
        console.log(
          `${race.map((q) => q.key).join(', ')}: ${r.checked} checked`,
        )
      }
      return total
    }),
  )
  const failed = results.flatMap((r) => r.failed)
  console.log(
    `Done: ${results.reduce((n, r) => n + r.checked, 0)} checked in ${results.reduce((n, r) => n + r.requests, 0)} requests${failed.length ? `; no answer for ${failed.join(', ')}` : ''}.`,
  )
} catch (error) {
  if (!(error instanceof GeminiDailyLimitError)) throw error
  console.log(
    `Stopped: the Gemini API's daily limit was reached after ${geminiRequests.geminiApi} requests in this run. Checks so far are saved; the quota resets at midnight Pacific time. To continue now, run again with VERTEX_PROJECT set (Vertex AI).`,
  )
  process.exitCode = 3
}
