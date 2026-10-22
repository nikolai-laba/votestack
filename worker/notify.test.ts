// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { memoryLimiter, SITEVERIFY_URL } from './guard.ts'
import worker, { resetFallbackLimiter, type Env } from './index.ts'
import { notifyResponse, type NotifyDeps } from './notify.ts'

const valid = {
  email: 'Pat@Example.com',
  zip: '53703',
  turnstileToken: 'token-123',
}

/** Fake siteverify and Supabase, recording what each was sent. */
function fakeServices({
  turnstile = { success: true } as unknown,
  submit = true as unknown,
} = {}) {
  const calls: { url: string; body: Record<string, unknown> }[] = []
  const fetch = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      calls.push({ url: String(url), body })
      const answer = String(url) === SITEVERIFY_URL ? turnstile : submit
      return answer instanceof Response ? answer : Response.json(answer)
    },
  ) as unknown as typeof globalThis.fetch
  return { fetch, calls }
}

function deps(
  fetch: typeof globalThis.fetch,
  overrides: Partial<NotifyDeps> = {},
): NotifyDeps {
  return {
    supabase: { url: 'https://db.example', secretKey: 'test', fetch },
    turnstileSecret: 'secret',
    limiter: memoryLimiter(),
    fetch,
    ...overrides,
  }
}

const post = (body: unknown, ip = '203.0.113.7') =>
  new Request('https://votestack.org/api/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

describe('notifyResponse', () => {
  it('verifies the token, stores the sign-up and answers 201', async () => {
    const { fetch, calls } = fakeServices()
    const res = await notifyResponse(
      post({ ...valid, source: 'profile' }),
      deps(fetch),
    )

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ ok: true })
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(calls[0]).toEqual({
      url: SITEVERIFY_URL,
      body: { secret: 'secret', response: 'token-123' },
    })
    expect(calls[1]).toEqual({
      url: 'https://db.example/rest/v1/rpc/submit_signup',
      body: { p_email: 'pat@example.com', p_zip: '53703', p_source: 'profile' },
    })
  })

  it('stores only the 5-digit ZIP code and a trimmed address', async () => {
    const { fetch, calls } = fakeServices()
    const res = await notifyResponse(
      post({ ...valid, email: '  pat@example.com ', zip: ' 53703-1234 ' }),
      deps(fetch),
    )
    expect(res.status).toBe(201)
    expect(calls[1].body).toEqual({
      p_email: 'pat@example.com',
      p_zip: '53703',
      p_source: null,
    })
  })

  it('stores an unknown or missing source as null, never refusing the sign-up', async () => {
    for (const source of [undefined, 'footer', 7]) {
      const { fetch, calls } = fakeServices()
      const res = await notifyResponse(post({ ...valid, source }), deps(fetch))
      expect(res.status).toBe(201)
      expect(calls[1].body.p_source).toBeNull()
    }
  })

  it('never sends the IP address anywhere', async () => {
    const { fetch, calls } = fakeServices()
    await notifyResponse(post(valid, '198.51.100.23'), deps(fetch))
    expect(JSON.stringify(calls)).not.toContain('198.51.100.23')
  })

  it('answers 400 with an error for each bad field', async () => {
    const { fetch, calls } = fakeServices()
    for (const [body, bad] of [
      [{ ...valid, email: 'not-an-email' }, ['email']],
      [{ ...valid, email: '' }, ['email']],
      [{ ...valid, email: 42 }, ['email']],
      [{ ...valid, email: `${'a'.repeat(250)}@x.org` }, ['email']],
      [{ ...valid, zip: '6030' }, ['zip']],
      [{ ...valid, zip: 'ABCDE' }, ['zip']],
      [{ turnstileToken: 'token-123' }, ['email', 'zip']],
    ] as const) {
      const res = await notifyResponse(post(body), deps(fetch))
      expect(res.status).toBe(400)
      const answer = (await res.json()) as { fields: Record<string, string> }
      expect(Object.keys(answer.fields).sort()).toEqual(bad)
    }
    // Nothing reaches Turnstile or the database.
    expect(calls).toEqual([])
  })

  it('rejects bodies that are not a JSON object, or have no token', async () => {
    const { fetch, calls } = fakeServices()
    for (const body of ['not json', '[1,2]', 'null']) {
      const res = await notifyResponse(post(body), deps(fetch))
      expect(res.status).toBe(400)
    }
    const res = await notifyResponse(
      post({ ...valid, turnstileToken: '' }),
      deps(fetch),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).not.toHaveProperty('fields')
    expect(calls).toEqual([])
  })

  it('answers 413 for a body over 4 KiB', async () => {
    const { fetch, calls } = fakeServices()
    const res = await notifyResponse(
      post({ ...valid, padding: 'x'.repeat(5000) }),
      deps(fetch),
    )
    expect(res.status).toBe(413)
    expect(calls).toEqual([])
  })

  it('answers 403 when Turnstile says no, and stores nothing', async () => {
    const { fetch, calls } = fakeServices({
      turnstile: { success: false, 'error-codes': ['timeout-or-duplicate'] },
    })
    const res = await notifyResponse(post(valid), deps(fetch))
    expect(res.status).toBe(403)
    expect(calls.map((c) => c.url)).toEqual([SITEVERIFY_URL])
  })

  it('answers 502 when Turnstile cannot be reached', async () => {
    const { fetch } = fakeServices({
      turnstile: new Response('down', { status: 500 }),
    })
    const res = await notifyResponse(post(valid), deps(fetch))
    expect(res.status).toBe(502)
  })

  it('answers 502 without the address when the database fails', async () => {
    const { fetch } = fakeServices({
      submit: new Response('boom', { status: 500 }),
    })
    const res = await notifyResponse(post(valid), deps(fetch))
    expect(res.status).toBe(502)
    expect((await res.text()).toLowerCase()).not.toContain('pat@example.com')
  })

  it('answers the same for an address that is already signed up', async () => {
    const { fetch } = fakeServices()
    const d = deps(fetch)
    const first = await notifyResponse(post(valid), d)
    const again = await notifyResponse(post({ ...valid, zip: '53704' }), d)
    expect(again.status).toBe(first.status)
    expect(await again.json()).toEqual(await first.json())
  })

  it('limits each visitor to 5 sign-ups a minute', async () => {
    const { fetch, calls } = fakeServices()
    const d = deps(fetch)
    const statuses = []
    for (let i = 0; i < 6; i++)
      statuses.push((await notifyResponse(post(valid), d)).status)
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429])
    // The sixth never reached Turnstile or the database.
    expect(calls).toHaveLength(10)
    // Another visitor is not affected.
    const other = await notifyResponse(post(valid, '192.0.2.1'), d)
    expect(other.status).toBe(201)
  })

  it('keys the limiter by a hash, never the IP address itself', async () => {
    const { fetch } = fakeServices()
    const limit = vi.fn(async () => ({ success: true }))
    await notifyResponse(
      post(valid, '203.0.113.7'),
      deps(fetch, { limiter: { limit } }),
    )
    const key = (limit.mock.calls[0] as unknown as [{ key: string }])[0].key
    expect(key).toMatch(/^[0-9a-f]{32}$/)
    expect(key).not.toContain('203.0.113.7')
  })

  it('is 503 until Turnstile and Supabase are configured', async () => {
    const { fetch } = fakeServices()
    for (const overrides of [
      { turnstileSecret: undefined },
      { supabase: null },
    ]) {
      const res = await notifyResponse(post(valid), deps(fetch, overrides))
      expect(res.status).toBe(503)
    }
  })

  it('only accepts POST', async () => {
    const { fetch } = fakeServices()
    const res = await notifyResponse(
      new Request('https://votestack.org/api/notify'),
      deps(fetch),
    )
    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toBe('POST')
  })
})

