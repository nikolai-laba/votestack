// Runs the first two steps of the staged profile pipeline (searches and the
// DeepSeek draft) for everyone who still needs research, and caches them in
// data/build/profiles/drafts/. A later `profiles:generate --model
// deepseek-gemini` reuses the cache and only pays for the Gemini steps, so
// the cheap steps can run while Gemini is busy. About $0.02 a person.
//
// Run: node --env-file=.env scripts/profiles/drafts.ts [--concurrency 8] [--only a,b] [--refresh]

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { ELECTION, REGION_OPTION } from '../lib/profiles/region.ts'
import { needsResearch, requestFor } from '../lib/profiles/assemble.ts'
import {
  PROFILES_DIR,
  readProfiles,
  readSubjects,
  today,
} from '../lib/profiles/content.ts'
import { apiKey } from '../lib/profiles/generator.ts'
import { modelById } from '../lib/profiles/models.ts'
import {
  DRAFT_VERSION,
  DRAFTS,
  draftStage,
} from '../lib/profiles/providers/staged.ts'

const MODEL = 'deepseek-gemini'
const WRITER = 'deepseek/deepseek-v4-pro'

const { values } = parseArgs({
  options: {
    ...REGION_OPTION,
    concurrency: { type: 'string', default: '8' },
    only: { type: 'string' },
    // Draft again even when a profile exists (its research is being redone).
    refresh: { type: 'boolean', default: false },
  },
})
apiKey('PERPLEXITY_API_KEY')
apiKey('OPENROUTER_API_KEY')

/** A cached draft made with the current searches and writer prompt. */
function hasCurrentDraft(key: string): boolean {
  const path = join(DRAFTS, `${key}.json`)
  if (!existsSync(path)) return false
  return JSON.parse(readFileSync(path, 'utf8')).promptVersion === DRAFT_VERSION
}

const { subjects: all } = await readSubjects()
const existing = await readProfiles(PROFILES_DIR)
const modelId = modelById(MODEL).id
const only = values.only?.split(',')
const todo = all.filter(
  (s) =>
    (!only || only.includes(s.key)) &&
    (values.refresh || needsResearch(existing.get(s.key), s, modelId)) &&
    !hasCurrentDraft(s.key),
)
console.log(
  `${todo.length} people to draft (~$${(todo.length * 0.02).toFixed(2)})`,
)

const asOf = today()
let spent = 0
let done = 0
let failed = 0
const queue = [...todo]
await Promise.all(
  Array.from({ length: Math.max(1, Number(values.concurrency)) }, async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      try {
        const r = await draftStage(requestFor(s, ELECTION.id, asOf), WRITER)
        spent += r.stages.reduce((n, st) => n + st.costUsd, 0)
        done++
        const sentences = r.draft.paragraphs.reduce(
          (n, p) => n + p.sentences.length,
          0,
        )
        console.log(
          `${s.key}: ${r.docs.length} pages, ${sentences} sentences${r.errors.length ? ', draft unreadable (will retry)' : ''}`,
        )
      } catch (error) {
        failed++
        const message = error instanceof Error ? error.message : String(error)
        console.log(`${s.key}: failed: ${message.slice(0, 300)}`)
        // Out of credit (HTTP 402): every later request would fail too.
        if (/\b402\b/.test(message) && queue.length) {
          console.log(
            `Stopping: a provider is out of credit. ${queue.length} people not started; add credit and run again (searches already made are reused).`,
          )
          queue.length = 0
        }
      }
    }
  }),
)
console.log(
  `Done: ${done} drafted, ${failed} failed, ~$${spent.toFixed(2)} spent.`,
)
