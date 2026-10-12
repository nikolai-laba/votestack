// The staged pipeline as one ProfileGenerator (prompt f006-1), so the
// preview and profiles:generate run it like any single model:
// Steps 1 and 2 are cached per person (DRAFTS), so `profiles:drafts` can
// run them ahead and later runs only pay for the Gemini steps.
//   1. evidence: the research brief's searches (Perplexity Search API);
//   2. write: an open model drafts the overview from that evidence, one
//      search result per sentence (OpenRouter);
//   3. check: Gemini opens every cited page and keeps, corrects, re-sources
//      or removes each sentence (URL context + Google Search);
//   4. endorse: Gemini researches endorsements (Google Search + URL context).
// Steps 3 and 4 run at the same time. Every step's cost and time is kept.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { BUILD, readJson, writeJson } from '../../data.ts'
import { endorsementQueries, researchQueries } from '../briefs.ts'
import type {
  EvidenceDoc,
  GenerationResult,
  ProfileGenerator,
  Usage,
} from '../generator.ts'
import type { ProfileRequest } from '../prompt.ts'
import {
  checkerInstructions,
  campaignPages,
  checkerMessage,
  DRAFT_SCHEMA,
  draftSentences,
  endorsementInstructions,
  endorsementMessage,
  extractJson,
  mergeStages,
  writerInstructions,
  writerMessage,
  type Checked,
  type Draft,
  type Endorsed,
  type PageRef,
} from '../staged.ts'
import { geminiCall, REDIRECT_HOST, redirectTarget } from './gemini.ts'
import { openrouterCall } from './openrouter.ts'
import { searchEvidence } from './perplexity.ts'

export interface StageRun {
  stage: 'evidence' | 'write' | 'check' | 'endorse'
  model: string
  costUsd: number
  ms: number
  usage?: Usage
  /** Reused from the draft cache; its cost was paid in an earlier run. */
  cached?: boolean
}

/** Steps 1 and 2 for one person, as cached between runs. */
export interface DraftStage {
  promptVersion: string
  writer: string
  queries: string[]
  docs: EvidenceDoc[]
  leads: EvidenceDoc[]
  draft: Draft
  errors: string[]
  stages: StageRun[]
  /** True when read from the cache in this run. */
  cached?: boolean
}

/**
 * Version of steps 1 and 2 (searches and the writer's prompt). Bumped only
 * when those change, so a change to the Gemini steps (PROMPT_VERSION)
 * keeps the cached drafts. f006-2 to f006-5 changed only the Gemini steps.
 */
export const DRAFT_VERSION = 'f006-1'

/** Drafts are cached here, so the Gemini steps can run separately. */
export const DRAFTS = join(BUILD, 'profiles', 'drafts')

/**
 * Searches and drafts one profile (steps 1 and 2), or reads the cached
 * result for the same prompt version and writer. A draft that failed to
 * parse isn't cached, so the next run tries again.
 */
export async function draftStage(
  req: ProfileRequest,
  writer: string,
): Promise<DraftStage> {
  const path = join(DRAFTS, `${req.key}.json`)
  if (existsSync(path)) {
    const saved = await readJson<DraftStage>(path)
    if (saved.promptVersion === DRAFT_VERSION && saved.writer === writer)
      return { ...saved, cached: true }
  }
  const result: DraftStage = {
    promptVersion: DRAFT_VERSION,
    writer,
    queries: researchQueries(req),
    docs: [],
    leads: [],
    draft: { paragraphs: [], sources: [] },
    errors: [],
    stages: [],
  }

  let t = Date.now()
  const [evidence, leads] = await Promise.all([
    searchEvidence(result.queries),
    searchEvidence(endorsementQueries(req), { tokensPerPage: 1024 }),
  ])
  result.docs = evidence.docs
  result.leads = leads.docs
  result.stages.push({
    stage: 'evidence',
    model: 'perplexity-search',
    costUsd: evidence.costUsd + leads.costUsd,
    ms: Date.now() - t,
  })

  // The draft is skipped when the search found nothing. DeepSeek now and
  // then answers with an empty draft despite good pages; that's tried once
  // more, and an empty draft with pages isn't cached.
  const empty = (d: Draft) => !d.paragraphs.some((p) => p.sentences.length)
  for (let attempt = 0; result.docs.length && attempt < 2; attempt++) {
    t = Date.now()
    const answer = await openrouterCall(writer, {
      system: writerInstructions(req),
      user: writerMessage(req, result.docs),
      schemaName: 'profile_overview',
      schema: DRAFT_SCHEMA,
    })
    result.stages.push({
      stage: 'write',
      model: answer.servedBy,
      costUsd: answer.costUsd,
      ms: answer.ms,
      usage: answer.usage,
    })
    try {
      result.draft = extractJson<Draft>(answer.text)
    } catch {
      result.errors.push(`write: ${answer.text.slice(0, 2000)}`)
      continue
    }
    if (!empty(result.draft)) break
  }
  if (result.docs.length && empty(result.draft))
    result.errors.push('write: empty draft despite search results')
  if (!result.errors.length) await writeJson(path, result)
  return result
}

/** What a staged run keeps besides the profile, for review. */
export interface StagedTrace {
  queries: string[]
  evidence: { url: string; title: string }[]
  leads?: { url: string; title: string }[]
  draft?: Draft
  review?: Checked['review']
  /** Raw answers that failed to parse, kept to debug. */
  errors: string[]
  stages: StageRun[]
}

