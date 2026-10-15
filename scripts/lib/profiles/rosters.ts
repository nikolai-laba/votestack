// Party labels for elected officials who endorse, from the official member
// rosters of the legislatures (the U.S. House Clerk, senate.gov, and the
// state Assembly and Senate). An endorsing official whose name and office
// match exactly one sitting member gets that member's party, the same way
// for every profile. Former officials and local offices aren't in the
// rosters and keep whatever their source gave (often nothing).

import type {
  CandidateProfile,
  Endorsement,
} from '../../../src/shared/profile.ts'
import { decodeEntities } from './slate-parsers.ts'

export type Body = 'us_house' | 'us_senate' | 'state_assembly' | 'state_senate'

export interface RosterMember {
  body: Body
  first: string
  last: string
  party: string
}

export interface Rosters {
  fetchedAt: string
  /** Where each body's roster came from. */
  sources: Record<Body, string>
  members: RosterMember[]
}

const PARTIES: Record<string, string> = {
  D: 'Democratic',
  R: 'Republican',
  I: 'Independent',
  Democrat: 'Democratic',
  Democratic: 'Democratic',
  Republican: 'Republican',
  Independent: 'Independent',
}

const partyName = (code: string): string => {
  const name = PARTIES[code.trim()]
  if (!name) throw new Error(`Unknown party "${code}" in a roster`)
  return name
}

const tag = (xml: string, name: string) =>
  decodeEntities(xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1] ?? '')

/** The House Clerk's MemberData.xml: one state's sitting members. */
export function parseHouse(xml: string, state: string): RosterMember[] {
  const out: RosterMember[] = []
  for (const m of xml.matchAll(/<member>([\s\S]*?)<\/member>/g)) {
    if (!tag(m[1], 'statedistrict').startsWith(state)) continue
    const last = tag(m[1], 'lastname')
    // A vacant seat has no name.
    if (!last) continue
    out.push({
      body: 'us_house',
      first: tag(m[1], 'firstname'),
      last,
      party: partyName(tag(m[1], 'party')),
    })
  }
  return out
}

/** senate.gov's senators_cfm.xml: one state's senators. */
export function parseUsSenate(xml: string, state: string): RosterMember[] {
  const out: RosterMember[] = []
  for (const m of xml.matchAll(/<member>([\s\S]*?)<\/member>/g)) {
    if (tag(m[1], 'state') !== state) continue
    out.push({
      body: 'us_senate',
      first: tag(m[1], 'first_name'),
      last: tag(m[1], 'last_name'),
      party: partyName(tag(m[1], 'party')),
    })
  }
  return out
}

/** assembly.ca.gov/assemblymembers: `data-name="Last, First"` and `data-party`. */
export function parseAssembly(html: string): RosterMember[] {
  return [
    ...html.matchAll(
      /<li class="members-list__member" data-name="([^"]+)"[^>]*data-party="([^"]+)"/g,
    ),
  ]
    .filter((m) => !/vacant/i.test(`${m[1]} ${m[2]}`))
    .map((m) => {
      const [last, first = ''] = decodeEntities(m[1]).split(/\s*,\s*/)
      return { body: 'state_assembly', first, last, party: partyName(m[2]) }
    })
}

/** senate.ca.gov/senators: a member block with `data-party` and the full name. */
export function parseStateSenate(html: string): RosterMember[] {
  return [
    ...html.matchAll(
      /<div class="page-members__member" data-name="([^"]+)"[^>]*data-party="([^"]+)">[\s\S]*?<h3 class="member__name"[^>]*>([^<]+)<\/h3>/g,
    ),
  ]
    .filter((m) => !/vacant/i.test(`${m[1]} ${m[2]}`))
    .map((m) => {
      const last = decodeEntities(m[1]).trim()
      const full = decodeEntities(m[3]).trim()
      const first = full.endsWith(last)
        ? full.slice(0, -last.length).trim()
        : full.split(/\s+/)[0]
      return { body: 'state_senate', first, last, party: partyName(m[2]) }
    })
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Which bodies an endorser's title points to, or all when it names none. */
function bodiesFor(title: string): Body[] | undefined {
  const t = title.toLowerCase()
  if (/\b(former|retired|ex-)\b/.test(t)) return []
  if (/assembly/.test(t)) return ['state_assembly']
  if (/\bstate sen(ator|\.)?\b|\bstate senate\b/.test(t))
    return ['state_senate']
  if (/\bu\.?s\.? sen|\bunited states sen/.test(t)) return ['us_senate']
  if (/\b(u\.?s\.? )?rep(resentative)?\.?\b|\bcongress/.test(t))
    return ['us_house']
  if (/\bsen(ator|\.)\b/.test(t)) return ['us_senate', 'state_senate']
  return undefined
}

/**
 * The roster member an endorsing official is, when exactly one sitting
 * member of a body their title names (or of any body, when it names none)
 * has their last name and a first name that matches or shortens to theirs
 * ("Nick"/"Nicholas", "Ben"/"Benjamin").
 */
export function rosterMatch(
  endorser: string,
  members: RosterMember[],
): RosterMember | undefined {
  const bodies = bodiesFor(endorser)
  if (bodies?.length === 0) return undefined
  const words = fold(endorser).split(' ')
  const found = members.filter((m) => {
    if (bodies && !bodies.includes(m.body)) return false
    const last = fold(m.last).split(' ')
    const at = words.findIndex(
      (_, i) => last.every((w, j) => words[i + j] === w) && i > 0,
    )
    if (at < 0) return false
    const first = fold(m.first).split(' ')[0]
    // The first name, or a middle name or initial between it and the last.
    return [words[at - 1], words[at - 2]].some(
      (before) =>
        before !== undefined &&
        (before === first ||
          (before.length >= 3 && first.startsWith(before.slice(0, 3)))),
    )
  })
  return found.length === 1 ? found[0] : undefined
}

/** Sets each matched official's party from the rosters; returns what changed. */
export function fillParties(
  p: CandidateProfile,
  members: RosterMember[],
): {
  profile: CandidateProfile
  filled: { organization: string; party: string }[]
} {
  const filled: { organization: string; party: string }[] = []
  const items = p.endorsements.items.map((e): Endorsement => {
    if (e.kind !== 'elected_official') return e
    const m = rosterMatch(e.organization, members)
    if (!m || e.party === m.party) return e
    filled.push({ organization: e.organization, party: m.party })
    return { ...e, party: m.party }
  })
  return filled.length
    ? { profile: { ...p, endorsements: { ...p.endorsements, items } }, filled }
    : { profile: p, filled }
}
