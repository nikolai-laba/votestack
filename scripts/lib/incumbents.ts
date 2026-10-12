// Incumbent labels: which candidates hold the seat they're running for, as an
// official list confirms (scripts/build-incumbents.ts). A candidate gets the
// label only when a source says so; a missing or unclear source means no
// label, never a guess.
//
// Sources, by office:
// - U.S. House and Senate: the FEC's candidate summary for the cycle, whose
//   incumbent/challenger/open-seat field the FEC sets from its own records.
// - Illinois General Assembly: the current member lists on ilga.gov, matched
//   by chamber, district and name.
// - Everything else: content/incumbents/rosters.json, a hand-checked list
//   copied from each body's own roster page, with the page and the date.

import type { Contest, IsoDate } from '../../src/shared/ballot.ts'
import { profileKey } from '../../src/shared/profile.ts'
import { matchFecCandidates, type FecCandidate } from './profiles/fec.ts'
import { fullNameMatches, parseBallotName } from './profiles/names.ts'

/** One labeled candidate in content/incumbents/{election date}.json. */
export interface IncumbentEntry {
  incumbent: true
  /** The office as voters see it (the profile's office). */
  office: string
  /** The official page or record that confirms it. */
  source: string
  /** When that source was read. */
  checked: IsoDate
}

/** content/incumbents/{election date}.json, by profileKey(name). */
export type Incumbents = Record<string, IncumbentEntry>

/** The parts of a profile subject (scripts/lib/profiles/subjects.ts) this needs. */
export interface Person {
  key: string
  name: string
  office: string
  officeType: string
  districtId: string
  kind: string
}

/** A current member of the Illinois House or Senate, from ilga.gov. */
export interface Member {
  id: string
  name: string
  party: string
  district: number
}

export type Chamber = 'House' | 'Senate'

export const ilgaListUrl = (chamber: Chamber) =>
  `https://www.ilga.gov/${chamber}/Members`
export const ilgaMemberUrl = (chamber: Chamber, id: string) =>
  `https://www.ilga.gov/${chamber}/Members/Details/${id}`

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'" }

/** "&quot;Chris&quot;", "Gonz&#225;lez" → plain text. */
const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&(amp|quot|apos);/g, (_, e: string) => ENTITIES[e])

/**
 * Current members from an ilga.gov member list page. Each member appears
 * twice (desktop and mobile cards); "Former Members" further down the page
 * are left out.
 */
export function parseIlgaMembers(html: string): Member[] {
  const former = html.search(/>\s*Former Members\s*</)
  const current = former >= 0 ? html.slice(0, former) : html
  const out = new Map<string, Member>()
  for (const m of current.matchAll(
    /<a[^>]*href="\/\w+\/Members\/Details\/(\d+)">([^<]+)<\/a>\s*\((\w+)\)\s*<\/h2>\s*<p class="card-text">[^<]*<br\s*\/?>\s*(\d+)(?:st|nd|rd|th) District/g,
  )) {
    out.set(m[1], {
      id: m[1],
      name: decode(m[2]).trim(),
      party: m[3],
      district: Number(m[4]),
    })
  }
  return [...out.values()]
}

/** A seat named on a roster page, copied by hand into rosters.json. */
export interface RosterEntry {
  /** The office exactly as the profile subject gives it. */
  office: string
  /** The name as the roster prints it. */
  name: string
  /** The seat as the roster names it, when it isn't the whole office. */
  seat?: string
  source: string
  checked: IsoDate
}

export interface RosterFile {
  entries: RosterEntry[]
  /** Offices or people we couldn't confirm, so they stay unlabeled. */
  unconfirmed: { office: string; names?: string[]; reason: string }[]
}

const districtOf = (districtId: string, type: string) =>
  Number(districtId.match(new RegExp(`/${type}:(\\d+)$`))?.[1] ?? NaN)

