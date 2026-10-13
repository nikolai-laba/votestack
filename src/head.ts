// Each page's <head>: title, description, canonical address and social
// tags. The build writes them into the prerendered HTML (src/prerender.tsx)
// and useDocumentHead keeps them in step as the app moves between pages, so
// both say the same thing. Every candidate gets the same template.

import { useEffect } from 'react'
import { CURRENT_ELECTION } from './shared/cook.ts'
import type { CandidateProfile } from './shared/profile.ts'

/** The one address search engines and shared links should use. */
export const SITE_URL = 'https://votestack.org'
const SITE_NAME = 'VoteStack'
/** One shared image for link previews (1200×630). */
export const SHARE_IMAGE = '/brand/votestack-share.png'

export interface PageHead {
  title: string
  description?: string
  /** The page's canonical path; omitted on pages that shouldn't be indexed. */
  path?: string
  /** Keep the page out of search results (forms, device-only pages, 404s). */
  noindex?: boolean
}

/** "November 3, 2026" (no weekday, so it reads inside a sentence). */
const ELECTION_DAY = new Date(
  `${CURRENT_ELECTION.date}T12:00:00Z`,
).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' })

export const HOME_HEAD: PageHead = {
  title: 'VoteStack: know what and who is on your ballot',
  description: `Enter your address to see every race and detailed candidate profiles covering positions, campaign financing, and endorsements, with cited sources. Starting with the ${ELECTION_DAY} General Election in Chicago and Cook County.`,
  path: '/',
}

export const ABOUT_HEAD: PageHead = {
  title: 'About VoteStack | VoteStack',
  description:
    'Who makes VoteStack, how it is paid for, where its ballot data comes from and how it keeps your address private.',
  path: '/about',
}

export const HOW_PROFILES_HEAD: PageHead = {
  title: 'How we make profiles | VoteStack',
  description:
    'How VoteStack researches candidate profiles: the sources, the AI models, the checks every profile must pass, and their limits.',
  path: '/how-profiles-are-made',
}

export const NOTIFY_HEAD: PageHead = {
  title: 'Get an email when VoteStack covers your area | VoteStack',
  description:
    'VoteStack covers Chicago and Cook County for now. Leave your email and ZIP code to hear when it reaches your area.',
  path: '/notify',
}

export const SAVED_CHOICES_HEAD: PageHead = {
  title: 'Saved choices | VoteStack',
  noindex: true,
}

export const NOT_FOUND_HEAD: PageHead = {
  title: 'Page not found | VoteStack',
  noindex: true,
}

export const MISSING_PROFILE_HEAD: PageHead = {
  title: 'No profile yet | VoteStack',
  noindex: true,
}

/** The same title and description for every candidate, filled from the ballot. */
export function profileHead(profile: CandidateProfile): PageHead {
  if (profile.sample) {
    return {
      title: `Sample profile of ${profile.name} | VoteStack`,
      noindex: true,
    }
  }
  const running =
    profile.kind === 'retention'
      ? `is up for retention as ${profile.office}`
      : `is running for ${profile.office}`
  const party = profile.party ? ` (${profile.party})` : ''
  return {
    title: `${profile.name}, candidate profile | VoteStack`,
    description: `${profile.name}${party} ${running} on the ${ELECTION_DAY} ballot in Cook County, Illinois. Background, campaign money and endorsements, with a source for every fact.`,
    path: `/candidates/${profile.key}`,
  }
}

export function reportHead(name: string | undefined): PageHead {
  return {
    title: name
      ? `Report an error in ${name}’s profile | VoteStack`
      : 'Report an error | VoteStack',
    noindex: true,
  }
}

export const absoluteUrl = (path: string) => `${SITE_URL}${path}`

/** A head tag useDocumentHead manages: `<meta name="description" content="…">`. */
interface HeadTag {
  element: 'meta' | 'link'
  /** The attribute that names the tag, and its value. */
  key: 'name' | 'property' | 'rel'
  name: string
  /** The attribute that carries the page's value. */
  attr: 'content' | 'href'
  /** null: the page has no such tag. */
  value: string | null
}

function headTags(head: PageHead): HeadTag[] {
  const url = head.path ? absoluteUrl(head.path) : null
  const description = head.description ?? null
  const meta = (key: 'name' | 'property', name: string, value: string | null) =>
    ({ element: 'meta', key, name, attr: 'content', value }) as const
  return [
    meta('name', 'description', description),
    meta('name', 'robots', head.noindex ? 'noindex' : null),
    {
      element: 'link',
      key: 'rel',
      name: 'canonical',
      attr: 'href',
      value: url,
    },
    meta('property', 'og:title', head.title),
    meta('property', 'og:description', description),
    meta('property', 'og:url', url),
  ]
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

/** The head as HTML, for the prerendered pages. */
export function headHtml(head: PageHead): string {
  const lines = [`<title>${escapeHtml(head.title)}</title>`]
  for (const t of headTags(head))
    if (t.value !== null)
      lines.push(
        `<${t.element} ${t.key}="${t.name}" ${t.attr}="${escapeHtml(t.value)}" />`,
      )
  lines.push(
    '<meta property="og:type" content="website" />',
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:image" content="${absoluteUrl(SHARE_IMAGE)}" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    '<meta property="og:image:alt" content="VoteStack" />',
    '<meta name="twitter:card" content="summary_large_image" />',
  )
  return lines.join('\n    ')
}

/** Gives a tag `value`, adding or removing the element as needed. */
function setTag(t: HeadTag, value: string | null) {
  const selector = `${t.element}[${t.key}="${t.name}"]`
  let el = document.head.querySelector(selector)
  if (value === null) {
    el?.remove()
    return
  }
  if (!el) {
    el = document.createElement(t.element)
    el.setAttribute(t.key, t.name)
    document.head.append(el)
  }
  el.setAttribute(t.attr, value)
}

/**
 * Sets the title and head tags outright. The app starts from the home
 * page's (main.tsx), whatever page was prerendered, so a page that closes
 * hands back the home page's head rather than its own prerendered one.
 */
export function applyHead(head: PageHead) {
  document.title = head.title
  for (const t of headTags(head)) setTag(t, t.value)
}

/**
 * Sets the page's title and head tags while it's shown, and puts the
 * previous ones back when it goes, so a page that opens over another (a
 * profile over the ballot) hands them back when it closes. null leaves the
 * head alone (a profile that hasn't loaded yet).
 */
export function useDocumentHead(head: PageHead | null) {
  const { title, description, path, noindex } = head ?? {}
  useEffect(() => {
    if (title === undefined) return
    const previousTitle = document.title
    const tags = headTags({ title, description, path, noindex })
    const previous = tags.map(
      (t) =>
        document.head
          .querySelector(`${t.element}[${t.key}="${t.name}"]`)
          ?.getAttribute(t.attr) ?? null,
    )
    document.title = title
    for (const t of tags) setTag(t, t.value)
    return () => {
      document.title = previousTitle
      tags.forEach((t, i) => setTag(t, previous[i]))
    }
  }, [title, description, path, noindex])
}
