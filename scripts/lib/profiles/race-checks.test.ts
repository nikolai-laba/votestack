import { describe, expect, it } from 'vitest'
import {
  checkCoverage,
  checkDates,
  checkLinks,
  detectGate,
  type LinkResult,
} from './race-checks.ts'
import { fixtureProfile, thinProfile } from './test-fixtures.ts'

describe('checkCoverage', () => {
  it('flags an opponent with half the words or two fewer sections', () => {
    const full = fixtureProfile({
      money: {
        asOf: '2026-10-01',
        items: [
          {
            source: 'ISBE',
            committee: 'Friends of Jane Doe',
            url: 'https://elections.il.gov/x',
            period: 'July 1 to September 30, 2026',
          },
        ],
      },
    })
    const result = checkCoverage([full, thinProfile()])
    expect(result.get('jane-doe')).toEqual([])
    const thin = result.get('john-roe')?.map((i) => i.message) ?? []
    expect(thin).toHaveLength(2)
    expect(thin[0]).toMatch(/1 of 3 sections filled; Jane Doe has 3/)
    expect(thin[1]).toMatch(/Overview of 5 words/)
  })

  it('allows one section of difference and similar lengths', () => {
    const result = checkCoverage([
      fixtureProfile(),
      thinProfile({
        overview: {
          asOf: '2026-10-01',
          items: [
            {
              text: 'John Roe is a lawyer who has run a firm since 2004.',
              cites: [1],
            },
          ],
        },
      }),
    ])
    expect(result.get('john-roe')).toEqual([])
  })

  it('has nothing to compare in a race of one', () => {
    expect(checkCoverage([thinProfile()]).get('john-roe')).toEqual([])
  })
})

describe('checkDates', () => {
  it('passes recent dates', () => {
    expect(checkDates(fixtureProfile(), '2026-10-06')).toEqual([])
  })

  it('flags future dates and sources viewed over 30 days ago', () => {
    const issues = checkDates(fixtureProfile(), '2026-11-15').map(
      (i) => i.message,
    )
    expect(issues).toEqual([
      'Viewed 45 days ago (2026-10-01); the limit is 30',
      'Viewed 45 days ago (2026-10-01); the limit is 30',
    ])
    const future = checkDates(fixtureProfile(), '2026-09-30')
    expect(future.length).toBeGreaterThan(0)
    expect(future.every((i) => i.message.startsWith('In the future'))).toBe(
      true,
    )
  })
})

describe('checkLinks', () => {
  const ok = (
    url: string,
    over: Partial<LinkResult> = {},
  ): [string, LinkResult] => [
    url,
    {
      url,
      status: 200,
      finalUrl: url,
      checkedAt: '2026-10-06T00:00:00Z',
      ...over,
    },
  ]
  const p = fixtureProfile()
  const [a, b] = p.sources.map((s) => s.url)

  it('passes links that open', () => {
    expect(checkLinks(p, new Map([ok(a), ok(b)]))).toEqual([])
  })

  it('flags broken, unchecked, gated and social links', () => {
    expect(checkLinks(p, new Map([ok(a, { status: 404 })]))).toHaveLength(2)
    const gated = checkLinks(
      p,
      new Map([
        ok(a, { gate: 'paywall' }),
        ok(b, { finalUrl: 'https://www.facebook.com/x' }),
      ]),
    )
    expect(gated.map((i) => i.rule)).toEqual(['link', 'source'])
  })
})

describe('detectGate', () => {
  it('spots login and paywall pages', () => {
    expect(detectGate('https://example.com/login?next=/a', '')).toBe('login')
    expect(
      detectGate(
        'https://news.example.com/a',
        '<script>{"isAccessibleForFree": false}</script>',
      ),
    ).toBe('paywall')
    expect(
      detectGate('https://news.example.com/a', '<p>Story</p>'),
    ).toBeUndefined()
  })
})
