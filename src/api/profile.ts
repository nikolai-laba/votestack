// Client for the Worker's GET /api/profile/:key. Profiles are public and the
// same for every voter, so the browser may cache them (no address involved).

import type { CandidateProfile } from '../shared/profile.ts'

export type ProfileErrorKind = 'not_found' | 'unavailable'

export class ProfileLoadError extends Error {
  readonly kind: ProfileErrorKind

  constructor(kind: ProfileErrorKind) {
    super(kind)
    this.kind = kind
  }
}

/** Same rule as the Worker's: lowercase letters, digits and hyphens. */
export const isProfileKey = (key: string) => /^[a-z0-9-]{1,80}$/.test(key)

export async function fetchProfile(key: string): Promise<CandidateProfile> {
  if (!isProfileKey(key)) throw new ProfileLoadError('not_found')
  let res: Response
  try {
    res = await fetch(`/api/profile/${key}`)
  } catch {
    throw new ProfileLoadError('unavailable')
  }
  if (res.status === 404 || res.status === 400)
    throw new ProfileLoadError('not_found')
  if (!res.ok) throw new ProfileLoadError('unavailable')
  return (await res.json()) as CandidateProfile
}
