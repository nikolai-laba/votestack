import { LOS_ANGELES } from './shared/regions.ts'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ABOUT_HEAD,
  HOME_HEAD,
  NOT_FOUND_HEAD,
  headHtml,
  profileHead,
  profileOffice,
  useDocumentHead,
  type PageHead,
} from './head.ts'
import type { CandidateProfile } from './shared/profile.ts'

const empty = { asOf: '2026-10-05', items: [] }
const profile: CandidateProfile = {
  key: 'jane-doe',
  electionId: 'il-2026-11-03-general',
  name: 'Jane Doe',
  party: 'Democratic',
  office: 'State Senator, 5th District',
  contestIds: ['s5'],
  kind: 'candidate',
  tier: 'mid',
  overview: empty,
  money: empty,
  endorsements: empty,
  sources: [],
  meta: {
    model: 'm',
    promptVersion: 'p',
    generatedAt: '2026-10-07T20:00:00Z',
    version: 1,
  },
}

const content = (selector: string) =>
  document.head
    .querySelector(selector)
    ?.getAttribute(selector.startsWith('link') ? 'href' : 'content') ?? null

function Head({ head }: { head: PageHead | null }) {
  useDocumentHead(head)
  return null
}

afterEach(cleanup)

describe('profileHead', () => {
  it('uses one template for every candidate, filled from the ballot', () => {
    expect(profileHead(profile)).toEqual({
      title:
        'Jane Doe, 2026 candidate for State Senator, 5th District, Illinois | VoteStack',
      description:
        'Jane Doe (Democratic) is running for State Senator, 5th District on the November 3, 2026 ballot in Cook County, Illinois. Background, campaign money and endorsements, with a source for every fact.',
      path: '/candidates/jane-doe',
    })
  })

  it('leads a judge’s title with “judge” and the court, and says there’s no party', () => {
    const judge = {
      ...profile,
      party: undefined,
      kind: 'retention' as const,
      office: 'Circuit Court Judge, Cook County',
    }
    expect(profileHead(judge)).toEqual({
      title:
        'Jane Doe, judge up for retention in 2026 (Cook County Circuit Court) | VoteStack',
      description:
        'Jane Doe, judge up for retention on November 3, 2026. No party on the ballot: see which parties and groups endorse or oppose this judge, with sources.',
      path: '/candidates/jane-doe',
    })
  })

  it('names California’s courts for Los Angeles County judges', () => {
    const la = {
      ...profile,
      electionId: LOS_ANGELES.election.id,
      party: undefined,
    }
    expect(
      profileHead({
        ...la,
        kind: 'retention',
        office:
          'Associate Justice, Court of Appeal, Second District, Division Eight',
      }).title,
    ).toBe(
      'Jane Doe, judge up for retention in 2026 (Court of Appeal) | VoteStack',
    )
    expect(
      profileHead({
        ...la,
        kind: 'retention',
        office: 'Associate Justice of the Supreme Court',
      }).title,
    ).toBe(
      'Jane Doe, judge up for retention in 2026 (California Supreme Court) | VoteStack',
    )
    const candidate = profileHead({
      ...la,
      kind: 'judicial_candidate',
      office: 'Superior Court Judge, Los Angeles County (Office No. 39)',
    })
    expect(candidate.title).toBe(
      'Jane Doe, candidate for judge in 2026 (Los Angeles County Superior Court) | VoteStack',
    )
    expect(candidate.description).toBe(
      'Jane Doe, candidate for judge on November 3, 2026. No party on the ballot: see which parties and groups endorse or oppose this candidate, with sources.',
    )
    // Short enough that Google shows all of it.
    expect(candidate.description!.length).toBeLessThanOrEqual(160)
  })

  it('keeps the party in a judge candidate’s description when the ballot shows one', () => {
    const head = profileHead({
      ...profile,
      kind: 'judicial_candidate',
      office: 'Circuit Court Judge, 3rd Subcircuit (Vacancy of Sherlock)',
    })
    expect(head.title).toBe(
      'Jane Doe, candidate for judge in 2026 (Cook County Circuit Court) | VoteStack',
    )
    expect(head.description).toMatch(
      /^Jane Doe \(Democratic\) is running for Circuit Court Judge, 3rd Subcircuit \(Vacancy of Sherlock\) on the November 3, 2026 ballot in Cook County, Illinois\./,
    )
  })

  it('names the seat without its vacancy, with the place when the office doesn’t say', () => {
    expect(
      profileOffice(
        'Circuit Court Judge, 3rd Subcircuit (Vacancy of Sherlock)',
      ),
    ).toBe('Circuit Court Judge, 3rd Subcircuit, Cook County')
    expect(profileOffice('U.S. Representative, 7th District')).toBe(
      'U.S. Representative, 7th District, Illinois',
    )
    expect(profileOffice('Illinois Attorney General')).toBe(
      'Illinois Attorney General',
    )
    expect(profileOffice('Cook County Clerk')).toBe('Cook County Clerk')
  })

  it('places Los Angeles County offices in California, not Illinois', () => {
    expect(
      profileOffice('U.S. Representative, 37th District', LOS_ANGELES),
    ).toBe('U.S. Representative, 37th District, California')
    expect(
      profileOffice('Board of Equalization Member, 3rd District', LOS_ANGELES),
    ).toBe('Board of Equalization Member, 3rd District, California')
    expect(profileOffice('City of Los Angeles, Mayor', LOS_ANGELES)).toBe(
      'City of Los Angeles, Mayor',
    )
    expect(
      profileOffice(
        'Abc Unified School District, Governing Board Member',
        LOS_ANGELES,
      ),
    ).toBe(
      'Abc Unified School District, Governing Board Member, Los Angeles County',
    )
    const head = profileHead({
      ...profile,
      electionId: LOS_ANGELES.election.id,
      office: 'State Senator, 22nd District',
    })
    expect(head.title).toContain('State Senator, 22nd District, California')
    expect(head.description).toContain('Los Angeles County, California')
    expect(head.description).not.toContain('Illinois')
  })

  it('keeps sample profiles out of search', () => {
    const sample = { ...profile, sample: { forName: 'X', forOffice: 'Y' } }
    expect(profileHead(sample).noindex).toBe(true)
    expect(profileHead(sample).path).toBeUndefined()
  })
})

