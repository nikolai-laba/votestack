// Published general-election endorsement lists (slates): matching
// their entries to the people on the ballot, and merging matched entries
// into profiles. The lists are committed under content/profiles/slates/ by
// scripts/profiles/slates.ts; generate merges them on every run.
//
// Matching needs both the name (case, punctuation, middle names and
// initials, quoted nicknames and Jr/III don't matter) and the office
// (type, district, vacancy). Anything else is left unmatched for a person
// to review, never guessed.

import type {
  CandidateProfile,
  Endorsement,
} from '../../../src/shared/profile.ts'
import { addSources } from './assemble.ts'
import { confirmation, sameEndorser } from './endorsers.ts'
import { givenNamesAgree, parseBallotName } from './names.ts'
import type { OfficeHint, ParsedEntry } from './slate-parsers.ts'
import type { Subject } from './subjects.ts'

export interface SlateEntry {
  name: string
  /** The office or district as the list prints it. */
  office: string
  /** The profile key, when exactly one person on the ballot fits. */
  matchedKey: string | null
  /**
   * Why there's no match: "outside" (no such office on the region's
   * ballots), "unmatched" (the office is on the ballot but no name fits) or
   * "ambiguous" (more than one fits).
   */
  status?: 'outside' | 'unmatched' | 'ambiguous'
  note?: string
}

/** content/profiles/slates/{slug}.json */
export interface Slate {
  slug: string
  /** The endorser's name as profiles show it. */
  endorser: string
  kind: Extract<Endorsement['kind'], 'union' | 'organization' | 'party'>
  title: string
  publisher: string
  /** The page profiles cite. */
  url: string
  /** The file the entries were read from, when it isn't `url`. */
  documentUrl?: string
  /** When the list was downloaded (YYYY-MM-DD). */
  fetchedAt: string
  /** How the list was read, for reviewers. */
  note?: string
  entries: SlateEntry[]
}

const ORDINAL_WORDS = [
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
]

/** The first number in an office, or its first ordinal word ("Fifth District") when it has no digits. */
const firstNumber = (s: string) => {
  const m = s.match(/\d+/)
  if (m) return Number(m[0])
  const w = s
    .toLowerCase()
    .match(new RegExp(`\\b(${ORDINAL_WORDS.join('|')})\\b`))
  return w ? ORDINAL_WORDS.indexOf(w[1]) + 1 : undefined
}

/** A place or office for comparing: no case, accents, periods or apostrophes; dashes as spaces; no leading "City of". */
export const placeKey = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/[-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(city of )+/, '')

/** Whether an office begins with a place ("El Monte" fits "City of El Monte, Mayor", not "City of South El Monte"). */
const placeFits = (office: string, place: string) => {
  const o = placeKey(office)
  const p = placeKey(place)
  return o === p || o.startsWith(`${p} `) || o.startsWith(`${p},`)
}

