import { describe, expect, it } from 'vitest'
import { applyClerkSplits, authorityFor, precinctDistricts } from './cook.ts'
import { CHICAGO, COOK_COUNTY, municipality } from './ocd.ts'

describe('authorityFor', () => {
  it('sends Chicago precincts to the Chicago board and the rest to the Clerk', () => {
    expect(authorityFor('chicago:21010').id).toBe(CHICAGO)
    expect(authorityFor('cook:8500022').id).toBe(COOK_COUNTY)
    expect(authorityFor(undefined).id).toBe(COOK_COUNTY)
  })
})

describe('precinctDistricts', () => {
  it('derives city, ward and precinct for Chicago', () => {
    expect(precinctDistricts('chicago:21010')).toEqual([
      CHICAGO,
      `${CHICAGO}/ward:21`,
      `${CHICAGO}/ward:21/precinct:10`,
    ])
  })

  it('adds nothing for suburban precincts', () => {
    expect(precinctDistricts('cook:8500022')).toEqual([])
  })
})

describe('applyClerkSplits', () => {
  const rep = (n: number) => ({
    ocdId: `ocd-division/country:us/state:il/sldl:${n}`,
    layer: 'state house',
  })
  const sub = { ocdId: 'sub:5', layer: 'judicial subcircuit' }

  it("replaces a layer where the map disagrees with the Clerk's split", () => {
    const result = applyClerkSplits(
      [rep(35), sub],
      [{ split: '0', districts: [rep(36)] }],
    )
    expect(result.districts).toEqual([sub, rep(36)])
    expect(result.ambiguous).toBe(false)
  })

  it('picks the split that agrees best with the address', () => {
    const muni = { ocdId: 'place:a', layer: 'municipality' }
    const result = applyClerkSplits(
      [rep(35), muni],
      [
        { split: '1', districts: [rep(36), muni] },
        { split: '2', districts: [rep(35), muni] },
      ],
    )
    expect(result.districts).toEqual([rep(35), muni])
    expect(result.ambiguous).toBe(false)
  })

  it('uses every equally good split instead of guessing', () => {
    const result = applyClerkSplits(
      [rep(1)],
      [
        { split: '1', districts: [rep(2)] },
        { split: '2', districts: [rep(3)] },
      ],
    )
    expect(result.districts).toEqual([rep(2), rep(3)])
    expect(result.ambiguous).toBe(true)
  })

  it('says so when a split names two districts of one layer', () => {
    const result = applyClerkSplits(
      [rep(24)],
      [{ split: '1', districts: [rep(24), rep(6)] }],
    )
    expect(result.districts).toEqual([rep(24), rep(6)])
    expect(result.ambiguous).toBe(true)
  })

  it('keeps a district that may cover only part of the precinct, and says so', () => {
    const area = {
      ocdId: 'program:mid_northside',
      layer: 'expanded mental health services program',
    }
    const possible = applyClerkSplits(
      [rep(14)],
      [{ split: '1', districts: [rep(14), { ...area, possible: true }] }],
    )
    expect(possible.districts.map((d) => d.ocdId)).toEqual([
      rep(14).ocdId,
      area.ocdId,
    ])
    expect(possible.ambiguous).toBe(true)

    const whole = applyClerkSplits(
      [rep(14)],
      [{ split: '1', districts: [rep(14), area] }],
    )
    expect(whole.ambiguous).toBe(false)
  })

  it('uses match-only districts to pick a split, not as districts', () => {
    const result = applyClerkSplits(
      [rep(40)],
      [
        { split: '1', districts: [rep(19), { ...rep(40), matchOnly: true }] },
        { split: '2', districts: [rep(15)] },
      ],
    )
    expect(result.districts).toEqual([rep(19)])
    expect(result.ambiguous).toBe(false)
  })

  it('is not ambiguous when equally good splits agree', () => {
    const result = applyClerkSplits(
      [rep(5)],
      [
        { split: '1', districts: [rep(2)] },
        { split: '2', districts: [rep(2), { ...rep(1), matchOnly: true }] },
      ],
    )
    expect(result.districts).toEqual([rep(2)])
    expect(result.ambiguous).toBe(false)
  })

  it('drops a covered layer the Clerk leaves out', () => {
    const mwrd = { ocdId: 'sewer:mwrd', layer: 'water reclamation' }
    const result = applyClerkSplits(
      [rep(35), mwrd, sub],
      [
        {
          split: '0',
          districts: [rep(36)],
          covers: ['state house', 'water reclamation'],
        },
      ],
    )
    expect(result.districts).toEqual([sub, rep(36)])
  })

  it('keeps the map when the Clerk has nothing for the precinct', () => {
    expect(
      applyClerkSplits([rep(35)], [{ split: '0', districts: [] }]).districts,
    ).toEqual([rep(35)])
  })

  it('removes a map district when the official data says the voter has none', () => {
    const sanitary = { ocdId: 'sanitary:1', layer: 'tax-sanitary' }
    expect(
      applyClerkSplits(
        [rep(35), sanitary],
        [{ split: '0', districts: [], covers: ['tax-sanitary'] }],
      ).districts,
    ).toEqual([rep(35)])
  })
})

describe('municipality', () => {
  it('treats spelling variants as one place', () => {
    expect(municipality('Village of McCook')).toBe(municipality('Mc Cook'))
    expect(municipality('Village of Oak Park')).toBe(
      'ocd-division/country:us/state:il/place:oak_park',
    )
  })
})
