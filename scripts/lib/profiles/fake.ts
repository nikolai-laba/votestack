// A stand-in profile model for --dry-run and tests: no network, no keys, no
// cost. Its output is plainly a placeholder and never meant to be published.

import type { GenerationResult, ProfileGenerator } from './generator.ts'
import type { ProfileRequest } from './prompt.ts'

export function fakeGenerator(): ProfileGenerator {
  return {
    id: 'fake',
    provider: 'fake',
    model: 'fake',
    searches: true,
    async generate(req: ProfileRequest): Promise<GenerationResult> {
      const page = req.name.replace(/["“”]/g, '').replace(/\s+/g, '_')
      return {
        output: {
          overview: [
            {
              text: `Placeholder text for ${req.name}, on the ballot for ${req.office}.`,
              cites: [1],
            },
          ],
          endorsements: [],
          sources: [
            {
              id: 1,
              title: req.name,
              publisher: 'Ballotpedia',
              url: `https://ballotpedia.org/${encodeURIComponent(page)}`,
              kind: 'reference',
            },
          ],
        },
        rawText: '',
        servedBy: 'fake',
        usage: { inputTokens: 0, outputTokens: 0 },
        costUsd: 0,
        costReported: true,
        ms: 0,
        consulted: [],
      }
    },
  }
}
