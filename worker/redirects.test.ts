// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import worker, { type Env } from './index.ts'
import { canonicalPath } from './redirects.ts'

describe('canonicalPath', () => {
  it('drops a trailing slash and .html', () => {
    expect(canonicalPath('/about/')).toBe('/about')
    expect(canonicalPath('/candidates/jane-doe/')).toBe('/candidates/jane-doe')
    expect(canonicalPath('/about.html')).toBe('/about')
    expect(canonicalPath('/races/il/2026-11-03/x.html')).toBe(
      '/races/il/2026-11-03/x',
    )
    expect(canonicalPath('/index.html')).toBe('/')
    expect(canonicalPath('/races//')).toBe('/races')
  })

  it('never points to another site', () => {
    expect(canonicalPath('//evil.com/')).toBe('/evil.com')
    expect(canonicalPath('//evil.com/x.html')).toBe('/evil.com/x')
    expect(canonicalPath('/\\evil.com/')).toBe('/evil.com')
    expect(canonicalPath('///evil.com')).toBe('/evil.com')
  })

  it('leaves canonical addresses alone', () => {
    expect(canonicalPath('/')).toBeNull()
    expect(canonicalPath('/about')).toBeNull()
  })
})

describe('the Worker', () => {
  const env = {
    ASSETS: { fetch: vi.fn(async () => new Response('asset')) },
  } as unknown as Env
  const call = (path: string, method = 'GET') =>
    worker.fetch(
      new Request(`https://votestack.org${path}`, { method }) as Parameters<
        typeof worker.fetch
      >[0],
      env,
    )

  it('redirects permanently to the page’s own address, keeping the query', async () => {
    const res = await call('/candidates/jane-doe/?utm_source=x')
    expect(res.status).toBe(301)
    expect(res.headers.get('Location')).toBe(
      '/candidates/jane-doe?utm_source=x',
    )
  })

  it('serves canonical addresses and other methods from the assets', async () => {
    expect(await (await call('/about')).text()).toBe('asset')
    expect((await call('/about/', 'POST')).status).toBe(200)
  })
})
