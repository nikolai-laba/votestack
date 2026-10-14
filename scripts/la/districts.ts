// The district whose voters see an LA County contest, from the contest's
// name in the Registrar's ballot data ("LOS ANGELES UNIFIED SCHOOL DISTRICT
// Governing Board Member, Trustee Area No. 3", "UNITED STATES
// REPRESENTATIVE, 28th District"). Which precincts see a contest comes from
// the Registrar's ballot styles, not from these IDs; the IDs name the district
// for race pages and group contests that always appear together (build-la.ts
// checks that).

import type { OcdId } from '../../src/shared/ballot.ts'
import * as ocd from '../../src/shared/ocd.ts'

const CA = ocd.CALIFORNIA
const COUNTY = ocd.LOS_ANGELES_COUNTY

const ORDINALS = [
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
  'eleventh',
  'twelfth',
  'thirteenth',
  'fourteenth',
  'fifteenth',
]
const ORDINAL_WORD = new RegExp(`\\b(${ORDINALS.join('|')})\\b`, 'i')

/** The district number in a name: "28th District" → 28, "First District" → 1. */
function number(text: string): number {
  const digits = /(\d+)/.exec(text)?.[1]
  if (digits) return Number(digits)
  const word = ORDINAL_WORD.exec(text)?.[1]
  return word ? ORDINALS.indexOf(word.toLowerCase()) + 1 : NaN
}

/** "Pasadena" → `…/state:ca/place:pasadena`. */
export const city = (name: string): OcdId =>
  `${CA}/place:${ocd.ocdSlug(name.replace(/^CITY OF /i, ''))}`

/**
 * Splits "ABC UNIFIED SCHOOL DISTRICT Governing Board Member, Trustee Area
 * No. 2" into the jurisdiction (the leading upper-case words) and the office.
 */
export function splitJurisdiction(name: string): [string, string] {
  const words = name.trim().split(/\s+/)
  let i = 0
  while (
    i < words.length &&
    /[A-ZÑ]/.test(words[i]) &&
    words[i] === words[i].toUpperCase()
  )
    i++
  return [words.slice(0, i).join(' '), words.slice(i).join(' ')]
}

/** "CITY OF ARCADIA GENERAL MUNICIPAL ELECTION" → "CITY OF ARCADIA". */
export const withoutElection = (name: string) =>
  name
    .replace(
      /\s*-?\s*(GENERAL MUNICIPAL|SPECIAL MUNICIPAL|PRIMARY NOMINATING|GENERAL|SPECIAL|CONSOLIDATED)?\s*ELECTION\s*-?$/,
      '',
    )
    .trim()

/** A local jurisdiction's district by its name. */
export function jurisdiction(name: string): OcdId | null {
  const n = withoutElection(
    name.toUpperCase().replace(/\s+/g, ' ').replace(/,$/, '').trim(),
  )
  if (!n) return null
  if (/^COUNTY OF LOS ANGELES$|^LOS ANGELES COUNTY$/.test(n)) return COUNTY
  if (/COMMUNITY COLLEGE DISTRICT$/.test(n))
    return `${COUNTY}/community_college_district:${ocd.ocdSlug(n.replace(/ COMMUNITY COLLEGE DISTRICT$/, ''))}`
  if (/SCHOOL DISTRICT$/.test(n))
    return `${COUNTY}/school_district:${ocd.ocdSlug(n.replace(/ SCHOOL DISTRICT$/, ''))}`
  const cityName =
    /^CITY OF (.+)$/.exec(n)?.[1] ?? /^(.+?) CITY$/.exec(n)?.[1] ?? null
  if (cityName) return city(cityName)
  return `${COUNTY}/special_district:${ocd.ocdSlug(n)}`
}

/** The part of a jurisdiction an office is elected from, if any. */
function subArea(office: string): string {
  const trustee = /Trustee Area(?: No\.)? (\d+)/i.exec(office)?.[1]
  if (trustee) return `/trustee_area:${trustee}`
  const division = /Division (\d+)/i.exec(office)?.[1]
  if (division) return `/division:${division}`
  if (/\bDistrict\b/i.test(office) && Number.isFinite(number(office))) {
    const n = number(office)
    return /Council/i.test(office) ? `/council_district:${n}` : `/division:${n}`
  }
  return ''
}

/** State and county offices. */
function stateOrCounty(name: string): OcdId | null {
  if (/United States Representative|Representative in Congress/i.test(name))
    return `${CA}/cd:${number(name)}`
  if (/United States Senator|^President/i.test(name)) return CA
  if (/State Senator/i.test(name)) return `${CA}/sldu:${number(name)}`
  if (/State Assembly/i.test(name)) return `${CA}/sldl:${number(name)}`
  if (/Board of Equalization/i.test(name))
    return `${CA}/boe_district:${number(name)}`
  if (/Court of Appeal/i.test(name)) {
    const n = number(/(\w+) (?:Appellate )?District/i.exec(name)?.[1] ?? '')
    return Number.isFinite(n) ? `${CA}/court_of_appeals:${n}` : null
  }
  if (/Supreme Court|Chief Justice of California/i.test(name)) return CA
  if (/^Supervisor|Board of Supervisors/i.test(name))
    return `${COUNTY}/council_district:${number(name)}`
  if (/Superior Court|^Sheriff|^Assessor|^District Attorney/i.test(name))
    return COUNTY
  if (
    /^(Governor|Lieutenant Governor|Secretary of State|Controller|Treasurer|Attorney General|Insurance Commissioner|(State )?Superintendent of Public Instruction)\b/i.test(
      name,
    )
  )
    return CA
  return null
}

/** A candidate or retention contest's district, or null if the name isn't recognized. */
export function officeDistrict(name: string): OcdId | null {
  const known = stateOrCounty(name.replace(/^(For|Member,?) /i, ''))
  if (known) return known
  const [place, office] = splitJurisdiction(name)
  const base = jurisdiction(place)
  return base ? base + subArea(office) : null
}

/**
 * A measure's district: the state's measures ("STATE MEASURE 37"), the
 * County's ("COUNTY MEASURE A"), or the jurisdiction in its name ("LOS
 * ANGELES CITY GENERAL MUNICIPAL ELECTION - MEASURE EE").
 */
export function measureDistrict(name: string): OcdId | null {
  if (/^(STATE MEASURE|PROPOSITION)\b/i.test(name)) return CA
  if (/^COUNTY MEASURE\b/i.test(name)) return COUNTY
  const place = name
    .toUpperCase()
    .replace(/\s*-\s*MEASURE\s+\S+.*$/, '')
    .trim()
  if (!place || place === name.toUpperCase()) return null
  return jurisdiction(place)
}

/**
 * A contest name as a title: "CITY OF DOWNEY GENERAL MUNICIPAL ELECTION
 * Member of the City Council, 2nd District" → "CITY OF DOWNEY, Member of the
 * City Council, 2nd District", and "LOS ANGELES CITY …" → "CITY OF LOS
 * ANGELES, …". Names without a jurisdiction prefix are kept. Case is fixed
 * separately.
 */
export function contestTitle(name: string): string {
  const [place, office] = splitJurisdiction(name)
  if (!office || /^(STATE|COUNTY) MEASURE\b/i.test(name)) return name
  const jurisdictionName = withoutElection(place.replace(/,$/, ''))
  const cityName = /^(.+?) CITY$/.exec(jurisdictionName)?.[1]
  const named = cityName ? `CITY OF ${cityName}` : jurisdictionName
  return named ? `${named}, ${office}` : office
}
