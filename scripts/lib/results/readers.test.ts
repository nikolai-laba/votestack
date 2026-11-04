import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readChicago } from './chicago.ts'
import { readCook } from './cook.ts'
import { readLa } from './la.ts'
import { zonedToIso } from './time.ts'
import { OFFICIAL_URLS } from './types.ts'

const fixture = (name: string) =>
  readFileSync(resolve('scripts/lib/results/fixtures', name), 'utf8')
const RETRIEVED = '2026-11-04T12:00:00.000Z'

describe('zonedToIso', () => {
  it('uses the zone offset in effect on that date', () => {
    const t = { year: 2026, month: 11, day: 3, hour: 22, minute: 18, second: 0 }
    expect(zonedToIso(t, 'America/Chicago')).toBe('2026-11-04T04:18:00.000Z')
    expect(zonedToIso({ ...t, month: 7 }, 'America/Chicago')).toBe(
      '2026-07-04T03:18:00.000Z',
    )
    expect(
      zonedToIso(
        { ...t, hour: 3, minute: 11, second: 55 },
        'America/Los_Angeles',
      ),
    ).toBe('2026-11-03T11:11:55.000Z')
  })
})

describe('readChicago', () => {
  const file = readChicago(
    fixture('chicago-summary.txt'),
    'Wed, 04 Nov 2026 09:20:55 GMT',
    RETRIEVED,
  )

  it('reads the file metadata', () => {
    expect(file.source).toBe('chicago')
    expect(file.url).toBe(OFFICIAL_URLS.chicago)
    expect(file.retrievedAt).toBe(RETRIEVED)
    expect(file.asOf).toBe('2026-11-04T09:20:55.000Z')
  })

  it('reads the Senate contest', () => {
    const senate = file.contests.find((c) => c.title === 'Senator, U.S.')
    expect(senate?.choices).toEqual([
      { name: 'Don Tracy', votes: 80483 },
      { name: 'Juliana Stratton', votes: 556129 },
      { name: 'Whitfield Harrington Jr', votes: 9350 },
    ])
  })

  it('keeps a retention contest with the file’s own YES/NO names', () => {
    const j = file.contests.find((c) => c.title === 'Bertina E. Lampkin')
    expect(j?.choices.map((c) => c.name)).toEqual(['Yes', 'No'])
    expect(j?.choices[0].votes).toBe(414026)
  })

  it('throws when there are no contest lines', () => {
    expect(() =>
      readChicago('', 'Wed, 04 Nov 2026 09:20:55 GMT', RETRIEVED),
    ).toThrow(/^chicago: /)
  })

  it('throws on a votes field that is not digits', () => {
    const bad = fixture('chicago-summary.txt').replace('0080483', '00x0483')
    expect(() =>
      readChicago(bad, 'Wed, 04 Nov 2026 09:20:55 GMT', RETRIEVED),
    ).toThrow(/^chicago: /)
  })
})

describe('readCook', () => {
  const file = readCook(fixture('cook-results.html'), RETRIEVED)

  it('reads the file metadata', () => {
    expect(file.source).toBe('cook')
    expect(file.url).toBe(OFFICIAL_URLS.cook)
    expect(file.asOf).toBe('2026-11-04T04:18:00.000Z')
  })

  it('reads the Senate contest without party suffixes or leader marks', () => {
    const senate = file.contests.find((c) => c.title === 'Senator, U.S.')
    expect(senate?.voteFor).toBe(1)
    expect(senate?.choices).toEqual([
      { name: 'Don Tracy', votes: 190799 },
      { name: 'Juliana Stratton', votes: 529610 },
      { name: 'Whitfield Harrington Jr', votes: 10853 },
    ])
  })

  it('keeps a retention contest', () => {
    const j = file.contests.find((c) => c.title === 'Bertina E. Lampkin')
    expect(j?.choices).toEqual([
      { name: 'Yes', votes: 457318 },
      { name: 'No', votes: 147033 },
    ])
  })

  it('throws when no contests are found', () => {
    expect(() => readCook('<html></html>', RETRIEVED)).toThrow(/^cook: /)
  })
})

describe('readLa', () => {
  const file = readLa(JSON.parse(fixture('la-results.json')), RETRIEVED)

  it('reads the file metadata', () => {
    expect(file.source).toBe('la')
    expect(file.url).toBe(OFFICIAL_URLS.la)
    expect(file.asOf).toBe('2026-11-04T11:11:55.000Z')
  })

  it('reads the Wiley retention contest as county-only', () => {
    const c = file.contests.find((x) => x.title.endsWith('JOHN WILEY'))
    expect(c?.choices).toEqual([
      { name: 'YES', votes: 1070142 },
      { name: 'NO', votes: 475603 },
    ])
    expect(c?.countyOnly).toBe(true)
    expect(c?.voteFor).toBeUndefined()
  })

  it('reads a measure with its pass rate', () => {
    const c = file.contests.find((x) => x.title.endsWith('MEASURE DB'))
    expect(c?.passRate).toBe('Majority of votes cast')
    expect(c?.choices).toEqual([
      { name: 'YES', votes: 12496 },
      { name: 'NO', votes: 2772 },
    ])
    expect(c?.countyOnly).toBe(false)
  })

  it('throws on a file without contests', () => {
    expect(() => readLa({}, RETRIEVED)).toThrow(/^la: /)
  })
})
