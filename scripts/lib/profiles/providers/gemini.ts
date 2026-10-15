import { existsSync } from 'node:fs'
// Gemini through generateContent with Grounding with Google Search. Gemini
// cites the vertexaisearch.cloud.google.com redirect links its search gave
// it, so each one is resolved to the page it points to before the checks.

import {
  apiKey,
  costFromUsage,
  postJson,
  type GenerationResult,
  type ProfileGenerator,
  type Usage,
} from '../generator.ts'
import {
  type ProfileOutput,
  buildInstructions,
  buildUserMessage,
  parseProfileJson,
  type ProfileRequest,
} from '../prompt.ts'

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * The Gemini API's daily request quota for the model is used up. Retrying
 * won't help until it resets (midnight Pacific time), so a run stops cleanly
 * instead; finished work is kept and the next run picks up where it stopped.
 */
export class GeminiDailyLimitError extends Error {
  constructor(detail: string) {
    super(`Gemini API daily limit reached: ${detail.slice(0, 300)}`)
    this.name = 'GeminiDailyLimitError'
  }
}

/**
 * With GEMINI_API_FIRST and VERTEX_PROJECT both set, calls go to the Gemini
 * API until it answers that the key is out of credit or quota; from then on
 * this run uses Vertex AI, retrying the request that failed.
 */
const apiFirst = () =>
  Boolean(process.env.GEMINI_API_FIRST && process.env.VERTEX_PROJECT)
let movedToVertex = false
const onVertex = () =>
  Boolean(process.env.VERTEX_PROJECT) && (!apiFirst() || movedToVertex)

class GeminiCreditError extends Error {}

/**
 * The Gemini API is out of credit or quota: a 429 that isn't a per-minute
 * rate limit (those pass), or a billing or credit refusal.
 */
export function outOfCredit(status: number, body: string): Error | undefined {
  if (status === 429 && !/per ?minute/i.test(body))
    return new GeminiCreditError(body)
  if (
    (status === 402 || status === 403) &&
    /billing|credit|quota|prepa/i.test(body)
  )
    return new GeminiCreditError(body)
  return undefined
}

/** A 429 whose quota is a per-day one (the error names a "PerDay" quota). */
export function dailyLimit(status: number, body: string): Error | undefined {
  if (status !== 429 || !/per ?day/i.test(body)) return undefined
  return new GeminiDailyLimitError(body)
}

/** Gemini requests sent by this process, by where they went. */
export const geminiRequests = { geminiApi: 0, vertex: 0 }

/**
 * Where Gemini calls go. With VERTEX_PROJECT set they go to Vertex AI in
 * that Google Cloud project (higher quotas than the Gemini API's daily
 * cap), signed in with the gcloud CLI's application default credentials;
 * otherwise to the Gemini API with GEMINI_API_KEY.
 */
async function endpoint(
  model: string,
): Promise<{ url: string; headers: Record<string, string> }> {
  const project = process.env.VERTEX_PROJECT
  if (!project || !onVertex()) {
    return {
      url: `${BASE}/${model}:generateContent`,
      headers: { 'x-goog-api-key': apiKey('GEMINI_API_KEY') },
    }
  }
  // Gemini 3 preview models are served only from the global endpoint.
  const location = process.env.VERTEX_LOCATION ?? 'global'
  const host =
    location === 'global'
      ? 'aiplatform.googleapis.com'
      : `${location}-aiplatform.googleapis.com`
  return {
    url: `https://${host}/v1beta1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`,
    headers: { authorization: `Bearer ${await vertexToken()}` },
  }
}

let token: { value: string; until: number } | undefined

/** gcloud from PATH, or Homebrew's install when PATH doesn't have it (nohup runs). */
function gcloudPath(): string {
  if (process.env.GCLOUD_PATH) return process.env.GCLOUD_PATH
  for (const dir of (process.env.PATH ?? '').split(':'))
    if (dir && existsSync(`${dir}/gcloud`)) return `${dir}/gcloud`
  for (const p of [
    '/opt/homebrew/share/google-cloud-sdk/bin/gcloud',
    '/usr/local/share/google-cloud-sdk/bin/gcloud',
  ])
    if (existsSync(p)) return p
  return 'gcloud'
}

/**
 * An access token from `gcloud auth application-default print-access-token`
 * (the user signs in once with `gcloud auth application-default login`).
 * Tokens last an hour; this one is reused for 45 minutes. Never logged.
 */
async function vertexToken(): Promise<string> {
  if (token && Date.now() < token.until) return token.value
  const { execFile } = await import('node:child_process')
  const value = await new Promise<string>((resolve, reject) =>
    execFile(
      gcloudPath(),
      ['auth', 'application-default', 'print-access-token'],
      (error, stdout) =>
        error
          ? reject(
              new Error(
                'No gcloud credentials: run `gcloud auth application-default login`',
              ),
            )
          : resolve(stdout.trim()),
    ),
  )
  token = { value, until: Date.now() + 45 * 60_000 }
  return value
}

