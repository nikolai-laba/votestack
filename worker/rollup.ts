// Keeps the usage counts. Analytics Engine holds events for about three
// months, so once a day the Worker reads the hourly totals for the last few
// days through its SQL API and stores them in Supabase (usage_hourly, through
// record_usage_hourly()). Each run replaces those hours' totals, so running
// it twice, or after a missed day, never counts anything twice.

import { rpc, type SupabaseConfig } from './supabase.ts'

/** The Analytics Engine dataset (wrangler.toml [[analytics_engine_datasets]]). */
export const USAGE_DATASET = 'votestack_usage'

/** Days read on each run: today's run also redoes the two before it. */
export const ROLLUP_DAYS = 3

/** Rows sent to Supabase per call. */
const BATCH = 1_000

/** How many doubles an event can carry (src/shared/metrics.ts: 'voter' has 8). */
const DOUBLES = 8

export interface RollupEnv {
  /** Cloudflare account ID, for the SQL API. A Worker secret. */
  CF_ACCOUNT_ID?: string
  /** API token with Account Analytics: Read only. A Worker secret. */
  CF_ANALYTICS_TOKEN?: string
}

export interface UsageRow {
  /** Start of the hour, as Unix seconds (UTC). */
  hour: number
  event: string
  a: string
  b: string
  c: string
  /** Events in the hour (sampling accounted for). */
  n: number
  /** Totals of each number the events carry. */
  d: number[]
}

const sums = Array.from(
  { length: DOUBLES },
  (_, i) => `SUM(_sample_interval * double${i + 1}) AS d${i + 1}`,
).join(', ')

/** Whole hours from `days` days ago up to the start of the current hour. */
export const rollupQuery = (days = ROLLUP_DAYS) => `
SELECT toUnixTimestamp(toStartOfHour(timestamp)) AS hour,
  blob1 AS event, blob2 AS a, blob3 AS b, blob4 AS c,
  SUM(_sample_interval) AS n, ${sums}
FROM ${USAGE_DATASET}
WHERE timestamp >= toStartOfHour(now()) - INTERVAL '${days}' DAY
  AND timestamp < toStartOfHour(now())
GROUP BY hour, event, a, b, c
FORMAT JSON`

/** Numbers can come back as strings from the SQL API. */
const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function parseRows(data: unknown): UsageRow[] {
  const rows = (data as { data?: unknown } | null)?.data
  if (!Array.isArray(rows)) throw new Error('Unexpected SQL API answer')
  return rows.map((r: Record<string, unknown>) => ({
    hour: num(r.hour),
    event: String(r.event ?? ''),
    a: String(r.a ?? ''),
    b: String(r.b ?? ''),
    c: String(r.c ?? ''),
    n: num(r.n),
    d: Array.from({ length: DOUBLES }, (_, i) => num(r[`d${i + 1}`])),
  }))
}

/** Reads the hourly totals and stores them. Throws so a failed run shows in the logs. */
export async function rollUpUsage(
  env: RollupEnv,
  supabase: SupabaseConfig | null,
  doFetch: typeof fetch = fetch,
): Promise<number> {
  if (!env.CF_ACCOUNT_ID || !env.CF_ANALYTICS_TOKEN || !supabase) {
    throw new Error('Usage rollup is not configured')
  }
  const res = await doFetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}` },
      body: rollupQuery(),
    },
  )
  if (!res.ok) throw new Error(`Analytics Engine SQL failed with ${res.status}`)
  const rows = parseRows(await res.json())
  for (let i = 0; i < rows.length; i += BATCH) {
    await rpc(
      { ...supabase, fetch: supabase.fetch ?? doFetch },
      'record_usage_hourly',
      { p_rows: rows.slice(i, i + BATCH) },
    )
  }
  return rows.length
}