describe('POST /api/notify through the Worker', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetFallbackLimiter()
  })

  const env = (extra: Partial<Env> = {}) =>
    ({
      ASSETS: { fetch: vi.fn() },
      SUPABASE_URL: 'https://db.example',
      SUPABASE_SECRET_KEY: 'test',
      TURNSTILE_SECRET_KEY: 'secret',
      ...extra,
    }) as unknown as Env

  const ctx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext

  const send = (e: Env) =>
    worker.fetch(post(valid) as Parameters<typeof worker.fetch>[0], e, ctx)

  it('uses the NOTIFY_LIMITER binding when it exists', async () => {
    const { fetch } = fakeServices()
    vi.stubGlobal('fetch', fetch)
    const notify = vi.fn(async () => ({ success: false }))
    const report = vi.fn(async () => ({ success: true }))
    const res = await send(
      env({
        NOTIFY_LIMITER: { limit: notify },
        REPORT_LIMITER: { limit: report },
      }),
    )
    expect(res.status).toBe(429)
    expect(notify).toHaveBeenCalledOnce()
    expect(report).not.toHaveBeenCalled()
  })

  it('falls back to the per-instance limiter without it', async () => {
    const { fetch } = fakeServices()
    vi.stubGlobal('fetch', fetch)
    expect((await send(env())).status).toBe(201)
  })

  it('is 503 without the Turnstile secret', async () => {
    const res = await send(env({ TURNSTILE_SECRET_KEY: undefined }))
    expect(res.status).toBe(503)
  })
})
