// Perplexity: the Agent API (its search built in) as a profile model, and
// the Search API as the evidence step for models without their own search.
// The Agent API replaced Sonar chat completions, which now return 403.

import { isBlockedSite } from '../place.ts'
import {
  apiKey,
  costFromUsage,
  postJson,
  type EvidenceDoc,
  type GenerationResult,
  type ProfileGenerator,
} from '../generator.ts'
import {
  buildInstructions,
  buildUserMessage,
  parseProfileJson,
  PROFILE_OUTPUT_SCHEMA,
  type ProfileRequest,
} from '../prompt.ts'
import { isSocialMedia } from '../checks.ts'

const AGENT_URL = 'https://api.perplexity.ai/v1/agent'
const SEARCH_URL = 'https://api.perplexity.ai/search'

const auth = () => ({
  authorization: `Bearer ${apiKey('PERPLEXITY_API_KEY')}`,
})

interface AgentOutputItem {
  type: string
  results?: { url?: string }[]
  content?: { type: string; text?: string }[]
}

interface AgentResponse {
  model?: string
  output: AgentOutputItem[]
  usage: {
    input_tokens: number
    output_tokens: number
    cost?: { total_cost?: number }
  }
}

/**
 * A Perplexity Agent API preset ("fast", "low", ...). The preset picks the
 * model and search setup; our instruction replaces its system prompt.
 */
export function perplexityGenerator(preset: string): ProfileGenerator {
  const id = `perplexity-${preset}`
  return {
    id,
    provider: 'perplexity',
    model: id,
    searches: true,
    async generate(req: ProfileRequest): Promise<GenerationResult> {
      const started = Date.now()
      const res = await postJson<AgentResponse>(AGENT_URL, auth(), {
        preset,
        instructions: buildInstructions(req),
        input: buildUserMessage(req),
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'candidate_profile',
            schema: PROFILE_OUTPUT_SCHEMA,
          },
        },
      })
      const rawText = res.output
        .filter((o) => o.type === 'message')
        .flatMap((o) => o.content ?? [])
        .filter((c) => c.type === 'output_text')
        .map((c) => c.text ?? '')
        .join('')
      const usage = {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
      }
      const reported = res.usage.cost?.total_cost
      return {
        output: parseProfileJson(rawText),
        rawText,
        servedBy: res.model ?? id,
        usage,
        costUsd: reported ?? costFromUsage(id, usage),
        costReported: reported !== undefined,
        ms: Date.now() - started,
        consulted: res.output
          .filter((o) => o.type === 'search_results')
          .flatMap((o) =>
            (o.results ?? []).flatMap((r) => (r.url ? [r.url] : [])),
          ),
      }
    },
  }
}

interface SearchResult {
  url: string
  title: string
  snippet: string
  date?: string
}

interface SearchResponse {
  /** One list for a single query; one list per query for several. */
  results: SearchResult[] | SearchResult[][]
}

/** The fixed queries used to gather evidence for one candidate. */
export function evidenceQueries(req: ProfileRequest): string[] {
  const base = `"${req.name}" ${req.office} Illinois`
  return req.kind === 'candidate'
    ? [base, `"${req.name}" endorsements 2026`, `"${req.name}" Chicago news`]
    : [
        base,
        `"${req.name}" judge Cook County bar association evaluation 2026`,
        `"${req.name}" judge Chicago news`,
      ]
}

/**
 * Runs the evidence queries through the Search API (one request, several
 * queries) and keeps distinct, non-social-media pages.
 */
export async function gatherEvidence(
  req: ProfileRequest,
  maxResults = 8,
  maxSnippet = 2000,
): Promise<{ docs: EvidenceDoc[]; costUsd: number }> {
  const res = await postJson<SearchResponse>(SEARCH_URL, auth(), {
    query: evidenceQueries(req),
    max_results: maxResults,
    country: 'US',
  })
  const seen = new Set<string>()
  const docs: EvidenceDoc[] = []
  for (const r of res.results.flat()) {
    if (seen.has(r.url) || isSocialMedia(r.url) || isBlockedSite(r.url))
      continue
    seen.add(r.url)
    docs.push({
      url: r.url,
      title: r.title,
      snippet: r.snippet.slice(0, maxSnippet),
      date: r.date,
    })
  }
  return {
    docs,
    costUsd: costFromUsage('perplexity-search', {
      inputTokens: 0,
      outputTokens: 0,
    }),
  }
}

/**
 * Runs any number of searches, 5 to a request (the API's limit), each
 * request returning up to `perRequest` pages with up to `tokensPerPage` of
 * page text, and keeps distinct, non-social-media pages in result order.
 */
export async function searchEvidence(
  queries: string[],
  { perRequest = 20, tokensPerPage = 2048, tokensPerRequest = 30_000 } = {},
): Promise<{ docs: EvidenceDoc[]; costUsd: number }> {
  const batches: string[][] = []
  for (let i = 0; i < queries.length; i += 5)
    batches.push(queries.slice(i, i + 5))
  const responses = await Promise.all(
    batches.map((query) =>
      postJson<SearchResponse>(SEARCH_URL, auth(), {
        query,
        max_results: perRequest,
        max_tokens_per_page: tokensPerPage,
        max_tokens: tokensPerRequest,
        country: 'US',
      }),
    ),
  )
  const seen = new Set<string>()
  const docs: EvidenceDoc[] = []
  for (const r of responses.flatMap((res) => res.results.flat())) {
    if (seen.has(r.url) || isSocialMedia(r.url) || isBlockedSite(r.url))
      continue
    seen.add(r.url)
    docs.push({ url: r.url, title: r.title, snippet: r.snippet, date: r.date })
  }
  return {
    docs,
    costUsd: costFromUsage(
      'perplexity-search',
      { inputTokens: 0, outputTokens: 0 },
      batches.length,
    ),
  }
}
