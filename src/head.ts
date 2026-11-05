// Each page's <head>: title, description, canonical address and social
// tags. The build writes them into the prerendered HTML (src/prerender.tsx)
// and useDocumentHead keeps them in step as the app moves between pages, so
// both say the same thing. Every candidate gets the same template.

import { useEffect } from 'react'
import { coveredFullNames } from './ballot/coverage.ts'
import { andList, longDate } from './format.ts'
import { CURRENT_ELECTION } from './shared/cook.ts'
import type { CandidateProfile } from './shared/profile.ts'
import {
  personOutcome,
  resultView,
  shareText,
  type RaceResult,
} from './shared/raceResults.ts'
import {
  COOK,
  electionDate,
  resultRegion,
  type Region,
} from './shared/regions.ts'
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
      legalName: 'VoteStack, LLC',
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

/** "66.0%", or "under 0.1%" inside a sentence. */
const inSentence = (text: string) =>
  text.replace(/^(Under|Over)/, (w) => w.toLowerCase())

/** "(60% needed)", "(a majority needed)", "(two-thirds needed)"; nothing without a threshold. */
function neededText(threshold: number | undefined): string {
  if (threshold === undefined) return ''
  if (threshold === 0.5) return ' (a majority needed)'
  if (Math.abs(threshold - 2 / 3) < 1e-9) return ' (two-thirds needed)'
  return ` (${Math.round(threshold * 1000) / 10}% needed)`
}

/** A race that has been called or certified, with winners named. */
const isDecided = (result: RaceResult) =>
  result.status === 'called' || result.status === 'certified'

const NOT_CALLED = "The race hasn't been called yet."

