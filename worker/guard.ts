// Shared protections for the public forms (POST /api/report, POST
// /api/notify): a Turnstile check, a rate limit keyed by a hash of the IP
// address, and a cap on the body size. The IP address is never stored,
// logged or sent anywhere.

export const SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** Requests one IP address may send per window (wrangler.toml [[ratelimits]]). */
export const FORM_LIMIT = 5
export const FORM_PERIOD_SECONDS = 60

const NO_STORE = { 'Cache-Control': 'no-store' }

export const json = (body: unknown, status: number, headers?: HeadersInit) =>
  Response.json(body, { status, headers: { ...NO_STORE, ...headers } })

/**
 * The body as a JSON object, 'too_large' when it is over maxBytes (checked
 * before and after reading), or null when it isn't a JSON object.
 */
export async function readJsonObject(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown> | 'too_large' | null> {
  const length = Number(request.headers.get('Content-Length') ?? 0)
  if (length > maxBytes) return 'too_large'
  const text = await request.text().catch(() => '')
  if (new TextEncoder().encode(text).length > maxBytes) return 'too_large'
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      return parsed as Record<string, unknown>
  } catch {
    // Not JSON.
  }
  return null
}

/** Asks Cloudflare whether the Turnstile token is genuine and unused. */
export async function verifyTurnstile(
  secret: string,
  token: string,
  doFetch: typeof fetch,
): Promise<boolean> {
  // The sender's IP is deliberately not sent (the remoteip field is optional).
  const res = await doFetch(SITEVERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, response: token }),
  })
  if (!res.ok) throw new Error(`siteverify failed with ${res.status}`)
  const outcome = (await res.json()) as { success?: unknown }
  return outcome.success === true
}

/**
 * The rate-limit key for a request: the IP address is never used as is,
 * only as an unreadable counter key. The scope keeps each form's counts apart.
 */
export async function rateLimitKey(
  scope: string,
  request: Request,
): Promise<string> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`votestack-${scope}:${ip}`),
  )
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Stand-in for the Rate Limiting binding (local tests, or a config without
 * it): a fixed window per Worker instance. Keys are already hashed, and old
 * windows are dropped, so nothing about a sender lasts beyond a minute.
 */
export function memoryLimiter(
  limit = FORM_LIMIT,
  periodMs = FORM_PERIOD_SECONDS * 1000,
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
