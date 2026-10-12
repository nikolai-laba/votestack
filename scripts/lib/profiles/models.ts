// The profile models the pipeline can run, with a rough per-profile cost for budget guards and the API key
// each provider needs. Keys are only ever read from the environment.

import type { ProfileGenerator } from './generator.ts'
import { anthropicGenerator } from './providers/anthropic.ts'
import { geminiGenerator } from './providers/gemini.ts'
import { openaiGenerator } from './providers/openai.ts'
import { openrouterGenerator } from './providers/openrouter.ts'
import { perplexityGenerator } from './providers/perplexity.ts'
import { stagedGenerator } from './providers/staged.ts'

export const MODELS: ProfileGenerator[] = [
  anthropicGenerator('claude-sonnet-5-5'),
  anthropicGenerator('claude-opus-5-5'),
  openaiGenerator('gpt-6-astra'),
  geminiGenerator('gemini-3.1-pro-preview'),
  perplexityGenerator('low'),
  openrouterGenerator('moonshotai/kimi-k3'),
  openrouterGenerator('deepseek/deepseek-v4-pro'),
  // Staged (prompt f006-1): DeepSeek writes from search results, Gemini
  // checks every sentence and researches endorsements.
  stagedGenerator(
    'deepseek/deepseek-v4-pro',
    'gemini-3.1-pro-preview',
    'deepseek-gemini',
  ),
]

/**
 * Rough cost of one profile per model, for the budget guard before a call,
 * from early test runs (2026-10-06). Actual cost comes from
 * each response's usage.
 */
export const ESTIMATE: Record<string, number> = {
  'claude-sonnet-5-5': 0.2,
  'claude-opus-5-5': 0.65,
  'gpt-6-astra': 0.8,
  'gemini-3.1-pro-preview': 0.15,
  'perplexity-low': 0.05,
  'openrouter-kimi-k3': 0.1,
  'openrouter-deepseek-v4-pro': 0.02,
  evidence: 0.005,
  // Not yet measured; set from the f006-1 test run.
  'deepseek-gemini': 0.3,
}

/** Cost assumed for a model missing from ESTIMATE. */
export const DEFAULT_ESTIMATE = 0.5

export const PROVIDER_KEYS: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
}

/** The model with this id, or an error listing the known ids. */
export function modelById(id: string): ProfileGenerator {
  const model = MODELS.find((m) => m.id === id)
  if (!model) {
    throw new Error(
      `Unknown model ${id}. Known: ${MODELS.map((m) => m.id).join(', ')}`,
    )
  }
  return model
}

/** Names of the environment variables a run with these models needs. */
export function requiredKeys(models: ProfileGenerator[]): string[] {
  const keys = new Set(
    models.flatMap((m) =>
      m.provider === 'staged'
        ? [
            'PERPLEXITY_API_KEY',
            'OPENROUTER_API_KEY',
            // Vertex AI signs in with gcloud instead of a key.
            ...(process.env.VERTEX_PROJECT ? [] : ['GEMINI_API_KEY']),
          ]
        : [PROVIDER_KEYS[m.provider]],
    ),
  )
  // Models without their own search get evidence from Perplexity's Search API.
  if (models.some((m) => !m.searches)) keys.add('PERPLEXITY_API_KEY')
  return [...keys]
}
