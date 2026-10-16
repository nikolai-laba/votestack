// Candidate profiles, served from the published copies in Supabase.
// A profile is the same for every voter and involves no address, so unlike
// ballots it can be cached by browsers and Cloudflare.

import type { CandidateProfile } from '../src/shared/profile.ts'
import { REGIONS } from '../src/shared/regions.ts'
import { rpc, type SupabaseConfig } from './supabase.ts'

/** Same shape profileKey() produces; anything else is rejected before the database. */
export const PROFILE_KEY = /^[a-z0-9-]{1,80}$/

const NO_STORE = { 'Cache-Control': 'no-store' }
const CACHEABLE = 'public, max-age=300, stale-while-revalidate=86400'

interface ProfileRow {
  profile: CandidateProfile
  contentHash: string
}

/** GET /api/profile/:key */
export async function profileResponse(
  request: Request,
  key: string,
  config: SupabaseConfig | null,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return Response.json(
      { error: 'Use GET' },
      { status: 405, headers: { ...NO_STORE, Allow: 'GET, HEAD' } },
    )
  }
  if (!PROFILE_KEY.test(key)) {
    return Response.json(
      { error: 'Not a profile key' },
      { status: 400, headers: NO_STORE },
    )
  }
  if (!config) {
    return Response.json(
      { error: 'Profiles are not configured' },
      { status: 503, headers: NO_STORE },
    )
  }

  // Keys are unique across areas, so the first election that has the key
  // is the profile's.
  let row: ProfileRow | null = null
  try {
    for (const region of REGIONS) {
      row = await rpc<ProfileRow | null>(config, 'profile_get', {
        p_election_id: region.election.id,
        p_key: key,
      })
      if (row?.profile) break
    }
  } catch {
    return Response.json(
      { error: 'Profile lookup failed, please try again' },
      { status: 502, headers: NO_STORE },
    )
  }
  if (!row?.profile) {
    return Response.json(
      { error: 'No published profile' },
      { status: 404, headers: NO_STORE },
    )
  }

  const headers = {
    'Cache-Control': CACHEABLE,
    ETag: `"${row.contentHash}"`,
  }
  if (matchesEtag(request.headers.get('If-None-Match'), headers.ETag)) {
    return new Response(null, { status: 304, headers })
  }
  return Response.json(row.profile, { headers })
}

function matchesEtag(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false
  return ifNoneMatch
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''))
    .some((t) => t === etag || t === '*')
}

// Published keys change only when the pipeline publishes, so each Worker
// instance keeps them for a few minutes instead of asking on every lookup.
const KEYS_TTL_MS = 5 * 60 * 1000
const keysCache = new Map<string, { keys: string[]; expires: number }>()

/** Keys of the published profiles in an election, cached for about 5 minutes. */
export async function publishedProfileKeys(
  config: SupabaseConfig,
  electionId: string,
  now = Date.now(),
): Promise<string[]> {
  const cached = keysCache.get(electionId)
  if (cached && cached.expires > now) return cached.keys
  const keys = await rpc<string[] | null>(config, 'published_profile_keys', {
    p_election_id: electionId,
  })
  const list = Array.isArray(keys) ? keys : []
  keysCache.set(electionId, { keys: list, expires: now + KEYS_TTL_MS })
  return list
}

/** For tests. */
export function clearProfileKeysCache() {
  keysCache.clear()
}
