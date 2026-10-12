// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { Contest } from '../src/shared/ballot.ts'
import { CHICAGO, COOK_COUNTY } from '../src/shared/ocd.ts'
import { SupabaseBallotProvider } from './ballot.ts'

const contest = (
  id: string,
  districtId: string,
  ballotOrder: number,
): Contest => ({
  id,
  electionId: 'il-2026-11-03-general',
  districtId,
  authorityId: COOK_COUNTY,
  kind: 'measure',
  title: id,
  question: '?',
  ballotOrder,
  sources: [],
  lastVerified: '2026-10-04',
})

/** A fake Supabase that answers each RPC and records what it was sent. */
function fakeSupabase(answers: Record<string, unknown>) {
  const calls: { fn: string; args: Record<string, unknown>; url: string }[] = []
  const fetch = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      const fn = String(url).split('/rpc/')[1]
      calls.push({ fn, args: JSON.parse(String(init?.body)), url: String(url) })
      const args = JSON.parse(String(init?.body))
      const answer = answers[fn]
      return Response.json(typeof answer === 'function' ? answer(args) : answer)
    },
  ) as unknown as typeof globalThis.fetch
  const provider = new SupabaseBallotProvider({
    url: 'https://db.example',
    secretKey: 'test',
    fetch,
  })
  return { provider, calls }
}

const oakPark = {
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
    districts: [
      'congressional',
      'state senate',
      'state house',
      'county board',
      'board of review',
      'judicial subcircuit',
    ].map((layer, i) => ({
      ocdId: `ocd-division/test:${i}`,
      layer,
      required: true,
    })),
  },
  contests_for: {
    contests: [
      contest('second', COOK_COUNTY, 2),
      contest('first', COOK_COUNTY, 1),
    ],
    unplaced: [],
  },
}

describe('SupabaseBallotProvider', () => {
  it('builds a ballot from the address point, districts and contests', async () => {
    const { provider, calls } = fakeSupabase(oakPark)
    const ballot = await provider.getBallot({
      address: '834 Lake St, Oak Park, IL 60301',
    })

    expect(calls.map((c) => c.fn)).toEqual([
      'street_points',
      'districts_at',
      'contests_for',
    ])
    expect(calls[0].args).toEqual({ p_street_key: '|LAKE', p_number: 834 })
    expect(calls[2].args.p_authority_id).toBe(COOK_COUNTY)
    expect(ballot?.contests.map((c) => c.id)).toEqual(['first', 'second'])
    expect(ballot?.precinct?.name).toBe('Oak Park 22')
    expect(ballot?.coverage).toMatchObject({ status: 'complete', notes: [] })
  })

  it('never puts the address in a URL', async () => {
    const { provider, calls } = fakeSupabase(oakPark)
    await provider.getBallot({ address: '834 Lake St, Oak Park, IL 60301' })
    for (const call of calls) expect(call.url).not.toMatch(/lake|834/i)
  })

  it('uses the Chicago board and flags gaps for Chicago precincts', async () => {
    const { provider, calls } = fakeSupabase({
      ...oakPark,
      districts_at: {
        ...oakPark.districts_at,
        precinct: { id: 'chicago:21010', name: 'Ward 21 Precinct 10' },
      },
      contests_for: {
        contests: [],
        unplaced: ['Mental Health Services referendum'],
      },
    })
    const ballot = await provider.getBallot({ address: '834 Lake St' })

    expect(calls[2].args.p_authority_id).toBe(CHICAGO)
    expect(calls[2].args.p_district_ids).toContain(
      `${CHICAGO}/ward:21/precinct:10`,
    )
    expect(ballot?.coverage.status).toBe('possible_gaps')
    expect(ballot?.coverage.notes.join(' ')).toMatch(
      /1 race or question .* not matched/,
    )
    expect(ballot?.coverage.officialSampleBallotUrl).toContain(
      'chicagoelections.gov',
    )
  })

  it("uses the Clerk's districts over the maps for suburban precincts", async () => {
    const clerkRep = {
      ocdId: 'ocd-division/test:clerk-rep',
      layer: 'state house',
    }
    const { provider, calls } = fakeSupabase({
      ...oakPark,
      districts_at: {
        ...oakPark.districts_at,
        clerkSplits: [{ split: '0', districts: [clerkRep] }],
      },
    })
    const ballot = await provider.getBallot({
      address: '834 Lake St, Oak Park, IL 60301',
    })
    const ids = calls[2].args.p_district_ids as string[]
    expect(ids).toContain(clerkRep.ocdId)
    expect(ids).not.toContain('ocd-division/test:2') // the map's state house
    expect(ballot?.coverage.notes).toEqual([])
  })

  it('returns null when the address is not found', async () => {
    const { provider, calls } = fakeSupabase({ ...oakPark, street_points: [] })
    expect(
      await provider.getBallot({ address: '834 Lake St, Oak Park' }),
    ).toBeNull()
    expect(calls.every((c) => c.fn === 'street_points')).toBe(true)
  })

  it('finds an address stored without the direction the voter typed', async () => {
    const { provider, calls } = fakeSupabase({
      ...oakPark,
      street_points: (args: { p_street_key: string }) =>
        args.p_street_key === '|LAKE' ? oakPark.street_points : [],
    })
    const ballot = await provider.getBallot({
      address: '834 W Lake St, Oak Park, IL 60301',
    })
    expect(calls[0].args.p_street_key).toBe('W|LAKE')
    expect(ballot?.precinct?.name).toBe('Oak Park 22')
  })

  it('does not guess between directions', async () => {
    const { provider } = fakeSupabase({
      ...oakPark,
      street_points: (args: { p_street_key: string }) =>
        ['N|LAKE', 'S|LAKE'].includes(args.p_street_key)
          ? oakPark.street_points
          : [],
    })
    expect(
      await provider.getBallot({ address: '834 Lake St, Oak Park, IL 60301' }),
    ).toBeNull()
  })
})
