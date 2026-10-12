// Open-weight models (Kimi, DeepSeek) through OpenRouter's chat completions.
// They don't search the web here, so every model gets the same evidence: the
// pages from one search step, numbered, and may cite only those URLs.

import {
  apiKey,
  costFromUsage,
  formatEvidence,
  postJson,
  type EvidenceDoc,
  type GenerationResult,
  type ProfileGenerator,
  type Usage,
} from '../generator.ts'
import {
  buildInstructions,
  buildUserMessage,
  parseProfileJson,
  PROFILE_OUTPUT_SCHEMA,
  type ProfileRequest,
} from '../prompt.ts'

const URL = 'https://openrouter.ai/api/v1/chat/completions'

interface ChatResponse {
  model: string
  choices: { message: { content: string | null } }[]
  usage: {
    prompt_tokens: number
    completion_tokens: number
    prompt_tokens_details?: { cached_tokens?: number }
    /** Credits charged, in USD. */
    cost?: number
  }
}

const EVIDENCE_NOTE = `You can't search the web for this task. Use only the search results below. Cite a result by putting its URL in "sources"; never cite a page that isn't listed. If the results don't cover something, leave it out.`

/** One chat completion through OpenRouter with a strict JSON schema. */
export async function openrouterCall(
  model: string,
  prompt: {
    system: string
    user: string
    schemaName: string
    schema: unknown
  },
): Promise<{
  text: string
  servedBy: string
  usage: Usage
  costUsd: number
  costReported: boolean
  ms: number
}> {
  const started = Date.now()
  const res = await postJson<ChatResponse>(
    URL,
    {
      authorization: `Bearer ${apiKey('OPENROUTER_API_KEY')}`,
      'x-title': 'VoteStack profiles',
    },
    {
      model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: prompt.schemaName,
          strict: true,
          schema: prompt.schema,
        },
      },
      // Only route to providers that honor the schema.
      provider: { require_parameters: true },
      max_tokens: 16000,
    },
  )
  const usage: Usage = {
    inputTokens: res.usage.prompt_tokens,
    outputTokens: res.usage.completion_tokens,
    cachedInputTokens: res.usage.prompt_tokens_details?.cached_tokens ?? 0,
  }
  return {
    text: res.choices[0]?.message.content ?? '',
    servedBy: res.model,
    usage,
    costUsd: res.usage.cost ?? costFromUsage(model, usage),
    costReported: res.usage.cost !== undefined,
    ms: Date.now() - started,
  }
}

export function openrouterGenerator(model: string): ProfileGenerator {
  return {
    id: `openrouter-${model.split('/')[1]}`,
    provider: 'openrouter',
    model,
    searches: false,
    async generate(
      req: ProfileRequest,
      evidence: EvidenceDoc[] = [],
    ): Promise<GenerationResult> {
      const answer = await openrouterCall(model, {
        system: `${buildInstructions(req)}\n\n${EVIDENCE_NOTE}`,
        user: `${buildUserMessage(req)}\n\nSearch results:\n\n${formatEvidence(evidence)}`,
        schemaName: 'candidate_profile',
        schema: PROFILE_OUTPUT_SCHEMA,
      })
      return {
        output: parseProfileJson(answer.text),
        rawText: answer.text,
        servedBy: answer.servedBy,
        usage: answer.usage,
        costUsd: answer.costUsd,
        costReported: answer.costReported,
        ms: answer.ms,
        consulted: evidence.map((d) => d.url),
      }
    },
  }
}
