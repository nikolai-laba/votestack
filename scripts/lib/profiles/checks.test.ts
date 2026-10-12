import { describe, expect, it } from 'vitest'
import type { CandidateProfile } from '../../../src/shared/profile.ts'
import {
  checkCitations,
  checkJudicial,
  checkLength,
  checkPrivacy,
  checkSources,
  checkTone,
  countWords,
  isSocialMedia,
  lintPrivacy,
  lintTone,
  runChecks,
} from './checks.ts'
import { parseProfileJson, PROFILE_OUTPUT_SCHEMA } from './prompt.ts'

function profile(over: Partial<CandidateProfile> = {}): CandidateProfile {
  return {
    key: 'jane-doe',
    electionId: 'il-2026-11-03-general',
    name: 'Jane Doe',
    office: 'Commissioner, Water Reclamation District',
    contestIds: ['cook-clerk:190100'],
    kind: 'candidate',
    tier: 'mid',
    overview: {
      asOf: '2026-10-06',
      items: [{ text: 'Jane Doe was elected in 2020.', cites: [1] }],
    },
    money: { asOf: '2026-10-06', items: [] },
    endorsements: {
      asOf: '2026-10-06',
      items: [
        { organization: 'Sierra Club', kind: 'organization', cites: [2] },
      ],
    },
    sources: [
      {
        id: 1,
        title: 'Jane Doe',
        publisher: 'Ballotpedia',
        url: 'https://ballotpedia.org/Jane_Doe',
        viewedAt: '2026-10-06',
        kind: 'reference',
      },
      {
        id: 2,
        title: 'Endorsements',
        publisher: 'Sierra Club',
        url: 'https://www.sierraclub.org/illinois/endorsements',
        viewedAt: '2026-10-06',
        kind: 'endorser',
      },
    ],
    meta: {
      model: 'test',
      promptVersion: 'test',
      generatedAt: '2026-10-06T00:00:00Z',
      version: 1,
    },
    ...over,
  }
}

const rules = (issues: { rule: string; severity: string }[]) =>
  issues.filter((i) => i.severity === 'error').map((i) => i.rule)

describe('runChecks', () => {
  it('passes a clean, cited profile', () => {
    expect(runChecks(profile())).toEqual({ pass: true, issues: [] })
  })
})

describe('checkCitations', () => {
  it('flags items without a source and cites of missing sources', () => {
    const p = profile({
      overview: {
        asOf: '2026-10-06',
        items: [
          { text: 'No source.', cites: [] },
          { text: 'Bad source.', cites: [9] },
        ],
      },
    })
    const issues = checkCitations(p)
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(2)
    // Source 1 is no longer cited by anything.
    expect(issues.some((i) => i.message.includes('never cited'))).toBe(true)
  })

  it('flags repeated source numbers', () => {
    const p = profile()
    p.sources[1].id = 1
    expect(rules(checkCitations(p))).toContain('citation')
  })
})

describe('checkSources', () => {
  it('rejects social media, search redirects and non-links', () => {
    const p = profile()
    p.sources[0].url = 'https://www.facebook.com/janedoe'
    p.sources[1].url =
      'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc'
    const extra = { ...p.sources[0], id: 3, url: 'not a url' }
    expect(
      rules(checkSources({ ...p, sources: [...p.sources, extra] })),
    ).toEqual(['source', 'source', 'source'])
  })

  it('knows social media hosts and subdomains', () => {
    expect(isSocialMedia('https://x.com/someone')).toBe(true)
    expect(isSocialMedia('https://m.facebook.com/page')).toBe(true)
    expect(isSocialMedia('https://www.youtube.com/watch?v=1')).toBe(true)
    expect(isSocialMedia('https://chicago.suntimes.com/elections')).toBe(false)
    expect(isSocialMedia('https://box.com/x')).toBe(false)
  })
})

describe('lintTone', () => {
  it('flags banned words, loaded words and superlatives', () => {
    const hits = lintTone(
      'A tireless, controversial leader who will transform the landscape and is the most qualified.',
    ).map((h) => h.match.toLowerCase())
    expect(hits).toEqual(
      expect.arrayContaining([
        'tireless',
        'controversial',
        'transform',
        'landscape',
        'most qualified',
      ]),
    )
  })

  it('flags em dashes, framing and emoji', () => {
    expect(lintTone('She ran — and won.')).toHaveLength(1)
    expect(lintTone('Not just a lawyer, but an advocate.')[0].message).toMatch(
      /Not just/,
    )
    expect(lintTone("It's not a job, it's a calling.")[0].message).toMatch(
      /It's not/,
    )
    expect(lintTone('Elected 🎉')[0].message).toBe('Emoji')
    expect(
      lintTone(
        'A pastor. ([wbez.org](https://www.wbez.org/x?utm_source=openai))',
      ).map((h) => h.message),
    ).toContain('Link in text')
  })

  it('skips proper nouns but not sentence-initial words', () => {
    expect(
      lintTone('He leads the Journey for Justice Alliance and Top Box Foods.'),
    ).toEqual([])
    expect(lintTone('Robust debate followed.')[0].match).toBe('Robust')
  })

  it('leaves neutral wording alone', () => {
    expect(
      lintTone(
        'Supports more funding for flood control. Has proposed a new budget rule. Was elected in 2018.',
      ),
    ).toEqual([])
  })

  it('reports where a hit is', () => {
    const p = profile({
      overview: {
        asOf: '2026-10-06',
        items: [{ text: 'A beloved figure.', cites: [1] }],
      },
    })
    expect(checkTone(p)[0]).toMatchObject({ rule: 'tone', at: 'overview[0]' })
  })

  it("ignores the person's own name but not the same word in the text", () => {
    const p = profile({
      name: 'Bill Foster',
      overview: {
        asOf: '2026-10-06',
        items: [{ text: 'Bill Foster was elected in 2012.', cites: [1] }],
      },
    })
    expect(checkTone(p)).toEqual([])
    p.overview.items[0].text = 'Foster wants to foster growth.'
    expect(checkTone(p)).toHaveLength(1)
  })
})

