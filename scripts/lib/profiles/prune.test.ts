import { describe, expect, it } from 'vitest'
import { paragraphOf } from '../../../src/shared/profile.ts'
import { pruneDeadSources } from './prune.ts'
import { fixtureProfile } from './test-fixtures.ts'

describe('pruneDeadSources', () => {
  const base = fixtureProfile()
  const [a, b] = base.sources
  const profile = {
    ...base,
    overview: {
      ...base.overview,
      items: [
        paragraphOf([
          { text: 'Kept.', cites: [a.id] },
          { text: 'Gone.', cites: [b.id] },
        ]),
      ],
    },
    endorsements: {
      ...base.endorsements,
      items: [
        {
          organization: 'Live Group',
          kind: 'organization' as const,
          cites: [a.id],
        },
        {
          organization: 'Dead Group',
          kind: 'organization' as const,
          cites: [b.id],
        },
      ],
    },
  }

  it('removes sentences and endorsements resting only on a dead page', () => {
    const { profile: out, removed } = pruneDeadSources(
      profile,
      (url) => url === b.url,
    )
    expect(out.overview.items[0].sentences?.map((s) => s.text)).toEqual([
      'Kept.',
    ])
    expect(out.endorsements.items.map((e) => e.organization)).toEqual([
      'Live Group',
    ])
    expect(out.sources.map((s) => s.url)).toEqual([a.url])
    expect(removed).toEqual(['overview: Gone.', 'endorsement: Dead Group'])
  })

  it('leaves a profile with no dead sources alone', () => {
    expect(pruneDeadSources(profile, () => false).profile).toBe(profile)
  })
})
