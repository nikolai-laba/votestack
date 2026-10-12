import { describe, expect, it } from 'vitest'
import {
  matchOnStreet,
  parseAddress,
  streetKey,
  type AddressPoint,
} from './address.ts'

describe('parseAddress', () => {
  it('parses a full voter address', () => {
    expect(parseAddress('121 N LaSalle St, Chicago, IL 60602')).toEqual({
      number: 121,
      predir: 'N',
      name: 'LASALLE',
      type: 'ST',
      city: 'CHICAGO',
      zip: '60602',
    })
  })

  it('matches address points written differently', () => {
    const voter = parseAddress('121 North La Salle Street, Chicago')!
    const point = parseAddress('121 N LA SALLE ST')!
    expect(streetKey(voter)).toBe(streetKey(point))
  })

  it('ignores unit numbers and keeps numbered streets', () => {
    expect(
      parseAddress('830 W 119th St Apt 2, Chicago, IL 60643'),
    ).toMatchObject({
      number: 830,
      predir: 'W',
      name: '119TH',
      type: 'ST',
    })
  })

  it('keeps a direction that is the whole street name', () => {
    expect(parseAddress('100 North Ave')).toMatchObject({
      name: 'NORTH',
      type: 'AVE',
    })
  })

  it.each([
    ['834 Lake St. Oak Park', undefined],
    ['834 Lake St Oak Park IL 60301', '60301'],
    ['834 Lake St Apt 2 Oak Park, IL', undefined],
    ['834 Lake St #2B Oak Park', undefined],
  ])('parses %s typed without commas', (input, zip) => {
    expect(parseAddress(input)).toMatchObject({
      number: 834,
      name: 'LAKE',
      type: 'ST',
      city: 'OAK PARK',
      zip,
    })
  })

  it('keeps a city that starts with a direction', () => {
    expect(parseAddress('16220 Wausau Ave South Holland')).toMatchObject({
      name: 'WAUSAU',
      type: 'AVE',
      city: 'SOUTH HOLLAND',
    })
  })

  it('drops the state after a city without a comma', () => {
    expect(parseAddress('834 Lake St, Oak Park IL 60301')).toMatchObject({
      city: 'OAK PARK',
      zip: '60301',
    })
  })

  it('rejects input without a house number', () => {
    expect(parseAddress('LaSalle St, Chicago')).toBeNull()
  })
})

describe('matchOnStreet', () => {
  const street: AddressPoint[] = [
    {
      number: 100,
      type: 'ST',
      city: 'CHICAGO',
      zip: '60602',
      lat: 41.0,
      lng: -87.0,
    },
    {
      number: 140,
      type: 'ST',
      city: 'CHICAGO',
      zip: '60602',
      lat: 41.4,
      lng: -87.4,
    },
    {
      number: 121,
      type: 'ST',
      city: 'EVANSTON',
      zip: '60201',
      lat: 42.0,
      lng: -88.0,
    },
    {
      number: 111,
      type: 'ST',
      city: 'CHICAGO',
      zip: '60602',
      lat: 41.1,
      lng: -87.1,
    },
    {
      number: 131,
      type: 'ST',
      city: 'CHICAGO',
      zip: '60602',
      lat: 41.3,
      lng: -87.3,
    },
    {
      number: 151,
      type: 'ST',
      city: 'CHICAGO',
      zip: '60601',
      lat: 41.5,
      lng: -87.5,
    },
  ]

  it('returns an exact point in the right city', () => {
    const evanston = parseAddress('121 N Main St, Evanston')!
    expect(matchOnStreet(evanston, street)).toEqual({
      lat: 42.0,
      lng: -88.0,
      precision: 'exact',
    })
  })

  it('interpolates between same-side neighbours', () => {
    const chicago = parseAddress('121 N Main St, Chicago, IL 60602')!
    const result = matchOnStreet(chicago, street)!
    expect(result.precision).toBe('interpolated')
    expect(result.lat).toBeCloseTo(41.2)
    expect(result.lng).toBeCloseTo(-87.2)
  })

  it('uses neighbours in another ZIP of the same city', () => {
    const result = matchOnStreet(
      parseAddress('141 N Main St, Chicago, IL 60602')!,
      street,
    )!
    expect(result.precision).toBe('interpolated')
    expect(result.lat).toBeCloseTo(41.4)
  })

  it('uses the postal city of the ZIP when the town name differs', () => {
    // A town whose address points carry a different postal city name.
    const result = matchOnStreet(
      parseAddress('141 N Main St, Norridge, IL 60602')!,
      street.filter((p) => p.number !== 131),
    )!
    expect(result.precision).toBe('interpolated')
    expect(result.lat).toBeCloseTo(41.4)
  })

  it('matches points whose city is spelled in mixed case', () => {
    const mixedCase = street.map((p) =>
      p.number === 151 ? { ...p, city: 'Chicago' } : p,
    )
    // 151 is in another ZIP, so only the city scope can find it.
    expect(
      matchOnStreet(
        parseAddress('151 N Main St, Chicago, IL 60602')!,
        mixedCase,
      ),
    ).toEqual({ lat: 41.5, lng: -87.5, precision: 'exact' })
  })

  it('gives up without neighbours on both sides', () => {
    expect(
      matchOnStreet(parseAddress('999 N Main St, Chicago')!, street),
    ).toBeNull()
  })
})