describe('checkLength', () => {
  const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ')

  it('counts words, not punctuation', () => {
    expect(countWords('Hello, world. — 2026 ok')).toBe(4)
  })

  it('enforces word and paragraph limits per tier', () => {
    const short = (texts: string[]) =>
      profile({
        tier: 'short',
        overview: {
          asOf: '2026-10-06',
          items: texts.map((text) => ({ text, cites: [1] })),
        },
      })
    expect(checkLength(short([words(70)]))).toEqual([])
    expect(rules(checkLength(short([words(71)])))).toEqual(['length'])
    expect(rules(checkLength(short([words(10), words(10)])))).toEqual([
      'length',
    ])
  })

  it('allows 250 words in three paragraphs at the top of the ticket', () => {
    const p = profile({
      tier: 'top',
      overview: {
        asOf: '2026-10-06',
        items: [words(100), words(100), words(50)].map((text) => ({
          text,
          cites: [1],
        })),
      },
    })
    expect(checkLength(p)).toEqual([])
  })
})

describe('lintPrivacy', () => {
  it('finds addresses, phones, emails, birth dates, ages and family', () => {
    const found = (text: string) => lintPrivacy(text).map((h) => h.message)
    expect(found('She lives at 1234 N Main St in Chicago.')).toContain(
      'Street address',
    )
    expect(found('Call (312) 555-0100.')).toContain('Phone number')
    expect(found('Email jane@example.com.')).toContain('Email address')
    expect(found('Born on March 4, 1970 in Peoria.')).toContain('Birth date')
    expect(found('He is 54 years old.')).toContain('Age')
    expect(found('She lives with her husband and two children.')).toContain(
      'Family',
    )
  })

  it('leaves policy about other families alone', () => {
    expect(
      lintPrivacy('Her bill helps parents protect their children online.'),
    ).toEqual([])
  })

  it('leaves office names and years alone', () => {
    expect(
      lintPrivacy(
        'Elected in 2018 to the 17th District. Served on the Water Reclamation District board.',
      ),
    ).toEqual([])
  })

  it('checks overview text', () => {
    const p = profile({
      overview: {
        asOf: '2026-10-06',
        items: [{ text: 'Reach her at 312-555-0100.', cites: [1] }],
      },
    })
    expect(rules(checkPrivacy(p))).toEqual(['privacy'])
  })
})

describe('checkJudicial', () => {
  it('warns about positions in a judge profile only', () => {
    const items = [{ text: 'Supports bail reform.', cites: [1] }]
    const judge = profile({
      kind: 'retention',
      overview: { asOf: '2026-10-06', items },
    })
    expect(checkJudicial(judge)).toHaveLength(1)
    expect(
      checkJudicial(profile({ overview: { asOf: '2026-10-06', items } })),
    ).toEqual([])
  })
})

describe('parseProfileJson', () => {
  it('reads JSON wrapped in fences or prose and drops null ratings', () => {
    const text =
      'Here it is:\n```json\n{"overview":[],"endorsements":[{"organization":"CBA","kind":"bar_evaluation","rating":null,"cites":[1]}],"sources":[]}\n```'
    const out = parseProfileJson(text)
    expect(out.endorsements[0].rating).toBeUndefined()
    expect(out.overview).toEqual([])
  })

  it('throws when there is no JSON', () => {
    expect(() => parseProfileJson('No results found.')).toThrow()
  })

  it('has a strict schema: every property required, nothing extra', () => {
    const walk = (s: Record<string, unknown>): void => {
      if (s.type === 'object') {
        expect(s.additionalProperties).toBe(false)
        const props = s.properties as Record<string, Record<string, unknown>>
        expect(s.required).toEqual(Object.keys(props))
        Object.values(props).forEach(walk)
      }
      if (s.type === 'array') walk(s.items as Record<string, unknown>)
    }
    walk(PROFILE_OUTPUT_SCHEMA as unknown as Record<string, unknown>)
  })
})

describe('privacy false positives', () => {
  it('ignores a year before a court name and a program’s birthday month', () => {
    expect(
      lintPrivacy(
        'Supports the 2022 Supreme Court ruling. Offers screenings in a resident’s birthday month.',
      ),
    ).toEqual([])
  })

  it('still catches a street address and a birthday', () => {
    expect(lintPrivacy('Lives at 1234 N Main Street.').length).toBe(1)
    expect(lintPrivacy('Her birthday is in May.').length).toBe(1)
  })
})

describe('foster care is not the banned verb', () => {
  it('allows foster care and foster youth, still flags fostering trust', () => {
    expect(lintTone('Backed the KIND Act for foster youth.')).toEqual([])
    expect(lintTone('Expanded foster care.')).toEqual([])
    expect(lintTone('Wants to foster trust.').length).toBe(1)
  })
})
