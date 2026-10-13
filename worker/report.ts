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
import {
  FORM_PERIOD_SECONDS,
  json,
  rateLimitKey,
  readJsonObject,
  verifyTurnstile,
} from './guard.ts'
import { PROFILE_KEY } from './profile.ts'
import { rpc, type SupabaseConfig } from './supabase.ts'

export { memoryLimiter, SITEVERIFY_URL } from './guard.ts'

/** Larger bodies are refused before they are read. */
const MAX_BODY_BYTES = 16 * 1024

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

  const { success } = await deps.limiter.limit({
    key: await rateLimitKey('report', request),
  })
  if (!success) {
    return json({ error: 'Too many reports, try again in a minute' }, 429, {
      'Retry-After': String(FORM_PERIOD_SECONDS),
    })
  }

  const body = await readJsonObject(request, MAX_BODY_BYTES)
  if (body === 'too_large') {
    return json({ error: 'Report is too long' }, 413)
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