/** Whether a subject's office fits what a list printed. */
export function officeFits(s: Subject, h: OfficeHint): boolean {
  const office = s.office.toLowerCase().replace(/['’]/g, '')
  const typeOk =
    h.types.includes(s.officeType) ||
    // A judge who runs for one seat and is up for retention in another
    // (subjects.ts SAME_PERSON) has one subject, in their contested race.
    (h.types.includes('retention') && (s.alsoIn?.length ?? 0) > 0)
  if (!typeOk) return false
  if (h.types.includes('retention') && s.officeType !== 'retention') return true
  if (h.includes?.some((x) => !office.includes(x.toLowerCase()))) return false
  if (h.excludes?.some((x) => office.includes(x.toLowerCase()))) return false
  if (h.district !== undefined && firstNumber(s.office) !== h.district)
    return false
  if (h.vacancy && !office.split(/[^a-z]+/).includes(h.vacancy)) return false
  if (h.place && !placeFits(s.office, h.place)) return false
  return true
}

/** Single quotes around a nickname ('Trish', ‘Lisa’) as double quotes, for parseBallotName. */
const quoteNicknames = (s: string) =>
  s.replace(/(^|\s)['‘’]([^'‘’]+)['’](?=\s|,|$)/g, '$1"$2"')

const people = (name: string) =>
  quoteNicknames(name)
    .split(/\s+(?:&|and)\s+/i)
    .map((p) => p.trim())
    .filter(Boolean)

const fold = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Nicknames in quotes, folded. */
const quoted = (s: string) =>
  [...s.matchAll(/["“”]([^"“”]+)["“”]/g)].map((m) =>
    fold(m[1]).replace(/[^a-z]/g, ''),
  )

/** Nicknames names.ts doesn't know, seen on these lists. */
const MORE_NICKNAMES = [
  ['angelica', 'angie'],
  ['abigail', 'abby'],
  ['jacqueline', 'jacky'],
  ['rickey', 'ricky'],
]

const givenAgree = (a: string, b: string) =>
  givenNamesAgree(a, b) ||
  MORE_NICKNAMES.some((g) => g.includes(a) && g.includes(b))

/** One joined given name starts with the other ("LaShawn" and "La Shawn K."). */
const joinedGivenAgree = (a: string, b: string) =>
  Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a))

function personMatches(ballot: string, listed: string): boolean {
  const b = parseBallotName(ballot)
  const e = parseBallotName(listed)
  if (b.words.length < 2 || e.words.length < 2) return false
  const givenOf = (words: string[], nick: string[]) => [
    ...(words[0].length === 1 ? words.slice(0, 2) : words.slice(0, 1)),
    ...nick,
  ]
  const bGiven = givenOf(b.words, quoted(ballot))
  const eGiven = givenOf(e.words, quoted(listed))
  // Last names may be split differently ("Du Buclet", "DuBuclet").
  for (let kb = 1; kb <= Math.min(3, b.words.length - 1); kb++)
    for (let ke = 1; ke <= Math.min(2, e.words.length - 1); ke++) {
      if (b.words.slice(-kb).join('') !== e.words.slice(-ke).join('')) continue
      if (bGiven.some((x) => eGiven.some((y) => givenAgree(x, y)))) return true
      if (
        joinedGivenAgree(
          b.words.slice(0, -kb).join(''),
          e.words.slice(0, -ke).join(''),
        )
      )
        return true
    }
  return false
}

/**
 * Whether a name on a list is a ballot name: any person on a joint ticket
 * ("JB Pritzker & Christian Mitchell") against any person on the list.
 */
export function slateNameMatches(ballotName: string, listed: string): boolean {
  return people(ballotName).some((b) =>
    people(listed).some((l) => personMatches(b, l)),
  )
}

/** Matches one parsed entry to the subjects. */
export function matchEntry(
  entry: ParsedEntry,
  subjects: Subject[],
): SlateEntry {
  const base = { name: entry.name, office: entry.office }
  const fits = entry.hint
    ? subjects.filter((s) => officeFits(s, entry.hint as OfficeHint))
    : []
  const named = fits.filter((s) => slateNameMatches(s.name, entry.name))
  if (named.length === 1) return { ...base, matchedKey: named[0].key }
  if (named.length > 1)
    return {
      ...base,
      matchedKey: null,
      status: 'ambiguous',
      note: `Fits ${named.map((s) => `${s.name} (${s.office})`).join('; ')}`,
    }
  const elsewhere = subjects.filter((s) => slateNameMatches(s.name, entry.name))
  if (elsewhere.length)
    return {
      ...base,
      matchedKey: null,
      status: 'unmatched',
      note: `Name fits ${elsewhere.map((s) => `${s.name} (${s.office})`).join('; ')}, but not the office`,
    }
  if (fits.length)
    return {
      ...base,
      matchedKey: null,
      status: 'unmatched',
      note: `On the ballot for this office: ${fits.map((s) => s.name).join('; ')}`,
    }
  return { ...base, matchedKey: null, status: 'outside' }
}

/** Matches a list's entries; one entry per person (a ticket's two names count once). */
export function matchSlate(
  entries: ParsedEntry[],
  subjects: Subject[],
): SlateEntry[] {
  const seen = new Set<string>()
  const out: SlateEntry[] = []
  for (const entry of entries) {
    const m = matchEntry(entry, subjects)
    if (m.matchedKey) {
      if (seen.has(m.matchedKey)) continue
      seen.add(m.matchedKey)
    }
    out.push(m)
  }
  return out
}

/**
 * Adds each slate that lists this person as an endorsement, cited to the
 * list, unless the profile already names that endorser. Returns the
 * confirmations (profile key and endorser) for the same-endorser check,
 * whether or not anything was added.
 */
export function mergeSlates(
  p: CandidateProfile,
  slates: Slate[],
): { profile: CandidateProfile; added: string[]; confirmed: string[] } {
  let sources = p.sources
  const items = [...p.endorsements.items]
  const added: string[] = []
  const confirmed: string[] = []
  for (const slate of slates) {
    if (!slate.entries.some((e) => e.matchedKey === p.key)) continue
    confirmed.push(confirmation(p.key, slate.endorser))
    if (items.some((e) => sameEndorser(e.organization, slate.endorser)))
      continue
    const r = addSources(sources, [
      {
        title: slate.title,
        publisher: slate.publisher,
        url: slate.url,
        viewedAt: slate.fetchedAt,
        kind: 'endorser',
      },
    ])
    sources = r.sources
    items.push({ organization: slate.endorser, kind: slate.kind, cites: r.ids })
    added.push(slate.slug)
  }
  // A list fetched again refreshes the date its page was viewed.
  for (const slate of slates) {
    if (!slate.entries.some((e) => e.matchedKey === p.key)) continue
    if (
      sources.some((s) => s.url === slate.url && s.viewedAt < slate.fetchedAt)
    )
      sources = sources.map((s) =>
        s.url === slate.url && s.viewedAt < slate.fetchedAt
          ? { ...s, viewedAt: slate.fetchedAt }
          : s,
      )
  }
  if (added.length === 0 && sources === p.sources)
    return { profile: p, added, confirmed }
  return {
    profile: { ...p, endorsements: { ...p.endorsements, items }, sources },
    added,
    confirmed,
  }
}
