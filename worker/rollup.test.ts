// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { parseRows, rollUpUsage, rollupQuery } from './rollup.ts'

const env = { CF_ACCOUNT_ID: 'acct', CF_ANALYTICS_TOKEN: 'token' }
const supabase = { url: 'https://db.example', secretKey: 'test' }

const answer = {
  meta: [],
  rows: 1,
  data: [
    {
      hour: '1792573200',
      event: 'voter',
      a: 'new',
      b: 'ca-la',
      c: '',
      n: '3',
      d1: '120',
      d2: 9,
    },
  ],
}

describe('usage rollup', () => {
  it('reads whole hours of the last days, grouped by event and labels', () => {
    const sql = rollupQuery(3)
    expect(sql).toMatch(/INTERVAL '3' DAY/)
    expect(sql).toMatch(/timestamp < toStartOfHour\(now\(\)\)/)
    expect(sql).toMatch(/GROUP BY hour, event, a, b, c/)
    expect(sql).toMatch(/SUM\(_sample_interval \* double8\)/)
  })

  it('reads numbers given as strings', () => {
    expect(parseRows(answer)).toEqual([
      {
        hour: 1792573200,
        event: 'voter',
        a: 'new',
        b: 'ca-la',
        c: '',
        n: 3,
        d: [120, 9, 0, 0, 0, 0, 0, 0],
      },
    ])
    expect(() => parseRows({ errors: ['bad'] })).toThrow()
  })

  it('stores the rows in Supabase', async () => {
    const fetch = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('analytics_engine')
        ? Response.json(answer)
        : Response.json(1),
    )
    const written = await rollUpUsage(
      env,
      supabase,
      fetch as typeof globalThis.fetch,
    )
    expect(written).toBe(1)
    const [sqlUrl, sqlInit] = fetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(sqlUrl).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct/analytics_engine/sql',
    )
    expect(new Headers(sqlInit.headers).get('Authorization')).toBe(
      'Bearer token',
    )
    const [rpcUrl, rpcInit] = fetch.mock.calls[1] as unknown as [
      string,
      RequestInit,
    ]
    expect(rpcUrl).toBe('https://db.example/rest/v1/rpc/record_usage_hourly')
    expect(JSON.parse(String(rpcInit.body)).p_rows).toHaveLength(1)
  })

  it('fails loudly when not configured or the query fails', async () => {
    await expect(rollUpUsage({}, supabase)).rejects.toThrow(/not configured/)
    const fetch = vi.fn(async () => new Response('no', { status: 403 }))
    await expect(
      rollUpUsage(env, supabase, fetch as unknown as typeof globalThis.fetch),
    ).rejects.toThrow(/403/)
  })
})
