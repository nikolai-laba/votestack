import { describe, expect, it } from 'vitest'
import {
  REFERENDUM_AREA_LAYER,
  REFERENDUM_AREAS,
  referendumAreaDistrict,
  withReferendumAreas,
} from './chicago-referendum-areas.ts'

const MID =
  'ocd-division/country:us/state:il/place:chicago/expanded_mental_health_services_program:mid_northside'
const split = { split: '1', districts: [{ ocdId: 'x', layer: 'state house' }] }

describe('referendumAreaDistrict', () => {
  it("places the Board's program-area scopes", () => {
    expect(
      referendumAreaDistrict(
        'the proposed Mid-Northside Expanded Mental Health Services Program Area',
      ),
    ).toBe(MID)
    expect(
      referendumAreaDistrict(
        'the proposed Far Southwest Side Expanded Mental Health Services Program Area',
      ),
    ).toMatch(/expanded_mental_health_services_program:far_southwest_side$/)
  })

  it('leaves other scopes alone', () => {
    expect(
      referendumAreaDistrict(
        'the proposed Near North Expanded Mental Health Services Program Area',
      ),
    ).toBeNull()
    expect(referendumAreaDistrict('the 4th Ward')).toBeNull()
  })
})

describe('REFERENDUM_AREAS', () => {
  it('has precinct lists for every area, with no precinct both whole and edge', () => {
    for (const area of REFERENDUM_AREAS) {
      expect(area.whole.length).toBeGreaterThan(50)
      for (const key of [...area.whole, ...Object.keys(area.edge)])
        expect(key).toMatch(/^\d{1,2}-\d{1,2}$/)
      for (const [key, share] of Object.entries(area.edge)) {
        expect(area.whole).not.toContain(key)
        expect(share).toBeGreaterThan(0)
        expect(share).toBeLessThan(0.99)
      }
    }
  })

  it('keeps the two areas apart', () => {
    const [a, b] = REFERENDUM_AREAS.map(
      (x) => new Set([...x.whole, ...Object.keys(x.edge)]),
    )
    expect([...a].filter((k) => b.has(k))).toEqual([])
  })
})

describe('withReferendumAreas', () => {
  const mid = REFERENDUM_AREAS.find((a) => a.name === 'Mid-Northside')!
  const whole = mid.whole[0]
  const edge = Object.keys(mid.edge)[0]

  it('adds the area to every split of a whole precinct', () => {
    const result = withReferendumAreas(whole, [split, { ...split, split: '2' }])
    for (const s of result)
      expect(s.districts).toContainEqual({
        ocdId: MID,
        layer: REFERENDUM_AREA_LAYER,
      })
  })

  it('adds it as possible to an edge precinct', () => {
    const [s] = withReferendumAreas(edge, [split])
    expect(s.districts).toContainEqual({
      ocdId: MID,
      layer: REFERENDUM_AREA_LAYER,
      possible: true,
    })
  })

  it('adds nothing elsewhere', () => {
    expect(withReferendumAreas('1-1', [split])).toEqual([split])
  })
})
