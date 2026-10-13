// "Tell me when VoteStack reaches my area": POST /api/notify.
//
// Order of checks: configuration, rate limit, body, Turnstile, then the
// database. Only the email address and ZIP code are stored. The IP address is
// used only, hashed, as the rate-limit key, and the email address is never
// logged or put in an error.

import {
  normalizeEmail,
  normalizeZip,
  validateEmail,
  validateZip,
  type SignupField,
} from '../src/shared/notify.ts'
import { TURNSTILE_TOKEN_MAX } from '../src/shared/report.ts'
import {
  FORM_PERIOD_SECONDS,
  json,
  rateLimitKey,
  readJsonObject,
  verifyTurnstile,
} from './guard.ts'
import { rpc, type SupabaseConfig } from './supabase.ts'

/** Larger bodies are refused before they are read. */
const MAX_BODY_BYTES = 4 * 1024

export interface NotifyEnv {
  /** Cloudflare's Rate Limiting binding. Absent in tests and older configs. */
  NOTIFY_LIMITER?: RateLimit
}

export interface NotifyDeps {
  supabase: SupabaseConfig | null
  turnstileSecret: string | undefined
  limiter: RateLimit
  fetch?: typeof fetch
}

/** POST /api/notify */
export async function notifyResponse(
  request: Request,
  deps: NotifyDeps,
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Use POST' }, 405, { Allow: 'POST' })
  }
  if (!deps.supabase || !deps.turnstileSecret) {
    return json({ error: 'Sign-up is not available yet' }, 503)
  }

  const { success } = await deps.limiter.limit({
    key: await rateLimitKey('notify', request),
  })
  if (!success) {
    return json({ error: 'Too many sign-ups, try again in a minute' }, 429, {
      'Retry-After': String(FORM_PERIOD_SECONDS),
    })
  }

  const body = await readJsonObject(request, MAX_BODY_BYTES)
  if (body === 'too_large') {
    return json({ error: 'Sign-up is too long' }, 413)
  }
  if (!body) return json({ error: 'Send the sign-up as JSON' }, 400)

  const fields: Partial<Record<SignupField, string>> = {}
  const emailError = validateEmail(body.email)
  if (emailError) fields.email = emailError
  const zipError = validateZip(body.zip)
  if (zipError) fields.zip = zipError
  if (Object.keys(fields).length > 0) {
    return json({ error: 'Check the sign-up', fields }, 400)
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

  try {
    // The same answer whether the address is new or already signed up, so
    // the form never reveals who has signed up.
    await rpc<boolean>(deps.supabase, 'submit_expansion_signup', {
      p_email: normalizeEmail(body.email as string),
      p_zip: normalizeZip(body.zip as string),
    })
  } catch {
    // No details: the error could echo the email address.
    return json({ error: 'Could not save the sign-up, please try again' }, 502)
  }
  return json({ ok: true }, 201)
}
