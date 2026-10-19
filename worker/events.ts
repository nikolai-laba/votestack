// Anonymous usage counts: POST /api/event takes a batch of events from the
// app, checks each against src/shared/metrics.ts and adds it to Workers
// Analytics Engine (the USAGE dataset). Nothing about the sender is stored:
// the IP address is used only, hashed, as the rate-limit key, and an event
// keeps only the fields metrics.ts lists.

import {
  MAX_EVENTS,
  isAutomatedAgent,
  lookupPoint,
  usagePoint,
  type LookupOutcome,
  type UsagePoint,
} from '../src/shared/metrics.ts'
import {
  FORM_PERIOD_SECONDS,
  json,
  rateLimitKey,
  readJsonObject,
} from './guard.ts'

/** Larger bodies are refused before they are read. */
const MAX_BODY_BYTES = 16 * 1024

/** Batches one visitor may send per minute (wrangler.toml [[ratelimits]]). */
export const EVENT_LIMIT = 30

export interface EventsEnv {
  /** Workers Analytics Engine dataset. Absent in tests and local runs. */
  USAGE?: AnalyticsEngineDataset
  /** Cloudflare's Rate Limiting binding. Absent in tests. */
  EVENT_LIMITER?: RateLimit
}

export interface EventDeps {
  dataset: AnalyticsEngineDataset | undefined
  limiter: RateLimit
}

function write(dataset: AnalyticsEngineDataset | undefined, p: UsagePoint) {
  // The event name is the index, so sampling keeps each event's counts fair.
  dataset?.writeDataPoint({
    indexes: [p.blobs[0]],
    blobs: p.blobs,
    doubles: p.doubles,
  })
}

/** Counts one ballot lookup. Never takes the address. */
export function countLookup(
  dataset: AnalyticsEngineDataset | undefined,
  outcome: LookupOutcome,
  region: string | undefined,
  sample: boolean,
  ms: number,
) {
  write(dataset, lookupPoint(outcome, region, sample, ms))
}

/** POST /api/event with {"events": [...]}. Answers 204 whatever it kept. */
export async function eventResponse(
  request: Request,
  deps: EventDeps,
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Use POST' }, 405, { Allow: 'POST' })
  }
  // Crawlers run the app too; their events are dropped unread, with the same
  // answer, so nothing changes for them.
  const cf = (request as { cf?: { verifiedBotCategory?: string } }).cf
  if (
    isAutomatedAgent(request.headers.get('User-Agent')) ||
    cf?.verifiedBotCategory
  ) {
    return new Response(null, {
      status: 204,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
  const { success } = await deps.limiter.limit({
    key: await rateLimitKey('event', request),
  })
  if (!success) {
    return json({ error: 'Too many events' }, 429, {
      'Retry-After': String(FORM_PERIOD_SECONDS),
    })
  }
  const body = await readJsonObject(request, MAX_BODY_BYTES)
  if (body === 'too_large') return json({ error: 'Too large' }, 413)
  if (!body || !Array.isArray(body.events)) {
    return json({ error: 'Send {"events": [...]}' }, 400)
  }
  for (const raw of body.events.slice(0, MAX_EVENTS)) {
    const p = usagePoint(raw)
    if (p) write(deps.dataset, p)
  }
  return new Response(null, {
    status: 204,
    headers: { 'Cache-Control': 'no-store' },
  })
}
