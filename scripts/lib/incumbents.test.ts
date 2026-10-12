import { describe, expect, it } from 'vitest'
import type { CandidateContest, Contest } from '../../src/shared/ballot.ts'
import {
  buildIncumbents,
  fecIncumbent,
  ilgaIncumbent,
  parseIlgaMembers,
  rosterIncumbent,
  withIncumbents,
  type Person,
  type RosterEntry,
  type Sources,
} from './incumbents.ts'
import { parseCandidates } from './profiles/fec.ts'

const card = (id: string, name: string, party: string, district: string) => `
  <div class="member-overlay">
    <h2 class="h5 card-title"><a class="notranslate" href="/House/Members/Details/${id}">${name}</a> (${party})</h2>
    <p class="card-text">
      Representative
      <br />${district} District
    </p>
  </div>`

// Each member appears twice (desktop and mobile); former members come last.
const HOUSE = `<html>
  ${card('3366', 'Kam Buckner', 'D', '26th')}
  ${card('3366', 'Kam Buckner', 'D', '26th')}
  ${card('3462', 'Justin Cochran', 'D', '55th')}
  ${card('3400', 'Kimberly Du Buclet', 'D', '5th')}
  ${card('3401', 'Edgar Gonz&#225;lez, Jr.', 'D', '23rd')}
  ${card('3402', 'Emanuel &quot;Chris&quot; Welch', 'D', '7th')}
  <h2 class="h4 text-center">Former Members</h2>
  ${card('3300', 'Martin J. Moylan', 'D', '55th')}
</html>`

const person = (over: Partial<Person>): Person => ({
  key: 'x',
  name: 'X',
  office: 'Office',
  officeType: 'other',
  districtId: 'ocd-division/country:us/state:il',
  kind: 'candidate',
  ...over,
})

const IL = 'ocd-division/country:us/state:il'
const rep = (name: string, district: number): Person =>
  person({
    key: name.toLowerCase().replace(/\W+/g, '-'),
    name,
    office: `State Representative, ${district}th District`,
    officeType: 'state_legislature',
    districtId: `${IL}/sldl:${district}`,
  })

const FEC_CSV = `Cand_Name,Cand_Id,Cand_Office,Cand_Office_St,Cand_Office_Dist,Cand_Incumbent_Challenger_Open_Seat
"QUIGLEY, MIKE","H0IL05096","H","IL","05","INCUMBENT"
"HANSON, TOMMY","H6IL05111","H","IL","05","CHALLENGER"
"BISS, DANIEL","H6IL09111","H","IL","09","OPEN"
"STRATTON, JULIANA","S6IL00458","S","IL","00","OPEN"
`

const sources = (over: Partial<Sources> = {}): Sources => ({
  fec: { candidates: parseCandidates(FEC_CSV), checked: '2026-10-07' },
  ilga: {
    House: { members: parseIlgaMembers(HOUSE), checked: '2026-10-11' },
    Senate: { members: [], checked: '2026-10-11' },
  },
  roster: [],
  ...over,
})

describe('parseIlgaMembers', () => {
  it('reads current members once each and leaves out former members', () => {
    const members = parseIlgaMembers(HOUSE)
    expect(members.map((m) => [m.name, m.district])).toEqual([
      ['Kam Buckner', 26],
      ['Justin Cochran', 55],
      ['Kimberly Du Buclet', 5],
      ['Edgar González, Jr.', 23],
      ['Emanuel "Chris" Welch', 7],
    ])
    expect(members[0]).toMatchObject({ id: '3366', party: 'D' })
  })
})

describe('ilgaIncumbent (name and district)', () => {
  const s = sources()

  it('labels the member for the same district and name', () => {
    expect(ilgaIncumbent(rep('Kam Buckner', 26), s.ilga)).toEqual({
      incumbent: true,
      office: 'State Representative, 26th District',
      source: 'https://www.ilga.gov/House/Members/Details/3366',
      checked: '2026-10-11',
    })
  })

  it('matches ballot spellings of the same name', () => {
    expect(ilgaIncumbent(rep('Kimberly Neely DuBuclet', 5), s.ilga)).not.toBe(
      null,
    )
    expect(ilgaIncumbent(rep('Emanuel "Chris" Welch', 7), s.ilga)).not.toBe(
      null,
    )
  })

  it('needs both: a member running in another district is not labeled', () => {
    expect(ilgaIncumbent(rep('Kam Buckner', 25), s.ilga)).toBeNull()
  })

  it('does not label a challenger for a member’s seat', () => {
    expect(ilgaIncumbent(rep('Joseph Johnson', 55), s.ilga)).toBeNull()
  })

  it('reads accents and suffixes', () => {
    expect(ilgaIncumbent(rep('Edgar Gonzalez, Jr.', 23), s.ilga)).not.toBe(null)
  })

  it('ignores former members', () => {
    expect(ilgaIncumbent(rep('Martin J. Moylan', 55), s.ilga)).toBeNull()
  })
})

