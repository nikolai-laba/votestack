import { describe, expect, it } from 'vitest'
import type { Endorsement } from '../../../src/shared/profile.ts'
import {
  filterEndorsementSources,
  sourceProblem,
  urlDate,
} from './endorsement-sources.ts'
import { fixtureProfile } from './test-fixtures.ts'

describe('sourceProblem', () => {
  it('drops iVoterGuide pages for other elections, keeps the 2026 general', () => {
    expect(
      sourceProblem(
        'https://ivoterguide.com/candidate/81920/race/15492/election/1195',
        'union',
      ),
    ).toBe('ivoterguide-old-election')
    expect(
      sourceProblem(
        'https://ivoterguide.com/candidate/58339/race/15515/election/959?culture=en-us',
        'organization',
      ),
    ).toBe('ivoterguide-old-election')
    // An unknown id is treated as not 2026.
    expect(
      sourceProblem('https://ivoterguide.com/race/1/election/9999', 'union'),
    ).toBe('ivoterguide-old-election')
    expect(
      sourceProblem(
        'https://ivoterguide.com/candidate/23427/race/29689/election/1443',
        'union',
      ),
    ).toBeNull()
  })

  it('drops iVoterGuide candidate pages without an election', () => {
    expect(
      sourceProblem('https://ivoterguide.com/candidate/77771', 'organization'),
    ).toBe('ivoterguide-no-election')
  })

  it('drops Ballotpedia and Wikipedia person pages, keeps 2026 election pages', () => {
    expect(
      sourceProblem('https://ballotpedia.org/Claudia_Peralta', 'organization'),
    ).toBe('reference-page')
    expect(
      sourceProblem('https://en.wikipedia.org/wiki/Mike_Quigley', 'union'),
    ).toBe('reference-page')
    expect(
      sourceProblem(
        'https://en.wikipedia.org/wiki/2026_Cook_County_Board_of_Commissioners_election',
        'union',
      ),
    ).toBeNull()
    expect(
      sourceProblem(
        'https://ballotpedia.org/Illinois_House_of_Representatives_elections,_2026',
        'union',
      ),
    ).toBeNull()
  })

  it('drops bare homepages of any site', () => {
    expect(sourceProblem('https://www.miguelfor40.org/', 'organization')).toBe(
      'homepage',
    )
    expect(sourceProblem('https://kim4staterep.com', 'union')).toBe('homepage')
    expect(
      sourceProblem('https://kim4staterep.com', 'union', 'candidate'),
    ).toBeNull()
    expect(
      sourceProblem('https://www.votejenniferdavis.com/endorsements', 'union'),
    ).toBeNull()
  })

  it('drops staging hosts and proxy copies', () => {
    expect(
      sourceProblem('https://pve.yoh.mybluehost.me/endorsements/', 'union'),
    ).toBe('staging-or-proxy')
    expect(
      sourceProblem(
        'https://exodusrust.com/v/https/en.wikipedia.org/wiki/2026_Chicago_Board_of_Education_election',
        'union',
      ),
    ).toBe('staging-or-proxy')
    expect(
      sourceProblem('https://staging.example.org/endorsements', 'union'),
    ).toBe('staging-or-proxy')
  })

  it('drops editorials from the primary season', () => {
    expect(
      sourceProblem(
        'https://www.dailyherald.com/20260224/endorsements/quigley-for-democrats-in-congress-dist-5/',
        'editorial_board',
      ),
    ).toBe('primary-editorial')
    expect(
      sourceProblem(
        'https://www.chicagotribune.com/2026/02/13/editorial-kam-buckner-illinois-26th-house-district-democratic-primary/',
        'editorial_board',
      ),
    ).toBe('primary-editorial')
    expect(
      sourceProblem(
        'https://chicagocrusader.com/chicago-crusader-endorsements-for-march-illinois-primary/',
        'editorial_board',
      ),
    ).toBe('primary-editorial')
    expect(
      sourceProblem(
        'https://www.chicagotribune.com/2026/10/05/editorial-mike-quigley-u-s-house-of-representatives-illinois-district-5/',
        'editorial_board',
      ),
    ).toBeNull()
    // Only editorials: a union's dated page isn't judged by its date.
    expect(
      sourceProblem(
        'https://www.dailyherald.com/20260224/endorsements/x/',
        'union',
      ),
    ).toBeNull()
  })
})

describe('urlDate', () => {
  it('reads dates in common URL shapes', () => {
    expect(urlDate('/2026/02/13/editorial-x/')).toBe('2026-02-13')
    expect(urlDate('/20260220/endorsements/x/')).toBe('2026-02-20')
    expect(urlDate('/news/2026-09-30-endorsement')).toBe('2026-09-30')
    // Year and month: the month's last day, so March isn't called primary.
    expect(urlDate('/2026/03/tinley-park-progress-endorses/')).toBe(
      '2026-03-31',
    )
    expect(urlDate('/endorsements/')).toBeUndefined()
  })
})

describe('filterEndorsementSources', () => {
  const homepage = {
    id: 3,
    title: 'Home',
    publisher: 'Example Union',
    url: 'https://exampleunion.org/',
    viewedAt: '2026-10-01',
    kind: 'endorser' as const,
  }
  const profile = (items: Endorsement[]) =>
    fixtureProfile({
      endorsements: { asOf: '2026-10-01', items },
      sources: [...fixtureProfile().sources, homepage],
    })

  it('drops an endorsement whose only source breaks a rule', () => {
    const { profile: p, removed } = filterEndorsementSources(
      profile([
        { organization: 'Sierra Club', kind: 'organization', cites: [2] },
        { organization: 'Example Union', kind: 'union', cites: [3] },
        // Ballotpedia person page (source 1)
        { organization: 'Mayor Smith', kind: 'elected_official', cites: [1] },
      ]),
    )
    expect(p.endorsements.items.map((e) => e.organization)).toEqual([
      'Sierra Club',
    ])
    expect(removed.map((r) => [r.organization, r.rule])).toEqual([
      ['Example Union', 'homepage'],
      ['Mayor Smith', 'reference-page'],
    ])
  })

  it('keeps an endorsement with at least one good source', () => {
    const { removed } = filterEndorsementSources(
      profile([
        { organization: 'Example Union', kind: 'union', cites: [3, 2] },
      ]),
    )
    expect(removed).toEqual([])
  })

  it('never touches bar evaluations or endorsements an override replaces', () => {
    const { removed } = filterEndorsementSources(
      profile([
        {
          organization: 'Chicago Bar Association',
          kind: 'bar_evaluation',
          rating: 'Qualified',
          cites: [3],
        },
        { organization: 'IUOE Local 150', kind: 'union', cites: [3] },
      ]),
      ['International Union of Operating Engineers Local 150'],
    )
    expect(removed).toEqual([])
  })

  it('is idempotent', () => {
    const once = filterEndorsementSources(
      profile([{ organization: 'Example Union', kind: 'union', cites: [3] }]),
    ).profile
    const twice = filterEndorsementSources(once)
    expect(twice.removed).toEqual([])
    expect(twice.profile).toBe(once)
  })
})
