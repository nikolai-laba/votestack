// Records one failed ballot lookup as an expansion signal: just the 5-digit
// ZIP and whether that ZIP is inside a VoteStack region. No email address,
// no IP address, no street address is ever stored. See
// supabase/migrations/20261021000000_expansion_lookups.sql.

import { parseAddress } from '../src/shared/address.ts'
import { isAutomatedAgent } from '../src/shared/metrics.ts'
import { normalizeZip } from '../src/shared/notify.ts'
import { REGIONS } from '../src/shared/regions.ts'
import { rpc, type SupabaseConfig } from './supabase.ts'

/** True when the ZIP's first two digits match a region VoteStack covers. */
export function isCoveredZip(zip: string, regions = REGIONS): boolean {
  const prefix = zip.slice(0, 2)
  return regions.some((r) => r.zipPrefixes.includes(prefix))
}

/**
 * Writes one expansion signal to Supabase. Skipped silently when the request
 * is from a crawler or the address can't be parsed to a 5-digit ZIP. Errors
 * are swallowed: this is best-effort analytics, never the voter's path.
 */
export async function recordExpansionLookup(
  supabase: SupabaseConfig,
  request: Request,
  address: string,
): Promise<void> {
  const cf = (request as { cf?: { verifiedBotCategory?: string } }).cf
  if (
    isAutomatedAgent(request.headers.get('User-Agent')) ||
    cf?.verifiedBotCategory
  )
    return
  const parsed = parseAddress(address)
  const zip = parsed?.zip ? normalizeZip(parsed.zip) : null
  if (!zip) return
  try {
    await rpc<boolean>(supabase, 'record_expansion_lookup', {
      p_zip: zip,
      p_covered: isCoveredZip(zip),
    })
  } catch {
    // Never block the voter on an analytics write.
  }
}
