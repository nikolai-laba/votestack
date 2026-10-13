import { describe, expect, it } from 'vitest'
import type { CandidateProfile } from '../../src/shared/profile.ts'
import {
  checkTemplate,
  fillTemplate,
  modulePreloads,
  publishedCandidates,
  robotsTxt,
  sitemapXml,
} from './prerender.ts'
import { contentHash } from './profiles/content.ts'

const TEMPLATE = `<head>
    <!-- head: tags -->
    <title>VoteStack</title>
    <!-- /head -->
  </head>
  <body><div id="root"></div></body>`

const person = (key: string) => ({ key, name: key }) as CandidateProfile

describe('fillTemplate', () => {
  it('replaces the head and fills #root', () => {
    const html = fillTemplate(TEMPLATE, {
      head: '<title>About</title>',
      extraHead: '<link rel="modulepreload" href="/a.js" />',
      body: '<h1>$& About</h1>',
      data: '<script id="d"></script>',
    })
    expect(html).not.toContain('<title>VoteStack</title>')
    expect(html).toContain(
      '<title>About</title>\n    <link rel="modulepreload" href="/a.js" />',
    )
    // Replacement patterns like $& are kept as text.
    expect(html).toContain(
      '<div id="root"><h1>$& About</h1></div><script id="d"></script>',
    )
  })

  it('stops when the template loses a marker', () => {
    expect(() => checkTemplate(TEMPLATE)).not.toThrow()
    expect(() => checkTemplate('<div id="root"></div>')).toThrow(/head/)
    expect(() => checkTemplate(TEMPLATE.replace('root', 'app'))).toThrow(/root/)
  })
})

describe('publishedCandidates', () => {
  it('builds published profiles, holding back changed and missing ones', () => {
    const a = person('a')
    const b = person('b')
    const profiles = new Map([
      ['a', a],
      ['b', b],
      ['unpublished', person('unpublished')],
    ])
    const result = publishedCandidates(
      {
        electionId: 'e',
        profiles: { b: 'old hash', a: contentHash(a), gone: 'x' },
      },
      profiles,
    )
    expect(result.entries).toEqual([
      { profile: a, live: true },
      { profile: b, live: false },
    ])
    expect(result.stale).toEqual(['b'])
    expect(result.missing).toEqual(['gone'])
  })
})

describe('robots and sitemap', () => {
  it('allows everything and points to the sitemap', () => {
    expect(robotsTxt('https://votestack.org')).toBe(
      'User-agent: *\nAllow: /\n\nSitemap: https://votestack.org/sitemap.xml\n',
    )
  })

  it('lists pages with their dates', () => {
    const xml = sitemapXml('https://votestack.org', [
      { path: '/' },
      { path: '/candidates/a', lastmod: '2026-10-07T20:43:33.971Z' },
    ])
    expect(xml).toContain('<url><loc>https://votestack.org/</loc></url>')
    expect(xml).toContain(
      '<url><loc>https://votestack.org/candidates/a</loc><lastmod>2026-10-07</lastmod></url>',
    )
  })
})

describe('modulePreloads', () => {
  const manifest = {
    'index.html': { file: 'assets/index.js', isEntry: true, imports: ['_x'] },
    _x: { file: 'assets/x.js' },
    _y: { file: 'assets/y.js' },
    'src/pages/ProfilePage.tsx': {
      file: 'assets/ProfilePage.js',
      imports: ['_x', '_y'],
    },
  }

  it('lists the page’s chunks that the entry doesn’t already load', () => {
    expect(modulePreloads(manifest, 'src/pages/ProfilePage.tsx')).toEqual([
      '<link rel="modulepreload" href="/assets/ProfilePage.js" />',
      '<link rel="modulepreload" href="/assets/y.js" />',
    ])
  })

  it('stops when the page is missing from the build', () => {
    expect(() => modulePreloads(manifest, 'src/pages/Nope.tsx')).toThrow()
  })
})
