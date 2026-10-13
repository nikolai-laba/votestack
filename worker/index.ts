// Cloudflare Worker entry. Static files in dist/ are served by Workers static
// assets (see wrangler.toml); only /api/* requests reach this code.
// Server-side code lives under worker/; API keys are only ever read here, never in src/.

import { CURRENT_ELECTION } from '../src/shared/cook.ts'
import { SupabaseBallotProvider } from './ballot.ts'
import { memoryLimiter } from './guard.ts'
import { notifyResponse, type NotifyEnv } from './notify.ts'
import { profileResponse, publishedProfileKeys } from './profile.ts'
import { reportResponse, type ReportEnv } from './report.ts'
import type { SupabaseConfig } from './supabase.ts'

export interface Env extends ReportEnv, NotifyEnv {
  ASSETS: Fetcher
  SUPABASE_URL?: string
  SUPABASE_SECRET_KEY?: string
  TURNSTILE_SECRET_KEY?: string
}

// Used only when the REPORT_LIMITER or NOTIFY_LIMITER binding is missing
// (see guard.ts).
let fallbackLimiter: RateLimit | null = null
let notifyFallbackLimiter: RateLimit | null = null

/** For tests: start the fallback rate limits afresh. */
export function resetFallbackLimiter() {
  fallbackLimiter = null
  notifyFallbackLimiter = null
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
  // Which candidates have a profile. Fetched alongside the lookup; if it
  // fails, the ballot is returned without links: profiles never break lookup.
  const profiles = publishedProfileKeys(config, CURRENT_ELECTION.id).catch(
    () => undefined,
  )
  try {
    const result = await provider.getBallot({ address })
    if (!result) {
      return Response.json(
        { error: 'We could not find that address in Cook County' },
        { status: 404, headers: PRIVATE },
      )
    }
    const publishedProfiles = await profiles
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
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
