// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ballot } from '../src/shared/ballot.ts'
import * as entry from './index.ts'
import worker, { resetFallbackLimiter, type Env } from './index.ts'
import { clearProfileKeysCache } from './profile.ts'

function makeEnv() {
  const assetsFetch = vi.fn(async () => new Response('asset'))
  const env = { ASSETS: { fetch: assetsFetch } } as unknown as Env
  return { env, assetsFetch }
}

function call(path: string, env: Env, init?: RequestInit) {
  const request = new Request(`https://votestack.org${path}`, init)
  return worker.fetch(request as Parameters<typeof worker.fetch>[0], env)
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
})

/** Answers Supabase RPCs by function name through the global fetch. */
function stubSupabase(answers: Record<string, unknown>) {
  const fetch = vi.fn(async (url: string | URL | Request) => {
    const answer = answers[String(url).split('/rpc/')[1]]
    return answer instanceof Response ? answer : Response.json(answer)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const configured = () => {
  const { env } = makeEnv()
  return {
    ...env,
    SUPABASE_URL: 'https://db.example',
    SUPABASE_SECRET_KEY: 'test',
  } as Env
}

const lookup = {
  street_points: [
    {
      number: 834,
      street_type: 'ST',
      city: 'OAK PARK',
      zip: '60301',
      lat: 41.8892,
      lng: -87.7965,
    },
  ],
  districts_at: {
    precinct: { id: 'cook:8500022', name: 'Oak Park 22' },
    districts: [],
  },
  contests_for: { contests: [], unplaced: [] },
}

beforeEach(() => {
  clearProfileKeysCache()
  resetFallbackLimiter()
})
afterEach(() => vi.unstubAllGlobals())

describe('worker', () => {
  it('exports only functions and the handler (the Workers runtime refuses anything else)', () => {
    for (const [name, value] of Object.entries(entry))
      expect(typeof value, name).toMatch(/^(function|object)$/)
    const { default: _, ...named } = entry
    for (const [name, value] of Object.entries(named))
      expect(typeof value, name).toBe('function')
  })

  it('answers the health check', async () => {
    const { env } = makeEnv()
    const response = await call('/api/health', env)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('returns JSON 404 for unknown API routes', async () => {
    const { env, assetsFetch } = makeEnv()
    const response = await call('/api/nope', env)
    expect(response.status).toBe(404)
    expect(assetsFetch).not.toHaveBeenCalled()
  })

  it('falls through to static assets for everything else', async () => {
    const { env, assetsFetch } = makeEnv()
    const response = await call('/elections', env)
    expect(await response.text()).toBe('asset')
    expect(assetsFetch).toHaveBeenCalledOnce()
  })

  describe('/api/ballot', () => {
    it('only accepts POST, so addresses never end up in URLs', async () => {
      const response = await call('/api/ballot?address=1', configured())
      expect(response.status).toBe(405)
    })

    it('reports when the lookup is not configured', async () => {
      const { env } = makeEnv()
      const response = await call(
        '/api/ballot',
        env,
        post({ address: '834 Lake St' }),
      )
      expect(response.status).toBe(503)
    })

    it('rejects a missing address and never caches responses', async () => {
      const response = await call('/api/ballot', configured(), post({}))
      expect(response.status).toBe(400)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    })

    it('lists the candidates with published profiles', async () => {
      stubSupabase({ ...lookup, published_profile_keys: ['jane-doe'] })
      const response = await call(
        '/api/ballot',
        configured(),
        post({ address: '834 Lake St, Oak Park, IL 60301' }),
      )
      expect(response.status).toBe(200)
      const body = (await response.json()) as Ballot
      expect(body.publishedProfiles).toEqual(['jane-doe'])
    })

    it('limits lookups per visitor, keyed without the address', async () => {
      const fetch = stubSupabase(lookup)
      const limit = vi.fn(async () => ({ success: false }))
      const response = await call(
        '/api/ballot',
        { ...configured(), BALLOT_LIMITER: { limit } } as Env,
        post({ address: '834 Lake St, Oak Park, IL 60301' }),
      )
      expect(response.status).toBe(429)
      expect(response.headers.get('Retry-After')).toBe('60')
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(fetch).not.toHaveBeenCalled()
      expect(JSON.stringify(limit.mock.calls)).not.toMatch(/lake|60301/i)
    })

    it('still returns the ballot when profiles cannot be checked', async () => {
      stubSupabase({
        ...lookup,
        published_profile_keys: new Response('down', { status: 500 }),
      })
      const response = await call(
        '/api/ballot',
        configured(),
        post({ address: '834 Lake St, Oak Park, IL 60301' }),
      )
      expect(response.status).toBe(200)
      const body = (await response.json()) as Ballot
      expect(body.precinct?.name).toBe('Oak Park 22')
      expect(body).not.toHaveProperty('publishedProfiles')
    })
  })

  describe('usage counts', () => {
    const dataset = () => ({ writeDataPoint: vi.fn() })

    it('counts a lookup by outcome and area, never with the address', async () => {
      stubSupabase({ ...lookup, published_profile_keys: [] })
      const usage = dataset()
      await call(
        '/api/ballot',
        { ...configured(), USAGE: usage } as unknown as Env,
        post({ address: '834 Lake St, Oak Park, IL 60301', sample: true }),
      )
      expect(usage.writeDataPoint).toHaveBeenCalledOnce()
      const [p] = usage.writeDataPoint.mock.calls[0] as [
        { blobs: string[]; indexes: string[] },
      ]
      expect(p.indexes).toEqual(['lookup'])
      expect(p.blobs[0]).toBe('lookup')
      expect(p.blobs[3]).toBe('1')
      expect(JSON.stringify(usage.writeDataPoint.mock.calls)).not.toMatch(
        /lake|60301|oak/i,
      )
    })

    it('counts lookups that fail', async () => {
      const usage = dataset()
      await call(
        '/api/ballot',
        { ...configured(), USAGE: usage } as unknown as Env,
        post({ address: 'x' }),
      )
      const [p] = usage.writeDataPoint.mock.calls[0] as [{ blobs: string[] }]
      expect(p.blobs.slice(0, 2)).toEqual(['lookup', 'invalid'])
    })

    it('keeps only the events it knows, and answers 204', async () => {
      const { env } = makeEnv()
      const usage = dataset()
      const response = await call(
        '/api/event',
        { ...env, USAGE: usage } as unknown as Env,
        post({
          events: [
            { e: 'view', page: 'profile', from: 'ballot', key: 'jane-doe' },
            { e: 'view', page: 'profile', from: 'ballot', address: '1 Main' },
            { e: 'track', id: 'abc' },
            'nonsense',
          ],
        }),
      )
      expect(response.status).toBe(204)
      expect(usage.writeDataPoint).toHaveBeenCalledTimes(2)
      expect(JSON.stringify(usage.writeDataPoint.mock.calls)).not.toMatch(
        /main|abc/i,
      )
    })

    it('only accepts POST with an events list', async () => {
      const { env } = makeEnv()
      expect((await call('/api/event', env)).status).toBe(405)
      expect((await call('/api/event', env, post({}))).status).toBe(400)
    })

    it('limits batches per visitor', async () => {
      const { env } = makeEnv()
      const limit = vi.fn(async () => ({ success: false }))
      const response = await call(
        '/api/event',
        { ...env, EVENT_LIMITER: { limit } } as unknown as Env,
        post({ events: [] }),
      )
      expect(response.status).toBe(429)
    })
  })

  describe('/api/profile/:key', () => {
    it('serves published profiles and caches them publicly', async () => {
      stubSupabase({
        profile_get: { profile: { key: 'jane-doe' }, contentHash: 'h1' },
      })
      const response = await call('/api/profile/jane-doe', configured())
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ key: 'jane-doe' })
      expect(response.headers.get('Cache-Control')).toMatch(/^public/)
      expect(response.headers.get('ETag')).toBe('"h1"')
    })

    it('rejects bad keys and hides unpublished profiles', async () => {
      stubSupabase({ profile_get: null })
      expect((await call('/api/profile/Bad_Key', configured())).status).toBe(
        400,
      )
      expect((await call('/api/profile/jane-doe', configured())).status).toBe(
        404,
      )
    })
  })
})