/** Replaces Gemini's grounding redirect links with the pages they point to. */
async function resolvePages<T extends { source?: PageRef }>(
  items: T[],
): Promise<T[]> {
  return Promise.all(
    items.map(async (item) => {
      const url = item.source?.url
      if (!url?.includes(REDIRECT_HOST)) return item
      const target = await redirectTarget(url)
      return target
        ? { ...item, source: { ...item.source!, url: target } }
        : item
    }),
  )
}

const sum = (runs: StageRun[], f: (u: Usage) => number | undefined) =>
  runs.reduce((n, r) => n + (r.usage ? (f(r.usage) ?? 0) : 0), 0)

export function stagedGenerator(
  writer: string,
  checker: string,
  id: string,
): ProfileGenerator {
  return {
    id,
    provider: 'staged',
    model: `${writer} + ${checker}`,
    searches: true,
    async generate(req: ProfileRequest): Promise<GenerationResult> {
      const started = Date.now()
      const trace: StagedTrace = {
        queries: researchQueries(req),
        evidence: [],
        errors: [],
        stages: [],
      }

      // 1 and 2: evidence and the draft, from the cache when an earlier
      // run (or profiles:drafts) already made them.
      const drafted = await draftStage(req, writer)
      const { docs, leads, draft } = drafted
      trace.queries = drafted.queries
      trace.evidence = docs.map((d) => ({ url: d.url, title: d.title }))
      trace.leads = leads.map((d) => ({ url: d.url, title: d.title }))
      trace.draft = draft
      trace.errors.push(...drafted.errors)
      trace.stages.push(
        ...(drafted.cached
          ? drafted.stages.map((st) => ({ ...st, costUsd: 0, cached: true }))
          : drafted.stages),
      )

      // 3 and 4 at once: check the draft, research endorsements.
      const sentences = draftSentences(draft, docs)
      const [checked, endorsed] = await Promise.all([
        sentences.some((p) => p.length)
          ? runGemini<Checked>(checker, 'check', trace, {
              system: checkerInstructions(req),
              user: checkerMessage(req, sentences),
              readUrls: true,
            })
          : undefined,
        runGemini<Endorsed>(checker, 'endorse', trace, {
          system: endorsementInstructions(req),
          user: endorsementMessage(req, leads, campaignPages(draft, docs)),
          readUrls: true,
        }),
      ])

      if (checked) {
        checked.paragraphs = await Promise.all(
          (checked.paragraphs ?? []).map(async (p) => ({
            sentences: await resolvePages(p.sentences ?? []),
          })),
        )
        trace.review = checked.review
      }
      if (endorsed)
        endorsed.endorsements = await resolvePages(endorsed.endorsements ?? [])

      const output = mergeStages(checked, endorsed)
      const costUsd = trace.stages.reduce((n, s) => n + s.costUsd, 0)
      return {
        output,
        rawText: JSON.stringify(trace),
        servedBy: `${trace.stages.find((s) => s.stage === 'write')?.model ?? writer} + ${checker}`,
        usage: {
          inputTokens: sum(trace.stages, (u) => u.inputTokens),
          outputTokens: sum(trace.stages, (u) => u.outputTokens),
          cachedInputTokens: sum(trace.stages, (u) => u.cachedInputTokens),
          searches: sum(trace.stages, (u) => u.searches),
        },
        costUsd,
        costReported: false,
        ms: Date.now() - started,
        consulted: docs.map((d: EvidenceDoc) => d.url),
      }
    },
  }
}

/** One Gemini stage; a reply that won't parse is logged, not thrown. */
async function runGemini<T>(
  model: string,
  stage: 'check' | 'endorse',
  trace: StagedTrace,
  prompt: { system: string; user: string; readUrls: boolean },
): Promise<T | undefined> {
  const answer = await geminiCall(model, prompt)
  trace.stages.push({
    stage,
    model: answer.servedBy,
    costUsd: answer.costUsd,
    ms: answer.ms,
    usage: answer.usage,
  })
  try {
    return extractJson<T>(answer.text)
  } catch {
    trace.errors.push(`${stage}: ${answer.text.slice(0, 2000)}`)
    return undefined
  }
}

/**
 * Only the endorsement step, for refreshing a finished profile's
 * endorsements: uses the cached draft's leads and campaign pages
 * (searching and drafting again when there's no cache) and returns the
 * endorsements with their own numbered sources, plus the step's cost.
 */
export async function endorsementsOnly(
  req: ProfileRequest,
  writer: string,
  checker: string,
): Promise<{ output: ReturnType<typeof mergeStages>; costUsd: number }> {
  const drafted = await draftStage(req, writer)
  const trace: StagedTrace = {
    queries: [],
    evidence: [],
    errors: [],
    stages: [],
  }
  const endorsed = await runGemini<Endorsed>(checker, 'endorse', trace, {
    system: endorsementInstructions(req),
    user: endorsementMessage(
      req,
      drafted.leads,
      campaignPages(drafted.draft, drafted.docs),
    ),
    readUrls: true,
  })
  if (endorsed)
    endorsed.endorsements = await resolvePages(endorsed.endorsements ?? [])
  const fresh = drafted.cached
    ? 0
    : drafted.stages.reduce((n, s) => n + s.costUsd, 0)
  return {
    output: mergeStages(undefined, endorsed),
    costUsd: fresh + trace.stages.reduce((n, s) => n + s.costUsd, 0),
  }
}
