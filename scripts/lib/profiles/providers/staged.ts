// The staged pipeline as one ProfileGenerator (prompt f006-1), so the
// preview and profiles:generate run it like any single model:
// Steps 1 and 2 are cached per person (DRAFTS), so `profiles:drafts` can
// run them ahead and later runs only pay for the Gemini steps.
//   1. evidence: the research brief's searches (Perplexity Search API);
//   2. write: an open model drafts the overview from that evidence, one
//      search result per sentence (OpenRouter);
//   3. check: Gemini opens every cited page and keeps, corrects, re-sources
//      or removes each sentence (URL context + Google Search);
//   4. endorse: Gemini researches endorsements (Google Search + URL context),
//      or, with `stagedOptions.endorsements = 'files'`, the endorsements are
//      read from research done separately (ENDORSEMENTS, one file per person,
//      in the same shape as Gemini's answer).
// Steps 3 and 4 run at the same time. Every step's cost and time is kept.
// A check is cached per person with a hash of what it checked (CHECKS), so
// a stopped run never pays for the same check twice, and checks made
// several to a request (checkPacked) are used like any other.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJson } from '../../data.ts'
import { PIPELINE_BUILD } from '../content.ts'
import { endorsementQueries, researchQueries } from '../briefs.ts'
import type {
  EvidenceDoc,
  GenerationResult,
  ProfileGenerator,
  Usage,
} from '../generator.ts'
import { PROMPT_VERSION, type ProfileRequest } from '../prompt.ts'
import { IS_COOK } from '../region.ts'
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
  packedCheckerInstructions,
  packedCheckerMessage,
  type DraftSentence,
  writerInstructions,
  writerMessage,
  type Checked,
  type Draft,
  type Endorsed,
  type PageRef,
} from '../staged.ts'
import {
  GeminiDailyLimitError,
  geminiCall,
  REDIRECT_HOST,
  redirectTarget,
} from './gemini.ts'
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
  /** Gemini steps: pages URL context opened and couldn't open. */
  pages?: { opened: number; failed: number }
}

/** Step 1 for one person: the searches, kept even when the draft fails. */
interface SearchCache {
  queries: string[]
  leadQueries: string[]
  docs: DraftStage['docs']
  leads: DraftStage['leads']
  stage: StageRun
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
 * Other areas have their own version (their search filter and writer rules
 * differ from Cook County's).
 */
export const DRAFT_VERSION = IS_COOK ? 'f006-1' : 'f006-1-ca3'

/**
 * Search results are cached apart from drafts, so a draft that fails (the
 * writer's API out of credit, a bad answer) keeps the searches it paid for.
 */
export const SEARCHES = join(PIPELINE_BUILD, 'searches')

/** Drafts are cached here, so the Gemini steps can run separately. */
export const DRAFTS = join(PIPELINE_BUILD, 'drafts')
/** Checks, one file per person (CachedCheck). */
export const CHECKS = join(PIPELINE_BUILD, 'checks')
/** Endorsement research done outside this pipeline, one file per person (EndorsementFile). */
export const ENDORSEMENTS = join(PIPELINE_BUILD, 'endorsements')

/** Run-wide choices, set by the script before generating. */
export const stagedOptions: {
  /** Where endorsements come from: Gemini (step 4) or ENDORSEMENTS files. */
  endorsements: 'gemini' | 'files'
} = { endorsements: 'gemini' }

/** A check's result for one person, with what it checked. */
export interface CachedCheck {
  key: string
  promptVersion: string
  checker: string
  /** Hash of the checked sentences and the checker's instruction. */
  inputHash: string
  /** 'single': one person per request; 'packed': several in one request. */
  mode: 'single' | 'packed'
  /** The date in the checker's prompt, when the pages were opened (older caches lack it). */
  asOf?: string
  checked: Checked
  stage: StageRun
}

/** Endorsements researched separately, in the shape of Gemini's answer. */
export interface EndorsementFile {
  key: string
  /** Who researched them, e.g. "claude-opus-5-5 (Claude Code subagent)". */
  researcher: string
  researchedAt: string
  endorsements: Endorsed['endorsements']
  /**
   * Doubtful entries the researcher set aside for a rule still being decided
   * (`question` names it); not used until a rule takes them in.
   */
  held?: (Endorsed['endorsements'][number] & {
    question: string
    why?: string
  })[]
}

/** What a check depends on: if it changes, the cached check is stale. */
export function checkInputHash(
  req: ProfileRequest,
  sentences: DraftSentence[][],
  checker: string,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        PROMPT_VERSION,
        checker,
        checkerInstructions(req),
        checkerMessage(req, sentences),
      ]),
    )
    .digest('hex')
    .slice(0, 16)
}

