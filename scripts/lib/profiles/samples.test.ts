import { describe, expect, it } from 'vitest'
import { SAMPLE_KEYS, sampleFor, sampleProfile } from './samples.ts'
import { fixtureProfile, fixtureSubject } from './test-fixtures.ts'

const none = new Set<string>(Object.values(SAMPLE_KEYS))

describe('sampleFor', () => {
  it('matches party and tier', () => {
    expect(
      sampleFor(fixtureSubject({ party: 'Democratic', tier: 'top' }), none),
    ).toBe(SAMPLE_KEYS.democraticTop)
    expect(
      sampleFor(
        fixtureSubject({
          party: 'Republican',
          tier: 'mid',
          officeType: 'state_legislature',
        }),
        none,
      ),
    ).toBe(SAMPLE_KEYS.republicanMid)
    expect(
      sampleFor(fixtureSubject({ party: 'Libertarian', tier: 'top' }), none),
    ).toBe(SAMPLE_KEYS.otherParty)
    expect(
      sampleFor(
        fixtureSubject({
          party: undefined,
          tier: 'mid',
          officeType: 'school_board',
        }),
        none,
      ),
    ).toBe(SAMPLE_KEYS.nonpartisan)
  })

  it('matches judges by kind and court, whatever their party', () => {
    expect(
      sampleFor(
        fixtureSubject({
          kind: 'retention',
          tier: 'short',
          office: 'Appellate Court Judge, 1st District',
        }),
        none,
      ),
    ).toBe(SAMPLE_KEYS.appellateRetention)
    expect(
      sampleFor(
        fixtureSubject({
          kind: 'judicial_candidate',
          party: 'Republican',
          tier: 'short',
        }),
        none,
      ),
    ).toBe(SAMPLE_KEYS.judicialCandidate)
  })

  it('falls back when a sample isn’t written yet', () => {
    const without = new Set(
      [...none].filter((k) => k !== SAMPLE_KEYS.republicanTop),
    )
    expect(
      sampleFor(fixtureSubject({ party: 'Republican', tier: 'top' }), without),
    ).toBe(SAMPLE_KEYS.democraticTop)
  })

  it('uses a finished profile for its own person', () => {
    const s = fixtureSubject({ party: 'Democratic', tier: 'top' })
    expect(sampleFor(s, new Set([s.key]))).toBe(s.key)
  })
})

describe('sampleProfile', () => {
  it('marks a stand-in, not the person’s own profile', () => {
    const subject = fixtureSubject({
      key: 'someone-else',
      name: 'Someone Else',
    })
    const profile = fixtureProfile()
    expect(sampleProfile(subject, profile).sample).toEqual({
      forName: 'Someone Else',
      forOffice: subject.office,
    })
    expect(
      sampleProfile({ ...subject, key: profile.key }, profile).sample,
    ).toBeUndefined()
  })
})
