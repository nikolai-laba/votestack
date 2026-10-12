import { describe, expect, it } from 'vitest'
import {
  MONEY_SOURCE_LABELS,
  MONEY_SOURCE_ORDER,
  partyLine,
  profileKey,
  showsMoneyShares,
  type MoneySummary,
} from './profile.ts'

describe('profileKey', () => {
  it('turns a ballot name into a URL-safe key', () => {
    expect(profileKey('Deborah "Debby" Pope')).toBe('deborah-debby-pope')
    expect(profileKey('Whitfield Harrington Jr')).toBe(
      'whitfield-harrington-jr',
    )
    expect(profileKey('Felipe “Phil” Luna Jr.')).toBe('felipe-phil-luna-jr')
  })

  it('ignores accents, apostrophes and extra spaces', () => {
    expect(profileKey('  José  O’Brien-Núñez ')).toBe('jose-obrien-nunez')
  })
})

describe('showsMoneyShares', () => {
  const base: MoneySummary = {
    source: 'ISBE',
    committee: 'Friends of Jane Doe',
    url: 'https://elections.il.gov/committee/1',
    period: 'July 1 to September 30, 2026',
    raised: 5000,
  }

  it('shows percentages from $5,000 raised', () => {
    expect(showsMoneyShares(base)).toBe(true)
    expect(showsMoneyShares({ ...base, raised: 4999.99 })).toBe(false)
    expect(showsMoneyShares({ ...base, raised: undefined })).toBe(false)
  })
})

describe('money source labels', () => {
  it('names every kind each source uses, in one fixed order', () => {
    expect(MONEY_SOURCE_ORDER).toHaveLength(8)
    expect(Object.keys(MONEY_SOURCE_LABELS.FEC)).toEqual([
      ...MONEY_SOURCE_ORDER,
    ])
    expect(
      MONEY_SOURCE_ORDER.filter((k) => MONEY_SOURCE_LABELS.ISBE[k]),
    ).toEqual(['small', 'large', 'transfer', 'candidate', 'loan', 'other'])
  })
})

describe('partyLine', () => {
  it('adds "incumbent" after the party, in the same text', () => {
    expect(partyLine('Democratic', true)).toBe('Democratic, incumbent')
    expect(partyLine('Republican', true)).toBe('Republican, incumbent')
  })

  it('says just "Incumbent" in a nonpartisan race', () => {
    expect(partyLine(undefined, true)).toBe('Incumbent')
  })

  it('shows the party alone without a confirmed incumbent', () => {
    expect(partyLine('Democratic', undefined)).toBe('Democratic')
    expect(partyLine('Democratic', false)).toBe('Democratic')
    expect(partyLine(undefined, undefined)).toBeUndefined()
  })
})