/** A cached check for these sentences, from `dir` (CHECKS by default). */
export async function cachedCheck(
  req: ProfileRequest,
  sentences: DraftSentence[][],
  checker: string,
  dir = CHECKS,
): Promise<CachedCheck | undefined> {
  const path = join(dir, `${req.key}.json`)
  if (!existsSync(path)) return undefined
  const saved = await readJson<CachedCheck>(path)
  // The checker's prompt names today's date, so a check from an earlier day
  // has another hash. It still holds while its sources are fresh enough to
  // publish: try each recent date, and return the one it was made on.
  for (const asOf of recentDates(req.asOf, MAX_CHECK_AGE_DAYS))
    if (
      saved.inputHash === checkInputHash({ ...req, asOf }, sentences, checker)
    )
      return { ...saved, asOf }
  return undefined
}

/** How old a cached check may be: the age limit for profile sources. */
const MAX_CHECK_AGE_DAYS = 30

/** `asOf` and the days before it, newest first. */
function recentDates(asOf: string, days: number): string[] {
  const start = Date.parse(`${asOf}T12:00:00Z`)
  return Array.from({ length: days + 1 }, (_, i) =>
    new Date(start - i * 86_400_000).toISOString().slice(0, 10),
  )
}

/** The endorsement research file for a person; throws when it's missing. */
export async function endorsementFile(key: string): Promise<EndorsementFile> {
  const path = join(ENDORSEMENTS, `${key}.json`)
  if (!existsSync(path))
    throw new Error(
      `No endorsement research for ${key}: expected ${path} (stagedOptions.endorsements = 'files')`,
    )
  return readJson<EndorsementFile>(path)
}

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
  const leadQueries = endorsementQueries(req)
  const searchPath = join(SEARCHES, `${req.key}.json`)
  const searched = existsSync(searchPath)
    ? await readJson<SearchCache>(searchPath)
    : undefined
  if (
    searched &&
    JSON.stringify([searched.queries, searched.leadQueries]) ===
      JSON.stringify([result.queries, leadQueries])
  ) {
    result.docs = searched.docs
    result.leads = searched.leads
    result.stages.push({ ...searched.stage, costUsd: 0, cached: true })
  } else {
    const [evidence, leads] = await Promise.all([
      searchEvidence(result.queries),
      searchEvidence(leadQueries, { tokensPerPage: 1024 }),
    ])
    result.docs = evidence.docs
    result.leads = leads.docs
    const stage: StageRun = {
      stage: 'evidence',
      model: 'perplexity-search',
      costUsd: evidence.costUsd + leads.costUsd,
      ms: Date.now() - t,
    }
    result.stages.push(stage)
    await writeJson(searchPath, {
      queries: result.queries,
      leadQueries,
      docs: result.docs,
      leads: result.leads,
      stage,
    } satisfies SearchCache)
  }

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

      // 3 and 4 at once: check the draft, research endorsements. With
      // endorsement files, the file is read first, so a missing one stops
      // before any Gemini request.
      const sentences = draftSentences(draft, docs)
      const fromFile =
        stagedOptions.endorsements === 'files'
          ? await endorsementFile(req.key)
          : undefined
      const check = async (): Promise<Checked | undefined> => {
        if (!sentences.some((p) => p.length)) return undefined
        const cached = await cachedCheck(req, sentences, checker)
        if (cached) {
          // The profile is dated when its pages were read, not today.
          req.asOf = cached.asOf ?? req.asOf
          trace.stages.push({ ...cached.stage, costUsd: 0, cached: true })
          return cached.checked
        }
        const before = trace.stages.length
        const result = await runCheck(req, sentences, checker, trace)
        if (result) {
          result.paragraphs = await Promise.all(
            (result.paragraphs ?? []).map(async (p) => ({
              sentences: await resolvePages(p.sentences ?? []),
            })),
          )
          const saved: CachedCheck = {
            key: req.key,
            promptVersion: PROMPT_VERSION,
            checker,
            inputHash: checkInputHash(req, sentences, checker),
            mode: 'single',
            asOf: req.asOf,
            checked: result,
            stage: trace.stages.at(-1) ?? trace.stages[before],
          }
          await writeJson(join(CHECKS, `${req.key}.json`), saved)
        }
        return result
      }
      const [checked, endorsed] = await Promise.all([
        check(),
        fromFile
          ? (() => {
              trace.stages.push({
                stage: 'endorse',
                model: fromFile.researcher,
                costUsd: 0,
                ms: 0,
              })
              return { endorsements: fromFile.endorsements } as Endorsed
            })()
          : runGemini<Endorsed>(checker, 'endorse', trace, {
              system: endorsementInstructions(req),
              user: endorsementMessage(req, leads, campaignPages(draft, docs)),
              readUrls: true,
            }),
      ])

      if (checked) trace.review = checked.review
      if (endorsed && !fromFile)
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

