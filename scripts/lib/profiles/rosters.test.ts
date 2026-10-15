import { describe, expect, it } from 'vitest'
import {
  parseAssembly,
  parseHouse,
  parseStateSenate,
  parseUsSenate,
  rosterMatch,
  type RosterMember,
} from './rosters.ts'

const members: RosterMember[] = [
  { body: 'us_house', first: 'Luz', last: 'Rivas', party: 'Democratic' },
  { body: 'us_senate', first: 'Alex', last: 'Padilla', party: 'Democratic' },
  {
    body: 'state_assembly',
    first: 'Nicholas',
    last: 'Schultz',
    party: 'Democratic',
  },
  {
    body: 'state_assembly',
    first: 'José Luis',
    last: 'Solache',
    party: 'Democratic',
  },
  {
    body: 'state_senate',
    first: 'Benjamin',
    last: 'Allen',
    party: 'Democratic',
  },
  {
    body: 'state_senate',
    first: 'Tony',
    last: 'Strickland',
    party: 'Republican',
  },
]

describe('roster parsers', () => {
  it('reads one state from the House and Senate XML', () => {
    const house = `<member><statedistrict>CA29</statedistrict><member-info><lastname>Rivas</lastname><firstname>Luz</firstname><party>D</party></member-info></member>
      <member><statedistrict>TX01</statedistrict><member-info><lastname>Moran</lastname><firstname>Nathaniel</firstname><party>R</party></member-info></member>
      <member><statedistrict>CA30</statedistrict><member-info><lastname></lastname><firstname></firstname><party></party></member-info></member>`
    expect(parseHouse(house, 'CA')).toEqual([
      { body: 'us_house', first: 'Luz', last: 'Rivas', party: 'Democratic' },
    ])
    const senate = `<member><last_name>Padilla</last_name> <first_name>Alex</first_name> <party>D</party> <state>CA</state></member>`
    expect(parseUsSenate(senate, 'CA')[0].party).toBe('Democratic')
  })

  it('reads the Assembly and Senate pages and skips vacant seats', () => {
    const asm = `<li class="members-list__member" data-name="Schultz, Nick" data-district="44" data-party="Democrat" data-counties='LOS ANGELES'>
      <li class="members-list__member" data-name="Vacant" data-district="63" data-party="Vacant" data-counties=''>`
    expect(parseAssembly(asm)).toEqual([
      {
        body: 'state_assembly',
        first: 'Nick',
        last: 'Schultz',
        party: 'Democratic',
      },
    ])
    const sen = `<div class="page-members__member" data-name="Allen" data-district="24" data-party="D"> <div class="member__id"> <h3 class="member__name" data-name="Allen" translate="no">Benjamin Allen</h3>`
    expect(parseStateSenate(sen)).toEqual([
      {
        body: 'state_senate',
        first: 'Benjamin',
        last: 'Allen',
        party: 'Democratic',
      },
    ])
  })
})

describe('rosterMatch', () => {
  it('matches by title, last name and first name or its short form', () => {
    expect(rosterMatch('U.S. Rep. Luz Rivas', members)?.body).toBe('us_house')
    expect(rosterMatch('Assemblymember Nick Schultz', members)?.last).toBe(
      'Schultz',
    )
    expect(rosterMatch('State Sen. Ben Allen', members)?.last).toBe('Allen')
    expect(
      rosterMatch('Assemblymember José Luis Solache Jr.', members)?.last,
    ).toBe('Solache')
    expect(rosterMatch('Sen. Alex Padilla', members)?.body).toBe('us_senate')
  })

  it('leaves former officials, other offices and other people alone', () => {
    expect(rosterMatch('Former State Sen. Ben Allen', members)).toBeUndefined()
    expect(rosterMatch('U.S. Rep. Ben Allen', members)).toBeUndefined()
    expect(rosterMatch('Councilmember Maria Rivas', members)).toBeUndefined()
    expect(
      rosterMatch('Assemblymember Tony Strickland', members),
    ).toBeUndefined()
  })
})
