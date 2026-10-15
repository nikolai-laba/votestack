// The interface every profile model sits behind, so the pipeline can
// swap providers without touching the rest. Providers call each
// vendor's REST API with plain fetch; keys come from the environment only.

import type { ProfileOutput, ProfileRequest } from './prompt.ts'

/** A page found by a search step, passed to models without their own search. */
export interface EvidenceDoc {
  url: string
  title: string
  snippet: string
  date?: string
}

export interface Usage {
  inputTokens: number
  outputTokens: number
  /** Input tokens served from a cache, billed at a lower rate. */
  cachedInputTokens?: number
  /** Web searches the provider ran and bills for. */
  searches?: number
}

export interface GenerationResult {
  output: ProfileOutput
  /** The model's text answer, kept for review. */
  rawText: string
  /** The model that served the request, as the provider reports it. */
  servedBy: string
  usage: Usage
  costUsd: number
  /** True when the cost came from the provider's own usage field. */
  costReported: boolean
  ms: number
  /** URLs the provider says it searched or read (for comparing with cites). */
  consulted: string[]
}

export interface ProfileGenerator {
  /** Stable id used for output folders, e.g. "claude-opus-5-5". */
  id: string
  provider: string
  model: string
  /** True when the model searches the web itself. */
  searches: boolean
  generate(
    req: ProfileRequest,
    evidence?: EvidenceDoc[],
  ): Promise<GenerationResult>
}

/** List prices in USD (per 1M tokens, per 1,000 searches or requests). */
export interface Price {
  input: number
  output: number
  cachedInput?: number
  perThousandSearches?: number
  perThousandRequests?: number
}

/**
 * Published list prices, checked 2026-10-06 on each provider's pricing page.
 * Used for estimates and when a response doesn't report its own cost.
 */
export const PRICES: Record<string, Price> = {
  'claude-opus-5-5': {
    input: 4,
    output: 20,
    cachedInput: 0.2,
    perThousandSearches: 10,
  },
  'claude-sonnet-5-5': {
    input: 2,
    output: 10,
    cachedInput: 0.2,
    perThousandSearches: 10,
  },
  'gpt-6-astra': {
    input: 10,
    output: 50,
    cachedInput: 1,
    perThousandSearches: 10,
  },
  'gpt-6.1-sol': {
    input: 2,
    output: 10,
    cachedInput: 0.1,
    perThousandSearches: 10,
  },
  // Grounding: 5,000 free searches a month across Gemini 3, then $14 per
  // 1,000. Priced here at the paid rate so estimates stay conservative.
  'gemini-3.1-pro-preview': { input: 2, output: 12, perThousandSearches: 14 },
  'gemini-3.8-flash': { input: 0.75, output: 3.75, perThousandSearches: 14 },
  // Agent API "low" preset (GPT-6 Luna, fast web search). Responses report
  // their own cost; this is only the fallback.
  'perplexity-low': { input: 0.1, output: 0.5, perThousandSearches: 2.5 },
  'moonshotai/kimi-k3': { input: 0.99, output: 15 },
  'deepseek/deepseek-v4-pro': { input: 0.2088, output: 0.4176 },
  // Perplexity Search API, used to gather evidence for the open models.
  'perplexity-search': { input: 0, output: 0, perThousandRequests: 5 },
}

export function costFromUsage(model: string, usage: Usage, requests = 1) {
  const p = PRICES[model]
  if (!p) throw new Error(`No price for ${model}`)
  const cached = usage.cachedInputTokens ?? 0
  return (
    ((usage.inputTokens - cached) * p.input +
      cached * (p.cachedInput ?? p.input) +
      usage.outputTokens * p.output) /
      1e6 +
    ((usage.searches ?? 0) * (p.perThousandSearches ?? 0)) / 1000 +
    (requests * (p.perThousandRequests ?? 0)) / 1000
  )
}

/** Reads an API key, refusing the placeholders from .env.example. */
export function apiKey(name: string): string {
  const value = process.env[name]
  if (!value || value.startsWith('your_') || value.startsWith('your-')) {
    throw new Error(`Set ${name} in .env (run with node --env-file=.env)`)
  }
  return value
}

/**
 * POSTs JSON and returns the parsed body, with the status on failure. Rate
 * limits, overloads, server errors, network errors and timeouts (5 minutes
 * by default) are retried up to 4 times, waiting longer each time (30 s,
 * 1, 2 and 4 minutes by default).
 */
export async function postJson<T>(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs = 300_000,
  retryAfterMs = 30_000,
  retries = 4,
  /** An error to throw at once, without retrying, for responses that won't recover (a daily quota). */
  fatal?: (status: number, body: string) => Error | undefined,
): Promise<T> {
  const host = new URL(url).host
  for (let attempt = 0; ; attempt++) {
    const wait = () =>
      new Promise((resolve) => setTimeout(resolve, retryAfterMs * 2 ** attempt))
    let res: Response
    let text: string
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
      text = await res.text()
    } catch (error) {
      // Network errors and timeouts: the service may be overloaded.
      if (attempt < retries) {
        await wait()
        continue
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`${host}: ${message}`)
    }
    if (res.ok) return JSON.parse(text) as T
    const stop = fatal?.(res.status, text)
    if (stop) throw stop
    if (attempt < retries && [429, 500, 502, 503, 504].includes(res.status)) {
      await wait()
      continue
    }
    // Error bodies never contain the key; keep them short in logs.
    throw new Error(`${res.status} from ${host}: ${text.slice(0, 500)}`)
  }
}

/** Numbered evidence block for models that get search results passed in. */
export function formatEvidence(evidence: EvidenceDoc[]): string {
  return evidence
    .map(
      (d, i) =>
        `[${i + 1}] ${d.title}\nURL: ${d.url}${d.date ? `\nDate: ${d.date}` : ''}\n${d.snippet}`,
    )
    .join('\n\n')
}
