import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { checkTemplate } from '../scripts/lib/prerender.ts'
import {
  candidatePages,
  racePages,
  renderPage,
  STATIC_PAGES,
} from './prerender.tsx'
import { routes } from './routes.tsx'
import type { CandidateProfile } from './shared/profile.ts'
import type { RaceList } from './shared/races.ts'

const raceList: RaceList = {
  electionId: 'il-2026-11-03-general',
  electionName: 'General Election',
  date: '2026-11-03',
  area: 'Cook County, Illinois',
  areaPath: 'il/cook-county/2026-11-03',
  races: [
    {
      level: 'state',
      path: 'il/2026-11-03/state-senator-5th-district',
      kind: 'candidate',
      title: 'State Senator, 5th District',
      office: 'State Senator',
      districtId: 'ocd-division/country:us/state:il/sldu:5',
      contestIds: ['s5'],
      ballots: ['chicago'],
      voteFor: 1,
      candidates: [{ name: 'Jane Doe', party: 'Democratic' }],
    },
  ],
}

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
  overview: {
    asOf: '2026-10-05',
    items: [{ text: 'Jane Doe is a state senator.', cites: [1] }],
  },
  money: empty,
  endorsements: empty,
  sources: [
    {
      id: 1,
      title: 'Senate roster',
      publisher: 'Illinois General Assembly',
      url: 'https://ilga.gov/',
      viewedAt: '2026-10-05',
      kind: 'official',
    },
  ],
  meta: {
    model: 'm',
    promptVersion: 'p',
    generatedAt: '2026-10-07T20:00:00Z',
    version: 1,
  },
}

/** Every route's full path, e.g. "/candidates/:key". */
function routePaths(list = routes, parent = ''): string[] {
  return list.flatMap((r) => {
    const path = r.path
      ? r.path.startsWith('/')
        ? r.path
        : `${parent.replace(/\/$/, '')}/${r.path}`
      : parent
    return [...(r.path ? [path] : []), ...routePaths(r.children ?? [], path)]
  })
}

describe('prerender', () => {
  it('builds a file for every route, so none of them gets a 404 status', () => {
    const built = new Set([
      ...STATIC_PAGES.map((p) => p.path),
      ...candidatePages(profile, true).map((p) =>
        p.path.replace('jane-doe', ':key'),
      ),
      // /races and every page under it (racePages).
      ...(racePages(raceList).length === 3 ? ['/races/*'] : []),
      '/my-ballot', // a redirect in _redirects
      '/*', // 404.html
    ])
    for (const path of routePaths()) expect(built).toContain(path)
  })

  it('renders a live profile with the app’s own components', async () => {
    const [page, report] = candidatePages(profile, true)
    expect(page.file).toBe('candidates/jane-doe.html')
    const html = await renderPage(page)
    expect(html).toContain('>Jane Doe</h1>')
    expect(html).toContain('Jane Doe is a state senator.')
    expect(html).toContain('Senate roster')
    // The report form is left to the browser.
    expect(report.render).toBeUndefined()
    expect(await renderPage(report)).toBe('')
  })

  it('builds only the head when the file isn’t the published version', async () => {
    const [page] = candidatePages(profile, false)
    expect(page.head.title).toBe(
      'Jane Doe, 2026 candidate for State Senator, 5th District, Illinois | VoteStack',
    )
    expect(page.data).toBeUndefined()
    expect(await renderPage(page)).toBe('')
  })

  it('builds /races, the area list and every race, with their content', async () => {
    const pages = racePages(raceList)
    expect(pages.map((p) => p.file)).toEqual([
      'races.html',
      'races/il/cook-county/2026-11-03.html',
      'races/il/2026-11-03/state-senator-5th-district.html',
    ])
    // Built from the committed race list, so a race from it.
    const real = pages[1]
    const html = await renderPage(real)
    expect(html).toContain('Races in Cook County, Illinois')
    expect(html).toContain('href="/races/il/2026-11-03/united-states-senator"')
  })

  it('renders the address form for the home page', async () => {
    const home = STATIC_PAGES.find((p) => p.path === '/')!
    expect(await renderPage(home)).toContain('What&#x27;s on your ballot?')
  })

  it('finds its markers in index.html', () => {
    expect(() =>
      checkTemplate(readFileSync('index.html', 'utf8')),
    ).not.toThrow()
  })
})
