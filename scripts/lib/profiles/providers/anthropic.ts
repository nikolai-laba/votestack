// Claude through the Anthropic Messages API with the server-side web search
// tool. Structured outputs can't be combined with the citations web search
// adds, so the JSON comes back as text and is parsed.

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
  type ProfileRequest,
} from '../prompt.ts'

const URL = 'https://api.anthropic.com/v1/messages'
/** The server pauses long search loops; resume at most this many times. */
const MAX_CONTINUATIONS = 3

interface Block {
  type: string
  text?: string
  content?: { type: string; url?: string }[] | { error_code: string }
}

interface MessageResponse {
  model: string
  content: Block[]
  stop_reason: string
  usage: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
    server_tool_use?: { web_search_requests?: number }
  }
}

export function anthropicGenerator(
  model: string,
  options: { maxSearches?: number; effort?: string } = {},
): ProfileGenerator {
  return {
    id: model,
    provider: 'anthropic',
    model,
    searches: true,
    async generate(req: ProfileRequest): Promise<GenerationResult> {
      const headers = {
        'x-api-key': apiKey('ANTHROPIC_API_KEY'),
        'anthropic-version': '2023-06-01',
        // Re-run a declined request on another model inside the same call;
        // servedBy records which model answered.
        'anthropic-beta': 'server-side-fallback-2026-07-01',
      }
      const messages: { role: string; content: unknown }[] = [
        { role: 'user', content: buildUserMessage(req) },
      ]
      const started = Date.now()
      const usage = {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        searches: 0,
      }
      let res: MessageResponse | undefined
      const content: Block[] = []
      for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
        res = await postJson<MessageResponse>(URL, headers, {
          model,
          max_tokens: 16000,
          system: buildInstructions(req),
          messages,
          tools: [
            {
              type: 'web_search_20260209',
              name: 'web_search',
              max_uses: options.maxSearches ?? 8,
              user_location: {
                type: 'approximate',
                city: 'Chicago',
                region: 'Illinois',
                country: 'US',
                timezone: 'America/Chicago',
              },
            },
          ],
          output_config: { effort: options.effort ?? 'medium' },
          fallbacks: 'default',
        })
        usage.inputTokens +=
          res.usage.input_tokens +
          (res.usage.cache_read_input_tokens ?? 0) +
          (res.usage.cache_creation_input_tokens ?? 0)
        usage.cachedInputTokens += res.usage.cache_read_input_tokens ?? 0
        usage.outputTokens += res.usage.output_tokens
        usage.searches += res.usage.server_tool_use?.web_search_requests ?? 0
        content.push(...res.content)
        if (res.stop_reason !== 'pause_turn') break
        // Resume: send the paused turn back unchanged, with no new message.
        messages.splice(1, 1, { role: 'assistant', content: [...content] })
      }
      if (!res) throw new Error('No response')
      if (res.stop_reason === 'refusal') throw new Error('Model declined')

      const consulted = content.flatMap((b) =>
        b.type === 'web_search_tool_result' && Array.isArray(b.content)
          ? b.content.flatMap((r) => (r.url ? [r.url] : []))
          : [],
      )
      // The JSON is in the last text blocks, after any search narration.
      const texts = content.filter((b) => b.type === 'text')
      const rawText = texts.map((b) => b.text ?? '').join('')
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