/**
 * One check request for one person. Outside Cook County the checker must
 * open the cited pages; an answer that opened none is asked for once more,
 * and the second answer is used. Every request stays in the trace.
 */
async function runCheck(
  req: ProfileRequest,
  sentences: DraftSentence[][],
  checker: string,
  trace: StagedTrace,
): Promise<Checked | undefined> {
  let result: Checked | undefined
  try {
    result = await runGemini<Checked>(checker, 'check', trace, {
      system: checkerInstructions(req),
      user: checkerMessage(req, sentences),
      readUrls: true,
    })
  } catch (error) {
    // URL context rejects some pages outright ("invalid argument" for the
    // whole request). Check from the excerpts instead; the profile then shows
    // that no page was opened, for a reviewer.
    if (IS_COOK || !urlContextRefused(error)) throw error
    trace.errors.push(
      `check: URL context refused the request; checked from excerpts`,
    )
    return runGemini<Checked>(checker, 'check', trace, {
      system: checkerInstructions(req),
      user: checkerMessage(req, sentences),
      readUrls: false,
    })
  }
  if (IS_COOK || trace.stages.at(-1)?.pages?.opened !== 0) return result
  try {
    const retry = await runGemini<Checked>(checker, 'check', trace, {
      system: checkerInstructions(req),
      user: `${checkerMessage(req, sentences)}\n\nOpen every cited URL with URL context before you answer. An answer from the excerpts alone isn't accepted.`,
      readUrls: true,
    })
    return retry ?? result
  } catch (error) {
    // The retry can be refused the same way; the first answer stands.
    if (!urlContextRefused(error)) throw error
    trace.errors.push('check: URL context refused the retry; first answer kept')
    return result
  }
}

/**
 * URL context refused the whole request (a 400 "invalid argument"; the
 * Gemini API names it INVALID_ARGUMENT, Vertex AI says it in words).
 */
const urlContextRefused = (error: unknown) =>
  /\b400\b.*(INVALID_ARGUMENT|invalid argument)/is.test(String(error))

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
    pages: answer.pages,
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

/** The most pages Gemini's URL context opens in one request. */
export const MAX_URLS = 20

/**
 * Groups items, in order, into packs of at most `maxPerPack` whose cited
 * pages together number at most `maxUrls`. An item over the limit on its own
 * gets a pack of its own.
 */
export function packByUrls<T extends { urls: Set<string> }>(
  items: T[],
  maxPerPack: number,
  maxUrls = MAX_URLS,
): T[][] {
  const packs: T[][] = []
  for (const item of items) {
    const last = packs.at(-1)
    const urls = new Set([
      ...(last ?? []).flatMap((x) => [...x.urls]),
      ...item.urls,
    ])
    if (last && last.length < maxPerPack && urls.size <= maxUrls)
      last.push(item)
    else packs.push([item])
  }
  return packs
}

