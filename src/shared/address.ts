// Street address parsing and matching for the local geocoder. Both voter input
// ("121 N LaSalle St, Chicago, IL 60602") and Cook County address points
// ("121 N LA SALLE ST") go through the same parser, so they compare equal.

import { COOK_CITIES } from './cook-cities.ts'
import type { LatLng } from './provider.ts'

const DIRECTIONS: Record<string, string> = {
  N: 'N',
  NORTH: 'N',
  S: 'S',
  SOUTH: 'S',
  E: 'E',
  EAST: 'E',
  W: 'W',
  WEST: 'W',
}

const STREET_TYPES: Record<string, string> = {
  AV: 'AVE',
  AVE: 'AVE',
  AVENUE: 'AVE',
  BLVD: 'BLVD',
  BOULEVARD: 'BLVD',
  CIR: 'CIR',
  CIRCLE: 'CIR',
  CT: 'CT',
  COURT: 'CT',
  DR: 'DR',
  DRIVE: 'DR',
  HWY: 'HWY',
  HIGHWAY: 'HWY',
  LN: 'LN',
  LANE: 'LN',
  PKWY: 'PKWY',
  PARKWAY: 'PKWY',
  PL: 'PL',
  PLACE: 'PL',
  PLZ: 'PLZ',
  PLAZA: 'PLZ',
  RD: 'RD',
  ROAD: 'RD',
  SQ: 'SQ',
  SQUARE: 'SQ',
  ST: 'ST',
  STREET: 'ST',
  TER: 'TER',
  TERRACE: 'TER',
  TRL: 'TRL',
  TRAIL: 'TRL',
  WAY: 'WAY',
}

export interface StreetAddress {
  number: number
  predir?: string
  /** Street name in upper case with spaces removed, so "LA SALLE" equals "LASALLE". */
  name: string
  type?: string
  city?: string
  zip?: string
  /** Two-letter state code, when the input names a state VoteStack covers. */
  state?: string
}

/** States VoteStack covers, as typed in addresses. */
const STATES: Record<string, string> = {
  IL: 'IL',
  ILLINOIS: 'IL',
  CA: 'CA',
  CALIFORNIA: 'CA',
}
const STATE_AT_END = new RegExp(`\\s+(${Object.keys(STATES).join('|')})\\s*$`)

