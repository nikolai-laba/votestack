// OpenAI through the Responses API with its web search tool and a strict JSON
// schema for the answer.

import {
  apiKey,
  costFromUsage,
  postJson,
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

const URL = 'https://api.openai.com/v1/responses'

interface OutputItem {
  type: string
  action?: { type?: string; sources?: { url?: string }[] }
  content?: { type: string; text?: string }[]
}

interface ResponsesResponse {
  model: string
  status: string
  output: OutputItem[]
  usage: {
    input_tokens: number
    output_tokens: number
    input_tokens_details?: { cached_tokens?: number }
  }
}

export function openaiGenerator(
  model: string,
  options: { effort?: string } = {},
): ProfileGenerator {
  return {
    id: model,
    provider: 'openai',
    model,
    searches: true,
    async generate(req: ProfileRequest): Promise<GenerationResult> {
      const started = Date.now()
      const res = await postJson<ResponsesResponse>(
        URL,
        { authorization: `Bearer ${apiKey('OPENAI_API_KEY')}` },
        {
          model,
          instructions: buildInstructions(req),
          input: buildUserMessage(req),
          tools: [
            {
              type: 'web_search',
              user_location: {
                type: 'approximate',
                country: 'US',
                region: 'Illinois',
                city: 'Chicago',
              },
            },
          ],
          include: ['web_search_call.action.sources'],
          reasoning: { effort: options.effort ?? 'medium' },
          text: {
            format: {
              type: 'json_schema',
              name: 'candidate_profile',
              schema: PROFILE_OUTPUT_SCHEMA,
              strict: true,
            },
          },
        },
      )
      const calls = res.output.filter((o) => o.type === 'web_search_call')
      const usage = {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cachedInputTokens: res.usage.input_tokens_details?.cached_tokens ?? 0,
        // Only "search" actions are billed; opening a page is not a search.
        searches: calls.filter((c) => (c.action?.type ?? 'search') === 'search')
          .length,
      }
      const rawText = res.output
        .filter((o) => o.type === 'message')
        .flatMap((o) => o.content ?? [])
        .filter((c) => c.type === 'output_text')
        .map((c) => c.text ?? '')
        .join('')
      const consulted = calls.flatMap((c) =>
        (c.action?.sources ?? []).flatMap((s) => (s.url ? [s.url] : [])),
      )
      return {
        output: parseProfileJson(rawText),
        rawText,
        servedBy: res.model,
        usage,
        costUsd: costFromUsage(model, usage),
        costReported: false,
        ms: Date.now() - started,
        consulted: [...new Set(consulted)],
      }
    },
  }
}
