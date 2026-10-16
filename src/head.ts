// Each page's <head>: title, description, canonical address and social
// tags. The build writes them into the prerendered HTML (src/prerender.tsx)
// and useDocumentHead keeps them in step as the app moves between pages, so
// both say the same thing. Every candidate gets the same template.

import { useEffect } from 'react'
import { coveredFullNames, coveredNames } from './ballot/coverage.ts'
import { CURRENT_ELECTION } from './shared/cook.ts'
import type { CandidateProfile } from './shared/profile.ts'
import { COOK, regionForElection, type Region } from './shared/regions.ts'
import {
  RACES_PATH,
  placeName,
  raceName,
  racePath,
  stateName,
  type Race,
  type RaceList,
} from './shared/races.ts'

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
  /** schema.org data for search engines, written as JSON-LD (home page only). */
  structuredData?: object
}

/**
 * Who publishes the site, so search results can show "VoteStack" and its
 * logo instead of the bare domain.
 */
const SITE_STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      name: SITE_NAME,
      url: `${SITE_URL}/`,
      inLanguage: 'en-US',
      publisher: { '@id': `${SITE_URL}/#organization` },
    },
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: `${SITE_URL}/`,
      logo: `${SITE_URL}/brand/votestack-mark-512.png`,
      email: 'nikolai@votestack.org',
      sameAs: ['https://github.com/nikolai-laba/votestack'],
    },
  ],
}

/** "November 3, 2026" (no weekday, so it reads inside a sentence). */
const ELECTION_DAY = new Date(
  `${CURRENT_ELECTION.date}T12:00:00Z`,
).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' })

export const HOME_HEAD: PageHead = {
  title: 'VoteStack: know what and who is on your ballot',
  description: `Enter your address to see every race on your ballot for the ${ELECTION_DAY} General Election in ${coveredFullNames()}. Cook County candidates have detailed profiles covering positions, campaign financing, and endorsements, with cited sources.`,
  path: '/',
  structuredData: SITE_STRUCTURED_DATA,
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
  description: `VoteStack covers ${coveredNames()} for now. Leave your email and ZIP code to hear when it reaches your area.`,
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

/**
 * The office for a profile's title, in the words people search for: the
 * seat's name without its vacancy detail, with the state or county when the
 * office name doesn't say ("State Representative, 1st District, Illinois").
 */
export function profileOffice(office: string, region: Region = COOK): string {
  const short = office.replace(/\s*\((?:Vacancy|Converted) [^)]*\)$/, '')
  const placed = [region.stateName, region.name, 'County', ...region.placeWords]
  if (placed.some((w) => new RegExp(`\\b${w}\\b`).test(short))) return short
  // Statewide offices, Congress, the legislature and the appellate court
  // belong to the state.
  return /^(State |U\.S\. |Appellate |Governor|Lieutenant Governor|Attorney General|Secretary of State|Comptroller|Controller|Treasurer|Insurance Commissioner|Superintendent of Public Instruction|Board of Equalization)/.test(
    short,
  )
    ? `${short}, ${region.stateName}`
    : `${short}, ${region.name}`
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
  const region = regionForElection(profile.electionId) ?? COOK
  const year = region.election.date.slice(0, 4)
  const office = profileOffice(profile.office, region)
  return {
    title:
      profile.kind === 'retention'
        ? `${profile.name}, up for retention as ${office}, ${year} | VoteStack`
        : `${profile.name}, ${year} candidate for ${office} | VoteStack`,
    description: `${profile.name}${party} ${running} on the ${ELECTION_DAY} ballot in ${region.fullName}. Background, campaign money and endorsements, with a source for every fact.`,
    path: `/candidates/${profile.key}`,
  }
}

export const RACES_HEAD: PageHead = {
  title: 'Races on the ballot | VoteStack',
  description: `Every race and every judge up for retention on the ${ELECTION_DAY} ballot in ${coveredFullNames()}, with a profile for each Cook County candidate.`,
  path: RACES_PATH,
}

/**
 * An area's list of races. `withProfiles` is false for an area whose
 * candidates have no profiles yet, so the description doesn't promise them.
 */
export function raceAreaHead(list: RaceList, withProfiles = true): PageHead {
  const profiles = withProfiles ? ', with a profile for each candidate' : ''
  return {
    title: `Races in ${list.area}, ${list.date.slice(0, 4)} | VoteStack`,
    description: `All ${list.races.length} races and judges up for retention on the ${ELECTION_DAY} ballot in ${list.area}, in ballot order${profiles}. Enter your address to see which ones are on your ballot.`,
    path: `${RACES_PATH}/${list.areaPath}`,
  }
}

/** "A, B and C" */
const andList = (items: string[]) =>
  items.length > 1
    ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
    : (items[0] ?? '')

/**
 * The same title and description for every race, filled from the ballot.
 * `withProfiles` is false in an area whose candidates have no profiles yet.
 */
export function raceHead(race: Race, withProfiles = true): PageHead {
  const place = placeName(race.districtId)
  const state = stateName(race.districtId)
  const where = place === state ? place : `${place}, ${state}`
  const year = race.path.match(/\/(\d{4})-\d\d-\d\d\//)?.[1] ?? ''
  if (race.kind === 'retention') {
    return {
      title: `${raceName(race)} (${place}), ${year} | VoteStack`,
      description: `${race.judge} is up for retention as ${race.title} on the ${ELECTION_DAY} ballot in ${where}. Voters choose yes or no on keeping the judge in office.${withProfiles ? ' A profile with a source for every fact.' : ''}`,
      path: racePath(race),
    }
  }
  const names = (race.candidates ?? []).map((c) => c.name)
  const running = names.length
    ? `Candidates in ballot order: ${andList(names)}.`
    : 'No candidates filed for this race.'
  return {
    title: `${race.title} (${place}): ${year} candidates | VoteStack`,
    description: `${race.title} on the ${ELECTION_DAY} ballot in ${where}. ${running}${withProfiles ? ' A profile for each candidate, with a source for every fact.' : ''}`,
    path: racePath(race),
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
  if (head.structuredData) {
    // `<` escaped so no text can end the script tag.
    const json = JSON.stringify(head.structuredData).replace(/</g, '\\u003c')
    lines.push(`<script type="application/ld+json">${json}</script>`)
  }
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
