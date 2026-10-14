// Writes the site's pages as HTML files after `vite build`: each page's
// head, the content of public pages (rendered by the app's own components,
// src/prerender.tsx, built with `vite build --ssr` into dist-ssr/), plus
// robots.txt, sitemap.xml and the 404 page. Cloudflare serves /about from
// about.html and /candidates/{key} from candidates/{key}.html, and any
// address without a file gets 404.html with a 404 status.
//
// Candidate pages are built only for profiles in the committed published
// list (content/profiles/published/), which `profiles:publish` writes.
//
// Run: node scripts/prerender.ts (part of npm run build)

import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { CandidateProfile } from '../src/shared/profile.ts'
import type { RaceList } from '../src/shared/races.ts'
import { ROOT, readJson } from './lib/data.ts'
import { PROFILES_DIR, readProfiles } from './lib/profiles/content.ts'
import {
  PUBLISHED_LIST,
  checkTemplate,
  fillTemplate,
  modulePreloads,
  publishedCandidates,
  robotsTxt,
  sitemapXml,
  type PublishedList,
  type ViteManifest,
} from './lib/prerender.ts'

/** The race lists, as src/races/data.ts loads them. */
interface RaceData {
  lists: RaceList[]
  published: Record<string, string[]>
}

/** What src/prerender.tsx exports, as far as this script uses it. */
interface Page {
  path: string
  file: string
  head: { noindex?: boolean }
  render?: string
  data?: { page: 'profile' | 'about' | 'notify' | 'races' }
}
interface Ssr {
  SITE_URL: string
  STATIC_PAGES: Page[]
  candidatePages(profile: CandidateProfile, live: boolean): Page[]
  racePages(data: RaceData): Page[]
  raceData(): Promise<RaceData>
  renderPage(page: Page): Promise<string>
  headHtml(head: Page['head']): string
  prerenderData(data: NonNullable<Page['data']>): string
}

const DIST = join(ROOT, 'dist')
const SSR_DIR = join(ROOT, 'dist-ssr')
const MANIFEST = join(DIST, '.vite', 'manifest.json')

/** The on-demand page each kind of prerendered page loads first. */
const PAGE_MODULES: Record<NonNullable<Page['data']>['page'], string> = {
  profile: 'src/pages/ProfilePage.tsx',
  about: 'src/pages/AboutPage.tsx',
  notify: 'src/pages/NotifyPage.tsx',
  races: 'src/pages/RacesPage.tsx',
}

/**
 * The race lists' and published lists' chunks, which race pages and
 * profiles load first (src/races/data.ts loads every file in these folders).
 */
const RACE_DATA = (
  await Promise.all(
    ['content/contests', 'content/profiles/published'].map(async (dir) =>
      (await readdir(join(ROOT, dir), { recursive: true }))
        .filter((f) => f.endsWith('.json'))
        .map((f) => relative(ROOT, join(ROOT, dir, f))),
    ),
  )
)
  .flat()
  .sort()

const ssr = (await import(
  pathToFileURL(join(SSR_DIR, 'prerender.js')).href
)) as Ssr
const template = await readFile(join(DIST, 'index.html'), 'utf8')
checkTemplate(template)
const manifest = await readJson<ViteManifest>(MANIFEST)

let candidates: { profile: CandidateProfile; live: boolean }[] = []
if (existsSync(PUBLISHED_LIST)) {
  const list = await readJson<PublishedList>(PUBLISHED_LIST)
  const result = publishedCandidates(list, await readProfiles(PROFILES_DIR))
  candidates = result.entries
  if (result.missing.length)
    console.warn(
      `Published but no profile file (no page built): ${result.missing.join(', ')}`,
    )
  if (result.stale.length)
    console.warn(
      `Profile file differs from the published version (head only; run profiles:publish): ${result.stale.join(', ')}`,
    )
} else {
  console.warn('No published list; building no candidate pages')
}

const races = await ssr.raceData()
const raceCount = races.lists.reduce((n, l) => n + l.races.length, 0)
const pages = [
  ...ssr.STATIC_PAGES,
  ...candidates.flatMap((c) => ssr.candidatePages(c.profile, c.live)),
  ...ssr.racePages(races),
]
for (const page of pages) {
  const html = fillTemplate(template, {
    head: ssr.headHtml(page.head),
    extraHead: page.data
      ? [
          ...modulePreloads(manifest, PAGE_MODULES[page.data.page]),
          ...(page.data.page === 'profile' || page.data.page === 'races'
            ? RACE_DATA.flatMap((src) => modulePreloads(manifest, src))
            : []),
        ].join('\n    ')
      : undefined,
    body: await ssr.renderPage(page),
    data: page.data && ssr.prerenderData(page.data),
  })
  const out = join(DIST, page.file)
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, html)
}

const indexed = new Map(candidates.map((c) => [c.profile.key, c.profile]))
const sitemap = pages
  .filter((p) => !p.head.noindex && p.path !== '/getstarted')
  .map((p) => ({
    path: p.path,
    lastmod: indexed.get(p.path.replace('/candidates/', ''))?.meta.generatedAt,
  }))
await writeFile(join(DIST, 'sitemap.xml'), sitemapXml(ssr.SITE_URL, sitemap))
await writeFile(join(DIST, 'robots.txt'), robotsTxt(ssr.SITE_URL))
// Earlier address of Saved choices.
await writeFile(join(DIST, '_redirects'), '/my-ballot /saved-choices 301\n')

// Neither belongs on the site.
await rm(SSR_DIR, { recursive: true, force: true })
await rm(join(DIST, '.vite'), { recursive: true, force: true })

console.log(
  `Prerendered ${pages.length} pages (${candidates.length} candidates, ${raceCount} races in ${races.lists.length} areas); sitemap lists ${sitemap.length}`,
)