/** Parses "121 N LaSalle St, Chicago, IL 60602". Ignores unit numbers. Returns null without a house number. */
export function parseAddress(input: string): StreetAddress | null {
  let [streetPart, ...rest] = input.toUpperCase().split(',')
  // The city can follow the street without a comma ("834 Lake St Oak Park").
  const [street, city0] = splitCity(streetPart)
  streetPart = street
  if (city0) rest = [city0, ...rest]
  const tail = rest.join(' ')
  const zip = (tail.match(/\b(\d{5})(?:-\d{4})?\b/) ??
    input.match(/\b(\d{5})(?:-\d{4})?\s*$/))?.[1]
  const cityPart = rest[0]?.replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ')
  const stateWord =
    (cityPart?.match(STATE_AT_END) ?? tail.match(STATE_AT_END))?.[1] ??
    rest[1]?.trim().split(/\s+/)[0]
  const state = stateWord ? STATES[stateWord] : undefined
  const city = cityPart?.replace(STATE_AT_END, ' ').trim() || undefined

  const words = streetPart
    .replace(/[.#]/g, ' ')
    .replace(/\b(APT|UNIT|STE|SUITE|FL|FLOOR)\b.*$/, '')
    .split(/\s+/)
    .filter(Boolean)
  const number = Number(words.shift()?.match(/^\d+/)?.[0])
  if (!Number.isFinite(number) || number <= 0) return null

  let predir: string | undefined
  // A leading direction, unless it's the street name itself ("100 North Ave").
  const nameAfterDirection =
    words.length > 2 || (words.length === 2 && !STREET_TYPES[words[1]])
  if (DIRECTIONS[words[0]] && nameAfterDirection)
    predir = DIRECTIONS[words.shift()!]
  // A bare unit after the street type ("834 LAKE ST 2B").
  if (
    words.length > 2 &&
    STREET_TYPES[words[words.length - 2]] &&
    /^\d+[A-Z]?$/.test(words[words.length - 1])
  )
    words.pop()
  // Trailing direction (rare in Cook County) and street type.
  if (words.length > 1 && DIRECTIONS[words[words.length - 1]]) words.pop()
  let type: string | undefined
  if (words.length > 1 && STREET_TYPES[words[words.length - 1]])
    type = STREET_TYPES[words.pop()!]

  const name = words.join('').replace(/^SAINT(?=[A-Z])/, 'ST')
  if (!name) return null
  return {
    number,
    predir,
    name,
    type,
    city: city && !STATES[city] ? city : undefined,
    zip,
    ...(state && { state }),
  }
}

/**
 * Splits a known Cook County city (and any state and ZIP after it) off the
 * end of "834 LAKE ST APT 2 OAK PARK IL 60301". Matching city names rather
 * than splitting after a street type keeps names like "AVENUE L" or
 * "CARRIAGE WAY DR" whole.
 */
function splitCity(input: string): [string, string?] {
  const words = input.split(/\s+/).filter(Boolean)
  let end = words.length
  if (/^\d{5}(-\d{4})?$/.test(words[end - 1] ?? '')) end--
  if (STATES[words[end - 1] ?? '']) end--
  // Longest match first; keep the house number and at least one name word.
  for (let start = 2; start < end; start++) {
    if (COOK_CITIES.has(words.slice(start, end).join(' ').replace(/\./g, '')))
      return [words.slice(0, start).join(' '), words.slice(start).join(' ')]
  }
  return [input]
}

/** Key for all addresses on one street, regardless of house number or city. */
export const streetKey = (a: Pick<StreetAddress, 'predir' | 'name'>) =>
  `${a.predir ?? ''}|${a.name}`

/**
 * Keys to try when the address isn't found under its own key: address points
 * often leave out the direction the mailing address uses ("2401 S Des Plaines
 * Ave" is stored as "2401 DES PLAINES AVE"), and voters often leave it out
 * when the points have one. Accept a match only if one key finds it.
 */
export const alternateStreetKeys = (
  a: Pick<StreetAddress, 'predir' | 'name'>,
): string[] =>
  a.predir
    ? [streetKey({ name: a.name })]
    : ['N', 'S', 'E', 'W'].map((predir) => streetKey({ predir, name: a.name }))

export interface AddressPoint {
  number: number
  type?: string
  city?: string
  zip?: string
  lat: number
  lng: number
}

export interface GeocodeResult extends LatLng {
  /** `exact`: a known address point. `interpolated`: estimated between neighbours on the street. */
  precision: 'exact' | 'interpolated'
}

/** How far apart (in house numbers) the neighbours used for interpolation may be. */
const MAX_GAP = 200

/**
 * Finds an address among the points on its street (all sharing one `streetKey`).
 * Looks within the ZIP first, then the whole city (ZIPs change along a street),
 * prefers a matching street type, and interpolates between the nearest
 * same-side neighbours if there's no exact point.
 */
export function matchOnStreet(
  address: StreetAddress,
  street: AddressPoint[],
): GeocodeResult | null {
  const scopes: AddressPoint[][] = []
  const inZip = street.filter((p) => p.zip === address.zip)
  if (address.zip) scopes.push(inZip)
  // Street names repeat across towns, so never search beyond the typed city
  // and the postal cities used in the ZIP. Points carry postal city names,
  // which aren't always the town (North Riverside's are under RIVERSIDE).
  // Some points spell the city in mixed case ("Chicago"); typed addresses are
  // upper-cased by parseAddress.
  const upper = (city?: string) => city?.toUpperCase()
  const cities = new Set([address.city, ...inZip.map((p) => upper(p.city))])
  cities.delete(undefined)
  if (cities.size) scopes.push(street.filter((p) => cities.has(upper(p.city))))
  if (!address.zip && !address.city) scopes.push(street)
  for (const scope of scopes) {
    const found = locate(address, scope)
    if (found) return found
  }
  return null
}

function locate(
  address: StreetAddress,
  points: AddressPoint[],
): GeocodeResult | null {
  let candidates = points
  if (address.type && candidates.some((p) => p.type === address.type)) {
    candidates = candidates.filter((p) => p.type === address.type)
  }

  const exact = candidates.find((p) => p.number === address.number)
  if (exact) return { lat: exact.lat, lng: exact.lng, precision: 'exact' }

  const sameSide = candidates.filter((p) => p.number % 2 === address.number % 2)
  let below: AddressPoint | undefined
  let above: AddressPoint | undefined
  for (const p of sameSide) {
    if (p.number < address.number && (!below || p.number > below.number))
      below = p
    if (p.number > address.number && (!above || p.number < above.number))
      above = p
  }
  if (below && above && above.number - below.number <= MAX_GAP) {
    const t = (address.number - below.number) / (above.number - below.number)
    return {
      lat: below.lat + t * (above.lat - below.lat),
      lng: below.lng + t * (above.lng - below.lng),
      precision: 'interpolated',
    }
  }
  return null
}
