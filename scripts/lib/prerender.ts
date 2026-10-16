// The pieces of the build's prerender step (scripts/prerender.ts) that
// don't touch the file system: filling the page template, which profiles
// are live, robots.txt and the sitemap.

import { join } from 'node:path'
import type { Region } from '../../src/shared/regions.ts'
import type { CandidateProfile } from '../../src/shared/profile.ts'
import { contentHash } from './profiles/content.ts'
import { folderFor } from './profiles/region.ts'
import { ROOT } from './data.ts'

/**
 * The profiles live in Supabase, as `profiles:publish` last saw them: key →
 * content hash. Committed, so the build knows what's published without
 * reading the database.
 */
export interface PublishedList {
  electionId: string
  profiles: Record<string, string>
}

export const publishedListFor = (region: Region) =>
  join(
    folderFor(join(ROOT, 'content', 'profiles', 'published'), region),
    `${region.election.date}.json`,
  )

const HEAD = /<!-- head:[^>]*-->[\s\S]*<!-- \/head -->/
const ROOT_DIV = '<div id="root"></div>'

/** Fails early if index.html loses the places the prerender fills. */
export function checkTemplate(template: string): void {
  if (!HEAD.test(template)) throw new Error('index.html has no head markers')
  if (!template.includes(ROOT_DIV)) throw new Error('index.html has no #root')
}

/** The built index.html with a page's head, content and extras filled in. */
export function fillTemplate(
  template: string,
  page: { head: string; body: string; extraHead?: string; data?: string },
): string {
  const head = [page.head, page.extraHead].filter(Boolean).join('\n    ')
  return template
    .replace(HEAD, () => head)
    .replace(
      ROOT_DIV,
      () => `<div id="root">${page.body}</div>${page.data ?? ''}`,
    )
}

export interface CandidateEntry {
  profile: CandidateProfile
  /** The file is the version that's published. */
  live: boolean
}

/**
 * The published profiles to build pages for. A key without a file is left
 * out (and reported); a file that differs from the published version is
 * built without its content, so unchecked text never goes out.
 */
export function publishedCandidates(
  list: PublishedList,
  profiles: Map<string, CandidateProfile>,
): { entries: CandidateEntry[]; missing: string[]; stale: string[] } {
  const entries: CandidateEntry[] = []
  const missing: string[] = []
  const stale: string[] = []
  for (const [key, hash] of Object.entries(list.profiles).sort()) {
    const profile = profiles.get(key)
    if (!profile) {
      missing.push(key)
      continue
    }
    const live = contentHash(profile) === hash
    if (!live) stale.push(key)
    entries.push({ profile, live })
  }
  return { entries, missing, stale }
}

export function robotsTxt(siteUrl: string): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`
}

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** A sitemap of the given pages; `lastmod` is a date or timestamp. */
export function sitemapXml(
  siteUrl: string,
  pages: { path: string; lastmod?: string }[],
): string {
  const urls = pages.map(({ path, lastmod }) => {
    const mod = lastmod ? `<lastmod>${lastmod.slice(0, 10)}</lastmod>` : ''
    return `  <url><loc>${escapeXml(siteUrl + path)}</loc>${mod}</url>`
  })
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n')
}

/** Vite's build manifest, as far as the prerender reads it. */
export type ViteManifest = Record<
  string,
  { file: string; imports?: string[]; isEntry?: boolean }
>

/**
 * `<link rel="modulepreload">` tags for a source module's chunk and the
 * chunks it imports, so the browser fetches them alongside the app's entry.
 * The entry's own chunks are already in the page and are left out.
 */
export function modulePreloads(manifest: ViteManifest, src: string): string[] {
  const entryChunks = new Set<string>()
  const walk = (key: string, into: Set<string>) => {
    const chunk = manifest[key]
    if (!chunk || into.has(key)) return
    into.add(key)
    for (const imported of chunk.imports ?? []) walk(imported, into)
  }
  for (const [key, chunk] of Object.entries(manifest))
    if (chunk.isEntry) walk(key, entryChunks)
  const own = new Set<string>()
  walk(src, own)
  if (!own.size) throw new Error(`${src} isn't in the build manifest`)
  return [...own]
    .filter((key) => !entryChunks.has(key))
    .map((key) => `<link rel="modulepreload" href="/${manifest[key].file}" />`)
}
