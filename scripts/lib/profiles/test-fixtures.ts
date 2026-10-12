// Small profiles and subjects for the profile pipeline's tests.

import type { CandidateProfile } from '../../../src/shared/profile.ts'
import type { Subject } from './subjects.ts'

export function fixtureProfile(
  over: Partial<CandidateProfile> = {},
): CandidateProfile {
  return {
    key: 'jane-doe',
    electionId: 'il-2026-11-03-general',
    name: 'Jane Doe',
    office: 'Commissioner, Metropolitan Water Reclamation District',
    contestIds: ['cook-clerk:190100'],
    kind: 'candidate',
    tier: 'mid',
    overview: {
      asOf: '2026-10-01',
      items: [
        {
          text: 'Jane Doe was elected to the board in 2020 and chairs its budget committee.',
          cites: [1],
        },
      ],
    },
    money: { asOf: '2026-10-01', items: [] },
    endorsements: {
      asOf: '2026-10-01',
      items: [
        { organization: 'Sierra Club', kind: 'organization', cites: [2] },
      ],
    },
    sources: [
      {
        id: 1,
        title: 'Jane Doe',
        publisher: 'Ballotpedia',
        url: 'https://ballotpedia.org/Jane_Doe',
        viewedAt: '2026-10-01',
        kind: 'reference',
      },
      {
        id: 2,
        title: 'Endorsements',
        publisher: 'Sierra Club',
        url: 'https://www.sierraclub.org/illinois/endorsements',
        viewedAt: '2026-10-01',
        kind: 'endorser',
      },
    ],
    meta: {
      model: 'test',
      promptVersion: 'f005-1',
      generatedAt: '2026-10-01T12:00:00Z',
      version: 1,
    },
    ...over,
  }
}

export function fixtureSubject(over: Partial<Subject> = {}): Subject {
  return {
    key: 'jane-doe',
    name: 'Jane Doe',
    office: 'Commissioner, Metropolitan Water Reclamation District',
    contestIds: ['cook-clerk:190100'],
    districtId: 'ocd-division/country:us/state:il/sewer:mwrd',
    kind: 'candidate',
    tier: 'mid',
    officeType: 'water_reclamation',
    raceKey: 'country:us/state:il/sewer:mwrd|member',
    ...over,
  }
}

/** A thin opponent: no endorsements and a short overview. */
export const thinProfile = (over: Partial<CandidateProfile> = {}) =>
  fixtureProfile({
    key: 'john-roe',
    name: 'John Roe',
    overview: {
      asOf: '2026-10-01',
      items: [{ text: 'John Roe is a lawyer.', cites: [1] }],
    },
    endorsements: { asOf: '2026-10-01', items: [] },
    sources: [
      {
        id: 1,
        title: 'John Roe',
        publisher: 'Ballotpedia',
        url: 'https://ballotpedia.org/John_Roe',
        viewedAt: '2026-10-01',
        kind: 'reference',
      },
    ],
    ...over,
  })