describe('headHtml', () => {
  it('writes the canonical, description and social tags, escaped', () => {
    const html = headHtml({ ...profileHead(profile), title: 'A "B" & <C>' })
    expect(html).toContain('<title>A &quot;B&quot; &amp; &lt;C&gt;</title>')
    expect(html).toContain(
      '<link rel="canonical" href="https://votestack.org/candidates/jane-doe" />',
    )
    expect(html).toContain('<meta property="og:title" content="A &quot;B')
    expect(html).toContain(
      '<meta property="og:image" content="https://votestack.org/brand/votestack-share.png" />',
    )
    expect(html).not.toContain('robots')
  })

  it('describes the site as JSON-LD on the home page only', () => {
    const json = /<script type="application\/ld\+json">(.*)<\/script>/.exec(
      headHtml(HOME_HEAD),
    )?.[1]
    const data = JSON.parse(json!)
    expect(data['@graph'].map((n: { '@type': string }) => n['@type'])).toEqual([
      'WebSite',
      'Organization',
    ])
    expect(data['@graph'][0]).toMatchObject({
      name: 'VoteStack',
      url: 'https://votestack.org/',
    })
    expect(headHtml(ABOUT_HEAD)).not.toContain('ld+json')
  })

  it('marks noindex pages and gives them no canonical', () => {
    const html = headHtml(NOT_FOUND_HEAD)
    expect(html).toContain('<meta name="robots" content="noindex" />')
    expect(html).not.toContain('canonical')
  })
})

describe('useDocumentHead', () => {
  it('sets the head while shown and puts the previous one back', () => {
    document.title = 'Before'
    const { rerender, unmount } = render(<Head head={ABOUT_HEAD} />)
    expect(document.title).toBe('About VoteStack | VoteStack')
    expect(content('link[rel="canonical"]')).toBe('https://votestack.org/about')
    expect(content('meta[name="robots"]')).toBeNull()

    rerender(<Head head={NOT_FOUND_HEAD} />)
    expect(content('meta[name="robots"]')).toBe('noindex')
    expect(content('link[rel="canonical"]')).toBeNull()

    unmount()
    expect(document.title).toBe('Before')
    expect(content('meta[name="robots"]')).toBeNull()
    expect(content('link[rel="canonical"]')).toBeNull()
  })

  it('leaves the head alone while there is nothing to show', () => {
    document.title = 'Before'
    render(<Head head={null} />)
    expect(document.title).toBe('Before')
  })
})