describe('fecIncumbent (the FEC’s incumbent field)', () => {
  const s = sources()
  const house = (name: string, district: number) =>
    person({
      name,
      office: `U.S. Representative, ${district}th District`,
      officeType: 'us_house',
      districtId: `ocd-division/country:us/state:il/cd:${district}`,
    })

  it('labels a candidate the FEC lists as the incumbent', () => {
    expect(fecIncumbent(house('Mike Quigley', 5), s.fec)).toEqual({
      incumbent: true,
      office: 'U.S. Representative, 5th District',
      source: 'https://www.fec.gov/data/candidate/H0IL05096/',
      checked: '2026-10-07',
    })
  })

  it('does not label challengers or open-seat candidates', () => {
    expect(fecIncumbent(house('Tommy Hanson', 5), s.fec)).toBeNull()
    expect(fecIncumbent(house('Daniel Biss', 9), s.fec)).toBeNull()
    const senate = person({
      name: 'Juliana Stratton',
      officeType: 'us_senate',
    })
    expect(fecIncumbent(senate, s.fec)).toBeNull()
  })

  it('needs the same district', () => {
    expect(fecIncumbent(house('Mike Quigley', 9), s.fec)).toBeNull()
  })
})

describe('rosterIncumbent', () => {
  const roster: RosterEntry[] = [
    {
      office: 'Cook County Sheriff',
      name: 'Thomas J. Dart',
      source: 'https://www.cookcountysheriffil.gov/',
      checked: '2026-10-11',
    },
  ]

  it('labels the person a roster names for the same office', () => {
    expect(
      rosterIncumbent(
        person({ name: 'Thomas J. Dart', office: 'Cook County Sheriff' }),
        roster,
      ),
    ).toMatchObject({ source: 'https://www.cookcountysheriffil.gov/' })
  })

  it('does not label another candidate or the same name for another office', () => {
    expect(
      rosterIncumbent(
        person({ name: 'Brad Sandefur', office: 'Cook County Sheriff' }),
        roster,
      ),
    ).toBeNull()
    expect(
      rosterIncumbent(
        person({ name: 'Thomas J. Dart', office: 'Cook County Clerk' }),
        roster,
      ),
    ).toBeNull()
  })
})

describe('buildIncumbents', () => {
  it('labels only people a source confirms, and never judges', () => {
    const roster: RosterEntry[] = [
      {
        office: 'Judge',
        name: 'John Roe',
        source: 'https://example.gov/judges',
        checked: '2026-10-11',
      },
      {
        office: 'Cook County Clerk',
        name: 'Nobody Here',
        source: 'https://example.gov/clerk',
        checked: '2026-10-11',
      },
    ]
    const { incumbents, unusedRoster } = buildIncumbents(
      [
        rep('Kam Buckner', 26),
        rep('Pat Newcomer', 27),
        person({
          key: 'john-roe',
          name: 'John Roe',
          office: 'Judge',
          kind: 'retention',
        }),
      ],
      sources({ roster }),
    )
    expect(Object.keys(incumbents)).toEqual(['kam-buckner'])
    // Entries that match nobody are reported, not dropped silently.
    expect(unusedRoster.map((r) => r.name)).toEqual(['John Roe', 'Nobody Here'])
  })
})

describe('withIncumbents', () => {
  const contest: CandidateContest = {
    kind: 'candidate',
    id: 'c',
    electionId: 'e',
    districtId: IL,
    authorityId: IL,
    title: 'Sheriff',
    office: 'Sheriff',
    voteFor: 1,
    candidates: [
      { name: 'Thomas J. Dart', party: 'Democratic' },
      { name: 'Brad Sandefur', party: 'Libertarian', incumbent: true },
    ],
    sources: [],
    lastVerified: '2026-10-01',
  }
  const retention: Contest = {
    kind: 'retention',
    id: 'r',
    electionId: 'e',
    districtId: IL,
    authorityId: IL,
    title: 'Retention',
    office: 'Judge',
    judge: 'John Roe',
    sources: [],
    lastVerified: '2026-10-01',
  }
  const entry = {
    incumbent: true as const,
    office: 'Cook County Sheriff',
    source: 'https://example.gov',
    checked: '2026-10-11',
  }

  it('sets incumbent on confirmed candidates and drops it from everyone else', () => {
    const [c, r] = withIncumbents([contest, retention], {
      'thomas-j-dart': entry,
      'john-roe': entry,
    })
    expect((c as CandidateContest).candidates).toEqual([
      { name: 'Thomas J. Dart', party: 'Democratic', incumbent: true },
      { name: 'Brad Sandefur', party: 'Libertarian' },
    ])
    expect(r).toBe(retention)
  })
})
