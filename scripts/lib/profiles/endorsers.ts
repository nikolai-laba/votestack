// Endorser names and the same-endorser check across opponents.
//
// A model researching each candidate on their own sometimes credits one
// group to both nominees in a race (a primary endorsement, a misread list, a
// questionnaire every candidate answered). After every profile is assembled,
// an endorser credited to more candidates in a race than the race has seats
// is dropped from each of them, unless a published slate or a hand
// correction confirms it for that person. Bar evaluations rate every judge
// and are never touched.

import type {
  CandidateProfile,
  Endorsement,
} from '../../../src/shared/profile.ts'

/** Spellings of one endorser, folded to one name. Checked after normalizing. */
const ALIASES: [RegExp, string][] = [
  [
    /^(cfl|chicago federation of labor( afl cio)?)$/,
    'chicago federation of labor',
  ],
  [
    /^((international union of )?operating engineers?( iuoe)?|iuoe) local 150( district 1)?$/,
    'iuoe local 150',
  ],
  [
    /^((international union of )?operating engineers?( iuoe)?|iuoe) local 399$/,
    'iuoe local 399',
  ],
  [
    /^((illinois( state)?|il) afl cio|american federation of labor and congress of industrial organizations illinois)$/,
    'illinois afl cio',
  ],
  [/^personal (pac|political action committee)$/, 'personal pac'],
]

/**
 * A comparable endorser name: no accents, case, punctuation, parenthesized
 * acronyms or leading "the", "&" as "and", and known spellings folded
 * ("CFL" and "Chicago Federation of Labor" are one).
 */
export function endorserKey(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '')
  for (const [re, canonical] of ALIASES) if (re.test(base)) return canonical
  return base
}

export const sameEndorser = (a: string, b: string) =>
  endorserKey(a) === endorserKey(b)

/** `${profileKey}|${endorserKey}`: an endorsement a slate or override confirms. */
export const confirmation = (key: string, organization: string) =>
  `${key}|${endorserKey(organization)}`

export interface SharedEndorserRemoval {
  raceKey: string
  key: string
  organization: string
  /** Everyone in the race credited with it. */
  sharedWith: string[]
}

/**
 * For one race: drops each endorser credited to more people than the race
 * has seats from everyone it isn't confirmed for. Returns only the profiles
 * that changed.
 */
export function dropSharedEndorsers(
  raceKey: string,
  race: CandidateProfile[],
  seats: number,
  confirmed: Set<string>,
): { changed: CandidateProfile[]; removed: SharedEndorserRemoval[] } {
  const holders = new Map<string, Set<string>>()
  for (const p of race)
    for (const e of p.endorsements.items) {
      if (e.kind === 'bar_evaluation') continue
      const k = endorserKey(e.organization)
      if (!holders.has(k)) holders.set(k, new Set())
      holders.get(k)?.add(p.key)
    }
  const shared = new Map(
    [...holders].filter(([, keys]) => keys.size > Math.max(1, seats)),
  )
  const removed: SharedEndorserRemoval[] = []
  const changed: CandidateProfile[] = []
  if (shared.size === 0) return { changed, removed }
  for (const p of race) {
    const keep = (e: Endorsement) => {
      if (e.kind === 'bar_evaluation') return true
      const k = endorserKey(e.organization)
      const keys = shared.get(k)
      if (!keys || confirmed.has(`${p.key}|${k}`)) return true
      removed.push({
        raceKey,
        key: p.key,
        organization: e.organization,
        sharedWith: [...keys].sort(),
      })
      return false
    }
    const items = p.endorsements.items.filter(keep)
    if (items.length !== p.endorsements.items.length)
      changed.push({ ...p, endorsements: { ...p.endorsements, items } })
  }
  return { changed, removed }
}
