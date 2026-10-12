// Decides what the published copy in Supabase should hold. A race
// publishes only when every candidate in it has a profile that passed its
// checks, so no one gets a profile before their opponents; a judge up for
// retention stands alone. Pure: publish.ts reads and writes Supabase.

import type { CandidateProfile } from '../../../src/shared/profile.ts'
import { contentHash } from './content.ts'
import type { ProfileCheck } from './review.ts'
import { groupByRace, raceKeysOf, type Subject } from './subjects.ts'

export type RowStatus = 'published' | 'flagged' | 'withdrawn'

/** A row of public.profiles. */
export interface ProfileRow {
  election_id: string
  key: string
  status: RowStatus
  data: CandidateProfile
  version: number
  content_hash: string
  generated_at: string
  published_at: string | null
}

/** What's in the table now (without the data, to keep reads small). */
export type ExistingRow = Pick<
  ProfileRow,
  'key' | 'status' | 'content_hash' | 'version' | 'published_at'
>

/** Why a race is held back, or null when it can publish. */
export function raceBlocker(
  race: Subject[],
  profiles: Map<string, CandidateProfile>,
  checks: Record<string, ProfileCheck>,
): string | null {
  const problems: string[] = []
  for (const s of race) {
    const p = profiles.get(s.key)
    const check = checks[s.key]
    if (!p) problems.push(`${s.name} has no profile`)
    else if (!check || check.contentHash !== contentHash(p))
      problems.push(`${s.name} isn't checked in its current version`)
    else if (check.status !== 'passed') problems.push(`${s.name} is flagged`)
  }
  return problems.length ? problems.join('; ') : null
}

export interface Plan {
  /** Rows to upsert in full (new or changed content, or a new status). */
  upserts: ProfileRow[]
  /** Keys in the table that are no longer on the ballot and have no file. */
  withdraw: string[]
  /** Held-back races and why, for the log. */
  blocked: { raceKey: string; reason: string }[]
  unchanged: number
}

export function planPublish(input: {
  electionId: string
  subjects: Subject[]
  profiles: Map<string, CandidateProfile>
  checks: Record<string, ProfileCheck>
  existing: ExistingRow[]
  now: string
}): Plan {
  const { subjects, profiles, checks, now } = input
  const existing = new Map(input.existing.map((r) => [r.key, r]))

  const blocked: Plan['blocked'] = []
  const blockedRaces = new Set<string>()
  for (const [raceKey, race] of groupByRace(subjects)) {
    const reason = raceBlocker(race, profiles, checks)
    if (reason) {
      blocked.push({ raceKey, reason })
      blockedRaces.add(raceKey)
    }
  }

  const onBallot = new Map(subjects.map((s) => [s.key, s]))
  const upserts: ProfileRow[] = []
  let unchanged = 0
  for (const [key, data] of profiles) {
    const subject = onBallot.get(key)
    const status: RowStatus = !subject
      ? 'withdrawn'
      : raceKeysOf(subject).some((r) => blockedRaces.has(r))
        ? 'flagged'
        : 'published'
    const hash = contentHash(data)
    const prev = existing.get(key)
    if (prev && prev.status === status && prev.content_hash === hash) {
      unchanged++
      continue
    }
    upserts.push({
      election_id: input.electionId,
      key,
      status,
      data,
      version: data.meta.version,
      content_hash: hash,
      generated_at: data.meta.generatedAt,
      // When this content first went live; kept while it stays live.
      published_at:
        status !== 'published'
          ? (prev?.published_at ?? null)
          : prev?.status === 'published' && prev.content_hash === hash
            ? prev.published_at
            : now,
    })
  }

  const withdraw = [...existing.values()]
    .filter(
      (r) =>
        !onBallot.has(r.key) &&
        !profiles.has(r.key) &&
        r.status !== 'withdrawn',
    )
    .map((r) => r.key)

  return { upserts, withdraw, blocked, unchanged }
}
