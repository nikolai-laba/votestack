// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { resetFallbackLimiter, type Env } from './index.ts'
import {
  memoryLimiter,
  reportResponse,
  SITEVERIFY_URL,
  type ReportDeps,
} from './report.ts'

const valid = {
  key: 'jane-doe',
  section: 'money',
  message: 'The cash on hand is from the wrong quarter.',
  sourceUrl: 'https://elections.il.gov/example',
  turnstileToken: 'token-123',
}

/** Fake siteverify and Supabase, recording what each was sent. */
function fakeServices({
  turnstile = { success: true } as unknown,
  submit = 42 as unknown,
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
  overrides: Partial<ReportDeps> = {},
): ReportDeps {
  return {
    supabase: { url: 'https://db.example', secretKey: 'test', fetch },
    turnstileSecret: 'secret',
    limiter: memoryLimiter(),
    fetch,
    ...overrides,
  }
}

const post = (body: unknown, ip = '203.0.113.7') =>
  new Request('https://votestack.org/api/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

describe('reportResponse', () => {
  it('verifies the token, stores the report and answers 201', async () => {
    const { fetch, calls } = fakeServices()
    const res = await reportResponse(post(valid), deps(fetch))

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ ok: true })
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(calls[0]).toEqual({
      url: SITEVERIFY_URL,
      body: { secret: 'secret', response: 'token-123' },
    })
    expect(calls[1].url).toBe(
      'https://db.example/rest/v1/rpc/submit_profile_report',
    )
    expect(calls[1].body).toEqual({
      p_election_id: 'il-2026-11-03-general',
      p_key: 'jane-doe',
      p_section: 'money',
      p_message: 'The cash on hand is from the wrong quarter.',
      p_source_url: 'https://elections.il.gov/example',
    })
  })

  it('never sends the reader’s IP address anywhere', async () => {
    const { fetch, calls } = fakeServices()
    await reportResponse(post(valid, '198.51.100.23'), deps(fetch))
    expect(JSON.stringify(calls)).not.toContain('198.51.100.23')
  })

  it('answers 400 when the source link is missing or empty', async () => {
    const { fetch, calls } = fakeServices()
    const withoutLink: Record<string, unknown> = { ...valid }
    delete withoutLink.sourceUrl
    for (const body of [
      withoutLink,
      { ...valid, sourceUrl: '  ' },
      { ...valid, sourceUrl: null },
    ]) {
      const res = await reportResponse(post(body), deps(fetch))
      expect(res.status).toBe(400)
      const answer = (await res.json()) as { fields: Record<string, string> }
      expect(Object.keys(answer.fields)).toEqual(['sourceUrl'])
    }
    expect(calls).toEqual([])
  })

  it('answers 400 for a link that is not http or https', async () => {
    const { fetch, calls } = fakeServices()
    for (const sourceUrl of [
      'elections.il.gov/x',
      'ftp://elections.il.gov/x',
      'mailto:a@b.org',
      42,
    ]) {
      const res = await reportResponse(
        post({ ...valid, sourceUrl }),
        deps(fetch),
      )
      expect(res.status).toBe(400)
    }
    expect(calls).toEqual([])
  })

  it('stores the link normalized', async () => {
    const { fetch, calls } = fakeServices()
    const res = await reportResponse(
      post({ ...valid, sourceUrl: '  https://Elections.IL.gov/x  ' }),
      deps(fetch),
    )
    expect(res.status).toBe(201)
    expect(calls[1].body.p_source_url).toBe('https://elections.il.gov/x')
  })

  it('answers 400 with an error for each bad field', async () => {
    const { fetch, calls } = fakeServices()
    const res = await reportResponse(
      post({
        ...valid,
        section: 'photos',
        message: '   ',
        sourceUrl: 'javascript:alert(1)',
      }),
      deps(fetch),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { fields: Record<string, string> }
    expect(Object.keys(body.fields).sort()).toEqual([
      'message',
      'section',
      'sourceUrl',
    ])
    // Nothing reaches Turnstile or the database.
    expect(calls).toEqual([])
  })

  it('rejects messages over 2,000 characters and bad keys', async () => {
    const { fetch } = fakeServices()
    const long = await reportResponse(
      post({ ...valid, message: 'a'.repeat(2001) }),
      deps(fetch),
    )
    expect(long.status).toBe(400)
    const exactly = await reportResponse(
      post({ ...valid, message: 'é'.repeat(2000) }),
      deps(fetch),
    )
    expect(exactly.status).toBe(201)
    for (const key of ['', 'Jane-Doe', '../x', 'a'.repeat(81)]) {
      const res = await reportResponse(post({ ...valid, key }), deps(fetch))
      expect(res.status).toBe(400)
    }
  })

  it('rejects bodies that are not a JSON object, or have no token', async () => {
    const { fetch } = fakeServices()
    for (const body of ['not json', '[1,2]', 'null']) {
      const res = await reportResponse(post(body), deps(fetch))
      expect(res.status).toBe(400)
    }
    const res = await reportResponse(
      post({ ...valid, turnstileToken: '' }),
      deps(fetch),
    )
    expect(res.status).toBe(400)
  })

  it('answers 403 when Turnstile says no, and stores nothing', async () => {
    const { fetch, calls } = fakeServices({
      turnstile: { success: false, 'error-codes': ['timeout-or-duplicate'] },
    })
    const res = await reportResponse(post(valid), deps(fetch))
    expect(res.status).toBe(403)
    expect(calls.map((c) => c.url)).toEqual([SITEVERIFY_URL])
  })

  it('answers 502 when Turnstile cannot be reached', async () => {
    const { fetch } = fakeServices({
      turnstile: new Response('down', { status: 500 }),
    })
    const res = await reportResponse(post(valid), deps(fetch))
    expect(res.status).toBe(502)
  })

  it('is 404 for a profile that is not published', async () => {
    const { fetch } = fakeServices({ submit: null })
    const res = await reportResponse(post(valid), deps(fetch))
    expect(res.status).toBe(404)
  })

  it('answers 502 without the message when the database fails', async () => {
    const { fetch } = fakeServices({
      submit: new Response('boom', { status: 500 }),
    })
    const res = await reportResponse(post(valid), deps(fetch))
    expect(res.status).toBe(502)
    expect(await res.text()).not.toContain('wrong quarter')
  })

  it('limits each reader to 5 reports a minute', async () => {
    const { fetch, calls } = fakeServices()
    const d = deps(fetch)
    const statuses = []
    for (let i = 0; i < 6; i++)
      statuses.push((await reportResponse(post(valid), d)).status)
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429])
    // The sixth never reached Turnstile or the database.
    expect(calls).toHaveLength(10)
    // Another reader is not affected.
    const other = await reportResponse(post(valid, '192.0.2.1'), d)
    expect(other.status).toBe(201)
  })

  it('keys the limiter by a hash, never the IP address itself', async () => {
    const { fetch } = fakeServices()
    const limit = vi.fn(async () => ({ success: true }))
    await reportResponse(
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
      const res = await reportResponse(post(valid), deps(fetch, overrides))
      expect(res.status).toBe(503)
    }
  })

  it('only accepts POST', async () => {
    const { fetch } = fakeServices()
    const res = await reportResponse(
      new Request('https://votestack.org/api/report'),
      deps(fetch),
    )
    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toBe('POST')
  })
})

describe('memoryLimiter', () => {
  it('starts a new window after the period', async () => {
    let t = 0
    const limiter = memoryLimiter(1, 60_000, () => t)
    expect((await limiter.limit({ key: 'a' })).success).toBe(true)
    expect((await limiter.limit({ key: 'a' })).success).toBe(false)
    t = 60_000
    expect((await limiter.limit({ key: 'a' })).success).toBe(true)
  })
})

describe('POST /api/report through the Worker', () => {
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

  it('uses the REPORT_LIMITER binding when it exists', async () => {
    const { fetch } = fakeServices()
    vi.stubGlobal('fetch', fetch)
    const limit = vi.fn(async () => ({ success: false }))
    const res = await send(env({ REPORT_LIMITER: { limit } }))
    expect(res.status).toBe(429)
    expect(limit).toHaveBeenCalledOnce()
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
