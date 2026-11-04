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
  raceAreaHead,
  raceHead,
  useDocumentHead,
  type PageHead,
} from './head.ts'
import type { CandidateProfile } from './shared/profile.ts'
import type { RaceResult } from './shared/raceResults.ts'
import type { Race, RaceList } from './shared/races.ts'

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

const SUFFIX =
  ' Background, campaign money and endorsements, with a source for every fact.'
const DAY = 'Tuesday, November 3, 2026'

const result = (over: Partial<RaceResult>): RaceResult => ({
  contestIds: ['t'],
  kind: 'candidate',
  status: 'called',
  choices: [],
  winners: [],
  certifyBy: '2026-12-01',
  scope: 'within',
  sources: [],
  changedAt: '2026-11-04T08:00:00Z',
  ...over,
})
const treasurer = (over: Partial<RaceResult> = {}) =>
  result({
    choices: [
      { name: 'Alex Rivera', votes: 660 },
      { name: 'Sam Moore', votes: 312 },
      { name: 'Pat Lee', votes: 28 },
    ],
    winners: ['Alex Rivera'],
    call: { by: 'AP', at: '2026-11-04T08:00:00Z', url: 'https://ap.test' },
    ...over,
  })
const certified = { on: '2026-11-20', url: 'https://cook.test' } as const
const alex = {
  ...profile,
  name: 'Alex Rivera',
  office: 'Treasurer',
  contestIds: ['t'],
}
const sam = { ...alex, name: 'Sam Moore', party: 'Republican' }

describe('profileHead with a result', () => {
  it('is today’s head without one', () => {
    expect(profileHead(alex, undefined)).toEqual(profileHead(alex))
  })

  it('leads a called winner’s description with the result', () => {
    expect(profileHead(alex, treasurer())).toEqual({
      title:
        'Alex Rivera, 2026 candidate for Treasurer, Illinois: results | VoteStack',
      description: `Alex Rivera (Democratic) won the race for Treasurer, Illinois, on ${DAY}, with 66.0% of the vote, as called by AP.${SUFFIX}`,
      path: '/candidates/jane-doe',
    })
  })

  it('says elected, without “as called”, once certified', () => {
    const head = profileHead(
      alex,
      treasurer({ status: 'certified', certified }),
    )
    expect(head.description).toBe(
      `Alex Rivera (Democratic) was elected Treasurer, Illinois, on ${DAY}, with 66.0% of the vote.${SUFFIX}`,
    )
  })

  it('says who won for a candidate who was not elected', () => {
    expect(profileHead(sam, treasurer()).description).toBe(
      `Sam Moore (Republican) ran for Treasurer, Illinois, on ${DAY}, and received 31.2% of the vote. Alex Rivera won.${SUFFIX}`,
    )
    expect(
      profileHead(sam, treasurer({ status: 'certified', certified }))
        .description,
    ).toContain('Alex Rivera was elected.')
  })

  it('gives an uncalled race no numbers', () => {
    for (const status of ['counting', 'too_close', 'no_count'] as const) {
      const d = profileHead(
        sam,
        treasurer({ status, winners: [] }),
      ).description!
      expect(d).toBe(
        `Sam Moore (Republican) ran for Treasurer, Illinois, on ${DAY}. The race hasn't been called yet.${SUFFIX}`,
      )
      expect(d).not.toContain('%')
    }
  })

  const judge = {
    ...profile,
    name: 'Pat Quinn',
    party: undefined,
    kind: 'retention' as const,
    office: 'Judge of the Circuit Court of Cook County',
  }
  const retention = (yes: number, no: number, over = {}) =>
    result({
      kind: 'retention',
      threshold: 0.6,
      choices: [
        { name: 'Yes', votes: yes },
        { name: 'No', votes: no },
      ],
      winners: yes / (yes + no) >= 0.6 ? ['Yes'] : ['No'],
      ...over,
    })

  it('titles a judge with the court and results', () => {
    expect(profileHead(judge, retention(714, 286)).title).toBe(
      'Pat Quinn, judge up for retention in 2026 (Cook County Circuit Court): results | VoteStack',
    )
  })

  it('says whether a judge was retained and what was needed', () => {
    expect(profileHead(judge, retention(714, 286)).description).toBe(
      `Pat Quinn was retained as Judge of the Circuit Court of Cook County on ${DAY}, with 71.4% yes (60% needed).${SUFFIX}`,
    )
    expect(profileHead(judge, retention(550, 450)).description).toBe(
      `Pat Quinn was not retained as Judge of the Circuit Court of Cook County on ${DAY}, with 55.0% yes (60% needed).${SUFFIX}`,
    )
    expect(
      profileHead(judge, retention(600, 400, { threshold: 0.5 })).description,
    ).toContain('with 60.0% yes (a majority needed).')
    expect(
      profileHead(
        judge,
        retention(600, 400, { status: 'counting', winners: [] }),
      ).description,
    ).toBe(
      `Pat Quinn was up for retention as Judge of the Circuit Court of Cook County on ${DAY}. The race hasn't been called yet.${SUFFIX}`,
    )
  })

  it('keeps sample profiles as they are', () => {
    const sample = { ...alex, sample: { forName: 'X', forOffice: 'Y' } }
    expect(profileHead(sample, treasurer())).toEqual(profileHead(sample))
  })
})

