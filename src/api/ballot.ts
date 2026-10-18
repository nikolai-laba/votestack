// Client for the Worker's POST /api/ballot. The address goes in the request
// body only: never in the URL, browser storage or logs.

import type { Ballot } from '../shared/ballot.ts'

export type BallotErrorKind =
  'invalid' | 'not_found' | 'rate_limited' | 'unavailable'

export class BallotLookupError extends Error {
  readonly kind: BallotErrorKind

  constructor(kind: BallotErrorKind) {
    super(kind)
    this.kind = kind
  }
}

/**
 * Looks up a ballot. `sample` marks the app's sample ballots, so the
 * Worker counts them apart from voters' own lookups.
 */
export async function fetchBallot(
  address: string,
  { sample = false } = {},
): Promise<Ballot> {
  let res: Response
  try {
    res = await fetch('/api/ballot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sample ? { address, sample } : { address }),
      cache: 'no-store',
    })
  } catch {
    throw new BallotLookupError('unavailable')
  }
  if (res.status === 400) throw new BallotLookupError('invalid')
  if (res.status === 404) throw new BallotLookupError('not_found')
  if (res.status === 429) throw new BallotLookupError('rate_limited')
  if (!res.ok) throw new BallotLookupError('unavailable')
  return (await res.json()) as Ballot
}
