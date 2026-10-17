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

/**
 * The ballots that list a race: in Cook County, Chicago's or suburban Cook's
 * (each has its own election authority); in Los Angeles County, the
 * Registrar's, which covers the whole county.
 */
export type BallotArea = 'chicago' | 'suburban-cook' | 'los-angeles-county'

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

/**
 * content/contests/{election date}.json for Cook County, and
 * content/contests/{region}/{election date}.json for other areas.
 */
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

const STATE_NAMES: Record<string, string> = {
  ca: 'California',
  il: 'Illinois',
}

/** The state the district is in: "Illinois", or its code for a state not covered. */
export function stateName(districtId: OcdId): string {
  const code = stateCode(districtId)
  return STATE_NAMES[code] ?? code.toUpperCase()
}

/** Where the office belongs, for page titles: "Illinois", "Cook County", "Chicago". */
export function placeName(districtId: OcdId): string {
  const locality = localitySlug(districtId)
  if (locality) return titleCase(locality)
  return stateName(districtId)
}

/** The name in an ID part like `special_district:{slug}`, title cased. */
const partName = (districtId: OcdId, type: string) =>
  titleCase(new RegExp(`/${type}:([a-z0-9_]+)`).exec(districtId)?.[1] ?? '')

/** "Pasadena Unified" → "Pasadena Unified School District"; a name that already ends in "District" stays. */
const districtName = (name: string, suffix: string) =>
  /\bDistrict$/.test(name) ? name : `${name} ${suffix}`

/** Who votes in a California district, where its wording differs from Illinois's. */
function whoVotesCalifornia(
  districtId: OcdId,
  type: string,
  value: string,
): string | undefined {
  const parent = districtId.split('/').at(-2) ?? ''
  const [parentType] = parent.split(':')
  switch (type) {
    case 'council_district':
      return parentType === 'place'
        ? `Voters in ${partName(districtId, 'place')} City Council District ${value}.`
        : `Voters in the ${ordinal(value)} Supervisorial District of Los Angeles County.`
    case 'sldl':
      return `Voters in the ${ordinal(value)} State Assembly District.`
    case 'school_district':
      return `Voters in the ${districtName(titleCase(value), 'School District')}.`
    case 'community_college_district':
      return `Voters in the ${districtName(titleCase(value), 'Community College District')}.`
    case 'special_district':
      return `Voters in the ${districtName(titleCase(value), 'District')}.`
    case 'trustee_area':
      return parentType === 'community_college_district'
        ? `Voters in Trustee Area ${value} of the ${districtName(partName(districtId, 'community_college_district'), 'Community College District')}.`
        : `Voters in Trustee Area ${value} of the ${districtName(partName(districtId, 'school_district'), 'School District')}.`
    case 'division':
      return `Voters in Division ${value} of the ${districtName(partName(districtId, 'special_district'), 'District')}.`
    case 'boe_district':
      return `Voters in the ${ordinal(value)} Board of Equalization District.`
    case 'court_of_appeals':
      return `Voters in the ${ordinal(value)} Appellate District of the California Court of Appeal.`
    default:
      return undefined
  }
}

/** Who sees a race on their ballot, in a sentence: "Voters in the 7th Congressional District." */
export function whoVotes(districtId: OcdId): string {
  const last = districtId.split('/').at(-1) ?? ''
  const [type, value = ''] = last.split(':')
  if (stateCode(districtId) === 'ca') {
    const la = whoVotesCalifornia(districtId, type, value)
    if (la) return la
  }
  switch (type) {
    case 'state':
      return `Every voter in ${stateName(districtId)}.`
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
  if (ballots.includes('los-angeles-county')) return 'Los Angeles County'
  if (ballots.length > 1) return 'Chicago and suburban Cook County'
  return ballots[0] === 'chicago' ? 'Chicago only' : 'Suburban Cook County only'
}

/** Every ballot in an area's list, for a sentence: "Chicago and suburban Cook County". */
export function areaBallotsText(list: Pick<RaceList, 'races'>): string {
  const ballots = [...new Set(list.races.flatMap((r) => r.ballots))]
  if (ballots.includes('chicago') && ballots.includes('suburban-cook'))
    return 'Chicago and suburban Cook County'
  return ballotsText(ballots)
}

/** A race's name as a heading: its title, or for a judge "Retention of Jane Doe, Judge, Circuit Court". */
export function raceName(race: Pick<Race, 'kind' | 'title' | 'judge'>): string {
  return race.kind === 'retention' && race.judge
    ? `Retention of ${race.judge}, ${race.title}`
    : race.title
}