const race = (over: Partial<Race> = {}): Race =>
  ({
    path: 'il/cook-county/2026-11-03/treasurer',
    kind: 'candidate',
    level: 'county',
    title: 'Treasurer',
    office: 'Treasurer',
    districtId: 'ocd-division/country:us/state:il/county:cook',
    contestIds: ['t'],
    ballots: [],
    candidates: [
      { name: 'Alex Rivera' },
      { name: 'Sam Moore' },
      { name: 'Pat Lee' },
    ],
    ...over,
  }) as Race
const WHERE = `on the ${DAY} ballot in Cook County, Illinois`
const PROFILES = ' A profile for each candidate, with a source for every fact.'

describe('raceHead with a result', () => {
  it('is today’s head without one', () => {
    expect(raceHead(race(), true, undefined)).toEqual(raceHead(race()))
  })

  it('titles the page with the year’s results and leads with who won', () => {
    expect(raceHead(race(), true, treasurer())).toMatchObject({
      title: 'Treasurer (Cook County): 2026 results | VoteStack',
      description: `Results for Treasurer ${WHERE}: Alex Rivera won with 66.0%, as called by AP.${PROFILES}`,
    })
  })

  it('says elected once certified', () => {
    expect(
      raceHead(race(), true, treasurer({ status: 'certified', certified }))
        .description,
    ).toBe(
      `Results for Treasurer ${WHERE}: Alex Rivera was elected with 66.0%.${PROFILES}`,
    )
  })

  it('names every winner of a vote-for-N race, with no shares', () => {
    const many = treasurer({
      voteFor: 3,
      winners: ['Alex Rivera', 'Sam Moore', 'Pat Lee'],
    })
    expect(raceHead(race(), true, many).description).toBe(
      `Results for Treasurer ${WHERE}: Alex Rivera, Sam Moore and Pat Lee won, as called by AP.${PROFILES}`,
    )
    expect(
      raceHead(race(), true, { ...many, status: 'certified', certified })
        .description,
    ).toBe(
      `Results for Treasurer ${WHERE}: Alex Rivera, Sam Moore and Pat Lee were elected.${PROFILES}`,
    )
  })

  it('gives an uncalled race no numbers', () => {
    const d = raceHead(
      race(),
      true,
      treasurer({ status: 'counting', winners: [] }),
    ).description!
    expect(d).toBe(
      `Results for Treasurer ${WHERE}: the race hasn't been called yet.${PROFILES}`,
    )
    expect(d).not.toContain('%')
  })

  it('leaves out the profile promise where there are no profiles', () => {
    expect(raceHead(race(), false, treasurer()).description).toBe(
      `Results for Treasurer ${WHERE}: Alex Rivera won with 66.0%, as called by AP.`,
    )
  })

  it('says whether a judge was retained', () => {
    const judgeRace = race({
      path: 'il/cook-county/2026-11-03/quinn',
      kind: 'retention',
      title: 'Judge of the Circuit Court of Cook County',
      judge: 'Pat Quinn',
    })
    const r = (yes: number, no: number) =>
      result({
        kind: 'retention',
        threshold: 0.6,
        choices: [
          { name: 'Yes', votes: yes },
          { name: 'No', votes: no },
        ],
        winners: yes / (yes + no) >= 0.6 ? ['Yes'] : ['No'],
      })
    const where = `${DAY} ballot in Cook County, Illinois`
    expect(raceHead(judgeRace, true, r(714, 286)).description).toBe(
      `Results for retention of Pat Quinn as Judge of the Circuit Court of Cook County on the ${where}: retained with 71.4% yes (60% needed). A profile with a source for every fact.`,
    )
    expect(raceHead(judgeRace, false, r(550, 450)).description).toBe(
      `Results for retention of Pat Quinn as Judge of the Circuit Court of Cook County on the ${where}: not retained with 55.0% yes (60% needed).`,
    )
    expect(
      raceHead(judgeRace, true, {
        ...r(714, 286),
        status: 'counting',
        winners: [],
      }).description,
    ).toContain(": the race hasn't been called yet. A profile")
  })
})

describe('raceAreaHead with results', () => {
  const list = {
    area: 'Cook County',
    areaPath: 'il/cook-county/2026-11-03',
    date: '2026-11-03',
    races: new Array(3).fill(race()),
  } as unknown as RaceList

  it('is today’s head without results', () => {
    expect(raceAreaHead(list, true, false)).toEqual(raceAreaHead(list))
  })

  it('titles the list with results and leads its description with them', () => {
    expect(raceAreaHead(list, true, true)).toEqual({
      title: 'Races in Cook County, 2026: results | VoteStack',
      description: `Results for all 3 races and judges up for retention on the ${DAY} ballot in Cook County, as they're called and certified, with a profile for each candidate.`,
      path: '/races/il/cook-county/2026-11-03',
    })
    expect(raceAreaHead(list, false, true).description).toBe(
      `Results for all 3 races and judges up for retention on the ${DAY} ballot in Cook County, as they're called and certified.`,
    )
  })
})
