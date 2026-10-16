// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CandidateProfile } from '../src/shared/profile.ts'
import {
  clearProfileKeysCache,
  profileResponse,
  publishedProfileKeys,
} from './profile.ts'

const profile = {
  key: 'jane-doe',
  name: 'Jane Doe',
} as CandidateProfile

/** A fake Supabase that answers each RPC and records what it was sent. */
function fakeSupabase(answers: Record<string, unknown>) {
  const calls: { fn: string; args: Record<string, unknown>; url: string }[] = []
  const fetch = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      const fn = String(url).split('/rpc/')[1]
      calls.push({ fn, args: JSON.parse(String(init?.body)), url: String(url) })
      const answer = answers[fn]
      if (answer instanceof Response) return answer
      return Response.json(answer)
    },
  ) as unknown as typeof globalThis.fetch
  return {
    config: { url: 'https://db.example', secretKey: 'test', fetch },
    calls,
  }
}

const get = (headers?: HeadersInit) =>
  new Request('https://votestack.org/api/profile/jane-doe', { headers })

describe('profileResponse', () => {
  it('serves a published profile with cache headers and an ETag', async () => {
    const { config, calls } = fakeSupabase({
      profile_get: { profile, contentHash: 'abc123' },
    })
    const res = await profileResponse(get(), 'jane-doe', config)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(profile)
    expect(res.headers.get('Cache-Control')).toBe(
      'public, max-age=300, stale-while-revalidate=86400',
    )
    expect(res.headers.get('ETag')).toBe('"abc123"')
    expect(calls[0]).toMatchObject({
      fn: 'profile_get',
      args: { p_election_id: 'il-2026-11-03-general', p_key: 'jane-doe' },
    })
  })

  it('looks in each area’s election until one has the key', async () => {
    const calls: unknown[] = []
    const fetch = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const args = JSON.parse(String(init?.body))
        calls.push(args.p_election_id)
        return Response.json(
          args.p_election_id === 'ca-2026-11-03-general'
            ? { profile, contentHash: 'la1' }
            : null,
        )
      },
    ) as unknown as typeof globalThis.fetch
    const res = await profileResponse(get(), 'jane-doe', {
      url: 'https://db.example',
      secretKey: 'test',
      fetch,
    })
    expect(res.status).toBe(200)
    expect(calls).toEqual(['il-2026-11-03-general', 'ca-2026-11-03-general'])
  })

  it('answers 304 when the browser already has this version', async () => {
    const { config } = fakeSupabase({
      profile_get: { profile, contentHash: 'abc123' },
    })
    const res = await profileResponse(
      get({ 'If-None-Match': 'W/"abc123"' }),
      'jane-doe',
      config,
    )
    expect(res.status).toBe(304)
    expect(res.headers.get('ETag')).toBe('"abc123"')
  })

  it('is 404 unless the profile is published', async () => {
    const { config } = fakeSupabase({ profile_get: null })
    const res = await profileResponse(get(), 'jane-doe', config)
    expect(res.status).toBe(404)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('rejects malformed keys without asking the database', async () => {
    const { config, calls } = fakeSupabase({})
    for (const key of ['', 'Jane-Doe', 'jane%20doe', 'a'.repeat(81)]) {
      const res = await profileResponse(get(), key, config)
      expect(res.status).toBe(400)
    }
    expect(calls).toHaveLength(0)
  })

  it('only answers GET', async () => {
    const { config } = fakeSupabase({})
    const res = await profileResponse(
      new Request('https://votestack.org/api/profile/jane-doe', {
        method: 'POST',
      }),
      'jane-doe',
      config,
    )
    expect(res.status).toBe(405)
  })

  it('reports when profiles are not configured or the database fails', async () => {
    expect((await profileResponse(get(), 'jane-doe', null)).status).toBe(503)
    const { config } = fakeSupabase({
      profile_get: new Response('down', { status: 500 }),
    })
    expect((await profileResponse(get(), 'jane-doe', config)).status).toBe(502)
  })
})

describe('publishedProfileKeys', () => {
  beforeEach(() => clearProfileKeysCache())

  it('asks once and keeps the keys for about 5 minutes', async () => {
    const { config, calls } = fakeSupabase({
      published_profile_keys: ['jane-doe'],
    })
    const now = Date.UTC(2026, 9, 6)
    expect(await publishedProfileKeys(config, 'e', now)).toEqual(['jane-doe'])
    expect(await publishedProfileKeys(config, 'e', now + 60_000)).toEqual([
      'jane-doe',
    ])
    expect(calls).toHaveLength(1)
    expect(calls[0].args).toEqual({ p_election_id: 'e' })

    await publishedProfileKeys(config, 'e', now + 6 * 60_000)
    expect(calls).toHaveLength(2)
  })

  it('does not cache a failure', async () => {
    const failing = fakeSupabase({
      published_profile_keys: new Response('down', { status: 500 }),
    })
    await expect(publishedProfileKeys(failing.config, 'e')).rejects.toThrow()
    const working = fakeSupabase({ published_profile_keys: ['jane-doe'] })
    expect(await publishedProfileKeys(working.config, 'e')).toEqual([
      'jane-doe',
    ])
  })
})
