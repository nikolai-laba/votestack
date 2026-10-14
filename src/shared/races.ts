// Races as public pages: every candidate race and judge up for retention in
// an election, each once, whichever ballots list it. The export script
// (scripts/export-contests.ts) builds the list from the official contest
// lists and commits it to content/contests/, so the site can build race
// pages without the database. Referenda aren't included: which ones a voter
// sees depends on the exact address. Sources are on the About page, as for
// the ballot.
//
// A race's address follows the government that holds the office, not where
// the voter lives: /races/{state}/{locality?}/{election date}/{race}, e.g.
// /races/il/2026-11-03/state-representative-1st-district or
// /races/il/cook-county/2026-11-03/county-commissioner-5th-district. The
// date tells elections apart (a year can hold a primary and a general).

import type { Candidate, OcdId } from './ballot.ts'

/** The ballots that list a race in Cook County. */
export type BallotArea = 'chicago' | 'suburban-cook'

/** Levels of government, in the order the ballot groups them (src/ballot/sections.ts). */
export const RACE_LEVELS = [
  'federal',
  'state',
  'county',
  'judges',
  'local',
  'retention',
] as const
export type RaceLevel = (typeof RACE_LEVELS)[number]

export interface Race {
  /** The part of the address after /races/, e.g. `il/cook-county/2026-11-03/board-president`. */
  path: string
  kind: 'candidate' | 'retention'
  level: RaceLevel
  /** Heading as shown to voters, e.g. "State Representative, 1st District". */
  title: string
  office: string
  /** The district whose voters see this race. */
  districtId: OcdId
  /** The same race's contest id on each ballot that lists it. */
  contestIds: string[]
  ballots: BallotArea[]
  /** How many candidates a voter may choose (candidate races). */
  voteFor?: number
  /** Names the seat when several are elected separately, e.g. "Vacancy of Smith". */
  vacancy?: string
  /** The judge up for retention (retention races). */
  judge?: string
  /** In ballot order (candidate races). */
  candidates?: Candidate[]
}

/** content/contests/{election date}.json */
export interface RaceList {
  electionId: string
  electionName: string
  date: string
  /** Where the races appear, e.g. "Cook County, Illinois". */
  area: string
  /** The address of the area's list: `il/cook-county/2026-11-03`. */
  areaPath: string
  races: Race[]
}

export const RACES_PATH = '/races'
export const racePath = (race: Pick<Race, 'path'>) =>
  `${RACES_PATH}/${race.path}`

const slug = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’"“”.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** "ocd-division/country:us/state:il/…" → "il". */
export function stateCode(districtId: OcdId): string {
  const state = /\/state:([a-z]{2})\b/.exec(districtId)?.[1]
  if (!state) throw new Error(`No state in ${districtId}`)
  return state
}

/**
 * The county or city that holds the office, as an address part, or
 * undefined for a state or federal office. Districts drawn by the state
 * (Congress, the legislature, appellate courts) belong to the state even
 * when they lie inside one county.
 */
export function localitySlug(districtId: OcdId): string | undefined {
  const place = /\/place:([a-z0-9_]+)/.exec(districtId)?.[1]
  if (place) return slug(place)
  const county = /\/county:([a-z0-9_]+)/.exec(districtId)?.[1]
  if (county) return `${slug(county)}-county`
  // The Water Reclamation District covers most of Cook County and is
  // elected there.
  if (/\/sewer:mwrd\b/.test(districtId)) return 'cook-county'
  return undefined
}

/** The race's part of its address, from its title. */
export function raceSlug(title: string, judge?: string): string {
  return judge ? `retention-${slug(judge)}` : slug(title)
}

/** A race's path after /races/: state, locality (if any), date, race. */
export function buildRacePath(
  districtId: OcdId,
  date: string,
  title: string,
  judge?: string,
): string {
  return [
    stateCode(districtId),
    localitySlug(districtId),
    date,
    raceSlug(title, judge),
  ]
    .filter(Boolean)
    .join('/')
}

const ordinal = (n: string) => {
  const num = Number(n)
  if (!Number.isInteger(num)) return n.toUpperCase()
  const tens = num % 100
  const suffix =
    tens >= 11 && tens <= 13
      ? 'th'
      : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[num % 10] ??
        'th')
  return `${num}${suffix}`
}

/** Names that title case gets wrong. */
const PROPER: Record<string, string> = { dupage: 'DuPage' }

const titleCase = (s: string) =>
  s
    .split(/[_-]/)
    .map((w) => PROPER[w] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

/** Where the office belongs, for page titles: "Illinois", "Cook County", "Chicago". */
export function placeName(districtId: OcdId): string {
  const locality = localitySlug(districtId)
  if (locality) return titleCase(locality)
  return stateCode(districtId) === 'il'
    ? 'Illinois'
    : stateCode(districtId).toUpperCase()
}

/** Who sees a race on their ballot, in a sentence: "Voters in the 7th Congressional District." */
export function whoVotes(districtId: OcdId): string {
  const last = districtId.split('/').at(-1) ?? ''
  const [type, value = ''] = last.split(':')
  switch (type) {
    case 'state':
      return 'Every voter in Illinois.'
    case 'cd':
      return `Voters in the ${ordinal(value)} Congressional District.`
    case 'sldu':
      return `Voters in the ${ordinal(value)} State Senate District.`
    case 'sldl':
      return `Voters in the ${ordinal(value)} State Representative District.`
    case 'court_of_appeals':
      return `Voters in the ${ordinal(value)} Appellate Court District (Cook County).`
    case 'sewer':
      return 'Voters in the Metropolitan Water Reclamation District, which covers most of Cook County.'
    case 'county':
      return `Every voter in ${titleCase(value)} County.`
    case 'council_district':
      return `Voters in the ${ordinal(value)} Cook County Board District.`
    case 'board_of_review_district':
      return `Voters in the ${ordinal(value)} Board of Review District.`
    case 'judicial_subcircuit':
      return `Voters in the ${ordinal(value)} Judicial Subcircuit of Cook County.`
    case 'school_board_district':
      return `Chicago voters in Board of Education Subdistrict ${value.toUpperCase()}.`
    case 'place':
      return `Every voter in ${titleCase(value)}.`
    case 'regional_office_of_education': {
      const county = /\/county:([a-z_]+)/.exec(districtId)?.[1] ?? ''
      return `Voters in school districts served by the ${titleCase(county)} County Regional Office of Education.`
    }
    default:
      return 'Voters in this district.'
  }
}

/** Where the race is on the ballot: "Chicago and suburban Cook County". */
export function ballotsText(ballots: BallotArea[]): string {
  if (ballots.length > 1) return 'Chicago and suburban Cook County'
  return ballots[0] === 'chicago' ? 'Chicago only' : 'Suburban Cook County only'
}

/** A race's name as a heading: its title, or for a judge "Retention of Jane Doe, Judge, Circuit Court". */
export function raceName(race: Pick<Race, 'kind' | 'title' | 'judge'>): string {
  return race.kind === 'retention' && race.judge
    ? `Retention of ${race.judge}, ${race.title}`
    : race.title
}