export const HOME_HEAD: PageHead = {
  title: 'VoteStack: know what and who is on your ballot',
  description: `Enter your address to see every race on your ballot for the ${ELECTION_DAY} General Election in ${coveredFullNames()}. Every candidate has a profile covering positions, campaign financing, and endorsements, with cited sources.`,
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

export const SUPPORT_HEAD: PageHead = {
  title: 'Support VoteStack | VoteStack',
  description:
    'VoteStack is free, with no ads. Pay what you think it is worth, see what the money pays for and which money VoteStack refuses.',
  path: '/support',
}

export const PRESS_HEAD: PageHead = {
  title: 'Press & media | VoteStack',
  description:
    'Press kit for VoteStack: fact sheet, reporter FAQ, ready-to-use blurbs, logos and contact for interviews.',
  path: '/press',
}

export const NOTIFY_HEAD: PageHead = {
  title: 'Email updates | VoteStack',
  description:
    'Get an email a few times a year about new elections and areas VoteStack covers. Leave your email address and ZIP code.',
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

/**
 * The court a judge sits on, in the words people search for: "Court of
 * Appeal", "Cook County Circuit Court". Undefined for any other office.
 */
export function courtName(
  office: string,
  region: Region = COOK,
): string | undefined {
  if (/Supreme Court/.test(office)) return `${region.stateName} Supreme Court`
  if (/Court of Appeal\b/.test(office)) return 'Court of Appeal'
  if (/Appellate Court/.test(office))
    return `${region.stateName} Appellate Court`
  if (/Circuit Court/.test(office)) return `${region.name} Circuit Court`
  if (/Superior Court/.test(office)) return `${region.name} Superior Court`
  return undefined
}

/**
 * A profile's description after the election: the person's result first,
 * then what the profile holds. An uncalled race carries no numbers, because
 * search engines can show a snippet days after reading it.
 */
function profileResultSentence(
  profile: CandidateProfile,
  result: RaceResult,
): string {
  const region = resultRegion(profile.electionId)
  // "Tuesday, November 3, 2026": the day of the profile's own election.
  const day = longDate(electionDate(profile.electionId))
  const office =
    profile.kind === 'candidate' || !courtName(profile.office, region)
      ? profileOffice(profile.office, region)
      : profile.office
  const { outcome, share, winners } = personOutcome(result, profile.name)
  const pct =
    share === undefined ? '' : inSentence(shareText(share, result.threshold))
  const party = profile.party ? ` (${profile.party})` : ''
  const lead = `${profile.name}${party}`
  const suffix =
    ' Background, campaign money and endorsements, with a source for every fact.'
  let sentence: string
  if (result.kind !== 'candidate' || profile.kind === 'retention') {
    const decided = outcome === 'retained' || outcome === 'not_retained'
    sentence = decided
      ? `${profile.name} was ${outcome === 'retained' ? 'retained' : 'not retained'} as ${profile.office} on ${day}, with ${pct} yes${neededText(result.threshold)}.`
      : `${profile.name} was up for retention as ${profile.office} on ${day}. ${NOT_CALLED}`
  } else if (outcome === 'won') {
    sentence = `${lead} won the race for ${office}, on ${day}, with ${pct} of the vote, as called by AP.`
  } else if (outcome === 'elected') {
    sentence = `${lead} was elected ${office}, on ${day}, with ${pct} of the vote.`
  } else if (outcome === 'not_elected') {
    const verdict =
      winners.length === 0
        ? ''
        : result.status === 'certified'
          ? ` ${andList(winners)} ${winners.length > 1 ? 'were' : 'was'} elected.`
          : ` ${andList(winners)} won.`
    sentence = `${lead} ran for ${office}, on ${day}, and received ${pct} of the vote.${verdict}`
  } else {
    sentence = `${lead} ran for ${office}, on ${day}. ${NOT_CALLED}`
  }
  return sentence + suffix
}

/** The same title and description for every candidate, filled from the ballot. */
export function profileHead(
  profile: CandidateProfile,
  result?: RaceResult,
): PageHead {
  if (profile.sample) {
    return {
      title: `Sample profile of ${profile.name} | VoteStack`,
      noindex: true,
    }
  }
  // The profile's own election, current or past.
  const region = resultRegion(profile.electionId)
  const year = electionDate(profile.electionId).slice(0, 4)
  // Judges lead with "judge" and their court, the words people search for.
  // Most have no party on the ballot, and searches ask which party they
  // belong to, so the description answers that instead.
  const court =
    profile.kind === 'candidate' ? undefined : courtName(profile.office, region)
  if (court) {
    const role =
      profile.kind === 'retention'
        ? 'judge up for retention'
        : 'candidate for judge'
    const who = profile.kind === 'retention' ? 'this judge' : 'this candidate'
    if (result)
      return {
        title: `${profile.name}, ${role} in ${year} (${court}): results | VoteStack`,
        description: profileResultSentence(profile, result),
        path: `/candidates/${profile.key}`,
      }
    const running =
      profile.kind === 'retention'
        ? `is up for retention as ${profile.office}`
        : `is running for ${profile.office}`
    return {
      title: `${profile.name}, ${role} in ${year} (${court}) | VoteStack`,
      description: profile.party
        ? `${profile.name} (${profile.party}) ${running} on the ${ELECTION_DAY} ballot in ${region.fullName}. Background, campaign money and endorsements, with a source for every fact.`
        : `${profile.name}, ${role} on ${ELECTION_DAY}. No party on the ballot: see which parties and groups endorse or oppose ${who}, with sources.`,
      path: `/candidates/${profile.key}`,
    }
  }
  const running =
    profile.kind === 'retention'
      ? `is up for retention as ${profile.office}`
      : `is running for ${profile.office}`
  const party = profile.party ? ` (${profile.party})` : ''
  const office = profileOffice(profile.office, region)
  if (result)
    return {
      title:
        profile.kind === 'retention'
          ? `${profile.name}, up for retention as ${office}, ${year}: results | VoteStack`
          : `${profile.name}, ${year} candidate for ${office}: results | VoteStack`,
      description: profileResultSentence(profile, result),
      path: `/candidates/${profile.key}`,
    }
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
  description: `Every race and every judge up for retention on the ${ELECTION_DAY} ballot in ${coveredFullNames()}, with a profile for each candidate.`,
  path: RACES_PATH,
}

/**
 * An area's list of races. `withProfiles` is false for an area whose
 * candidates have no profiles yet, so the description doesn't promise them.
 */
export function raceAreaHead(
  list: RaceList,
  withProfiles = true,
  withResults = false,
): PageHead {
  const profiles = withProfiles ? ', with a profile for each candidate' : ''
  if (withResults)
    return {
      title: `Races in ${list.area}, ${list.date.slice(0, 4)}: results | VoteStack`,
      description: `Results for all ${list.races.length} races and judges up for retention on the ${longDate(list.date)} ballot in ${list.area}, as they're called and certified${profiles}.`,
      path: `${RACES_PATH}/${list.areaPath}`,
    }
  return {
    title: `Races in ${list.area}, ${list.date.slice(0, 4)} | VoteStack`,
    description: `All ${list.races.length} races and judges up for retention on the ${ELECTION_DAY} ballot in ${list.area}, in ballot order${profiles}. Enter your address to see which ones are on your ballot.`,
    path: `${RACES_PATH}/${list.areaPath}`,
  }
}

/** What a race page's description says the result is (ends with its full stop). */
function raceResultSentence(race: Race, result: RaceResult): string {
  const view = resultView(result)
  if (!isDecided(result)) return `the race hasn't been called yet.`
  if (race.kind === 'retention') {
    const yes = view.choices.find((c) => c.name === 'Yes')
    const kept = view.winners.includes('Yes')
    const pct = yes ? inSentence(shareText(yes.share, result.threshold)) : ''
    return `${kept ? 'retained' : 'not retained'} with ${pct} yes${neededText(result.threshold)}.`
  }
  const names = view.winners
  if (names.length === 0) return `the race hasn't been called yet.`
  const certified = result.status === 'certified'
  if (names.length > 1 || (result.voteFor ?? 1) > 1)
    return certified
      ? `${andList(names)} ${names.length > 1 ? 'were' : 'was'} elected.`
      : `${andList(names)} won, as called by AP.`
  const share = view.choices.find((c) => c.name === names[0])?.share
  const pct = share === undefined ? '' : inSentence(shareText(share))
  return certified
    ? `${names[0]} was elected with ${pct}.`
    : `${names[0]} won with ${pct}, as called by AP.`
}

/**
 * The same title and description for every race, filled from the ballot.
 * `withProfiles` is false in an area whose candidates have no profiles yet.
 */
export function raceHead(
  race: Race,
  withProfiles = true,
  result?: RaceResult,
): PageHead {
  const place = placeName(race.districtId)
  const state = stateName(race.districtId)
  const where = place === state ? place : `${place}, ${state}`
  // The race's own election day, from its address ("…/2026-11-03/…").
  const date = race.path.match(/\/(\d{4}-\d\d-\d\d)\//)?.[1]
  const year = date?.slice(0, 4) ?? ''
  if (result) {
    const title = `${race.kind === 'retention' ? raceName(race) : race.title} (${place}): ${year} results | VoteStack`
    const profiles = withProfiles
      ? race.kind === 'retention'
        ? ' A profile with a source for every fact.'
        : ' A profile for each candidate, with a source for every fact.'
      : ''
    const what =
      race.kind === 'retention'
        ? `retention of ${race.judge} as ${race.title}`
        : race.title
    return {
      title,
      description: `Results for ${what} on the ${date ? longDate(date) : ELECTION_DAY} ballot in ${where}: ${raceResultSentence(race, result)}${profiles}`,
      path: racePath(race),
    }
  }
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
