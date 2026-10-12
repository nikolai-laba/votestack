// "Report an error" on candidate profiles: POST /api/report.
//
// Order of checks: configuration, rate limit, body, Turnstile, then the
// database (which also refuses reports on profiles that aren't published).
// Nothing about the reader is stored or logged: the IP address is only used,
// hashed, as the rate-limit key, and the message is never logged.

import { CURRENT_ELECTION } from '../src/shared/cook.ts'
import {
  parseSourceUrl,
  TURNSTILE_TOKEN_MAX,
  validateMessage,
  validateSection,
  validateSourceUrl,
  type ReportField,
} from '../src/shared/report.ts'
import { PROFILE_KEY } from './profile.ts'
import { rpc, type SupabaseConfig } from './supabase.ts'

export const SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** Reports one IP address may send per window (wrangler.toml [[ratelimits]]). */
export const REPORT_LIMIT = 5
export const REPORT_PERIOD_SECONDS = 60
/** Larger bodies are refused before they are read. */
const MAX_BODY_BYTES = 16 * 1024

const NO_STORE = { 'Cache-Control': 'no-store' }

export interface ReportEnv {
  /** Cloudflare's Rate Limiting binding. Absent in tests and older configs. */
  REPORT_LIMITER?: RateLimit
}

export interface ReportDeps {
  supabase: SupabaseConfig | null
  turnstileSecret: string | undefined
  limiter: RateLimit
  fetch?: typeof fetch
}

const json = (body: unknown, status: number, headers?: HeadersInit) =>
  Response.json(body, { status, headers: { ...NO_STORE, ...headers } })

/** POST /api/report */
export async function reportResponse(
  request: Request,
  deps: ReportDeps,
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Use POST' }, 405, { Allow: 'POST' })
  }
  if (!deps.supabase || !deps.turnstileSecret) {
    return json({ error: 'Error reports are not available yet' }, 503)
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  const { success } = await deps.limiter.limit({ key: await hashKey(ip) })
  if (!success) {
    return json({ error: 'Too many reports, try again in a minute' }, 429, {
      'Retry-After': String(REPORT_PERIOD_SECONDS),
    })
  }

  const length = Number(request.headers.get('Content-Length') ?? 0)
  if (length > MAX_BODY_BYTES) {
    return json({ error: 'Report is too long' }, 413)
  }
  const text = await request.text().catch(() => '')
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return json({ error: 'Report is too long' }, 413)
  }
  let body: Record<string, unknown> | null = null
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      body = parsed as Record<string, unknown>
  } catch {
    // Handled below.
  }
  if (!body) return json({ error: 'Send the report as JSON' }, 400)

  const key = typeof body.key === 'string' ? body.key : ''
  if (!PROFILE_KEY.test(key)) {
    return json({ error: 'Not a profile key' }, 400)
  }
  const fields: Partial<Record<ReportField, string>> = {}
  const sectionError = validateSection(body.section)
  if (sectionError) fields.section = sectionError
  const messageError = validateMessage(body.message)
  if (messageError) fields.message = messageError
  const urlError = validateSourceUrl(body.sourceUrl)
  if (urlError) fields.sourceUrl = urlError
  if (Object.keys(fields).length > 0) {
    return json({ error: 'Check the report', fields }, 400)
  }
  const token = body.turnstileToken
  if (
    typeof token !== 'string' ||
    !token ||
    token.length > TURNSTILE_TOKEN_MAX
  ) {
    return json({ error: 'Missing verification' }, 400)
  }

  let verified: boolean
  try {
    verified = await verifyTurnstile(
      deps.turnstileSecret,
      token,
      deps.fetch ?? fetch,
    )
  } catch {
    return json({ error: 'Verification failed, please try again' }, 502)
  }
  if (!verified) {
    return json({ error: 'Verification failed, please try again' }, 403)
  }

  let id: number | null
  try {
    id = await rpc<number | null>(deps.supabase, 'submit_profile_report', {
      p_election_id: CURRENT_ELECTION.id,
      p_key: key,
      p_section: body.section,
      p_message: (body.message as string).trim(),
      // Validated above, so this is the normalized link.
      p_source_url: parseSourceUrl(body.sourceUrl as string),
    })
  } catch {
    // No details: the error could echo the message.
    return json({ error: 'Could not save the report, please try again' }, 502)
  }
  if (id === null || id === undefined) {
    return json({ error: 'No published profile' }, 404)
  }
  return json({ ok: true }, 201)
}

/** Asks Cloudflare whether the Turnstile token is genuine and unused. */
export async function verifyTurnstile(
  secret: string,
  token: string,
  doFetch: typeof fetch,
): Promise<boolean> {
  // The reader's IP is deliberately not sent (the remoteip field is optional).
  const res = await doFetch(SITEVERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, response: token }),
  })
  if (!res.ok) throw new Error(`siteverify failed with ${res.status}`)
  const outcome = (await res.json()) as { success?: unknown }
  return outcome.success === true
}

/** The IP address is never used as is, only as an unreadable counter key. */
async function hashKey(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`votestack-report:${ip}`),
  )
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Stand-in for the Rate Limiting binding (local tests, or a config without
 * it): a fixed window per Worker instance. Keys are already hashed, and old
 * windows are dropped, so nothing about a reader lasts beyond a minute.
 */
export function memoryLimiter(
  limit = REPORT_LIMIT,
  periodMs = REPORT_PERIOD_SECONDS * 1000,
  now: () => number = Date.now,
): RateLimit {
  let windowStart = 0
  let counts = new Map<string, number>()
  return {
    async limit({ key }) {
      const t = now()
      if (t - windowStart >= periodMs) {
        windowStart = t
        counts = new Map()
      }
      const count = (counts.get(key) ?? 0) + 1
      counts.set(key, count)
      return { success: count <= limit }
    },
  }
}
