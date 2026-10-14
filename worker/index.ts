// Cloudflare Worker entry. Static files in dist/ are served by Workers static
// assets (see wrangler.toml); only /api/* requests, and page addresses with a
// trailing slash or .html (redirected to the page's own address), reach this
// code.
// Server-side code lives under worker/; API keys are only ever read here, never in src/.

import { coveredAreas } from '../src/shared/regions.ts'
import { SupabaseBallotProvider } from './ballot.ts'
import { json, memoryLimiter, rateLimitKey } from './guard.ts'
import { notifyResponse, type NotifyEnv } from './notify.ts'
import { profileResponse, publishedProfileKeys } from './profile.ts'
import { canonicalRedirect } from './redirects.ts'
import { reportResponse, type ReportEnv } from './report.ts'
import type { SupabaseConfig } from './supabase.ts'

export interface Env extends ReportEnv, NotifyEnv {
  ASSETS: Fetcher
  /** Cloudflare's Rate Limiting binding for lookups. Absent in tests. */
  BALLOT_LIMITER?: RateLimit
  SUPABASE_URL?: string
  SUPABASE_SECRET_KEY?: string
  TURNSTILE_SECRET_KEY?: string
}

// Used only when the REPORT_LIMITER, NOTIFY_LIMITER or BALLOT_LIMITER
// binding is missing (see guard.ts).
let fallbackLimiter: RateLimit | null = null
let notifyFallbackLimiter: RateLimit | null = null
let ballotFallbackLimiter: RateLimit | null = null

/**
 * Lookups one visitor may make per minute (wrangler.toml [[ratelimits]]):
 * far more than a person types, few enough that a script can't slow the
 * database for everyone.
 */
const BALLOT_LIMIT = 30

/** For tests: start the fallback rate limits afresh. */
export function resetFallbackLimiter() {
  fallbackLimiter = null
  notifyFallbackLimiter = null
  ballotFallbackLimiter = null
}

// Ballot responses are about one voter's address: never cache them anywhere.
const PRIVATE = { 'Cache-Control': 'no-store' }

function supabaseConfig(env: Env): SupabaseConfig | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return null
  return { url: env.SUPABASE_URL, secretKey: env.SUPABASE_SECRET_KEY }
}

/**
 * POST /api/ballot with {"address": "..."}. The address goes in the body
 * (never the URL) and is not logged or stored.
 */
async function ballot(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json(
      { error: 'Use POST' },
      { status: 405, headers: { ...PRIVATE, Allow: 'POST' } },
    )
  }
  // Keyed by a hash of the IP address, never the address typed in.
  ballotFallbackLimiter ??= memoryLimiter(BALLOT_LIMIT)
  const limiter = env.BALLOT_LIMITER ?? ballotFallbackLimiter
  const { success } = await limiter.limit({
    key: await rateLimitKey('ballot', request),
  })
  if (!success) {
    return json({ error: 'Too many lookups, try again in a minute' }, 429, {
      'Retry-After': '60',
    })
  }
  const config = supabaseConfig(env)
  if (!config) {
    return Response.json(
      { error: 'Ballot lookup is not configured' },
      { status: 503, headers: PRIVATE },
    )
  }
  const body = (await request.json().catch(() => null)) as {
    address?: unknown
  } | null
  const address = typeof body?.address === 'string' ? body.address.trim() : ''
  if (address.length < 5 || address.length > 200) {
    return Response.json(
      { error: 'Enter a street address' },
      { status: 400, headers: PRIVATE },
    )
  }
  const provider = new SupabaseBallotProvider(config)
  try {
    const result = await provider.getBallot({ address })
    if (!result) {
      return Response.json(
        { error: `We could not find that address in ${coveredAreas()}` },
        { status: 404, headers: PRIVATE },
      )
    }
    // Which candidates have a profile (cached per election). If it fails,
    // the ballot is returned without links: profiles never break lookup.
    const publishedProfiles = await publishedProfileKeys(
      config,
      result.election.id,
    ).catch(() => undefined)
    return Response.json(
      publishedProfiles ? { ...result, publishedProfiles } : result,
      { headers: PRIVATE },
    )
  } catch {
    // Deliberately no logging of the error details: they could include the address.
    return Response.json(
      { error: 'Ballot lookup failed, please try again' },
      { status: 502, headers: PRIVATE },
    )
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)

    if (pathname === '/api/health') {
      return Response.json({ status: 'ok' })
    }
    if (pathname === '/api/ballot') {
      return ballot(request, env)
    }
    if (pathname === '/api/report') {
      fallbackLimiter ??= memoryLimiter()
      return reportResponse(request, {
        supabase: supabaseConfig(env),
        turnstileSecret: env.TURNSTILE_SECRET_KEY,
        limiter: env.REPORT_LIMITER ?? fallbackLimiter,
      })
    }
    if (pathname === '/api/notify') {
      notifyFallbackLimiter ??= memoryLimiter()
      return notifyResponse(request, {
        supabase: supabaseConfig(env),
        turnstileSecret: env.TURNSTILE_SECRET_KEY,
        limiter: env.NOTIFY_LIMITER ?? notifyFallbackLimiter,
      })
    }
    if (pathname.startsWith('/api/profile/')) {
      const key = pathname.slice('/api/profile/'.length)
      return profileResponse(request, key, supabaseConfig(env))
    }
    if (pathname.startsWith('/api/')) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    return canonicalRedirect(request) ?? env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
