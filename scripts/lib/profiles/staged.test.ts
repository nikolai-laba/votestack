import { describe, expect, it } from 'vitest'
import { endorsementQueries, researchQueries } from './briefs.ts'
import type { EvidenceDoc } from './generator.ts'
import type { ProfileRequest } from './prompt.ts'
import {
  campaignPages,
  checkerInstructions,
  draftSentences,
  endorsementInstructions,
  extractJson,
  mergeStages,
  partyName,
  writerInstructions,
  type Checked,
  type Draft,
  type Endorsed,
} from './staged.ts'

const req: ProfileRequest = {
  key: 'pat-example',
  electionId: 'ocd-election/us/il/2026-11-03',
  name: 'Pat Example',
  party: 'Democratic',
  office: 'State Representative, 17th Representative District',
  contestIds: ['cook-clerk:181700'],
  kind: 'candidate',
  tier: 'mid',
  officeType: 'state_legislature',
  asOf: '2026-10-06',
}

const evidence: EvidenceDoc[] = [
  {
    url: 'https://www.ilga.gov/pat',
    title: 'Rep. Pat Example',
    snippet: 'Sponsored HB 1.',
  },
  {
    url: 'https://patexample.com/issues',
    title: 'Issues',
    snippet: 'Supports transit funding.',
  },
]

const page = (url: string, kind: 'news' | 'candidate' = 'news') => ({
  url,
  title: 'Page',
  publisher: 'Pub',
  kind,
})

describe('research briefs', () => {
  it('searches the legislature brief and stays within two requests', () => {
    const queries = researchQueries(req)
    expect(queries.some((q) => q.includes('ilga.gov'))).toBe(true)
    expect(queries.length).toBeLessThanOrEqual(10)
    expect(queries.every((q) => q.includes('"Pat Example"'))).toBe(true)
  })

  it('uses five endorsement searches, one request', () => {
    expect(endorsementQueries(req)).toHaveLength(5)
  })

  it('falls back to the judges brief from the kind', () => {
    const judge = { ...req, kind: 'retention' as const, officeType: undefined }
    expect(researchQueries(judge).join(' ')).toContain('judge')
  })
})

describe('prompts', () => {
  it('weights the overview, and keeps judges off positions', () => {
    expect(writerInstructions(req)).toContain('About 60%: positions')
    const judge = { ...req, kind: 'retention' as const }
    expect(writerInstructions(judge)).not.toContain('About 60%: positions')
    expect(writerInstructions(judge)).toContain('never describe positions')
  })

  it('tells the checker to remove what it cannot confirm', () => {
    expect(checkerInstructions(req)).toContain('remove the claim')
  })

  it('leaves bar ratings out of judges’ endorsement research', () => {
    expect(endorsementInstructions(req)).not.toContain(
      'Leave out bar association ratings',
    )
    expect(
      endorsementInstructions({ ...req, kind: 'judicial_candidate' }),
    ).toContain('Leave out bar association ratings')
  })
})

describe('draftSentences', () => {
  it('joins sentences to the pages they cite, and flags a missing one', () => {
    const draft: Draft = {
      paragraphs: [
        {
          sentences: [
            { text: ' Sponsored HB 1. ', source: 1 },
            { text: 'Made up.', source: 9 },
          ],
        },
      ],
      sources: [
        { id: 1, publisher: 'Illinois General Assembly', kind: 'official' },
      ],
    }
    const [[first, second]] = draftSentences(draft, evidence)
    expect(first).toMatchObject({
      ref: '1.1',
      text: 'Sponsored HB 1.',
      source: { url: 'https://www.ilga.gov/pat', kind: 'official' },
    })
    expect(second.source).toBeUndefined()
  })
})

describe('campaignPages', () => {
  it('lists the campaign pages the writer cited', () => {
    const draft: Draft = {
      paragraphs: [],
      sources: [
        { id: 1, publisher: 'ILGA', kind: 'official' },
        { id: 2, publisher: 'Pat Example campaign', kind: 'candidate' },
      ],
    }
    expect(campaignPages(draft, evidence)).toEqual([
      'https://patexample.com/issues',
    ])
  })
})

describe('mergeStages', () => {
  it('numbers each page once, overview first, one source per sentence', () => {
    const checked: Checked = {
      paragraphs: [
        {
          sentences: [
            { text: 'Sponsored HB 1.', source: page('https://a.org/1') },
            { text: 'Supports transit.', source: page('https://b.org/2') },
            { text: 'Served since 2019.', source: page('https://a.org/1') },
          ],
        },
        { sentences: [{ text: 'No page.', source: page('not a url') }] },
      ],
      review: [],
    }
    const endorsed: Endorsed = {
      endorsements: [
        {
          name: 'Transit Riders',
          kind: 'organization',
          source: page('https://b.org/2'),
        },
        {
          name: "Transit Riders'",
          kind: 'organization',
          source: page('https://c.org'),
        },
        {
          name: 'Bar Group',
          kind: 'bar_evaluation' as 'organization',
          source: page('https://d.org'),
        },
        { name: 'Union', kind: 'union', source: page('https://e.org') },
      ],
    }
    const out = mergeStages(checked, endorsed)
    expect(out.sources.map((s) => [s.id, s.url])).toEqual([
      [1, 'https://a.org/1'],
      [2, 'https://b.org/2'],
      [3, 'https://e.org'],
    ])
    expect(out.overview).toHaveLength(1)
    expect(out.overview[0].text).toBe(
      'Sponsored HB 1. Supports transit. Served since 2019.',
    )
    expect(out.overview[0].cites).toEqual([1, 2])
    expect(out.overview[0].sentences?.map((s) => s.cites)).toEqual([
      [1],
      [2],
      [1],
    ])
    expect(out.endorsements.map((e) => [e.organization, e.cites])).toEqual([
      ['Transit Riders', [2]],
      ['Union', [3]],
    ])
  })

  it('returns an empty profile when no stage answered', () => {
    expect(mergeStages(undefined, undefined)).toEqual({
      overview: [],
      endorsements: [],
      sources: [],
    })
  })
})

describe('extractJson', () => {
  it('reads fenced and chatty answers', () => {
    expect(extractJson('Here:\n```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('Sure! {"a":2} Done.')).toEqual({ a: 2 })
    expect(() => extractJson('nothing')).toThrow()
  })
})

describe('endorser parties', () => {
  it('normalizes party names and drops unknowns', () => {
    expect(partyName('Democrat')).toBe('Democratic')
    expect(partyName('GOP')).toBe('Republican')
    expect(partyName('Green Party')).toBe('Green')
    expect(partyName('null')).toBeUndefined()
    expect(partyName(null)).toBeUndefined()
  })

  it('keeps a party only on elected officials', () => {
    const out = mergeStages(undefined, {
      endorsements: [
        {
          name: 'U.S. Sen. Pat Example',
          kind: 'elected_official',
          party: 'Democrat',
          source: page('https://a.org'),
        },
        {
          name: 'Transit Riders',
          kind: 'organization',
          party: 'Republican',
          source: page('https://b.org'),
        },
      ],
    })
    expect(out.endorsements.map((e) => e.party)).toEqual([
      'Democratic',
      undefined,
    ])
  })
})
