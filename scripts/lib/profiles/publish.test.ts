import { describe, expect, it } from 'vitest'
import type { CandidateProfile } from '../../../src/shared/profile.ts'
import { contentHash } from './content.ts'
import { planPublish, type ExistingRow } from './publish.ts'
import type { ProfileCheck } from './review.ts'
import { fixtureProfile, fixtureSubject, thinProfile } from './test-fixtures.ts'

const judge = fixtureProfile({
  key: 'ann-judge',
  name: 'Ann Judge',
  kind: 'retention',
  tier: 'short',
})
const subjects = [
  fixtureSubject(),
  fixtureSubject({ key: 'john-roe', name: 'John Roe' }),
  fixtureSubject({
    key: 'ann-judge',
    name: 'Ann Judge',
    kind: 'retention',
    tier: 'short',
    officeType: 'retention',
    raceKey: 'retention:ann-judge',
  }),
]
const profiles = new Map<string, CandidateProfile>([
  ['jane-doe', fixtureProfile()],
  ['john-roe', thinProfile()],
  ['ann-judge', judge],
])

const checked = (
  p: CandidateProfile,
  status: ProfileCheck['status'],
): ProfileCheck => ({
  status,
  contentHash: contentHash(p),
  raceKeys: [],
  office: p.office,
  name: p.name,
  reasons: status === 'flagged' ? ['x'] : [],
  warnings: [],
})

const plan = (
  checks: Record<string, ProfileCheck>,
  existing: ExistingRow[] = [],
  profileMap = profiles,
) =>
  planPublish({
    electionId: 'il-2026-11-03-general',
    subjects,
    profiles: profileMap,
    checks,
    existing,
    now: '2026-10-06T12:00:00Z',
  })

const statuses = (p: ReturnType<typeof plan>) =>
  Object.fromEntries(p.upserts.map((r) => [r.key, r.status]))

describe('planPublish', () => {
  it('publishes a race only when every candidate passes', () => {
    const allPass = plan({
      'jane-doe': checked(fixtureProfile(), 'passed'),
      'john-roe': checked(thinProfile(), 'passed'),
      'ann-judge': checked(judge, 'passed'),
    })
    expect(statuses(allPass)).toEqual({
      'jane-doe': 'published',
      'john-roe': 'published',
      'ann-judge': 'published',
    })

    const oneFlagged = plan({
      'jane-doe': checked(fixtureProfile(), 'passed'),
      'john-roe': checked(thinProfile(), 'flagged'),
      'ann-judge': checked(judge, 'passed'),
    })
    expect(statuses(oneFlagged)).toEqual({
      'jane-doe': 'flagged',
      'john-roe': 'flagged',
      'ann-judge': 'published',
    })
    expect(oneFlagged.blocked).toEqual([
      {
        raceKey: 'country:us/state:il/sewer:mwrd|member',
        reason: 'John Roe is flagged',
      },
    ])
  })

  it('holds a race when a candidate has no profile or a stale check', () => {
    const missing = plan(
      {
        'jane-doe': checked(fixtureProfile(), 'passed'),
        'ann-judge': checked(judge, 'passed'),
      },
      [],
      new Map([...profiles].filter(([k]) => k !== 'john-roe')),
    )
    expect(statuses(missing)['jane-doe']).toBe('flagged')
    expect(missing.blocked[0].reason).toBe('John Roe has no profile')

    const stale = plan({
      'jane-doe': checked(fixtureProfile({ name: 'Old' }), 'passed'),
      'john-roe': checked(thinProfile(), 'passed'),
      'ann-judge': checked(judge, 'passed'),
    })
    expect(statuses(stale)['jane-doe']).toBe('flagged')
  })

  it('skips unchanged rows, keeps published_at and withdraws people off the ballot', () => {
    const checks = {
      'jane-doe': checked(fixtureProfile(), 'passed'),
      'john-roe': checked(thinProfile(), 'passed'),
      'ann-judge': checked(judge, 'passed'),
    }
    const row = (key: string, p: CandidateProfile): ExistingRow => ({
      key,
      status: 'published',
      content_hash: contentHash(p),
      version: 1,
      published_at: '2026-10-01T00:00:00Z',
    })
    const result = plan(checks, [
      row('jane-doe', fixtureProfile()),
      row('john-roe', thinProfile({ name: 'John Roe Sr' })),
      row('gone-person', judge),
    ])
    expect(result.unchanged).toBe(1)
    expect(result.upserts.map((r) => r.key)).toEqual(['john-roe', 'ann-judge'])
    expect(result.upserts[0].published_at).toBe('2026-10-06T12:00:00Z')
    expect(result.withdraw).toEqual(['gone-person'])
  })

  it('marks a profile file for someone off the ballot as withdrawn', () => {
    const extra = new Map(profiles)
    extra.set('old-name', fixtureProfile({ key: 'old-name' }))
    const result = plan({}, [], extra)
    expect(statuses(result)['old-name']).toBe('withdrawn')
  })
})
