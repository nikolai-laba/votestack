// Writes one research task per person for endorsement research done outside
// the staged pipeline (for example by Claude Code subagents): the same
// instruction and message Gemini's endorsement step gets (staged.ts), the
// person's search leads and campaign pages from the draft cache, and where
// to write the answer (providers/staged.ts ENDORSEMENTS, as an
// EndorsementFile). profiles:generate --endorsements files then reads the
// answers instead of asking Gemini.
//
// Run: node --env-file=.env scripts/profiles/endorsement-tasks.ts --region=ca-la --only a,b
// A person without a cached draft is searched and drafted first (paid:
// Perplexity and OpenRouter).

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { readJson, writeJson } from '../lib/data.ts'
import { requestFor } from '../lib/profiles/assemble.ts'
import { PIPELINE_BUILD, readSubjects, today } from '../lib/profiles/content.ts'
import {
  DRAFT_VERSION,
  DRAFTS,
  draftStage,
  ENDORSEMENTS,
} from '../lib/profiles/providers/staged.ts'
import { ELECTION, REGION_OPTION } from '../lib/profiles/region.ts'
import {
  campaignPages,
  endorsementInstructions,
  endorsementMessage,
} from '../lib/profiles/staged.ts'

const WRITER = 'deepseek/deepseek-v4-pro'
/** Task files, one per person. */
export const TASKS = join(PIPELINE_BUILD, 'endorsement-tasks')

const { values } = parseArgs({
  options: { ...REGION_OPTION, only: { type: 'string' } },
})
if (!values.only) throw new Error('Choose people with --only a,b')
const only = values.only.split(',')
const { subjects } = await readSubjects()
const asOf = today()
const skipped: string[] = []
let written = 0
for (const s of subjects.filter((x) => only.includes(x.key))) {
  // Only people with a current cached draft: the leads come from its
  // searches, and drafting here would spend on search without a check.
  const path = join(DRAFTS, `${s.key}.json`)
  if (
    !existsSync(path) ||
    (await readJson<{ promptVersion: string }>(path)).promptVersion !==
      DRAFT_VERSION
  ) {
    skipped.push(s.key)
    continue
  }
  const req = requestFor(s, ELECTION.id, asOf)
  const drafted = await draftStage(req, WRITER)
  await writeJson(join(TASKS, `${s.key}.json`), {
    key: s.key,
    name: s.name,
    office: s.office,
    raceKey: s.raceKey,
    instructions: endorsementInstructions(req),
    message: endorsementMessage(
      req,
      drafted.leads,
      campaignPages(drafted.draft, drafted.docs),
    ),
    answerPath: join(ENDORSEMENTS, `${s.key}.json`),
  })
  written++
}
console.log(
  `Wrote ${written} tasks to ${TASKS}${skipped.length ? `; no current draft (run profiles:drafts) for ${skipped.join(', ')}` : ''}`,
)