interface GenerateResponse {
  modelVersion?: string
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] }
    finishReason?: string
    groundingMetadata?: {
      webSearchQueries?: string[]
      groundingChunks?: { web?: { uri?: string; title?: string } }[]
    }
    urlContextMetadata?: {
      urlMetadata?: { retrievedUrl?: string; urlRetrievalStatus?: string }[]
    }
  }[]
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    thoughtsTokenCount?: number
    toolUsePromptTokenCount?: number
    cachedContentTokenCount?: number
  }
}

/** One Gemini call: its text answer, usage, cost and the pages it used. */
export interface GeminiAnswer {
  text: string
  servedBy: string
  usage: Usage
  costUsd: number
  ms: number
  /** Grounding links, then pages read through URL context. */
  consulted: string[]
  /** URL context results: how many pages it opened, and how many it couldn't. */
  pages: { opened: number; failed: number }
}

/**
 * Calls generateContent with Google Search grounding, and URL context when
 * `readUrls` is set (the model then opens pages named in the prompt).
 */
export async function geminiCall(
  model: string,
  prompt: { system: string; user: string; readUrls?: boolean },
): Promise<GeminiAnswer> {
  const started = Date.now()
  const call = async () => {
    const { url, headers } = await endpoint(model)
    const vertex = onVertex()
    if (vertex) geminiRequests.vertex++
    else geminiRequests.geminiApi++
    return postJson<GenerateResponse>(
      url,
      headers,
      {
        systemInstruction: { parts: [{ text: prompt.system }] },
        contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
        tools: [
          ...(prompt.readUrls ? [{ url_context: {} }] : []),
          { google_search: {} },
        ],
      },
      undefined,
      undefined,
      undefined,
      // Vertex has no daily request cap; the Gemini API does.
      vertex ? undefined : apiFirst() ? outOfCredit : dailyLimit,
    )
  }
  let res: GenerateResponse
  try {
    res = await call()
  } catch (error) {
    if (!(error instanceof GeminiCreditError)) throw error
    if (!movedToVertex) {
      movedToVertex = true
      console.log(
        `Gemini API out of credit or quota (${error.message.slice(0, 200)}); using Vertex AI for the rest of this run.`,
      )
    }
    res = await call()
  }
  const candidate = res.candidates?.[0]
  const text = (candidate?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('')
  const meta = res.usageMetadata ?? {}
  const grounding = candidate?.groundingMetadata
  const usage: Usage = {
    inputTokens:
      (meta.promptTokenCount ?? 0) + (meta.toolUsePromptTokenCount ?? 0),
    // Thinking tokens are billed as output.
    outputTokens:
      (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0),
    cachedInputTokens: meta.cachedContentTokenCount ?? 0,
    // Gemini 3 bills each distinct, non-empty search query.
    searches: new Set(
      (grounding?.webSearchQueries ?? []).filter((q) => q.trim()),
    ).size,
  }
  const consulted = [
    ...(grounding?.groundingChunks ?? []).flatMap((c) =>
      c.web?.uri ? [c.web.uri] : [],
    ),
    ...(candidate?.urlContextMetadata?.urlMetadata ?? []).flatMap((u) =>
      u.retrievedUrl ? [u.retrievedUrl] : [],
    ),
  ]
  const statuses = (candidate?.urlContextMetadata?.urlMetadata ?? []).map(
    (u) => u.urlRetrievalStatus ?? '',
  )
  const opened = statuses.filter((s) => /SUCCESS/.test(s)).length
  return {
    text,
    servedBy: res.modelVersion ?? model,
    usage,
    costUsd: costFromUsage(model, usage),
    ms: Date.now() - started,
    consulted,
    pages: { opened, failed: statuses.length - opened },
  }
}

export function geminiGenerator(model: string): ProfileGenerator {
  return {
    id: model,
    provider: 'google',
    model,
    searches: true,
    async generate(req: ProfileRequest): Promise<GenerationResult> {
      const answer = await geminiCall(model, {
        system: buildInstructions(req),
        user: buildUserMessage(req),
      })
      return {
        output: await resolveRedirects(parseProfileJson(answer.text)),
        rawText: answer.text,
        servedBy: answer.servedBy,
        usage: answer.usage,
        costUsd: answer.costUsd,
        costReported: false,
        ms: answer.ms,
        consulted: answer.consulted,
      }
    },
  }
}

export const REDIRECT_HOST = 'vertexaisearch.cloud.google.com'

/** Where a grounding redirect points, or undefined if it doesn't resolve. */
export async function redirectTarget(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    })
    return res.headers.get('location') ?? undefined
  } catch {
    return undefined
  }
}

/**
 * Replaces grounding redirect links with the pages they point to. Links that
 * don't resolve stay as they are, so the source check still flags them.
 */
export async function resolveRedirects(
  output: ProfileOutput,
): Promise<ProfileOutput> {
  const sources = await Promise.all(
    output.sources.map(async (s) => {
      if (!s.url.includes(REDIRECT_HOST)) return s
      const target = await redirectTarget(s.url)
      return target ? { ...s, url: target } : s
    }),
  )
  return { ...output, sources }
}
