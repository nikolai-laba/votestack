import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkTemplate } from '../scripts/lib/prerender.ts'
import {
  candidatePages,
  racePages,
  renderPage,
  STATIC_PAGES,
} from './prerender.tsx'
import { routes } from './routes.tsx'
import type { RaceData } from './races/data.ts'
import type { CandidateProfile } from './shared/profile.ts'
import type { RaceList } from './shared/races.ts'

// Switches the site to its after-election wording for the tests that say so.
const mode = vi.hoisted(() => ({ on: false }))
vi.mock('./shared/afterElection.ts', async (original) => ({
  ...(await original<typeof import('./shared/afterElection.ts')>()),
  get AFTER_ELECTION() {
    return mode.on
  },
}))

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

const laList: RaceList = {
  electionId: 'ca-2026-11-03-general',
  electionName: 'General Election',
  date: '2026-11-03',
  area: 'Los Angeles County, California',
  areaPath: 'ca/los-angeles-county/2026-11-03',
  races: [
    {
      level: 'county',
      path: 'ca/los-angeles-county/2026-11-03/sheriff',
      kind: 'candidate',
      title: 'Sheriff',
      office: 'Sheriff',
      districtId: 'ocd-division/country:us/state:ca/county:los_angeles',
      contestIds: ['la:sheriff'],
      ballots: ['los-angeles-county'],
      voteFor: 1,
      candidates: [{ name: 'Jane Doe', party: 'Party Preference: None' }],
    },
  ],
}

const raceData: RaceData = {
  lists: [raceList],
  published: { 'il-2026-11-03-general': ['jane-doe'] },
}