/**
 * Checks several people's drafts with one Gemini request per pack: people
 * in the same race, at most `maxPerPack` per request and at most 20 cited
 * pages in all (URL context's limit). Drafts come from the draft cache
 * (searching and drafting first when missing). Each person's result is
 * written to `outDir` as a CachedCheck, with the request's cost split
 * evenly; people already checked there for the same draft are skipped.
 * Returns how many requests were sent.
 */
export async function checkPacked(
  races: ProfileRequest[][],
  writer: string,
  checker: string,
  outDir: string,
  maxPerPack = 3,
): Promise<{ requests: number; checked: number; failed: string[] }> {
  let requests = 0
  let checkedCount = 0
  const failed: string[] = []
  for (const race of races) {
    const items: {
      req: ProfileRequest
      sentences: DraftSentence[][]
      urls: Set<string>
    }[] = []
    for (const req of race) {
      const drafted = await draftStage(req, writer)
      const sentences = draftSentences(drafted.draft, drafted.docs)
      if (!sentences.some((p) => p.length)) continue
      if (await cachedCheck(req, sentences, checker, outDir)) continue
      const urls = new Set(
        sentences.flat().flatMap((x) => (x.source ? [x.source.url] : [])),
      )
      items.push({ req, sentences, urls })
    }
    const packs = packByUrls(items, maxPerPack)
    for (const pack of packs) {
      const trace: StagedTrace = {
        queries: [],
        evidence: [],
        errors: [],
        stages: [],
      }
      if (pack.length === 1) {
        const [item] = pack
        let result: Checked | undefined
        try {
          result = await runCheck(item.req, item.sentences, checker, trace)
        } catch (error) {
          // The daily limit stops the run; any other error fails only this person.
          if (error instanceof GeminiDailyLimitError) throw error
          requests += trace.stages.length + 1
          failed.push(
            `${item.req.key} (${error instanceof Error ? error.message.slice(0, 120) : String(error)})`,
          )
          continue
        }
        requests += trace.stages.length
        if (!result) {
          failed.push(item.req.key)
          continue
        }
        const saved: CachedCheck = {
          key: item.req.key,
          promptVersion: PROMPT_VERSION,
          checker,
          inputHash: checkInputHash(item.req, item.sentences, checker),
          mode: 'single',
          asOf: item.req.asOf,
          checked: {
            paragraphs: await Promise.all(
              (result.paragraphs ?? []).map(async (p) => ({
                sentences: await resolvePages(p.sentences ?? []),
              })),
            ),
            review: result.review ?? [],
          },
          stage: {
            ...trace.stages.at(-1)!,
            costUsd: trace.stages.reduce((n, st) => n + st.costUsd, 0),
          },
        }
        await writeJson(join(outDir, `${item.req.key}.json`), saved)
        checkedCount++
        continue
      }
      requests++
      const answer = await runGemini<{
        candidates: (Checked & { candidate: number })[]
      }>(checker, 'check', trace, {
        system:
          pack.length === 1
            ? checkerInstructions(pack[0].req)
            : packedCheckerInstructions(pack[0].req, pack.length),
        user:
          pack.length === 1
            ? checkerMessage(pack[0].req, pack[0].sentences)
            : packedCheckerMessage(pack),
        readUrls: true,
      })
      const stage = trace.stages[0]
      const results =
        pack.length === 1 && answer
          ? [{ ...(answer as unknown as Checked), candidate: 1 }]
          : (answer?.candidates ?? [])
      for (const [i, item] of pack.entries()) {
        const result = results.find((r) => r.candidate === i + 1)
        if (!result) {
          failed.push(item.req.key)
          continue
        }
        const checked: Checked = {
          paragraphs: await Promise.all(
            (result.paragraphs ?? []).map(async (p) => ({
              sentences: await resolvePages(p.sentences ?? []),
            })),
          ),
          review: result.review ?? [],
        }
        const saved: CachedCheck = {
          key: item.req.key,
          promptVersion: PROMPT_VERSION,
          checker,
          inputHash: checkInputHash(item.req, item.sentences, checker),
          mode: pack.length === 1 ? 'single' : 'packed',
          asOf: item.req.asOf,
          checked,
          stage: { ...stage, costUsd: stage.costUsd / pack.length },
        }
        await writeJson(join(outDir, `${item.req.key}.json`), saved)
        checkedCount++
      }
    }
  }
  return { requests, checked: checkedCount, failed }
}
