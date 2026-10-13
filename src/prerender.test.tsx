import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { checkTemplate } from '../scripts/lib/prerender.ts'
import { candidatePages, renderPage, STATIC_PAGES } from './prerender.tsx'
import { routes } from './routes.tsx'
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
    expect(page.head.title).toBe('Jane Doe, candidate profile | VoteStack')
    expect(page.data).toBeUndefined()
    expect(await renderPage(page)).toBe('')
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