export interface Sources {
  fec: { candidates: FecCandidate[]; checked: IsoDate }
  ilga: Record<Chamber, { members: Member[]; checked: IsoDate }>
  roster: RosterEntry[]
}

/** FEC: incumbent when a candidate record for this seat and name says so. */
export function fecIncumbent(
  p: Person,
  fec: Sources['fec'],
): IncumbentEntry | null {
  const seat =
    p.officeType === 'us_senate'
      ? { office: 'S' as const }
      : p.officeType === 'us_house'
        ? { office: 'H' as const, district: districtOf(p.districtId, 'cd') }
        : null
  if (!seat) return null
  const match = matchFecCandidates(
    parseBallotName(p.name),
    seat,
    fec.candidates,
  ).find((c) => c.status === 'I')
  return match
    ? {
        incumbent: true,
        office: p.office,
        source: `https://www.fec.gov/data/candidate/${match.id}/`,
        checked: fec.checked,
      }
    : null
}

/** ilga.gov: the member for this chamber and district, if it's the same person. */
export function ilgaIncumbent(
  p: Person,
  ilga: Sources['ilga'],
): IncumbentEntry | null {
  if (p.officeType !== 'state_legislature') return null
  const house = districtOf(p.districtId, 'sldl')
  const chamber: Chamber | null = Number.isFinite(house)
    ? 'House'
    : Number.isFinite(districtOf(p.districtId, 'sldu'))
      ? 'Senate'
      : null
  if (!chamber) return null
  const district =
    chamber === 'House' ? house : districtOf(p.districtId, 'sldu')
  const member = ilga[chamber].members.find(
    (m) => m.district === district && fullNameMatches(p.name, m.name),
  )
  return member
    ? {
        incumbent: true,
        office: p.office,
        source: ilgaMemberUrl(chamber, member.id),
        checked: ilga[chamber].checked,
      }
    : null
}

/** rosters.json: an entry for this office whose name is this person. */
export function rosterIncumbent(
  p: Person,
  roster: RosterEntry[],
): IncumbentEntry | null {
  const entry = roster.find(
    (r) => r.office === p.office && fullNameMatches(p.name, r.name),
  )
  return entry
    ? {
        incumbent: true,
        office: p.office,
        source: entry.source,
        checked: entry.checked,
      }
    : null
}

/**
 * Every confirmed incumbent among the candidates, by key, plus roster entries
 * that matched nobody (a stale or mistyped entry, for a person to fix).
 * Judges up for retention and judicial candidates are never labeled.
 */
export function buildIncumbents(
  people: Person[],
  sources: Sources,
): { incumbents: Incumbents; unusedRoster: RosterEntry[] } {
  const incumbents: Incumbents = {}
  const used = new Set<RosterEntry>()
  for (const p of [...people].sort((a, b) => a.key.localeCompare(b.key))) {
    if (p.kind !== 'candidate') continue
    const entry =
      fecIncumbent(p, sources.fec) ??
      ilgaIncumbent(p, sources.ilga) ??
      rosterIncumbent(p, sources.roster)
    if (!entry) continue
    incumbents[p.key] = entry
    const r = sources.roster.find(
      (r) => r.office === p.office && fullNameMatches(p.name, r.name),
    )
    if (r) used.add(r)
  }
  return {
    incumbents,
    unusedRoster: sources.roster.filter((r) => !used.has(r)),
  }
}

/**
 * Contests with `incumbent: true` on each confirmed candidate, inside the
 * contest data (no schema change). Retention contests have no candidates
 * and are left alone; a stale `incumbent` is dropped.
 */
export function withIncumbents(
  contests: Contest[],
  incumbents: Incumbents,
): Contest[] {
  return contests.map((c) =>
    c.kind !== 'candidate'
      ? c
      : {
          ...c,
          candidates: c.candidates.map((cand) => {
            const { incumbent: _, ...rest } = cand
            return incumbents[profileKey(cand.name)]
              ? { ...rest, incumbent: true }
              : rest
          }),
        },
  )
}