const empty = { asOf: '2026-10-05', items: [] }
const profile: CandidateProfile = {
  key: 'jane-doe',
  electionId: 'il-2026-11-03-general',
  name: 'Jane Doe',
  party: 'Democratic',
  office: 'State Senator, 5th District',
  contestIds: ['chicago-boe:state-senator-5th-district', 'cook-clerk:170502'],
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
  afterEach(() => {
    vi.unstubAllEnvs()
    mode.on = false
  })

  it('builds a file for every route, so none of them gets a 404 status', () => {
    const built = new Set([
      ...STATIC_PAGES.map((p) => p.path),
      ...candidatePages(profile, true).map((p) =>
        p.path.replace('jane-doe', ':key'),
      ),
      // /races and every page under it (racePages).
      ...(racePages(raceData).length === 3 ? ['/races/*'] : []),
      '/my-ballot', // a redirect in _redirects
      '/*', // 404.html
    ])
    for (const path of routePaths()) expect(built).toContain(path)
  })

  it('renders a live profile with the app’s own components', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key')
    const [page, report] = candidatePages(profile, true)
    expect(page.file).toBe('candidates/jane-doe.html')
    const html = await renderPage(page)
    expect(html).toContain('>Jane Doe</h1>')
    expect(html).toContain('Jane Doe is a state senator.')
    expect(html).toContain('Senate roster')
    // The email sign-up is part of the page; the banner (device only) isn't.
    expect(html).toContain('Hear from VoteStack before your next election')
    expect(html).not.toContain('Email sign-up')
    // Before the app runs, the form can't be sent: no email in a page URL.
    expect(html).toMatch(/<form[^>]*method="post"/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Sign up<\/button>/)
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
    const pages = racePages(raceData)
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
    // A race page ends with the email sign-up; the area list doesn't.
    expect(html).not.toContain('Hear from VoteStack before your next election')
    expect(await renderPage(pages[2])).toContain(
      'Hear from VoteStack before your next election',
    )
  })

  it('builds every area’s races, promising profiles only where they exist', () => {
    const pages = racePages({ ...raceData, lists: [raceList, laList] })
    expect(pages.map((p) => p.file)).toEqual([
      'races.html',
      'races/il/cook-county/2026-11-03.html',
      'races/il/2026-11-03/state-senator-5th-district.html',
      'races/ca/los-angeles-county/2026-11-03.html',
      'races/ca/los-angeles-county/2026-11-03/sheriff.html',
    ])
    expect(pages[2].head.description).toContain('A profile for each candidate')
    expect(pages[3].head.description).not.toContain('profile')
    expect(pages[4].head.description).toBe(
      'Sheriff on the November 3, 2026 ballot in Los Angeles County, California. Candidates in ballot order: Jane Doe.',
    )
  })

  it('renders the address form for the home page', async () => {
    const home = STATIC_PAGES.find((p) => p.path === '/')!
    const html = await renderPage(home)
    expect(html).toContain('What&#x27;s on your ballot?')
    // Before the app runs, the address can't be sent, and never in the URL.
    expect(html).toMatch(/<form[^>]*method="post"/)
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>Find my ballot<\/button>/,
    )
  })

  describe('after the election', () => {
    const ENDED =
      'Voting ended on Tuesday, November 3, 2026. See official results from the'
    const GET_STARTED_LINE =
      'Voting in the 2026 U.S. midterms has ended. You can still look up what was on your ballot.'
    const getStarted = STATIC_PAGES.find((p) => p.path === '/getstarted')!

    /** The text of the page's "Voting ended" paragraph, links flattened. */
    const endedLine = (html: string) =>
      html.match(/<p[^>]*>(Voting ended.*?)<\/p>/s)?.[1].replace(/<[^>]+>/g, '')

    it('says voting ended on profiles, race pages and the area list', async () => {
      mode.on = true
      const live = await renderPage(candidatePages(profile, true)[0])
      expect(live).toContain(ENDED)
      // The profile's contests are on both Cook ballots.
      expect(endedLine(live)).toBe(
        `${ENDED} Chicago Board of Election Commissioners (Chicago) and the Cook County Clerk (suburban Cook County).`,
      )

      const pages = racePages(raceData)
      const area = await renderPage(pages[1])
      expect(area).toContain(ENDED)
      expect(endedLine(area)).toContain(
        'Chicago Board of Election Commissioners (Chicago) and the Cook County Clerk (suburban Cook County)',
      )
      // Links to the offices' own results pages.
      expect(area).toContain(
        'href="https://chicagoelections.gov/elections/results"',
      )
      expect(await renderPage(pages[2])).toContain(ENDED)
    })

    it('names only the office whose ballot lists the race', async () => {
      mode.on = true
      const chicago = await renderPage(
        candidatePages({ ...profile, contestIds: ['chicago-boe:x'] }, true)[0],
      )
      expect(endedLine(chicago)).toBe(
        `${ENDED} Chicago Board of Election Commissioners.`,
      )
      const clerk = await renderPage(
        candidatePages({ ...profile, contestIds: ['cook-clerk:1'] }, true)[0],
      )
      expect(endedLine(clerk)).toBe(`${ENDED} Cook County Clerk.`)

      const [, , , laArea] = racePages({
        ...raceData,
        lists: [raceList, laList],
      })
      expect(endedLine(await renderPage(laArea))).toBe(
        `${ENDED} Los Angeles County Registrar-Recorder/County Clerk.`,
      )
    })

    it('says on Get started that voting has ended and the lookup still works', async () => {
      mode.on = true
      expect(await renderPage(getStarted)).toContain(GET_STARTED_LINE)
    })

    it('says none of it while the switch is off', async () => {
      const pages = racePages(raceData)
      for (const page of [
        candidatePages(profile, true)[0],
        pages[1],
        pages[2],
        getStarted,
      ]) {
        const html = await renderPage(page)
        expect(html).not.toContain('Voting ended')
        expect(html).not.toContain('has ended')
      }
    })
  })

  it('finds its markers in index.html', () => {
    expect(() =>
      checkTemplate(readFileSync('index.html', 'utf8')),
    ).not.toThrow()
  })
})
